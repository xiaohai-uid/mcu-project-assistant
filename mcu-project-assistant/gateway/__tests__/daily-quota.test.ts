import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

vi.mock("@/lib/database", () => ({
  db: {
    query: vi.fn(),
  },
}));

import { db } from "@/lib/database";
import {
  checkDailyQuota,
  consumeDailyQuota,
  checkSearchQuota,
  consumeSearchQuota,
  consumePaygBalance,
  getQuotaStatus,
} from "@/lib/daily-quota";

type MockRows = { rows: Record<string, unknown>[] };

function mockRows(data: Record<string, unknown>[]): MockRows {
  return { rows: data };
}

beforeAll(() => {
  process.env.DAILY_QUOTA_LIMIT = "10";
  process.env.SEARCH_QUOTA_MONTHLY = "1000";
  process.env.SEARCH_COST = "1.00";
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkDailyQuota", () => {
  it("returns true for hasKey membership without querying db", async () => {
    const result = await checkDailyQuota("user-1", "hasKey");
    expect(result).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("returns true when daily_quota_remaining > 0 and same day", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockRows([{ daily_quota_remaining: 5, daily_quota_reset_at: new Date().toISOString() }])
    );

    const result = await checkDailyQuota("user-1", "free");
    expect(result).toBe(true);
  });

  it("returns false when daily_quota_remaining is 0 and same day", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockRows([{ daily_quota_remaining: 0, daily_quota_reset_at: new Date().toISOString() }])
    );

    const result = await checkDailyQuota("user-1", "free");
    expect(result).toBe(false);
  });

  it("resets quota on new day and returns true", async () => {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        mockRows([{ daily_quota_remaining: 0, daily_quota_reset_at: yesterday.toISOString() }])
      )
      .mockResolvedValueOnce({ rows: [] });

    const result = await checkDailyQuota("user-1", "free");
    expect(result).toBe(true);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query).toHaveBeenLastCalledWith(
      expect.stringContaining("UPDATE memberships"),
      [10, "user-1"]
    );
  });

  it("returns false when user not found", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRows([]));

    const result = await checkDailyQuota("nonexistent", "free");
    expect(result).toBe(false);
  });
});

describe("consumeDailyQuota", () => {
  it("decrements daily_quota_remaining", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    await consumeDailyQuota("user-1");
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE memberships"),
      ["user-1"]
    );
  });
});

describe("checkSearchQuota", () => {
  it("allows subscription user with remaining quota", async () => {
    const today = new Date();
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockRows([{ updated_at: today.toISOString(), search_quota_used: 0 }]))
      .mockResolvedValueOnce(
        mockRows([{ search_quota_monthly: 1000, search_quota_used: 5, payg_balance: "0.00" }])
      );

    const result = await checkSearchQuota("user-1", "subscription");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(995);
  });

  it("rejects subscription user with exhausted quota", async () => {
    const today = new Date();
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockRows([{ updated_at: today.toISOString(), search_quota_used: 1000 }]))
      .mockResolvedValueOnce(
        mockRows([{ search_quota_monthly: 1000, search_quota_used: 1000, payg_balance: "0.00" }])
      );

    const result = await checkSearchQuota("user-1", "subscription");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("allows pay-as-you-go user with positive balance", async () => {
    const today = new Date();
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockRows([{ updated_at: today.toISOString(), search_quota_used: 10 }]))
      .mockResolvedValueOnce(
        mockRows([{ search_quota_monthly: 0, search_quota_used: 10, payg_balance: "50.00" }])
      );

    const result = await checkSearchQuota("user-1", "pay-as-you-go");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(Infinity);
  });

  it("rejects pay-as-you-go user with zero balance", async () => {
    const today = new Date();
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockRows([{ updated_at: today.toISOString(), search_quota_used: 10 }]))
      .mockResolvedValueOnce(
        mockRows([{ search_quota_monthly: 0, search_quota_used: 10, payg_balance: "0.00" }])
      );

    const result = await checkSearchQuota("user-1", "pay-as-you-go");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.reason).toBe("Insufficient balance");
  });

  it("rejects free user", async () => {
    const today = new Date();
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockRows([{ updated_at: today.toISOString(), search_quota_used: 0 }]))
      .mockResolvedValueOnce(
        mockRows([{ search_quota_monthly: 0, search_quota_used: 0, payg_balance: "0.00" }])
      );

    const result = await checkSearchQuota("user-1", "free");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("rejects hasKey user", async () => {
    const today = new Date();
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockRows([{ updated_at: today.toISOString(), search_quota_used: 0 }]))
      .mockResolvedValueOnce(
        mockRows([{ search_quota_monthly: 0, search_quota_used: 0, payg_balance: "0.00" }])
      );

    const result = await checkSearchQuota("user-1", "hasKey");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("resets search_quota_used on month change", async () => {
    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);

    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        mockRows([{ updated_at: lastMonth.toISOString(), search_quota_used: 500 }])
      )
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(
        mockRows([{ search_quota_monthly: 1000, search_quota_used: 0, payg_balance: "0.00" }])
      );

    const result = await checkSearchQuota("user-1", "subscription");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1000);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("SET search_quota_used = 0"),
      ["user-1"]
    );
  });

  it("returns not found when user does not exist", async () => {
    const today = new Date();
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockRows([{ updated_at: today.toISOString(), search_quota_used: 0 }]))
      .mockResolvedValueOnce(mockRows([]));

    const result = await checkSearchQuota("nonexistent", "subscription");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.reason).toBe("User not found");
  });
});

describe("consumeSearchQuota", () => {
  it("increments search_quota_used", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    await consumeSearchQuota("user-1");
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("SET search_quota_used = search_quota_used + 1"),
      ["user-1"]
    );
  });
});

describe("consumePaygBalance", () => {
  it("deducts cost from payg_balance", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rowCount: 1 });

    const result = await consumePaygBalance("user-1");
    expect(result).toBe(true);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("SET payg_balance = payg_balance -"),
      [1.00, "user-1"]
    );
  });

  it("returns false on insufficient balance", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rowCount: 0 });

    const result = await consumePaygBalance("user-1");
    expect(result).toBe(false);
  });

  it("returns false for non-payg tier", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rowCount: 0 });

    const result = await consumePaygBalance("user-1");
    expect(result).toBe(false);
  });

  it("uses default cost when not specified", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rowCount: 1 });

    const result = await consumePaygBalance("user-1");
    expect(result).toBe(true);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("$1"),
      [1.00, "user-1"]
    );
  });
});

describe("getQuotaStatus", () => {
  it("returns quota status for free user", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockRows([{
        tier: "free",
        daily_quota_remaining: 8,
        daily_quota_reset_at: new Date().toISOString(),
        search_quota_monthly: 0,
        search_quota_used: 0,
        payg_balance: "0.00",
        updated_at: new Date(),
      }])
    );

    const status = await getQuotaStatus("user-1");
    expect(status).not.toBeNull();
    expect(status!.dailyRemaining).toBe(8);
    expect(status!.dailyLimit).toBe(10);
    expect(status!.searchRemaining).toBe(0);
    expect(status!.searchMonthly).toBe(0);
    expect(status!.searchUsed).toBe(0);
  });

  it("returns infinite daily quota for hasKey user", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockRows([{
        tier: "hasKey",
        daily_quota_remaining: 10,
        daily_quota_reset_at: new Date().toISOString(),
        search_quota_monthly: 0,
        search_quota_used: 0,
        payg_balance: "0.00",
        updated_at: new Date(),
      }])
    );

    const status = await getQuotaStatus("user-1");
    expect(status!.dailyRemaining).toBe(Infinity);
    expect(status!.dailyLimit).toBe(Infinity);
    expect(status!.searchRemaining).toBe(0);
  });

  it("returns search quota for subscription user", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockRows([{
        tier: "subscription",
        daily_quota_remaining: 10,
        daily_quota_reset_at: new Date().toISOString(),
        search_quota_monthly: 1000,
        search_quota_used: 50,
        payg_balance: "0.00",
        updated_at: new Date(),
      }])
    );

    const status = await getQuotaStatus("user-1");
    expect(status!.searchMonthly).toBe(1000);
    expect(status!.searchUsed).toBe(50);
    expect(status!.searchRemaining).toBe(950);
  });

  it("returns null when user not found", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRows([]));

    const status = await getQuotaStatus("nonexistent");
    expect(status).toBeNull();
  });
});
