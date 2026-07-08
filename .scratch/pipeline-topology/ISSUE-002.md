---
title: Migrate all 5 handlers to use typed payloads from pipeline types
status: ready-for-agent
labels: [refactor, pipeline]
date: 2026-07-08
prd: .scratch/pipeline-topology/PRD.md
---

# Issue 002: Migrate all 5 handlers to use typed payloads from pipeline types

## Description

Each of the 5 handlers (`requirement-handler.ts`, `recommendation-handler.ts`, `codegen-handler.ts`, `schematic-handler.ts`, `websearch-handler.ts`) currently receives `any` or `Record<string, unknown>` as message types. After Issue 001, each stage's message schemas are defined as Zod types in `pipeline.ts`.

Migrate each handler to accept and work with the typed payloads inferred from its stage's Zod schemas (`z.infer<typeof pipeline.stages.requirement.messageIn>` etc.).

This means `stage-types.ts` interfaces can drop their `[key: string]: unknown` index signatures — the types are now either inferred from Zod or written explicitly.

## Tasks

- [ ] Migrate `requirement-handler.ts`: `doUpdate` receives typed `RequirementOutput` (no index signature), `buildNextPayload` returns typed payload
- [ ] Migrate `recommendation-handler.ts`: same pattern
- [ ] Migrate `codegen-handler.ts`: same pattern
- [ ] Migrate `schematic-handler.ts`: same pattern (note: `doSelect` returns `undefined` — typed as `Promise<undefined>`)
- [ ] Migrate `websearch-handler.ts`: same pattern (note: both `doSelect` and `buildNextPayload` are no-ops)
- [ ] Update `stage-types.ts`: remove `[key: string]: unknown` from all 9 interfaces. Keep the interfaces for backward compatibility but make them precise.
- [ ] Update `stage-handler.ts`: change abstract methods to use typed parameters where possible (e.g. generic `<T extends PipelineMessage>`)
- [ ] Verify build succeeds: `cd gateway && npx tsc --noEmit`

## Verification

```powershell
cd D:\mcu-project-assistant\gateway
npx vitest run
npx tsc --noEmit
```
