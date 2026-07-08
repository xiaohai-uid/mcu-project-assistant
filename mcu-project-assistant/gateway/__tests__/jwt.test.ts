import { describe, it, expect, beforeAll } from "vitest";
import { signToken, verifyToken } from "@/lib/jwt";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-key";
});

describe("JWT", () => {
  it("signs and verifies a valid token", async () => {
    const payload = { userId: "abc-123", email: "test@example.com", membership: "free" };
    const token = await signToken(payload);

    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");

    const decoded = await verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.userId).toBe("abc-123");
    expect(decoded!.email).toBe("test@example.com");
    expect(decoded!.membership).toBe("free");
  });

  it("returns null for an invalid token", async () => {
    const result = await verifyToken("invalid-token");
    expect(result).toBeNull();
  });

  it("returns null for a tampered token", async () => {
    const payload = { userId: "abc", email: "a@b.com", membership: "free" };
    const token = await signToken(payload);
    const tampered = token.slice(0, -5) + "XXXXX";
    expect(await verifyToken(tampered)).toBeNull();
  });

  it("includes userId, email, and membership in the payload", async () => {
    const payload = { userId: "u1", email: "u@example.com", membership: "subscription" };
    const token = await signToken(payload);
    const decoded = await verifyToken(token);
    expect(decoded).toHaveProperty("userId");
    expect(decoded).toHaveProperty("email");
    expect(decoded).toHaveProperty("membership");
  });
});
