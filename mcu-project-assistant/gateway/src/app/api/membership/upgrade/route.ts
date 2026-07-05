import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/database";
import type { Membership } from "@/lib/models";

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

    const current = await db.query(
      "SELECT tier FROM memberships WHERE user_id = $1",
      [userId]
    );

    if (current.rows.length === 0) {
      return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    }

    const currentTier: string = current.rows[0].tier;

    if (currentTier === "subscription" && tier !== "subscription") {
      return NextResponse.json(
        { error: "Cannot downgrade subscription via upgrade endpoint. Use /api/membership/downgrade instead." },
        { status: 400 }
      );
    }

    let updateQuery: string;
    let updateParams: unknown[];

    if (tier === "subscription") {
      updateQuery = `UPDATE memberships
        SET tier = 'subscription', search_quota_monthly = 1000, updated_at = NOW()
        WHERE user_id = $1 RETURNING *`;
      updateParams = [userId];
    } else {
      updateQuery = `UPDATE memberships
        SET tier = 'pay-as-you-go', payg_balance = 0, updated_at = NOW()
        WHERE user_id = $1 RETURNING *`;
      updateParams = [userId];
    }

    const result = await db.query(updateQuery, updateParams);

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
    console.error("Upgrade failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
