# Task 1.15 — API Key 验证中间件

## Acceptance Criteria
1. **Create:** `gateway/src/lib/api-key-resolver.ts` — `resolveDecryptedApiKey(userId: string): Promise<string | undefined>`
   - Queries `SELECT key_value_encrypted FROM api_keys WHERE user_id=$1 AND is_active=true AND key_type='ai'`
   - Decrypts using `decrypt()` from `encryption.ts`
   - Returns raw (decrypted) API key or undefined if no active key
2. **Fix bug:** `projects/start/route.ts` currently passes `key_value_encrypted` (encrypted) to `resolveModelConfig` — should pass decrypted key
3. Replace inline key query + find with `resolveDecryptedApiKey()` call
4. Tests: unit test for resolveDecryptedApiKey, all existing route tests still pass

## Context
- Bug: line 50 passes `aiKey?.key_value_encrypted` (encrypted) as `apiKey` in ModelConfig — should be decrypted first
- `encryption.ts`: `encrypt(text)` / `decrypt(encryptedText)`
- `resolveModelConfig(tier, userApiKey?)` — expects DECRYPTED key for `modelConfig.apiKey`
- The AI service needs the raw key, not the stored encrypted form

## Implementation files
- **Create:** `gateway/src/lib/api-key-resolver.ts`
- **Modify:** `gateway/src/app/api/projects/start/route.ts` — use resolveDecryptedApiKey, fix the bug
- **Modify:** `gateway/__tests__/api-keys.test.ts` — add tests for resolveDecryptedApiKey

## Output
Return the files modified and test results.
