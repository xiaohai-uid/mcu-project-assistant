# 12 — Packaging, distribution, update and licensing mechanics

**What to build:** The paid release becomes installable: a reproducible package artifact (server + frontend + data dir layout), a documented install/start path per platform, a visible version identity, an update path that respects the evidence chain, and a licensing seam consistent with the `paid-release-ready` gate.

**Status:** draft — engineering facts surveyed; D1–D5 are product decisions owned by the user. Implementation starts only after decisions land.

**Grounded repo facts (2026-08-23):**

- Runtime is one Node process: `npm run build` → `dist/server/server.js` (+ `app/dist` static via `frontendDist`)；`engines: node 20.x`.
- Two native dependencies ship platform prebuilds (better-sqlite3, serialport) — packaging must bundle or pin them per OS/arch; serialport implies real USB access expectations per platform.
- Data lives in a workspace dir + SQLite file; `scripts/backup.mjs` / `restore.mjs` already exist and must keep working inside the installed layout.
- Product boundary (spec.md): local-first single-user assistant — not SaaS, not EDA, not a hosted service.
- Evidence culture: every artifact carries SHA-256 (build outputs do today); the package artifact should follow the same rule.
- `/healthz` exists but exposes only `{status}` — no version identity yet.

## Decision points (user-owned)

- **[D1] Distribution form** — options:
  - (a) per-platform archives (bundled Node 20 + dist + native-module prebuilds), user unpacks and runs one command — **recommended**: zero toolchain prerequisites, works offline, matches local-first;
  - (b) global npm package (GitHub Packages/public npm) — lighter to ship, but requires buyers to manage Node themselves and puts code on a registry;
  - (c) Docker image — wrong shape for USB/serial device access on maker desktops.
- **[D2] Desktop shell** — no Electron/Tauri in v1 (browser UI over localhost already exists); revisit only if a buyer segment demands it.
- **[D3] Licensing model** — one-time purchase per major version / subscription / free core + paid kit content pack. This decides whether a license key check exists at all and how it relates to the fourth gate: candidate design is "a valid license record is evidence feeding `paid-release-ready`", never a silent feature unlock.
- **[D4] Update mechanism** — recommended v1: manual download of a new signed/summed archive + visible version everywhere (`/healthz.version`, About panel); no auto-update. Rationale: acceptance records bind exact builds/firmware hashes; silently mutating the verifying tool undermines the evidence chain.
- **[D5] Support surface** — README quickstart + runbook doc + issue tracker; no SLA in v1.

## Slices (after decisions)

- [ ] D1–D5 decided and recorded here (owner: user).
- [ ] `scripts/package.mjs`: produce archive + `SHA256SUMS` manifest + install README; wire into CI-runnable command.
- [ ] Install smoke on the dev platform (and at least one other OS if available): unpack → start → golden journey reaches login → workspace/backup paths resolve inside the installed layout.
- [ ] Version visibility: `/healthz` gains `{version}` from package.json; TopNav/About shows it. — **done ahead of decisions (2026-08-23)**: build-time injection via all three vite/vitest configs (`__APP_VERSION__`), `/healthz` returns `{status,version}`, Settings header renders `v<version>`; contract + UI tests assert both.
- [ ] Update path doc: upgrade = replace app dir, keep workspace/data dir; backup → upgrade → restore rehearsal recorded as audit evidence. — **rehearsal done ahead of decisions (2026-08-23)**: `docs/audit/upgrade-rehearsal-2026-08-23.md` — real server process, backup (manifest sha256 + schemaVersion 14) → destructive wipe → restore → v2 reboot, project list diff byte-identical. Upgrade-path doc itself still pending D4.
- [ ] Licensing seam (only if D3 requires it): key verification capability + `paid-release-ready` evidence integration + fail-visible (unlicensed state shows pending, never fake-pass).
