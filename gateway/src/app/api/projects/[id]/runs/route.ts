import { NextRequest, NextResponse } from "next/server";
import { createDesignRun } from "@/lib/runs/run-service";
import { isPipelineV2Enabled } from "@/lib/pipeline-flag";
import { db } from "@/lib/database";

export const dynamic = "force-dynamic";

/**
 * POST /api/projects/[id]/runs
 * Create a new design run for a project.
 * Uses V2 pipeline when PIPELINE_V2_ENABLED=true.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = request.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = params.id;
  const body = await request.json().catch(() => ({}));

  if (!isPipelineV2Enabled()) {
    return NextResponse.json(
      { error: "V2 pipeline is not enabled. Set PIPELINE_V2_ENABLED=true." },
      { status: 400 }
    );
  }

  try {
    // Load project description from design_drafts
    const draftResult = await db.query(
      "SELECT id, description, target_platform, experience_level FROM design_drafts WHERE id = $1",
      [projectId]
    );

    if (draftResult.rows.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const draft = draftResult.rows[0];

    const run = await createDesignRun({
      designDraftId: projectId,
      requestedBy: userId,
      inputSnapshot: {
        description: body.description || draft.description || "",
        target_platform: body.targetPlatform || draft.target_platform || "arduino_uno",
        experience_level: body.experienceLevel || draft.experience_level || "beginner",
      },
    });

    return NextResponse.json(
      {
        runId: run.id,
        projectId,
        status: run.status,
        pipelineVersion: run.pipeline_version,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create run for project:", error);
    return NextResponse.json(
      { error: "Failed to create design run" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/projects/[id]/runs
 * List all design runs for a project.
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
    const result = await db.query(
      `SELECT id, status, current_stage, pipeline_version, created_at, finished_at
       FROM design_runs WHERE design_draft_id = $1 ORDER BY created_at DESC`,
      [params.id]
    );
    return NextResponse.json({ projectId: params.id, runs: result.rows });
  } catch (error) {
    console.error("Failed to list runs:", error);
    return NextResponse.json({ error: "Failed to list runs" }, { status: 500 });
  }
}
