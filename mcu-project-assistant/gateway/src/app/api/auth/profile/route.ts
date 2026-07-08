import { NextResponse } from "next/server";
import { db } from "@/lib/database";
import { logger } from "@/lib/logger";

export async function GET(req: Request) {
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.query(
      `SELECT u.id, u.email, m.tier, m.daily_quota_remaining,
              m.search_quota_monthly, m.search_quota_used, m.payg_balance
       FROM users u
       JOIN memberships m ON m.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const row = result.rows[0];
    return NextResponse.json({
      userId: row.id,
      email: row.email,
      membership: row.tier,
      dailyQuotaRemaining: row.daily_quota_remaining,
      searchQuotaMonthly: row.search_quota_monthly,
      searchQuotaUsed: row.search_quota_used,
      paygBalance: Number(row.payg_balance),
    });
  } catch (error) {
    logger.error("Profile fetch failed", { error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
