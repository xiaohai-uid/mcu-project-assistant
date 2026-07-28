import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { designDraftId, name, snapshotData } = await req.json();

    await db.query(
      `INSERT INTO project_snapshots (id, design_draft_id, name, is_auto, snapshot_data)
       VALUES ($1, $2, $3, false, $4)`,
      [uuidv4(), designDraftId, name || null, JSON.stringify(snapshotData)]
    );

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to create snapshot" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const designDraftId = searchParams.get("designDraftId");

  const result = await db.query(
    `SELECT id, name, is_auto, created_at
     FROM project_snapshots
     WHERE design_draft_id = $1
     ORDER BY created_at DESC`,
    [designDraftId]
  );

  return NextResponse.json(result.rows);
}
