import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { DatabaseIntegrityError, PersistedRecordCorruptError, IdempotencyRecordCorruptError, UnsupportedDatabaseSchemaError, IncompleteDatabaseSchemaError } from "@/src/shared/persistence-integrity";
import { createProject } from "@/src/domain/models/project";
import { createArtifact } from "@/src/domain/models/artifact";
import { commitManualEdit } from "@/src/application/capabilities/artifacts";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { makeIdempotencyRequest } from "@/src/shared/idempotency";
import type { PersistencePort } from "@/src/ports/persistence";

const resources: Array<{ dir: string; dbs: SqliteDb[] }> = [];

function fresh(): { dir: string; db: SqliteDb } {
  const dir = mkdtempSync(join(tmpdir(), "mcu-persistence-integrity-"));
  const db = openDatabase(join(dir, "state.db"));
  resources.push({ dir, dbs: [db] });
  return { dir, db };
}

afterEach(() => {
  for (const resource of resources.splice(0)) {
    for (const db of resource.dbs) {
      try { db.close(); } catch { /* already closed */ }
    }
    rmSync(resource.dir, { recursive: true, force: true });
  }
});

describe("persistence integrity boundary", () => {
  it("freezes SQLite policy and verifies a healthy schema", () => {
    const { db } = fresh();
    migrate(db);
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("synchronous", { simple: true })).toBe(1);
    expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(db.pragma("quick_check", { simple: true })).toBe("ok");
  });

  it("rejects future migration metadata and never continues old migrations", () => {
    const { db } = fresh();
    db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    db.prepare("INSERT INTO schema_migrations VALUES (99, 'future', '2026-08-14T00:00:00Z')").run();
    expect(() => migrate(db)).toThrow(UnsupportedDatabaseSchemaError);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get()).toBeUndefined();
  });

  it("rejects applied migration metadata when critical tables are absent", () => {
    const { db } = fresh();
    db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    for (let version = 1; version <= 10; version += 1) {
      db.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)").run(version, `migration-${version}`, "2026-08-14T00:00:00Z");
    }
    expect(() => migrate(db)).toThrow(IncompleteDatabaseSchemaError);
  });

  it("rejects a damaged SQLite page before serving the database", () => {
    const { dir, db } = fresh();
    migrate(db);
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
    const databasePath = join(dir, "state.db");
    const bytes = readFileSync(databasePath);
    bytes[4096] = (bytes[4096] ?? 0) ^ 0xff;
    writeFileSync(databasePath, bytes);
    const damaged = openDatabase(databasePath);
    resources.find((resource) => resource.dir === dir)?.dbs.push(damaged);
    expect(() => migrate(damaged)).toThrow(DatabaseIntegrityError);
  });

  it("fails closed for malformed persisted build/task/idempotency records", async () => {
    const { db } = fresh();
    migrate(db);
    const store = createProjectStore(db);
    const project = createProject("Integrity fixture");
    const artifact = createArtifact({ projectId: project.id, kind: "firmware" });
    db.prepare("INSERT INTO projects (id, name, created_at, archived_at, archived_reason) VALUES (?, ?, ?, NULL, NULL)")
      .run(project.id, project.name, project.createdAt);
    db.prepare("INSERT INTO artifacts (id, project_id, kind, current_version_id, created_at) VALUES (?, ?, ?, NULL, ?)")
      .run(artifact.id, artifact.projectId, artifact.kind, artifact.createdAt);
    db.prepare("INSERT INTO tasks (id, capability, input, status, created_at, output) VALUES (?, ?, ?, ?, ?, ?)")
      .run("bad-task", "analyze_requirement", "{", "completed", "2026-08-14T00:00:00Z", "not-json");
    await expect(store.getTask("bad-task")).rejects.toThrow(PersistedRecordCorruptError);

    db.prepare("INSERT INTO artifact_versions (id, artifact_id, version_no, content_ref, content_hash, status, source_kind, source_proposal_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)")
      .run("fixture-version", artifact.id, 1, "firmware/0001.json", "a".repeat(64), "accepted", "manual", "2026-08-14T00:00:00Z", "owner");
    db.prepare("INSERT INTO build_records (id, artifact_version_id, target, toolchain, options, status, started_at, diagnostics, outputs_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("bad-build", "fixture-version", "esp32-s3", "arduino", "{}", "failed", "2026-08-14T00:00:00Z", "[]", "{}");
    await expect(store.getBuildRecord("bad-build")).rejects.toThrow(PersistedRecordCorruptError);

    db.prepare("INSERT INTO idempotency_records (scope, key, request_hash, response_status, response_body_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("POST:/projects", "bad-idem", "not-a-sha", 200, "{}", "2026-08-14T00:00:00Z");
    await expect(store.getIdempotencyRecord!("POST:/projects", "bad-idem")).rejects.toThrow(IdempotencyRecordCorruptError);
  });

  it("keeps idempotency request hashes bounded to SHA-256 and statuses to HTTP", async () => {
    const { db } = fresh();
    migrate(db);
    const store = createProjectStore(db);
    const validHash = "a".repeat(64);
    db.prepare("INSERT INTO idempotency_records (scope, key, request_hash, response_status, response_body_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("POST:/projects", "bad-status", validHash, 99, "{}", "2026-08-14T00:00:00Z");
    await expect(store.getIdempotencyRecord!("POST:/projects", "bad-status")).rejects.toThrow(IdempotencyRecordCorruptError);
  });

  it("fails closed when a completed task output or proposal payload is malformed", async () => {
    const { db } = fresh();
    migrate(db);
    const store = createProjectStore(db);
    const project = createProject("Malformed reads");
    const artifact = createArtifact({ projectId: project.id, kind: "requirements" });
    await store.withTransaction((uow) => {
      uow.createProject(project);
      uow.createArtifact(artifact);
    });
    db.prepare("INSERT INTO tasks (id, capability, input, status, created_at, completed_at, output) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("bad-output", "analyze_requirement", JSON.stringify({ projectId: project.id }), "completed", "2026-08-14T00:00:00Z", "2026-08-14T00:00:01Z", "{");
    await expect(store.latestTaskOutput("analyze_requirement")).rejects.toThrow(PersistedRecordCorruptError);
    db.prepare(`INSERT INTO proposals (id, project_id, artifact_id, type, payload, impacts, status, created_by, created_at, decision_history)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("bad-proposal", project.id, artifact.id, "requirement", "{", "[]", "pending", "owner", "2026-08-14T00:00:00Z", "[]");
    await expect(store.getProposal("bad-proposal")).rejects.toThrow(PersistedRecordCorruptError);
    await store.withTransaction((uow) => uow.createVersion({
      id: "fixture-version",
      artifactId: artifact.id,
      versionNo: 1,
      contentRef: "requirements/0001.json",
      contentHash: "a".repeat(64),
      status: "accepted",
      sourceKind: "manual",
      sourceProposalId: null,
      createdAt: "2026-08-14T00:00:00Z",
      createdBy: "owner",
    }));
    db.prepare("INSERT INTO validation_records (id, artifact_version_id, kind, rules, result, diagnostics, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("bad-validation", "fixture-version", "requirements", "{}", "pass", "[]", "2026-08-14T00:00:00Z");
    await expect(store.latestValidation("fixture-version")).rejects.toThrow(PersistedRecordCorruptError);
  });

  it("does not report a database success after a workspace or transaction write failure", async () => {
    const { dir, db } = fresh();
    migrate(db);
    const store = createProjectStore(db);
    const project = createProject("Atomic writes");
    const artifact = createArtifact({ projectId: project.id, kind: "requirements" });
    await store.withTransaction((uow) => {
      uow.createProject(project);
      uow.createArtifact(artifact);
    });
    const workspace = createWorkspaceFilesContent(join(dir, "workspace"));
    const failedWorkspace = { ...workspace, store: async () => { throw new Error("injected workspace write failure"); } };
    await expect(commitManualEdit({ artifactId: artifact.id, content: "workspace-failure" }, { persistence: store, content: failedWorkspace, events: { publish: () => undefined } }))
      .rejects.toThrow("injected workspace write failure");
    expect(await store.listVersions(artifact.id)).toHaveLength(0);
    expect((await store.getArtifact(artifact.id))?.currentVersionId).toBeNull();

    const request = makeIdempotencyRequest("db-failure", `POST:/artifacts/${artifact.id}/versions`, { content: "db-failure" }, "2026-08-14T00:00:00Z");
    const failingPersistence: PersistencePort = {
      ...store,
      withTransaction: async (fn) => store.withTransaction((uow) => {
        fn(uow);
        throw new Error("injected database transaction failure");
      }),
    };
    await expect(commitManualEdit({ artifactId: artifact.id, content: "db-failure", idempotency: request }, { persistence: failingPersistence, content: workspace, events: { publish: () => undefined } }))
      .rejects.toThrow("injected database transaction failure");
    expect(await store.listVersions(artifact.id)).toHaveLength(0);
    expect((await store.getArtifact(artifact.id))?.currentVersionId).toBeNull();
    expect(await store.getIdempotencyRecord!(request!.scope, request!.key)).toBeNull();
    await expect(workspace.load(`${project.id}/requirements/0001.json`)).resolves.toBe("db-failure");
  });

  it("keeps SQLite writes bounded and rejects query-only mutation", async () => {
    const { db, dir } = fresh();
    migrate(db);
    const second = openDatabase(join(dir, "state.db"));
    resources.find((resource) => resource.dir === dir)?.dbs.push(second);
    db.exec("BEGIN IMMEDIATE");
    const startedAt = Date.now();
    expect(() => second.prepare("INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)").run("locked", "locked", "2026-08-14T00:00:00Z"))
      .toThrow(/database is locked/i);
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(4500);
    expect(elapsed).toBeLessThan(8000);
    db.exec("ROLLBACK");

    const readOnlyProject = createProject("query only");
    db.pragma("query_only = ON");
    await expect(createProjectStore(db).withTransaction((uow) => uow.createProject(readOnlyProject))).rejects.toThrow();
    expect(db.prepare("SELECT COUNT(*) AS count FROM projects").get()).toEqual({ count: 0 });
  }, 15_000);
});
