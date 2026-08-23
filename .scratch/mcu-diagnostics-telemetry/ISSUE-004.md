# ISSUE-004: 消除 5xx 失败的 event_log 双写

Status: resolved
Type: task
Priority: P2
Blocked by: 无

## 问题（code-review Spec 轴 #c2）

一次 500 现在写两行：`api.error`（error.ts 边界）+ `http.request` warn/error（app.ts finish 处理器）。噪声大，且加速撞 event_log 的 20k 行裁剪上限——上限本该留给多样性事件而不是同一失败的复制品。

## 切片方向（agent 实现时定 mechanics）

- 定单一事实源：建议 `api.error` 承载失败细节，`http.request` 对 ≥500 只记请求完成指标、不再 append eventLog（或反之），二选一，测试固化。
- 与 Standards 轴发现协同：error.ts 三段重复块在本票内顺手提取为单一 `recordApiError()` 助手（同文件小重构，不另开票）。

## DoD

- [x] 测试：任一 5xx 请求恰好产生一行 error 类事件。
- [x] error.ts 不再有重复的事件记录块。
- [x] 全量门禁绿。

## Comments

- 2026-08-23 agent: code-review 追加发现——drain 中间件直发 503 原本依赖 finish 处理器的 http.request 行获得唯一记录，≥500 停写后变零行；已让该路径同样走 recordApiError（warn 级 api.error），排队拒绝与 handleEvents 抛错语义统一。
- 2026-08-23 agent: 同步 handler 的 throw 会穿透 withErrorHandler 落入 express 默认边界，ApiError 声明状态码被降级为 500——已修（try/catch 包裹调用），server_draining 503 恢复正确状态码且 warn 分支不再死代码。

## Comments

- 2026-08-22 zcode: 来源 = /code-review dadc46a...HEAD Spec 轴 (c)2 + Standards 轴 Duplicated Code #2（合并处置）。
- 2026-08-23 agent: 可玩状态机原型（检验写入决策表自洽性）已存于分支 `prototype/diagnostics-event-pipeline` 的 `.scratch/prototype-diagnostics-pipeline.html`；纯模块经 13 条行为断言与真实管线语义一致。建模中发现证据文档一处表述失准（解析失败路径亦无 stdout 指标行），已在 docs/audit/diagnostics-gate-evidence-2026-08-23.md 更正。
