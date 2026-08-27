import { db } from "@/lib/database";

export const STAGE_ORDER = ["requirement", "recommendation", "codegen", "schematic"] as const;
export type Stage = (typeof STAGE_ORDER)[number];

export function getDownstreamStages(fromStage: Stage): Stage[] {
  const index = STAGE_ORDER.indexOf(fromStage);
  if (index === -1) return [];
  return STAGE_ORDER.slice(index + 1);
}

export async function invalidateDownstream(draftId: string, fromStage: Stage): Promise<Stage[]> {
  const downstream = getDownstreamStages(fromStage);
  if (downstream.length === 0) return [];

  await db.query(
    `UPDATE design_drafts
     SET status = 'stale', current_stage = $1, updated_at = NOW()
     WHERE id = $2`,
    [downstream[0], draftId]
  );

  return downstream;
}
