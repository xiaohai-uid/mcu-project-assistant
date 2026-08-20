---
title: Define the paid release evidence gate
status: resolved
date: 2026-08-16
labels: [wayfinder:grilling, verification, release]
map: .scratch/mcu-commercial-product/map.md
---

# Define the paid release evidence gate

Type: grilling
Status: resolved
Blocked by: None

## Resolution

For the first Reference Kit, the product may show `paid-release-ready` only when both `local-ready` and `physical-accepted` are true. Missing evidence is never treated as a pass.

- `local-ready` is required: the exact board/SKU and source records are fixed; wiring and pin constraints pass; the pinned Arduino-ESP32 core can compile the fixture; the output artifact hash, full resolved board options, command output, and exit code are saved; any required tool that is unavailable makes the result blocked rather than passed.
- `simulation-ready` is optional and separate: Wokwi or another simulator may prove software behavior covered by its model, but it never proves real voltage, current, USB behavior, load behavior, or physical wiring.
- `physical-accepted` is required for the first paid release: the board revision is recorded; a real USB connection is detected; the firmware is uploaded to the real board; upload verification succeeds; and the expected serial startup output is observed and saved. A port being listed alone is not enough.
- KiCad ERC is required only when the user supplies a KiCad schematic; if present, its report and exit code are evidence for schematic-rule checks, not a replacement for physical acceptance.
- For later user projects, the product may return `local-ready` or `simulation-ready` when no physical board is available, but it must visibly say that real-board acceptance is still pending.

## Question

What must be true before the product may display a paid-release-ready result for the first Reference Kit? Decide the required and optional status of real Arduino CLI compilation, firmware upload, KiCad ERC, Wokwi simulation, wiring/constraint validation, serial evidence, and one physical-board acceptance. Define the difference between `local-ready`, `simulation-ready`, and `physical-accepted` without allowing missing evidence to become a pass.
