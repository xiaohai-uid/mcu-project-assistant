import { db } from "./database";
import type { Membership } from "./models";

const DAILY_LIMIT = parseInt(process.env.DAILY_QUOTA_LIMIT || "10", 10);
const SEARCH_MONTHLY_LIMIT = parseInt(process.env.SEARCH_QUOTA_MONTHLY || "1000", 10);
const SEARCH_COST = parseFloat(process.env.SEARCH_COST || "1.00");

export interface QuotaStatus {
  dailyRemaining: number;
  dailyLimit: number;
  searchRemaining: number;
  searchMonthly: number;
  searchUsed: number;
  monthlyResetDate: string;
}

export interface SearchQuotaResult {
  allowed: boolean;
  remaining: number;
  reason?: string;
}

async function resetSearchQuotaIfNeeded(userId: string): Promise<void> {
  const result = await db.query(
    `SELECT updated_at, search_quota_used FROM memberships WHERE user_id = $1`,
    [userId]
  );
  if (result.rows.length === 0) return;

  const updatedAt = new Date(result.rows[0].updated_at);
  const now = new Date();

  const isNewMonth =
    now.getUTCMonth() !== updatedAt.getUTCMonth() ||
    now.getUTCFullYear() !== updatedAt.getUTCFullYear();

  if (isNewMonth) {
    await db.query(
      `UPDATE memberships SET search_quota_used = 0, updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );
  }
}

export async function checkDailyQuota(userId: string, membership?: Membership): Promise<boolean> {
  if (membership === "hasKey") return true;

  const result = await db.query(
    `SELECT daily_quota_remaining, daily_quota_reset_at
     FROM memberships WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) return false;

  const { daily_quota_remaining, daily_quota_reset_at } = result.rows[0];
  const now = new Date();
  const resetAt = new Date(daily_quota_reset_at);

  const isNewDay =
    now.getUTCDate() !== resetAt.getUTCDate() ||
    now.getUTCMonth() !== resetAt.getUTCMonth() ||
    now.getUTCFullYear() !== resetAt.getUTCFullYear();

  if (isNewDay) {
    await db.query(
      `UPDATE memberships
       SET daily_quota_remaining = $1, daily_quota_reset_at = NOW()
       WHERE user_id = $2`,
      [DAILY_LIMIT, userId]
    );
    return true;
  }

  return daily_quota_remaining > 0;
}

export async function consumeDailyQuota(userId: string): Promise<void> {
  await db.query(
    `UPDATE memberships
     SET daily_quota_remaining = daily_quota_remaining - 1
     WHERE user_id = $1 AND daily_quota_remaining > 0`,
    [userId]
  );
}

export async function checkSearchQuota(
  userId: string,
  membership: Membership
): Promise<SearchQuotaResult> {
  await resetSearchQuotaIfNeeded(userId);

  const result = await db.query(
    `SELECT search_quota_monthly, search_quota_used, payg_balance
     FROM memberships WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return { allowed: false, remaining: 0, reason: "User not found" };
  }

  const { search_quota_monthly, search_quota_used, payg_balance } = result.rows[0];

  if (membership === "free" || membership === "hasKey") {
    return { allowed: false, remaining: 0, reason: "Search not available on current plan" };
  }

  if (membership === "subscription") {
    const limit = search_quota_monthly || SEARCH_MONTHLY_LIMIT;
    const remaining = Math.max(0, limit - search_quota_used);
    return { allowed: remaining > 0, remaining };
  }

  if (membership === "pay-as-you-go") {
    const balance = parseFloat(payg_balance) || 0;
    return { allowed: balance > 0, remaining: balance > 0 ? Infinity : 0, reason: balance > 0 ? undefined : "Insufficient balance" };
  }

  return { allowed: false, remaining: 0, reason: "Invalid membership tier" };
}

export async function consumeSearchQuota(userId: string): Promise<void> {
  await db.query(
    `UPDATE memberships
     SET search_quota_used = search_quota_used + 1, updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
}

export async function consumePaygBalance(userId: string, cost: number = SEARCH_COST): Promise<boolean> {
  const result = await db.query(
    `UPDATE memberships
     SET payg_balance = payg_balance - $1, updated_at = NOW()
     WHERE user_id = $2 AND tier = 'pay-as-you-go' AND payg_balance >= $1`,
    [cost, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getQuotaStatus(userId: string): Promise<QuotaStatus | null> {
  const result = await db.query(
    `SELECT tier, daily_quota_remaining, daily_quota_reset_at,
            search_quota_monthly, search_quota_used, payg_balance, updated_at
     FROM memberships WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const now = new Date();
  const resetAt = new Date(row.daily_quota_reset_at);

  const isNewDay =
    now.getUTCDate() !== resetAt.getUTCDate() ||
    now.getUTCMonth() !== resetAt.getUTCMonth() ||
    now.getUTCFullYear() !== resetAt.getUTCFullYear();

  const dailyLimit = row.tier === "hasKey" ? Infinity : DAILY_LIMIT;
  const dailyRemaining = isNewDay ? dailyLimit : (row.tier === "hasKey" ? Infinity : row.daily_quota_remaining);

  let searchMonthly: number;
  let searchUsed: number;
  let searchRemaining: number;

  if (row.tier === "free" || row.tier === "hasKey") {
    searchMonthly = 0;
    searchUsed = 0;
    searchRemaining = 0;
  } else if (row.tier === "subscription") {
    searchMonthly = row.search_quota_monthly || SEARCH_MONTHLY_LIMIT;
    searchUsed = row.search_quota_used;

    const updatedAt = new Date(row.updated_at);
    const isNewMonth =
      now.getUTCMonth() !== updatedAt.getUTCMonth() ||
      now.getUTCFullYear() !== updatedAt.getUTCFullYear();
    searchUsed = isNewMonth ? 0 : searchUsed;
    searchRemaining = Math.max(0, searchMonthly - searchUsed);
  } else {
    searchMonthly = 0;
    searchUsed = row.search_quota_used;
    searchRemaining = parseFloat(row.payg_balance) > 0 ? Infinity : 0;
  }

  return {
    dailyRemaining,
    dailyLimit,
    searchRemaining,
    searchMonthly,
    searchUsed,
    monthlyResetDate: row.updated_at?.toISOString?.() ?? new Date(row.updated_at).toISOString(),
  };
}
