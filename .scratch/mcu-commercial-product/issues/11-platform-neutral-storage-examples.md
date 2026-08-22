# 11 — Platform-neutral storage examples (config test fails on POSIX hosts)

**What to build:** The checked-in `.env.example` storage paths and the config test that validates them must work on every host OS, not only Windows. Introduced by 2eccfff (diagnostics telemetry): `tests/unit/infrastructure/config.test.ts` asserts `isAbsolute()` on `.env.example` examples, but those examples use Windows form (`C:/...`), which Node's POSIX `path.isAbsolute` rejects — so the suite fails on WSL/Linux checkouts of main.

**Blocked by:** None.

**Status:** open

- [ ] Decide the canonical example form: either per-host examples in `.env.example` with a comment, or keep one canonical form and make the test platform-aware.
- [ ] The invariant that matters per spec is "relative values are rejected by the production runtime" — preserve it on all platforms.
- [ ] Discovered during merge cd199ec (feature/application-arch-r2r3r4 → main); failure exists identically on bare main at d43498c under WSL, independent of that merge's content.
