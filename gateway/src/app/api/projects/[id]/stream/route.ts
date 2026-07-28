import { NextRequest } from "next/server";
import { db } from "@/lib/database";

export const dynamic = "force-dynamic";

/**
 * SSE endpoint: GET /api/projects/[id]/stream
 * Pushes stage completion events to the client in real-time.
 * Events: { stage, status, preview?, error?, warnings? }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Send initial connection event
      send("connected", { projectId: id, timestamp: Date.now() });

      const STAGES = ["requirement", "recommendation", "codegen", "schematic"];
      const STATUS_MAP: Record<string, number> = {
        analyzing: 0,
        recommending: 1,
        generating: 2,
        finalizing: 3,
        ready: 4,
        failed: -1,
      };

      let lastStageIdx = -1;
      let attempts = 0;
      const MAX_ATTEMPTS = 150; // 5 minutes at 2s interval

      const poll = async () => {
        if (closed || attempts >= MAX_ATTEMPTS) {
          if (!closed) {
            send("timeout", { message: "Generation timed out after 5 minutes" });
            controller.close();
            closed = true;
          }
          return;
        }
        attempts++;

        try {
          const result = await db.query(
            `SELECT status, current_stage, requirement, component_list, generated_code,
                    svg_content, pin_table, pin_mappings, error_message,
                    validation_warnings, failure_reason, last_processed_stage
             FROM design_drafts WHERE id = $1`,
            [id]
          );

          if (!result.rows.length) {
            send("error", { message: "Project not found" });
            controller.close();
            closed = true;
            return;
          }

          const row = result.rows[0];
          const status = row.status as string;
          const stageIdx = STATUS_MAP[status] ?? -1;

          // Push stage completion events
          if (stageIdx > lastStageIdx && stageIdx >= 0) {
            for (let i = lastStageIdx + 1; i <= Math.min(stageIdx, 3); i++) {
              const stage = STAGES[i];
              const preview = buildPreview(stage, row);
              send("stage", { stage, status: "done", preview });
            }
            lastStageIdx = stageIdx;
          }

          // Terminal states
          if (status === "ready") {
            const warnings = parseJson(row.validation_warnings) || [];
            send("complete", {
              status: "ready",
              warnings,
              summary: {
                hasCode: !!row.generated_code,
                hasSchematic: !!row.svg_content,
                hasPins: !!row.pin_table,
              },
            });
            controller.close();
            closed = true;
            return;
          }

          if (status === "failed") {
            send("error", {
              stage: row.last_processed_stage || row.current_stage || "unknown",
              message: row.failure_reason || row.error_message || "Unknown error",
              suggestion: getSuggestion(row.failure_reason || row.error_message || ""),
            });
            controller.close();
            closed = true;
            return;
          }

          // Send heartbeat/progress
          send("progress", {
            status,
            currentStage: row.current_stage,
            progress: Math.min(Math.round(((stageIdx + 1) / 5) * 100), 95),
          });
        } catch {
          // DB error — retry silently
        }

        if (!closed) {
          setTimeout(poll, 2000);
        }
      };

      // Handle client disconnect
      _req.signal.addEventListener("abort", () => {
        closed = true;
        controller.close();
      });

      await poll();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function buildPreview(stage: string, row: Record<string, unknown>): Record<string, unknown> {
  switch (stage) {
    case "requirement": {
      const req = parseJson(row.requirement);
      return req ? { title: req.title, components: req.exactComponents?.length || 0 } : {};
    }
    case "recommendation": {
      const list = parseJson(row.component_list);
      return list ? { totalComponents: countComponents(list) } : {};
    }
    case "codegen":
      return { codeLines: row.generated_code ? String(row.generated_code).split("\n").length : 0 };
    case "schematic":
      return { hasPins: !!row.pin_table };
    default:
      return {};
  }
}

function countComponents(list: unknown): number {
  if (typeof list === "object" && list !== null && "tiers" in list) {
    const tiers = (list as { tiers: Record<string, unknown[]> }).tiers;
    return Object.values(tiers).flat().length;
  }
  return 0;
}

function parseJson(val: unknown): any {
  if (!val) return null;
  if (typeof val === "object") return val;
  try { return JSON.parse(String(val)); } catch { return null; }
}

function getSuggestion(error: string): string {
  if (error.includes("timeout") || error.includes("Timeout")) {
    return "AI 服务响应超时，请稍后重试或简化项目描述";
  }
  if (error.includes("component") || error.includes("Component")) {
    return "部分组件无法匹配，请尝试使用更常见的模块名称";
  }
  return "请重试，或修改项目描述后重新生成";
}
