# 04 — Unified commercial readiness report

**What to build:** A user can open the approved A-style delivery route and see one clear handoff conclusion, the four delivery gates, the evidence behind each gate, the next action, and the difference between `local-ready`, `simulation-ready`, `physical-accepted`, and `paid-release-ready`.

**Blocked by:** 02 — Exact component identity and wiring constraints; 03 — Reproducible Arduino build and local-ready result.

**Status:** ready-for-agent

- [ ] The report leads with a plain-language delivery conclusion and does not use a percentage as a substitute for evidence.
- [ ] Each gate shows status, source or evidence reference, observation time, and the reason it is pending or blocked.
- [ ] `simulation-ready` is separate from physical proof, and `paid-release-ready` requires both `local-ready` and `physical-accepted`.
- [ ] Missing tools, credentials, simulation access, or hardware produce pending, unavailable, or blocked states rather than pass.
- [ ] The report is reachable through the existing application capability seam and is covered by state-derivation and UI integration tests.
