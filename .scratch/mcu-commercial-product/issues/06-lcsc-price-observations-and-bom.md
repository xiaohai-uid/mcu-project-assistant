# 06 — 立创商城 price observations and BOM export

**What to build:** A user can inspect a BOM containing exact part identities and see time-bound 立创商城 purchase observations, including supplier SKU, manufacturer part number, quantity tier, CNY price, stock state, fees, source URL, and observation time. The user can export the BOM without triggering an order.

**Blocked by:** 02 — Exact component identity and wiring constraints.

**Status:** resolved

- [x] Price observations are attached to exact supplier and manufacturer identities, not search keywords or family names.
- [x] Quantity 1, 10, and 100 are stored separately when shown; missing tiers stay unknown.
- [x] Unit price, line total, shipping, tax or fee treatment, stock state, source URL, currency, and observation time remain separate fields.
- [x] Price and stock affect procurement advice only; they cannot pass compatibility, safety, build, or physical acceptance gates.
- [x] The user can export a source-backed CSV or Markdown BOM that distinguishes user input, system suggestion, unresolved identity, and observed procurement data.

**Resolution:**

- Added durable BOM items with source kind (`user-input` or `system-suggestion`), exact/unresolved identity status, manufacturer, manufacturer part number, supplier SKU, quantity, and unresolved reason.
- Added durable LCSC observations with independent quantity tiers 1/10/100, CNY unit/line/shipping/tax/fees, stock state, source URL, and observation timestamp.
- Enforced exact BOM identity and matching supplier SKU before an observation can be attached; unresolved family suggestions remain procurement-blocked.
- Added BOM inspection, user item entry, observation entry, CSV export, and Markdown export to the primary application. Export is read-only and carries the observation boundary.
- Verified with BOM domain export tests, SQLite-backed HTTP contract tests, typecheck, and lint.
