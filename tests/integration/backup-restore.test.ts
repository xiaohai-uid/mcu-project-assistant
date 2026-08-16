import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createArtifact } from "@/src/domain/models/artifact";
import { createBuildRecord, finalizeBuildRecord } from "@/src/domain/models/build-record";
import { createProject } from "@/src/domain/models/project";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { openDatabase } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { acquireProductionStateOwnership, createBackup, createRestore } from "@/src/infrastructure/backup-restore";
import { analyzeRequirement } from "@/src/application/capabilities/analysis";
import { runBuild } from "@/src/application/capabilities/build";
import { flashDevice, createFlashTokenStore, FlashBuildNotVerifiedError } from "@/src/application/capabilities/flash";
import { hashCanonical, type IdempotencyRequest } from "@/src/shared/idempotency";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function createFixture(kind: "requirements" | "firmware" = "requirements"): Promise<{ root: string; dbPath: string; workspaceDir: string; projectId: string; artifactId: string; versionId: string; contentRef: string }> {
  const root = mkdtempSync(join(tmpdir(), "mcu-backup-restore-"));
  roots.push(root);
  const dbPath = join(root, "state", "mcu.db");
  const workspaceDir = join(root, "workspace");
  mkdirSync(join(root, "state"), { recursive: true });
  const db = openDatabase(dbPath);
  migrate(db);
  const persistence = createProjectStore(db);
  const project = createProject("backup fixture");
  const artifact = createArtifact({ projectId: project.id, kind });
  const content = createWorkspaceFilesContent(workspaceDir);
  const stored = await content.store({ projectId: project.id, kind, versionNo: 1, ...(kind === "firmware" ? { subpath: "src/main.cpp" } : {}) }, kind === "firmware" ? "void setup(){}\n" : "requirements-v1");
  const version = {
    id: "requirements-v1",
    artifactId: artifact.id,
    versionNo: 1,
    contentRef: "",
    contentHash: "",
    status: "accepted" as const,
    sourceKind: "manual" as const,
    sourceProposalId: null,
    createdAt: "2026-08-14T00:00:00.000Z",
    createdBy: "owner",
  };
  version.contentRef = stored.contentRef;
  version.contentHash = stored.contentHash;
  persistence.withTransaction((uow) => {
    uow.createProject(project);
    uow.createArtifact(artifact);
    uow.createVersion(version);
    uow.setCurrentVersion(artifact.id, version.id);
  });
  db.close();
  return { root, dbPath, workspaceDir, projectId: project.id, artifactId: artifact.id, versionId: version.id, contentRef: stored.contentRef };
}

async function seedIdempotency(dbPath: string, entries: Array<{ scope: string; key: string; response: unknown }>): Promise<void> {
  const db = openDatabase(dbPath);
  const persistence = createProjectStore(db);
  for (const entry of entries) {
    const request: IdempotencyRequest = { scope: entry.scope, key: entry.key, requestHash: hashCanonical({ scope: entry.scope, key: entry.key }), createdAt: "2026-08-14T00:00:00.000Z" };
    await persistence.withTransaction((uow) => {
      uow.claimIdempotency?.(request, 202, JSON.stringify(entry.response));
    });
  }
  db.close();
}

describe("local backup and restore contract", () => {
  it("creates a complete versioned backup and restores artifact truth to a clean root", async () => {
    const fixture = await createFixture();
    const backupDir = join(fixture.root, "backups", "snapshot-1");
    const restoredDb = join(fixture.root, "restored", "state", "mcu.db");
    const restoredWorkspace = join(fixture.root, "restored", "workspace");

    const result = await createBackup({ dbPath: fixture.dbPath, workspaceDir: fixture.workspaceDir, outputDir: backupDir });
    expect(result.manifest.formatVersion).toBe(1);
    expect(existsSync(join(backupDir, "BACKUP_COMPLETE"))).toBe(true);
    expect(result.manifest.database.file).toBe("database.sqlite");
    expect(result.manifest.workspace.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: fixture.contentRef.replaceAll("\\", "/"), authoritative: true }),
    ]));
    expect(readdirSync(backupDir)).toEqual(expect.arrayContaining(["database.sqlite", "workspace", "manifest.json", "BACKUP_COMPLETE"]));

    const restored = await createRestore({ backupDir, dbPath: restoredDb, workspaceDir: restoredWorkspace });
    expect(restored.projectCount).toBe(1);
    expect(readFileSync(join(restoredWorkspace, fixture.contentRef), "utf8")).toBe("requirements-v1");
    expect(createHash("sha256").update(readFileSync(join(restoredWorkspace, fixture.contentRef))).digest("hex")).toBe(
      result.manifest.workspace.files.find((file) => file.path === fixture.contentRef)?.sha256,
    );
  });

  it("refuses a backup lock held by the production state", async () => {
    const fixture = await createFixture();
    const lock = acquireProductionStateOwnership(fixture.dbPath, fixture.workspaceDir);
    try {
      await expect(createBackup({ dbPath: fixture.dbPath, workspaceDir: fixture.workspaceDir, outputDir: join(fixture.root, "backup") }))
        .rejects.toMatchObject({ code: "production_state_in_use" });
    } finally {
      lock.release();
    }
  });

  it("rejects incomplete backups and populated restore targets before mutation", async () => {
    const fixture = await createFixture();
    const backupDir = join(fixture.root, "backups", "snapshot-1");
    await createBackup({ dbPath: fixture.dbPath, workspaceDir: fixture.workspaceDir, outputDir: backupDir });
    rmSync(join(backupDir, "BACKUP_COMPLETE"));
    await expect(createRestore({ backupDir, dbPath: join(fixture.root, "restore.db"), workspaceDir: join(fixture.root, "restore-workspace") }))
      .rejects.toMatchObject({ code: "backup_incomplete" });

    const validBackup = join(fixture.root, "backups", "snapshot-2");
    await createBackup({ dbPath: fixture.dbPath, workspaceDir: fixture.workspaceDir, outputDir: validBackup });
    const existingDb = join(fixture.root, "existing.db");
    writeFileSync(existingDb, "occupied");
    await expect(createRestore({ backupDir: validBackup, dbPath: existingDb, workspaceDir: join(fixture.root, "empty-target") }))
      .rejects.toMatchObject({ code: "restore_target_not_empty" });

    const emptyWorkspace = join(fixture.root, "empty-workspace");
    mkdirSync(emptyWorkspace, { recursive: true });
    await expect(createRestore({ backupDir: validBackup, dbPath: join(fixture.root, "empty-workspace.db"), workspaceDir: emptyWorkspace }))
      .resolves.toMatchObject({ projectCount: 1 });
  });

  it("keeps the SQLite snapshot independent from source WAL sidecars", async () => {
    const fixture = await createFixture();
    const db = openDatabase(fixture.dbPath);
    db.pragma("wal_autocheckpoint = 0");
    db.prepare("INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)").run("wal-project", "wal project", "2026-08-14T00:00:00.000Z");
    expect(existsSync(`${fixture.dbPath}-wal`)).toBe(true);
    db.close();
    const result = await createBackup({ dbPath: fixture.dbPath, workspaceDir: fixture.workspaceDir, outputDir: join(fixture.root, "backups", "wal") });
    expect(existsSync(join(result.backupDir, "database.sqlite-wal"))).toBe(false);
    const snapshot = openDatabase(join(result.backupDir, "database.sqlite"));
    expect(snapshot.prepare("SELECT name FROM projects WHERE id = ?").get("wal-project")).toMatchObject({ name: "wal project" });
    snapshot.close();
  });

  it("rejects tampered manifest files, traversal entries, and corrupted SQLite before target mutation", async () => {
    const fixture = await createFixture();
    const backupDir = join(fixture.root, "backups", "tampered");
    await createBackup({ dbPath: fixture.dbPath, workspaceDir: fixture.workspaceDir, outputDir: backupDir });
    writeFileSync(join(backupDir, "workspace", fixture.contentRef), "tampered", "utf8");
    await expect(createRestore({ backupDir, dbPath: join(fixture.root, "target", "state.db"), workspaceDir: join(fixture.root, "target", "workspace") }))
      .rejects.toMatchObject({ code: "backup_hash_mismatch" });
    expect(existsSync(join(fixture.root, "target", "state.db"))).toBe(false);
    expect(existsSync(join(fixture.root, "target", "workspace"))).toBe(false);

    const traversalDir = join(fixture.root, "backups", "traversal");
    await createBackup({ dbPath: fixture.dbPath, workspaceDir: fixture.workspaceDir, outputDir: traversalDir });
    const manifestPath = join(traversalDir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { workspace: { files: Array<{ path: string }> } };
    manifest.workspace.files[0]!.path = "../outside.txt";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await expect(createRestore({ backupDir: traversalDir, dbPath: join(fixture.root, "target2", "state.db"), workspaceDir: join(fixture.root, "target2", "workspace") }))
      .rejects.toMatchObject({ code: "backup_invalid" });

    const corruptDir = join(fixture.root, "backups", "corrupt");
    await createBackup({ dbPath: fixture.dbPath, workspaceDir: fixture.workspaceDir, outputDir: corruptDir });
    copyFileSync(join(corruptDir, "database.sqlite"), join(corruptDir, "database.sqlite.bak"));
    writeFileSync(join(corruptDir, "database.sqlite"), Buffer.from("not sqlite"));
    await expect(createRestore({ backupDir: corruptDir, dbPath: join(fixture.root, "target3", "state.db"), workspaceDir: join(fixture.root, "target3", "workspace") }))
      .rejects.toMatchObject({ code: "backup_hash_mismatch" });
  });

  it("replays restored analyze, build, and flash submissions without invoking side effects", async () => {
    const fixture = await createFixture("firmware");
    const entries = [
      { scope: "analyze_requirement", key: "analyze-key", response: { taskId: "analyze-task" } },
      { scope: "run_build", key: "build-key", response: { buildId: "build-1", taskId: "build-task" } },
      { scope: "flash_device", key: "flash-key", response: { taskId: "flash-task" } },
    ];
    await seedIdempotency(fixture.dbPath, entries);
    const backupDir = join(fixture.root, "backups", "idempotency");
    await createBackup({ dbPath: fixture.dbPath, workspaceDir: fixture.workspaceDir, outputDir: backupDir });
    const restoredDb = join(fixture.root, "replay", "state.db");
    const restoredWorkspace = join(fixture.root, "replay", "workspace");
    await createRestore({ backupDir, dbPath: restoredDb, workspaceDir: restoredWorkspace });
    const db = openDatabase(restoredDb);
    const persistence = createProjectStore(db);
    let analyzeSubmitCount = 0;
    let providerStatusCount = 0;
    const analyze = await analyzeRequirement(
      { projectId: fixture.projectId, description: "same request", idempotency: { scope: "analyze_requirement", key: "analyze-key", requestHash: hashCanonical({ scope: "analyze_requirement", key: "analyze-key" }), createdAt: "2026-08-14T00:00:00.000Z" } },
      { persistence, tasks: { submit: async () => { analyzeSubmitCount += 1; return "new"; }, getTask: async () => null, cancel: async () => false }, ai: { name: "fixture", status: async () => { providerStatusCount += 1; return "available"; }, streamText: async () => {}, generateStructured: async () => ({ data: {} }) } as never, events: { publish: () => undefined } },
    );
    let compilerDiscoveryCount = 0;
    const build = await runBuild(
      { projectId: fixture.projectId, versionId: fixture.versionId, idempotency: { scope: "run_build", key: "build-key", requestHash: hashCanonical({ scope: "run_build", key: "build-key" }), createdAt: "2026-08-14T00:00:00.000Z" } },
      { persistence, tasks: { submit: async () => "new", getTask: async () => null, cancel: async () => false }, events: { publish: () => undefined }, compiler: { discoverToolchain: async () => { compilerDiscoveryCount += 1; return { available: true, toolchain: "fixture", version: "1" }; }, build: async () => ({ exitCode: 0 }) } as never, workspaceDir: restoredWorkspace },
    );
    let flashInvocationCount = 0;
    const flash = await flashDevice(
      { projectId: fixture.projectId, deviceId: "device", confirmationToken: "stale-token", buildId: "build-1", artifactVersionId: fixture.versionId, idempotency: { scope: "flash_device", key: "flash-key", requestHash: hashCanonical({ scope: "flash_device", key: "flash-key" }), createdAt: "2026-08-14T00:00:00.000Z" } },
      { persistence, tasks: { submit: async () => "new", getTask: async () => null, cancel: async () => false }, events: { publish: () => undefined }, device: { detectBoard: async () => { throw new Error("must not detect"); }, disconnect: async () => {}, flash: async () => { flashInvocationCount += 1; return { exitCode: 0, sessionId: "never", truth: { executionReality: "companion", verification: "verified", physicalVerified: false, adapter: "fixture" } }; }, session: () => ({ device: null, stage: "none", truth: { executionReality: "companion", verification: "blocked", physicalVerified: false, adapter: "fixture" }, serialStage: "disconnected", serialSessionId: null, serialLines: [] }), openSerialSession: async () => { throw new Error("must not open"); }, closeSerialSession: async () => {}, getSerialSession: () => null, subscribeSerialSession: () => () => {}, writeSerial: async () => { throw new Error("must not write"); }, tickSerial: () => {}, shutdown: async () => {} }, tokens: createFlashTokenStore(60_000), workspaceDir: restoredWorkspace },
    );
    expect(analyze).toEqual({ taskId: "analyze-task" });
    expect(build).toEqual({ buildId: "build-1", taskId: "build-task" });
    expect(flash).toEqual({ taskId: "flash-task" });
    expect({ analyzeSubmitCount, providerStatusCount, compilerDiscoveryCount, flashInvocationCount }).toEqual({ analyzeSubmitCount: 0, providerStatusCount: 0, compilerDiscoveryCount: 0, flashInvocationCount: 0 });
    db.close();
  });

  it("blocks flashing an old build whose absolute evidence points outside the restored root", async () => {
    const fixture = await createFixture("firmware");
    const outputDir = join(fixture.workspaceDir, ".build", "legacy-build", "output");
    const firmwarePath = join(outputDir, "firmware.bin");
    const firmware = Buffer.from("legacy firmware\n", "utf8");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(firmwarePath, firmware);
    const db = openDatabase(fixture.dbPath);
    const persistence = createProjectStore(db);
    const running = createBuildRecord({
      id: "legacy-build",
      artifactVersionId: fixture.versionId,
      taskId: null,
      target: "esp32-s3",
      toolchain: "fixture",
      toolchainVersion: "1",
      options: {},
      startedAt: "2026-08-14T00:00:01.000Z",
      sourceDir: join(fixture.workspaceDir, "firmware", "src"),
      outputDir,
    });
    const succeeded = finalizeBuildRecord(running, {
      status: "succeeded",
      completedAt: "2026-08-14T00:00:02.000Z",
      stdoutRef: null,
      exitCode: 0,
      outputs: [{ path: firmwarePath, kind: "bin", sizeBytes: firmware.byteLength, sha256: createHash("sha256").update(firmware).digest("hex") }],
    });
    await persistence.withTransaction((uow) => uow.createBuildRecord(succeeded));
    db.close();

    const backupDir = join(fixture.root, "backups", "absolute-build");
    await createBackup({ dbPath: fixture.dbPath, workspaceDir: fixture.workspaceDir, outputDir: backupDir });
    const restoredDb = join(fixture.root, "portable", "state.db");
    const restoredWorkspace = join(fixture.root, "portable", "workspace");
    await createRestore({ backupDir, dbPath: restoredDb, workspaceDir: restoredWorkspace });

    const restored = openDatabase(restoredDb);
    const restoredPersistence = createProjectStore(restored);
    const tokens = createFlashTokenStore(60_000);
    const token = tokens.issue("device", new Date());
    let flashInvocationCount = 0;
    await expect(flashDevice(
      { projectId: fixture.projectId, deviceId: "device", confirmationToken: token.token, buildId: "legacy-build", artifactVersionId: fixture.versionId },
      {
        persistence: restoredPersistence,
        tasks: { submit: async () => "never", getTask: async () => null, cancel: async () => false },
        events: { publish: () => undefined },
        device: { session: () => ({ device: null, stage: "none", truth: { executionReality: "companion", verification: "verified", physicalVerified: false, adapter: "fixture" }, serialStage: "disconnected", serialSessionId: null, serialLines: [] }), flash: async () => { flashInvocationCount += 1; throw new Error("must not flash"); } } as never,
        tokens,
        workspaceDir: restoredWorkspace,
      },
    )).rejects.toBeInstanceOf(FlashBuildNotVerifiedError);
    expect(flashInvocationCount).toBe(0);
    restored.close();
  });

  it("preserves active-task recovery safety after restore", async () => {
    const fixture = await createFixture("requirements");
    const db = openDatabase(fixture.dbPath);
    const persistence = createProjectStore(db);
    await persistence.withTransaction((uow) => {
      for (const capability of ["analyze_requirement", "run_build", "flash_device"] as const) {
        uow.saveTask({ id: `${capability}-running`, capability, input: JSON.stringify({ projectId: fixture.projectId, versionId: fixture.versionId, buildId: "missing-build" }), status: "running", createdAt: "2026-08-14T00:00:00.000Z", startedAt: "2026-08-14T00:00:01.000Z", completedAt: null, error: null, output: null });
      }
    });
    db.close();
    const backupDir = join(fixture.root, "backups", "running");
    await createBackup({ dbPath: fixture.dbPath, workspaceDir: fixture.workspaceDir, outputDir: backupDir });
    const restoredDb = join(fixture.root, "running-restore", "state.db");
    const restoredWorkspace = join(fixture.root, "running-restore", "workspace");
    await createRestore({ backupDir, dbPath: restoredDb, workspaceDir: restoredWorkspace });
    const restored = openDatabase(restoredDb);
    const restoredPersistence = createProjectStore(restored);
    const tasks = (await restoredPersistence.withTransaction((uow) => {
      const interrupted = uow.recoverInterruptedTasks?.() ?? [];
      return interrupted;
    }));
    expect(tasks).toHaveLength(3);
    restored.close();
  });
});
