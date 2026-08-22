# ISSUE-002: 硬化客户端错误上报的速率限制

Status: resolved
Type: task
Priority: P1（公测暴露面，直接违反 PRD MUST 的"服务端速率限制"）
Blocked by: 无

## 问题（code-review Spec 轴 #c1）

1. 限流键取第一个 `x-forwarded-for` 值——客户端可伪造，轮换该头即可击穿限流。
2. `clientReportHits` Map 只增不删，过期条目永不清理——公测期内存无限增长。

## DoD

- [x] 限流键不可被单客户端轮换头击穿：以 socket 远端地址为信任根；仅当存在可信反代（部署配置声明）时才解析 XFF 链右起第一个非可信跳。
- [x] Map 有界：写入时懒清理过期项 + 硬上限（超限整体重置或 LRU），常驻内存有确定上界。
- [x] 回归测试：伪造轮换 XFF 无法获得超出配额的接受数；持续上报不会使 Map 超过上限。
- [x] 全量门禁绿。

## Comments

- 2026-08-22 zcode: 来源 = /code-review dadc46a...HEAD Spec 轴发现 (c)1。
- 2026-08-22 implement-agent: 落地为 `src/shared/client-rate-limit.ts`（resolveClientAddress 信任根 + createClientRateLimiter 有界固定窗口，LRU 淘汰）。code-review 双轴复审后加固两处：① socket 对端本身必须命中可信列表才解析 XFF（堵直连源站绕过）；② IP 校验改用 `net.isIP`。配置入口 `MCU_TRUSTED_PROXIES`（逗号分隔 IP 字面量，非法即启动失败）。证据：契约测试轮换 XFF 60+1 → 429、直连绕过 60+1 → 429、单测 500 键压力 size ≤ cap；全量门禁 103 files / 616 passed / 1 skipped。
