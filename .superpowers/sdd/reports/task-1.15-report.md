# Task 1.15 — API Key 验证中间件 报告

## Status: DONE

## 实现内容

### 1. `gateway/src/lib/api-key-resolver.ts` — 新建共享工具

- `resolveDecryptedApiKey(userId)` — 查询用户有效 AI Key 并解密返回
- 使用 `decrypt()` 从 `encryption.ts` 进行 AES-256-GCM 解密
- 无有效 Key 时返回 undefined

### 2. `gateway/src/app/api/projects/start/route.ts` — 修复加密 Key BUG

- **Bug**: 原代码将 `key_value_encrypted`（加密态）直接传给 `resolveModelConfig`
- **Fix**: 改为 `resolveDecryptedApiKey(userId)` 获得解密后的 Key 再传入

### 3. `gateway/__tests__/api-keys.test.ts` — 新增 + 修复

- 新增 `resolveDecryptedApiKey` 测试块 (3 tests)
- 修复 GET `returns 500` 测试中未定义变量的预存 bug

## 变更文件

- **New:** `gateway/src/lib/api-key-resolver.ts`
- **Modified:** `gateway/src/app/api/projects/start/route.ts`
- **Modified:** `gateway/__tests__/api-keys.test.ts`

## 测试结果

**90 tests passed** (7 files), 0 failures.
