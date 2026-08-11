// app/src/api/sse.ts — SSE 订阅客户端（ADR-0008；implementation-spec §10.3；ISSUE-003 §5）
// 事件驱动呈现（不轮询）；断线恢复 = 重连 → Query 任务状态（GET /commands/:taskId）→ 续流（无 replay）。
export type SseEventType =
  | "requirement.analysis.started"
  | "requirement.analysis.progress"
  | "requirement.analysis.clarification.requested"
  | "requirement.analysis.completed"
  | "requirement.analysis.failed"
  | "requirement.analysis.cancelled"
  // S5B Revalidate / S7 Build
  | "artifact.revalidating"
  | "artifact.revalidated"
  | "proposal.created"
  | "build.output"
  | "build.succeeded"
  | "build.failed"
  | "build.cancelled"
  | "device.flashing"
  | "device.flashed"
  | "device.flash_failed"
  | "provider.unavailable";

const KNOWN_TYPES: SseEventType[] = [
  "requirement.analysis.started",
  "requirement.analysis.progress",
  "requirement.analysis.clarification.requested",
  "requirement.analysis.completed",
  "requirement.analysis.failed",
  "requirement.analysis.cancelled",
  "artifact.revalidating",
  "artifact.revalidated",
  "proposal.created",
  "build.output",
  "build.succeeded",
  "build.failed",
  "build.cancelled",
  "device.flashing",
  "device.flashed",
  "device.flash_failed",
  "provider.unavailable",
];

export interface SseHandler {
  onEvent: (type: SseEventType, data: unknown) => void;
  onError?: (err: unknown) => void;
}

/** 订阅项目事件流；返回关闭函数（断线自动重连由 EventSource 内建 retry 承担） */
export function subscribeProjectEvents(projectId: string, handler: SseHandler): () => void {
  const es = new EventSource(`/api/v1/projects/${projectId}/events`);
  for (const type of KNOWN_TYPES) {
    es.addEventListener(type, (ev) => {
      try {
        handler.onEvent(type, JSON.parse((ev as MessageEvent).data));
      } catch {
        handler.onEvent(type, (ev as MessageEvent).data);
      }
    });
  }
  es.onerror = (err) => {
    handler.onError?.(err);
    // EventSource 自动重连（默认 ~3s）；M1 无 Last-Event-ID / 无 replay：
    // 重连后由客户端 Query 任务状态恢复（调用方负责）
  };
  return () => es.close();
}
