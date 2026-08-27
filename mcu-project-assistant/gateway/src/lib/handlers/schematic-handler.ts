import { db } from "@/lib/database";
import { createSnapshot } from "@/lib/snapshot";
import { StageHandler } from "@/lib/stage-handler";
import type { SchematicOutput } from "@/lib/stage-types";

export class SchematicHandler extends StageHandler {
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

      // Create auto-snapshot when pipeline completes
      const userId = (content as Record<string, unknown>).userId as string | undefined;
      if (userId) {
        await createSnapshot(content.designDraftId, userId, { isAuto: true });
      }
    }
  }

  protected async doSelect(): Promise<Record<string, unknown> | undefined> {
    return undefined;
  }

  protected buildNextPayload(): Record<string, unknown> | null {
    return null;
  }
}
