# 07 — Paid-release golden journey and delivery report

**What to build:** A real user can move from project input through the fixed Reference Kit, exact components, wiring, firmware, build, evidence review, optional price observations, and physical acceptance, then receive a delivery report that states what is ready, what is not, and which evidence supports the conclusion.

**Blocked by:** 04 — Unified commercial readiness report; 05 — Real board upload and serial acceptance; 06 — 立创商城 price observations and BOM export.

**Status:** ready-for-agent

- [ ] The golden path can be run from project creation to a final report without bypassing proposal confirmation or evidence gates.
- [ ] The final report includes the approved board identity, component identities, wiring result, build record, artifact hash, physical record, BOM, price observation timestamps, and unresolved risks.
- [ ] A missing optional simulation is shown as not run without blocking `local-ready`; missing required physical evidence blocks `paid-release-ready`.
- [ ] The same path is covered by an end-to-end fixture test and a manual acceptance checklist for a real Reference Kit.
- [ ] The approved A-style delivery route is the only primary readiness presentation; the older prototype variants are not required for the release path.
