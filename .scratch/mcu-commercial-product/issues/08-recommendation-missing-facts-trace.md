# 08 — Recommendation missing-facts trace

**What to build:** A user opening the MCU candidate matrix can see, for every recommendation, which facts caused it and which facts are still missing that could change the result. The recommendation trace becomes complete: cited facts + constraints + explicit `missingFacts` enumeration.

**Blocked by:** None — builds on the sourced candidate matrix from the 2026-08-22 audit (commit b729142).

**Status:** resolved

- [x] `McuCandidate` (domain + DTO + app types) carries a `missingFacts: string[]` field alongside the existing `reason`/`constraints`/`source`.
- [x] Each missing fact names what evidence would change the recommendation.
- [x] The UI candidate card renders missing facts as a distinct "仍缺事实" list, visually separate from constraint warnings.
- [x] Spec US25 acceptance: "看到每条推荐引用了哪些事实、仍缺哪些事实" — both halves demonstrable in one screen.
- [x] Design note: while reshaping the candidate DTO, fold the `sourceUrl`+`sourceTitle` flat pair into a single `source` object (code-review B4 data clump).
- [x] Tests: unit test asserting missingFacts present for every candidate; contract test exposing it through HTTP.

**Resolution:**

- `missingFacts` is **derived, not stored**: `deriveMissingFacts()` in `src/application/capabilities/mcu.ts` reads the absence of knowledge fields at recommend time — no official `source`, no sourced `facts` records (platform-level or via the Reference Kit), no pinned `referenceKit`, or a Reference Kit whose physical acceptance is still pending. Each entry states what evidence would change the result ("pinning board/module identity would make this candidate commercially actionable", "capturing USB enumeration, upload, and serial-boot evidence would move this kit from local-ready toward physical-accepted"). New platforms automatically get an honest gap enumeration without touching knowledge files; unknown/unsupported values stay visible per the hardware-knowledge rule in map.md.
- Current matrix output: ESP32-S3 → 1 entry (physical acceptance pending); STM32F401RE → 1 entry (no pinned Reference Kit). RP2040 stays suspended outside the matrix (no verified source), so it produces no card and no claims.
- B4 fold applied end to end with no compat shim: `sourceUrl`/`sourceTitle` removed from domain (`McuCandidate`), HTTP payload shape, client DTO, app types, state mapping, UI link render, and all three test layers; the flat keys are now structurally absent (asserted via `!("sourceUrl" in candidate)`).
- UI: the "仍缺事实" block sits between the constraints section and the reason quote, styled in info-blue mono (`⊘` rows) against the amber `⚠️` constraint warnings, so cited-fact gaps and requirement conflicts never read as the same class of message.
- Verification: red-green cycle walked (2 failed / 8 passed → 14/14 across unit+contract); full gates typecheck ✓ / lint ✓ / **626 passed / 4 failed / 1 skipped**, where the 4 failures are exactly the documented permanent environment set (owned-child-crash ×2, esp32 output-flood, physical flash timeout) and the single skip is the env-gated real-SenseNova smoke. Zero regressions.
