# 07 — Paid-release golden journey and delivery report

**What to build:** A real user can move from project input through the fixed Reference Kit, exact components, wiring, firmware, build, evidence review, optional price observations, and physical acceptance, then receive a delivery report that states what is ready, what is not, and which evidence supports the conclusion.

**Blocked by:** 04 — Unified commercial readiness report; 05 — Real board upload and serial acceptance; 06 — 立创商城 price observations and BOM export.

**Status:** resolved

- [x] The golden path can be run from project creation to a final report without bypassing proposal confirmation or evidence gates.
- [x] The final report includes the approved board identity, component identities, wiring result, build record, artifact hash, physical record, BOM, price observation timestamps, and unresolved risks.
- [x] A missing optional simulation is shown as not run without blocking `local-ready`; missing required physical evidence blocks `paid-release-ready`.
- [x] The same path is covered by an end-to-end fixture test and a manual acceptance checklist for a real Reference Kit.
- [x] The approved A-style delivery route is the only primary readiness presentation; the older prototype variants are not required for the release path.

## Resolution

- Added `DeliveryReportDto` and pure `deriveDeliveryReport`, which joins the four readiness gates with the approved Reference Kit identity, component/BOM identities, Pin Map validation, BuildRecord and binary SHA-256, physical acceptance record, price-observation timestamps, optional simulation state, and explicit required/optional risks.
- Added `GET /api/v1/projects/:projectId/delivery-report`; the primary Delivery route now reads this saved-evidence report instead of the static readiness prototype.
- Added `tests/e2e/s10-commercial-golden-journey.e2e.test.ts`, covering project creation, proposal confirmation, artifact commits, wiring validation, build, flash, physical-acceptance recording, BOM identity, LCSC observation, and final report assertions. The companion fixture is intentionally rejected as physical acceptance, proving the paid gate remains blocked.
- Added `docs/audit/commercial-golden-journey-checklist.md` for a real ESP32-S3-DevKitC-1-N8R8 v1.1 acceptance run.
