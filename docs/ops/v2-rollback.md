# V2 Pipeline Rollback Procedure

## Feature Flag

The V2 pipeline is controlled by the `PIPELINE_V2_ENABLED` environment variable.

- `PIPELINE_V2_ENABLED=true` → new runs use V2 Design Worker
- `PIPELINE_V2_ENABLED=false` (default) → new runs use V1 stage microservices

## Immediate Rollback (< 1 minute)

If V2 produces errors in production:

```bash
# Set flag to false in your environment / .env / orchestrator config
PIPELINE_V2_ENABLED=false

# Restart gateway (picks up new env)
docker compose restart gateway
```

No data loss: V1 services remain running and untouched until Phase 11.2.

## Partial Rollback (specific project)

If a specific project's V2 run fails:

1. Use the retry API to re-queue with V1:
   ```
   POST /api/runs/{runId}/retry
   ```
2. Or create a new run with the V1 path (flag = false).

## Full Rollback (revert deployment)

If the V2 worker itself is unstable:

```bash
# Stop the design worker
docker compose stop design-worker

# Ensure flag is off
PIPELINE_V2_ENABLED=false

# Restart gateway
docker compose restart gateway

# V1 services are still running and will handle all new requests
```

## Data Safety

- V2 writes to NEW tables (design_runs, stage_runs, artifacts, component_prices)
- V1 tables (design_drafts, project_snapshots) are never modified by V2
- Rolling back V2 does NOT affect any V1 data
- V2 artifacts are append-only; they remain for debugging even after rollback

## Pre-Phase 11.2 Tag

Before deleting legacy services, tag the repository:

```bash
git tag pre-v2-legacy-removal
git push origin pre-v2-legacy-removal
```

This allows full restoration of V1 services if needed after Phase 11.2.

## Monitoring After V2 Cutover

Watch for:
- `design_runs` table: `status = 'failed'` rate
- Worker logs: `stage.failed` events
- DLQ queue depth: `design.run.dlq` message count
- Compile failure rate exceeding 30%

If failure rate > 10% over 1 hour: rollback immediately.
