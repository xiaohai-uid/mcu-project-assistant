import { NextResponse } from "next/server";
import { db } from "@/lib/database";

export async function POST(req: Request) {
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const current = await db.query(
      "SELECT tier FROM memberships WHERE user_id = $1",
      [userId]
    );

    if (current.rows.length === 0) {
      return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    }

    const currentTier: string = current.rows[0].tier;

    if (currentTier !== "subscription") {
      return NextResponse.json(
        { error: "Only subscription tier can be downgraded to free" },
        { status: 400 }
      );
    }

    const result = await db.query(
      `UPDATE memberships
       SET tier = 'free',
           daily_quota_remaining = 10,
           search_quota_monthly = 0,
           search_quota_used = 0,
           payg_balance = 0,
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId]
    );

    const row = result.rows[0];
    return NextResponse.json({
      userId: row.user_id,
      tier: row.tier,
      dailyQuotaRemaining: row.daily_quota_remaining,
      searchQuotaMonthly: row.search_quota_monthly,
      searchQuotaUsed: row.search_quota_used,
      paygBalance: Number(row.payg_balance),
    });
  } catch (error) {
    console.error("Downgrade failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
