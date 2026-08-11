// adapters/task/in-process.ts — TaskExecutionPort → in-process runner + SQLite tasks 表（ADR-0007；ISSUE-003 §9）
// 本地模式零队列依赖（P-12）；任务持久化（崩溃恢复：running 无执行者 → 重启后由 claimNextTask 重新 claim）。
// 取消 = AbortController → 任务 fn 收到 signal.aborted；终态写回 tasks 表。
import { randomUUID } from "node:crypto";
import type { EventPort, LogicalEvent } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { TaskContext, TaskExecutionPort, TaskRecord } from "@/src/ports/task-execution";

export interface InProcessTaskDeps {
  persistence: PersistencePort;
  events: EventPort;
  now?: () => Date;
}

export function createInProcessTasks(deps: InProcessTaskDeps): TaskExecutionPort {
  const now = deps.now ?? (() => new Date());
  const controllers = new Map<string, AbortController>();

  return {
    async submit(input, fn): Promise<string> {
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
      await deps.persistence.withTransaction((uow) => uow.saveTask(record));

      const ctrl = new AbortController();
      controllers.set(taskId, ctrl);
      const ctx: TaskContext = {
        taskId,
        signal: ctrl.signal,
        emit: (event: LogicalEvent) => deps.events.publish(event),
        setOutput: async (output: string) => {
          const t = await deps.persistence.getTask(taskId);
          if (t) {
            await deps.persistence.withTransaction((uow) => uow.updateTask({ ...t, output }));
          }
        },
      };

      // in-process 异步执行（不阻塞请求返回 202）
      void (async () => {
        await deps.persistence.withTransaction((uow) =>
          uow.updateTask({ ...record, status: "running", startedAt: now().toISOString() }),
        );
        try {
          await fn(ctx);
          // 终态写回用当前行（保留任务内 setOutput 的结果；勿用 submit 时的 stale record）
          const current = await deps.persistence.getTask(taskId);
          await deps.persistence.withTransaction((uow) =>
            uow.updateTask({
              ...(current ?? record),
              status: "completed",
              completedAt: now().toISOString(),
            }),
          );
        } catch (err) {
          const cancelled = ctrl.signal.aborted;
          const current = await deps.persistence.getTask(taskId);
          await deps.persistence.withTransaction((uow) =>
            uow.updateTask({
              ...(current ?? record),
              status: cancelled ? "cancelled" : "failed",
              completedAt: now().toISOString(),
              error: cancelled ? null : err instanceof Error ? err.message : String(err),
            }),
          );
        } finally {
          controllers.delete(taskId);
        }
      })();

      return taskId;
    },

    async cancel(taskId: string): Promise<boolean> {
      const ctrl = controllers.get(taskId);
      if (!ctrl) return false;
      ctrl.abort();
      return true;
    },

    async getTask(id: string): Promise<TaskRecord | null> {
      return deps.persistence.getTask(id);
    },
  };
}
