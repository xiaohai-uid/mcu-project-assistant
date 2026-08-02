import { NextRequest, NextResponse } from "next/server";
import { getArtifacts } from "@/lib/runs/run-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/runs/[id]/artifacts
 * List artifacts for a design run. Supports ?type= filter.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const typeFilter = request.nextUrl.searchParams.get("type") || undefined;

  try {
    const artifacts = await getArtifacts(params.id, typeFilter);
    return NextResponse.json({ runId: params.id, artifacts });
  } catch (error) {
    console.error("Failed to get artifacts:", error);
    return NextResponse.json({ error: "Failed to get artifacts" }, { status: 500 });
  }
}
