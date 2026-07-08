import { db } from "../database";
import { QUEUES } from "../rabbitmq";
import { StageHandler } from "../stage-handler";
import { buildCodegenInput } from "../stage-transforms";
import type { RecommendationOutput } from "../stage-types";

export class RecommendationHandler extends StageHandler<RecommendationOutput> {
  constructor() {
    super("recommendation", "Recommendation processing failed", QUEUES.CODEGEN_INPUT);
  }

  protected async doUpdate(content: RecommendationOutput, query: typeof db.query): Promise<void> {
    await query(
      `UPDATE design_drafts SET status = $1, component_list = $2, updated_at = NOW() WHERE id = $3`,
      ["generating", JSON.stringify(content.componentList), content.designDraftId]
    );
  }

  protected async doSelect(designDraftId: string): Promise<Record<string, unknown> | undefined> {
    const result = await db.query(
      `SELECT requirement, model_config, platform FROM design_drafts WHERE id = $1`,
      [designDraftId]
    );
    return result?.rows?.[0];
  }

  protected buildNextPayload(content: RecommendationOutput, row: Record<string, unknown> | undefined): unknown {
    return buildCodegenInput(content, row);
  }
}
