import { db } from "./database";
import { getChannel, QUEUES } from "./rabbitmq";
import type { DraftStatus } from "./models";

const STAGE_TIMEOUT = 60000;
const STAGE_ORDER = ["analyzing", "recommending", "generating", "finalizing"] as const;

interface PipelineMessage {
  designDraftId: string;
  [key: string]: unknown;
}

function updateStatus(draftId: string, status: DraftStatus, extra: Record<string, unknown> = {}) {
  const fields = ["status = $1"];
  const values: unknown[] = [status];
  let idx = 2;
  for (const [key, val] of Object.entries(extra)) {
    fields.push(`${key} = $${idx}`);
    values.push(val);
    idx++;
  }
  values.push(draftId);
  return db.query(
    `UPDATE design_drafts SET ${fields.join(", ")} WHERE id = $${idx}`,
    values
  );
}

function startStageTimeout(draftId: string, stage: string, _ch: any) {
  return setTimeout(async () => {
    try {
      await updateStatus(draftId, "failed", { error_message: `Stage ${stage} timed out` });
    } catch (e) {
      console.error(`Timeout handler error for ${draftId}:`, e);
    }
  }, STAGE_TIMEOUT);
}

async function handleRequirementOutput(msg: any) {
  const ch = getChannel();
  const content: PipelineMessage = JSON.parse(msg.content.toString());
  const { designDraftId } = content;

  try {
    await updateStatus(designDraftId, "recommending");
    ch.publish("", QUEUES.RECOMMENDATION_INPUT, Buffer.from(JSON.stringify(content)), { persistent: true });
    ch.ack(msg);
  } catch (err) {
    console.error("RequirementOutput handler failed:", err);
    await updateStatus(designDraftId, "failed", { error_message: "Requirement processing failed" });
    ch.ack(msg);
  }
}

async function handleRecommendationOutput(msg: any) {
  const ch = getChannel();
  const content = JSON.parse(msg.content.toString());
  const { designDraftId, componentList } = content;

  try {
    await db.query(
      `UPDATE design_drafts SET status = 'generating', component_list = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(componentList), designDraftId]
    );
    const draft = await db.query(`SELECT requirement, model_config, platform FROM design_drafts WHERE id = $1`, [designDraftId]);
    const row = draft.rows[0];
    const codegenMsg = {
      designDraftId,
      components: Object.values(componentList?.tiers || {}).flat(),
      requirement: row?.requirement || {},
      modelConfig: row?.model_config || {},
      platform: row?.platform || "arduino",
      pinMappings: [],
    };
    ch.publish("", QUEUES.CODEGEN_INPUT, Buffer.from(JSON.stringify(codegenMsg)), { persistent: true });
    ch.ack(msg);
  } catch (err) {
    console.error("RecommendationOutput handler failed:", err);
    await updateStatus(designDraftId, "failed", { error_message: "Recommendation processing failed" });
    ch.ack(msg);
  }
}

async function handleCodegenOutput(msg: any) {
  const ch = getChannel();
  const content = JSON.parse(msg.content.toString());
  const { designDraftId, code, dependencies, pinMappings, validation } = content;

  try {
    await db.query(
      `UPDATE design_drafts SET status = 'finalizing', generated_code = $1, library_deps = $2, pin_mappings = $3, validation = $4, updated_at = NOW() WHERE id = $5`,
      [code, JSON.stringify(dependencies), JSON.stringify(pinMappings), JSON.stringify(validation), designDraftId]
    );
    const draft = await db.query(`SELECT components, platform FROM design_drafts WHERE id = $1`, [designDraftId]);
    const row = draft.rows[0];
    ch.publish("", QUEUES.SCHEMATIC_INPUT, Buffer.from(JSON.stringify({
      designDraftId,
      components: row?.components || [],
      platform: row?.platform || "arduino",
      pinMappings,
    })), { persistent: true });
    ch.ack(msg);
  } catch (err) {
    console.error("CodegenOutput handler failed:", err);
    await updateStatus(designDraftId, "failed", { error_message: "Code generation failed" });
    ch.ack(msg);
  }
}

async function handleSchematicOutput(msg: any) {
  const ch = getChannel();
  const content = JSON.parse(msg.content.toString());
  const { designDraftId, svgContent, pinTable, error } = content;

  try {
    if (error) {
      await updateStatus(designDraftId, "failed", { error_message: error });
      ch.ack(msg);
      return;
    }
    await db.query(
      `UPDATE design_drafts SET status = 'ready', svg_content = $1, pin_table = $2, updated_at = NOW() WHERE id = $3`,
      [svgContent, JSON.stringify(pinTable), designDraftId]
    );
    console.log(`DesignDraft ${designDraftId} completed successfully`);
    ch.ack(msg);
  } catch (err) {
    console.error("SchematicOutput handler failed:", err);
    await updateStatus(designDraftId, "failed", { error_message: "Schematic generation failed" });
    ch.ack(msg);
  }
}

async function handleWebsearchOutput(msg: any) {
  const ch = getChannel();
  const content = JSON.parse(msg.content.toString());
  const { designDraftId, prices } = content;

  try {
    await db.query(
      `UPDATE design_drafts SET price_comparison = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(prices), designDraftId]
    );
    ch.ack(msg);
  } catch (err) {
    console.error("WebsearchOutput handler failed:", err);
    ch.ack(msg);
  }
}

export function startOrchestrator() {
  const ch = getChannel();

  ch.consume(QUEUES.REQUIREMENT_OUTPUT, handleRequirementOutput, { noAck: false });
  ch.consume(QUEUES.RECOMMENDATION_OUTPUT, handleRecommendationOutput, { noAck: false });
  ch.consume(QUEUES.CODEGEN_OUTPUT, handleCodegenOutput, { noAck: false });
  ch.consume(QUEUES.SCHEMATIC_OUTPUT, handleSchematicOutput, { noAck: false });
  ch.consume(QUEUES.WEBSERACH_OUTPUT, handleWebsearchOutput, { noAck: false });

  console.log("Orchestrator started \u2014 consuming all output queues");
}
