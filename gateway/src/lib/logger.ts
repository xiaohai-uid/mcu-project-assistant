/**
 * Structured JSON logger — replaces console.log/error/warn across the gateway.
 * Outputs NDJSON (one JSON object per line) suitable for log aggregation.
 * In development (NODE_ENV !== 'production'), also prints human-readable format.
 */

type Level = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

const IS_PROD = process.env.NODE_ENV === "production";

function emit(level: Level, msg: string, ctx?: LogContext) {
  const entry: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    msg,
    ...ctx,
  };

  if (IS_PROD) {
    // Production: pure JSON for log aggregators
    const line = JSON.stringify(entry);
    if (level === "error") process.stderr.write(line + "\n");
    else process.stdout.write(line + "\n");
  } else {
    // Development: human-readable with color hints
    const prefix = { debug: "DBG", info: "INF", warn: "WRN", error: "ERR" }[level];
    const ts = entry.time as string;
    const extra = ctx ? " " + JSON.stringify(ctx) : "";
    const line = `[${ts}] ${prefix} ${msg}${extra}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: LogContext) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit("error", msg, ctx),

  /** Create a child logger with bound context (e.g. requestId, service) */
  child(bindings: LogContext) {
    return {
      debug: (msg: string, ctx?: LogContext) => emit("debug", msg, { ...bindings, ...ctx }),
      info: (msg: string, ctx?: LogContext) => emit("info", msg, { ...bindings, ...ctx }),
      warn: (msg: string, ctx?: LogContext) => emit("warn", msg, { ...bindings, ...ctx }),
      error: (msg: string, ctx?: LogContext) => emit("error", msg, { ...bindings, ...ctx }),
    };
  },
};
