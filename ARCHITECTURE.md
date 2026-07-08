# MCU Project Assistant — Architecture Guide

## 1. System Context / High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User / Browser                                │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ HTTPS
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Gateway (Next.js 14)                            │
│                                                                         │
│  ┌─────────────┐  ┌────────────────────┐  ┌─────────────────────────┐  │
│  │  Middleware  │  │   API Routes (24)  │  │   Frontend Pages (12)   │  │
│  │  ┌───────┐  │  │  ┌──────────────┐  │  │  ┌──────────────────┐  │  │
│  │  │ JWT   │  │  │  │ auth/*       │  │  │  │ Landing (/rsc)    │  │  │
│  │  │ Rate  │──┼──┼─▶│ projects/*   │──┼──┼─▶│ Wizard (guided)  │  │  │
│  │  │ HSTS  │  │  │  │ membership/* │  │  │  │ Professional     │  │  │
│  │  │ CORS  │  │  │  │ keys/*       │  │  │  │ Recommendations  │  │  │
│  │  │ Tier  │  │  │  │ billing/*    │  │  │  │ Code Editor      │  │  │
│  │  │ Guard │  │  │  │ templates/*  │  │  │  │ Pin Editor       │  │  │
│  │  └───────┘  │  │  │ snapshots/*  │  │  │  │ Schematic View   │  │  │
│  └─────────────┘  │  │ quota/health │  │  │  │ Export           │  │  │
│                   │  └──────────────┘  │  │  │ Membership/Keys  │  │  │
│                   └────────────────────┘  │  └──────────────────┘  │  │
│                                                                         │
│  ┌───────────────────┐  ┌────────────────────┐  ┌──────────────────┐  │
│  │ PostgreSQL Client │  │ RabbitMQ Publisher │  │ Orchestrator     │  │
│  │ (pg)              │  │ (amqplib)          │  │ (Consumer)       │  │
│  └───────┬───────────┘  └─────────┬──────────┘  └────────┬─────────┘  │
└──────────┼────────────────────────┼───────────────────────┼────────────┘
           │                        │                       │
           ▼                        ▼                       ▼
     ┌──────────┐           ┌──────────────┐       ┌──────────────┐
     │PostgreSQL│           │   RabbitMQ   │       │   RabbitMQ   │
     │   :5432  │           │   :5672      │       │  output Qs   │
     └──────────┘           └──────┬───────┘       └──────┬───────┘
           │                      │                       │
           │          ┌───────────┴───────────┐            │
           │          ▼           ▼           ▼            │
           │   ┌────────────┐ ┌────────────┐ ┌────────────┐│
           │   │Requirement │ │Recommenda- │ │ WebSearch  ││
           │   │Service     │ │tionService │ │Service     ││
           │   │:8001       │ │:8002       │ │:8003       ││
           │   ├────────────┤ ├────────────┤ ├────────────┤│
           │   │ FastAPI    │ │ FastAPI    │ │ FastAPI    ││
           │   │ LLMClient  │ │ SQLite DB  │ │ httpx/BS4  ││
           │   └────────────┘ └────────────┘ └────────────┘│
           │           └─────────┬──────────┘               │
           │                     │                          │
           │           ┌─────────┴──────────┐              │
           │           ▼                    ▼               │
           │   ┌────────────┐    ┌────────────┐            │
           │   │ Codegen    │    │ Schematic  │            │
           │   │ Service    │    │ Service    │            │
           │   │ :8004      │    │ :8005      │            │
           │   ├────────────┤    ├────────────┤            │
           │   │ FastAPI    │    │ FastAPI    │             │
           │   │ Jinja2     │    │ SVG Render │             │
           │   │ Templates  │    │            │             │
           │   └────────────┘    └────────────┘             │
           └──────────────────────┬────────────────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │      PostgreSQL          │
                    │  ┌────────────────────┐ │
                    │  │ users              │ │
                    │  │ memberships        │ │
                    │  │ api_keys           │ │
                    │  │ design_drafts      │ │
                    │  │ project_snapshots  │ │
                    │  │ project_templates  │ │
                    │  └────────────────────┘ │
                    └──────────────────────────┘
```

### Flow Summary

1. User submits a project description via the Wizard (beginner) or Professional interface
2. Gateway middleware authenticates, rate-limits, checks tier, resolves AI model
3. API route creates a `design_draft` row, resolves the model config, publishes to `requirement.input`
4. **RequirementService** analyzes the description via LLM → publishes structured requirement
5. Orchestrator (in gateway) chains: requirement → `recommendation.input`
6. **RecommendationService** queries SQLite component DB + optional LLM matching → tiers + cost + conflict detection
7. Orchestrator chains: recommendation → `codegen.input` (and publishes `websearch.input` in parallel)
8. **CodegenService** generates Arduino/ESP32/STM32 code via Jinja2 templates + LLM business logic
9. Orchestrator chains: code → `schematic.input`
10. **SchematicService** generates SVG wiring diagram with pin tables, BOM, and wire legend
11. Orchestrator marks draft as `ready` — frontend polls and renders results
12. **WebSearchService** (decoupled) scrapes prices from 1688/DigiKey/Mouser/LCSC in parallel

---

## 2. Component Diagram

### 2.1 Gateway (Next.js 14 App Router)

| Concern | Implementation | Location |
|---------|---------------|----------|
| Pages | 12 App Router pages (RSC + client components) | `gateway/src/app/*/page.tsx` |
| API Routes | 24 REST endpoints grouped by domain | `gateway/src/app/api/*/route.ts` |
| Auth Middleware | JWT verification, sets `x-user-id` + `x-membership` headers | `gateway/src/middleware.ts` |
| Rate Limiter | In-memory sliding window, tier-aware (60/300/1000 req/min) | `gateway/src/middleware/rate-limit.ts` |
| Security Headers | HSTS, X-Content-Type-Options, X-Frame-Options, CSP (report-only) | `gateway/src/middleware/security-headers.ts` |
| Tier Guard | Blocks professional-only endpoints for free users | `gateway/src/middleware/tier-guard.ts` |
| CORS | Configurable origin allowlist | `gateway/src/middleware/cors.ts` |
| Orchestrator | RabbitMQ consumer that chains pipeline stages | `gateway/src/lib/orchestrator.ts` |
| Model Router | Resolves `free_api` / `user_key` / `premium_api` based on membership | `gateway/src/lib/model-router.ts` |
| Encryption | AES-256-GCM for stored API keys | `gateway/src/lib/encryption.ts` |
| Database | pg with parameterized queries, no ORM | `gateway/src/lib/database.ts` |
| RabbitMQ Client | amqplib wrapper with typed queue constants | `gateway/src/lib/rabbitmq.ts` |

### 2.2 RabbitMQ Queues

| Queue | Producer | Consumer | Payload (key fields) |
|-------|----------|----------|---------------------|
| `requirement.input` | Gateway API | RequirementService | `{ designDraftId, description, modelConfig }` |
| `requirement.output` | RequirementService | Orchestrator | `{ designDraftId, requirement, lang, modelUsed }` |
| `recommendation.input` | Orchestrator | RecommendationService | `{ designDraftId, requirement, membership, modelConfig, platform }` |
| `recommendation.output` | RecommendationService | Orchestrator | `{ designDraftId, componentList }` |
| `websearch.input` | RecommendationService | WebSearchService | `{ designDraftId, components[] }` |
| `websearch.output` | WebSearchService | Orchestrator | `{ designDraftId, prices }` |
| `codegen.input` | Orchestrator | CodegenService | `{ designDraftId, components, requirement, modelConfig, platform }` |
| `codegen.output` | CodegenService | Orchestrator | `{ designDraftId, code, dependencies, pinMappings, validation }` |
| `schematic.input` | Orchestrator | SchematicService | `{ designDraftId, components, platform, pinMappings }` |
| `schematic.output` | SchematicService | Orchestrator | `{ designDraftId, svgContent, pinTable, powerNotes }` |
| `requirement.clarification.request` | RequirementService | (frontend polling) | `{ designDraftId, questions[] }` |
| `requirement.clarification.response` | Frontend | RequirementService | `{ designDraftId, answers }` |

### 2.3 Python Microservices

| Service | Port | Dependencies | Purpose |
|---------|------|-------------|---------|
| RequirementService | 8001 | FastAPI, shared LLMClient, RabbitMQ | LLM analysis of user description → structured requirement schema |
| RecommendationService | 8002 | FastAPI, SQLite3, shared LLMClient, RabbitMQ | Component DB lookup + LLM fallback → tiered recommendations + conflict detection |
| WebSearchService | 8003 | FastAPI, httpx, BeautifulSoup4, RabbitMQ | Scrapes 1688, DigiKey, Mouser, LCSC, DuckDuckGo with rate limiting + fallback DB |
| CodegenService | 8004 | FastAPI, Jinja2, shared LLMClient, RabbitMQ | Template-based code (Arduino/ESP32/STM32) + LLM business logic + pin assignment |
| SchematicService | 8005 | FastAPI, RabbitMQ | SVG wiring diagram with auto-layout, BOM, pin table, wire color legend |

### 2.4 Shared Library

| Module | Purpose |
|--------|---------|
| `shared/rabbitmq/client.py` | pika wrapper with connect, declare_queue, publish, consume |
| `shared/rabbitmq/queues.py` | Typed queue name constants |
| `shared/llm_client.py` | OpenAI-compatible client with structured output via Pydantic, retry logic |
| `shared/models/*.py` | Pydantic models for Requirement, Component, GeneratedCode, WiringDiagram, DesignDraft |
| `shared/database/schema.sql` | PostgreSQL DDL (users, memberships, api_keys, design_drafts, project_snapshots, project_templates) |
| `shared/database/migration-002-encrypted-keys.sql` | Adds `key_hash` column for fast API key lookup |

---

## 3. Data Flow

### 3.1 Async Pipeline (Happy Path)

```
User
  │
  │ POST /api/projects
  │ { description: "smart watering system" }
  ▼
Gateway API Route
  │
  ├── Resolves membership tier
  ├── Resolves model config (free_api / user_key / premium_api)
  ├── Inserts design_draft (status=analyzing)
  ├── Publishes to requirement.input
  │     { designDraftId, description, modelConfig }
  │
  ▼
┌───────────────────────────────────────────────────────────────┐
│ RequirementService (8001)                                      │
│  ├── Detect language (zh/en)                                   │
│  ├── Check for vague input → publish clarification if needed   │
│  ├── LLM.parse(description) → RequirementOutput(Pydantic)      │
│  └── Publish requirement.output                                │
│         { designDraftId, requirement: {title, functionality,   │
│           io, communication, powerSupply, targetPlatform} }    │
└───────────────────────────────────────────────────────────────┘
  │
  ▼
┌───────────────────────────────────────────────────────────────┐
│ Orchestrator (in gateway)                                      │
│  ├── Consumes requirement.output                               │
│  ├── Updates draft status → "recommending"                     │
│  └── Publishes recommendation.input                            │
└───────────────────────────────────────────────────────────────┘
  │
  ▼
┌───────────────────────────────────────────────────────────────┐
│ RecommendationService (8002)                                    │
│  ├── Maps functionality → DB categories                        │
│  ├── Queries SQLite component DB                                │
│  ├── Optionally AI-match components (if DB empty + model avail) │
│  ├── Tiers: budget (<$3), standard ($3-15), premium (>$15)     │
│  ├── Detects voltage conflicts between components               │
│  ├── If tier allows, publishes websearch.input (decoupled)      │
│  └── Publishes recommendation.output                           │
│         { designDraftId, componentList: {tiers, conflicts,      │
│           totalCosts, source} }                                 │
└───────────────────────────────────────────────────────────────┘
  │                                          │
  ▼                                          ▼
Orchestrator                              WebSearchService (8003)
  │                                          │
  ├── Updates draft (component_list)         ├── Searches 1688, DDG, DigiKey,
  ├── Publishes codegen.input                │    Mouser, LCSC with rate limiting
  │   {designDraftId, components,             ├── Deduplicates + aggregates prices
  │    requirement, modelConfig, platform}    ├── Falls back to DB prices on failure
  │                                          └── Publishes websearch.output
  ▼
┌───────────────────────────────────────────────────────────────┐
│ CodegenService (8004)                                          │
│  ├── Assigns MCU pins per platform pin map                     │
│  ├── Resolves library dependencies from component names        │
│  ├── Renders Jinja2 template (arduino/esp32/stm32)             │
│  ├── Optionally LLM-generates loop() business logic            │
│  ├── Validates generated code (setup + loop presence)          │
│  └── Publishes codegen.output                                  │
│         { designDraftId, code, dependencies, pinMappings,      │
│           validation}                                          │
└───────────────────────────────────────────────────────────────┘
  │
  ▼
Orchestrator
  │
  ├── Updates draft (generated_code, library_deps, pin_mappings)
  ├── Publishes schematic.input
  │
  ▼
┌───────────────────────────────────────────────────────────────┐
│ SchematicService (8005)                                        │
│  ├── Auto-layouts components in SVG canvas                      │
│  ├── Renders wiring lines with color-coded wire types          │
│  ├── Generates pin table (MCU Pin → Component → Wire)          │
│  ├── Generates BOM table                                       │
│  └── Publishes schematic.output                                │
│         { designDraftId, svgContent, pinTable, powerNotes }    │
└───────────────────────────────────────────────────────────────┘
  │
  ▼
Orchestrator
  │
  ├── Updates draft (svg_content, pin_table)
  ├── Sets status = "ready"
  │
  ▼
Frontend (polling GET /api/projects/[id])
  │
  ├── Renders wiring diagram SVG
  ├── Renders tabbed results (Code / Components / Pins / Schematic)
  ├── Offers export, snapshot, template save
  └── Begins auto-save snapshot timer
```

### 3.2 Pipeline State Machine

```
analyzing ──▶ recommending ──▶ generating ──▶ finalizing ──▶ ready
    │              │               │               │
    ▼              ▼               ▼               ▼
  failed         failed          failed          failed
```

Each stage has a 60-second timeout. If the service does not respond, the orchestrator marks the draft as `failed`.

### 3.3 Frontend Polling Flow

```
┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│  Wizard Submit  │ ──────▶│  Results Page   │ ──────▶│  Ready Display  │
│  POST /projects │        │  GET /projects/  │        │  Full results   │
│  start pipeline │        │  [id] (polling)  │        │  No polling     │
└─────────────────┘        └─────────────────┘        └─────────────────┘
                                 │
                          ┌──────┴──────┐
                          ▼              ▼
                   status:            status:
                   "analyzing"        "recommending"
                   (poll 2s)          (poll 2s)
                          │              │
                          └──────┬──────┘
                                 ▼
                          status: "ready" or "failed"
```

---

## 4. Key Design Decisions

### 4.1 Async Processing Pipeline over Synchronous RPC

**Decision**: Use RabbitMQ with a producer-chain orchestrator instead of synchronous HTTP calls.

**Rationale**: User descriptions can trigger multiple LLM calls (analysis, recommendation, codegen). Synchronous composition would keep HTTP connections open for 15-60s. The async pipeline allows:
- The frontend to render a "processing" state immediately with progress polling
- Each service to scale independently
- Graceful retry and timeout handling per stage
- WebSearch to run decoupled from the main chain

**Trade-off**: Requires the orchestrator (RabbitMQ consumer in the gateway) as a bridge between service output queues and the next input queue.

### 4.2 Model Routing: Three Tiers

**Decision**: Three AI routing levels — `free_api`, `user_key`, `premium_api`.

| Tier | Model Source | Web Search | Daily Limit | Use Case |
|------|-------------|------------|-------------|----------|
| Free | DeepSeek via shared API key | No | 10 req/day | Trial / casual |
| BYO Key | User's own API key at free endpoint | No | Unlimited | Hobbyists with keys |
| Subscription | GPT-4o via premium API key | Yes | Unlimited | Professional |

**Rationale**: Separating AI cost from the product — free users share a budget-limited API key, while subscribers get premium models. BYO key users bring their own quota.

### 4.3 Component Database: SQLite per Service

**Decision**: Each Python service uses its own SQLite database (or Postgres in production).

**Rationale**: The recommendation service's component DB is read-heavy and changes infrequently. SQLite avoids network calls for lookups and simplifies deployment. Migration to Postgres for production is supported via `DATABASE_URL` env var.

### 4.4 Encryption at Rest for API Keys

**Decision**: AES-256-GCM with scrypt-derived key, format `iv:authTag:ciphertext`.

**Rationale**: User-provided API keys for BYO key tier must be stored securely. AES-256-GCM provides authenticated encryption. The `key_hash` column (SHA-256) allows fast lookups without decryption.

### 4.5 Beginner/Professional Dual Mode

**Decision**: Same design system, different density — not separate UIs.

**Rationale**: Beginners and professionals have different density needs but share the same data model and API. The design system (DESIGN.md) defines component tokens per mode — button height 44px vs 32px, radius 8px vs 4px, etc. Pages detect mode via `experience_level` on the draft and adjust rendering.

### 4.6 WebSearch with Graceful Fallback

**Decision**: Scrape multiple sources (1688, DigiKey, Mouser, LCSC, DuckDuckGo) but fall back to a built-in price database if all web sources fail.

**Rationale**: Web scraping is unreliable (rate limits, markup changes, connectivity). The `FALLBACK_PRICES` map in `websearch-service/main.py` covers ~30 common components so users always see price estimates.

### 4.7 Chinese-First, English-Compatible

**Decision**: Primary audience is the Chinese maker community, but English is fully supported.

**Rationale**: The requirement service detects language (`zh`/`en`) and generates prompts accordingly. All UI copy uses Chinese by default with English fallback. This avoids the "translated from English" feel common in bilingual apps.

### 4.8 Auto-Save Snapshots

**Decision**: Snapshots are automatically saved at key pipeline stages; manual snapshots are also supported.

**Rationale**: LLM outputs are non-deterministic — auto-snapshots let users roll back to previous generated outputs. The `project_snapshots` table stores the full `snapshot_data` as JSONB.

---

## 5. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Next.js (App Router), React 18, TypeScript | ^14.2 |
| Runtime | Node.js | 20 LTS |
| Backend Services | Python + FastAPI | 3.11+, FastAPI |
| Primary Database | PostgreSQL | 16 |
| Service Database | SQLite | 3.x |
| Message Queue | RabbitMQ | 3.12+ / 4 |
| LLM Client | OpenAI SDK (OpenAI-compatible) | latest |
| LLM Models | DeepSeek Chat, GPT-4o (configurable) | — |
| Template Engine | Jinja2 | — |
| Web Scraping | httpx + BeautifulSoup4 | — |
| Auth | JWT (jsonwebtoken + bcryptjs) | — |
| Encryption | Node.js crypto (AES-256-GCM) | — |
| Testing | Vitest (unit), Playwright (E2E) | — |
| Containerization | Docker, Docker Compose | — |

---

## 6. Directory Structure

```
mcu-project-assistant/
├── gateway/                          # Next.js 14 App Router
│   ├── src/
│   │   ├── app/
│   │   │   ├── (page routes).tsx     # 12 frontend pages
│   │   │   └── api/
│   │   │       ├── auth/             # register, login, profile
│   │   │       ├── projects/         # CRUD, start, snapshot, code, pins, components, export
│   │   │       ├── membership/       # upgrade, downgrade
│   │   │       ├── billing/          # topup, balance
│   │   │       ├── keys/             # create, list, revoke, rotate
│   │   │       ├── templates/        # list, create, apply
│   │   │       ├── snapshots/        # restore
│   │   │       ├── quota/            # daily quota status
│   │   │       ├── health/           # gateway health
│   │   │       ├── docs/             # API docs UI
│   │   │       └── openapi.json/     # OpenAPI spec endpoint
│   │   ├── middleware/               # rate-limit, security-headers, cors, tier-guard
│   │   ├── middleware.ts             # JWT auth middleware (matcher: /api/:path*)
│   │   ├── lib/                      # database, jwt, encryption, model-router,
│   │   │                               orchestrator, rabbitmq, snapshot, validation
│   │   ├── components/               # Skeleton, LoadingSpinner, shared UI
│   │   └── hooks/                    # useLoadingState, useDesignDraft
│   ├── __tests__/                    # 12 test files (encryption, jwt, quota, billing, etc.)
│   ├── e2e/                          # Playwright E2E tests (wizard, registration, export)
│   ├── run-consumer.ts               # Orchestrator entry point
│   └── scripts/seed-templates.ts     # Template seeder
│
├── services/
│   ├── requirement-service/          # Port 8001
│   │   ├── main.py                   # FastAPI health + RabbitMQ consumer
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   ├── recommendation-service/       # Port 8002
│   │   ├── main.py                   # SQLite component DB + LLM fallback
│   │   ├── schema.sql                # Component table DDL
│   │   ├── seed.py                   # DB seeder
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   ├── websearch-service/            # Port 8003
│   │   ├── main.py                   # Multi-source price scraper
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   ├── codegen-service/              # Port 8004
│   │   ├── main.py                   # Jinja2 + LLM code generation
│   │   ├── templates/
│   │   │   ├── arduino.ino.j2
│   │   │   ├── esp32.ino.j2
│   │   │   └── stm32.ino.j2
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   └── schematic-service/            # Port 8005
│       ├── main.py                   # SVG wiring diagram generator
│       ├── Dockerfile
│       └── requirements.txt
│
├── shared/
│   ├── database/
│   │   ├── schema.sql                # PostgreSQL DDL (6 tables)
│   │   └── migration-002-encrypted-keys.sql
│   ├── rabbitmq/
│   │   ├── client.py                 # pika wrapper
│   │   └── queues.py                 # Queue name constants
│   ├── models/
│   │   ├── requirement.py
│   │   ├── component.py
│   │   ├── generated_code.py
│   │   ├── wiring_diagram.py
│   │   └── design_draft.py
│   └── llm_client.py                 # OpenAI-compatible structured output client
│
├── docker/
│   ├── Dockerfile.python             # Base Python image for all services
│   └── Dockerfile.gateway            # Base Node/Gateway image
│
├── docker-compose.yml                # 7 services (postgres, rabbitmq, 5 python, gateway)
├── trial_run.py                      # E2E pipeline runner (SQLite, no ext deps)
├── DESIGN.md                         # Design system (colors, typography, spacing)
├── design-tokens.json                # Machine-readable design tokens
├── design-preview.html               # Design system preview page
├── ARCHITECTURE.md                   # This file
├── DEPLOYMENT.md                     # Deployment guide
└── package.json                      # Workspace root
```

---

## 7. Security Considerations

### 7.1 In Transit

| Layer | Measure |
|-------|---------|
| Browser → Gateway | HTTPS (terminated at reverse proxy) |
| Gateway → Services | Internal Docker network (bridge), no TLS needed |
| Gateway → PostgreSQL | SSL-enabled connection string in production |
| Gateway → RabbitMQ | TLS + authentication in production |
| Service → Service | Never direct; all communication via Gateway API or RabbitMQ |

### 7.2 At Rest

| Data | Protection |
|------|-----------|
| Password hashes | bcrypt (via bcryptjs) |
| API keys | AES-256-GCM with scrypt-derived key; format `iv:authTag:ciphertext` |
| JWT secret | Environment variable, min 32 chars |
| Component DB | SQLite file (no encryption; contains public datasheet data) |

### 7.3 Authentication & Authorization

| Mechanism | Implementation |
|-----------|---------------|
| JWT | Signed with `JWT_SECRET`, contains `userId` + `membership` |
| Middleware | Verifies JWT on protected paths, injects `x-user-id` + `x-membership` headers |
| Tier Guard | Blocks PUT on code/pins/components for free-tier users (returns 403) |
| Rate Limiting | In-memory sliding window: 60/300/1000 req/min per IP per tier |
| API Key Hash | SHA-256 hash for fast lookup without decrypting stored keys |

### 7.4 Sanitization & Validation

- All user inputs validated via Zod schemas (gateway) and Pydantic (services)
- CSP set to report-only mode (not enforcing)
- SQL queries use parameterized bindings (no string concatenation)
- SVG output is self-contained (no external resources, no scripts)

### 7.5 Production Checklist

- Rotate `JWT_SECRET` and `ENCRYPTION_KEY` from defaults
- Enable PostgreSQL SSL (`sslmode=require`)
- Configure RabbitMQ with TLS + user credentials
- Set `CORS_ORIGIN` to production domain only
- Enable HSTS preload
- Schedule daily database backups
- Rotate `ENCRYPTION_KEY` quarterly and re-encrypt all stored API keys
- Remove `FREE_API_KEY` from env if free tier is deprecated

---

## 8. Deployment Architecture

See `DEPLOYMENT.md` for full deployment guide.

### Container Topology

```
┌────────────┐  ┌────────────┐
│  Postgres  │  │  RabbitMQ  │
│  :5432     │  │  :5672     │
│            │  │  :15672    │  (management UI)
└─────┬──────┘  └─────┬──────┘
      │                │
      └────────┬───────┘
               │
      ┌────────┴────────┐
      │  mcu-network     │
      │  (bridge)        │
      │                  │
      ├── requirement:8001
      ├── recommend:8002
      ├── websearch:8003
      ├── codegen:8004
      ├── schematic:8005
      ├── gateway:3000 (exposed)
      └──
```

### Service Dependencies

```
postgres ──┬── requirement-service
           ├── recommendation-service
           └── gateway

rabbitmq ──┬── requirement-service
           ├── recommendation-service
           ├── websearch-service
           ├── codegen-service
           ├── schematic-service
           └── gateway (orchestrator)

gateway waits for all 5 Python services healthy
```

### Port Mapping

| Container | Host Port | Protocol |
|-----------|-----------|----------|
| Gateway | 3000 | HTTP |
| RequirementService | 8001 | HTTP |
| RecommendationService | 8002 | HTTP |
| WebSearchService | 8003 | HTTP |
| CodegenService | 8004 | HTTP |
| SchematicService | 8005 | HTTP |
| PostgreSQL | 5432 | TCP |
| RabbitMQ | 5672 / 15672 | AMQP / HTTP |

### Scaling Considerations

- **Orchestrator**: Single consumer; can be scaled with competing consumers on output queues
- **RequirementService**: I/O-bound (LLM API calls); scale per queue
- **WebSearchService**: I/O-bound with rate limiting; scales well horizontally
- **CodegenService**: Mixed CPU/I/O; Jinja2 is fast, LLM calls are slow
- **SchematicService**: CPU-bound (SVG generation); fast, rarely bottleneck
- **Gateway**: Stateless; scales horizontally behind a load balancer
