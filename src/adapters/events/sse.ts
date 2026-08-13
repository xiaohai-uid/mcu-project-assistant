// adapters/events/sse.ts — EventPort → SSE 适配器（ADR-0008；implementation-spec §10.3；ISSUE-003 §9）
// GET /projects/:projectId/events：SSE 帧（event: <type>\ndata: <json>\n\n）。
// 断线恢复语义：无 Last-Event-ID / 无 replay → 客户端 Query 任务状态 → 续流（从现在起）。
// M1 禁止：Event Store / persisted stream / replay engine / ring buffer。
import type { Response } from "express";
import type { EventPort, LogicalEvent } from "@/src/ports/events";
import { MAX_PROJECT_SSE_SUBSCRIBERS, ResourceLimitError } from "@/src/shared/resource-limits";

interface Subscriber {
  projectId: string;
  res: Response;
  backpressured: boolean;
  onDrain: () => void;
  onClose: () => void;
}

export interface SseEvents extends EventPort {
  /** 注册项目事件订阅（HTTP SSE 端点调用） */
  subscribe(projectId: string, res: Response): void;
  unsubscribe(res: Response): void;
  subscriberCount(projectId?: string): number;
  closeAll(): void;
}

export function createSseEvents(): SseEvents {
  const subscribers = new Set<Subscriber>();

  function projectIdOf(event: LogicalEvent): string {
    return "projectId" in event && typeof event.projectId === "string" ? event.projectId : "";
  }

  return {
    subscribe(projectId: string, res: Response): void {
      const count = [...subscribers].filter((s) => s.projectId === projectId).length;
      if (count >= MAX_PROJECT_SSE_SUBSCRIBERS) throw new ResourceLimitError("subscriber_limit_reached");
      const onDrain = () => { sub.backpressured = false; };
      const onClose = () => {
        subscribers.delete(sub);
        res.removeListener("drain", onDrain);
      };
      const sub: Subscriber = { projectId, res, backpressured: false, onDrain, onClose };
      subscribers.add(sub);
      res.on("drain", onDrain);
      res.on("close", onClose);
    },
    unsubscribe(res: Response): void {
      for (const sub of subscribers) {
        if (sub.res === res) {
          subscribers.delete(sub);
          sub.res.removeListener("drain", sub.onDrain);
          sub.res.removeListener("close", sub.onClose);
        }
      }
    },
    subscriberCount(projectId?: string): number {
      if (!projectId) return subscribers.size;
      return [...subscribers].filter((s) => s.projectId === projectId).length;
    },
    closeAll(): void {
      for (const sub of [...subscribers]) {
        sub.onClose();
        if (!sub.res.writableEnded) sub.res.end();
      }
    },
    publish(event: LogicalEvent): void {
      const pid = projectIdOf(event);
      for (const sub of subscribers) {
        if (sub.projectId !== pid) continue;
        try {
          if (sub.backpressured) {
            sub.res.end();
            sub.onClose();
            continue;
          }
          sub.backpressured = !sub.res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          } catch {
          // 客户端断开：同步清理订阅及监听器。
          sub.onClose();
        }
      }
    },
  };
}
