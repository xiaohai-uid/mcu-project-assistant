import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { createArtifact } from "@/src/domain/models/artifact";
import { createBuildRecord, finalizeBuildRecord } from "@/src/domain/models/build-record";
import { createProject } from "@/src/domain/models/project";

let dir: string;
let db: SqliteDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-build-records-"));
  db = openDatabase(join(dir, "state.db"));
  migrate(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function seed() {
  const store = createProjectStore(db);
  const project = createProject("Build evidence");
  const artifact = createArtifact({ projectId: project.id, kind: "firmware" });
  await store.withTransaction((uow) => {
    uow.createProject(project);
    uow.createArtifact(artifact);
    uow.createVersion({
      id: "firmware-v1",
      artifactId: artifact.id,
      versionNo: 1,
      contentRef: "firmware/0001/src/main.cpp",
      contentHash: "sha256:source",
      status: "accepted",
      sourceKind: "manual",
      sourceProposalId: null,
      createdAt: "2026-08-13T00:00:00.000Z",
      createdBy: "owner",
    });
    uow.setCurrentVersion(artifact.id, "firmware-v1");
  });
  return { store, artifact };
}

describe("build output evidence persistence", () => {
  it("round-trips command, isolated paths, and hashed outputs", async () => {
    const { store, artifact } = await seed();
    const running = createBuildRecord({
      id: "build-evidence",
      artifactVersionId: "firmware-v1",
      taskId: "task-1",
      target: "esp32-s3",
      toolchain: "esp32-arduino",
      toolchainVersion: "arduino-cli 1.0.4",
      options: {},
      startedAt: "2026-08-13T00:00:01.000Z",
      sourceDir: "C:/workspace/firmware/0001/src",
      outputDir: "C:/workspace/.build/build-evidence/output",
    });
    const finished = finalizeBuildRecord(running, {
      status: "succeeded",
      completedAt: "2026-08-13T00:00:02.000Z",
      stdoutRef: "C:/workspace/.build/build-evidence/build.log",
      exitCode: 0,
      command: ["arduino-cli", "compile", "--fqbn", "esp32:esp32:esp32s3"],
      outputs: [{ path: "C:/workspace/.build/build-evidence/output/firmware.bin", kind: "bin", sizeBytes: 8, sha256: "a".repeat(64) }],
    });
    await store.withTransaction((uow) => uow.createBuildRecord(finished));

    const found = await store.getBuildRecord(finished.id);
    expect(found).toMatchObject({
      artifactVersionId: "firmware-v1",
      sourceDir: "C:/workspace/firmware/0001/src",
      outputDir: "C:/workspace/.build/build-evidence/output",
      command: ["arduino-cli", "compile", "--fqbn", "esp32:esp32:esp32s3"],
      outputs: [{ kind: "bin", sizeBytes: 8, sha256: "a".repeat(64) }],
    });
    expect((await store.listBuilds("firmware-v1")).map((build) => build.id)).toEqual(["build-evidence"]);
    expect(artifact.kind).toBe("firmware");
  });

  it("reads legacy rows with empty evidence without making them build-ready", async () => {
    const { store } = await seed();
    db.prepare(`
      INSERT INTO build_records
        (id, artifact_version_id, task_id, target, toolchain, toolchain_version, options, status, started_at, completed_at, stdout_ref, stderr_ref, exit_code, diagnostics)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "legacy-build",
      "firmware-v1",
      null,
      "esp32-s3",
      "esp32-arduino",
      null,
      "{}",
      "succeeded",
      "2026-08-12T00:00:00.000Z",
      "2026-08-12T00:00:01.000Z",
      null,
      null,
      0,
      "[]",
    );

    const found = await store.getBuildRecord("legacy-build");
    expect(found?.status).toBe("succeeded");
    expect(found?.sourceDir).toBeNull();
    expect(found?.outputs).toEqual([]);
  });
});
