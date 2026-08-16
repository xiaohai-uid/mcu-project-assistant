# Real local build evidence — 2026-08-17

This record captures a real local toolchain run for the fixed Reference Kit. It is build evidence only; it does not assert physical acceptance or paid-release readiness.

## Toolchain

- Arduino CLI: `1.5.1` (`arduino-cli  Version: 1.5.1 Commit: 01f3d4f2b Date: 2026-06-05T10:22:12Z`)
- Arduino core: `esp32:esp32@3.3.11`
- Config file used by both compiler and physical adapter: `C:\codex\mcu-toolchain\arduino-cli-1.5.1\arduino-cli.yaml`
- Reference Kit: `esp32-s3-devkitc-1-n8r8-v1.1`
- Resolved FQBN: `esp32:esp32:esp32s3:FlashMode=qio,FlashSize=8M,PSRAM=opi,PartitionScheme=default_8MB`
- Generated OLED library set installed in that config's user directory:
  - `Adafruit SSD1306@2.5.10`
  - `Adafruit GFX Library@1.11.9`
  - `Adafruit BusIO@1.17.4`

## Application BuildRecord proof

The application's HTTP build path created a real `BuildRecord` and invoked the real Arduino CLI with `toolchainEvidence=real`:

- Proof workspace: `C:\codex\mcu-toolchain\runtime-proof-http-dpWztu`
- Build ID: `9fe7b268-1622-4b40-98c9-fabc7aeabb17`
- Status: `succeeded`, exit code `0`
- Readiness: `blocked` only because the minimal proof project had no passed Pin Map validation (`wiring_validation_not_passed`)
- Saved binary evidence:
  - `.arduino-sketch-aLtK7J.ino.bin` — 278,528 bytes — `88d4939e7d6826bd3e3c62f68b83528905479d57c9ea11b137433075cb2ba41d`
  - `.arduino-sketch-aLtK7J.ino.bootloader.bin` — 19,968 bytes — `73bd425e380c709f6abd83aa987cb51c042a9aa8de44a37a9edb22d53bca08dd`
  - `.arduino-sketch-aLtK7J.ino.elf` — 6,378,880 bytes — `3a12accb924c75753406ec66f82740bb3b93f5c44532ac41be9acaa2350207f1`
  - `.arduino-sketch-aLtK7J.ino.merged.bin` — 8,388,608 bytes — `b73f755f49e4b4fcbfd3796a537735bcb2e8919d19154dcf66a80b09b7319d9d`
  - `.arduino-sketch-aLtK7J.ino.partitions.bin` — 3,072 bytes — `1d9cca96de0fe07ad7fc0648b9878ddecd9ce565e38b589ad20fea698ed4c80c`

The compiler stages the durable `src/main.cpp` layout into an isolated Arduino sketch directory containing the required `.ino` entry point. The durable `BuildRecord.sourceDir` remains the original firmware version path; the staging directory is removed after the child process exits.

## Generated firmware check

The full commercial golden flow was also run through the application after the three libraries above were installed. The generated OLED firmware compiled successfully, and the log reported `Sketch uses 352236 bytes (10%)`. The report remained blocked because the flow intentionally had no complete physical acceptance and the current Pin Map validation was not a passing release prerequisite.

## Explicit non-results

- No ESP32-S3-DevKitC-1-N8R8 v1.1 board was connected during this run.
- No USB detection, upload, upload verification, or serial startup observation is claimed.
- `paid-release-ready` remains blocked until both `local-ready` and `physical-accepted` are independently evidenced.
