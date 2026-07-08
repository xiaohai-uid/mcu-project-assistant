---
title: Shared Domain Logic Extraction
status: ready-for-agent
date: 2026-07-08
tags: [refactor, domain, testing]
---

# PRD: Shared Domain Logic Extraction

## Problem Statement

The MCU Project Assistant operates as a RabbitMQ-driven pipeline across five Python services. Each service is independently deployable, but 11+ domain logic functions (`check_compatibility`, `allocate_tiers`, `assign_pins`, `layout_components`, etc.) are copy-pasted across `services/recommendation-service/main.py`, `services/codegen-service/main.py`, `services/schematic-service/main.py`, and `trial_run.py`. This creates four maintenance liabilities:

1. A bug fixed in one copy persists in the other three.
2. Adding a feature (e.g. a new pin type) requires editing four files.
3. `trial_run.py` is 680 lines — over half is duplicated service code.
4. No single source of truth exists for MCU domain logic (compatibility rules, pin assignment, category mapping).

## Solution

Extract the duplicated domain logic into `shared/domain/` as a Python sub-package of the existing `shared/` package (which already provides `bootstrap.py`, `llm_client.py`, `rabbitmq/`, etc.). Each service imports domain functions from `shared.domain.*` instead of defining them locally.

The existing import pattern (`from shared.llm_client import LLMClient`) proves this works within the current Docker build and service architecture.

## User Stories

1. As a developer, I want `check_compatibility` defined in one place, so that fixing a compatibility bug fixes it for all callers.
2. As a developer, I want `allocate_tiers` to accept an optional `platform` parameter, so that `recommendation-service` can filter by platform and `trial_run.py` can skip filtering.
3. As a developer, I want `CATEGORY_MAP` separated from `PIN_TYPE_MAP` into distinct modules, so that each mapping has a single responsibility.
4. As a developer, I want `detect_conflicts` extracted to shared domain, so that voltage/pin conflict detection is consistent regardless of which service triggers it.
5. As a developer, I want `assign_pins` and `resolve_dependencies` unified, so that pin assignment logic evolves in one place.
6. As a developer, I want `layout_components`, `generate_bom`, and `render_pin_table` extracted, so that SVG schematic generation is consistent.
7. As a developer, I want `trial_run.py` to import from `shared.domain.*`, so that it acts as a thin orchestrator rather than a 680-line code clone.
8. As a reviewer, I want deleted copy-paste functions in each service confirmed by passing tests, so that no behavior changes silently.
9. As a developer, I want `shared/tests/` for pure domain unit tests, so that the extraction is validated independently of service integration.
10. As a reviewer, I want each modified service to retain one smoke test importing the shared domain, so that `from shared.domain import ...` is verified in the service's own test suite.
11. As a developer, I want dead HTTP config (`docker-compose.yml` lines 169-173) removed, so that config surface reflects actual architecture.
12. As a developer, I want the extraction done in phases (domain logic first, pipeline topology later), so that each change is independently verifiable.

## Implementation Decisions

### Module structure

```
mcu-project-assistant/shared/
├── __init__.py              # existing, unchanged
├── bootstrap.py             # existing, unchanged
├── llm_client.py            # existing, unchanged
├── database/                # existing, unchanged
├── models/                  # existing, unchanged
├── rabbitmq/                # existing, unchanged
├── domain/                  # NEW
│   ├── __init__.py
│   ├── classification.py    # CATEGORY_MAP, _map_functionality_to_category
│   ├── compatibility.py     # check_compatibility, allocate_tiers, detect_conflicts
│   ├── pins.py              # PLATFORM_PINS, PIN_TYPE_MAP, assign_pins, resolve_dependencies, COMPONENT_LIBRARIES
│   ├── layout.py            # layout_components, generate_bom, render_pin_table, WIRE_COLORS
```

### Interface contract

All extracted functions accept `list[dict]` and return `dict`. This matches the existing message-passing convention (JSON-serializable dicts over RabbitMQ).

`allocate_tiers` gains an optional `platform: str | None = None` parameter. When `None`, compatibility check is skipped (preserving `trial_run.py` behavior). When provided, components are filtered via `check_compatibility`.

No existing function signatures are changed except `allocate_tiers` (backward-compatible optional parameter).

### Existing patterns respected

The extraction follows the same pattern as `shared/rabbitmq/queues.py` and `shared/bootstrap.py` — Python sub-packages imported by services at build time. No runtime coupling is introduced.

### Dependency

The `shared/` package has no pip dependencies beyond what each service already requires. `shared/domain/` uses only stdlib (`sqlite3`, `json`, `datetime`, `typing`).

### Removal

After all services are migrated:
- Copy-paste functions removed from `services/recommendation-service/main.py`
- Copy-paste functions removed from `services/codegen-service/main.py`
- Copy-paste functions removed from `services/schematic-service/main.py`
- `trial_run.py` rewritten to import from `shared.domain.*` (estimated 300-line reduction)
- 5 unused environment variables removed from `docker-compose.yml`

### Phasing

| Phase | Scope | Risk |
|-------|-------|------|
| 1 | Extract `shared/domain/` + adapt all services + dead config cleanup | Low — pure extraction, no seam changes |
| 2 (future) | Type-erased message boundary (discriminated unions + Zod) | Medium — changes StageHandler base class |
| 3 (future) | Declarative pipeline topology (`definePipeline`) | Medium — depends on Phase 2 |
| 4 (future) | Fan-out from topology, DLQ infrastructure | Low — independent |

## Testing Decisions

### What makes a good test

Test external behavior, not implementation details. A good domain test asserts: "given component X and platform Y, `check_compatibility` returns `{compatible: true/false}`". It does not assert how the function internally iterates or formats messages.

### Test structure

**`shared/tests/` (new)** — pure unit tests for each domain module:

| Test file | Tests | Prior art |
|-----------|-------|-----------|
| `tests/test_compatibility.py` | `check_compatibility` with compatible/incompatible/missing platform | `services/websearch-service/tests/test_import.py` |
| `tests/test_compatibility.py` | `allocate_tiers` with and without platform filter | same |
| `tests/test_compatibility.py` | `detect_conflicts` with voltage mismatch / no conflicts | same |
| `tests/test_classification.py` | `_map_functionality_to_category` mapping accuracy | same |
| `tests/test_pins.py` | `assign_pins` on each platform | same |
| `tests/test_pins.py` | `resolve_dependencies` known/unknown components | same |
| `tests/test_layout.py` | `layout_components` component positioning | same |

**Each service's `tests/` (existing)** — one smoke test after migration:
- Verify `from shared.domain.compatibility import check_compatibility` works
- Run one happy-path call
- Prior art: `services/websearch-service/tests/test_import.py` (4 lines)

### Seam

The highest seam is the `shared/domain/` import boundary. All domain logic is tested through one import path. The integration seam (each service's smoke test) is minimal — one assertion per service to validate the build-time dependency resolves.

## Out of Scope

- RabbitMQ retry/DLQ infrastructure (Phase 4)
- Pipeline topology declartion (Phase 3)
- Type-erased message boundary (Phase 2)
- WebSearch side-pipeline fan-out (Phase 3/4)
- Gateway TypeScript type safety (`any` types in orchestrator/rabbitmq)
- Moving the project from C: drive to D: drive
- CI/CD pipeline changes

## Further Notes

- The existing `shared/` package is at the project root. All services' Dockerfiles already handle this path (evidenced by existing `from shared.rabbitmq import queues` imports working in production).
- `trial_run.py` currently inserts service paths into `sys.path` and runs without Docker. After extraction, it will import from `shared.domain.*` directly (no sys.path manipulation needed for domain functions).
- Phase 1 does not require changes to RabbitMQ queue definitions or message schemas.
