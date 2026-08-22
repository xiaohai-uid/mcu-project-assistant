// 回归测试：persisting 包装器必须保留 inner 的完整静态表面。
// 背景：v1 包装器只返回 { publish }，丢掉了 SseEvents 的 subscribe/closeAll，
// 生产运行时 /projects/:id/events 全量 500（production-runtime.test.ts 捕获）。
// 本测试在旧实现上必挂（subscribe 缺失），作为表面保留契约的守卫。
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { createPersistingEvents } from "@/src/adapters/events/persisting";
import { createSseEvents } from "@/src/adapters/events/sse";
import type { EventLogEntry, EventLogPort, EventLogQuery, EventLogSummary } from "@/src/adapters/persistence/sqlite/event-log-store";

function response(): Response {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { write: () => true, end: vi.fn() }) as unknown as Response;
}

function memoryLog(): EventLogPort & { entries: EventLogEntry[] } {
  const entries: EventLogEntry[] = [];
  return {
    entries,
    append(input): void {
      entries.push({
        id: entries.length + 1,
        ts: new Date().toISOString(),
        level: input.level,
        source: input.source,
        type: input.type,
        projectId: input.projectId ?? null,
        correlationId: input.correlationId ?? null,
        data: input.data ?? {},
      });
    },
    list(_query: EventLogQuery): EventLogEntry[] {
      return entries;
    },
    summary(): EventLogSummary {
      return { total: entries.length, windows: [] };
    },
  };
}

describe("persisting events wrapper preserves the inner SSE surface", () => {
  it("forwards subscribe/subscriberCount/closeAll and still fans out published events", () => {
    const sse = createSseEvents();
    const log = memoryLog();
    const events = createPersistingEvents(sse, log);

    // 表面保留：旧实现在这里直接 TypeError
    const res = response();
    expect(() => events.subscribe("p1", res)).not.toThrow();
    expect(events.subscriberCount("p1")).toBe(1);

    // publish 仍扇出到 SSE 订阅者，且写入 event_log
    events.publish({ type: "build.succeeded", projectId: "p1", buildId: "b1", exitCode: 0 });
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]?.type).toBe("build.succeeded");
    expect(res.listenerCount("drain")).toBe(1);

    // closeAll 可用（graceful shutdown 路径）
    expect(() => events.closeAll()).not.toThrow();
    expect(events.subscriberCount("p1")).toBe(0);
  });
});
