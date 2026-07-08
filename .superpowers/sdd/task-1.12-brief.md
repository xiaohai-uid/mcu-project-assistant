# Task 1.12: UsageQuota 计数器

**Layer:** 1B — 用户与会员系统
**所属服务:** Gateway (Next.js App Router, TypeScript)

## 需求

实现用量配额计数与限制，包括每日 AI 调用配额和每月搜索配额。

### 已有基础设施

- `gateway/src/lib/daily-quota.ts` — 已有 `checkDailyQuota()` 和 `consumeDailyQuota()` 函数
- `shared/database/schema.sql` — memberships 表有 daily_quota_remaining, daily_quota_reset_at, search_quota_monthly, search_quota_used
- `gateway/src/app/api/projects/start/route.ts` — 项目启动路由（需要集成配额检查）

### 需要实现

**1. 增强每日配额检查**
- 在 propose 项目请求时检查每日配额
- 配额用完返回 429 { error: "Daily quota exceeded", quotaType: "daily" }
- 免费用户: 每日 10 次调用限制
- hasKey 用户: 无每日配额限制（用自己的 Key）

**2. 月末配额重置**
- 每月 1 日自动重置 search_quota_used = 0
- 使用 `updated_at` 字段判断是否跨月

**3. 搜索配额计数**
- 每次搜索扣减 (consumeSearchQuota)
- subscription 用户: 1000 次/月
- pay-as-you-go 用户: 按 search_quota_used 计数（超限需充值，payg_balance > 0）
- 超限返回 429 { error: "Search quota exceeded", quotaType: "search" }

**4. 查询配额接口**
- GET /api/quota — 返回当前用户的配额状态（daily remaining, search remaining, monthly total）

## 验收标准

1. 免费用户每日配额 10 次，用完返回 429
2. hasKey 用户跳过每日配额检查
3. subscription 用户每月 1000 次搜索配额
4. pay-as-you-go 用户按次计费
5. GET /api/quota 返回完整配额状态
6. 日期变更时自动重置配额
7. 所有函数都有单元测试
