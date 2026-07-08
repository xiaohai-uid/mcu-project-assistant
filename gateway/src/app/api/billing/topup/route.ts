import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/database";

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { amount } = body;

    if (typeof amount !== "number" || amount <= 0) {
      return NextResponse.json(
        { error: "Amount must be a positive number" },
        { status: 400 }
      );
    }

    const result = await db.query(
      `UPDATE memberships SET payg_balance = payg_balance + $1 WHERE user_id = $2 RETURNING payg_balance`,
      [amount, userId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    }

    return NextResponse.json({
      balance: Number(result.rows[0].payg_balance),
      message: "Top up successful",
    });
  } catch (error) {
    console.error("Top up failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
