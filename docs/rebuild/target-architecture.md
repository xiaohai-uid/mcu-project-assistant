# Target Architecture — Modular Monolith + Explicit Ports

> 日期：2026-08-11
> 状态：Draft（Architecture Review 后 Frozen；ADR 0003-0012 为正式决策载体）
> 依据：architecture-drivers.md + architecture-options.md（推荐项）
> 原则：**没有 Product Driver 支持的组件不进入架构；不重新引入 Pipeline；简单优先。**

---

## 1. 架构风格

**Modular Monolith + Explicit Ports**（ADR-0003）。单一可执行系统，内部明确分层；所有外部依赖（存储/AI/任务/设备/云）经 Port 隔离。

```
┌─────────────────────────────────────────────────────────────┐
│  UI（Web Workspace — 参考 UI 冻结基线，React 壳 + 状态呈现）    │
│  ├─ 视图（22 个冻结交互的呈现）                                │
│  ├─ 状态呈现（Stale 徽标/门禁/提案卡/流式…）                    │
│  └─ 事件订阅（SSE） + 命令调用（HTTP）                         │
└───────────────┬─────────────────────────────────────────────┘
                │ Commands / Queries / Events（Application Contract）
┌───────────────▼─────────────────────────────────────────────┐
│  Application Layer（Capability 实现者：21 个能力）             │
│  ├─ analyze_requirement / submit_clarification              │
│  ├─ create_proposal / resolve_proposal / commit_manual_edit │
│  ├─ recommend_mcu / select_mcu / generate_pin_map           │
│  ├─ validate_wiring / generate_firmware_proposal            │
│  ├─ run_build / diagnose_build / revalidate_artifact        │
│  ├─ flash_device / device_session / read_serial             │
│  └─ create/archive_project / set_preferences / 查询族 / 订阅    │
└───────────────┬─────────────────────────────────────────────┘
                │ 调用领域（不变量由领域强制）
┌───────────────▼─────────────────────────────────────────────┐
│  Domain Layer（8 对象 + 12 不变量）                           │
│  ├─ Project / Artifact / ArtifactVersion / Proposal          │
│  ├─ BuildRecord / ValidationRecord / DependencyEdge          │
│  │   （StaleMark 为边的运行时状态）                            │
│  ├─ DeviceSession（瞬态）                                     │
│  ├─ 不变量：Proposal Gate（AI）、版本不可变、Stale 传播、      │
│  │   Revalidate 规则、删除归档语义、手动编辑豁免…              │
│  └─ 逻辑事件发布（logical-events.md）                          │
└───────────────┬─────────────────────────────────────────────┘
                │ Ports（接口，无实现）
┌───────────────▼─────────────────────────────────────────────┐
│  Ports:                                                      │
│  ├─ Persistence Port（版本化存储 + 依赖查询 + 任务表）          │
│  ├─ ArtifactContentPort（内容存取；hash 可选；CAS 非硬约束）     │
│  ├─ Task Execution Port（submit/cancel/events）              │
│  ├─ AI Provider Port（stream/cancel/structured/BYOK）        │
│  ├─ Device Port（detect/build/flash/serial/evidence）        │
│  ├─ WebSearch Port（价格增强，M1 仅存接口）                    │
│  └─ Event Transport Port（发布/订阅逻辑事件）                  │
└───────────────┬─────────────────────────────────────────────┘
                │ Adapters（可替换，双模式）
┌───────────────▼─────────────────────────────────────────────┐
│  Adapters:                                                   │
│  ├─ Persistence: SQLite（Local）/ Relational+blob（Cloud）    │
│  ├─ ArtifactContent: Workspace Files（Local）/ Object Storage（Cloud）│
│  ├─ Task: in-process runner（Local）/ queue adapter（Cloud）  │
│  ├─ AI: OpenAI-compatible / Gemini / Mock（BYOK）             │
│  ├─ Device: Companion（Local）/ Mock（dev）                   │
│  ├─ WebSearch: 爬取+兜底（Cloud）/ 禁用（Local）              │
│  └─ Events: SSE（Web UI）/ in-process（Local）/ bridge（Cloud）│
└─────────────────────────────────────────────────────────────┘
```

## 2. 数据流（Golden Journey 一例）

```
UI "开始需求解析"（命令）
→ Application: analyze_requirement
→ Domain: 创建 Analysis 会话（无 artifact 写入）
→ AI Provider Port（适配器：Gemini/DeepSeek/Mock）
→ 事件流: analysis.progress（SSE → UI 流式）
→ clarification.requested（roundId）→ UI 澄清卡
→ submit_clarification → 继续
→ analysis.completed → 能力+提案
→ create_proposal（Domain 强制：提案不写版本）
→ UI 提案卡 → resolve_proposal(accept)
→ Domain: 产生 ArtifactVersion v1（Persistence Port + ArtifactContentPort 写入，hash 校验）
→ artifact.version.created（事件）
→ 后续: generate_pin_map（Task Execution Port 异步任务，可取消）
→ 冲突 → Proposal → accept → 版本
→ run_build（Task Port → Device/Compiler 适配器 → build.output 流）
→ BuildRecord 落库（同版本多次 Build 允许）
→ 上游变化 → Dependency Evaluation → StaleMark（impact 求值）
→ artifact.stale（事件 → UI 三级呈现）
→ revalidate_artifact（沿用决策重算；语义变化 → 新 Proposal）
```

## 3. 关键机制位置

| 机制 | 所在层 | 说明 |
|---|---|---|
| Proposal Gate（AI） | Domain（写入路径唯一入口） | 任何 AI 内容只能经 create_proposal→resolve_proposal；commit_manual_edit 仅人工通道（D4） |
| 版本不可变 | Domain + Persistence Port + ArtifactContentPort | 内容引用 + 哈希校验（CAS 非硬约束）；版本行只增 |
| Stale 求值 | Domain（DependencyEdge 服务） | 命令后触发（select_mcu/commit_manual_edit/版本创建）；级别 = f(分类, 依赖, 验证结果)（D5） |
| Revalidate | Application（revalidate_artifact） | 沿用已接受决策；语义变化 → 新 Proposal（D1） |
| BuildRecord | Domain + Persistence | 引用版本 + 环境快照；同版本多 Build（D2） |
| 事件发布 | Domain 发布 → Event Transport Port | 逻辑事件不绑传输；UI 经 SSE 订阅 |
| 任务执行 | Application → Task Execution Port | 本地 in-process + SQLite 任务表；云队列适配器（P-12） |
| 删除 | Application（archive 语义） | 归档标记；历史保留；物理清除延后（D6） |

## 4. 双模式部署

**Local Mode（默认，完整产品）**：
```
Web UI（浏览器） ←HTTP/SSE→  Local Server（Modular Monolith，进程内）
                                  ├─ SQLite（metadata/状态）+ workspace files（内容，ArtifactContentPort Local Adapter）
                                  ├─ in-process Task Runner（任务表持久化在 SQLite）
                                  ├─ AI Provider（BYOK 或本地配置，可 mock）
                                  └─ Device Port → Companion（本机，COM/USB）
无 Postgres / 无 RabbitMQ / 无云依赖。
Local Core Offline Guarantee：断网可打开/浏览/编辑 Project 与 Artifact、查看版本与 Proposal 历史、本地依赖检查、本地工具链 Build、Companion 检测/Flash/Serial、查看历史证据、保存项目；
云端 LLM/WebSearch/Cloud Sync 允许进入 ProviderUnavailable（合法降级，architecture-drivers §3）。
```

**Cloud Mode（增强）**：
```
Web UI ←HTTP/SSE→  Cloud Server（同一核心）
                    ├─ Relational metadata + 对象存储内容
                    ├─ Queue adapter（RabbitMQ 等，仅部署选择）
                    ├─ Hosted AI（服务端密钥）
                    └─ 云同步/备份（内容文件 + 元数据合并）
产品语义与 Local 完全一致（双模式一致性承诺，ADR-0011）。
```

## 5. 明确不包含（Gate 检查项）

- ❌ ArtifactPipeline / WorkflowStage / ProcessingStage / ArtifactFlow（无任何线性管道抽象）
- ❌ 微服务 / Event Sourcing / CQRS / Actor / saga / 多 broker
- ❌ Companion 持有领域状态（Device Port 只做设备执行 + 证据流）
- ❌ Domain 依赖具体 AI SDK / 存储驱动 / 队列库

## 6. 组件 → Contract 追溯

| 组件 | 追溯 |
|---|---|
| UI 视图 | interaction-contract 22 动作 + UI Frozen 基线 |
| Application Capability | application-contract 21 能力 |
| Domain 对象/不变量 | domain-contract 8 对象 + 12 不变量 |
| Stale 服务 | stale-semantics（依赖边 + impact 求值 + 门禁矩阵） |
| 事件 | logical-events（4 域 30+ 事件） |
| Ports/Adapters | architecture-options 推荐 + ADR 0003-0012 |
