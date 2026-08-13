import { describe, expect, it } from "vitest";
import { toAppError } from "@/app/src/api/client";

describe("frontend error contract", () => {
  it("preserves code/message/status/details for HTTP and SSE-shaped errors", () => {
    expect(toAppError({ code: "provider_timeout", message: "AI provider request timed out", status: 504, details: { retryable: true } })).toEqual({
      code: "provider_timeout",
      message: "AI provider request timed out",
      status: 504,
      details: { retryable: true },
    });
  });

  it("uses a safe fallback for malformed event data", () => {
    expect(toAppError("RAW_PROVIDER_SECRET_MARKER")).toEqual({ code: "internal", message: "Internal server error" });
  });
});
