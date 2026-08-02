import { NextRequest, NextResponse } from "next/server";
import { cancelDesignRun } from "@/lib/runs/run-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/runs/[id]/cancel
 * Request cancellation. Worker checks cancel_requested_at at stage boundaries.
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
    const cancelled = await cancelDesignRun(params.id);
    if (!cancelled) {
      return NextResponse.json(
        { error: "Run not found or not in cancellable state" },
        { status: 404 }
      );
    }
    return NextResponse.json({
      runId: params.id,
      status: "cancel_requested",
      message: "Cancellation requested. Will stop at next stage boundary.",
    });
  } catch (error) {
    console.error("Failed to cancel run:", error);
    return NextResponse.json({ error: "Failed to cancel run" }, { status: 500 });
  }
}
