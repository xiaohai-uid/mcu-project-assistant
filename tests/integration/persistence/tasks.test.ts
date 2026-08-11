// integration/persistence/tasks — tasks 表（ISSUE-003 §8/§11）
// 状态迁移 queued→running→completed/failed/cancelled；崩溃恢复 running→queued。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import type { TaskRecord } from "@/src/ports/task-execution";

let dir: string;
let dbPath: string;
let openDbs: SqliteDb[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s3a-"));
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

const task = (id: string, status: TaskRecord["status"] = "queued"): TaskRecord => ({
  id,
  capability: "analyze_requirement",
  input: "greenhouse",
  status,
  createdAt: "2026-08-11T00:00:00Z",
  startedAt: status === "queued" ? null : "2026-08-11T00:00:01Z",
  completedAt: status === "completed" ? "2026-08-11T00:00:02Z" : null,
  error: null,
});

describe("tasks 表（ISSUE-003 §8）", () => {
  it("迁移 003：tasks 表存在（幂等）", () => {
    const { db } = freshStore();
    migrate(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain("tasks");
    expect(tables).toContain("schema_migrations");
  });

  it("saveTask/updateTask/getTask：状态迁移 queued→running→completed 往返", async () => {
    const { store } = freshStore();
    await store.withTransaction((uow) => uow.saveTask(task("t1", "queued")));
    let t = await store.getTask("t1");
    expect(t?.status).toBe("queued");

    await store.withTransaction((uow) => uow.updateTask(task("t1", "running")));
    t = await store.getTask("t1");
    expect(t?.status).toBe("running");
    expect(t?.startedAt).not.toBeNull();

    await store.withTransaction((uow) => uow.updateTask(task("t1", "completed")));
    t = await store.getTask("t1");
    expect(t?.status).toBe("completed");
    expect(t?.completedAt).not.toBeNull();
  });

  it("claimNextTask：取最早 queued → 置 running（FIFO；running=崩溃遗留可重新 claim）", async () => {
    const { store } = freshStore();
    await store.withTransaction((uow) => {
      uow.saveTask(task("t1", "queued"));
      uow.saveTask(task("t2", "queued"));
    });
    const claimed = await store.withTransaction((uow) => uow.claimNextTask());
    expect(claimed?.id).toBe("t1");
    const t1 = await store.getTask("t1");
    expect(t1?.status).toBe("running");
    // running 无执行者（崩溃遗留）→ 可再次被 claim；先完结 t1 再 claim 取 t2（FIFO）
    await store.withTransaction((uow) => uow.updateTask(task("t1", "completed")));
    const claimed2 = await store.withTransaction((uow) => uow.claimNextTask());
    expect(claimed2?.id).toBe("t2");
  });

  it("崩溃恢复：重启后 running→queued（recoverQueued；running 无执行者）", async () => {
    const first = freshStore();
    await first.store.withTransaction((uow) => {
      uow.saveTask(task("t1", "running")); // 崩溃遗留
      uow.saveTask(task("t2", "completed"));
    });
    first.db.close();

    const second = freshStore();
    const recovered = await second.store.withTransaction((uow) => uow.claimNextTask());
    expect(recovered?.id).toBe("t1"); // running → 可重新 claim（即 queued 语义）
    const t2 = await second.store.getTask("t2");
    expect(t2?.status).toBe("completed");
  });
});
