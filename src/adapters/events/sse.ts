// adapters/events/sse.ts — EventPort → SSE 适配器（ADR-0008；implementation-spec §10.3；ISSUE-003 §9）
// GET /projects/:projectId/events：SSE 帧（event: <type>\ndata: <json>\n\n）。
// 断线恢复语义：无 Last-Event-ID / 无 replay → 客户端 Query 任务状态 → 续流（从现在起）。
// M1 禁止：Event Store / persisted stream / replay engine / ring buffer。
import type { Response } from "express";
import type { EventPort, LogicalEvent } from "@/src/ports/events";

interface Subscriber {
  projectId: string;
  res: Response;
}

export interface SseEvents extends EventPort {
  /** 注册项目事件订阅（HTTP SSE 端点调用） */
  subscribe(projectId: string, res: Response): void;
  unsubscribe(res: Response): void;
  subscriberCount(projectId?: string): number;
}

export function createSseEvents(): SseEvents {
  const subscribers = new Set<Subscriber>();

  function projectIdOf(event: LogicalEvent): string {
    return "projectId" in event ? event.projectId : "";
  }

  return {
    subscribe(projectId: string, res: Response): void {
      const sub: Subscriber = { projectId, res };
      subscribers.add(sub);
      res.on("close", () => {
        subscribers.delete(sub);
      });
    },
    unsubscribe(res: Response): void {
      for (const sub of subscribers) {
        if (sub.res === res) subscribers.delete(sub);
      }
    },
    subscriberCount(projectId?: string): number {
      if (!projectId) return subscribers.size;
      return [...subscribers].filter((s) => s.projectId === projectId).length;
    },
    publish(event: LogicalEvent): void {
      const pid = projectIdOf(event);
      for (const sub of subscribers) {
        if (sub.projectId !== pid) continue;
        try {
          sub.res.write(`event: ${event.type}\n`);
          sub.res.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch {
          // 客户端断开：清理由 res.on('close') 负责
          subscribers.delete(sub);
        }
      }
    },
  };
}
