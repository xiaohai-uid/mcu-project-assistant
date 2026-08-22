# 10 — Middleware-level AI permission enforcement

**What to build:** The AI permission table (ai-permissions.ts) is enforced at the routing layer for every write path, not only inside the commands handler. The system asserts — structurally, not by convention — that the command seam is the only way AI traffic reaches mutating capabilities.

**Blocked by:** None — table + fail-closed guard exist (R4, commit 6c16127).

**Status:** open

- [ ] Decision recorded first: is the command seam the ONLY AI-reachable surface? If yes, add a structural assertion (e.g. middleware ordering test that every non-command write route rejects requests carrying the AI client marker); if no, extend the tier check into a shared middleware applied to direct REST write routes.
- [ ] The enforcement point lives in one place (route middleware), not duplicated per handler.
- [ ] Forbidden capabilities return 403 `capability_forbidden` and unknown return 404 `unknown_capability` uniformly across both seams.
- [ ] `PlatformDefinition.candidateTier`-style comment-only invariants get the same treatment while touching this area: prefer typed factories over "仅当…才允许设置" comments (code-review B6).
- [ ] Tests: contract tests proving a forbidden capability via any seam gets 403; drift test proving a new write route cannot bypass the permission middleware.
