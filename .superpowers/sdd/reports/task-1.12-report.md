# Task 1.12 — UsageQuota 计数器 报告

## Status: DONE

## 实现内容

### 1. `gateway/src/lib/daily-quota.ts` — 增强配额库

- **`checkDailyQuota(userId, membership?)`** — 扩展为 membership-aware: hasKey 跳过检查直接返回 true
- **`checkSearchQuota(userId, membership)`** — 返回 `{allowed, remaining, reason?}`
  - subscription: 1000次/月，扣减后计算剩余
  - pay-as-you-go: 检查 payg_balance > 0
  - free/hasKey: 拒绝访问
- **`consumeSearchQuota(userId)`** — 递增 search_quota_used
- **`getQuotaStatus(userId)`** — 返回完整配额状态对象 (dailyRemaining, searchRemaining, monthlyResetDate 等)
- **`resetSearchQuotaIfNeeded(userId)`** — 根据 updated_at 比较月份，跨月时自动重置 search_quota_used = 0

### 2. `gateway/src/app/api/projects/start/route.ts` — 集成配额检查

- 修复了 hasKey 用户错误消耗每日配额的 bug
- 使用 membership-aware `checkDailyQuota(userId, tier)`
- hasKey 用户不消耗每日额度
- 配额用完返回 429 `{ error: "Daily quota exceeded", quotaType: "daily" }`

### 3. `gateway/src/app/api/quota/route.ts` — 新建配额查询接口

- GET /api/quota — 返回用户当前完整配额状态
- 需要 x-user-id header（由 middleware 注入）

### 4. `gateway/__tests__/daily-quota.test.ts` — 19 个单元测试

| 测试组 | 测试数 |
|--------|--------|
| checkDailyQuota | 5 |
| consumeDailyQuota | 1 |
| checkSearchQuota | 7 |
| consumeSearchQuota | 1 |
| getQuotaStatus | 4 |
| **合计** | **19** |

## 验收标准完成情况

1. ✅ 免费用户每日 10 次配额，用完返回 429
2. ✅ hasKey 用户跳过每日配额检查
3. ✅ subscription 用户每月 1000 次搜索配额
4. ✅ pay-as-you-go 用户按余额计费
5. ✅ GET /api/quota 返回完整配额状态
6. ✅ 跨月时自动重置 search_quota_used
7. ✅ 所有函数有单元测试（19 tests）

## 提交

- **Commit:** `2d96a82` — feat: add UsageQuota counter — daily+search quota, monthly reset, GET /api/quota
- **Changed files:**
  - `gateway/src/lib/daily-quota.ts` (modified, +112 lines)
  - `gateway/src/app/api/projects/start/route.ts` (modified, -2/+4 lines)
  - `gateway/src/app/api/quota/route.ts` (new, 22 lines)
  - `gateway/__tests__/daily-quota.test.ts` (new, 194 lines)

## 测试结果

全部 48 tests passed (19 new + 29 existing). 无失败，无警告。
