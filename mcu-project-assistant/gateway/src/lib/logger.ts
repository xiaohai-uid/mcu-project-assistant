/**
 * Structured logger — replaces console.log/error/warn with JSON-structured output.
 * In development: human-readable. In production: JSON lines for log aggregation.
 */

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  message: string;
  service?: string;
  [key: string]: unknown;
}

const SERVICE_NAME = process.env.SERVICE_NAME || "mcu-gateway";

function formatLog(entry: LogEntry): string {
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    const ts = entry.timestamp.slice(11, 19);
    const meta = Object.entries(entry)
      .filter(([k]) => !["level", "timestamp", "message"].includes(k))
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ");
    return `[${ts}] [${entry.level.toUpperCase()}] ${entry.service}: ${entry.message}${meta ? " " + meta : ""}`;
  }
  return JSON.stringify(entry);
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    service: SERVICE_NAME,
    ...meta,
  };
  if (level === "error") {
    console.error(formatLog(entry));
  } else if (level === "warn") {
    console.warn(formatLog(entry));
  } else {
    console.log(formatLog(entry));
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log("debug", message, meta),
};