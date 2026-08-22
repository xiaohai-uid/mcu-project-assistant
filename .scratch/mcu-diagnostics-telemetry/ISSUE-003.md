# ISSUE-003: 客户端错误行可关联到服务端请求日志

Status: resolved
Type: task
Priority: P2
Blocked by: 无

## 问题（code-review Spec 轴 #a2）

PRD 要求「请求关联 ID（x-request-id）贯穿请求日志与错误记录」，但 `client.error` 行的 `correlationId` 存的是客户端自造 `sessionId`，与服务端请求日志无法 join——运营者看到客户端错误后找不到对应请求上下文，诊断闭环断在最后一环。

## 切片方向（agent 实现时定 mechanics）

- 上报端点 `/client-errors` 自身是一个带 `x-request-id` 的请求：入库时以**该请求的 requestId** 作为 client.error 的 correlationId（最小正确解）。
- sessionId 降级为 data 字段保留（同浏览器多错误的聚合键仍有用）。
- 契约注意：MUST NOT「不改变现有 API 行为」——这是增量字段语义修正而非破坏性变更，在测试里固化新行为。

## DoD

- [x] 测试：POST /client-errors 产生的 event_log 行 correlationId == 该请求的 x-request-id 响应头值。
- [x] 既有 sessionId 不丢失（data 内可查）。
- [x] 全量门禁绿。

## Comments

- 2026-08-22 zcode: 来源 = /code-review dadc46a...HEAD Spec 轴发现 (a)2。
