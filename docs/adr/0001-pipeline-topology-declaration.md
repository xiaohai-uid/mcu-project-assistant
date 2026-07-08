# 0001 — Pipeline Topology Declaration

The pipeline's stage ordering, queues, message schemas, and handler registration were scattered across 5 files (cascade.ts, stage-types.ts, handler-index.ts, rabbitmq.ts, stage-handler.ts). We introduced a `definePipeline()` declaration in a new `pipeline.ts` that groups each stage's concerns in one place, then derives the 5 existing interfaces from it. This is a two-phase migration: first add `pipeline.ts` along side the old files (Babel-style), then migrate each handler to the new shape incrementally before removing the old files.

## Status

accepted

## Considered Options

- **Phase-based `definePipeline()` (chosen)**: A single declaration per stage, with Zod schemas for message validation and derived types replacing the old `[key: string]: unknown` interfaces. Queues, handlers, and stage order are all defined in one block.
- **Keep 5-file spread**: No engineering cost, but every future stage addition touches 5 files and defects like the `WEBSERACH` typo are undetected.
- **Config-driven (YAML/JSON)**: Declarative but loses TypeScript type safety and requires a loader — overkill for 5 stages.

## Consequences

- Adding a pipeline stage now requires editing exactly one declaration block instead of 5 files.
- Zod schemas provide compile-time type checking and runtime message validation, replacing the unsafe `[key: string]: unknown` pattern.
- The migration is incremental: old handler files continue working until they're individually migrated.
- The Python `shared/rabbitmq/queues.py` stays manually synchronized — queue names are stable enough that a code generator is not yet justified.
