# V1 Baseline Record

> Recorded before V2 architecture migration begins.
> Purpose: any future issue can be judged as pre-existing or migration-introduced.

## Repository State

| Item | Value |
|------|-------|
| HEAD SHA | 512407cc6c700ab2f5f1cdad0d0988764d9e602e |
| Branch | main |
| Remote | https://github.com/xiaohai-uid/mcu-project-assistant |
| Date recorded | 2026-08-01 |

### Uncommitted changes at baseline

 M AGENTS.md
 M gateway/tsconfig.tsbuildinfo
 M trial-output/components.db
 M trial-output/generated.ino
?? .claude/
?? CLAUDE.md
?? docs/architecture/
?? docs/research/

## V1 Service Topology

### Docker Compose Services (8 containers)

| Container | Port | Technology | Role |
|-----------|------|-----------|------|
| gateway | 3000 | Next.js 14 App Router | Web UI + Control Plane + Orchestrator |
| requirement-service | 8001 | Python FastAPI | LLM analysis -> structured requirement |
| recommendation-service | 8002 | Python FastAPI + SQLite | Component DB lookup + LLM fallback |
| websearch-service | 8003 | Python FastAPI + httpx/BS4 | Multi-source price scraping |
| codegen-service | 8004 | Python FastAPI + Jinja2 | Template code generation + LLM logic |
| schematic-service | 8005 | Python FastAPI | SVG wiring diagram generation |
| postgres | 5432 | PostgreSQL 16 | Persistent state |
| rabbitmq | 5672/15672 | RabbitMQ | Async stage-to-stage messaging |

### V1 Pipeline Main Chain

```
User -> Gateway API -> requirement.input
  -> RequirementService -> requirement.output
  -> Orchestrator -> recommendation.input
  -> RecommendationService -> recommendation.output
  -> Orchestrator -> codegen.input (+ websearch.input parallel)
  -> CodegenService -> codegen.output
  -> Orchestrator -> schematic.input
  -> SchematicService -> schematic.output
  -> Orchestrator marks draft "ready"
```

### V1 RabbitMQ Queues (12 total)

| Queue | Producer | Consumer |
|-------|----------|----------|
| requirement.input | Gateway | RequirementService |
| requirement.output | RequirementService | Orchestrator |
| recommendation.input | Orchestrator | RecommendationService |
| recommendation.output | RecommendationService | Orchestrator |
| websearch.input | RecommendationService | WebSearchService |
| websearch.output | WebSearchService | Orchestrator |
| codegen.input | Orchestrator | CodegenService |
| codegen.output | CodegenService | Orchestrator |
| schematic.input | Orchestrator | SchematicService |
| schematic.output | SchematicService | Orchestrator |
| requirement.clarification.request | RequirementService | Frontend polling |
| requirement.clarification.response | Frontend | RequirementService |

### Pipeline State Machine (V1)

```
analyzing -> recommending -> generating -> finalizing -> ready
    |            |             |             |
  failed       failed        failed        failed
```

Each stage has a 60-second timeout.

## Database Migrations

| File | Purpose |
|------|---------|
| shared/database/migrations/001-schema.sql | Core tables: users, memberships, api_keys, design_drafts, project_snapshots, project_templates |
| shared/database/migrations/002-encrypted-keys.sql | Adds key_hash column for fast API key lookup |
| shared/database/schema.sql | Reference DDL (not a migration) |

## Test Commands (V1)

### Gateway

```bash
cd gateway
npm ci
npm test          # vitest run (12 test files)
npm run lint      # eslint src/ __tests__/ e2e/
npm run build     # next build
```

### Python

```bash
pytest shared/tests services/codegen-service/test_codegen.py services/schematic-service/test_schematic.py -v
```

### Docker

```bash
docker compose config
docker compose build
```

### E2E Pipeline (no external deps)

```bash
python trial_run.py "smart watering system"
```

## CI Configuration (V1)

File: `.github/workflows/ci.yml`

| Job | Steps | Gates |
|-----|-------|-------|
| gateway-tests | npm ci -> npm test | Only unit tests |
| python-tests | pip install -> pytest | shared + 2 service tests |
| docker-build | docker compose build | Needs both test jobs |

### Known CI Gaps

- No `npm run lint` gate
- No `npx tsc --noEmit` type check gate
- No `npm run build` gate
- Python tests only cover codegen + schematic; requirement/recommendation/websearch untested in CI

## Known Limitations (V1)

1. **Pipeline contract drift**: Gateway TS types and Python Pydantic models define overlapping schemas independently.
2. **Orchestrator in Gateway**: Business logic (stage chaining, payload assembly) lives in the Next.js gateway.
3. **No compile validation**: Generated firmware is never compiled; syntax errors reach the user.
4. **LLM decides components**: Requirement stage outputs exact component models instead of capability needs.
5. **No idempotency**: Worker crash can produce duplicate artifacts.
6. **No DLQ/retry**: Failed messages are lost; no structured retry.
7. **SVG is the only circuit truth**: No semantic circuit representation for future EDA integration.
8. **Scattered component facts**: COMPONENT_LIBRARIES, COMPONENT_INTERFACE, PLATFORM_PINS are separate dicts with no unified schema.

## Directory Structure (V1 top-level)

```
mcu-project-assistant/
├── gateway/              # Next.js 14 (UI + API + Orchestrator)
├── services/
│   ├── requirement-service/
│   ├── recommendation-service/
│   ├── websearch-service/
│   ├── codegen-service/
│   └── schematic-service/
├── shared/
│   ├── database/
│   ├── domain/
│   ├── models/
│   ├── rabbitmq/
│   └── llm_client.py
├── docker/
├── docs/
├── trial-output/
├── docker-compose.yml
├── trial_run.py
└── pytest.ini
```
