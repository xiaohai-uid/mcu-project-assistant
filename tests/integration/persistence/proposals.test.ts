// integration/persistence/proposals — proposals 表（ISSUE-004 §8/§11）
// T2/T3 事务原子性（版本+指针+提案状态同事务）；列表/详情查询。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { createArtifact } from "@/src/domain/models/artifact";
import { createProject } from "@/src/domain/models/project";
import { createProposal } from "@/src/domain/models/proposal";

let dir: string;
let dbPath: string;
let openDbs: SqliteDb[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s3b-"));
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

async function seed(store: ReturnType<typeof createProjectStore>) {
  const project = createProject("G");
  await store.withTransaction((uow) => uow.createProject(project));
  const artifact = createArtifact({ projectId: project.id, kind: "requirements" });
  await store.withTransaction((uow) => uow.createArtifact(artifact));
  return { project, artifact };
}

describe("proposals 表（ISSUE-004 §8）", () => {
  it("迁移 004：proposals 表存在 + 索引（幂等）", () => {
    const { db } = freshStore();
    migrate(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain("proposals");
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='proposals'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(idx).toContain("idx_proposals_project");
    expect(idx).toContain("idx_proposals_base");
  });

  it("createProposal/resolveProposal/listProposals 往返（含决策历史）", async () => {
    const { store } = freshStore();
    const { project, artifact } = await seed(store);
    const p = createProposal({
      projectId: project.id,
      artifactId: artifact.id,
      baseVersionId: null,
      type: "requirement",
      payload: "{}",
      diff: { from: "a", to: "b" },
      impacts: ["Hardware"],
      reason: null,
      createdBy: "owner",
      now: () => new Date("2026-08-11T00:00:00Z"),
    });
    await store.withTransaction((uow) => uow.createProposal(p));
    const resolved = { ...p, status: "accepted" as const, decidedAt: "2026-08-11T00:00:01Z", decisionHistory: [{ status: "accepted" as const, at: "2026-08-11T00:00:01Z" }] };
    await store.withTransaction((uow) => uow.resolveProposal(resolved));
    const fetched = await store.getProposal(p.id);
    expect(fetched?.status).toBe("accepted");
    expect(fetched?.decisionHistory).toHaveLength(1);
    const list = await store.listProposals(project.id);
    expect(list).toHaveLength(1);
  });

  it("T2 原子性：版本插入抛错 → 提案状态同事务回滚（不出现半提交）", async () => {
    const { store } = freshStore();
    const { project, artifact } = await seed(store);
    const p = createProposal({
      projectId: project.id,
      artifactId: artifact.id,
      baseVersionId: null,
      type: "requirement",
      payload: "{}",
      diff: null,
      impacts: [],
      reason: null,
      createdBy: "owner",
      now: () => new Date("2026-08-11T00:00:00Z"),
    });
    await expect(
      store.withTransaction((uow) => {
        uow.createProposal(p);
        uow.createVersion({
          id: "v1",
          artifactId: artifact.id,
          versionNo: 1,
          contentRef: "requirements/0001.json",
          contentHash: "h",
          status: "accepted",
          sourceKind: "proposal",
          sourceProposalId: p.id,
          createdAt: "2026-08-11T00:00:00Z",
          createdBy: "owner",
        });
        uow.createVersion({
          id: "v1dup",
          artifactId: artifact.id,
          versionNo: 1,
          contentRef: "requirements/0001.json",
          contentHash: "h2",
          status: "accepted",
          sourceKind: "proposal",
          sourceProposalId: p.id,
          createdAt: "2026-08-11T00:00:00Z",
          createdBy: "owner",
        });
      }),
    ).rejects.toThrow();
    expect(await store.getProposal(p.id)).toBeNull();
    expect((await store.listVersions(artifact.id)).length).toBe(0);
  });

  it("T3：仅提案状态更新（无版本行产生）", async () => {
    const { store } = freshStore();
    const { project, artifact } = await seed(store);
    const p = createProposal({
      projectId: project.id,
      artifactId: artifact.id,
      baseVersionId: null,
      type: "requirement",
      payload: "{}",
      diff: null,
      impacts: [],
      reason: null,
      createdBy: "owner",
      now: () => new Date("2026-08-11T00:00:00Z"),
    });
    await store.withTransaction((uow) => {
      uow.createProposal(p);
      uow.resolveProposal({ ...p, status: "rejected", decidedAt: "2026-08-11T00:00:01Z", decisionHistory: [{ status: "rejected", at: "2026-08-11T00:00:01Z" }] });
    });
    expect((await store.listVersions(artifact.id)).length).toBe(0);
    const fetched = await store.getProposal(p.id);
    expect(fetched?.status).toBe("rejected");
  });
});
