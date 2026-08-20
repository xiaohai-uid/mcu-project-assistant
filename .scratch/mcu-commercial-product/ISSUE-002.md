---
title: Fix the exact ESP32-S3 Reference Kit and toolchain
status: resolved
date: 2026-08-16
labels: [wayfinder:research, hardware, toolchain]
map: .scratch/mcu-commercial-product/map.md
---

# Fix the exact ESP32-S3 Reference Kit and toolchain

Type: research
Status: resolved
Blocked by: None

## Resolution

- First supported board SKU: `ESP32-S3-DevKitC-1-N8R8`.
- Integrated module: `ESP32-S3-WROOM-1-N8R8`; official board documentation lists 8 MB Quad-SPI flash, 8 MB Octal-SPI PSRAM, and 3.3 V SPI voltage.
- Board revision policy: support the v1.1 pin map first. The official guide warns that the initial revision is also on the market and changes the RGB LED from GPIO38 to GPIO48; the physical acceptance unit must therefore record its revision before it is treated as verified.
- Arduino framework policy: pin Arduino-ESP32 core `3.3.11` for the first reproducible release, and record the installed Arduino CLI version separately. The current official CLI release observed during research is `1.5.0`.
- Arduino board identity: canonical base FQBN `esp32:esp32:esp32s3` (`ESP32S3 Dev Module`). The build profile must explicitly select 8 MB flash and OPI PSRAM and must store the fully resolved FQBN/options emitted by the installed CLI in each build record.
- Important board facts: USB-to-UART and native USB are both available; GPIO19/20 are native USB, GPIO43/44 are UART, GPIO0/3/45/46 are strapping-sensitive, GPIO35/36/37 are reserved for Octal flash/PSRAM on this module, and GPIO38 is the v1.1 RGB LED.
- Minimum kit: the exact board, a known data-capable USB 2.0 Standard-A to Micro-B cable, and a host with the pinned toolchain. Sensors, displays, motors, and relays remain separate component identities and are not part of the board SKU.
- Physical purchase/availability and actual USB enumeration remain acceptance work; this ticket fixes the technical target, not a claim that the current machine has the board.

## Question

Which exact ESP32-S3 board and module ordering code is the first supported Reference Kit? Resolve the exact FQBN, Arduino core/framework version policy, Flash/PSRAM variant, exposed GPIOs, strapping pins, power rails, USB/serial path, supported libraries, and the minimum bill of materials. Facts must come from first-party board, module, and toolchain documentation.
