---
title: Remove old source files and final cleanup
status: ready-for-agent
labels: [refactor, pipeline]
date: 2026-07-08
prd: .scratch/pipeline-topology/PRD.md
---

# Issue 003: Remove old source files and final cleanup

## Description

After Issue 002 all handlers use typed payloads from the pipeline definition. The old files that used to define constants and types independently are now dead code:

- `cascade.ts`: no longer defines its own `STAGE_ORDER` (imports from pipeline)
- `rabbitmq.ts`: no longer defines its own `QUEUES` constants (derived from pipeline)
- `handler-index.ts`: no longer uses hard-coded registration (reads from pipeline)
- `stage-types.ts`: all interfaces are now precise, some may be redundant with Zod-derived types
- `stage-handler.ts`: optional cleanup if the generic type parameter is stable

Remove dead code, ensure no dangling imports, and run full test suite.

## Tasks

- [ ] Remove dead constants from `cascade.ts` (keep only `invalidateDownstream` which has real logic)
- [ ] Remove dead constants from `rabbitmq.ts` (keep only `connectRabbitMQ`, `getChannel`, `publishToQueue`)
- [ ] Verify `handler-index.ts` only reads from pipeline (remove any dead imports)
- [ ] Delete `stage-types.ts` if all types are now inferable from pipeline Zod schemas (otherwise keep as thin type re-exports)
- [ ] Verify `container.ts` needs no changes
- [ ] Run full test suite: `npx vitest run`
- [ ] Run TypeScript check: `npx tsc --noEmit`

## Verification

```powershell
cd D:\mcu-project-assistant\gateway
npx vitest run
npx tsc --noEmit
```
