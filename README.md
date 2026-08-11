# MCU Project Assistant

Local-first engineering assistant for microcontroller projects: requirements discovery → hardware selection → pin/wiring constraints → firmware generation → build/validation → companion device flash + serial telemetry. TypeScript modular monolith (Node 20 + Express + SQLite + React/Vite).

## Architecture

Single-process modular monolith (ADR-0003, ADR-0013). One production path: HTTP API → application capabilities → domain services → ports/adapters.

```
src/
├── domain/            # entities + services (dependency evaluation, constraint engine, firmware generator)
├── application/
│   └── capabilities/  # commands/queries: analyze, proposals, revalidate, firmware, build, diagnosis, flash
├── adapters/
│   ├── http/          # Express app (API + SSE events)
│   ├── persistence/sqlite/  # project store + migrations (9 tables)
│   ├── artifact-content/workspace-files/  # real files under workspace/
│   ├── ai/mock.ts     # deterministic AI provider (AIProviderPort)
│   ├── compiler/      # esp32-arduino (real toolchain) + mock (tests only)
│   ├── device/        # companion-local adapter (DevicePort; deterministic)
│   ├── events/sse.ts  # EventPort → SSE
│   └── task/in-process.ts  # TaskExecutionPort
├── ports/             # PersistencePort, ArtifactContentPort, EventPort, TaskExecutionPort,
│                      # AIProviderPort, CompilerPort, DevicePort
└── infrastructure/    # bootstrap: DB migrate → createApp → listen

app/                   # React 19 + Vite UI (Vite dev server proxies /api to the API)
tests/                 # vitest: unit (domain/application), contract (HTTP/SSE), e2e (golden journey)
docs/adr/              # 0013 architecture decisions
```

Key domain rules (see `docs/rebuild/domain-contract.md` for the frozen set):

- **ArtifactVersion is immutable** (I-2) — version numbers monotonic per artifact.
- **AI never writes accepted content directly** (I-1) — every change is a Proposal, user-accepted.
- **Revalidation**: no semantic change → Validated; semantic change → new Proposal (no auto-accept, D1).
- **Build never creates a version** (D2) — BuildRecord is separate evidence; a version may be built many times.
- **Flash requires a one-time confirmation token** (Safety Tier 0): 60s TTL, single-use, device-bound; L3 stale blocks flash; abort leaves no half-written evidence (`.evidence/`).
- **DeviceSession is runtime state** — no `device_sessions` table; `preferences` holds `last_device` only.

## Running

Requirements: Node 20 (npm). No arduino-cli needed for the default deterministic adapters.

```bash
npm install
npm run dev          # API on http://127.0.0.1:3000 + Vite UI on http://localhost:5173
```

Production-style build + start:

```bash
npm run build        # typecheck + vite build (app/dist)
node --import tsx src/infrastructure/server.ts   # API server (http://127.0.0.1:3000; GET /api/v1/health)
npx vite preview --config app/vite.config.ts     # serve the built UI
```

Configuration: see `.env.example` (`MCU_PORT`, `MCU_DB_PATH`, `MCU_WORKSPACE_DIR`).

## Testing

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src app/src tests
npm test             # unit + contract (vitest)
npm run e2e:golden   # golden journey end-to-end (deterministic adapters)
```

CI (`.github/workflows/ci.yml`) runs all five gates.

## Acceptance notes (S10)

- No mock production paths: mock AI/compiler/device adapters are test fixtures or dev adapters only; the UI calls the real HTTP API end-to-end.
- Deterministic acceptance: no physical hardware / arduino-cli on the acceptance machine — flash/build flows are verified through the companion-local / mock compiler adapters, with the real Port contracts and workspace evidence (`.build/`, `.evidence/`, `firmware/<NNNN>/`) asserted in tests.
