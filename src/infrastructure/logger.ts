// infrastructure/logger.ts — 结构化 JSON-lines 日志（stdout；平台 log drain 可直接采集）
// 边界：只写标量字段与显式传入的 data 对象；绝不接收 headers/body/凭据。level 由 MCU_LOG_LEVEL 控制（默认 info）。
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  return value;
}

function sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    out[key] = serializeValue(value);
  }
  return out;
}

export function createLogger(minLevel: LogLevel = "info", base: Record<string, unknown> = {}): Logger {
  function write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...base,
      ...(data ? sanitizeData(data) : {}),
    });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
  return {
    debug: (message, data) => write("debug", message, data),
    info: (message, data) => write("info", message, data),
    warn: (message, data) => write("warn", message, data),
    error: (message, data) => write("error", message, data),
  };
}
