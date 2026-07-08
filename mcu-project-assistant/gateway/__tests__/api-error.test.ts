import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ApiError,
  withErrorHandler,
  ErrorCodes,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  quotaExceeded,
  validationError,
  serviceUnavailable,
  internalError,
} from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";

function mockReq(): NextRequest {
  return new NextRequest("http://localhost/api/test");
}

function mockHandler(): Promise<NextResponse> {
  return Promise.resolve(NextResponse.json({ ok: true }));
}

describe("ApiError", () => {
  it("sets name and message", () => {
    const err = new ApiError("test error", 400, ErrorCodes.BAD_REQUEST);
    expect(err.name).toBe("ApiError");
    expect(err.message).toBe("test error");
    expect(err.status).toBe(400);
    expect(err.code).toBe(ErrorCodes.BAD_REQUEST);
  });

  it("accepts optional details", () => {
    const err = new ApiError("error", 422, ErrorCodes.VALIDATION_ERROR, { field: "email" });
    expect(err.details).toEqual({ field: "email" });
  });
});

describe("helper functions", () => {
  it("badRequest returns 400 error", () => {
    const err = badRequest("bad input");
    expect(err.status).toBe(400);
    expect(err.code).toBe(ErrorCodes.BAD_REQUEST);
  });

  it("unauthorized returns 401 error", () => {
    const err = unauthorized("not logged in");
    expect(err.status).toBe(401);
    expect(err.code).toBe(ErrorCodes.UNAUTHORIZED);
  });

  it("forbidden returns 403 error", () => {
    const err = forbidden("no access");
    expect(err.status).toBe(403);
    expect(err.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it("notFound returns 404 error", () => {
    const err = notFound("missing");
    expect(err.status).toBe(404);
    expect(err.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it("conflict returns 409 error", () => {
    const err = conflict("duplicate");
    expect(err.status).toBe(409);
    expect(err.code).toBe(ErrorCodes.CONFLICT);
  });

  it("quotaExceeded returns 429 error", () => {
    const err = quotaExceeded("limit reached");
    expect(err.status).toBe(429);
    expect(err.code).toBe(ErrorCodes.QUOTA_EXCEEDED);
  });

  it("validationError returns 422 error", () => {
    const err = validationError("invalid", { field: "email" });
    expect(err.status).toBe(422);
    expect(err.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(err.details).toEqual({ field: "email" });
  });

  it("serviceUnavailable returns 503 error", () => {
    const err = serviceUnavailable("down");
    expect(err.status).toBe(503);
    expect(err.code).toBe(ErrorCodes.SERVICE_UNAVAILABLE);
  });

  it("internalError returns 500 error", () => {
    const err = internalError("boom");
    expect(err.status).toBe(500);
    expect(err.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });
});

describe("withErrorHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns handler response for success", async () => {
    const handler = withErrorHandler(mockHandler);
    const res = await handler(mockReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns ApiError response for ApiError", async () => {
    const handler = withErrorHandler(() => {
      throw new ApiError("bad", 400, ErrorCodes.BAD_REQUEST);
    });
    const res = await handler(mockReq());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad", code: ErrorCodes.BAD_REQUEST });
  });

  it("includes details in ApiError response", async () => {
    const handler = withErrorHandler(() => {
      throw new ApiError("bad", 422, ErrorCodes.VALIDATION_ERROR, { field: "email" });
    });
    const res = await handler(mockReq());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "bad",
      code: ErrorCodes.VALIDATION_ERROR,
      details: { field: "email" },
    });
  });

  it("returns 500 for unknown errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withErrorHandler(() => {
      throw new Error("something broke");
    });
    const res = await handler(mockReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
    expect(body.code).toBe("internal_error");
    expect(consoleSpy).toHaveBeenCalled();
  });
});
