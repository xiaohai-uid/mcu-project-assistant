# Simulation Evidence — ESP32-S3 Wokwi Headless Run (2026-08-22)

## What was simulated

The generated greenhouse-monitor firmware (`runtime-proof-golden-6Ho7iY/workspace/fd9a666c…/firmware/0001/src/main.cpp`)
was executed on Wokwi's cloud simulator against a virtual
`board-esp32-s3-devkitc-1`, replacing the physical board for firmware-behavior
validation. Physical acceptance remains a separate, unsatisfied gate by spec
(simulation must not mask USB / power / real-load facts).

## Build provenance

| Item | Value |
| --- | --- |
| Toolchain | Arduino CLI 1.5.1 (`C:\codex\mcu-toolchain\arduino-cli-1.5.1`) |
| Config | `arduino-cli.yaml` (same file used by compiler and device adapter) |
| Core | esp32:esp32 @ 3.3.11 (pinned) |
| FQBN | `esp32:esp32:esp32s3:FlashMode=qio,FlashSize=8M,PSRAM=opi,PartitionScheme=default_8MB` |
| Libraries | Adafruit SSD1306 2.5.10, GFX 1.11.9, BusIO 1.17.4 |
| Program size | **352,264 bytes (10%)** — byte-size matches the 2026-08-17 golden build evidence |
| RAM | 24,424 bytes (7%) |
| ELF | `wokwi-sim/greenhouse/build/greenhouse.ino.elf` (7,759,496 B) |

Note: the sketch was compiled as `.ino` copy (`greenhouse.ino`) because
arduino-cli requires `<folder>.ino` and the proof workspace keeps PlatformIO-style
`src/main.cpp`; contents are identical.

## Simulation result — PASS

Runner: `wokwi-cli 0.26.1 --elf <local ELF> --expect-text MCU_READY`
(diagram: S3 devkit + SSD1306 @ 0x3C on GPIO8/9 + potentiometer on GPIO4 + LED on GPIO21).

1. Boot chain clean: `ESP-ROM:esp32s3-20210327 … rst:0x1 (POWERON), boot:0x8 (SPI_FAST_FLASH_BOOT)`.
2. Serial marker found: `MCU_READY` → `TEST PASSED`, exit code 0.
3. OLED render verified: screenshot `oled-sim.png` (128×64) shows 212 lit pixels
   confined to the top 16 rows — exactly where `println("Smart Greenhouse")` draws;
   rules out display-init/I2C failure (blank screen ⇒ fail).

Artifacts: `serial.log` (boot + marker), `oled-sim.png`. Kept outside the repo in
the toolchain workspace; hashes available on request.

## Findings captured during simulation bring-up

1. **Library dependency gap (real defect class)** — the generated firmware includes
   `Adafruit_SSD1306.h` but ships no dependency declaration; a fresh environment
   fails with `fatal error: Adafruit_SSD1306.h: No such file or directory`.
   Generator should emit dependency metadata alongside sources.
2. **Wokwi free-tier cloud build cannot compile ESP32-S3 projects** — deterministic
   `Build Ran Out of Memory` (2 GB server limit), reproduced twice. Local-build +
   `--elf` upload is the only free-tier path; documented here for future runs.
