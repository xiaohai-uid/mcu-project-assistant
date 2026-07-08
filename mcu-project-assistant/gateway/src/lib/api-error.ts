import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function withErrorHandler(
  handler: (req: NextRequest, ctx?: unknown) => Promise<NextResponse>
): (req: NextRequest, ctx?: unknown) => Promise<NextResponse> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      if (error instanceof ApiError) {
        return NextResponse.json(
          {
            error: error.message,
            code: error.code,
            ...(error.details && { details: error.details }),
          },
          { status: error.status }
        );
      }

      logger.error("Unhandled error", { error });

      const isDev = process.env.NODE_ENV === "development";
      return NextResponse.json(
        {
          error: "Internal server error",
          code: "internal_error",
          ...(isDev && { details: { message: (error as Error).message } }),
        },
        { status: 500 }
      );
    }
  };
}

export const ErrorCodes = {
  BAD_REQUEST: "bad_request",
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  QUOTA_EXCEEDED: "quota_exceeded",
  VALIDATION_ERROR: "validation_error",
  INTERNAL_ERROR: "internal_error",
  SERVICE_UNAVAILABLE: "service_unavailable",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export function badRequest(message: string, details?: Record<string, unknown>): ApiError {
  return new ApiError(message, 400, ErrorCodes.BAD_REQUEST, details);
}

export function unauthorized(message: string): ApiError {
  return new ApiError(message, 401, ErrorCodes.UNAUTHORIZED);
}

export function forbidden(message: string): ApiError {
  return new ApiError(message, 403, ErrorCodes.FORBIDDEN);
}

export function notFound(message: string): ApiError {
  return new ApiError(message, 404, ErrorCodes.NOT_FOUND);
}

export function conflict(message: string): ApiError {
  return new ApiError(message, 409, ErrorCodes.CONFLICT);
}

export function quotaExceeded(message: string): ApiError {
  return new ApiError(message, 429, ErrorCodes.QUOTA_EXCEEDED);
}

export function validationError(message: string, details?: Record<string, unknown>): ApiError {
  return new ApiError(message, 422, ErrorCodes.VALIDATION_ERROR, details);
}

export function serviceUnavailable(message: string): ApiError {
  return new ApiError(message, 503, ErrorCodes.SERVICE_UNAVAILABLE);
}

export function internalError(message: string): ApiError {
  return new ApiError(message, 500, ErrorCodes.INTERNAL_ERROR);
}
