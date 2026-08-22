# 08 — Recommendation missing-facts trace

**What to build:** A user opening the MCU candidate matrix can see, for every recommendation, which facts caused it and which facts are still missing that could change the result. The recommendation trace becomes complete: cited facts + constraints + explicit `missingFacts` enumeration.

**Blocked by:** None — builds on the sourced candidate matrix from the 2026-08-22 audit (commit b729142).

**Status:** open

- [ ] `McuCandidate` (domain + DTO + app types) carries a `missingFacts: string[]` field alongside the existing `reason`/`constraints`/`sourceUrl`.
- [ ] Each missing fact names what evidence would change the recommendation (e.g. "no verified flash/SRAM source for RP2040").
- [ ] The UI candidate card renders missing facts as a distinct "仍缺事实" list, visually separate from constraint warnings.
- [ ] Spec US25 acceptance: "看到每条推荐引用了哪些事实、仍缺哪些事实" — both halves demonstrable in one screen.
- [ ] Design note: while reshaping the candidate DTO, fold the `sourceUrl`+`sourceTitle` flat pair into a single `source` object (code-review B4 data clump).
- [ ] Tests: unit test asserting missingFacts present for every candidate; contract test exposing it through HTTP.
