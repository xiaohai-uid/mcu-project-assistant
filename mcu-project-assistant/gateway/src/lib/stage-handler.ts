import { db, withTransaction } from "@/lib/database";
import { getChannel } from "@/lib/rabbitmq";
import { logger } from "@/lib/logger";
import type { PipelineMessage } from "@/lib/stage-types";

export abstract class StageHandler {
  constructor(
    readonly stageName: string,
    readonly errorMessage: string,
    readonly nextQueue: string | null
  ) {}

  async handle(msg: any): Promise<void> {
    const ch = getChannel();
    const content: PipelineMessage = JSON.parse(msg.content.toString());
    const { designDraftId } = content;

    try {
      const row = await withTransaction(async (client) => {
        await this.doUpdate(content, client.query.bind(client));
        const row = await this.doSelect(designDraftId);
        return row;
      });

      const nextPayload = this.buildNextPayload(content, row);

      if (nextPayload && this.nextQueue) {
        ch.publish("", this.nextQueue, Buffer.from(JSON.stringify(nextPayload)), { persistent: true });
      }

      ch.ack(msg);
    } catch (err) {
      logger.error(`${this.errorMessage}`, { error: err });
      try {
        await db.query(
          `UPDATE design_drafts SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3`,
          ["failed", this.errorMessage, designDraftId]
        );
      } catch (dbErr) {
        logger.error("Failed to mark design draft as failed", { error: dbErr });
      }
      ch.ack(msg);
    }
  }

  protected abstract doUpdate(
    content: PipelineMessage,
    query: typeof db.query
  ): Promise<void>;

  protected abstract doSelect(designDraftId: string): Promise<Record<string, unknown> | undefined>;
  protected abstract buildNextPayload(content: PipelineMessage, row: Record<string, unknown> | undefined): Record<string, unknown> | null;
}
