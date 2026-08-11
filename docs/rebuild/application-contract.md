# Application Contract — Capabilities

> 日期：2026-08-11
> 状态：Draft（Contract Review 后 Frozen）
> 方法：把 Interaction Contract 的每个 UI 动作映射为系统 Capability。
> **本文件定义 Capability 语义；不决定 HTTP 路由 / RPC 风格 / 消息传输 / 存储引擎。**
> 前置事实：interaction-contract.md + product-decisions.md

Capability 字段说明：
- **Command / Query** — 有副作用（Command）还是只读（Query）
- **Input / Output** — 逻辑输入输出（类型级描述）
- **Preconditions** — 调用前必须成立
- **Invariants** — 执行中与执行后必须保持
- **Errors** — 失败方式（错误码语义，非 HTTP 码）
- **Idempotency** — 重复调用是否安全
- **Cancellation** — 是否可取消、取消语义
- **Progress Events** — 异步过程向调用方发出的进度（逻辑事件，见 logical-events.md）
- **Authorization Boundary** — 谁允许调用（能力边界；具体认证实现延后）

---

## 1. Capability 清单与交互映射

| Capability | 对应 Interaction | 类型 |
|---|---|---|
| create_project / archive_project | A1 / A3（归档语义） | Command |
| commit_manual_edit | D4（手动编辑，免提案，Decision 4） | Command |
| list_projects / get_project | A2 / A3 | Query |
| analyze_requirement | B1 / B2 / B3 | Command（异步、可取消） |
| submit_clarification | B4 | Command |
| create_proposal | C1/C2 的上游（AI 产出） | Command（内部） |
| resolve_proposal | C1 / C2 | Command |
| recommend_mcu | D1（候选生成） | Command（异步） |
| select_mcu | D1（提交选择） | Command |
| evaluate_constraints | D2（自动约束求值） | Command（异步） |
| generate_pin_map | D2 | Command（异步） |
| validate_wiring | D3 | Command（异步） |
| generate_firmware_proposal | E1 | Command（异步） |
| run_build | F1 / F2 / F5 | Command（异步、可取消） |
| diagnose_build | F3 | Command（异步） |
| revalidate_artifact | G1 | Command（异步） |
| flash_device | H2 | Command（异步、高风险） |
| detect_device / device_session | H1 / H3 | Command |
| read_serial | H2 后 / Companion | Query（流） |
| set_preferences | Settings（语言/主题） | Command |
| get_artifact / get_artifact_version / list_versions | 查看 | Query |
| get_proposal / list_proposals | 提案查看 | Query |
| get_build_records / get_validation_records | Build/Validation 证据 | Query |
| get_stale_scope | Stale 呈现 | Query |
| subscribe_events | 全 UI 实时呈现 | Query（订阅） |

---

## 2. Capability 定义

### 2.1 create_project / archive_project
- **Command / Query**：Command
- **Input**：create：name（可选默认）、templateRef（可选）；archive：projectRef、confirmationToken
- **Output**：projectRef / archiveResult（含 Impact 摘要）
- **Preconditions**：create：无；archive：确认令牌有效
- **Invariants**：create：项目名非空、新项目无 artifact 版本；**archive：非破坏性归档语义（Decision 6）——不静默级联物理删除；Proposal/Build/Validation 历史保留；被引用资产的破坏性清除需确认 + Impact；物理清除属 retention/privacy/admin/storage-cleanup policy（不在 Golden Journey 范围）**
- **Errors**：invalid_name / confirmation_missing
- **Idempotency**：create 否（每次新建）；archive 是（重复归档幂等）
- **Cancellation**：N/A（同步）
- **Progress Events**：无
- **Authorization Boundary**：所有者

> **命名规则**：产品层禁止使用名为 `delete_project`、实际只是 archive 的模糊 Capability——本能力正式命名为 `archive_project`。真正物理删除不属于 Golden Journey，不进入 M1 实现范围。

### 2.1b commit_manual_edit（手动编辑，Decision 4）
- **Command / Query**：Command
- **Input**：artifactRef、content（新内容）、（可选）说明
- **Output**：新 artifactVersionRef
- **Preconditions**：调用者是项目所有者（人工路径）
- **Invariants**：**免 Proposal 直接产生新版本**（门禁针对 AI/自动化，不针对所有者）；新版本创建后触发 Dependency Evaluation → 可能的 Stale 传播（Decision 5 求值）
- **Errors**：invalid_content
- **Idempotency**：否（每次编辑是新版本）
- **Cancellation**：N/A（同步）
- **Progress Events**：artifact.version.created / artifact.stale
- **Authorization Boundary**：项目所有者（仅人工通道；AI 不得经此能力写入）

### 2.2 analyze_requirement
- **Command / Query**：Command（异步长任务）
- **Input**：projectRef、description、existingAcceptedContext（已接受需求/提案，用于增量）
- **Output**：analysisId
- **Preconditions**：在线；provider 可用；项目存在；无进行中分析
- **Invariants**：分析期间不写入任何 artifact；澄清前不产出提案；**支持多轮澄清（Decision 7）：clarification.requested 可重复出现，每轮带 roundId，回答后分析继续或再次澄清**
- **Errors**：provider_unavailable / analysis_failed / offline
- **Idempotency**：否（每次新分析）
- **Cancellation**：是——终止流式输出，丢弃中间结果，不写 artifact
- **Progress Events**：analysis.started / analysis.progress / clarification.requested（roundId）/ analysis.completed / analysis.failed / analysis.cancelled
- **Authorization Boundary**：项目所有者

### 2.3 submit_clarification
- **Command / Query**：Command
- **Input**：analysisId、roundId、answer（或 skip=默认规格）
- **Output**：无（继续分析流）
- **Preconditions**：分析处于 clarifying（对应 roundId）
- **Invariants**：跳过必须显式（记录默认规格选择）；多轮之间状态衔接
- **Errors**：invalid_analysis_state / invalid_round
- **Idempotency**：是（同一 roundId 同一回答重复提交无副作用）
- **Cancellation**：N/A（并入分析）
- **Progress Events**：analysis.progress / analysis.completed / clarification.requested（新一轮）
- **Authorization Boundary**：所有者

### 2.4 create_proposal
- **Command / Query**：Command（**内部能力**——由分析/生成流程调用，不直接暴露给用户）
- **Input**：projectRef、baseArtifactVersionRef、kind（requirements / firmware / dependency）、payload（formalized 内容）、diff、impacts[]
- **Output**：proposalRef
- **Preconditions**：存在 base 版本；AI 输出已完成
- **Invariants**：**Proposal 不修改任何 Artifact**；proposal 引用 base 版本；每个 proposal 一个决策（pending/accepted/rejected）
- **Errors**：invalid_base
- **Idempotency**：是（相同输入幂等）
- **Cancellation**：N/A
- **Progress Events**：proposal.created
- **Authorization Boundary**：系统/AI 处理器（用户不可直接调用）

### 2.5 resolve_proposal
- **Command / Query**：Command
- **Input**：proposalRef、decision（accept / reject）
- **Output**：proposal 状态 +（accept 时）新 artifactVersionRef
- **Preconditions**：proposal 存在且 pending（或允许改主意：accepted→rejected 等）
- **Invariants**：Reject → 零 artifact 变化；Accept → 恰产生一个新版本（内容 = proposal payload）；决策可逆（改主意）但历史保留
- **Errors**：proposal_not_found / proposal_resolved
- **Idempotency**：是（同决策重复提交结果一致）
- **Cancellation**：N/A（同步）
- **Progress Events**：proposal.accepted / proposal.rejected / artifact.version.created
- **Authorization Boundary**：项目所有者

### 2.6 recommend_mcu
- **Command / Query**：Command（异步）
- **Input**：projectRef、acceptedRequirementsRef
- **Output**：candidateList（每候选：id、规格、约束警告[]、推荐级别）
- **Preconditions**：requirements 已接受（≥1 proposal accepted）
- **Invariants**：候选必须带约束检查结果（无约束检查不算候选）；不改 artifact
- **Errors**：provider_unavailable
- **Idempotency**：是（同输入同候选）
- **Cancellation**：是（可取消生成）
- **Progress Events**：analysis.progress（复用）
- **Authorization Boundary**：所有者

### 2.7 select_mcu
- **Command / Query**：Command
- **Input**：projectRef、mcuId
- **Output**：hardwareVersionRef（新或已存在）
- **Preconditions**：候选列表存在
- **Invariants**：首次选择 → Hardware v1；**更换 → 新版本 + 下游按依赖图标记 Stale（Level 由 stale-semantics 判定）**；选择是"已接受决策"（Revalidate 沿用）
- **Errors**：invalid_mcu
- **Idempotency**：是（相同选择重复调用无变化）
- **Cancellation**：N/A
- **Progress Events**：artifact.version.created / artifact.stale
- **Authorization Boundary**：所有者

### 2.8 evaluate_constraints
- **Command / Query**：Command（异步）
- **Input**：projectRef、待求值上下文（MCU + 外设/需求）
- **Output**：constraintResult（pass / warning[] / blocking[]）
- **Preconditions**：有需求与 MCU 上下文
- **Invariants**：不产生 artifact；结果必须可追溯到输入版本
- **Errors**：constraint_engine_error
- **Idempotency**：是
- **Cancellation**：是
- **Progress Events**：analysis.progress
- **Authorization Boundary**：所有者

### 2.9 generate_pin_map
- **Command / Query**：Command（异步）
- **Input**：projectRef、mcuRef、acceptedRequirementsRef
- **Output**：pinMap 内容 + issues[]（severity: warning/error）
- **Preconditions**：MCU 已选；无 Blocking Stale 阻断
- **Invariants**：输出不写入；进入 UI 审阅；**语义变化必须走 Proposal**（如有冲突修复建议）
- **Errors**：unsatisfiable（无可用引脚）
- **Idempotency**：是（同输入同输出）
- **Cancellation**：是
- **Progress Events**：analysis.progress
- **Authorization Boundary**：所有者

### 2.10 validate_wiring
- **Command / Query**：Command（异步）
- **Input**：projectRef、pinMapVersionRef
- **Output**：ValidationRecord（规则集、结果 pass/warn/fail、引用版本）
- **Preconditions**：pin map 已生成
- **Invariants**：**不得误报成功**（验证未运行 = 未验证）；ValidationRecord 引用具体版本
- **Errors**：validation_engine_error
- **Idempotency**：是（同版本同结果；新版本需重新验证）
- **Cancellation**：是
- **Progress Events**：validation.started / validation.completed / validation.failed
- **Authorization Boundary**：所有者

### 2.11 generate_firmware_proposal
- **Command / Query**：Command（异步）
- **Input**：projectRef、pinMapVersionRef、wiringVersionRef（含验证状态）
- **Output**：firmware 代码（作为 proposal payload）+ diff + impacts[]
- **Preconditions**：下游非 Blocking Stale；provider 可用
- **Invariants**：**只产出 Proposal，不写 Firmware 版本**；语义变化必须 diff 可见
- **Errors**：provider_unavailable
- **Idempotency**：是
- **Cancellation**：是
- **Progress Events**：analysis.progress / proposal.created
- **Authorization Boundary**：所有者

### 2.12 run_build
- **Command / Query**：Command（异步、可取消）
- **Input**：projectRef、firmwareVersionRef、environment（toolchain/board/options）
- **Output**：BuildRecord（result、diagnostics、环境快照、时间戳）
- **Preconditions**：工具链可用；Firmware 已接受且非 Blocking Stale
- **Invariants**：**Build 不产生新 Firmware 版本（Decision 2）**；BuildRecord 引用唯一版本；同版本可多次 Build；失败也落记录（Error）
- **Errors**：toolchain_unavailable / build_failed / stale_blocked
- **Idempotency**：否（每次构建是新的验证执行；但可幂等重试同一输入）
- **Cancellation**：是——终止输出流，不写半成品记录
- **Progress Events**：build.started / build.output / build.failed / build.succeeded / build.cancelled
- **Authorization Boundary**：所有者

### 2.13 diagnose_build
- **Command / Query**：Command（异步）
- **Input**：projectRef、failedBuildRecordRef
- **Output**：diagnosis（原因、建议、Fix Proposal）
- **Preconditions**：存在失败 BuildRecord；provider 可用
- **Invariants**：诊断不改资产；Fix 以 Proposal 形态产出
- **Errors**：provider_unavailable
- **Idempotency**：是
- **Cancellation**：是
- **Progress Events**：analysis.progress / proposal.created
- **Authorization Boundary**：所有者

### 2.14 revalidate_artifact
- **Command / Query**：Command（异步）
- **Input**：projectRef、stale 范围（或 all）
- **Output**：逐项结果（validated / proposal_required）
- **Preconditions**：存在 L2/L3 Stale
- **Invariants**：**沿用已接受决策重算；无语义变化 → Validated；有语义变化 → 新 Proposal 待决策（Decision 1）**；不自动接受新内容
- **Errors**：recompute_failed（该项 Error 可重试）
- **Idempotency**：是
- **Cancellation**：是
- **Progress Events**：artifact.revalidating / artifact.revalidated / proposal.created
- **Authorization Boundary**：所有者

### 2.15 flash_device
- **Command / Query**：Command（异步、高风险）
- **Input**：projectRef、firmwareVersionRef、deviceSessionRef、confirmationToken
- **Output**：flashResult + DebugEvidence 引用
- **Preconditions**：设备 Connected；Firmware 非 Blocking Stale；**用户确认（confirmation 令牌，UI 对话框产生）**
- **Invariants**：L3 Stale 禁止；烧录中断不写半成品证据；证据引用固件版本 + 设备 + 时间
- **Errors**：device_disconnected / stale_blocked / flash_failed / confirmation_missing
- **Idempotency**：否（重复烧录是新执行）
- **Cancellation**：是（烧录中中止）
- **Progress Events**：device.flashing / device.flash.completed / device.flash.failed
- **Authorization Boundary**：所有者 + 设备持有者（本地）；确认必须来自用户本人

### 2.16 detect_device / device_session
- **Command / Query**：Command
- **Input**：无（检测）；sessionRef（连接/断开）
- **Output**：deviceInfo（型号/COM/波特率）、sessionRef
- **Preconditions**：Companion 可用
- **Invariants**：单活动会话；disconnect 时进行中烧录中止
- **Errors**：device_not_found / driver_error
- **Idempotency**：检测是（重复检测幂等）；连接否
- **Cancellation**：是（检测中可取消）
- **Progress Events**：device.detected / device.connected / device.disconnected
- **Authorization Boundary**：本地用户

### 2.17 read_serial
- **Command / Query**：Query（流）
- **Input**：deviceSessionRef、（可选）过滤
- **Output**：serial 行流
- **Preconditions**：设备 Connected
- **Invariants**：串口数据不写入 artifact（Debug Evidence 仅在明确归档时写入）
- **Errors**：device_disconnected
- **Idempotency**：N/A（流）
- **Cancellation**：是（停止订阅）
- **Progress Events**：serial.output
- **Authorization Boundary**：本地用户

### 2.18 set_preferences
- **Command / Query**：Command
- **Input**：preferences（language / theme / target 默认值）
- **Output**：无
- **Preconditions**：无
- **Invariants**：偏好独立于项目数据；本地持久化
- **Errors**：invalid_preference
- **Idempotency**：是
- **Cancellation**：N/A
- **Progress Events**：无
- **Authorization Boundary**：本机用户

### 2.19 查询族（get_project / list_projects / get_artifact / get_artifact_version / list_versions / get_proposal / get_build_records / get_validation_records / get_stale_scope）
- **Command / Query**：Query
- **Input**：引用（projectRef / artifactRef / versionRef…）
- **Output**：对象视图（含状态/版本/Stale 级别）
- **Preconditions**：引用存在且可访问
- **Invariants**：查询不改状态；返回当前可见事实
- **Errors**：not_found
- **Idempotency**：是
- **Cancellation**：N/A
- **Progress Events**：无
- **Authorization Boundary**：所有者

### 2.20 subscribe_events
- **Command / Query**：Query（订阅）
- **Input**：projectRef（可选范围过滤）
- **Output**：逻辑事件流（logical-events.md）
- **Preconditions**：无
- **Invariants**：事件为只读通知；UI 据此呈现进度/状态
- **Errors**：无
- **Idempotency**：N/A（订阅）
- **Cancellation**：是（取消订阅）
- **Progress Events**：事件本身
- **Authorization Boundary**：所有者

---

## 3. 约束声明

1. 本文件是 Application 语义层：UI 动作 → Capability → 逻辑事件。**不包含**：路由、RPC 风格、队列、存储、认证实现。
2. Local-first 双模式要求：每个 Capability 在 Local / Cloud 下语义一致（模式差异在 Architecture 阶段决定）。
3. 所有异步 Capability 统一支持：Progress Events、Cancellation、Failure（可重试）。
4. AI 侧 Capability（analyze/recommend/generate/diagnose）一律以 Proposal 收口（create_proposal + resolve_proposal），无例外。**唯一例外是 commit_manual_edit（Decision 4）——仅项目所有者人工通道可直接产生新版本**。
5. 高风险 Capability（flash_device、archive_project）必须确认令牌；L3 Stale 是硬门禁。
