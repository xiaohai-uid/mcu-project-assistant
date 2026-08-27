# Task 1.10: 用户注册/登录

**Layer:** 1B — 用户与会员系统

**所属服务:** Gateway (Next.js App Router, TypeScript)

## 需求

### 注册

- 用户使用邮箱 + 密码注册
- 密码 bcrypt 哈希存储 (已有 bcryptjs 依赖)
- 注册后自动创建 membership (free tier, daily_quota_remaining=10)
- 输入验证: email 格式、密码强度 (>=8位)
- 邮箱唯一性检查
- REST API: POST /api/auth/register

### 登录

- 邮箱 + 密码登录
- 验证通过后签发 JWT token (使用 jsonwebtoken 库)
- JWT 有效期: 7天
- REST API: POST /api/auth/login

### 中间件

- 实现 Next.js 中间件 middleware.ts 自动验证 JWT
- 受保护路由前缀: /api/projects/*, /api/auth/profile*
- 将用户信息注入请求头 (x-user-id, x-membership)

### 已存在的相关文件

- `shared/database/schema.sql` — users 和 memberships 表已存在
- `gateway/src/lib/database.ts` — Postgres 连接池
- `gateway/src/lib/models.ts` — Membership 类型, RequestContext 类型
- `gateway/src/app/api/auth/register/route.ts` — 已有基础注册实现 (需要加强验证)

## 验收标准

1. POST /api/auth/register 接受 {email, password} → 返回 {userId, email}
2. POST /api/auth/login 接受 {email, password} → 返回 {token, userId, email, membership}
3. 无效输入返回 400 + 错误描述
4. 重复邮箱返回 409
5. 错误密码返回 401
6. middleware.ts 保护 /api/projects/* 路由
7. 无 token 请求返回 401
8. JWT 包含 userId, email, membership 字段
