import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import type { TaskRecord } from "@/src/ports/task-execution";

const resources: Array<{ db: SqliteDb; dir: string }> = [];

afterEach(() => {
  for (const resource of resources.splice(0)) {
    resource.db.close();
    rmSync(resource.dir, { recursive: true, force: true });
  }
});

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "mcu-task-terminal-"));
  const db = openDatabase(join(dir, "tasks.db"));
  migrate(db);
  resources.push({ db, dir });
  return createProjectStore(db);
}

function seededTask(id: string, status: TaskRecord["status"] = "queued"): TaskRecord {
  return {
    id,
    capability: "test_terminal",
    input: "{}",
    status,
    createdAt: "2026-08-12T00:00:00.000Z",
    startedAt: status === "queued" ? null : "2026-08-12T00:00:01.000Z",
    completedAt: ["completed", "failed", "cancelled"].includes(status) ? "2026-08-12T00:00:02.000Z" : null,
    error: status === "failed" ? "previous failure" : null,
    output: null,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForTerminal(tasks: ReturnType<typeof createInProcessTasks>, taskId: string): Promise<TaskRecord> {
  for (let i = 0; i < 100; i += 1) {
    const task = await tasks.getTask(taskId);
    if (task && ["completed", "failed", "cancelled"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`task ${taskId} did not reach a terminal state`);
}

describe("task failure and cancellation terminal state", () => {
  it("cancels a queued task durably without invoking its executor", async () => {
    const persistence = freshStore();
    await persistence.withTransaction((uow) => uow.saveTask(seededTask("queued-task")));
    let executions = 0;
    const tasks = createInProcessTasks({
      persistence,
      events: { publish: () => undefined },
      executeTask: async () => { executions += 1; },
    });

    await expect(tasks.cancel("queued-task")).resolves.toBe(true);
    await expect(tasks.recover()).resolves.toEqual({ recovered: 0, failed: 0 });
    expect(executions).toBe(0);
    expect(await tasks.getTask("queued-task")).toMatchObject({ status: "cancelled", output: null });
  });

  it("persists cancellation before aborting a running executor", async () => {
    const persistence = freshStore();
    const started = deferred();
    const aborted = deferred();
    const tasks = createInProcessTasks({
      persistence,
      events: { publish: () => undefined },
      executeTask: async (_task, ctx) => {
        started.resolve();
        await new Promise<void>((resolve) => {
          ctx.signal.addEventListener("abort", () => {
            aborted.resolve();
            resolve();
          }, { once: true });
        });
      },
    });
    const taskId = await tasks.submit({ capability: "test_terminal", input: "{}" });
    await started.promise;

    await expect(tasks.cancel(taskId)).resolves.toBe(true);
    await aborted.promise;
    expect((await tasks.waitForTask(taskId))?.status).toBe("cancelled");
  });

  it("does not let a late executor result overwrite cancelled or persist output", async () => {
    const persistence = freshStore();
    const started = deferred();
    const release = deferred();
    const tasks = createInProcessTasks({
      persistence,
      events: { publish: () => undefined },
      executeTask: async (_task, ctx) => {
        started.resolve();
        await ctx.setOutput("late output");
        await release.promise;
      },
    });
    const taskId = await tasks.submit({ capability: "test_terminal", input: "{}" });
    await started.promise;
    await expect(tasks.cancel(taskId)).resolves.toBe(true);
    release.resolve();
    await tasks.waitForIdle();

    expect(await tasks.getTask(taskId)).toMatchObject({ status: "cancelled", output: null });
  });

  it("persists provider/application failures as failed and not cancelled", async () => {
    const persistence = freshStore();
    const tasks = createInProcessTasks({
      persistence,
      events: { publish: () => undefined },
      executeTask: async () => { throw new Error("controlled provider failure"); },
    });
    const taskId = await tasks.submit({ capability: "test_terminal", input: "{}" });

    await expect(waitForTerminal(tasks, taskId)).resolves.toMatchObject({
      status: "failed",
      error: JSON.stringify({ code: "internal", message: "Internal server error" }),
    });
  });

  it("waitForTask resolves completed and failed terminal records", async () => {
    const completedTasks = createInProcessTasks({
      persistence: freshStore(),
      events: { publish: () => undefined },
      executeTask: async (_task, ctx) => { await ctx.setOutput("done"); },
    });
    const completedId = await completedTasks.submit({ capability: "test_terminal", input: "{}" });
    await expect(completedTasks.waitForTask(completedId)).resolves.toMatchObject({ status: "completed", output: "done" });

    const failedTasks = createInProcessTasks({
      persistence: freshStore(),
      events: { publish: () => undefined },
      executeTask: async () => { throw new Error("wait failure"); },
    });
    const failedId = await failedTasks.submit({ capability: "test_terminal", input: "{}" });
    await expect(failedTasks.waitForTask(failedId)).resolves.toMatchObject({ status: "failed", error: JSON.stringify({ code: "internal", message: "Internal server error" }) });

    const cancelledPersistence = freshStore();
    await cancelledPersistence.withTransaction((uow) => uow.saveTask(seededTask("wait-cancelled", "cancelled")));
    const cancelledTasks = createInProcessTasks({
      persistence: cancelledPersistence,
      events: { publish: () => undefined },
      executeTask: async () => { throw new Error("must not execute"); },
    });
    await expect(cancelledTasks.waitForTask("wait-cancelled")).resolves.toMatchObject({ status: "cancelled" });
  });

  it("waitForTask returns persisted terminal records without active runtime promises", async () => {
    const persistence = freshStore();
    await persistence.withTransaction((uow) => {
      uow.saveTask(seededTask("persisted-completed", "completed"));
      uow.saveTask(seededTask("persisted-failed", "failed"));
      uow.saveTask(seededTask("persisted-cancelled", "cancelled"));
    });
    let executions = 0;
    const tasks = createInProcessTasks({
      persistence,
      events: { publish: () => undefined },
      executeTask: async () => { executions += 1; },
    });

    await expect(tasks.waitForTask("persisted-completed")).resolves.toMatchObject({ status: "completed" });
    await expect(tasks.waitForTask("persisted-failed")).resolves.toMatchObject({ status: "failed" });
    await expect(tasks.waitForTask("persisted-cancelled")).resolves.toMatchObject({ status: "cancelled" });
    expect(executions).toBe(0);
  });

  it("protects a terminal task from later terminal transitions", async () => {
    const persistence = freshStore();
    await persistence.withTransaction((uow) => uow.saveTask(seededTask("terminal-task", "running")));
    await persistence.withTransaction((uow) => uow.updateTask(seededTask("terminal-task", "completed")));
    await persistence.withTransaction((uow) => uow.updateTask({
      ...seededTask("terminal-task", "failed"),
      error: "late failure",
    }));
    await persistence.withTransaction((uow) => uow.updateTask(seededTask("terminal-task", "cancelled")));

    expect(await persistence.getTask("terminal-task")).toMatchObject({ status: "completed", error: null });
  });

  it("rejects illegal queued terminal transitions at the persistence seam", async () => {
    const persistence = freshStore();
    await persistence.withTransaction((uow) => uow.saveTask(seededTask("queued-transition")));
    await persistence.withTransaction((uow) => uow.updateTask(seededTask("queued-transition", "completed")));
    await persistence.withTransaction((uow) => uow.updateTask({
      ...seededTask("queued-transition", "failed"),
      error: "illegal queued failure",
    }));
    expect(await persistence.getTask("queued-transition")).toMatchObject({ status: "queued", output: null, error: null });
  });

  it("runs a deterministic cancel/complete race without contradictory terminal data", async () => {
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const persistence = freshStore();
      const started = deferred();
      const release = deferred();
      const tasks = createInProcessTasks({
        persistence,
        events: { publish: () => undefined },
        executeTask: async () => {
          started.resolve();
          await release.promise;
        },
      });
      const taskId = await tasks.submit({ capability: "test_terminal", input: "{}" });
      await started.promise;
      const cancel = tasks.cancel(taskId);
      release.resolve();
      await cancel;
      await tasks.waitForIdle();
      expect(await tasks.getTask(taskId)).toMatchObject({ status: "cancelled", output: null });
    }
  });

  it("stop cancels running work and waits for its abort-aware lifecycle", async () => {
    const persistence = freshStore();
    const started = deferred();
    const aborted = deferred();
    const tasks = createInProcessTasks({
      persistence,
      events: { publish: () => undefined },
      executeTask: async (_task, ctx) => {
        started.resolve();
        await new Promise<void>((resolve) => {
          ctx.signal.addEventListener("abort", () => {
            aborted.resolve();
            resolve();
          }, { once: true });
        });
      },
    });
    const taskId = await tasks.submit({ capability: "test_terminal", input: "{}" });
    await started.promise;

    await tasks.stop();
    await aborted.promise;
    expect(await tasks.getTask(taskId)).toMatchObject({ status: "cancelled" });
  });

  it("stop preserves cancelled state when a late executor ignores abort", async () => {
    const persistence = freshStore();
    const started = deferred();
    const release = deferred();
    const tasks = createInProcessTasks({
      persistence,
      events: { publish: () => undefined },
      executeTask: async () => {
        started.resolve();
        await release.promise;
      },
    });
    const taskId = await tasks.submit({ capability: "test_terminal", input: "{}" });
    await started.promise;

    const stopping = tasks.stop();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await persistence.getTask(taskId))?.status === "cancelled") break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(await persistence.getTask(taskId)).toMatchObject({ status: "cancelled", output: null });
    release.resolve();
    await stopping;
    expect(await persistence.getTask(taskId)).toMatchObject({ status: "cancelled", output: null });
  });
});
