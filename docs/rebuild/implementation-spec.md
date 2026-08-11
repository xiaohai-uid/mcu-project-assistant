# Implementation Spec v2 — Milestone 1: ESP32-S3 Golden Journey（Spec Hardening 后）

> 日期：2026-08-11（v2：Spec Hardening 修正——Runtime 评审、API/Port/表压缩、SSE 最小化、Companion 收紧、Vertical Slice Sequence）
> 状态：Hardening 完成 → **SPEC FROZEN**（spec-hardening-review.md 十项门禁 PASS）
> 上游：CONTRACT FROZEN（7 Decisions + 22 Interactions + 21 Capabilities + 8 Domain Objects + Stale + Events）+ ARCHITECTURE FROZEN（ADR 0003-0013）
> 目标：**一个能力较弱的 AI，只阅读本 Spec + 仓库规范，就能按 Vertical Slice 顺序实现系统，无需重新设计产品与架构。**
> 技术栈（**已评审定案**）：TypeScript / Node 20 单运行时（ADR-0013 + adr-typescript-runtime-review.md；V2 纯逻辑模块 TS 移植、测试 1:1 搬运为验收门；单模块移植失败才按需建 Engineering Port——不预建）。

---

## 1. Problem Statement

旧工程（V1 网关+5 微服务+RabbitMQ 管道；V2 本地 worker 未完成）被审计判定为"一句话→管道→生成结果"的错误抽象：DesignDraft 无版本生命周期、AI 可静默覆盖、验证可误报成功、本地无法脱离云端运行。产品负责人已批准全新产品模型与冻结 UI。**问题：如何把冻结的产品/契约/架构转成可执行施工图，实现第一条完整可用的 ESP32-S3 Golden Journey——且足够小、能被弱 AI 逐纵向切片实现。**

## 2. Solution

TypeScript Modular Monolith（UI → Application → Domain → Ports → Adapters），Local = SQLite + Workspace Files + in-process Task Runner，以 Progressive Swap 替换冻结 Mock UI 脚本引擎。Golden Journey 全链 + 必需支撑状态。Local Mode 零 RabbitMQ/Postgres。**M1 面积刻意最小**：Companion 仅 5 项能力、无 Web Search、无会员体系、SSE 无事件重放、SQLite 只持久化真正必要状态。

## 3. User Stories

1. 作为新手用户，我想用自然语言描述硬件想法，看到 AI 流式分析，以便确认它理解我的需求。
2. 作为用户，我想在需求模糊时回答问题（可多轮），以便 AI 给出精确方案。
3. 作为用户，我想逐条审阅 AI 的形式化提案（初始想法 vs 正式规格 + 影响）并接受/拒绝，以便确认 AI 不静默改我的工程。
4. 作为用户，我想看到 MCU 候选对比（推荐/备选/工业级 + 约束警告），以便选择合适芯片。
5. 作为用户，我想自动生成引脚分配并看到电气规则校验结果（如 strapping 冲突），以便烧录前发现风险。
6. 作为用户，我想看到固件 Diff 提案（IO12→IO21 + boot 风险）并接受/拒绝，以便放心让 AI 改固件。
7. 作为用户，我想看到编译输出与结果，失败时让 Copilot 诊断并提修复提案，以便修复后重建。
8. 作为用户，我想随时取消/重试长任务，以便控制流程。
9. 作为用户，我想在上游改动（换 MCU）后看到下游 Artifact 标 Stale 并一键重新验证，以便保证一致性。
10. 作为用户，我想手动直接编辑工程内容（不经 AI 提案），以便保留人工控制权。
11. 作为用户，我想归档项目而非被静默删除任何历史，以便审计回溯。
12. 作为用户，我想在断网时仍能打开/编辑项目、本地工具链构建、Companion 烧录与串口，以便不依赖云端。
13. 作为用户，我想看到每次构建的历史（同固件版本可多次构建），以便追踪验证证据。
14. 作为用户，我想在 AI 供应商/工具链不可用时看到明确状态并可恢复，以便不困惑。

## 4. Scope — Milestone 1（收紧后）

**实现**（Golden Journey 全链 + 必需支撑）：

```
Create Project → Describe → Analysis(流式/取消/重试) → Clarification(多轮)
→ Proposal → Accept/Reject → MCU Recommendation → ESP32-S3 Selection
→ Constraint Evaluation → Pin Map/Wiring(自动分配+电气校验) → Strapping Conflict(IO12)
→ Firmware Proposal(Diff/Impact) → Accept → Artifact Version → Build
→ Failure/Success → Diagnosis → Fix Proposal → Accept → Rebuild → Validated
```

支撑状态：Cancel / Retry / ProviderUnavailable / ToolchainUnavailable / Stale(三级) / Revalidate / Manual Edit / Archive / Build history。

**Companion M1 能力（正式限制为 5 项）**：
1. discover toolchain
2. detect target board
3. execute structured build
4. flash with explicit confirmation
5. basic serial monitor

**暂不实现（明确排除）**：advanced debugger、generic USB abstraction、device fleet、remote device、plugin marketplace、generalized tool runner、arbitrary shell execution、telemetry platform。

**Non-Goals（全表）**：Kubernetes、微服务拆分、RabbitMQ 强依赖（仅 Cloud Adapter 预留接口）、多区域部署、Event Sourcing、CQRS、通用 DAG/Workflow/Agent Framework、MCU 全型号、全 Arduino 生态、实时多人协作、GitHub 同步、自动 Cloud Sync、商业计费重构、CAS 去重系统、完整 Device Farm、无人确认自动 Flash、**Web Search（移出 M1，后续 slice）**、**会员/计费/配额体系（移出 M1）**。禁止 AI 因"以后可能需要"提前加入。

**Auth/Membership 边界**：M1 本地单用户、无账号硬依赖；BYOK 加密适配器保留（本地 app-data 加密配置存放 provider 密钥），不建密钥管理 UI/会员体系——Core Local Product 先行，Account/Cloud Enhancement 后置（不删除既有 Auth 资产，见 v2-contract-mapping REUSE 清单，但 M1 不接入）。

## 5. Target Repository Structure（唯一主路径）

```
app/                        # UI（从 C:\zcode\mcu 冻结 Mock 迁移）
  src/components/ views/ lib/ state/
  src/api/client.ts          # Capability HTTP 客户端（替换 mock/engine）
  src/api/sse.ts             # SSE 订阅（无 replay，见 §16.3）
application/
  capabilities/              # Capability 实现
domain/
  models/                    # 8 领域对象
  services/                  # proposal / version-commit / dependency-evaluation / constraint / firmware / requirement / build / diagnosis
  knowledge/                 # platforms(strapping) / components / compatibility / pins / classification（TS 移植资产）
ports/
  persistence.ts             # ★ 单一 PersistencePort（UnitOfWork，见 §14）
  artifact-content.ts        # ArtifactContentPort
  ai-provider.ts
  task-execution.ts
  compiler.ts
  device.ts
  events.ts
adapters/
  persistence/sqlite/
  artifact-content/workspace-files/
  task/in-process/
  ai/openai-compatible.ts gemini.ts mock.ts
  compiler/esp32-arduino.ts
  device/companion-local.ts mock.ts
  events/sse.ts
  security/crypto.ts
  http/
infrastructure/  config.ts  logging.ts
shared-contracts/  types.ts  events.ts
tests/  unit/domain/ unit/application/ unit/adapters/
        integration/persistence/  contract/http/  contract/sse/
        e2e/golden-journey/  fixtures/
tools/i18n-check.ts
docs/adr/  docs/rebuild/  docs/agents/
```

**旧目录处置**（同 v1，不变）：gateway/services/worker/shared → DELETE（提取后）；docker 保留（Cloud 部署图，M1 不启用）；.scratch/docs/AGENTS/CONTEXT 保留。**任何时刻只存在一条生产主路径。**

**Workspace 布局（含证据分离）**：
```
<workspace>/<project-slug>/
  project.json
  requirements/ 0001.json ...      hardware/ 0001.json ...
  pinmap/ 0001.json ...            wiring/ 0001.json ...
  firmware/ 0001/src/main.cpp + platformio.ini   0002/...
  validation/ 0001.json ...
  .build/ <buildId>.log            # 大体积构建证据（stdout/stderr）
  .evidence/ <sessionId>.log       # 串口/调试证据
  .artifacts/ <versionId>.bin      # 固件二进制等大内容
```
**规则**：SQLite 只存 metadata/status/references/summary/diagnostics；**stdout/stderr/编译器日志/二进制固件/调试转储全部进 workspace（.build/.evidence/.artifacts）**，禁止 SQLite 膨胀。

## 6. Domain Types（8 对象）与 Artifact Types（5 类）

**与 v1 完全一致，无变化**：§6（8 对象类型级定义：identity/lifecycle/fields/invariants/legal+illegal transitions/references/archive）+ §7（5 Artifact 种类 + Proposal payload 形状）。BuildRecord/ValidationRecord/Proposal 非 Artifact（不变）。

## 7. 版本提交语义（事务边界）与 Stale 求值、Proposal Engine、Build Spec

**与 v1 一致**：§10 版本提交（Manual 免提案 / AI Proposal Gate + OutdatedProposal / Reject 零变化；T1/T2 同事务写版本+指针+StaleMark）、§11 Stale 求值（输入/输出/M1 六边依赖图，禁类型硬编码）、§12 Proposal Engine（base 校验强制）、§13 BuildRecord 字段与"Build 不产生版本"。**无变化。**

## 8. Persistence Spec — SQLite 表审查（11 → 9）

> 逐表回答"Why must this be persisted independently?"；**Domain Object ≠ 必然 SQL Table**。

| 表 | 保留? | 理由 |
|---|---|---|
| projects | ✅ | 核心聚合；生命周期/归档 |
| artifacts | ✅ | 聚合容器 + current 指针 |
| artifact_versions | ✅ | 不可变版本（内容引用+哈希）；审计 |
| proposals | ✅ | 一等聚合；决策历史/审计；OutdatedProposal 校验需要 base 引用 |
| build_records | ✅ | D2：同版本多次构建证据；独立于版本 |
| validation_records | ✅ | "验证未运行≠通过"需要逐次记录 + latestFor 查询 |
| ~~dependency_edges~~ | ❌ **降为代码常量** | M1 六条边是静态配置（seed）；随代码版本演进；不需要独立持久化（未来若可配置化再升表） |
| stale_marks | ✅ | 当前态标记（level/reason/source/resolved）；**只存当前态，不建历史子系统**（历史化是延后决策，Spec 不得提前定死） |
| ~~device_sessions~~ | ❌ **降为运行时状态** | DeviceSession = Operational Runtime State（DevicePort/Companion 内存态）；值得持久化的只有 "last device / toolchain info" → 存 preferences |
| tasks | ✅ | in-process 任务表；崩溃恢复（running→queued） |
| preferences | ✅ | 语言/主题/last_device/toolchain_info |

**最终 9 表**：projects, artifacts, artifact_versions, proposals, build_records, validation_records, stale_marks, tasks, preferences（DDL 同 v1 §9，删除 dependency_edges 与 device_sessions 两表；其余不变）。

## 9. Port Definitions（缩减后：6 仓储接口合并为 1 个 PersistencePort）

> Abstraction Necessity Review（每个接口回答：第二个真实 Adapter？隔离不稳定外部系统？支撑 Local/Cloud 差异？删除会污染 Domain/App 吗？）

| Port | 保留? | 依据 |
|---|---|---|
| ~~ProjectRepository/ArtifactRepository/…6 个仓储~~ | ❌ **合并为 1 个 PersistencePort（UnitOfWork）** | M1 只有一个真实 Adapter（SQLite）；且 T1/T2 事务跨越 versions+proposals+stale_marks+artifacts——**按 Transaction Boundary 聚合访问**，6 个接口是"一对象一接口"的机械产物 |
| **PersistencePort** | ✅ | Local( SQLite ) / Cloud( relational+blob, ADR-0004/0005 ) 双适配器 + 测试 fake（QA Testability）；以 `withTransaction(fn(uow))` 暴露（事务边界在 Port，不散在仓储） |
| ArtifactContentPort | ✅ | 双真实适配器（workspace files / object storage） |
| AIProviderPort | ✅ | 3+ 真实适配器（openai/gemini/mock，BYOK） |
| TaskExecutionPort | ✅ | Local in-process / Cloud queue（ADR-0007）；取消+持久化隔离 |
| CompilerPort | ✅ | 隔离不稳定外部系统（工具链 CLI）+ mock 测试 |
| DevicePort | ✅ | 隔离硬件外部系统 + mock 测试；Companion 边界（ADR-0009） |
| ~~WebSearchPort~~ | ❌ **移出 M1** | M1 无消费者（Golden Journey 不依赖价格）；无 seam 不建接口 |
| EventPort | ✅ | 隔离传输（SSE local/cloud 差异）；Domain 不依赖传输 |

**结论：8 Ports + 6 Repos → 7 Ports（6 仓储合并为 1 个 UoW PersistencePort；WebSearch 移出）**。

PersistencePort 接口（合并后）：
```ts
interface PersistencePort {
  withTransaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
  // 只读查询可不用事务：
  getProject(id); listProjects(); getArtifact(id); getArtifactByKind(projectId, kind);
  listArtifacts(projectId); getVersion(id); listVersions(artifactId); latestValidation(versionId);
  listProposals(projectId); getBuildRecord(id); listBuilds(versionId);
  activeStaleMarks(projectId); getPreference(key);
}
interface UnitOfWork {
  saveProject(p); archiveProject(id, reason);
  createArtifact(a); setCurrentVersion(artifactId, versionId);
  createVersion(v); setVersionStatus(id, status);   // 禁止 updateContent（不可变）
  createProposal(p); resolveProposal(id, status, decidedAt);
  createBuildRecord(b); updateBuildRecord(b);
  createValidationRecord(v);
  saveStaleMarks(marks[]); resolveStaleMarks(artifactId, versionId);
  saveTask(t); updateTask(t); claimNextTask();
  setPreference(key, value);
}
```

## 10. HTTP / SSE Application Surface（29 → 21 端点）

> 原则：**UI Action ≠ HTTP endpoint；Application Capability ≠ REST route 1:1**。围绕资源 + 少量明确 Command 合并；Capability 与 Transport 明确区分（映射表见下）。

### 10.1 资源面

| Method/Path | 用途 | 成功 | 失败示例 |
|---|---|---|---|
| POST /projects | create_project | 201 | 400 |
| GET /projects | list_projects | 200 | — |
| GET /projects/:projectId | get_project（含 artifact 状态摘要） | 200 | 404 |
| POST /projects/:projectId/archive | archive_project（command） | 200 {impact} | 403 confirmation_missing |
| GET /projects/:projectId/artifacts | 列表 | 200 | 404 |
| GET /artifacts/:artifactId/versions | 版本列表 | 200 | 404 |
| GET /versions/:versionId | 版本（metadata+content 摘要） | 200 | 404 |
| POST /artifacts/:artifactId/versions | commit_manual_edit | 201 {version, staleMarks?} | 400 |
| GET /projects/:projectId/proposals | 提案列表 | 200 | — |
| POST /proposals/:proposalId/decision | resolve_proposal（accept\|reject，单端点） | 200 | 409 OutdatedProposal |
| POST /projects/:projectId/builds | run_build | 202 {buildId} | 503 ToolchainUnavailable / 409 BlockingStale |
| GET /builds/:buildId | BuildRecord | 200 | 404 |
| POST /builds/:buildId/cancel | 取消构建 | 202 | 409 非运行中 |
| GET /versions/:versionId/builds | 构建历史（同版本多次） | 200 | — |
| POST /versions/:versionId/validations | validate_wiring | 202 | 409 |
| GET /versions/:versionId/validations | 验证历史 | 200 | — |
| GET /device | 设备状态 | 200 | — |
| POST /device/detect | detect_board | 202 | 409 |
| POST /device/flash | flash_device（确认令牌必填） | 202 | 403 confirmation_missing / 409 DeviceDisconnected |
| POST /device/serial/send | 串口命令 | 200 | 409 |
| GET /device/serial/stream | 串口流 | SSE | — |
| GET /projects/:projectId/events | 事件流 | SSE | — |
| POST /preferences | set_preferences | 200 | 400 |
| GET /health | — | 200 | — |

**Command 面（合并 RPC 爆炸）**：
| Method/Path | capability（payload 内） | 成功 |
|---|---|---|
| POST /projects/:projectId/commands | `analyze_requirement` \| `recommend_mcu` \| `select_mcu` \| `generate_pin_map` \| `generate_firmware` \| `diagnose_build` \| `revalidate_artifact` | 202 {taskId} |
| POST /commands/:taskId/clarification | （分析任务的澄清交互） | 200 {roundId} |
| POST /commands/:taskId/cancel | 取消长任务 | 202 |

> 对比：v1 的 22 个 action 端点（/analyze、/cancel-analysis、/generate-proposal、/accept-proposal、/reject-proposal…）折叠为 **1 个 commands 端点 + 2 个任务交互端点 + 4 个资源动作**（archive/decision/build/validate）。**29 → 21 端点**。Retry = 以幂等键重发原命令（不建 /retry 端点）。

### 10.2 通用约定
- Error envelope：`{"error":{"code","message","details?"}}`；错误码 = §12 taxonomy
- Idempotency：写命令支持 `Idempotency-Key`（重放 no-op）；resolve_proposal/select_mcu/commit_manual_edit 自然幂等
- Auth：M1 本地单用户、绑定 127.0.0.1、无 JWT；401/403 保留为 Cloud 预留（confirmation_missing 在 M1 即用 403）
- Cancellation：取消命令 → 终态事件（`*.cancelled`）；**SSE 断开 ≠ 任务取消**

### 10.3 SSE（最小化，无 Event Store）
- 帧：`event: <logicalEventType>\ndata: <json>\n\n`（类型 = logical-events；载荷 = LogicalEvent）
- **断线恢复语义（M1 正式）**：
  ```
  SSE disconnect
  → reconnect（无 Last-Event-ID / 无 replay）
  → 客户端 Query 当前任务状态（GET /commands/:taskId 或资源 GET）
  → 恢复实时事件流（从现在起）
  ```
- **M1 禁止**：Event Store / persisted event stream / replay engine / offset management / distributed event durability / ring buffer。Logical Event ≠ Durable Event Log（冻结的 build.started 等只是逻辑事件）。
- 完成：长任务以显式终态事件结束；高频流（build.output/serial.output）允许应用层合并。

## 11. Error Model

与 v1 §17 一致（13 错误码 Domain/Application→Transport→UI 映射）。**调整**：Unauthorized/Forbidden 标注为 Cloud 预留（M1 本地单用户，不激活）；confirmation_missing 在 M1 激活（403）。复用 ApiError/withErrorHandler/toast 模式。

## 12. Security Spec（Tier 0）

1. BYOK：复用 AES-256-GCM 前先运行并保留 gateway encryption 测试；移植为 adapters/security/crypto.ts。
2. Secrets：**provider 密钥存本地 app-data 加密配置（非 workspace）**；不得写 workspace/日志/build artifact/Proposal/SSE；日志脱敏。
3. Flash 确认：一次性、短时效 confirmationToken（UI 对话框产生）；AI/Provider/Companion 不得绕过（DevicePort 无 token 拒绝）。
4. 命令执行：CompilerPort 结构化参数（枚举 target/toolchain + options 对象）；**禁止 LLM 生成任意 shell 命令无验证执行**；child_process 禁用 shell 拼接。
5. 本地服务绑定 127.0.0.1；archive 也要求确认。

## 13. Testing Spec（分层，同 v1 + 补充）

同 v1 §19（Domain/Application/Persistence/Adapters/Contract/Journey E2E 全分支，含 OutdatedProposal）。**补充**：
- PersistencePort 测试用真实 SQLite（集成层）+ 领域/应用层用 UoW fake（内存实现）
- **移植验收门**：每个 TS 移植模块 = 搬运测试 1:1 绿（§15 迁移表 Required tests）
- E2E 分支（UI Lab 已证明）：build success/fail/diagnosis/fix/rebuild/cancel/retry/stale/revalidate/provider unavailable/toolchain unavailable/outdated proposal

## 14. V2 文件级迁移（TS 移植 + 验收门）

同 v1 §20 全表（Source→Destination→Action→Reason→Required tests），**Action 语义按 ADR-0013 更新**：EXTRACT/REUSE 的 Python 纯逻辑模块 = **TS 移植**，测试 1:1 搬运为验收门；单模块移植等价性失败 → 该模块单独退回 Python Engineering Adapter（按需建 Engineering Port，不预建）。REWRITE 项（firmware generator/stages/consumer/arduino_cli）目标语言 TS。DELETE 项不变（design_spec/stage/rabbitmq 契约/FakeRepository 默认）。

## 15. Implementation Sequence — Vertical Slice Sequence（替代 M0-M9）

> 每个 Slice 是**端到端可运行**的纵向切片（UI → Application → Domain → Persistence/Adapter → 测试 → 浏览器验收）。**禁止横向伪切片**（M0 Domain / M1 Database / M2 API / M3 Frontend）。**禁止大爆炸 M0**（首个 Slice 只建第一个 Walking Skeleton 需要的最小骨架，其余随 Slice 出现）。

| Slice | User-visible capability | UI Mock 被替换 | Application capability | Min domain | Min persistence | Adapter | Tests | Browser acceptance | Definition of Done |
|---|---|---|---|---|---|---|---|---|---|
| S1 | Create Project（Home→工作区） | createProject/openProject | create_project / archive_project | Project | projects 表 | SQLite UoW | unit + contract/http | 建项目→进入工作区 | UI 到库全链；archive 确认 |
| S2 | Manual Artifact Version（提交手动编辑） | editPin / commit 动作 | commit_manual_edit | Artifact/ArtifactVersion + 不可变 | artifacts/artifact_versions + workspace 内容目录 | SQLite + WorkspaceFiles | unit/domain(不可变) + integration | 手动编辑→新版本徽标 | 版本不可变测试绿 |
| S3 | Requirement Analysis + Proposal | discover 流式/澄清/提案卡 | analyze_requirement / submit_clarification / create_proposal / resolve_proposal | Proposal + 决策状态机 | proposals 表 + requirements 版本 | AI mock + SSE | unit(Proposal/Outdated) + contract/sse | 描述→澄清→提案→决策 | OutdatedProposal 测试绿 |
| S4 | MCU Recommendation + Selection | 候选矩阵/选芯 | recommend_mcu / select_mcu | （无新对象；evaluate 接入） | hardware 版本 | AI mock（候选脚本） | unit | 候选→选中→Hardware v1 | 候选+约束呈现 |
| S5 | Pin Map + Wiring + Stale | 引脚冲突卡/Stale 横幅 | generate_pin_map / validate_wiring /（依赖求值） | DependencyEdge 求值 + StaleMark | pin_map/wiring 版本 + stale_marks + validation_records | constraint-engine(TS 移植) + CompilerPort 空实现 | unit(约束/Stale) + integration | IO12 冲突→校验→Stale→Revalidate | 约束移植测试绿；Stale 三级门禁 |
| S6 | Firmware Proposal + Diff | 固件 Diff/接受/拒绝 | generate_firmware_proposal | （firmware 版本经 Proposal） | firmware 版本 = **真实文件**（workspace） | firmware-generator(TS 移植) + WorkspaceFiles | unit(Firmware diff) | Diff→接受→真实文件版本 | 固件=可打开真实文件 |
| S7 | Build | 编译日志/成功/失败 | run_build | BuildRecord | build_records + .build/ | CompilerPort(esp32-arduino) + TaskExecution(in-process) | unit + contract/sse(build.output) | 真实编译成功 | 同版本多 Build 记录 |
| S8 | Failure Diagnosis + Fix + Rebuild | 诊断卡/修复提案/重建 | diagnose_build /（build_fix 提案） | （复用 Proposal） | （复用） | AI mock（诊断） | unit + e2e 分支 | 失败→诊断→修复→重建 | e2e 全分支绿 |
| S9 | Flash confirmation + Serial | 烧录确认/串口 | flash_device / detect_board / read_serial | DeviceSession（运行时） | preferences(last_device) + .evidence/ | DevicePort(companion-local) | unit(companion) + contract | 检测→确认→烧录→串口 | 无 token 拒绝测试绿 |
| S10 | Golden Journey Hardening | 全分支 + 旧目录清理 | 全能力回归 | — | — | — | e2e 全分支 + i18n-check | 全 Journey 走查 | **唯一主路径**；旧目录删除 |

**约束**：每个 Slice 结束系统可运行可演示；禁止连续 N 个 Slice 不可运行。Schema 随 Slice 增长（S1 建 projects，S3 建 proposals…），**不一次性建全 9 表**。

## 16. Progressive Swap（同 v1 §22）

逐 Capability 替换 Mock 引擎为 HTTP/SSE 真实后端；UI Journey/状态机不变；Mock 脚本输出 = 行为契约源；每次 swap 浏览器验证。swap 顺序 = Slice 顺序（S1 先 create_project…S9 companion）。

## 17. Ticket 分解规则（/to-tickets 阶段强制）

1. **每张主要 Ticket = 一个 Vertical Slice**（上表 10 张），禁止横向拆分（Ticket 1 schema / Ticket 2 repos / Ticket 3 API / Ticket 4 frontend…）。
2. 一张 Ticket 内部可包含 UI / Domain / Persistence / Adapter / Tests。
3. **大小限制**：一个执行 AI 在一个上下文窗口内可理解、实现、测试、审查。若 Ticket 含 10+ 无关文件 / 多个独立领域 / 多套 migration / 多个 Journey → 继续拆成更小 Vertical Slice；**不得拆回横向技术层**。
4. Ticket 名称示例：`S1 Create Project end-to-end`、`S3 Requirement Analysis + Proposal end-to-end`、`S8 Failure Diagnosis + Fix end-to-end`。

## 18. Traceability（同 v1 §23，更新 Port 名）

每个模块 → UI State/Action → Interaction → Capability → Domain Invariant → Architecture → Test；无上游来源 → 删除。Port 引用按 §9 新接口名（PersistencePort UoW 等）。

## 19. Out of Scope（本 Spec / M1）

§4 Non-Goals 全表；另：Cloud Adapter 实现、Web Search、本地模型 Provider、会员/计费/配额、Debug 能力全集、Copilot chat 真实对话（M1 保持冻结脚本回复）、SSE 事件重放、Event Store、Engineering Port（仅逃生时按需建）、Wiring SVG 布局图（layout 算法已提取，接驳延后）、Firmware 手动编辑 UI。

## 20. Further Notes

- 本 Spec 遵守 to-spec 流程（seam = Capability 接口 + PersistencePort UoW；progressive swap seam = Mock engine → HTTP/SSE）。
- ADR-0013 使技术栈成为硬约束；逃生通道（Engineering Port）仅按模块失败时建立，不预建。
- CONTEXT.md 词汇表随实现更新（M1 内完成）；每 Slice 结束回写 vault 与 docs/rebuild/ 状态。
- 与 ADR-0001（旧管道拓扑）无冲突（历史决策；新 ADR 0003-0013 覆盖架构方向）。
