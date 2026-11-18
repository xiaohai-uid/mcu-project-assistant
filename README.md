# MCU Project Assistant

Local-first engineering assistant for microcontroller projects: requirements discovery → hardware selection → pin/wiring constraints → firmware generation → build/validation → companion device flash + serial telemetry. TypeScript modular monolith (Node.js 20.x + Express + SQLite + React/Vite). The internal-test deployment path is a single protected process with isolated persistent storage.

## Try a project without a board

With Node.js 20.x, run these commands from a fresh clone:

```bash
npm ci
npm run e2e:golden
```

The [end-to-end scenarios](tests/e2e/) exercise the project flow from requirements and wiring through firmware, build and flash evidence using deterministic adapters. The [commercial golden journey](tests/e2e/s10-commercial-golden-journey.e2e.test.ts) shows the requests and expected results. Physical flashing and serial telemetry require a board and the companion setup described below.

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

Requirements: Node.js 20.x (npm). The production server requires an explicit `MCU_DEVICE_PROVIDER=companion|physical`; physical mode uses the configured Arduino CLI for current ESP32-S3 discovery and upload and never falls back to Companion. Tests may inject deterministic adapters.

```bash
npm install
MCU_DEVICE_PROVIDER=companion MCU_AI_PROVIDER=sensenova SENSENOVA_API_KEY=... SENSENOVA_BASE_URL=https://token.sensenova.cn/v1 SENSENOVA_CHAT_MODEL=deepseek-v4-flash npm run dev
```

Production build + start (single process serves API/SSE and the built React UI):

```bash
npm run build        # typecheck + backend artifact (dist/server) + frontend (app/dist)
MCU_DEVICE_PROVIDER=companion MCU_AI_PROVIDER=sensenova SENSENOVA_API_KEY=... SENSENOVA_BASE_URL=https://token.sensenova.cn/v1 SENSENOVA_CHAT_MODEL=deepseek-v4-flash MCU_DB_PATH=C:\\absolute\\path\\mcu.db MCU_WORKSPACE_DIR=C:\\absolute\\path\\workspace npm start   # http://127.0.0.1:3000
```

Configuration: use `.env.example` as a reference for the environment passed to the server (`MCU_PORT`, absolute `MCU_DB_PATH`, absolute `MCU_WORKSPACE_DIR`, explicit `MCU_DEVICE_PROVIDER=companion|physical`, `MCU_ARDUINO_CLI_PATH`, optional absolute `MCU_ARDUINO_CLI_CONFIG_PATH` for a non-default Arduino CLI data/core directory, the optional positive `SENSENOVA_TIMEOUT_MS`, and the required explicit real AI provider settings). If the storage variables are omitted, the runtime uses its application-root `data/mcu.db` and `workspace` defaults; any explicitly supplied storage path must be absolute. The server does not auto-load a `.env` file and refuses to start when the provider, device provider, storage paths, or provider credentials are missing or malformed. Physical mode starts without hardware but reports typed tool/device errors, never falls back to Companion, and only reports physical verification after a fresh Arduino CLI discovery plus a successful upload with explicit `--verify`; the persisted device and flash evidence must also carry the fixed ESP32-S3 FQBN. Serial-session baud is selected by the request and defaults to the adapter's current 115200 setting when omitted. Deterministic mock adapters are test fixtures only. The production server resolves its built frontend relative to the server artifact, not the launch cwd. For an internal/public proxy, set `MCU_PUBLIC_MODE=1`, provide `MCU_BASIC_AUTH_USER` and a 16+ character `MCU_BASIC_AUTH_PASSWORD`, and use `MCU_HOST=0.0.0.0` when the process must bind a container interface. The built UI shell and `/api/v1/auth/session|login|logout` endpoints are public only to support browsers that cannot complete a native Basic Auth challenge; successful web login issues a short-lived HttpOnly cookie. The API remains protected by that session cookie or Basic Auth, and browser Origin is restricted to the request Host.

For the first Reference Kit's generated OLED firmware, install the pinned Arduino libraries into the same CLI config directory before running a real build. Arduino CLI does not consume `platformio.ini` dependency declarations during compilation; the generated file remains the project-facing dependency record.

When adding an exact user BOM item, use the canonical component ID shown by the generated BOM (for example `sensor.soil_moisture`, `actuator.relay`, or `display.oled_096`). The selection is carried into wiring diagnostics, while unresolved electrical facts remain blocking until their source-backed component record is verified.

```powershell
arduino-cli --config-file C:\absolute\path\to\arduino-cli.yaml lib install `
  "Adafruit SSD1306@2.5.10" "Adafruit GFX Library@1.11.9" "Adafruit BusIO@1.17.4"
```

### Docker staging / internal test

Build the production image and run it with fresh staging storage. Do not mount the repository's local data or workspace directories when you want an isolated test run:

~~~bash
docker build -t mcu-project-assistant:staging .
docker run --rm --name mcu-project-assistant-staging -p 3000:3000 \
  -e MCU_HOST=0.0.0.0 -e MCU_PUBLIC_MODE=1 \
  -e MCU_BASIC_AUTH_USER=pilot -e MCU_BASIC_AUTH_PASSWORD=<16+ character secret> \
  -e MCU_DEVICE_PROVIDER=companion -e MCU_AI_PROVIDER=sensenova \
  -e SENSENOVA_API_KEY=<secret> -e SENSENOVA_BASE_URL=https://token.sensenova.cn/v1 \
  -e SENSENOVA_CHAT_MODEL=deepseek-v4-flash \
  -v mcu-project-assistant-staging-data:/app/data \
  -v mcu-project-assistant-staging-workspace:/app/workspace \
  mcu-project-assistant:staging
~~~

For a short internal review from the current machine, run cloudflared tunnel --url http://127.0.0.1:3000 to proxy the locally protected process. A TryCloudflare URL is temporary and intended for testing; a durable release still needs a managed tunnel/domain and persistent host. Keep MCU_DEVICE_PROVIDER=companion for an online review unless the physical board and Arduino CLI are on the same host as the server.

### Free hosted internal test

The repository includes `render.yaml` for a zero-cost Render Free Web Service. Connect this public repository at Render, choose the Blueprint, and provide `MCU_BASIC_AUTH_USER`, `MCU_BASIC_AUTH_PASSWORD`, and `SENSENOVA_API_KEY` as private environment values. The deployment uses `MCU_DEVICE_PROVIDER=companion`; it is for web/API review and does not claim physical-board acceptance. Render probes `/healthz`; the UI provides the web login, while `/api` remains protected by the session cookie or Basic Auth.

This is a disposable internal-test tier: Render Free services sleep after inactivity, and the local SQLite database plus generated workspace are not durable across restart, redeploy, or spin-down. The UI loads a public shell and presents the configured web login; API calls require the resulting session cookie or Basic Auth. The signed session expires after eight hours and does not survive a fresh deployment. Do not put irreplaceable project data there. The TryCloudflare address is even more temporary and depends on this Windows machine and its tunnel process staying online.

### Offline backup and restore

Back up and restore only while the production server is stopped. These are explicit local operator commands; there is no automatic or cloud backup:

```text
npm run backup -- --output C:\path\to\backup
npm run restore -- --backup C:\path\to\backup --db C:\path\to\new\mcu.db --workspace C:\path\to\new\workspace
```

The backup is a versioned manifest containing the SQLite online-backup snapshot and workspace file hashes. A backup is valid only when `BACKUP_COMPLETE` is present. Do not copy a live SQLite main file or overwrite a database with stale `-wal`/`-shm` sidecars. Restore validates the complete backup before publishing and refuses existing database, WAL/SHM, or workspace targets; it never merges state. Provider credentials (`MCU_ZHIPU_API_KEY`, `SENSENOVA_API_KEY`, and environment secrets) are not included. Artifact content restores to a different workspace root, but historical build evidence containing absolute paths may remain unusable for flash and is fail-closed.

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
- Deterministic acceptance: no physical hardware / arduino-cli on the acceptance machine — companion flash/build flows are verified through companion-local / mock compiler adapters, while the physical adapter is exercised through a controlled external subprocess fixture that records argv, port, FQBN, input directory, and exit/truth evidence. No fixture result is presented as a hardware pass.
