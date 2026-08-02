import { db } from "@/lib/database";
import { publishRunJob } from "@/lib/jobs/publisher";

export interface CreateRunInput {
  designDraftId: string;
  requestedBy: string | null;
  inputSnapshot: Record<string, unknown>;
}

export interface DesignRun {
  id: string;
  design_draft_id: string;
  pipeline_version: string;
  status: string;
  current_stage: string | null;
  created_at: string;
}

/**
 * Create a new DesignRun in PostgreSQL and publish job to RabbitMQ.
 * This is the V2 entry point for starting a design pipeline.
 */
export async function createDesignRun(input: CreateRunInput): Promise<DesignRun> {
  const result = await db.query(
    `INSERT INTO design_runs (design_draft_id, pipeline_version, status, requested_by, input_snapshot)
     VALUES ($1, '2.0', 'queued', $2, $3)
     RETURNING id, design_draft_id, pipeline_version, status, current_stage, created_at`,
    [input.designDraftId, input.requestedBy, JSON.stringify(input.inputSnapshot)]
  );

  const run = result.rows[0] as DesignRun;

  // Publish only run_id to RabbitMQ (no business payload)
  await publishRunJob(run.id);

  return run;
}

/**
 * Get a design run by ID with its stage runs.
 */
export async function getDesignRun(runId: string): Promise<DesignRun | null> {
  const result = await db.query(
    `SELECT id, design_draft_id, pipeline_version, status, current_stage, created_at
     FROM design_runs WHERE id = $1`,
    [runId]
  );
  return result.rows[0] ?? null;
}

/**
 * Get stage runs for a design run.
 */
export async function getStageRuns(runId: string) {
  const result = await db.query(
    `SELECT id, stage_name, stage_version, attempt, status, error_code, started_at, finished_at
     FROM stage_runs WHERE design_run_id = $1 ORDER BY created_at`,
    [runId]
  );
  return result.rows;
}

/**
 * Get artifacts for a design run.
 */
export async function getArtifacts(runId: string, typeFilter?: string) {
  const sql = typeFilter
    ? `SELECT id, artifact_type, schema_version, content_json, content_text, is_primary, created_at
       FROM artifacts WHERE design_run_id = $1 AND artifact_type = $2 ORDER BY created_at`
    : `SELECT id, artifact_type, schema_version, content_json, content_text, is_primary, created_at
       FROM artifacts WHERE design_run_id = $1 ORDER BY created_at`;
  const params = typeFilter ? [runId, typeFilter] : [runId];
  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Request cancellation of a run.
 */
export async function cancelDesignRun(runId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE design_runs SET cancel_requested_at = NOW()
     WHERE id = $1 AND status IN ('queued', 'running', 'waiting_for_user')
     RETURNING id`,
    [runId]
  );
  return result.rows.length > 0;
}

/**
 * Retry a failed run by re-queuing it.
 */
export async function retryDesignRun(runId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE design_runs SET status = 'queued', error_code = NULL, error_message = NULL,
     cancel_requested_at = NULL, finished_at = NULL
     WHERE id = $1 AND status = 'failed'
     RETURNING id`,
    [runId]
  );

  if (result.rows.length > 0) {
    await publishRunJob(runId);
    return true;
  }
  return false;
}
