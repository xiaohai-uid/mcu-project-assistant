// adapters/events/noop.ts — EventPort 占位实现（ISSUE-002 §9）
// publish 记录到日志；SSE 端点延后 S3A（事件订阅随流式需求引入）。
import type { EventPort, LogicalEvent } from "@/src/ports/events";

export function createNoopEvents(): EventPort {
  return {
    publish(event: LogicalEvent): void {
      console.debug(`[event] ${event.type}`, event);
    },
  };
}
