// integration/persistence/stale — stale_marks 表（ISSUE-007 §8/§11）
// 当前态标记（resolved_at）；UNIQUE 未解决约束语义；resolve 幂等。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { createArtifact } from "@/src/domain/models/artifact";
import { createProject } from "@/src/domain/models/project";
import type { StaleMarkDto } from "@/src/shared-contracts/types";

let dir: string;
let dbPath: string;
let openDbs: SqliteDb[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s5b-"));
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

function mark(id: string, artifactId: string, projectId: string, level: StaleMarkDto["level"]): StaleMarkDto {
  return {
    id,
    projectId,
    artifactId,
    affectedVersionId: null,
    level,
    reason: "MCU changed",
    sourceVersionId: null,
    triggeredBy: "select_mcu",
    createdAt: "2026-08-11T00:00:00Z",
    resolvedAt: null,
  };
}

describe("stale_marks 表（ISSUE-007 §8）", () => {
  it("迁移 006：stale_marks 表 + 索引（幂等）", () => {
    const { db } = freshStore();
    migrate(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain("stale_marks");
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='stale_marks'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(idx).toContain("idx_stale_project");
  });

  it("saveStaleMarks/activeStaleMarks：未解决可见；resolve 后消失（resolved_at 语义）", async () => {
    const { store } = freshStore();
    const project = createProject("G");
    await store.withTransaction((uow) => uow.createProject(project));
    const a = createArtifact({ projectId: project.id, kind: "firmware" });
    await store.withTransaction((uow) => uow.createArtifact(a));

    await store.withTransaction((uow) => uow.saveStaleMarks([mark("m1", a.id, project.id, "L3")]));
    let active = await store.activeStaleMarks(project.id);
    expect(active).toHaveLength(1);
    expect(active[0]?.level).toBe("L3");

    await store.withTransaction((uow) => uow.resolveStaleMarks(a.id, "v2"));
    active = await store.activeStaleMarks(project.id);
    expect(active).toHaveLength(0);
    // resolved 记录保留（当前态语义：resolve 后不再 active）
  });

  it("resolve 幂等：重复 resolve 无副作用", async () => {
    const { store } = freshStore();
    const project = createProject("G");
    await store.withTransaction((uow) => uow.createProject(project));
    const a = createArtifact({ projectId: project.id, kind: "firmware" });
    await store.withTransaction((uow) => uow.createArtifact(a));
    await store.withTransaction((uow) => uow.saveStaleMarks([mark("m1", a.id, project.id, "L2")]));
    await store.withTransaction((uow) => uow.resolveStaleMarks(a.id, "v2"));
    await store.withTransaction((uow) => uow.resolveStaleMarks(a.id, "v3"));
    expect((await store.activeStaleMarks(project.id)).length).toBe(0);
  });
});
