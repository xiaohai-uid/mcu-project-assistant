import { NextResponse } from "next/server";
import { logger } from "./logger";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type RouteHandler<T = unknown> = (
  req: Request,
  context?: T
) => Promise<NextResponse>;

export function withErrorHandler<T = unknown>(
  handler: RouteHandler<T>
): RouteHandler<T> {
  return async (req, context) => {
    try {
      return await handler(req, context);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json(
          { error: err.message, details: err.details },
          { status: err.status }
        );
      }
      logger.error("Unhandled API error", { error: String(err), stack: err instanceof Error ? err.stack : undefined });
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  };
}