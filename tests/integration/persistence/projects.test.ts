import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject } from "@/src/domain/models/project";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";

let dir: string;
let dbPath: string;
let openDbs: SqliteDb[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s1-"));
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

describe("SQLite persistence（ADR-0004；ISSUE-001 §8）", () => {
  it("migration：可重复验证（跑两次幂等）", () => {
    const { db } = freshStore();
    migrate(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain("projects");
    expect(tables).toContain("schema_migrations");
  });

  it("PRAGMA：WAL + foreign_keys 开启（crash-safe，Tier1 Recoverability）", () => {
    const { db } = freshStore();
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("创建 → 行落库 → 关闭重开（应用重启）→ 项目仍存在", async () => {
    const first = freshStore();
    const p = createProject("Smart Greenhouse");
    await first.store.withTransaction((uow) => uow.createProject(p));
    first.db.close();

    // 模拟应用重启：新连接
    const second = freshStore();
    const reloaded = await second.store.getProject(p.id);
    expect(reloaded?.name).toBe("Smart Greenhouse");
    expect(reloaded?.createdAt).toBe(p.createdAt);
    expect(reloaded?.archivedAt).toBeNull();
  });

  it("归档 → 重开后记录保留（不静默级联删除，I-10）", async () => {
    const first = freshStore();
    const p = createProject("A");
    await first.store.withTransaction((uow) => uow.createProject(p));
    await first.store.withTransaction((uow) =>
      uow.archiveProject(p.id, "2026-08-11T13:00:00.000Z", "user request"),
    );
    first.db.close();

    const second = freshStore();
    const reloaded = await second.store.getProject(p.id);
    expect(reloaded?.archivedAt).toBe("2026-08-11T13:00:00.000Z");
    expect(reloaded?.archivedReason).toBe("user request");
  });

  it("约束：主键唯一（重复 id 拒绝）", async () => {
    const { store } = freshStore();
    const p = createProject("A");
    await store.withTransaction((uow) => uow.createProject(p));
    await expect(store.withTransaction((uow) => uow.createProject(p))).rejects.toThrow();
  });

  it("事务回滚：uow 中途抛错 → 无行残留", async () => {
    const { store } = freshStore();
    const p = createProject("A");
    await expect(
      store.withTransaction((uow) => {
        uow.createProject(p);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await store.listProjects()).toHaveLength(0);
  });
});
