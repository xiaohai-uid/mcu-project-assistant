# Task 1.16 — 按量计费系统

## Acceptance Criteria
1. `consumePaygBalance(userId, cost?)` in daily-quota.ts — deducts `cost` (default 1.00) from `payg_balance` for pay-as-you-go users
2. `POST /api/billing/topup` — body `{ amount }`, adds to payg_balance, returns 200 `{ balance, message }`
3. `GET /api/billing/balance` — returns `{ balance, tier }`
4. All billing routes require x-user-id (JWT auth)
5. Tests: topup, balance, deduction, invalid amount, 401

## Context
- Schema: `payg_balance DECIMAL(10,2) DEFAULT 0` in memberships
- Existing `consumeSearchQuota` increments search_quota_used but doesn't deduct balance
- `checkSearchQuota` already checks `payg_balance > 0` for pay-as-you-go
- Add `/api/billing` to middleware protectedPaths

## Implementation files
- **Modify:** `gateway/src/middleware.ts` — add `/api/billing` to protectedPaths
- **Modify:** `gateway/src/lib/daily-quota.ts` — add `consumePaygBalance()`
- **Create:** `gateway/src/app/api/billing/topup/route.ts`
- **Create:** `gateway/src/app/api/billing/balance/route.ts`
- **Modify:** `gateway/__tests__/daily-quota.test.ts` — add consumePaygBalance tests
- **Create:** `gateway/__tests__/billing.test.ts` — topup + balance route tests

## Output
Return files modified and full test results.