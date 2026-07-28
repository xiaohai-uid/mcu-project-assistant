import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { pinTable, svgContent } = await _req.json();

    if (!pinTable || typeof pinTable !== "object") {
      return NextResponse.json({ error: "pinTable is required" }, { status: 400 });
    }

    const existing = await db.query("SELECT id FROM design_drafts WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const updates: string[] = ["pin_table = $1", "updated_at = NOW()"];
    const values: unknown[] = [JSON.stringify(pinTable)];
    let paramIdx = 2;

    if (svgContent) {
      updates.push(`svg_content = $${paramIdx++}`);
      values.push(svgContent);
    }

    values.push(id);
    await db.query(
      `UPDATE design_drafts SET ${updates.join(", ")} WHERE id = $${paramIdx}`,
      values
    );

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update pins" }, { status: 500 });
  }
}
