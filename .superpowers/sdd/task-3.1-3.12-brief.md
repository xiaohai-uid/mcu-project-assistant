# Tasks 3.1–3.12 — Gateway Pipeline Orchestration

## Acceptance Criteria

### 3.1 — Gateway Publish/Subscribe Routing
Connect to RabbitMQ, declare queues, set up consumers for all output queues.

### 3.2 — Start → Requirement
`POST /api/projects/start` already done (publishes to REQUIREMENT_INPUT). ✓

### 3.3 — Requirement → Recommendation
- Consume REQUIREMENT_OUTPUT
- Update DesignDraft status to "recommending"
- Publish to RECOMMENDATION_INPUT with requirement + modelConfig + membership + platform

### 3.4 — Recommendation → Codegen
- Consume RECOMMENDATION_OUTPUT
- Update status to "generating"
- Publish to CODEGEN_INPUT with components + requirement + pinMappings + modelConfig + platform

### 3.5 — Codegen → Schematic
- Consume CODEGEN_OUTPUT
- Publish to SCHEMATIC_INPUT with components + platform + pinMappings

### 3.6 — Schematic → Finalize
- Consume SCHEMATIC_OUTPUT
- Update DesignDraft status to "ready", save svgContent + pinTable + code

### 3.7 — Error Handling
- DLQ pattern: nack(false, false, false) on unprocessable messages
- Each consumer wrapped in try/catch
- Update DesignDraft status to "failed" with error message stored

### 3.8 — Polling Endpoint
- GET /api/projects/[id] returns full DesignDraft: status, requirement, components, code, svgContent, pinTable, error details

### 3.9 — WebSearch Output
- Consume WEBSERACH_OUTPUT, enrich the DesignDraft with price comparison data
- Store as JSON field on design_drafts

### 3.10 — Per-Stage Timeout
- 60s timeout per stage via setTimeout
- On timeout: mark stage as failed, trigger rollback

### 3.11 — Completion Notification
- On finalization: publish to an internal notification channel (for future webhook/email)

### 3.12 — Rollback
- If any stage fails: update status to "failed", preserve partial results, store error trace

## Files to Create/Modify

### 1. CREATE `gateway/src/lib/orchestrator.ts`

This is the core pipeline orchestrator. It runs as a standalone Node.js consumer that:
- Connects to RabbitMQ (using existing connectRabbitMQ/getChannel)
- Sets up consumers for all 5 output queues (REQUIREMENT_OUTPUT, RECOMMENDATION_OUTPUT, WEBSERACH_OUTPUT, CODEGEN_OUTPUT, SCHEMATIC_OUTPUT)
- Chains each output to the next input
- Handles timeouts (60s per stage), errors, and rollback
- Updates DesignDraft in Postgres at each stage

```typescript
import { db } from "./database";
import { getChannel, QUEUES } from "./rabbitmq";
import type { DraftStatus } from "./models";

const STAGE_TIMEOUT = 60000; // 60s per stage
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

function startStageTimeout(draftId: string, stage: string, ch: any) {
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
    // Get the previous message context from DB for codegen
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

  console.log("Orchestrator started — consuming all output queues");
}
```

### 2. CREATE `gateway/src/run-consumer.ts`

```typescript
import { connectRabbitMQ } from "./lib/rabbitmq";
import { startOrchestrator } from "./lib/orchestrator";

async function main() {
  await connectRabbitMQ();
  startOrchestrator();
  console.log("Consumer running. Press Ctrl+C to exit.");
}

main().catch(console.error);
```

### 3. CREATE `gateway/src/app/api/projects/[id]/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/database";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await db.query(
      `SELECT id, user_id, raw_description, status, requirement, component_list,
              generated_code, svg_content, pin_table, error_message,
              price_comparison, created_at, updated_at
       FROM design_drafts WHERE id = $1`,
      [params.id]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch {
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
  }
}
```

### 4. MODIFY `gateway/package.json` — add consumer script

Add to scripts:
```json
"consumer": "npx tsx src/run-consumer.ts"
```

## Implementation Rules
- Use `tsc` target ES2020
- Follow existing error handling patterns (try/catch → console.error → 500)
- Use `db.query()` as done in all other route handlers
- Import from `@/lib/*` path aliases
- The orchestrator uses `msg.content.toString()` to parse JSON (amqplib Buffer format)
- All consumers acknowledge (ack) even on error to prevent message accumulation

## Validation
- Syntax: `cd mcu-project-assistant/gateway && npx tsc --noEmit --pretty 2>&1`
- TypeScript: must compile without errors
- All files must follow existing code conventions

Return files created/modified and validation result.
