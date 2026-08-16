# 03 — Reproducible Arduino build and local-ready result

**What to build:** A user can generate firmware for the fixed Reference Kit, run a real pinned Arduino-ESP32 build, and receive a saved build result containing the resolved board options, tool versions, command output, artifact hash, and an honest `local-ready` or blocked result.

**Blocked by:** 01 — Fixed ESP32-S3 Reference Kit provenance card.

**Status:** resolved

- [x] The build uses Arduino-ESP32 core 3.3.11, stores the Arduino CLI version separately, and resolves the canonical ESP32-S3 board options explicitly.
- [x] The build record contains the exact input version, resolved FQBN/options, command, tool versions, exit code, output artifact references, and artifact hash.
- [x] `local-ready` requires exact identity, source-backed facts, wiring constraints passing, and a successful real compile; missing tools or failed builds remain blocked.
- [x] The existing Build view can show the saved record without confusing compilation with physical acceptance.
- [x] Tests cover successful build, missing toolchain, failed build, stale identity, and artifact hash persistence.

**Resolution:**

- Pinned `esp32:esp32@3.3.11` and canonical ESP32-S3 options (`FlashMode=qio`, `FlashSize=8M`, `PSRAM=opi`, `PartitionScheme=default_8MB`) in a domain build profile.
- Extended compiler discovery and `BuildRecord` persistence with separate Arduino CLI/core versions, real-vs-fixture evidence, resolved FQBN/options, readiness status/reasons, and artifact hashes.
- Added the `local-ready` derivation seam: exact Reference Kit identity, passed current Pin Map validation, real pinned toolchain, successful exit code, and a verified binary hash are all required.
- Updated the primary Build view to show saved build evidence and explicitly keep physical upload/serial acceptance separate.
- Verified with profile/readiness unit tests, adapter tests, application-level real-evidence readiness tests, persistence tests, contract tests, S7 E2E tests, typecheck, lint, and production build.
