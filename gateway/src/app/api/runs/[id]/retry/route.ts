import { NextRequest, NextResponse } from "next/server";
import { retryDesignRun } from "@/lib/runs/run-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/runs/[id]/retry
 * Retry a failed run. Resets status and re-publishes to RabbitMQ.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const retried = await retryDesignRun(params.id);
    if (!retried) {
      return NextResponse.json(
        { error: "Run not found or not in failed state" },
        { status: 404 }
      );
    }
    return NextResponse.json({
      runId: params.id,
      status: "queued",
      message: "Run retry queued. Will resume from last successful stage.",
    });
  } catch (error) {
    console.error("Failed to retry run:", error);
    return NextResponse.json({ error: "Failed to retry run" }, { status: 500 });
  }
}
