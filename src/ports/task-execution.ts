// ports/task-execution.ts — TaskExecutionPort（ADR-0007；ISSUE-003 §3/§9）
// 本地模式不得依赖任何队列服务（P-12）。Local Adapter = in-process runner + SQLite 任务表（崩溃恢复）；
// Cloud Adapter = 队列后端（未来）。任务可取消、可持久化、可发布进度事件（经 EventPort）。
// 禁止通用 CommandBus/Registry 框架（/commands 只是 HTTP 收口）。

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface TaskRecord {
  id: string;
  capability: string;
  input: string;
  status: TaskStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface TaskContext {
  taskId: string;
  /** 取消信号：cancel() 后 abort；任务实现应周期性检查并终止 */
  signal: AbortSignal;
  /** 任务内发布逻辑事件（经 EventPort；进度/终态） */
  emit: (event: import("@/src/ports/events").LogicalEvent) => void;
}

export interface TaskExecutionPort {
  /** 提交任务（persist queued → in-process 执行）；返回 taskId */
  submit(input: { capability: string; input: string }, fn: (ctx: TaskContext) => Promise<void>): Promise<string>;
  /** 取消：仅 running 可取消；返回是否成功取消 */
  cancel(taskId: string): Promise<boolean>;
  getTask(taskId: string): Promise<TaskRecord | null>;
}
