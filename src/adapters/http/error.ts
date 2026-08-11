// adapters/http/error.ts — 错误模型（复用旧工程 ApiError/withErrorHandler 模式；implementation-spec §11）
import type { NextFunction, Request, Response } from "express";

export type ErrorCode =
  | "invalid_name"
  | "invalid_kind"
  | "invalid_content"
  | "invalid_description"
  | "invalid_capability"
  | "invalid_mcu"
  | "invalid_round"
  | "invalid_analysis_state"
  | "provider_unavailable"
  | "outdated_proposal"
  | "invalid_decision"
  | "no_accepted_proposals"
  | "no_hardware_selected"
  | "not_found"
  | "confirmation_missing"
  | "confirmation_invalid"
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

export function withErrorHandler(
  handler: (req: Request, res: Response) => Promise<unknown> | unknown,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      if (err instanceof ApiError) {
        res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
        return;
      }
      console.error("Unhandled API error", err);
      res.status(500).json({ error: { code: "internal", message: "Internal server error" } });
    });
    void next;
  };
}
