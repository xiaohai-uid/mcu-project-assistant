# 04 — Unified commercial readiness report

**What to build:** A user can open the approved A-style delivery route and see one clear handoff conclusion, the four delivery gates, the evidence behind each gate, the next action, and the difference between `local-ready`, `simulation-ready`, `physical-accepted`, and `paid-release-ready`.

**Blocked by:** 02 — Exact component identity and wiring constraints; 03 — Reproducible Arduino build and local-ready result.

**Status:** resolved

- [x] The report leads with a plain-language delivery conclusion and does not use a percentage as a substitute for evidence.
- [x] Each gate shows status, source or evidence reference, observation time, and the reason it is pending or blocked.
- [x] `simulation-ready` is separate from physical proof, and `paid-release-ready` requires both `local-ready` and `physical-accepted`.
- [x] Missing tools, credentials, simulation access, or hardware produce pending, unavailable, or blocked states rather than pass.
- [x] The report is reachable through the existing application capability seam and is covered by state-derivation and UI integration tests.

**Resolution:**

- Added `deriveCommercialReadiness` as the pure four-gate state derivation (renamed to `deriveAcceptancePolicy` on 2026-08-22 per docs/rebuild/2026-08-22-application-architecture-review.md — business-model vocabulary does not belong in the domain layer; behavior unchanged): `local-ready`, `simulation-ready`, `physical-accepted`, and `paid-release-ready`.
- Added `GET /api/v1/projects/:projectId/readiness-report`, which reads current hardware identity, Pin Map validation, latest firmware BuildRecord, and persisted device truth.
- Added the primary application's Delivery route with an A-style handoff conclusion, next action, per-gate status, evidence reference, observation time, and reason.
- Simulation evidence remains optional and separate; companion or missing evidence never becomes physical acceptance, and paid release requires both local and physical gates.
- Verified with derivation tests, HTTP contract tests, typecheck, lint, and the primary route build.
