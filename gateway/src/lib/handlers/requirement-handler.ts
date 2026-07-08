import { db } from "../database";
import { QUEUES } from "../rabbitmq";
import { StageHandler } from "../stage-handler";
import { enrichRequirement } from "../stage-transforms";
import type { RequirementOutput } from "../stage-types";

export class RequirementHandler extends StageHandler<RequirementOutput> {
  constructor() {
    super("requirement", "Requirement processing failed", QUEUES.RECOMMENDATION_INPUT);
  }

  protected async doUpdate(content: RequirementOutput, query: typeof db.query): Promise<void> {
    if (content.requirement) {
      await query(
        `UPDATE design_drafts SET requirement = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(content.requirement), content.designDraftId]
      );
    }
    await query(
      `UPDATE design_drafts SET status = $1, updated_at = NOW() WHERE id = $2`,
      ["recommending", content.designDraftId]
    );
  }

  protected async doSelect(designDraftId: string): Promise<Record<string, unknown> | undefined> {
    const result = await db.query(`SELECT model_config FROM design_drafts WHERE id = $1`, [designDraftId]);
    return result?.rows?.[0];
  }

  protected buildNextPayload(content: RequirementOutput, row: Record<string, unknown> | undefined): Record<string, unknown> | null {
    return enrichRequirement(content, row);
  }
}
