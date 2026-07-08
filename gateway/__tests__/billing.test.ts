import { describe, it, expect, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/database", () => ({
  db: {
    query: vi.fn(),
  },
}));

import { db } from "@/lib/database";
import { POST as postTopup } from "@/app/api/billing/topup/route";
import { GET as getBalance } from "@/app/api/billing/balance/route";

function buildRequest(path: string, headers: Record<string, string>, body?: unknown): NextRequest {
  const init = {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  return new NextRequest(`http://localhost:3000${path}`, init);
}

describe("POST /api/billing/topup", () => {
  it("returns 401 without userId header", async () => {
    const req = buildRequest("/api/billing/topup", {}, { amount: 10 });
    const res = await postTopup(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid amount", async () => {
    const req = buildRequest("/api/billing/topup", { "x-user-id": "user-1" }, { amount: 0 });
    const res = await postTopup(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("positive");
  });

  it("returns 400 for negative amount", async () => {
    const req = buildRequest("/api/billing/topup", { "x-user-id": "user-1" }, { amount: -5 });
    const res = await postTopup(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-numeric amount", async () => {
    const req = buildRequest("/api/billing/topup", { "x-user-id": "user-1" }, { amount: "ten" });
    const res = await postTopup(req);
    expect(res.status).toBe(400);
  });

  it("adds amount to payg_balance and returns new balance", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ payg_balance: "25.00" }],
    });

    const req = buildRequest("/api/billing/topup", { "x-user-id": "user-1" }, { amount: 25 });
    const res = await postTopup(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.balance).toBe(25);
    expect(data.message).toBe("Top up successful");
  });

  it("returns 404 when membership not found", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    const req = buildRequest("/api/billing/topup", { "x-user-id": "nonexistent" }, { amount: 10 });
    const res = await postTopup(req);
    expect(res.status).toBe(404);
  });

  it("returns 500 on database error", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("DB down"));

    const req = buildRequest("/api/billing/topup", { "x-user-id": "user-1" }, { amount: 10 });
    const res = await postTopup(req);
    expect(res.status).toBe(500);
  });
});

describe("GET /api/billing/balance", () => {
  it("returns 401 without userId header", async () => {
    const req = buildRequest("/api/billing/balance", {});
    const res = await getBalance(req);
    expect(res.status).toBe(401);
  });

  it("returns balance and tier", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ payg_balance: "50.00", tier: "pay-as-you-go" }],
    });

    const req = buildRequest("/api/billing/balance", { "x-user-id": "user-1" });
    const res = await getBalance(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.balance).toBe(50);
    expect(data.tier).toBe("pay-as-you-go");
  });

  it("returns 404 for unknown user", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    const req = buildRequest("/api/billing/balance", { "x-user-id": "nonexistent" });
    const res = await getBalance(req);
    expect(res.status).toBe(404);
  });

  it("returns 500 on database error", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("DB down"));

    const req = buildRequest("/api/billing/balance", { "x-user-id": "user-1" });
    const res = await getBalance(req);
    expect(res.status).toBe(500);
  });
});
