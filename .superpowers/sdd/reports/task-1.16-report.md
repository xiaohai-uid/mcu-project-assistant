# Task 1.16 — 按量计费系统 报告

## Status: DONE

## 实现内容

### 1. `gateway/src/lib/daily-quota.ts` — 新增 `consumePaygBalance()`

- 按搜索扣费: 从 `payg_balance` 扣除 `SEARCH_COST` (默认 1.00)
- 余额不足时 UPDATE 不生效，返回 false
- 仅对 `tier = 'pay-as-you-go'` 用户生效

### 2. `gateway/src/app/api/billing/topup/route.ts` — 预充值

- POST /api/billing/topup, body: `{ amount }`
- 验证 amount > 0, 更新 payg_balance, 返回 `{ balance, message }`

### 3. `gateway/src/app/api/billing/balance/route.ts` — 余额查询

- GET /api/billing/balance, 返回 `{ balance, tier }`
- 用户不存在返回 404

### 4. `gateway/src/middleware.ts` — 添加 billing 路由保护

- `/api/billing` 加入 `protectedPaths`

### 5. 测试

| 文件 | 新增测试数 |
|------|-----------|
| daily-quota.test.ts | 4 (consumePaygBalance) |
| billing.test.ts | 11 (topup + balance) |
| **合计** | **15 新增** |

## 验收标准完成情况

1. ✅ consumePaygBalance 扣费函数 (默认 $1.00/次)
2. ✅ POST /api/billing/topup 预充值
3. ✅ GET /api/billing/balance 余额查询
4. ✅ JWT 保护 (billing 路由)
5. ✅ 15 个新测试，总计 **105 tests passed**

## 变更文件

- **Modified:** `gateway/src/middleware.ts`
- **Modified:** `gateway/src/lib/daily-quota.ts`
- **Modified:** `gateway/__tests__/daily-quota.test.ts`
- **New:** `gateway/src/app/api/billing/topup/route.ts`
- **New:** `gateway/src/app/api/billing/balance/route.ts`
- **New:** `gateway/__tests__/billing.test.ts`
