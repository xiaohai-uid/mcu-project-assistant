---
title: Pipeline Topology Declaration
status: ready-for-agent
date: 2026-07-08
tags: [refactor, pipeline, typescript, gateway]
---

# PRD: Pipeline Topology Declaration

## Problem Statement

Adding a pipeline stage in the gateway requires editing 5 files that must stay in sync:

1. `cascade.ts` — defines `STAGE_ORDER` array
2. `stage-types.ts` — defines message interfaces with unsafe `[key: string]: unknown` index signatures
3. `handler-index.ts` — manually registers handlers in a container
4. `rabbitmq.ts` — declares queue name constants
5. `stage-handler.ts` — the abstract base class each handler extends

These files are coupled by convention, not by code. A developer adding a stage must remember all 5 places. Defects like the `WEBSERACH` typo (found in `rabbitmq.ts`) are undetected because there's no single source of truth for queue names.

Additionally, the 9 `*Output`/`*Input` interfaces in `stage-types.ts` all use `[key: string]: unknown`, which defeats TypeScript's compile-time checking — a misspelled field, a wrong type, or a missing required field all compile silently and fail at runtime.

## Solution

Introduce a `definePipeline()` declaration in a new `pipeline.ts` file that groups each stage's concerns in one place:

- Queue names (input + output)
- Handler class reference
- Message schemas (Zod)
- Stage ordering

The 5 existing files become **derived** from this single declaration — the old files still exist during a transitional migration, but they read from `pipeline.ts` instead of defining their own constants.

The migration is **phase-based (Babel-style)**: first add `pipeline.ts` alongside the old files, then migrate handlers one-by-one, then remove the old files.

## User Stories

1. As a developer adding a pipeline stage, I want to edit one file (one declaration block), so that I don't have to remember 5 places.
2. As a developer, I want message schemas validated at both compile time and runtime, so that malformed messages are caught before they corrupt pipeline state.
3. As a developer, I want queue names derived from the pipeline definition, so that the `WEBSERACH` typo can never happen again.
4. As a developer, I want the pipeline definition to reject invalid configurations (cycles, missing queues, duplicate names), so that misconfiguration is caught at startup not in production.
5. As a developer, I want the migration to be incremental — old handlers continue working until they're individually migrated — so that each step is verifiable.
6. As a developer, I want `cascade.ts`'s `getDownstreamStages` and `invalidateDownstream` to work unchanged during migration, so that the orchestrator doesn't need to change.
7. As a reviewer, I want to see that old files are deleted only after all handlers are migrated, so that no dead code accumulates silently.
8. As a test author, I want to test the pipeline definition function directly (give it a config → assert it validates/rejects), so that the topology logic has its own unit tests.

## Implementation Decisions

### New module: `pipeline.ts`

```typescript
import { z } from "zod"; // already a dependency in gateway

// Per-stage declaration
interface StageDeclaration {
  stage: string;
  input: string;
  output: string;
  handler: new () => StageHandler;
  messageIn: z.ZodType;
  messageOut: z.ZodType;
}

// Orchestrator result: for each stage, expose its queue names and neighbour info
interface Pipeline<T extends Record<string, StageDeclaration>> {
  stages: (keyof T & string)[];
  queues: string[];
  queueToStage: Map<string, keyof T & string>;
  getDownstream(stage: keyof T & string): (keyof T & string)[];
  handlerFor(queue: string): StageHandler;
}
```

### Message validation

Each stage's `messageIn` and `messageOut` Zod schemas:
- Require `designDraftId: z.string().uuid()`
- Require stage-specific fields with exact types
- Reject unknown fields (catch bugs early)
- Enable TypeScript type inference via `z.infer<>`

### Removal of `[key: string]: unknown`

All 9 `*Input`/`*Output` interfaces in `stage-types.ts` drop their index signatures. The types are either generated from Zod schemas or written explicitly when migrated. During migration, unmigrated handlers keep the old loose types; migrated handlers use precise Zod-derived types.

### Handler base class evolution

`StageHandler` keeps its current shape during migration. After all handlers are migrated, it repositions to accept Zod-validated typed payloads instead of `any`.

### What stays

- `cascade.ts` continues to work — it reads `STAGE_ORDER` from pipeline topology (not its own constant)
- `container.ts` continues to work — it's a simple registry
- All 5 handler files (`requirement-handler.ts` etc.) continue to work until individually migrated

### What changes

- New file: `gateway/src/lib/pipeline.ts` — the `definePipeline()` function
- Modified file: `cascade.ts` — `STAGE_ORDER` becomes `pipeline.stages`
- Modified file: `handler-index.ts` — registration loop reads from pipeline definition
- Modified file: `rabbitmq.ts` — `QUEUES` object is derived from pipeline definition
- Modified file: `stage-types.ts` — interfaces become precise (drop `[key: string]: unknown`)
- Modified file: `stage-handler.ts` — `handle()` accepts typed payload (migration step)
- Removed after migration: direct queue name constants in `rabbitmq.ts`, direct stage order in `cascade.ts`, manual registration in `handler-index.ts`

### Phasing

| Phase | Scope | Risk |
|-------|-------|------|
| 1 | Create `pipeline.ts` with `definePipeline()`, adapt `cascade.ts`/`handler-index.ts`/`rabbitmq.ts` to derive from it | Low — old files keep working, no handler changes |
| 2 | Migrate all 5 handlers to Zod-validated typed payloads, then remove old files | Medium — each handler needs individual attention |
| 3 | Remove old source files, verify no regression | Low — deletion only |

### Zod dependency

Zod needs to be added to the gateway's `devDependencies` (`npm install -D zod`). The gateway does not currently use Zod — message validation is ad-hoc. Adding Zod enables precise type-safe message schemas and unlocks future C2 improvements.

## Testing Decisions

### What makes a good test

Test the `definePipeline()` function's validation logic as a pure function: give it a declaration → assert it passes validation or returns the correct error. Do not test internal implementation details (how the Map is built, how iteration works). The interface is the validation behavior.

Do not test the handler migration at the unit level — handler logic is unchanged, only the type of the `content` parameter changes. The existing handler unit tests already cover the handler behavior.

### Test structure

**`gateway/__tests__/pipeline.test.ts`** (new file):

| Test | What it asserts |
|------|----------------|
| Accepts valid 5-stage config | Returns derived queues, stages, downstream map |
| Rejects duplicate stage names | Throws meaningful error |
| Rejects duplicate queue names | Throws meaningful error |
| Rejects missing designDraftId in schema | Throws validation error |
| `getDownstream(stage)` returns correct sequence | Matches STAGE_ORDER after the given stage |
| `getDownstream(last)` returns empty | Terminal stage has no downstream |
| Queue names match expected naming convention | e.g. `recommendation.input`, `recommendation.output` |

**Existing `cascade.test.ts`** (modified): tests remain but the source they test reads from `pipeline.ts` instead of local constants. Test outcomes should not change.

### Seam

The highest seam is the `definePipeline()` function signature. All pipeline topology logic is tested through this one function. No additional interaction seams are needed — the function is pure (no I/O, no side effects).

## Out of Scope

- Python-side queue name synchronization (manual sync stays)
- WebSearch side-pipeline fan-out (future Phase 4)
- DLQ infrastructure (future Phase 4)
- StageHandler testability improvements (future C2)
- Consumer decorator for services (future C3)
- Cross-language schema generation (future C4)

## Further Notes

- This PRD depends on the ADR in `docs/adr/0001-pipeline-topology-declaration.md`
- The Zod schemas for message validation are a pre-requisite for future C2 (StageHandler decomposition) — once message types are precise, the StageHandler can accept typed payloads
- The `WEBSERACH` typo in `rabbitmq.ts` will be automatically fixed when queue names are derived from pipeline definition (the typo is in the key name but the value `"websearch.output"` is correct — the key name won't be checked, but the old constant will be removed)
