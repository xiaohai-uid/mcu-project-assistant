import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/database";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await db.query(
      `SELECT id, user_id, raw_description, status, requirement, component_list,
              generated_code, svg_content, pin_table, pin_mappings, library_deps,
              validation, validation_warnings, error_message,
              price_comparison, experience_level, created_at, updated_at
       FROM design_drafts WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch {
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
  }
}
