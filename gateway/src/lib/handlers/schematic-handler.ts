import { db } from "../database";
import { StageHandler } from "../stage-handler";
import type { SchematicOutput } from "../stage-types";

export class SchematicHandler extends StageHandler<SchematicOutput> {
  constructor() {
    super("schematic", "Schematic generation failed", null);
  }

  protected async doUpdate(content: SchematicOutput, query: typeof db.query): Promise<void> {
    if (content.error) {
      await query(
        `UPDATE design_drafts SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3`,
        ["failed", content.error, content.designDraftId]
      );
    } else {
      await query(
        `UPDATE design_drafts SET status = $1, svg_content = $2, pin_table = $3, updated_at = NOW() WHERE id = $4`,
        ["ready", content.svgContent, JSON.stringify(content.pinTable), content.designDraftId]
      );
    }
  }

  protected async doSelect(): Promise<Record<string, unknown> | undefined> {
    return undefined;
  }

  protected buildNextPayload(): Record<string, unknown> | null {
    return null;
  }
}
