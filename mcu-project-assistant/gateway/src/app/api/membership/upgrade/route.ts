import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/lib/database";
import type { Membership } from "@/lib/models";
import { logger } from "@/lib/logger";

const VALID_TIERS: Membership[] = ["subscription", "pay-as-you-go"];

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { tier } = body;

    if (!tier || !VALID_TIERS.includes(tier)) {
      return NextResponse.json(
        { error: "Invalid tier. Must be 'subscription' or 'pay-as-you-go'" },
        { status: 400 }
      );
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

      if (currentTier === "subscription" && tier !== "subscription") {
        return {
          status: 400 as const,
          body: { error: "Cannot downgrade subscription via upgrade endpoint. Use /api/membership/downgrade instead." },
        };
      }

      const updateQuery = tier === "subscription"
        ? `UPDATE memberships SET tier = 'subscription', search_quota_monthly = 1000, updated_at = NOW() WHERE user_id = $1 RETURNING *`
        : `UPDATE memberships SET tier = 'pay-as-you-go', payg_balance = 0, updated_at = NOW() WHERE user_id = $1 RETURNING *`;

      const updateResult = await client.query(updateQuery, [userId]);
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
    logger.error("Upgrade failed", { error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
