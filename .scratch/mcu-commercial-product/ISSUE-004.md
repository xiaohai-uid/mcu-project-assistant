---
title: Define the source-backed hardware knowledge model
status: resolved
date: 2026-08-16
labels: [wayfinder:grilling, data, provenance]
map: .scratch/mcu-commercial-product/map.md
---

# Define the source-backed hardware knowledge model

Type: grilling
Status: resolved
Blocked by: None

## Resolution

Every `Platform` and `ComponentDefinition` must carry an inspectable identity and provenance record. The product must never use a broad family name as if it were an exact purchasable object.

- Identity: manufacturer, exact part/model number, variant/SKU, object level (`chip`, `module`, `board`, `component`, or `tool`), compatible board/module relationships, and lifecycle state.
- Technical facts: field name, value, unit, operating condition, and value class (`absolute maximum`, `recommended`, `typical`, `peak`, `stall`, or `unknown`). A value without its condition is incomplete.
- Source: official URL, source owner, document title, revision/version, publication or modification date when available, access date, and the exact claim or page section used.
- Freshness: observed-at timestamp, freshness policy, superseded-by link when a newer source replaces it, and an explicit stale/unknown state. Old observations remain history and are not silently overwritten.
- Confidence: `official-direct`, `official-index`, `measured`, `user-supplied`, `inferred`, or `unsupported`. Only the first three may support a release recommendation; inferred and unsupported values must be visible and cannot silently pass a gate.
- Hardware scope: chip facts, module facts, board facts, and assembled-module facts are stored separately. A board pin map cannot be inferred from a chip data sheet, and a bare relay or sensor data sheet cannot prove a third-party module's wiring or safety.
- Recommendation trace: each recommendation links to the exact facts and constraints that caused it, plus the missing facts that could change the result.

## Question

What canonical fields must a Platform and ComponentDefinition carry so that a user can inspect why a recommendation is valid? Decide how to represent exact variants, manufacturer part numbers, board-level versus chip-level facts, absolute maximum versus recommended versus typical versus peak/stall values, source URLs, document revisions, observation dates, confidence, freshness, supersession, and unsupported claims.
