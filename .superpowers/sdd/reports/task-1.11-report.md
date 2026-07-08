# Task 1.11 Report: 会员状态管理

## Status: DONE

## Files Created/Modified

| File | Action |
|------|--------|
| `gateway/src/app/api/auth/profile/route.ts` | Created - GET handler for user profile + membership |
| `gateway/src/app/api/membership/upgrade/route.ts` | Created - POST handler for tier upgrade |
| `gateway/src/app/api/membership/downgrade/route.ts` | Created - POST handler for subscription→free downgrade |
| `gateway/__tests__/membership.test.ts` | Created - 17 tests covering all routes |
| `gateway/src/middleware.ts` | Modified - added `/api/membership` to protected paths |

## Routes Implemented

1. **GET /api/auth/profile** — Reads user info + membership from DB via `x-user-id` header (set by middleware). Returns full membership snapshot (tier, quotas, balance).

2. **POST /api/membership/upgrade** — Accepts `{ tier: "subscription" | "pay-as-you-go" }`. Sets `search_quota_monthly=1000` for subscription, `payg_balance=0` for pay-as-you-go. Blocks downgrading from subscription via this endpoint.

3. **POST /api/membership/downgrade** — Admin/system endpoint. Only works on subscription tier; resets to free with default quotas.

## Key Design Decisions

- Upgrade endpoint checks current tier to prevent downgrade abuse
- Downgrade validates current tier === "subscription" before proceeding
- All 3 routes get `x-user-id` from middleware (which also handles 401 for missing/bad tokens)
- Valid tiers array used to reject invalid upgrade targets

## Acceptance Criteria Coverage

- [x] 1. GET /api/auth/profile returns full membership info (tested)
- [x] 2. POST /api/membership/upgrade accepts {tier} → updates (tested: subscription & payg)
- [x] 3. POST /api/membership/downgrade subscription → free (tested)
- [x] 4. No userId header returns 401 (tested on all 3 routes)
- [x] 5. Invalid tier returns 400 (tested)
- [x] 6. DB errors return 500 (tested on all 3 routes)

## Test Results

```
 4 test files passed | 29 tests passed | 177ms
```

- 4 existing JWT/middleware/validation tests still pass
- 17 new membership tests pass:
  - Profile: 4 tests (401, 200, 404, 500)
  - Upgrade: 7 tests (401, 400 invalid tier, 400 empty tier, 400 downgrade block, 200 subscription, 200 payg, 404, 500)
  - Downgrade: 5 tests (401, 200, 400 non-subscription, 404, 500)

## Commits

- `e858bb9` feat: add member status management routes

## Report File

`C:\Users\Administrator\Desktop\opencode\.superpowers\sdd\reports\task-1.11-report.md`
