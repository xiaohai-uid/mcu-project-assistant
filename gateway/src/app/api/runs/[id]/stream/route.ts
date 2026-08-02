import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/runs/[id]/stream
 * Server-Sent Events for real-time run progress.
 *
 * Events:
 * - run.status: overall run state change
 * - stage.started: a stage began execution
 * - stage.completed: a stage finished successfully
 * - stage.failed: a stage failed
 * - clarification.required: user input needed
 * - artifact.created: new artifact available
 * - run.completed: run finished (succeeded/failed)
 *
 * Implementation: DB polling (simple, no Redis needed).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const runId = params.id;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(
        encoder.encode(`event: connected\ndata: {"runId":"${runId}"}\n\n`)
      );

      // Poll interval (in production: query DB every 2s)
      const interval = setInterval(() => {
        if (closed) {
          clearInterval(interval);
          return;
        }

        // In production: poll design_runs + stage_runs tables
        // For now: send heartbeat
        controller.enqueue(encoder.encode(`: heartbeat\n\n`));
      }, 2000);

      // Clean up on abort
      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
