---
title: Define China-market price and availability observations
status: resolved
date: 2026-08-16
labels: [wayfinder:grilling, procurement, pricing]
map: .scratch/mcu-commercial-product/map.md
---

# Define China-market price and availability observations

Type: grilling
Status: resolved
Blocked by: None

## Resolution

- First release source scope: use the public, human-checkable China-mainland listing from 立创商城 as the primary price/stock observation source. Do not merge Taobao, JD, distributor quotes, and bulk quotations into the same number in v1.
- Identity: every observation is attached to an exact supplier SKU and manufacturer part number. A family name, search keyword, or similar-looking module is not enough.
- Quantities: keep quantity tiers separate; start with quantity 1, 10, and 100 when the source exposes them. If a tier is not shown, store unknown rather than estimate it.
- Money: store CNY as the source currency, unit price, quantity tier, and total item price separately. Shipping, tax/VAT treatment, and other fees are separate fields; they are not silently included in the unit price.
- Availability: use explicit states such as `in_stock`, `limited`, `out_of_stock`, and `unknown`, with seller/source, URL, and observation timestamp. A missing or stale observation is not equivalent to in stock.
- Use: price and stock are advisory procurement information only. They may rank a purchase suggestion among otherwise compatible candidates, but they cannot prove electrical compatibility, safety, compile success, or physical acceptance; they also cannot silently trigger a replacement.
- Expansion: additional suppliers and marketplace observations can be added later as separate source classes with their own seller, quantity, shipping, and freshness rules.

## Question

For the first paid release, which China-mainland suppliers and observation types are in scope? Decide whether to record official retail, distributor, marketplace, and bulk prices; which quantities and currencies are comparable; how stock, shipping, VAT, seller identity, and timestamp are represented; and whether price data is advisory only or can influence a recommendation.
