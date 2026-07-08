import { NextResponse } from "next/server";
import { db } from "@/lib/database";

export async function GET() {
  try {
    const result = await db.query(
      "SELECT id, raw_description, status, created_at, updated_at FROM design_drafts ORDER BY updated_at DESC LIMIT 50"
    );
    return NextResponse.json(result.rows);
  } catch {
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}
