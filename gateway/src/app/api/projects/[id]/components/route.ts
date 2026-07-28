import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { components } = await _req.json();

    const existing = await db.query("SELECT component_list FROM design_drafts WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const existingList = existing.rows[0].component_list
      ? (typeof existing.rows[0].component_list === "string" ? JSON.parse(existing.rows[0].component_list) : existing.rows[0].component_list)
      : {};

    existingList.customComponents = components;

    await db.query(
      "UPDATE design_drafts SET component_list = $1, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(existingList), id]
    );

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update components" }, { status: 500 });
  }
}
