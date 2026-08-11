// integration/persistence/artifacts — SQLite artifacts/artifact_versions（ISSUE-002 §8/§11）
// 迁移 002；UNIQUE(artifact_id, version_no)；不可变触发器（对 content 字段 UPDATE 拒绝）；WAL。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { createArtifact } from "@/src/domain/models/artifact";
import { createProject } from "@/src/domain/models/project";

let dir: string;
let dbPath: string;
let openDbs: SqliteDb[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s2-"));
  dbPath = join(dir, "test.db");
});

afterEach(() => {
  for (const db of openDbs) {
    try {
      db.close();
    } catch {
      // already closed
    }
  }
  openDbs = [];
  rmSync(dir, { recursive: true, force: true });
});

function freshStore() {
  const db = openDatabase(dbPath);
  openDbs.push(db);
  migrate(db);
  return { db, store: createProjectStore(db) };
}

async function seedProject(store: ReturnType<typeof createProjectStore>) {
  const p = createProject("Greenhouse");
  await store.withTransaction((uow) => uow.createProject(p));
  return p;
}

describe("迁移 002（artifacts + artifact_versions）", () => {
  it("幂等：跑两次迁移，两张表 + 索引存在", () => {
    const { db } = freshStore();
    migrate(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain("artifacts");
    expect(tables).toContain("artifact_versions");
    expect(tables).toContain("schema_migrations");
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='artifact_versions'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(idx).toContain("idx_versions_artifact");
  });

  it("kind CHECK：仅 5 种 Artifact kind", () => {
    const { db } = freshStore();
    expect(() =>
      db
        .prepare("INSERT INTO artifacts (id, project_id, kind, created_at) VALUES (?, ?, ?, ?)")
        .run("a1", "p1", "build", "2026-08-11T00:00:00Z"),
    ).toThrow(/CHECK/i);
  });

  it("project_id 外键：不存在项目 → 拒绝", async () => {
    const { db } = freshStore();
    expect(() =>
      db
        .prepare("INSERT INTO artifacts (id, project_id, kind, created_at) VALUES (?, ?, ?, ?)")
        .run("a1", "no-such-project", "pinmap", "2026-08-11T00:00:00Z"),
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe("Artifact / ArtifactVersion 持久化", () => {
  it("ensure：UNIQUE(project_id, kind) 拒绝重复 Artifact", async () => {
    const { store } = freshStore();
    const p = await seedProject(store);
    const a1 = createArtifact({ projectId: p.id, kind: "pinmap" });
    const a2 = createArtifact({ projectId: p.id, kind: "pinmap" });
    await store.withTransaction((uow) => uow.createArtifact(a1));
    await expect(store.withTransaction((uow) => uow.createArtifact(a2))).rejects.toThrow(/UNIQUE/i);
  });

  it("提交：createVersion + setCurrentVersion → getVersion/listVersions/getArtifactByKind 往返", async () => {
    const { store } = freshStore();
    const p = await seedProject(store);
    const a = createArtifact({ projectId: p.id, kind: "pinmap" });
    await store.withTransaction((uow) => {
      uow.createArtifact(a);
      uow.createVersion({
        id: "v1",
        artifactId: a.id,
        versionNo: 1,
        contentRef: "pinmap/0001.json",
        contentHash: "sha256:abc",
        status: "accepted",
        sourceKind: "manual",
        sourceProposalId: null,
        createdAt: "2026-08-11T00:00:00Z",
        createdBy: "owner",
      });
      uow.setCurrentVersion(a.id, "v1");
    });

    const found = await store.getArtifactByKind(p.id, "pinmap");
    expect(found?.currentVersionId).toBe("v1");
    const v = await store.getVersion("v1");
    expect(v?.versionNo).toBe(1);
    expect(v?.contentHash).toBe("sha256:abc");
    const versions = await store.listVersions(a.id);
    expect(versions).toHaveLength(1);
  });

  it("UNIQUE(artifact_id, version_no)：同 artifact 重复 version_no 拒绝（单调性兜底）", async () => {
    const { store } = freshStore();
    const p = await seedProject(store);
    const a = createArtifact({ projectId: p.id, kind: "pinmap" });
    await store.withTransaction((uow) => {
      uow.createArtifact(a);
      uow.createVersion({
        id: "v1",
        artifactId: a.id,
        versionNo: 1,
        contentRef: "pinmap/0001.json",
        contentHash: "h1",
        status: "accepted",
        sourceKind: "manual",
        sourceProposalId: null,
        createdAt: "2026-08-11T00:00:00Z",
        createdBy: "owner",
      });
    });
    await expect(
      store.withTransaction((uow) =>
        uow.createVersion({
          id: "v1dup",
          artifactId: a.id,
          versionNo: 1,
          contentRef: "pinmap/0001.json",
          contentHash: "h2",
          status: "accepted",
          sourceKind: "manual",
          sourceProposalId: null,
          createdAt: "2026-08-11T00:00:00Z",
          createdBy: "owner",
        }),
      ),
    ).rejects.toThrow(/UNIQUE/i);
  });

  it("不可变（I-2）：对 content_ref / content_hash 的 UPDATE 必须被拒绝（触发器）", async () => {
    const { db, store } = freshStore();
    const p = await seedProject(store);
    const a = createArtifact({ projectId: p.id, kind: "pinmap" });
    await store.withTransaction((uow) => {
      uow.createArtifact(a);
      uow.createVersion({
        id: "v1",
        artifactId: a.id,
        versionNo: 1,
        contentRef: "pinmap/0001.json",
        contentHash: "h1",
        status: "accepted",
        sourceKind: "manual",
        sourceProposalId: null,
        createdAt: "2026-08-11T00:00:00Z",
        createdBy: "owner",
      });
    });
    expect(() =>
      db
        .prepare("UPDATE artifact_versions SET content_hash = 'tampered' WHERE id = 'v1'")
        .run(),
    ).toThrow(/immutable/i);
    const v = await store.getVersion("v1");
    expect(v?.contentHash).toBe("h1");
  });

  it("事务回滚：版本插入抛错 → artifact 行也不留（UoW 原子）", async () => {
    const { store } = freshStore();
    const p = await seedProject(store);
    const a = createArtifact({ projectId: p.id, kind: "pinmap" });
    await expect(
      store.withTransaction((uow) => {
        uow.createArtifact(a);
        uow.createVersion({
          id: "v1",
          artifactId: a.id,
          versionNo: 1,
          contentRef: "r",
          contentHash: "h",
          status: "accepted",
          sourceKind: "manual",
          sourceProposalId: null,
          createdAt: "2026-08-11T00:00:00Z",
          createdBy: "owner",
        });
        uow.createVersion({
          id: "v1dup",
          artifactId: a.id,
          versionNo: 1,
          contentRef: "r2",
          contentHash: "h2",
          status: "accepted",
          sourceKind: "manual",
          sourceProposalId: null,
          createdAt: "2026-08-11T00:00:00Z",
          createdBy: "owner",
        });
      }),
    ).rejects.toThrow();
    const artifacts = await store.listArtifacts(p.id);
    expect(artifacts).toHaveLength(0);
  });

  it("WAL 保持开启", () => {
    const { db } = freshStore();
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
  });
});
