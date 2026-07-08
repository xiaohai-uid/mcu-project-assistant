# Task 1.14 — API Key 加密存储与安全管理 报告

## Status: DONE

## 实现内容

### 1. `gateway/src/app/api/keys/route.ts` — POST + GET

- **POST /api/keys** — 创建 API Key
  - body: `{ label, keyType }`
  - 生成原始 key 值 (UUID), AES-256-GCM 加密后存入 api_keys
  - 返回 201 `{ id, label, keyType, createdAt }`
  - 验证: 401 无 x-user-id, 400 缺 label/keyType
- **GET /api/keys** — 列出用户有效 Key
  - 返回 `{ id, label, keyType, createdAt }` 数组
  - 不返回原始 key 值

### 2. `gateway/src/app/api/keys/[id]/route.ts` — PATCH + POST

- **PATCH /api/keys/:id** — 撤销 Key
  - `is_active=false, revoked_at=NOW()`
  - 404 不存在时
- **POST /api/keys/:id** — 轮换 Key
  - 撤销旧 Key + 创建同 key_type 的新 Key
  - 返回 201 `{ id, label, keyType, createdAt }`

### 3. `gateway/__tests__/api-keys.test.ts` — 17 个测试

| 分组 | 测试数 |
|------|--------|
| POST /api/keys | 5 |
| GET /api/keys | 4 |
| PATCH /api/keys/:id | 4 |
| POST /api/keys/:id (rotate) | 4 |
| **合计** | **17** |

## 验收标准完成情况

1. ✅ POST /api/keys 创建 Key 并加密存储
2. ✅ GET /api/keys 列表不返回原始 key 值
3. ✅ PATCH /api/keys/:id 撤销 Key
4. ✅ POST /api/keys/:id 轮换 Key
5. ✅ 所有路由检查 x-user-id
6. ✅ 17 个测试全部通过

## 变更文件

- **New:** `gateway/src/app/api/keys/route.ts`
- **New:** `gateway/src/app/api/keys/[id]/route.ts`
- **New:** `gateway/__tests__/api-keys.test.ts`
