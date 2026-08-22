# ISSUE-001: Diagnostics & Flywheel Foundation

Status: resolved
Type: task
OVERRIDE: 卫星解冻单项（用户 2026-08-21 当次指令）

## 切片内容

迁移 v14 event_log → store+单测 → logger → 持久化 EventPort 组合适配器 → HTTP（requestId/请求日志/错误持久化/客户端上报/运营者诊断读取）→ 前端全局错误捕获 → 全量门禁 → 部署 smoke。

## DoD

- PRD MUST 全部满足；全量门禁绿；[E2] 本地往返 + [E3] 托管 smoke 各留证据。

## Comments

- 2026-08-21 zcode: 实现完成，见最终交付报告与 vault 记录。
