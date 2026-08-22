---
title: MCU Project Assistant Commercial Product Wayfinder
status: open
date: 2026-08-16
labels: [wayfinder:map, mcu, commercial]
---

# MCU Project Assistant Commercial Product Wayfinder

## Destination

首发一个可以让真实用户付费使用的 MCU 工程助手：本地优先运行，首发支持一个明确的 ESP32-S3 Reference Kit，使用有来源和时效的真实硬件/器件数据，能生成可编译固件、接线约束和可复查证据，并通过清晰的产品包装获得收入。

商业合规证书、监管认证、企业采购证明和完整云端协作不属于本次首发目的地，除非后续用户重新划定范围。

## Notes

- Execution Mode: local-first for v1; hosted execution is a later adapter.
- Hardware direction: ESP32-S3 first, with `ESP32-S3-DevKitC-1-N8R8` as the fixed first Reference Kit; UNO R3 is a later Reference Kit unless the user redraws the destination.
- Real data policy: technical facts come from manufacturer or first-party documentation; prices are time-bound observations with region, currency, quantity, supplier, timestamp, and source.
- Evidence policy: missing tools, credentials, simulation access, or physical hardware are unavailable/not-run, never passed.
- Domain vocabulary follows the repository CONTEXT.md: Platform, ComponentDefinition, ArtifactVersion, BuildRecord, ValidationRecord, DebugEvidence, and Execution Mode.
- The repository already has a local Markdown issue tracker under `.scratch/`.

## Decisions so far

- User confirmed local-first v1, ESP32-S3 as the first hardware direction, and China-mainland price observations separated from technical facts.
- User explicitly deferred commercial certificates and regulatory proof from the initial product scope.
- First paying customer: independent hardware/IoT developers; students are a free or low-cost acquisition tier; small hardware teams are a later expansion.
- First paid promise: from the user's project input to a compilable firmware artifact, explicit wiring constraints, and clearly labeled evidence for each stage that actually ran.
- First technical target: `ESP32-S3-DevKitC-1-N8R8` with `ESP32-S3-WROOM-1-N8R8`, 8 MB Quad-SPI flash, 8 MB Octal-SPI PSRAM, and the v1.1 board pin map.
- First Arduino path: core `3.3.11`, canonical base FQBN `esp32:esp32:esp32s3`, explicit 8 MB flash and OPI PSRAM settings, with the fully resolved options captured per build.
- Paid release gate: the first Reference Kit needs both `local-ready` and `physical-accepted`; simulation is optional and always separate from physical proof.
- Hardware knowledge rule: every value carries exact identity, object level, source revision/date, observation time, condition, value class, freshness, confidence, and supersession; unknown or unsupported values stay visible and cannot silently support a release recommendation.
- China-market observation rule: v1 uses 立创商城 as the primary human-checkable source; exact supplier SKU, manufacturer part number, quantity tier, CNY unit price, stock state, fees, source URL, and observation time are stored separately; price/stock remain advisory and never prove compatibility or physical acceptance.

## Published vertical tickets

- `issues/01-reference-kit-provenance-card.md` resolved: exact board/module identity, official sources, persisted snapshot, and pending physical acceptance.
- `issues/02-exact-components-and-wiring-constraints.md` resolved: exact component identities and safe wiring constraints.
- `issues/03-reproducible-build-local-ready.md` resolved: reproducible local build and artifact evidence.
- `issues/04-unified-commercial-readiness-report.md` resolved (2026-08-22 audit sync).
- `issues/05-physical-upload-and-serial-acceptance.md` resolved (2026-08-22 audit sync).
- `issues/06-lcsc-price-observations-and-bom.md` resolved (2026-08-22 audit sync).
- `issues/07-commercial-golden-journey-and-delivery-report.md` resolved (2026-08-22 audit sync).
- `issues/08-recommendation-missing-facts-trace.md` resolved (2026-08-23): derived per-candidate `missingFacts` enumeration (source/facts/Reference Kit/physical-acceptance gaps) exposed through HTTP and rendered as a distinct 仍缺事实 list; `sourceUrl`+`sourceTitle` folded into a single `source` object end to end.
- `issues/09-global-tri-state-badges-and-companion-propagation.md` resolved (2026-08-23): delivery-report reads unified behind a module-level shared store (one deduplicated in-flight request per project — B8/c3 N+1 closed without a batched endpoint); tri-state strip on hardware/pinmap/firmware/BOM cards, per-row local-ready chips, per-section gate chips; companion detect/serial/flash actions refresh gates in place via `refreshDeliveryGates`; first UI test rig (jsdom + RTL) with 8 badge/propagation cases.
- `issues/10-middleware-level-ai-permission-enforcement.md` open: enforce AI tiers at the routing layer.
- `issues/11-platform-neutral-storage-examples.md` resolved (2026-08-22): canonical `/absolute/…` examples valid under both POSIX and win32 semantics; test asserts dual-semantics absoluteness.

## Not yet specified

- Packaging, distribution, support, update, and licensing mechanics.

Physical acceptance of the board, USB enumeration, and real compile/upload/serial evidence are still pending; the technical target is fixed but the machine has not yet proven it.

## Out of scope

- Regulatory certificates, product certification, EMC/CE/FCC evidence, and enterprise procurement paperwork for the initial release.
- Full MCU ecosystem coverage, multi-board parity, and unrestricted component ingestion.
- Multi-user SaaS, hosted queues, team collaboration, and cloud synchronization in the first paid release.
