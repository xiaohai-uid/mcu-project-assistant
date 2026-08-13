// adapters/http/error.ts — 错误模型（复用旧工程 ApiError/withErrorHandler 模式；implementation-spec §11）
import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import { toSafeError } from "@/src/shared-contracts/errors";

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

export function apiErrorBoundary(): ErrorRequestHandler {
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
      console.error("Unhandled API error", { code: safe.code });
      res.status(500).json({ error: safe });
      return;
    }
    next(err);
  };
}

export function withErrorHandler(
  handler: (req: Request, res: Response) => Promise<unknown> | unknown,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      if (err instanceof ApiError) {
        const safe = toSafeError(err);
        const details = safe.code === "outdated_proposal" && err.details && typeof err.details === "object" ? err.details : undefined;
        res.status(err.status).json({ error: { ...safe, ...(details ? { details } : {}) } });
        return;
      }
      console.error("Unhandled API error", { code: "internal" });
      res.status(500).json({ error: toSafeError(err) });
    });
    void next;
  };
}
