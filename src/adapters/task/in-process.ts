// adapters/task/in-process.ts — TaskExecutionPort → in-process runner + SQLite tasks 表（ADR-0007；ISSUE-003 §9）
// 本地模式零队列依赖（P-12）；任务持久化（重启先 requeue orphaned running，再由 claimNextTask 原子 claim）。
// 取消 = AbortController → 任务 fn 收到 signal.aborted；终态写回 tasks 表。
import { randomUUID } from "node:crypto";
import type { EventPort, LogicalEvent } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { TaskContext, TaskExecutionPort, TaskRecord } from "@/src/ports/task-execution";

export interface InProcessTaskDeps {
  persistence: PersistencePort;
  events: EventPort;
  now?: () => Date;
  /** Single persisted-task executor shared by new and recovered tasks. */
  executeTask?: (task: TaskRecord, ctx: TaskContext) => Promise<void>;
}

export interface RecoveryResult {
  recovered: number;
  failed: number;
}

export interface InProcessTaskRuntime extends TaskExecutionPort {
  /** Drain all queued/orphaned-running tasks before accepting new work. */
  recover(): Promise<RecoveryResult>;
  /** Abort active work and wait for its lifecycle writes to settle. */
  stop(): Promise<void>;
  /** Wait until currently scheduled executions reach terminal persistence. */
  waitForIdle(): Promise<void>;
  /** Wait for one scheduled task and return its terminal record. */
  waitForTask(taskId: string): Promise<TaskRecord | null>;
  /** Configure the application dispatcher before the runtime accepts work. */
  setExecutor(executor: (task: TaskRecord, ctx: TaskContext) => Promise<void>): void;
}

export function createInProcessTasks(deps: InProcessTaskDeps): InProcessTaskRuntime {
  const now = deps.now ?? (() => new Date());
  const controllers = new Map<string, AbortController>();
  const active = new Map<string, Promise<void>>();
  // The process-local mirror keeps the runtime observable when a test double or
  // an adapter cannot read the just-written task back immediately. SQLite
  // remains the durable source of truth whenever it is available.
  const records = new Map<string, TaskRecord>();
  let executor = deps.executeTask;
  let stopping = false;

  async function executeTask(task: TaskRecord, mode: "new" | "recovery"): Promise<void> {
    const ctrl = new AbortController();
    controllers.set(task.id, ctrl);
    const ctx: TaskContext = {
      taskId: task.id,
      mode,
      signal: ctrl.signal,
      emit: (event: LogicalEvent) => deps.events.publish(event),
      setOutput: async (output: string) => {
        const current = await deps.persistence.getTask(task.id);
        const next = { ...(current ?? records.get(task.id) ?? task), output };
        records.set(task.id, next);
        if (current) await deps.persistence.withTransaction((uow) => uow.updateTask(next));
      },
    };

    try {
      const current = await deps.persistence.getTask(task.id);
      const running = {
        ...(current ?? records.get(task.id) ?? task),
        status: "running" as const,
        startedAt: current?.startedAt ?? records.get(task.id)?.startedAt ?? now().toISOString(),
      };
      records.set(task.id, running);
      if (current && current.status !== "running") {
        await deps.persistence.withTransaction((uow) => uow.updateTask(running));
      }
      if (!executor) throw new Error("Task runtime executor is not configured");
      await executor(task, ctx);
      const currentAfterExecution = await deps.persistence.getTask(task.id);
      const completed = {
        ...(currentAfterExecution ?? records.get(task.id) ?? task),
        status: "completed" as const,
        completedAt: now().toISOString(),
      };
      records.set(task.id, completed);
      if (currentAfterExecution) await deps.persistence.withTransaction((uow) => uow.updateTask(completed));
    } catch (err) {
      const currentAfterFailure = await deps.persistence.getTask(task.id);
      const failed = {
        ...(currentAfterFailure ?? records.get(task.id) ?? task),
        status: (ctrl.signal.aborted ? "cancelled" : "failed") as "cancelled" | "failed",
        completedAt: now().toISOString(),
        error: ctrl.signal.aborted ? null : err instanceof Error ? err.message : String(err),
      };
      records.set(task.id, failed);
      if (currentAfterFailure) await deps.persistence.withTransaction((uow) => uow.updateTask(failed));
    } finally {
      controllers.delete(task.id);
    }
  }

  function launch(task: TaskRecord, mode: "new" | "recovery"): Promise<void> {
    records.set(task.id, task);
    const execution = executeTask(task, mode);
    active.set(task.id, execution);
    void execution.then(
      () => active.delete(task.id),
      () => active.delete(task.id),
    );
    return execution;
  }

  return {
    async submit(input): Promise<string> {
      if (stopping) throw new Error("Task runtime is stopping");
      const taskId = randomUUID();
      const record: TaskRecord = {
        id: taskId,
        capability: input.capability,
        input: input.input,
        status: "queued",
        createdAt: now().toISOString(),
        startedAt: null,
        completedAt: null,
        error: null,
        output: null,
      };
      records.set(taskId, record);
      await deps.persistence.withTransaction((uow) => uow.saveTask(record));

      // in-process 异步执行（不阻塞请求返回 202）
      launch(record, "new");

      return taskId;
    },

    async cancel(taskId: string): Promise<boolean> {
      const ctrl = controllers.get(taskId);
      if (!ctrl) return false;
      ctrl.abort();
      return true;
    },

    async getTask(id: string): Promise<TaskRecord | null> {
      return (await deps.persistence.getTask(id)) ?? records.get(id) ?? null;
    },

    async recover(): Promise<RecoveryResult> {
      stopping = false;
      await deps.persistence.withTransaction((uow) => uow.requeueOrphanedTasks?.());
      let recovered = 0;
      for (;;) {
        if (stopping) break;
        const task = await deps.persistence.withTransaction((uow) => uow.claimNextTask());
        if (!task) break;
        launch(task, "recovery");
        recovered += 1;
      }
      return { recovered, failed: 0 };
    },

    setExecutor(nextExecutor): void {
      if (active.size > 0) throw new Error("Cannot replace task executor while tasks are active");
      executor = nextExecutor;
    },

    async stop(): Promise<void> {
      stopping = true;
      for (const ctrl of controllers.values()) ctrl.abort();
      await this.waitForIdle();
    },

    async waitForIdle(): Promise<void> {
      while (active.size > 0) {
        await Promise.all([...active.values()]);
      }
    },

    async waitForTask(taskId: string): Promise<TaskRecord | null> {
      const execution = active.get(taskId);
      if (execution) await execution;
      return (await deps.persistence.getTask(taskId)) ?? records.get(taskId) ?? null;
    },
  };
}
