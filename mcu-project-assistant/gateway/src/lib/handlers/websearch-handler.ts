import { db } from "../database";
import { StageHandler } from "../stage-handler";
import type { WebsearchOutput } from "../stage-types";

export class WebsearchHandler extends StageHandler {
  constructor() {
    super("websearch", "Websearch processing failed", null);
  }

  protected async doUpdate(content: WebsearchOutput, query: typeof db.query): Promise<void> {
    await query(
      `UPDATE design_drafts SET price_comparison = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(content.prices), content.designDraftId]
    );
  }

  protected async doSelect(): Promise<Record<string, unknown> | undefined> {
    return undefined;
  }

  protected buildNextPayload(): Record<string, unknown> | null {
    return null;
  }
}
