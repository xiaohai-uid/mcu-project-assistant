# MCU Project Assistant — Deployment Guide

## Architecture Overview

See `ARCHITECTURE.md` for the complete system context, component diagram, data flow, and key design decisions.

## Prerequisites

- **Node.js** 20.x LTS
- **Python** 3.11+
- **PostgreSQL** 15+
- **RabbitMQ** 3.12+
- **Docker** (recommended for services)

## Quick Start

```bash
# 1. Clone and install dependencies
cd gateway
npm install

# 2. Setup environment
cp .env.example .env
# Edit .env with your PostgreSQL and RabbitMQ credentials

# 3. Initialize database
psql -U postgres -d mcu_assistant -f ../shared/database/schema.sql
psql -U postgres -d mcu_assistant -f ../shared/database/migration-002-encrypted-keys.sql

# 4. Seed data (optional)
python ../trial_run.py "seed"  # seeds component database

# 5. Start RabbitMQ (Docker)
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3.12-management

# 6. Start Python services
# Each in its own terminal:
python services/requirement-service/main.py
python services/recommendation-service/main.py
python services/websearch-service/main.py
python services/codegen-service/main.py
python services/schematic-service/main.py

# 7. Start gateway
npm run dev     # Development (port 3000)
npm run build   # Production build
npm run start   # Production (port 3000)
```

## Port Mapping

| Container | Host Port | Internal Port | Protocol | Service |
|-----------|-----------|---------------|----------|---------|
| Gateway | 3000 | 3000 | HTTP | Next.js 14 App Router |
| RequirementService | 8001 | 8001 | HTTP | FastAPI + LLM analysis |
| RecommendationService | 8002 | 8002 | HTTP | FastAPI + SQLite component DB |
| WebSearchService | 8003 | 8003 | HTTP | FastAPI + price scraper |
| CodegenService | 8004 | 8004 | HTTP | FastAPI + Jinja2 templates |
| SchematicService | 8005 | 8005 | HTTP | FastAPI + SVG generator |
| PostgreSQL | 5432 | 5432 | TCP | Primary database |
| RabbitMQ | 5672 | 5672 | AMQP | Message broker |
| RabbitMQ Management | 15672 | 15672 | HTTP | Admin UI |

### Health Check Endpoints

Every service exposes a `GET /health` endpoint returning `{"status": "ok", "service": "<name>"}`. Docker Compose uses these for `healthcheck` directives:

| Service | Health Check URL | Start Period |
|---------|-----------------|-------------|
| Gateway | `http://localhost:3000/api/health` | 15s |
| RequirementService | `http://localhost:8001/health` | 10s |
| RecommendationService | `http://localhost:8002/health` | 10s |
| WebSearchService | `http://localhost:8003/health` | 10s |
| CodegenService | `http://localhost:8004/health` | 10s |
| SchematicService | `http://localhost:8005/health` | 10s |
| PostgreSQL | `pg_isready -U mcu` | — |
| RabbitMQ | `rabbitmq-diagnostics check_port_connectivity` | — |

All Python services run the health server in a background thread (`threading.Thread(target=run_health_server, daemon=True)`) while the main thread consumes RabbitMQ.

### Environment Variables

#### Gateway (`gateway/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://localhost/mcu_assistant` | PostgreSQL connection string |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` | RabbitMQ connection string |
| `JWT_SECRET` | *required* | JWT signing secret (min 32 chars) |
| `ENCRYPTION_KEY` | *required* | AES-256-GCM key for API key encryption (min 16 chars) |
| `DAILY_QUOTA_LIMIT` | `10` | Free tier daily request limit |
| `SEARCH_QUOTA_MONTHLY` | `1000` | Subscription monthly search limit |
| `SEARCH_COST` | `1.00` | PAYG cost per search |
| `FREE_API_ENDPOINT` | `https://api.deepseek.com/v1/chat/completions` | Free-tier LLM endpoint (OpenAI-compatible) |
| `FREE_API_MODEL` | `deepseek-chat` | Free-tier LLM model name |
| `FREE_API_KEY` | `""` | Free-tier shared API key |
| `PREMIUM_API_ENDPOINT` | `https://api.openai.com/v1/chat/completions` | Premium-tier LLM endpoint |
| `PREMIUM_API_MODEL` | `gpt-4o` | Premium-tier LLM model |
| `PREMIUM_API_KEY` | `""` | Premium-tier API key |

#### Python Services

| Variable | Default | Applies To | Description |
|----------|---------|-----------|-------------|
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` | All | RabbitMQ for service orchestration |
| `DATABASE_URL` | `sqlite:///components.db` | recommendation-service | Component database (SQLite dev, PostgreSQL prod) |
| `COMPONENTS_DB` | `components.db` | recommendation-service | SQLite database file path |
| `OPENAI_API_KEY` | `""` | requirement, recommendation, codegen | LLM API key (falls back to mock if absent) |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | requirement, recommendation, codegen | OpenAI-compatible base URL |
| `LLM_MODEL` | `gpt-4o-mini` | requirement, recommendation, codegen | Model name for LLM calls |
| `LLM_MAX_RETRIES` | `2` | requirement, recommendation, codegen | Max retry attempts for LLM calls |

#### OpenAPI Spec and LLM Configuration

The gateway serves an OpenAPI 3.0 specification at `GET /api/openapi.json` (generated from `gateway/src/lib/openapi.ts`) and a Swagger UI at `GET /api/docs`. The spec is defined inline as a TypeScript object — no external tooling required.

LLM configuration is controlled via environment variables routed through `gateway/src/lib/model-router.ts`, which resolves the appropriate endpoint, API key, and model based on the user's membership tier:

- **free**: uses `FREE_API_*` vars (defaults to DeepSeek)
- **byo-key**: uses user's own API key at the `FREE_API_ENDPOINT`
- **subscription/pay-as-you-go**: uses `PREMIUM_API_*` vars (defaults to GPT-4o)

## Database Migrations

All migrations are in `shared/database/`:

```bash
# Apply in order
psql -d mcu_assistant -f shared/database/schema.sql          # Initial schema
psql -d mcu_assistant -f shared/database/migration-002-encrypted-keys.sql  # Encrypted keys
```

## Security Checklist

Before production deployment:

- [ ] Change all default secrets (`JWT_SECRET`, `ENCRYPTION_KEY`)
- [ ] Enable PostgreSQL SSL
- [ ] Set up RabbitMQ with TLS and authentication
- [ ] Configure `DAILY_QUOTA_LIMIT` and rate limiting
- [ ] Verify CORS settings for production domain
- [ ] Enable HSTS headers in reverse proxy
- [ ] Set up database backup schedule
- [ ] Rotate `ENCRYPTION_KEY` quarterly (re-encrypt all API keys)

## API Reference

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, returns JWT |
| GET | `/api/auth/profile` | Get user profile + membership |

All authenticated endpoints require header: `x-user-id` (or JWT Bearer token)

### Projects

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/projects` | Create design draft |
| GET | `/api/projects` | List user's projects |
| GET | `/api/projects/[id]` | Get project detail |
| GET | `/api/projects/[id]/code` | Get generated code |
| PUT | `/api/projects/[id]/code` | Edit code (pro only) |
| GET | `/api/projects/[id]/pins` | Get pin assignments |
| PUT | `/api/projects/[id]/pins` | Reassign pins (pro only) |
| GET | `/api/projects/[id]/snapshots` | List snapshots |
| POST | `/api/projects/[id]/snapshots` | Create snapshot |
| GET | `/api/projects/[id]/components` | Get component list |
| PUT | `/api/projects/[id]/components` | Update components (pro only) |
| GET | `/api/projects/[id]/export` | Export project |

### Membership

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/membership/upgrade` | Upgrade plan |
| POST | `/api/membership/downgrade` | Downgrade plan |
| GET | `/api/membership/status` | Get quota status |

### API Keys

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/keys` | Create API key |
| GET | `/api/keys` | List API keys |
| PATCH | `/api/keys/[id]` | Revoke API key |
| POST | `/api/keys/[id]` | Rotate API key |

### Billing

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/billing/topup` | Add PAYG balance |
| GET | `/api/billing/balance` | Get balance |

### Templates

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/templates` | List public templates |
| POST | `/api/templates` | Create template (pro+) |
| POST | `/api/templates/[id]/apply` | Apply template to project |

### Snapshots

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/snapshots/[snapshotId]/restore` | Restore snapshot |

### Mode Switch

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/switch-mode` | Toggle free/pro mode |

## CI/CD Workflows

### GitHub Actions (`.github/`)

The repository includes GitHub Actions workflows for automated CI/CD:

| Workflow | Trigger | Description |
|----------|---------|-------------|
| **CI — Gateway** | Push / PR to `main` (path: `gateway/**`) | `npm ci` → `npm run build` (zero TypeScript errors required) → `npm test` (Vitest, 137 tests) |
| **CI — Python Services** | Push / PR to `main` (path: `services/**`) | Runs `trial_run.py` as an integration smoke test (no external dependencies, uses SQLite) |
| **Docker Build** | Push to `main` | Builds all 7 Docker images (postgres and rabbitmq are pulled, not built) and pushes to container registry |
| **Deploy** | Tag push (`v*`) | Multi-stage deployment: build → push → deploy to production environment via Docker Compose or orchestrator |

### Local Verification

Before pushing, run the verification loop:

```bash
# 1. Gateway builds and tests
cd gateway
npm run build    # Must exit with 0 — TypeScript strict mode
npm test         # All 137 Vitest tests pass

# 2. Python services smoke test (from repo root)
python trial_run.py "smart LED strip controller"

# 3. Docker Compose (optional, requires Docker)
docker compose build
docker compose up -d
```

## Testing

```bash
# Gateway unit tests (Vitest)
cd gateway
npm test              # Run all tests
npm run test:watch    # Watch mode

# Python trial run (e2e, no external deps)
python trial_run.py "your project description"

# Build verification
cd gateway
npm run build  # Zero TypeScript errors required
```

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, TypeScript
- **API**: Next.js API Routes (REST)
- **Database**: PostgreSQL (primary), SQLite (dev/trial)
- **Message Queue**: RabbitMQ (service orchestration)
- **Services**: Python 3.11+ (BeautifulSoup, httpx, Jinja2)
- **Auth**: JWT (jsonwebtoken + bcryptjs)
- **Encryption**: AES-256-GCM (Node.js crypto)
- **Testing**: Vitest, Playwright

## Directory Structure

```
mcu-project-assistant/
├── gateway/
│   ├── src/app/           # Pages + API routes
│   │   ├── api/           # 23 REST endpoints
│   │   └── (pages)/       # 21 frontend pages
│   ├── src/lib/           # Shared libraries
│   ├── __tests__/         # 12 test files (137 tests)
│   └── vitest.config.ts
├── services/
│   ├── requirement-service/    # Requirement analysis
│   ├── recommendation-service/ # Component recommendation
│   ├── websearch-service/     # Price scraping (1688/LCSC/DDG)
│   ├── codegen-service/       # Arduino code generation
│   ├── schematic-service/     # SVG schematic generation
│   └── bom-service/           # Bill of materials export
├── shared/
│   ├── database/          # Schema + migrations
│   └── rabbitmq/          # Shared message queue definitions
├── trial_run.py           # E2E pipeline runner (SQLite)
└── requirements.txt       # Python dependencies
```
