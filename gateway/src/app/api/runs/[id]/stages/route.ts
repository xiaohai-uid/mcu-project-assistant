import { NextRequest, NextResponse } from "next/server";
import { getStageRuns } from "@/lib/runs/run-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/runs/[id]/stages
 * List all stage runs for a design run.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stages = await getStageRuns(params.id);
    return NextResponse.json({ runId: params.id, stages });
  } catch (error) {
    console.error("Failed to get stages:", error);
    return NextResponse.json({ error: "Failed to get stages" }, { status: 500 });
  }
}
