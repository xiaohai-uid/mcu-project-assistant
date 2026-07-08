import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/database";

export async function POST(req: Request) {
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await withTransaction(async (client) => {
      const current = await client.query(
        "SELECT tier FROM memberships WHERE user_id = $1",
        [userId]
      );

      if (current.rows.length === 0) {
        return { status: 404 as const, body: { error: "Membership not found" } };
      }

      const currentTier: string = current.rows[0].tier;

      if (currentTier !== "subscription") {
        return {
          status: 400 as const,
          body: { error: "Only subscription tier can be downgraded to free" },
        };
      }

      const updateResult = await client.query(
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

      const row = updateResult.rows[0];
      return {
        status: 200 as const,
        body: {
          userId: row.user_id,
          tier: row.tier,
          dailyQuotaRemaining: row.daily_quota_remaining,
          searchQuotaMonthly: row.search_quota_monthly,
          searchQuotaUsed: row.search_quota_used,
          paygBalance: Number(row.payg_balance),
        },
      };
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Downgrade failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
