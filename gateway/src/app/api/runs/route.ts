import { NextRequest, NextResponse } from "next/server";
import { createDesignRun } from "@/lib/runs/run-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/runs
 * Create a new design run.
 * Body: { designDraftId: string, description?: string, targetPlatform?: string }
 *
 * Writes DesignRun to PostgreSQL, publishes {run_id} to RabbitMQ.
 */
export async function POST(request: NextRequest) {
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { designDraftId, description, targetPlatform, experienceLevel } = body;

  if (!designDraftId) {
    return NextResponse.json(
      { error: "designDraftId is required" },
      { status: 400 }
    );
  }

  try {
    const run = await createDesignRun({
      designDraftId,
      requestedBy: userId,
      inputSnapshot: {
        description: description || "",
        target_platform: targetPlatform || "arduino_uno",
        experience_level: experienceLevel || "beginner",
      },
    });

    return NextResponse.json(
      {
        runId: run.id,
        designDraftId: run.design_draft_id,
        status: run.status,
        pipelineVersion: run.pipeline_version,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create design run:", error);
    return NextResponse.json(
      { error: "Failed to create design run" },
      { status: 500 }
    );
  }
}
