import { NextRequest, NextResponse } from "next/server";
import { ApiError, ErrorCodes } from "@/lib/api-error";

export function withMiddlewareErrorHandler(fn: (req: NextRequest) => Promise<unknown>): (req: NextRequest) => Promise<unknown> {
  return async (req) => {
    try {
      return await fn(req);
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

      console.error("Middleware error:", error);
      return NextResponse.json(
        {
          error: "Internal server error",
          code: ErrorCodes.INTERNAL_ERROR,
        },
        { status: 500 }
      );
    }
  };
}
