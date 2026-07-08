---
title: Create pipeline.ts with definePipeline() and adapt old files
status: ready-for-agent
labels: [refactor, pipeline]
date: 2026-07-08
prd: .scratch/pipeline-topology/PRD.md
---

# Issue 001: Create pipeline.ts with definePipeline() and adapt old files

## Description

Create `gateway/src/lib/pipeline.ts` with a `definePipeline()` function that declares all pipeline stages in one block, then adapt the 3 existing files (`cascade.ts`, `handler-index.ts`, `rabbitmq.ts`) to derive their exports from this definition instead of declaring own constants.

This is the Babel phase — old files keep working, nothing is deleted yet.

## Tasks

- [ ] `npm install -D zod` in `gateway/`
- [ ] Create `gateway/src/lib/pipeline.ts`:
  - `definePipeline(declaration)` validates: no duplicate stage/queue names, forms a DAG (no cycles), each stage has `designDraftId` in both message schemas
  - Returns `Pipeline` object with: `stages` (ordered list), `queues` (set), `queueToStage` (map), `getDownstream(stage)`, `handlerFor(queue)`
  - Use Zod schemas for `messageIn`/`messageOut` per stage (require `designDraftId: z.string().uuid()`)
- [ ] Modify `gateway/src/lib/cascade.ts`:
  - `export const STAGE_ORDER = pipeline.stages`
  - `getDownstreamStages(stage)` delegates to `pipeline.getDownstream(stage)`
  - `invalidateDownstream()` unchanged
- [ ] Modify `gateway/src/lib/handler-index.ts`:
  - Registration loop reads from pipeline definition: `for (const [queue, handler] of pipeline.handlerEntries()) { container.register(queue, handler); }`
- [ ] Modify `gateway/src/lib/rabbitmq.ts`:
  - `QUEUES` object is derived from pipeline definition
  - Old direct constants remain but now reference derived values
  - The `WEBSERACH` typo is automatically fixed when derived from actual stage names
- [ ] Create `gateway/__tests__/pipeline.test.ts`:
  - Accepts valid 5-stage config → returns correct queues/stages/downstream
  - Rejects duplicate stage names
  - Rejects duplicate queue names
  - Rejects missing `designDraftId` in schema
  - `getDownstream` returns correct sequence
  - `getDownstream(last)` returns empty
  - Queue names follow `{stage}.input` / `{stage}.output` convention
- [ ] Verify existing `gateway/__tests__/cascade.test.ts` still passes (test source unchanged, but the `STAGE_ORDER` it imports now comes from pipeline definition)

## Verification

```powershell
cd D:\mcu-project-assistant\gateway
npx vitest run __tests__/cascade.test.ts __tests__/pipeline.test.ts
```
