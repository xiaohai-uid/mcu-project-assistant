# 02 — Exact component identity and wiring constraints

**What to build:** A user can attach exact component or module identities to the Reference Kit and receive a wiring view that names power, voltage, bus, occupied pins, strapping risks, and unresolved module details. A family name such as “OLED” remains an unresolved candidate instead of becoming a production-ready part.

**Blocked by:** 01 — Fixed ESP32-S3 Reference Kit provenance card.

**Status:** resolved

- [x] A component is stored at the correct object level, with manufacturer part number, supplier SKU when known, variant, source, and confidence.
- [x] Wiring checks use the exact board identity and flag occupied pins, voltage or power conflicts, strapping-sensitive pins, and unsupported module assumptions.
- [x] Unknown component facts are visible as pending and block the affected wiring claim without blocking unrelated project facts.
- [x] The existing proposal and wiring flow shows the source and reason for each warning.
- [x] Tests cover exact component identity, chip/module/board separation, conflict detection, and no silent substitution.

## Resolution

- Added explicit component identity metadata with chip/module/board/component object level, exact/family/unresolved status, source status, manufacturer/MPN/SKU/variant, confidence, and pending reason.
- Added identity diagnostics to `ConstraintEngine`; unresolved or family-level module facts remain visible as blocking pending warnings while provisional pin allocation and unrelated constraint checks continue.
- Persisted the selected ESP32-S3 Reference Kit identity snapshot into generated pin-map versions and rejected missing or mismatched board snapshots during wiring validation.
- Mapped occupied pins, voltage, UART, pin-budget, bus, strapping, component identity, and Reference Kit identity diagnostics into API/UI issues with source and reason metadata.
- Prevented firmware generation from the wiring UI while an affected identity or Reference Kit claim remains pending.
- Added unit and S5A end-to-end coverage for exact identity, pending identity, source/reason propagation, persisted board identity, and the non-silent pending result after manual pin correction.

Physical component measurement, USB enumeration, and real-board acceptance remain outside this ticket and are still pending under the physical acceptance work.
