import { db } from "./database";

const DAILY_LIMIT = parseInt(process.env.DAILY_QUOTA_LIMIT || "10", 10);

export async function checkDailyQuota(userId: string): Promise<boolean> {
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
