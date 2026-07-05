# Task 1.14 — API Key 加密存储与安全管理

## Acceptance Criteria
1. `POST /api/keys` — create API key: body `{ label, keyType }`, generates UUID, encrypts key_value, stores in api_keys. Returns 201 with `{ id, label, keyType, createdAt }`
2. `GET /api/keys` — list user's active API keys: returns array of `{ id, label, keyType, createdAt }`. Never returns the raw key value.
3. `DELETE /api/keys/:id` — revoke key: sets `is_active=false, revoked_at=NOW()`. Returns 200.
4. `POST /api/keys/:id/rotate` — revoke old key + create new one with same key_type. Returns new key metadata.
5. All routes require `x-user-id` header (injected by middleware). Return 401 if missing.
6. Tests: create, list, revoke, rotate, 401 without header, 404 on unknown id, validation for missing fields

## Context
- Schema: `api_keys(id UUID PK, user_id UUID FK, key_type VARCHAR, key_value_encrypted TEXT, label VARCHAR, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP, revoked_at TIMESTAMP)`
- Encryption: `gateway/src/lib/encryption.ts` has `encrypt(text)` / `decrypt(text)` — AES-256-GCM
- Key types from models.ts: `key_type` values like "ai" (AI API key from user)
- Route style: follow `POST /api/membership/upgrade` in `gateway/src/app/api/membership/upgrade/route.ts` for patterns
- All routes read `x-user-id` from request headers
- Use `db.query()` for all DB operations
- UUID: use `v4 as uuidv4` from `"uuid"` (already imported in other routes)

## Implementation files
- **Create:** `gateway/src/app/api/keys/route.ts` — POST and GET
- **Create:** `gateway/src/app/api/keys/[id]/route.ts` — PATCH (revoke) and POST (rotate)
- **Create:** `gateway/__tests__/api-keys.test.ts` — all tests

## Output
Return the list of files created/modified and test results.
