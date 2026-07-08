# Task 1.10 Report: 用户注册/登录

## Status: DONE

## Summary

Implemented user registration (POST /api/auth/register), login (POST /api/auth/login), JWT authentication utility, and Next.js middleware for protected routes.

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `gateway/src/lib/jwt.ts` | Created | JWT sign/verify utility, 7-day expiry, userId+email+membership payload |
| `gateway/src/app/api/auth/register/route.ts` | Modified | Added input validation (email/password), duplicate email check (409), error responses |
| `gateway/src/app/api/auth/login/route.ts` | Created | Email+password auth, bcrypt verify, JWT issue, membership lookup |
| `gateway/src/middleware.ts` | Created | Protects /api/projects/* and /api/auth/profile, injects x-user-id/x-membership |
| `gateway/vitest.config.ts` | Created | Vitest config with @ alias resolution |
| `gateway/__tests__/jwt.test.ts` | Created | 4 tests: sign/verify, invalid token, tampered token, payload fields |
| `gateway/__tests__/validation.test.ts` | Created | 4 tests: email format (valid/reject), password length |
| `gateway/__tests__/middleware.test.ts` | Created | 3 tests: token creation, invalid token, header injection |
| `gateway/package.json` | Modified | Added vitest, test/test:watch scripts |

## Acceptance Criteria Coverage

- [x] POST /api/auth/register accepts {email, password} → returns {userId, email}
- [x] POST /api/auth/login accepts {email, password} → returns {token, userId, email, membership}
- [x] Invalid input → 400 + error description (both routes)
- [x] Duplicate email → 409 (register)
- [x] Wrong password → 401 (login)
- [x] middleware.ts protects /api/projects/* routes
- [x] No token → 401
- [x] JWT contains userId, email, membership

## Test Results

```
✓ 11 passing (3 test files)
```

## Commit

```
6248e45 feat: add user registration, JWT login, and auth middleware
```

## Concerns

- The existing codebase had pre-existing `tsc --noEmit` errors with `@/` path aliases (Next.js resolves these at runtime). Not introduced by this task.
- Routes depend on a running Postgres database for end-to-end testing; unit tests cover JWT, validation, and middleware logic.

## Code Review Fixes (2026-07-05)

### Issues Fixed

| # | Issue | Fix |
|---|-------|-----|
| 1 | Middleware tests didn't test actual middleware | Rewrote `middleware.test.ts` to import `middleware` from `@/middleware`, construct real `NextRequest` objects, call `middleware(req)`, and assert on response status |
| 2 | Validation tests were tautological (tested own constant) | Extracted validation to `gateway/src/lib/validation.ts` (`isValidEmail`, `isValidPassword`), rewrote `validation.test.ts` to test the real functions |
| 3 | Duplicated email regex in register and login routes | Both routes now import `isValidEmail` from `@/lib/validation` |
| 4 | Broad catch blocks returning 400 for all errors | Changed catch blocks to `console.error(error)` + return 500; validation errors already return 400 before catch |
| 5 | Weak email regex (accepted double dots) | Updated `EMAIL_RE` to `/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/` — requires 2+ alpha TLD characters |

### Files Changed

| File | Action | Description |
|------|--------|-------------|
| `gateway/src/lib/validation.ts` | Created | Extracted `isValidEmail`, `isValidPassword` validation functions |
| `gateway/src/app/api/auth/register/route.ts` | Modified | Import validation from lib; improved catch block (console.error + 500) |
| `gateway/src/app/api/auth/login/route.ts` | Modified | Import validation from lib; improved catch block (console.error + 500) |
| `gateway/__tests__/validation.test.ts` | Rewritten | Now tests real `isValidEmail`/`isValidPassword` from `@/lib/validation` |
| `gateway/__tests__/middleware.test.ts` | Rewritten | Now imports and calls actual `middleware` function with `NextRequest` |

### Test Results

```
✓ 12 passing (3 test files)
```

| File | Tests |
|------|-------|
| `__tests__/jwt.test.ts` | 4 passed |
| `__tests__/validation.test.ts` | 4 passed |
| `__tests__/middleware.test.ts` | 4 passed |
