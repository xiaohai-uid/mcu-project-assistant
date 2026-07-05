# Tasks 1.20–1.21 — Cascade Invalidation

## Acceptance Criteria
1. `STAGE_ORDER` constant: `["requirement", "recommendation", "codegen", "schematic"]`
2. `getDownstreamStages(fromStage)` returns all stages after `fromStage` in order
3. `invalidateDownstream(designDraftId, fromStage)` sets `status='stale'` + `current_stage` to first downstream stage for all stages after fromStage (sets status to 'stale', publishes to trigger next stage — for now just DB update)
4. Tests: dependency order, invalidation, partial cascade

## Context
- `design_drafts` has `status VARCHAR` and `current_stage VARCHAR`
- Stage flow: requirement → recommendation → codegen → schematic
- When a stage is modified, all stages after it become "stale"
- Frontend polls and sees "stale" status, triggers re-generation

## Implementation files
- **Create:** `gateway/src/lib/cascade.ts`
- **Create:** `gateway/__tests__/cascade.test.ts`

## Output
Return files created and test results (npx vitest run).