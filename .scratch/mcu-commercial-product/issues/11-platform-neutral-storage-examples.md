# 11 — Platform-neutral storage examples (config test fails on POSIX hosts)

**What to build:** The checked-in `.env.example` storage paths and the config test that validates them must work on every host OS, not only Windows. Introduced by 2eccfff (diagnostics telemetry): `tests/unit/infrastructure/config.test.ts` asserts `isAbsolute()` on `.env.example` examples, but those examples use Windows form (`C:/...`), which Node's POSIX `path.isAbsolute` rejects — so the suite fails on WSL/Linux checkouts of main.

**Blocked by:** None.

**Status:** resolved

- [x] Decide the canonical example form: either per-host examples in `.env.example` with a comment, or keep one canonical form and make the test platform-aware.
- [x] The invariant that matters per spec is "relative values are rejected by the production runtime" — preserve it on all platforms.

**Resolution:**

- Chosen form: one canonical platform-neutral example per variable — `/absolute/path/to/...`, absolute under both `node:path/posix` and `node:path/win32` semantics (win32 treats a leading `/` as current-drive root). Any host can copy the examples verbatim and pass validation; preferred over per-host dual examples to avoid duplicated lines and platform branching inside the test.
- `.env.example`: `MCU_DB_PATH`, `MCU_WORKSPACE_DIR`, and (same defect class) `MCU_ARDUINO_CLI_CONFIG_PATH` switched from `C:/...` to `/absolute/...`.
- `config.test.ts` now encodes the invariant explicitly: checked-in examples must be absolute under both posix and win32 semantics and accepted by `loadConfig`. Production `config.ts` keeps host-platform `isAbsolute`, so relative values remain rejected everywhere — spec invariant preserved on all platforms.
- Discovered during merge cd199ec (feature/application-arch-r2r3r4 → main); the failure existed identically on bare main at d43498c under WSL, independent of that merge's content.
