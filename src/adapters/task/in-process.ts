// adapters/task/in-process.ts — TaskExecutionPort → in-process runner + SQLite tasks 表（ADR-0007；ISSUE-003 §9）
// 本地模式零队列依赖（P-12）；任务持久化（重启先 requeue orphaned running，再由 claimNextTask 原子 claim）。
// 取消 = AbortController → 任务 fn 收到 signal.aborted；终态写回 tasks 表。
import { randomUUID } from "node:crypto";
import type { EventPort, LogicalEvent } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { TaskContext, TaskExecutionPort, TaskRecord } from "@/src/ports/task-execution";
import { serializeTaskError } from "@/src/ports/task-execution";

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
  const terminalizing = new Set<string>();
  let executor = deps.executeTask;
  let stopping = false;

  const isTerminal = (status: TaskRecord["status"]): boolean =>
    status === "completed" || status === "failed" || status === "cancelled";

  async function updateTaskIfStatus(task: TaskRecord, fromStatuses: TaskRecord["status"][]): Promise<boolean> {
    return deps.persistence.withTransaction((uow) => {
      if (uow.updateTaskIfStatus) return uow.updateTaskIfStatus(task, fromStatuses);
      uow.updateTask(task);
      return true;
    });
  }

  async function persistTerminal(task: TaskRecord, status: "completed" | "failed" | "cancelled", error: string | null = null): Promise<{ record: TaskRecord; changed: boolean }> {
    const next = { ...task, status, completedAt: now().toISOString(), error, output: status === "cancelled" ? null : task.output };
    const changed = await updateTaskIfStatus(next, status === "cancelled" ? ["queued", "running"] : ["running"]);
    const persisted = await deps.persistence.getTask(task.id);
    const result = persisted ?? next;
    records.set(task.id, result);
    return { record: result, changed };
  }

  async function executeTask(task: TaskRecord, mode: "new" | "recovery"): Promise<void> {
    const ctrl = new AbortController();
    controllers.set(task.id, ctrl);
    const projectId = (() => {
      try { return (JSON.parse(task.input) as { projectId?: string }).projectId ?? ""; } catch { return ""; }
    })();
    const publish = (event: LogicalEvent): void => {
      const current = records.get(task.id);
      const isCancellationProjection = event.type === "requirement.analysis.cancelled" || event.type === "build.cancelled";
      if (isCancellationProjection && ctrl.signal.aborted && current?.status === "cancelled") {
        deps.events.publish(event);
        return;
      }
      if (ctrl.signal.aborted || terminalizing.has(task.id) || (current && isTerminal(current.status))) return;
      deps.events.publish(event);
    };
    const ctx: TaskContext = {
      taskId: task.id,
      mode,
      signal: ctrl.signal,
      progress: (phase, operation, heartbeat = false) => {
        if (ctrl.signal.aborted || terminalizing.has(task.id)) return;
        publish({
          type: "requirement.analysis.phase",
          taskId: task.id,
          projectId,
          phase,
          operation,
          timestamp: now().toISOString(),
          heartbeat,
        });
      },
      emit: publish,
      setOutput: async (output: string) => {
        const persisted = await deps.persistence.getTask(task.id);
        const current = persisted ?? records.get(task.id) ?? task;
        if (isTerminal(current.status) || ctrl.signal.aborted) return;
        const next = { ...current, output };
        records.set(task.id, next);
        if (persisted) {
          await updateTaskIfStatus(next, ["running"]);
          const afterWrite = await deps.persistence.getTask(task.id);
          if (afterWrite) records.set(task.id, afterWrite);
        }
      },
    };

    try {
      const persisted = await deps.persistence.getTask(task.id);
      const current = persisted ?? records.get(task.id) ?? task;
      if (isTerminal(current.status)) {
        records.set(task.id, current);
        return;
      }
      const running = {
        ...current,
        status: "running" as const,
        startedAt: current.startedAt ?? now().toISOString(),
      };
      records.set(task.id, running);
      if (persisted && current.status !== "running") {
        const changed = await updateTaskIfStatus(running, ["queued"]);
        const afterRunning = await deps.persistence.getTask(task.id);
        if (!changed || !afterRunning || afterRunning.status !== "running") {
          records.set(task.id, afterRunning ?? running);
          return;
        }
        records.set(task.id, afterRunning);
      }
      if (!executor) throw new Error("Task runtime executor is not configured");
      await executor(task, ctx);
      const currentAfterExecution = await deps.persistence.getTask(task.id);
      const afterExecution = currentAfterExecution ?? records.get(task.id) ?? task;
      if (isTerminal(afterExecution.status)) {
        records.set(task.id, afterExecution);
        return;
      }
      await persistTerminal(afterExecution, "completed");
    } catch (err) {
      const currentAfterFailure = await deps.persistence.getTask(task.id) ?? records.get(task.id) ?? task;
      if (isTerminal(currentAfterFailure.status)) {
        records.set(task.id, currentAfterFailure);
        return;
      }
      await persistTerminal(
        currentAfterFailure,
        ctrl.signal.aborted ? "cancelled" : "failed",
        ctrl.signal.aborted ? null : serializeTaskError(err),
      );
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
      const current = await deps.persistence.getTask(taskId) ?? records.get(taskId);
      if (!current || isTerminal(current.status)) return false;
      terminalizing.add(taskId);
      try {
        const result = await persistTerminal(current, "cancelled");
        if (result.changed) ctrl?.abort();
        return result.changed;
      } finally {
        terminalizing.delete(taskId);
      }
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
      await Promise.all([...controllers.keys()].map((taskId) => this.cancel(taskId)));
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
