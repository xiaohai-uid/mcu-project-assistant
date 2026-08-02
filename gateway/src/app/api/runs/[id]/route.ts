import { NextRequest, NextResponse } from "next/server";
import { getDesignRun, getStageRuns } from "@/lib/runs/run-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/runs/[id]
 * Get design run status with stage progress.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = params.id;

  try {
    const run = await getDesignRun(runId);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const stages = await getStageRuns(runId);

    return NextResponse.json({
      ...run,
      stages,
    });
  } catch (error) {
    console.error("Failed to get run:", error);
    return NextResponse.json(
      { error: "Failed to get run" },
      { status: 500 }
    );
  }
}
