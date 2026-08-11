# ISSUE-003 — S3A Requirement Analysis + Clarification end-to-end

**Status:** resolved（2026-08-11，交付记录见下）
**Blocked by:** ISSUE-002（Manual Artifact Version e2e）
**Priority:** P0-blocking

## 1. User-visible outcome

用户在 Requirements 视图输入描述并开始解析：看到流式分析输出（可取消、可重试、Provider 不可用时明确降级）；模糊项出现澄清卡（可多轮回答或跳过）；完成后能力卡（complete/partial/pending）展示。**本票不产生正式版本**（提案与写入在 S3B）。

## 2. Frozen upstream references

- UI：Requirements 视图（流式/澄清卡/能力卡）、ui-state-model.md（W1/W2/W3/W19、G4/G7、O2）
- Interaction Contract：B1 Analyze / B2 Cancel / B3 Retry / B4 Submit Clarification
- Application Capability：analyze_requirement / submit_clarification（application-contract 2.2/2.3，多轮 roundId）
- Domain Invariant：I-12（Clarification 不提升 Aggregate，Analysis Session 交互记录）；分析期间不写 artifact
- Product Decision：D7（多轮澄清）
- ADR：0010（AI Provider Port；mock 为真实适配器）、0007（任务执行 Port）、0008（事件传输 SSE）、0013
- Implementation Spec：§4、§9（PersistencePort）、§10.1（/commands、/commands/:taskId/clarification、/cancel）、§10.3 SSE、§15 S3A
- Logical Events：requirement.analysis.*（含 clarification.requested roundId）

## 3. In scope

- AIProviderPort（generateStructured/stream/cancel/provider 错误）→ **Mock 适配器**（冻结 UI 脚本数据 = 行为契约源；真实 provider 适配器接口留待后续）
- TaskExecutionPort 最小实现（in-process runner + SQLite tasks 表；崩溃恢复 running→queued）；tasks 表
- analyze_requirement capability：POST /projects/:id/commands {capability:"analyze_requirement"} → 202 {taskId}；流式事件经 SSE（/projects/:id/events）；Cancel（/commands/:taskId/cancel）；Retry（幂等键重发）
- submit_clarification：POST /commands/:taskId/clarification {answer|skip}（roundId 递增）
- SSE 最小实现：事件帧 + 断线恢复 = 重连后 Query 任务状态（GET /commands/:taskId）→ 续流；**无 replay/ring buffer**
- 能力卡内容（capabilities）作为分析结果展示；analysis 结果暂存任务结果（tasks 表 output），不写 artifact 版本
- ProviderUnavailable / Offline 降级路径（provider.unavailable 事件；UI 冻结状态复用）

## 4. Out of scope

- Proposal 创建/决策（S3B）；需求 artifact 版本写入（S3B）
- 真实 LLM 适配器（openai/gemini 接入——后续；本票只有 mock 适配器 + Port 接口）
- Event Store/replay/ring buffer；WebSocket
- 其余 capability 的 /commands 分支（recommend/generate 等——各自 Slice）

## 5. Mock being replaced

```
mockRunDiscoveryScript（UI 内脚本：流式/澄清/能力卡）
→ real analyze_requirement（server capability + AI mock adapter + SSE 流）
mock cancelDiscovery / retry（内存标志）
→ real /commands/:taskId/cancel + 幂等重发
mock clarification 单轮卡
→ real submit_clarification（roundId 多轮）
```

## 6. End-to-end flow

```
UI 描述 → POST /projects/:id/commands {capability:"analyze_requirement", payload:{description}}
→ 202 {taskId} → TaskExecutionPort.submit → in-process runner
→ AIProviderPort.stream（mock 脚本，逐段）→ EventPort.publish（SSE: requirement.analysis.progress）
→ 检测模糊 → clarification.requested（roundId=1）→ UI 澄清卡
→ POST /commands/:taskId/clarification {answer} → 继续 → analysis.completed {capabilities}
→ UI 能力卡（complete/partial/pending）
→ 中途：POST /commands/:taskId/cancel → analysis.cancelled（无写入）
→ Provider 不可用：provider.unavailable 事件 + UI 横幅（可重试）
```

## 7. Minimum domain changes

- 无新领域对象（Clarification 是 Analysis Session 交互记录，不建对象——D7）
- 仅任务/分析的状态描述（tasks 表 status + output）

## 8. Minimum persistence changes

- 表：tasks（capability/input/status/created_at/started_at/completed_at/error）
- 无其他新表

## 9. Ports / Adapters

- AIProviderPort → mock 适配器（真实 provider 适配器后续）
- TaskExecutionPort → in-process runner（+ SQLite tasks 表）
- EventPort → SSE 适配器（/projects/:id/events，最小实现）
- PersistencePort 扩展：UoW 增 saveTask/updateTask/claimNextTask；只读 getTask

## 10. Error states

- 503 ProviderUnavailable（合法降级）；400 空描述；409 invalid_round（澄清轮次不符）；Cancelled（终态事件）；Retry 幂等

## 11. Tests first

- Domain：分析期间零 artifact 写入；澄清 roundId 递增
- Application：analyze_requirement（流式事件序、取消、重试幂等、provider 降级）
- Persistence：tasks 表状态迁移、崩溃恢复（running→queued）
- Contract/SSE：事件帧格式、终态事件、断线→Query 状态→续流（无 replay）
- Browser/E2E：见 §12

## 12. Browser acceptance

```
项目 → Requirements → 输入描述 → 开始解析
→ 流式输出可见 → 澄清卡出现（roundId 1）
→ 回答 → 能力卡出现（3/4 或 4/4）
→ 再次解析（慢速模式）→ 取消 → "已取消"提示
→ Lab 触发 ProviderUnavailable → 解析被禁 + 横幅 → 恢复后重试成功
```

## 13. Definition of Done

- typecheck/lint/test 绿（含 SSE 契约测试）；e2e:golden 相关用例绿
- 浏览器验收全过；Mock runDiscoveryScript 生产路径删除（脚本数据仅存于 mock 适配器/测试 fixture）
- 无 replay/Event Store；无 fallback 双路径

## 14. Forbidden shortcuts

- 禁止把分析结果直接写 artifact 版本（S3B 的 Proposal Gate 前不允许）
- 禁止实现 Event Store/replay/ring buffer（SSE 最小化）
- 禁止 CommandBus/Registry 框架（/commands 只是 HTTP 收口；内部调用 analyzeRequirement()）
- 禁止本票接入真实 LLM 密钥/网络（后续 Slice）
- 禁止 UI 轮询兜底之外的轮询主路径

---

## Delivery Record（2026-08-11，ZCode）

**实际实现**（均为 S3A 范围）：
- `src/ports/ai-provider.ts` — AIProviderPort（status/streamText/generateStructured；ProviderUnavailableError；ADR-0010）
- `src/adapters/ai/mock.ts` — Mock 适配器（冻结 UI 脚本数据迁移为行为契约源；lab hint 仅开发 harness）
- `src/ports/task-execution.ts` + `src/adapters/task/in-process.ts` — TaskExecutionPort（in-process runner + SQLite tasks 表；取消=AbortController；崩溃恢复 running→queued 经 claimNextTask）
- 迁移 003：tasks 表（status CHECK + FIFO 索引）
- `src/application/capabilities/analysis.ts` — analyzeRequirement（同步 503 预检 + 流式事件 + 多轮澄清门 roundId + 取消；运行中 provider 故障→降级事件）/ submitClarification（roundId 校验、skip 显式）/ cancelAnalysis / getTask
- `src/adapters/events/sse.ts` — EventPort→SSE（帧格式；断线→Query 续流；无 replay/ring buffer）
- HTTP：POST /projects/:pid/commands、/commands/:taskId/{clarification,cancel}、GET /commands/:taskId、GET /projects/:pid/events（SSE）
- UI（Progressive Swap）：startDiscovery→真实 capability + SSE 订阅（流式/能力卡/澄清卡/失败/取消事件映射）；cancel/answer/skip→真实端点；Lab provider 降级→横幅→恢复重试
- Mock 生产路径删除：app/src/mock/engine.ts 的 runDiscoveryScript/finishDiscoveryAfterClarification/DISCOVERY_* 移除（数据仅存于服务端 mock 适配器）

**Tests**：unit 12 / integration 4 / contract(commands) 7 / contract(sse) 4 / e2e 3 = 30（S3A 新增）；`npm test` 100/100 全绿；typecheck/lint 0

**Browser evidence**（真实 Chrome）：创建项目→描述→开始解析→SSE 流式输出→能力卡 4 张（req-3 pending）→澄清卡（roundId 1）→回答→全部 complete→再次解析→取消→"已取消"→Lab 供应商不可用→横幅+解析禁用→恢复→重试成功。截图 `.scratch/mcu-golden-journey/evidence/s3a-analysis-flow.png`

**Deviations**：
1. ProviderUnavailable 双路径：同步预检 → 503（ISSUE-003 §10）；运行中故障 → provider.unavailable + analysis.failed 事件（§6 流程）——两者并存，无 fallback mock
2. 分析结果暂存任务（tasks 表），不写 artifact 版本（S3A 边界）；提案/需求版本写入留 S3B
3. EventSource 断线重连由浏览器内建（~3s）；重连后由调用方 Query 状态恢复——SSE 服务端无 Last-Event-ID/replay
4. SSE 无心跳帧（M1 最小；本地直连无代理超时问题；S10 若需再补）
