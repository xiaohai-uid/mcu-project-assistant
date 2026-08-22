# ISSUE-006: 诊断切片卫生清理（可选，低优先）

Status: resolved
Type: task
Priority: P3（不阻塞任何门禁；适合闲时或随下一诊断提交顺路）
Blocked by: 002, 003, 004（避免与缺陷修复改同一处代码）

## 内容（code-review Standards 轴 judgement calls 汇总）

1. 删死代码：`logger.ts` 的 `child()`（零调用）、`createMemoryEventLog`（测试用的是真 store）；`parseLogLevel` 去留取决于 002~004 修复后 config.ts 是否改调它（若仍无调用方则删）。
2. `event-log-store.ts`：SQLite 与 memory 两套 `summary()`/`list()` 提取共享聚合/过滤助手。
3. `app.ts`：`asBoundedString(body.stack, 16_000)` 重复计算合一。
4. 命名：`requireOperator` 兼管存储不可用 503，改名或拆分以暴露第二重门。
5. 归位：`newCorrelationId()` 从 SQLite 适配器迁到中性位置（HTTP 层在用）。
6. Data Clumps 观察项（暂不动）：`{ logger, eventLog }` 与 `{ code, path, method, requestId }` 结伴——下次诊断相关提交时再评估是否捆 `RequestObservation` 类型。

## DoD

- [x] 1–5 完成，全量门禁绿；6 仅记录不实施。

## Comments

- 2026-08-23 agent: item 2 随 item 1 消解——createMemoryEventLog 零调用即删（Speculative Generality），单实现无可提取。
- 2026-08-23 agent: parseLogLevel 确认死代码（config.ts 内联解析 MCU_LOG_LEVEL）；logger.child 接口+实现、createMemoryEventLog 一并删除。
- 2026-08-23 agent: newCorrelationId 迁至 src/shared/correlation-id.ts；requireOperator 更名 requireOperatorDiagnostics 并注释双门（凭据 403 / 存储 503）。
- 2026-08-23 agent: item 6（{ logger, eventLog } 与 { code, path, method, requestId } data clumps）按票面仅记录，不实施。

## Comments

- 2026-08-22 zcode: 来源 = /code-review dadc46a...HEAD Standards 轴全部发现。Speculative Generality 原则：删到有真实需求再加回。
