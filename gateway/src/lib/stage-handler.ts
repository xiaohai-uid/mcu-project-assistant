import { db, withTransaction } from "./database";
import { getChannel } from "./rabbitmq";
import { logger } from "./logger";
import type { PipelineMessage } from "./stage-types";

export abstract class StageHandler<TContent extends PipelineMessage = PipelineMessage> {
  constructor(
    readonly stageName: string,
    readonly errorMessage: string,
    readonly nextQueue: string | null
  ) {}

  async handle(msg: any): Promise<void> {
    const ch = getChannel();
    const content: TContent = JSON.parse(msg.content.toString());
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
      logger.error(this.errorMessage, { stage: this.stageName, designDraftId, error: String(err) });
      try {
        await db.query(
          `UPDATE design_drafts SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3`,
          ["failed", this.errorMessage, designDraftId]
        );
      } catch {}
      ch.ack(msg);
    }
  }

  protected abstract doUpdate(
    content: TContent,
    query: typeof db.query
  ): Promise<void>;

  protected abstract doSelect(designDraftId: string): Promise<Record<string, unknown> | undefined>;

  protected abstract buildNextPayload(content: TContent, row: Record<string, unknown> | undefined): unknown;
}
