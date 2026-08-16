# 01 — Fixed ESP32-S3 Reference Kit provenance card

**What to build:** A user can choose the first supported Reference Kit and see one precise identity card for the board, integrated module, board revision, memory variant, USB paths, source links, and unresolved facts. The card clearly separates official facts from unknown or pending physical facts and becomes the single identity used by later wiring and build results.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Selecting `ESP32-S3-DevKitC-1-N8R8` records the exact board, `ESP32-S3-WROOM-1-N8R8` module, v1.1 pin-map preference, 8 MB Flash, and 8 MB Octal PSRAM as separate identity facts.
- [x] Every displayed technical fact has an official source, document title or revision when available, access time, confidence, and value class.
- [x] The UI distinguishes board facts, module facts, and physical acceptance facts; missing board revision or USB enumeration stays pending and cannot become a pass.
- [x] The selected identity is persisted and is returned through the existing application capability seam for later wiring and build work.
- [x] Tests prove exact-identity selection, source-backed display, unknown preservation, and rejection of a broad `ESP32-S3` family record as the commercial Reference Kit.

## Resolution

- Added a source-backed `ReferenceKitDefinition` to the ESP32-S3 platform record.
- Returned and persisted the exact kit identity through the MCU capability seam.
- Added the identity card to the hardware selection view, with physical acceptance explicitly left pending.
- Verification: 23 unit tests, 5 contract/e2e tests, typecheck, and production app build passed.
