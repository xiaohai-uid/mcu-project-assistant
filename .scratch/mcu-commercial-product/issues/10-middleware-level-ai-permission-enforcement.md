# 10 — Middleware-level AI permission enforcement

**What to build:** The AI permission table (ai-permissions.ts) is enforced at the routing layer for every write path, not only inside the commands handler. The system asserts — structurally, not by convention — that the command seam is the only way AI traffic reaches mutating capabilities.

**Blocked by:** None — table + fail-closed guard exist (R4, commit 6c16127).

**Status:** resolved

- [x] Decision recorded first: is the command seam the ONLY AI-reachable surface? If yes, add a structural assertion (e.g. middleware ordering test that every non-command write route rejects requests carrying the AI client marker); if no, extend the tier check into a shared middleware applied to direct REST write routes.
- [x] The enforcement point lives in one place (route middleware), not duplicated per handler.
- [x] Forbidden capabilities return 403 `capability_forbidden` and unknown return 404 `unknown_capability` uniformly across both seams.
- [x] `PlatformDefinition.candidateTier`-style comment-only invariants get the same treatment while touching this area: prefer typed factories over "仅当…才允许设置" comments (code-review B6).
- [x] Tests: contract tests proving a forbidden capability via any seam gets 403; drift test proving a new write route cannot bypass the permission middleware.

## Resolution

**Decision (checkbox 1): no — the command seam was the only AI-reachable surface by convention, not structure.** Nothing stopped an AI agent from calling `POST /builds` or `/device/flash` directly; the R4 guard lived inside `handleCommands` only. Per the ticket's second branch, enforcement moved into a shared middleware at the API perimeter.

**One enforcement point (`app.ts`, after Basic Auth, before every route).** New perimeter middleware:
- Command seam (`POST /projects/:id/commands`) applies the tier table **regardless of marker** — R4 semantics unchanged for human UI traffic too (unregistered → 404 `unknown_capability`, forbidden → 403 `capability_forbidden`).
- Task continuations (`/commands/:taskId/clarification|cancel`) pass through (task-scoped, no capability).
- Every other write route (POST/PUT/PATCH/DELETE): requests carrying the new `x-ai-agent` marker are rejected 403 `capability_forbidden` — AI traffic is structurally confined to the command seam; unmarked human traffic is untouched.
- Auth endpoints (`/auth/*`) are registered before the perimeter (login establishes identity) and are the single documented exception.

`handleCommands` dropped its inline tier check — the middleware is the only enforcement site (checkbox 2). Error codes are uniform across both seams by construction (checkbox 3).

**Drift test.** The contract test enumerates the real express router stack (`_router.stack`), asserts ≥20 write routes exist (enumeration validity), asserts the auth exception is exactly `{login, logout}`, asserts the three seam routes exist, then fires an `x-ai-agent`-marked probe at **every** write route: off-seam must answer 403 `capability_forbidden`, the commands endpoint must answer 404 `unknown_capability`. A future write route is covered automatically by the middleware; a route registered before the perimeter (like a new auth-adjacent write) shows up in the exception check and fails the test until consciously allowlisted.

**B6 typed factory.** `defineCandidatePlatform()` in `platforms.ts` replaces the "仅当 objectLevel+source+facts 齐备才允许设置" comment with a compile-time requirement (`CandidatePlatformDefinition`) plus a runtime fail-closed check. Invariant aligned with `deriveMissingFacts`: official source mandatory, facts carried top-level or on the Reference Kit (the first compile caught that ESP32-S3 carries its facts via `referenceKit`, not top-level — the comment's wording was wrong, the factory now states the real rule). ESP32-S3 and STM32F401RE literals go through the factory.

Gates: typecheck ✓, lint ✓, suite 643 passed / 4 failed / 1 skipped — the 4 are the known permanent environment set; 0 regressions.
