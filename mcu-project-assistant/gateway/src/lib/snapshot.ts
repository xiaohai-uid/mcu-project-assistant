import { db } from "@/lib/database";
import { v4 as uuidv4 } from "uuid";

export interface SnapshotInfo {
  id: string;
  designDraftId: string;
  name: string | null;
  isAuto: boolean;
  createdAt: string;
}

export async function createSnapshot(
  draftId: string,
  userId: string,
  options?: { name?: string; isAuto?: boolean }
): Promise<SnapshotInfo> {
  const draft = await db.query(
    "SELECT title, raw_description, status, current_stage, experience_level, membership_tier FROM design_drafts WHERE id = $1 AND user_id = $2",
    [draftId, userId]
  );
  if (draft.rows.length === 0) throw new Error("Design draft not found");

  const row = draft.rows[0];
  const snapshotData = {
    title: row.title,
    rawDescription: row.raw_description,
    status: row.status,
    currentStage: row.current_stage,
    experienceLevel: row.experience_level,
    membershipTier: row.membership_tier,
  };

  const name = options?.name;
  const isAuto = options?.isAuto ?? true;

  let finalName = name;
  if (isAuto && !finalName) {
    const count = await db.query(
      "SELECT COUNT(*) as cnt FROM project_snapshots WHERE design_draft_id = $1 AND is_auto = true",
      [draftId]
    );
    finalName = `自动快照 #${(parseInt(count.rows[0].cnt) || 0) + 1}`;
  }

  const snapId = uuidv4();
  const result = await db.query(
    `INSERT INTO project_snapshots (id, design_draft_id, name, is_auto, snapshot_data, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id, created_at`,
    [snapId, draftId, finalName, isAuto, JSON.stringify(snapshotData)]
  );

  return {
    id: result.rows[0].id,
    designDraftId: draftId,
    name: finalName,
    isAuto,
    createdAt: result.rows[0].created_at,
  };
}

export async function listSnapshots(draftId: string, userId: string): Promise<SnapshotInfo[]> {
  const owner = await db.query(
    "SELECT id FROM design_drafts WHERE id = $1 AND user_id = $2",
    [draftId, userId]
  );
  if (owner.rows.length === 0) throw new Error("Design draft not found");

  const result = await db.query(
    `SELECT id, design_draft_id, name, is_auto, created_at
     FROM project_snapshots WHERE design_draft_id = $1
     ORDER BY created_at DESC`,
    [draftId]
  );

  return result.rows.map((r: any) => ({
    id: r.id,
    designDraftId: r.design_draft_id,
    name: r.name,
    isAuto: r.is_auto,
    createdAt: r.created_at,
  }));
}

export async function restoreSnapshot(snapshotId: string, userId: string): Promise<{ draftId: string; name: string | null }> {
  const snap = await db.query(
    `SELECT ps.id, ps.design_draft_id, ps.snapshot_data, ps.name
     FROM project_snapshots ps
     JOIN design_drafts dd ON ps.design_draft_id = dd.id
     WHERE ps.id = $1 AND dd.user_id = $2`,
    [snapshotId, userId]
  );
  if (snap.rows.length === 0) throw new Error("Snapshot not found");

  const { design_draft_id, snapshot_data, name } = snap.rows[0];
  const data = typeof snapshot_data === "string" ? JSON.parse(snapshot_data) : snapshot_data;

  await db.query(
    `UPDATE design_drafts
     SET title = $1, raw_description = $2, status = $3, current_stage = $4,
         experience_level = $5, updated_at = NOW()
     WHERE id = $6`,
    [
      data.title,
      data.rawDescription,
      data.status || "analyzing",
      data.currentStage || "requirement",
      data.experienceLevel,
      design_draft_id,
    ]
  );

  return { draftId: design_draft_id, name };
}
