# 09 — Global tri-state badge coverage and Companion physical-state propagation

**What to build:** The tri-state readiness vocabulary (local-ready / simulation-ready / physical-accepted) becomes truly global: every artifact card, BOM row, and report section carries its gate badge, and every CompanionView detection/flash action directly updates the corresponding artifact's physical state in place.

**Blocked by:** None — ReadinessBadgeStrip/useDeliveryGates already exist (R2b, commit 6c16127); this ticket widens their placement and closes the action→state loop.

**Status:** resolved

- [x] Artifact cards (hardware/pinmap/firmware versions), BOM item rows, and delivery report sections each render the relevant gate badge via the shared strip/badge components.
- [x] CompanionView detect/upload/serial actions refresh the physical-acceptance gate state without a full page reload (action → state propagation, not just next-mount).
- [x] No view fabricates a gate state; badges always read from the delivery report seam.
- [x] Design note: watch the per-card `/delivery-report` fetch pattern (code-review B8/c3 N+1) — if badge coverage multiplies fetches, add a batched report endpoint first.
- [x] Tests: UI integration test asserting badge presence per surface; e2e asserting a Companion action flips the visible physical gate.

## Resolution

Implemented on the derive-don't-store principle already used for gates themselves: badges stay a pure projection of `GET /delivery-report`; no view keeps its own gate copy.

**Shared seam (`app/src/state/deliveryReport.ts`, new).** The R2b per-mount hook became a module-level store keyed by projectId: N consumers (cards, rows, sections, Home card, Workspace strip) share one cache entry with a single deduplicated in-flight request, plus `refreshDeliveryGates(projectId)` for imperative invalidation. This resolves the B8/c3 design note without a batched endpoint — badge coverage multiplies *subscribers*, not fetches. `ReadinessView` gave up its second independent fetch path and now consumes the same store (its manual refresh button and post-acceptance refresh propagate to every mounted surface).

**Badge placement.** New presentational `ReadinessBadge` (single-gate chip) extracted from `ReadinessBadgeStrip`. Cards (hardware / pinmap / firmware / BOM header) render the full tri-state strip via `ReadinessGatesStrip`; BOM item rows carry their relevant single gate (local-ready — procurement identity feeds the local build); delivery-report sections carry their mapped gate chip (hardware/physical section → physical-accepted, build → local-ready, simulation → simulation-ready). All chips read from the same `report.gates`; missing data hides the badge instead of inventing a state.

**Action→state loop (AppContext).** `detectBoard` success, serial open/close, and the SSE `device.flashed` completion handler each call `refreshDeliveryGates(projectId)`, so every mounted badge updates in place after a companion action. Flash failure deliberately does not refresh-claim anything; server-side, only `POST /physical-acceptance` writes acceptance evidence (unchanged — no auto-promotion of flash to acceptance, preserving the honesty rule verified by s10).

**Tests.** First UI-test infrastructure in the repo: jsdom + @testing-library/react as devDeps, vitest include extended to `.test.tsx` (node default preserved; jsdom per-file docblock). `tests/ui/delivery-gates.test.tsx` (8 cases): store semantics (N surfaces = 1 fetch; refresh propagates in place), companion detect click flips the visible physical badge PENDING→READY through the real seam, and badge presence on hardware/pinmap/firmware/BOM/report-section surfaces. Deviation from the ticket letter: there is no browser-level e2e harness in this repo, so "a Companion action flips the visible physical gate" is asserted at the UI-integration level (jsdom + mocked transport, real store/refresh path); the server-side flip itself remains covered by contract/http/readiness + s10 golden journey.

Gates: typecheck ✓, lint ✓, suite 637 passed / 4 failed / 1 skipped — the 4 are the known permanent environment set (owned-child-crash ×2, esp32 output-flood, physical flash timeout); 0 regressions.
