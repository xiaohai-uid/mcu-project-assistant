import { describe, expect, it } from "vitest";
import { parseSerializedError, serializeSafeError, toSafeError } from "@/src/shared-contracts/errors";

describe("safe error contract", () => {
  it("fails closed for unknown provider/path errors", () => {
    const raw = "C:\\secret\\internal\\path RAW_PROVIDER_SECRET_MARKER REASONING_MARKER";
    const safe = toSafeError(new Error(raw));
    expect(safe).toEqual({ code: "internal", message: "Internal server error" });
    expect(serializeSafeError(new Error(raw))).not.toContain(raw);
    expect(toSafeError("C:\\secret\\internal\\path")).toEqual({ code: "internal", message: "Internal server error" });
    expect(toSafeError({ reason: raw })).toEqual({ code: "internal", message: "Internal server error" });
  });

  it("keeps stable provider and recovery codes", () => {
    expect(toSafeError({ code: "provider_timeout", message: "RAW_PROVIDER_SECRET_MARKER" })).toEqual({ code: "provider_timeout", message: "AI provider request timed out" });
    expect(toSafeError(new Error("TASK_RECOVERY_UNSAFE_REPLAY: no"))).toEqual({ code: "task_recovery_unsafe_replay", message: "Task cannot be safely replayed after restart" });
  });

  it("round trips structured errors and decodes legacy plain strings", () => {
    const stored = serializeSafeError({ code: "provider_rate_limited", message: "raw" });
    expect(parseSerializedError(stored)).toEqual({ code: "provider_rate_limited", message: "AI provider rate limit or quota exceeded" });
    expect(parseSerializedError("legacy task text")).toEqual({ code: "unknown", message: "legacy task text" });
    expect(parseSerializedError(JSON.stringify({ code: "unknown_future_code", message: "raw internal path" }))).toEqual({ code: "unknown", message: "An earlier task failure was recorded without a stable code" });
  });
});
