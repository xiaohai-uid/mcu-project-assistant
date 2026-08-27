import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/database";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.query(
      `SELECT payg_balance, tier FROM memberships WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    }

    return NextResponse.json({
      balance: Number(result.rows[0].payg_balance),
      tier: result.rows[0].tier,
    });
  } catch (error) {
    logger.error("Get balance failed", { error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
