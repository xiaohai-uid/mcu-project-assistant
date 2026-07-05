import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { signToken } from "@/lib/jwt";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-key";
});

describe("middleware", () => {
  it("allows requests to unprotected paths", () => {
    const req = new NextRequest("http://localhost:3000/api/auth/login");
    const res = middleware(req);
    expect(res.status).toBe(200);
  });

  it("rejects requests to protected paths without Authorization header", () => {
    const req = new NextRequest("http://localhost:3000/api/projects/123");
    const res = middleware(req);
    expect(res.status).toBe(401);
  });

  it("rejects requests to protected paths with invalid token", () => {
    const req = new NextRequest("http://localhost:3000/api/projects/123", {
      headers: { authorization: "Bearer invalid-token-here" },
    });
    const res = middleware(req);
    expect(res.status).toBe(401);
  });

  it("allows requests to protected paths with valid token", () => {
    const payload = { userId: "u1", email: "a@b.com", membership: "free" };
    const token = signToken(payload);
    const req = new NextRequest("http://localhost:3000/api/projects/123", {
      headers: { authorization: `Bearer ${token}` },
    });
    const res = middleware(req);
    expect(res.status).toBe(200);
  });
});
