import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createMockCompiler } from "@/src/adapters/compiler/mock";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createProductionTaskExecutor } from "@/src/infrastructure/task-runtime";
import { resolveBuildPaths } from "@/src/application/capabilities/build";
import { createArtifact } from "@/src/domain/models/artifact";
import { createBuildRecord } from "@/src/domain/models/build-record";
import { createProject } from "@/src/domain/models/project";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("run_build restart recovery", () => {
  it("reuses the same task/build/version and isolated output after an orphaned task", async () => {
    const root = mkdtempSync(join(tmpdir(), "mcu-build-recovery-"));
    roots.push(root);
    const workspaceDir = join(root, "workspace");
    const db = openDatabase(join(root, "state.db"));
    migrate(db);
    const persistence = createProjectStore(db);
    const content = createWorkspaceFilesContent(workspaceDir);
    const events = { publish: () => undefined };
    const compiler = createMockCompiler();
    const project = createProject("recovered build");
    const artifact = createArtifact({ projectId: project.id, kind: "firmware" });
    const source = await content.store({ projectId: project.id, kind: "firmware", versionNo: 1, subpath: "src/main.cpp" }, "void setup(){}\n");
    await content.store({ projectId: project.id, kind: "firmware", versionNo: 1, subpath: "platformio.ini" }, "[env:esp32s3]\n");
    const buildId = "recovered-build";
    const paths = resolveBuildPaths(workspaceDir, source.contentRef, buildId);
    await persistence.withTransaction((uow) => {
      uow.createProject(project);
      uow.createArtifact(artifact);
      uow.createVersion({ id: "firmware-v1", artifactId: artifact.id, versionNo: 1, contentRef: source.contentRef, contentHash: source.contentHash, status: "accepted", sourceKind: "manual", sourceProposalId: null, createdAt: "2026-08-13T00:00:00.000Z", createdBy: "owner" });
      uow.setCurrentVersion(artifact.id, "firmware-v1");
      uow.saveTask({ id: "build-task", capability: "run_build", input: JSON.stringify({ buildId, projectId: project.id, versionId: "firmware-v1" }), status: "running", createdAt: "2026-08-13T00:00:00.000Z", startedAt: "2026-08-13T00:00:01.000Z", completedAt: null, error: null, output: null });
      uow.createBuildRecord(createBuildRecord({ id: buildId, artifactVersionId: "firmware-v1", taskId: "build-task", target: "esp32-s3", toolchain: "esp32-arduino", toolchainVersion: "1.0.4 (mock)", options: {}, startedAt: "2026-08-13T00:00:01.000Z", sourceDir: paths.sourceDir, outputDir: paths.outputDir }));
    });
    const captured: string[] = [];
    const delegate = compiler.build.bind(compiler);
    compiler.build = async (request, onOutput, signal) => {
      captured.push(request.sourceDir);
      return delegate(request, onOutput, signal);
    };
    const tasks = createInProcessTasks({ persistence, events });
    tasks.setExecutor(createProductionTaskExecutor({ persistence, events, ai: { name: "test", status: async () => "unavailable", streamText: async () => {}, generateStructured: async () => ({ data: {} }) } as never, compiler, workspaceDir }));

    try {
      expect(await tasks.recover()).toEqual({ recovered: 1, failed: 0 });
      await tasks.waitForIdle();
      expect((await persistence.getTask("build-task"))?.status).toBe("completed");
      expect((await persistence.getBuildRecord(buildId))?.status).toBe("succeeded");
      expect(await persistence.listBuilds("firmware-v1")).toHaveLength(1);
      expect(captured).toEqual([paths.sourceDir]);
      expect((await persistence.getBuildRecord(buildId))?.outputDir).toBe(paths.outputDir);
    } finally {
      await tasks.stop();
      db.close();
    }
  }, 30_000);

  it("fails historical running build records that have no linked durable task", async () => {
    const root = mkdtempSync(join(tmpdir(), "mcu-build-orphan-recovery-"));
    roots.push(root);
    const workspaceDir = join(root, "workspace");
    const db = openDatabase(join(root, "state.db"));
    migrate(db);
    const persistence = createProjectStore(db);
    const content = createWorkspaceFilesContent(workspaceDir);
    const project = createProject("orphaned build");
    const artifact = createArtifact({ projectId: project.id, kind: "firmware" });
    const source = await content.store({ projectId: project.id, kind: "firmware", versionNo: 1, subpath: "src/main.cpp" }, "void setup(){}\n");
    const paths = resolveBuildPaths(workspaceDir, source.contentRef, "orphan-build");
    mkdirSync(paths.outputDir, { recursive: true });
    writeFileSync(join(paths.outputDir, "old.bin"), "old-success-looking-output", "utf8");
    await persistence.withTransaction((uow) => {
      uow.createProject(project);
      uow.createArtifact(artifact);
      uow.createVersion({ id: "orphan-version", artifactId: artifact.id, versionNo: 1, contentRef: source.contentRef, contentHash: source.contentHash, status: "accepted", sourceKind: "manual", sourceProposalId: null, createdAt: "2026-08-13T00:00:00.000Z", createdBy: "owner" });
      uow.createBuildRecord(createBuildRecord({ id: "orphan-build", artifactVersionId: "orphan-version", taskId: null, target: "esp32-s3", toolchain: "esp32-arduino", toolchainVersion: "legacy", options: {}, startedAt: "2026-08-13T00:00:01.000Z", sourceDir: paths.sourceDir, outputDir: paths.outputDir }));
    });
    const tasks = createInProcessTasks({ persistence, events: { publish: () => undefined } });
    expect(await tasks.recover()).toEqual({ recovered: 0, failed: 0 });
    const repaired = await persistence.getBuildRecord("orphan-build");
    expect(repaired?.status).toBe("failed");
    expect(repaired?.diagnostics[0]).toMatchObject({ code: "build_recovery_orphaned" });
    expect(repaired?.outputs).toEqual([]);
    expect(existsSync(join(paths.outputDir, "old.bin"))).toBe(true);
    db.close();
  });

  it("clears partial output before replaying a linked running build", async () => {
    const root = mkdtempSync(join(tmpdir(), "mcu-build-partial-recovery-"));
    roots.push(root);
    const workspaceDir = join(root, "workspace");
    const db = openDatabase(join(root, "state.db"));
    migrate(db);
    const persistence = createProjectStore(db);
    const content = createWorkspaceFilesContent(workspaceDir);
    const project = createProject("partial build");
    const artifact = createArtifact({ projectId: project.id, kind: "firmware" });
    const source = await content.store({ projectId: project.id, kind: "firmware", versionNo: 1, subpath: "src/main.cpp" }, "void setup(){}\n");
    const buildId = "partial-build";
    const paths = resolveBuildPaths(workspaceDir, source.contentRef, buildId);
    mkdirSync(paths.outputDir, { recursive: true });
    writeFileSync(join(paths.outputDir, "partial.bin"), "stale-partial", "utf8");
    await persistence.withTransaction((uow) => {
      uow.createProject(project);
      uow.createArtifact(artifact);
      uow.createVersion({ id: "partial-version", artifactId: artifact.id, versionNo: 1, contentRef: source.contentRef, contentHash: source.contentHash, status: "accepted", sourceKind: "manual", sourceProposalId: null, createdAt: "2026-08-13T00:00:00.000Z", createdBy: "owner" });
      uow.saveTask({ id: "partial-task", capability: "run_build", input: JSON.stringify({ buildId, projectId: project.id, versionId: "partial-version" }), status: "running", createdAt: "2026-08-13T00:00:00.000Z", startedAt: "2026-08-13T00:00:01.000Z", completedAt: null, error: null, output: null });
      uow.createBuildRecord(createBuildRecord({ id: buildId, artifactVersionId: "partial-version", taskId: "partial-task", target: "esp32-s3", toolchain: "esp32-arduino", toolchainVersion: "mock", options: {}, startedAt: "2026-08-13T00:00:01.000Z", sourceDir: paths.sourceDir, outputDir: paths.outputDir }));
    });
    const compiler = createMockCompiler();
    const tasks = createInProcessTasks({ persistence, events: { publish: () => undefined } });
    tasks.setExecutor(createProductionTaskExecutor({ persistence, events: { publish: () => undefined }, ai: { name: "test", status: async () => "unavailable", streamText: async () => {}, generateStructured: async () => ({ data: {} }) } as never, compiler, workspaceDir }));
    expect(await tasks.recover()).toEqual({ recovered: 1, failed: 0 });
    await tasks.waitForIdle();
    expect(existsSync(join(paths.outputDir, "partial.bin"))).toBe(false);
    expect((await persistence.getBuildRecord(buildId))?.status).toBe("succeeded");
    db.close();
  });
});
