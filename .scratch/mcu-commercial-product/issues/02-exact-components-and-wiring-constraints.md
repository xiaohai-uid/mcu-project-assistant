# 02 — Exact component identity and wiring constraints

**What to build:** A user can attach exact component or module identities to the Reference Kit and receive a wiring view that names power, voltage, bus, occupied pins, strapping risks, and unresolved module details. A family name such as “OLED” remains an unresolved candidate instead of becoming a production-ready part.

**Blocked by:** 01 — Fixed ESP32-S3 Reference Kit provenance card.

**Status:** ready-for-agent

- [ ] A component is stored at the correct object level, with manufacturer part number, supplier SKU when known, variant, source, and confidence.
- [ ] Wiring checks use the exact board identity and flag occupied pins, voltage or power conflicts, strapping-sensitive pins, and unsupported module assumptions.
- [ ] Unknown component facts are visible as pending and block the affected wiring claim without blocking unrelated project facts.
- [ ] The existing proposal and wiring flow shows the source and reason for each warning.
- [ ] Tests cover exact component identity, chip/module/board separation, conflict detection, and no silent substitution.
