# 03 — Reproducible Arduino build and local-ready result

**What to build:** A user can generate firmware for the fixed Reference Kit, run a real pinned Arduino-ESP32 build, and receive a saved build result containing the resolved board options, tool versions, command output, artifact hash, and an honest `local-ready` or blocked result.

**Blocked by:** 01 — Fixed ESP32-S3 Reference Kit provenance card.

**Status:** ready-for-agent

- [ ] The build uses Arduino-ESP32 core 3.3.11, stores the Arduino CLI version separately, and resolves the canonical ESP32-S3 board options explicitly.
- [ ] The build record contains the exact input version, resolved FQBN/options, command, tool versions, exit code, output artifact references, and artifact hash.
- [ ] `local-ready` requires exact identity, source-backed facts, wiring constraints passing, and a successful real compile; missing tools or failed builds remain blocked.
- [ ] The existing Build view can show the saved record without confusing compilation with physical acceptance.
- [ ] Tests cover successful build, missing toolchain, failed build, stale identity, and artifact hash persistence.
