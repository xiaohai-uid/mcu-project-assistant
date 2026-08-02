import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/runs/[id]/clarifications
 * Submit user answers to clarification questions.
 * Resumes a run that is in waiting_for_user state.
 *
 * Body: { answers: string[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = params.id;
  const body = await request.json();
  const { answers } = body;

  if (!answers || !Array.isArray(answers)) {
    return NextResponse.json(
      { error: "answers array is required" },
      { status: 400 }
    );
  }

  // In production:
  // 1. Verify run is in waiting_for_user state
  // 2. Store answers in stage_runs output
  // 3. Update run status to queued
  // 4. Publish run_id to design.run for resume
  return NextResponse.json({
    runId,
    status: "resuming",
    message: "Clarification answers received. Run will resume.",
  });
}
