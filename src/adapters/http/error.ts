// adapters/http/error.ts — 错误模型（复用旧工程 ApiError/withErrorHandler 模式；implementation-spec §11）
import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import { toSafeError } from "@/src/shared-contracts/errors";
import type { Logger } from "@/src/infrastructure/logger";
import type { EventLogPort } from "@/src/adapters/persistence/sqlite/event-log-store";

export type ErrorCode =
  | "invalid_name"
  | "invalid_kind"
  | "invalid_content"
  | "invalid_description"
  | "payload_too_large"
  | "input_too_large"
  | "serial_write_too_large"
  | "subscriber_limit_reached"
  | "resource_capacity_exceeded"
  | "untrusted_origin"
  | "untrusted_host"
  | "invalid_idempotency_key"
  | "idempotency_conflict"
  | "invalid_capability"
  | "unknown_capability"
  | "capability_forbidden"
  | "invalid_mcu"
  | "invalid_round"
  | "invalid_analysis_state"
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_protocol_error"
  | "outdated_proposal"
  | "invalid_decision"
  | "no_accepted_proposals"
  | "no_hardware_selected"
  | "no_pin_map"
  | "no_stale"
  | "blocking_stale"
  | "toolchain_unavailable"
  | "build_failed"
  | "build_timeout"
  | "build_output_missing"
  | "unsupported_build_target"
  | "invalid_build_source"
  | "invalid_build_state"
  | "build_not_failed"
  | "not_found"
  | "confirmation_missing"
  | "confirmation_invalid"
  | "confirmation_expired"
  | "token_reused"
  | "device_mismatch"
  | "device_disconnected"
  | "device_busy"
  | "physical_flash_blocked"
  | "flash_build_not_verified"
  | "flash_firmware_missing"
  | "flash_firmware_hash_mismatch"
  | "physical_device_not_found"
  | "physical_device_ambiguous"
  | "physical_device_changed"
  | "physical_tool_unavailable"
  | "flash_timeout"
  | "physical_flash_failed"
  | "serial_session_not_open"
  | "serial_session_not_found"
  | "serial_device_not_found"
  | "serial_device_changed"
  | "serial_transport_error"
  | "serial_line_too_large"
  | "already_archived"
  | "archived_read_only"
  | "database_integrity_failed"
  | "unsupported_database_schema"
  | "database_schema_incomplete"
  | "artifact_content_missing"
  | "artifact_content_hash_mismatch"
  | "artifact_content_unreadable"
  | "persisted_record_corrupt"
  | "idempotency_record_corrupt"
  | "production_state_in_use"
  | "server_draining"
  | "forbidden"
  | "rate_limited"
  | "internal";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 错误处理的可选观测出口：结构化日志 + event_log 持久化（诊断切片）。 */
export interface HttpErrorObservers {
  logger?: Logger;
  eventLog?: EventLogPort;
}

export function apiErrorBoundary(observers?: HttpErrorObservers): ErrorRequestHandler {
  return (err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const record = typeof err === "object" && err !== null ? (err as Record<string, unknown>) : null;
    if (record?.type === "entity.too.large" || record?.status === 413) {
      res.status(413).json({ error: { code: "payload_too_large", message: "Request body exceeds the supported size" } });
      return;
    }
    if (record?.type === "entity.parse.failed") {
      res.status(400).json({ error: { code: "invalid_json", message: "Request body contains invalid JSON" } });
      return;
    }
    if (req.path.startsWith("/api/")) {
      const safe = toSafeError(err);
      const requestId = res.getHeader("x-request-id");
      observers?.logger?.error("Unhandled API error", { code: safe.code, path: req.path, method: req.method, requestId });
      observers?.eventLog?.append({
        level: "error",
        source: "server",
        type: "api.error",
        correlationId: typeof requestId === "string" ? requestId : null,
        data: { code: safe.code, path: req.path, method: req.method },
      });
      res.status(500).json({ error: safe });
      return;
    }
    next(err);
  };
}

export function withErrorHandler(
  handler: (req: Request, res: Response) => Promise<unknown> | unknown,
  observers?: HttpErrorObservers,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      const respond = (status: number, payload: Record<string, unknown>): void => {
        res.status(status).json(payload);
      };
      if (err instanceof ApiError) {
        const safe = toSafeError(err);
        const details = safe.code === "outdated_proposal" && err.details && typeof err.details === "object" ? err.details : undefined;
        if (err.status >= 500) {
          const requestId = res.getHeader("x-request-id");
          observers?.logger?.warn("API error response", { code: safe.code, status: err.status, path: req.path, method: req.method, requestId });
          observers?.eventLog?.append({
            level: "warn",
            source: "server",
            type: "api.error",
            correlationId: typeof requestId === "string" ? requestId : null,
            data: { code: safe.code, status: err.status, path: req.path, method: req.method },
          });
        }
        respond(err.status, { error: { ...safe, ...(details ? { details } : {}) } });
        return;
      }
      const safe = toSafeError(err);
      const requestId = res.getHeader("x-request-id");
      observers?.logger?.error("Unhandled API error", { code: safe.code, path: req.path, method: req.method, requestId });
      observers?.eventLog?.append({
        level: "error",
        source: "server",
        type: "api.error",
        correlationId: typeof requestId === "string" ? requestId : null,
        data: { code: safe.code, path: req.path, method: req.method },
      });
      respond(500, { error: safe });
    });
    void next;
  };
}
