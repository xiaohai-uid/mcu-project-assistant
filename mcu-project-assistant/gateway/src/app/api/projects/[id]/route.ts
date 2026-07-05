import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/database";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const result = await db.query(
    `SELECT d.id, d.title, d.status, d.current_stage, d.experience_level,
            d.created_at, d.updated_at,
            s.id as snapshot_id, s.snapshot_data
     FROM design_drafts d
     LEFT JOIN project_snapshots s ON s.design_draft_id = d.id AND s.is_auto = true
     WHERE d.id = $1
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [id]
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json(result.rows[0]);
}
