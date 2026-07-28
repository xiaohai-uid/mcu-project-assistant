import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { generatedCode } = await _req.json();

    if (!generatedCode || typeof generatedCode !== "string") {
      return NextResponse.json({ error: "generatedCode is required" }, { status: 400 });
    }

    const existing = await db.query("SELECT id, status FROM design_drafts WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    await db.query(
      `UPDATE design_drafts SET generated_code = $1, status = 'ready', updated_at = NOW() WHERE id = $2`,
      [generatedCode, id]
    );

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update code" }, { status: 500 });
  }
}
