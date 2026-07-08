import { describe, it, expect, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/database", () => {
  const query = vi.fn();
  return {
    db: { query },
    withTransaction: async <T>(fn: (client: { query: typeof query }) => Promise<T>) => fn({ query }),
  };
});

import { db } from "@/lib/database";
import { GET as getProfile } from "@/app/api/auth/profile/route";
import { POST as postUpgrade } from "@/app/api/membership/upgrade/route";
import { POST as postDowngrade } from "@/app/api/membership/downgrade/route";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  tier: "free",
  daily_quota_remaining: 10,
  search_quota_monthly: 0,
  search_quota_used: 0,
  payg_balance: "0.00",
};

const mockSubscription = {
  ...mockUser,
  tier: "subscription",
  daily_quota_remaining: 10,
  search_quota_monthly: 1000,
};

function buildRequest(path: string, headers: Record<string, string>, body?: unknown): NextRequest {
  const init = {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  return new NextRequest(`http://localhost:3000${path}`, init);
}

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-key";
});

describe("GET /api/auth/profile", () => {
  it("returns 401 without userId header", async () => {
    const req = buildRequest("/api/auth/profile", {});
    const res = await getProfile(req);
    expect(res.status).toBe(401);
  });

  it("returns user profile with membership info", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [mockUser],
    });

    const req = buildRequest("/api/auth/profile", { "x-user-id": "user-1" });
    const res = await getProfile(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.userId).toBe("user-1");
    expect(data.email).toBe("test@example.com");
    expect(data.membership).toBe("free");
    expect(data.dailyQuotaRemaining).toBe(10);
    expect(data.searchQuotaMonthly).toBe(0);
    expect(data.searchQuotaUsed).toBe(0);
    expect(data.paygBalance).toBe(0);
  });

  it("returns 404 when user not found", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [],
    });

    const req = buildRequest("/api/auth/profile", { "x-user-id": "nonexistent" });
    const res = await getProfile(req);
    expect(res.status).toBe(404);
  });

  it("returns 500 on database error", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("DB down"));

    const req = buildRequest("/api/auth/profile", { "x-user-id": "user-1" });
    const res = await getProfile(req);
    expect(res.status).toBe(500);
  });
});

describe("POST /api/membership/upgrade", () => {
  it("returns 401 without userId header", async () => {
    const req = buildRequest("/api/membership/upgrade", {}, { tier: "subscription" });
    const res = await postUpgrade(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid tier", async () => {
    const req = buildRequest("/api/membership/upgrade", { "x-user-id": "user-1" }, { tier: "invalid" });
    const res = await postUpgrade(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty tier", async () => {
    const req = buildRequest("/api/membership/upgrade", { "x-user-id": "user-1" }, {});
    const res = await postUpgrade(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when upgrading from subscription to non-subscription", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ tier: "subscription" }],
    });

    const req = buildRequest(
      "/api/membership/upgrade",
      { "x-user-id": "user-1" },
      { tier: "pay-as-you-go" }
    );
    const res = await postUpgrade(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("downgrade");
  });

  it("upgrades free to subscription", async () => {
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ tier: "free" }] })
      .mockResolvedValueOnce({
        rows: [{
          user_id: "user-1",
          tier: "subscription",
          daily_quota_remaining: 10,
          search_quota_monthly: 1000,
          search_quota_used: 0,
          payg_balance: "0.00",
        }],
      });

    const req = buildRequest(
      "/api/membership/upgrade",
      { "x-user-id": "user-1" },
      { tier: "subscription" }
    );
    const res = await postUpgrade(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.tier).toBe("subscription");
    expect(data.searchQuotaMonthly).toBe(1000);
  });

  it("upgrades free to pay-as-you-go", async () => {
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ tier: "free" }] })
      .mockResolvedValueOnce({
        rows: [{
          user_id: "user-1",
          tier: "pay-as-you-go",
          daily_quota_remaining: 10,
          search_quota_monthly: 0,
          search_quota_used: 0,
          payg_balance: "0.00",
        }],
      });

    const req = buildRequest(
      "/api/membership/upgrade",
      { "x-user-id": "user-1" },
      { tier: "pay-as-you-go" }
    );
    const res = await postUpgrade(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("pay-as-you-go");
    expect(data.paygBalance).toBe(0);
  });

  it("returns 404 when membership not found", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    const req = buildRequest(
      "/api/membership/upgrade",
      { "x-user-id": "user-1" },
      { tier: "subscription" }
    );
    const res = await postUpgrade(req);
    expect(res.status).toBe(404);
  });

  it("returns 500 on database error", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("DB down"));

    const req = buildRequest(
      "/api/membership/upgrade",
      { "x-user-id": "user-1" },
      { tier: "subscription" }
    );
    const res = await postUpgrade(req);
    expect(res.status).toBe(500);
  });
});

describe("POST /api/membership/downgrade", () => {
  it("returns 401 without userId header", async () => {
    const req = buildRequest("/api/membership/downgrade", {}, {});
    const res = await postDowngrade(req);
    expect(res.status).toBe(401);
  });

  it("downgrades subscription to free", async () => {
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ tier: "subscription" }] })
      .mockResolvedValueOnce({
        rows: [{
          user_id: "user-1",
          tier: "free",
          daily_quota_remaining: 10,
          search_quota_monthly: 0,
          search_quota_used: 0,
          payg_balance: "0.00",
        }],
      });

    const req = buildRequest("/api/membership/downgrade", { "x-user-id": "user-1" });
    const res = await postDowngrade(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("free");
    expect(data.dailyQuotaRemaining).toBe(10);
  });

  it("returns 400 when not on subscription tier", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ tier: "free" }],
    });

    const req = buildRequest("/api/membership/downgrade", { "x-user-id": "user-1" });
    const res = await postDowngrade(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when membership not found", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    const req = buildRequest("/api/membership/downgrade", { "x-user-id": "user-1" });
    const res = await postDowngrade(req);
    expect(res.status).toBe(404);
  });

  it("returns 500 on database error", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("DB down"));

    const req = buildRequest("/api/membership/downgrade", { "x-user-id": "user-1" });
    const res = await postDowngrade(req);
    expect(res.status).toBe(500);
  });
});
