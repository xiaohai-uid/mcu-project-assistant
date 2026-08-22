// adapters/persistence/sqlite/event-log-store.ts — 诊断与飞轮事件持久化（migration v14）
// 追加只写；行数上限裁剪防免费持久盘膨胀。绝不存密钥类字段（调用方负责脱敏，这里再做一层 JSON 大小上限）。
import { randomUUID } from "node:crypto";
import type { SqliteDb } from "./connection";

export type EventLogLevel = "info" | "warn" | "error";
export type EventLogSource = "server" | "client";

export interface EventLogEntry {
  id: number;
  ts: string;
  level: EventLogLevel;
  source: EventLogSource;
  type: string;
  projectId: string | null;
  correlationId: string | null;
  data: Record<string, unknown>;
}

export interface EventLogQuery {
  level?: EventLogLevel;
  source?: EventLogSource;
  type?: string;
  projectId?: string;
  limit?: number;
}

export interface EventLogSummaryWindow {
  window: "24h" | "7d";
  byLevel: Record<string, number>;
  byType: Array<{ type: string; count: number }>;
}

export interface EventLogSummary {
  total: number;
  windows: EventLogSummaryWindow[];
}

export const EVENT_LOG_MAX_ROWS = 20_000;
// 单条上限需容纳 message 2k + stack 16k 的完整错误载荷
export const EVENT_LOG_MAX_DATA_JSON_LENGTH = 20_000;

export interface EventLogPort {
  append(input: {
    level: EventLogLevel;
    source: EventLogSource;
    type: string;
    projectId?: string | null;
    correlationId?: string | null;
    data?: Record<string, unknown>;
  }): void;
  list(query: EventLogQuery): EventLogEntry[];
  summary(): EventLogSummary;
}

function sanitizeData(data: Record<string, unknown> | undefined): string {
  if (!data || typeof data !== "object") return "{}";
  let json: string;
  try {
    json = JSON.stringify(data);
  } catch {
    return '{"sanitize":"unserializable"}';
  }
  if (json.length > EVENT_LOG_MAX_DATA_JSON_LENGTH) {
    return JSON.stringify({ sanitize: "truncated", originalLength: json.length });
  }
  return json;
}

function parseData(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function createEventLogStore(db: SqliteDb): EventLogPort {
  const insert = db.prepare(
    `INSERT INTO event_log (ts, level, source, type, project_id, correlation_id, data)
     VALUES (@ts, @level, @source, @type, @project_id, @correlation_id, @data)`,
  );
  const countAll = db.prepare("SELECT COUNT(*) AS n FROM event_log");
  const deleteOldest = db.prepare(
    `DELETE FROM event_log WHERE id IN (
       SELECT id FROM event_log ORDER BY id DESC LIMIT -1 OFFSET @keep
     )`,
  );
  const selectQuery = db.prepare(
    `SELECT id, ts, level, source, type, project_id, correlation_id, data FROM event_log
     WHERE (@level IS NULL OR level = @level)
       AND (@source IS NULL OR source = @source)
       AND (@type IS NULL OR type = @type)
       AND (@project_id IS NULL OR project_id = @project_id)
     ORDER BY id DESC LIMIT @limit`,
  );
  const countByLevel = db.prepare(
    "SELECT level, COUNT(*) AS n FROM event_log WHERE ts >= @since GROUP BY level",
  );
  const countByType = db.prepare(
    "SELECT type, COUNT(*) AS n FROM event_log WHERE ts >= @since GROUP BY type ORDER BY n DESC LIMIT 25",
  );
  const countTotal = db.prepare("SELECT COUNT(*) AS n FROM event_log");

  let insertsSincePrune = 0;

  return {
    append(input) {
      insert.run({
        ts: new Date().toISOString(),
        level: input.level,
        source: input.source,
        type: input.type,
        project_id: input.projectId ?? null,
        correlation_id: input.correlationId ?? null,
        data: sanitizeData(input.data),
      });
      insertsSincePrune += 1;
      if (insertsSincePrune >= 500) {
        insertsSincePrune = 0;
        const total = (countAll.get() as { n: number }).n;
        if (total > EVENT_LOG_MAX_ROWS) {
          deleteOldest.run({ keep: EVENT_LOG_MAX_ROWS });
        }
      }
    },
    list(query) {
      const limit = Math.max(1, Math.min(query.limit ?? 200, 1000));
      const rows = selectQuery.all({
        level: query.level ?? null,
        source: query.source ?? null,
        type: query.type ?? null,
        project_id: query.projectId ?? null,
        limit,
      }) as Array<{
        id: number;
        ts: string;
        level: string;
        source: string;
        type: string;
        project_id: string | null;
        correlation_id: string | null;
        data: string;
      }>;
      return rows.map((row) => ({
        id: row.id,
        ts: row.ts,
        level: row.level as EventLogLevel,
        source: row.source as EventLogSource,
        type: row.type,
        projectId: row.project_id,
        correlationId: row.correlation_id,
        data: parseData(row.data),
      }));
    },
    summary() {
      const now = Date.now();
      const windows: EventLogSummaryWindow[] = [
        { window: "24h" as const, since: new Date(now - 24 * 60 * 60 * 1000).toISOString() },
        { window: "7d" as const, since: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString() },
      ].map(({ window, since }) => ({
        window,
        byLevel: Object.fromEntries((countByLevel.all({ since }) as Array<{ level: string; n: number }>).map((r) => [r.level, r.n])),
        byType: (countByType.all({ since }) as Array<{ type: string; n: number }>).map((r) => ({ type: r.type, count: r.n })),
      }));
      return { total: (countTotal.get() as { n: number }).n, windows };
    },
  };
}

/** 供无 DB 场景（单测/工具）使用的内存实现，行为与 SQLite 版一致。 */
export function createMemoryEventLog(cap = EVENT_LOG_MAX_ROWS): EventLogPort {
  const entries: EventLogEntry[] = [];
  let nextId = 1;
  return {
    append(input) {
      entries.push({
        id: nextId++,
        ts: new Date().toISOString(),
        level: input.level,
        source: input.source,
        type: input.type,
        projectId: input.projectId ?? null,
        correlationId: input.correlationId ?? null,
        data: JSON.parse(sanitizeData(input.data)) as Record<string, unknown>,
      });
      if (entries.length > cap) entries.splice(0, entries.length - cap);
    },
    list(query) {
      const limit = Math.max(1, Math.min(query.limit ?? 200, 1000));
      return [...entries]
        .reverse()
        .filter((e) => (!query.level || e.level === query.level)
          && (!query.source || e.source === query.source)
          && (!query.type || e.type === query.type)
          && (!query.projectId || e.projectId === query.projectId))
        .slice(0, limit);
    },
    summary() {
      const now = Date.now();
      const windows: EventLogSummaryWindow[] = [24, 168].map((hours) => {
        const since = now - hours * 60 * 60 * 1000;
        const inWindow = entries.filter((e) => new Date(e.ts).getTime() >= since);
        const byLevel: Record<string, number> = {};
        const byTypeMap = new Map<string, number>();
        for (const e of inWindow) {
          byLevel[e.level] = (byLevel[e.level] ?? 0) + 1;
          byTypeMap.set(e.type, (byTypeMap.get(e.type) ?? 0) + 1);
        }
        return {
          window: hours === 24 ? ("24h" as const) : ("7d" as const),
          byLevel,
          byType: [...byTypeMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([type, count]) => ({ type, count })),
        };
      });
      return { total: entries.length, windows };
    },
  };
}

export function newCorrelationId(): string {
  return randomUUID();
}
