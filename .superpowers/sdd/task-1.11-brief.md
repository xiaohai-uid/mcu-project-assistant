# Task 1.11: 会员状态管理

**Layer:** 1B — 用户与会员系统
**所属服务:** Gateway (Next.js App Router, TypeScript)

## 需求

实现会员状态读取和变更管理。已有 `memberships` 表和 `Membership` 类型（free/hasKey/subscription/pay-as-you-go）。

### 读取会员信息

- GET /api/auth/profile — 读取当前用户会员信息
  - 需要 JWT 认证（middleware 已保护 /api/auth/profile）
  - 返回: { userId, email, membership (tier), dailyQuotaRemaining, searchQuotaMonthly, searchQuotaUsed, paygBalance }
  - 查询 memberships 表关联到当前用户

### 会员升级

- POST /api/membership/upgrade
  - 接受 { tier: "subscription" | "pay-as-you-go" }
  - `hasKey` 不需要后端操作（用户只需绑 Key，不与计费相关）
  - subscription: 更新 tier, 设置 search_quota_monthly=1000
  - pay-as-you-go: 更新 tier, 设置 payg_balance=0（用户后续充值）
  - 不能 downgrade subscription → free（需先人工处理，但需要端点标记过期）
  - 返回更新后的会员信息

### 会员过期/降级

- POST /api/membership/downgrade
  - 管理员或系统调用：将 subscription 降级为 free
  - 重置配额
  - 记录变更时间

### 已存在的相关文件

- `gateway/src/lib/database.ts` — Postgres 连接池
- `gateway/src/lib/models.ts` — Membership 类型 (free/hasKey/subscription/pay-as-you-go)
- `gateway/src/middleware.ts` — JWT 中间件（已保护 /api/auth/profile）
- `gateway/src/lib/jwt.ts` — JWT 工具
- `shared/database/schema.sql` — memberships 表（tier, daily_quota_remaining, search_quota_monthly, search_quota_used, payg_balance）

## 验收标准

1. GET /api/auth/profile 返回用户完整会员信息
2. POST /api/membership/upgrade 接受 {tier} → 更新成功
3. POST /api/membership/downgrade 将 subscription → free
4. 无 token 访问 protected routes 返回 401
5. 无效 tier 返回 400
6. 数据库操作失败返回 500
