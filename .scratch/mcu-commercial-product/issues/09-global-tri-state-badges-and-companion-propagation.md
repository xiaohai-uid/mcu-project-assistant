# 09 — Global tri-state badge coverage and Companion physical-state propagation

**What to build:** The tri-state readiness vocabulary (local-ready / simulation-ready / physical-accepted) becomes truly global: every artifact card, BOM row, and report section carries its gate badge, and every CompanionView detection/flash action directly updates the corresponding artifact's physical state in place.

**Blocked by:** None — ReadinessBadgeStrip/useDeliveryGates already exist (R2b, commit 6c16127); this ticket widens their placement and closes the action→state loop.

**Status:** open

- [ ] Artifact cards (hardware/pinmap/firmware versions), BOM item rows, and delivery report sections each render the relevant gate badge via the shared strip/badge components.
- [ ] CompanionView detect/upload/serial actions refresh the physical-acceptance gate state without a full page reload (action → state propagation, not just next-mount).
- [ ] No view fabricates a gate state; badges always read from the delivery report seam.
- [ ] Design note: watch the per-card `/delivery-report` fetch pattern (code-review B8/c3 N+1) — if badge coverage multiplies fetches, add a batched report endpoint first.
- [ ] Tests: UI integration test asserting badge presence per surface; e2e asserting a Companion action flips the visible physical gate.
