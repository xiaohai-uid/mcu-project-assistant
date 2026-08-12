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
  /** 任务结果（S3B：分析输出 capabilities JSON，供 requirements 聚合提交） */
  output: string | null;
}

export interface TaskContext {
  taskId: string;
  /** Whether this invocation was scheduled from a fresh submission or restart recovery. */
  mode?: "new" | "recovery";
  /** 取消信号：cancel() 后 abort；任务实现应周期性检查并终止 */
  signal: AbortSignal;
  /** 任务内发布逻辑事件（经 EventPort；进度/终态） */
  emit: (event: import("@/src/ports/events").LogicalEvent) => void;
  /** 任务结果暂存（tasks.output；如分析 capabilities，供下游聚合提交） */
  setOutput: (output: string) => Promise<void>;
}

export interface TaskExecutionPort {
  /** 提交持久化任务；normal/recovery 均由同一 persisted-task executor 执行。 */
  submit(input: { capability: string; input: string }): Promise<string>;
  /** 取消 queued/running task；返回是否赢得取消 */
  cancel(taskId: string): Promise<boolean>;
  getTask(taskId: string): Promise<TaskRecord | null>;
}
