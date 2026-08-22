// adapters/events/persisting.ts — EventPort 组合适配器：先持久化到 event_log（飞轮底座），再委托 inner（SSE 扇出）。
// 数据飞轮第一阶段=完整采集既有 LogicalEvent；分析/反哺属后续迭代。失败类事件记 error，取消记 warn，其余 info。
import type { EventPort, LogicalEvent } from "@/src/ports/events";
import type { EventLogLevel, EventLogPort } from "@/src/adapters/persistence/sqlite/event-log-store";

function levelOf(event: LogicalEvent): EventLogLevel {
  if (event.type.endsWith(".failed") || event.type === "provider.unavailable") return "error";
  if (event.type.endsWith(".cancelled")) return "warn";
  return "info";
}

/** 从事件中挑出可持久化的标量字段；排除 chunk 等高频/大字段。 */
function payloadOf(event: LogicalEvent): Record<string, unknown> {
  const rest = event as LogicalEvent & Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    const t = typeof value;
    if (t === "string" || t === "number" || t === "boolean") {
      out[key] = t === "string" && (value as string).length > 500 ? (value as string).slice(0, 500) : value;
    } else if (t === "object" && value !== null && !Array.isArray(value)) {
      // capabilities / truth 等结构化对象：保留但交给 store 的 JSON 上限兜底
      out[key] = value;
    }
  }
  return out;
}

// 返回 inner 的完整静态表面（SseEvents 的 subscribe/unsubscribe/subscriberCount/closeAll），
// 只覆写 publish。HTTP 层对 deps.events 的 SseEvents 断言依赖这里保留表面——
// 丢掉 subscribe 会让生产运行时每个 /projects/:id/events 请求 500（回归已实测）。
// 展开复制安全性：sse.ts 等实现全部闭包绑定、不用 this，拷贝方法语义不变。
export function createPersistingEvents<T extends EventPort>(inner: T, log: EventLogPort): T {
  const wrapper = {
    ...inner,
    publish(event: LogicalEvent): void {
      try {
        log.append({
          level: levelOf(event),
          source: "server",
          type: event.type,
          projectId: "projectId" in event && typeof event.projectId === "string" ? event.projectId : null,
          data: payloadOf(event),
        });
      } catch {
        // 持久化失败不阻断业务事件流
      }
      inner.publish(event);
    },
  };
  return wrapper as T;
}
