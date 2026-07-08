import { db } from "../database";
import { QUEUES } from "../rabbitmq";
import { StageHandler } from "../stage-handler";
import { buildSchematicInput } from "../stage-transforms";
import type { CodegenOutput } from "../stage-types";

export class CodegenHandler extends StageHandler {
  constructor() {
    super("codegen", "Code generation failed", QUEUES.SCHEMATIC_INPUT);
  }

  protected async doUpdate(content: CodegenOutput, query: typeof db.query): Promise<void> {
    await query(
      `UPDATE design_drafts SET status = $1, generated_code = $2, library_deps = $3, pin_mappings = $4, validation = $5, updated_at = NOW() WHERE id = $6`,
      [
        "finalizing",
        content.code,
        JSON.stringify(content.dependencies),
        JSON.stringify(content.pinMappings),
        JSON.stringify(content.validation),
        content.designDraftId,
      ]
    );
  }

  protected async doSelect(designDraftId: string): Promise<Record<string, unknown> | undefined> {
    const result = await db.query(`SELECT component_list, platform FROM design_drafts WHERE id = $1`, [designDraftId]);
    return result?.rows?.[0];
  }

  protected buildNextPayload(content: CodegenOutput, row: Record<string, unknown> | undefined): Record<string, unknown> | null {
    return buildSchematicInput(content, row);
  }
}
