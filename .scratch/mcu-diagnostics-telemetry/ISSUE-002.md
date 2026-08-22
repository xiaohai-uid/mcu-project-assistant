# ISSUE-002: 硬化客户端错误上报的速率限制

Status: ready-for-agent
Type: task
Priority: P1（公测暴露面，直接违反 PRD MUST 的"服务端速率限制"）
Blocked by: 无

## 问题（code-review Spec 轴 #c1）

1. 限流键取第一个 `x-forwarded-for` 值——客户端可伪造，轮换该头即可击穿限流。
2. `clientReportHits` Map 只增不删，过期条目永不清理——公测期内存无限增长。

## DoD

- [ ] 限流键不可被单客户端轮换头击穿：以 socket 远端地址为信任根；仅当存在可信反代（部署配置声明）时才解析 XFF 链右起第一个非可信跳。
- [ ] Map 有界：写入时懒清理过期项 + 硬上限（超限整体重置或 LRU），常驻内存有确定上界。
- [ ] 回归测试：伪造轮换 XFF 无法获得超出配额的接受数；持续上报不会使 Map 超过上限。
- [ ] 全量门禁绿。

## Comments

- 2026-08-22 zcode: 来源 = /code-review dadc46a...HEAD Spec 轴发现 (c)1。
