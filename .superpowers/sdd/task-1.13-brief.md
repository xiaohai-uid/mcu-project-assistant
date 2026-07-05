# Task 1.13 — 平台权限控制

## Acceptance Criteria
1. `checkPlatformAccess(tier: Membership, platform: Platform): boolean` — free/hasKey: Arduino only; subscription/pay-as-you-go: all platforms
2. `getAllowedPlatforms(tier: Membership): Platform[]` — returns list of allowed platforms for the tier
3. `projects/start/route.ts` accepts optional `platform` field (default: `"arduino"`), validates against membership
4. 403 error when user's tier doesn't allow the requested platform: `{ error: "Platform not allowed", allowedPlatforms: [...] }`
5. Tests: table-driven test for all (tier x platform) combinations, start route 403 test

## Context
- `membership` is already queried in the route and typed via `as Membership`
- `Platform = "arduino" | "esp32" | "stm32"` in `gateway/src/lib/models.ts`
- Current `POST /api/projects/start` takes `{ userId, description, experienceLevel }` — add `platform`
- Free tier → Arduino only, hasKey → Arduino only, subscription/pay-as-you-go → all
- The existing `process.env.DAILY_QUOTA_LIMIT` pattern in daily-quota.ts is the code style to follow

## Implementation files
- **Create:** `gateway/src/lib/platform-permissions.ts` — `checkPlatformAccess()`, `getAllowedPlatforms()`
- **Modify:** `gateway/src/app/api/projects/start/route.ts` — add platform validation
- **Create:** `gateway/__tests__/platform-permissions.test.ts` — tests

## Output
Return the full diff or at minimum the list of files modified and the key changes.
