# 06 — 立创商城 price observations and BOM export

**What to build:** A user can inspect a BOM containing exact part identities and see time-bound 立创商城 purchase observations, including supplier SKU, manufacturer part number, quantity tier, CNY price, stock state, fees, source URL, and observation time. The user can export the BOM without triggering an order.

**Blocked by:** 02 — Exact component identity and wiring constraints.

**Status:** ready-for-agent

- [ ] Price observations are attached to exact supplier and manufacturer identities, not search keywords or family names.
- [ ] Quantity 1, 10, and 100 are stored separately when shown; missing tiers stay unknown.
- [ ] Unit price, line total, shipping, tax or fee treatment, stock state, source URL, currency, and observation time remain separate fields.
- [ ] Price and stock affect procurement advice only; they cannot pass compatibility, safety, build, or physical acceptance gates.
- [ ] The user can export a source-backed CSV or Markdown BOM that distinguishes user input, system suggestion, unresolved identity, and observed procurement data.
