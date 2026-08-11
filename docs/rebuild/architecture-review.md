# Architecture Review — Gate 检查

> 日期：2026-08-11（v2：4 项修正完成）
> 状态：**✅ ARCHITECTURE FROZEN**（产品负责人批准，条件已全部满足）
> 从此：implementation 与 Architecture 冲突 → 修改 implementation；Architecture 与 Frozen Contract 冲突 → 修改 Architecture；**不得为了旧 V1/V2 代码修改已冻结的 Product Contract**。
> 检查对象：architecture-drivers.md / architecture-options.md / target-architecture.md / ADR 0003-0013 / migration-strategy.md

---

## 0. v2 修正记录（Architecture Frozen 前置）

| # | 修正 | 落点 |
|---|---|---|
| 1 | **QA 三层优先级**：Tier 0 不可牺牲 = Reliability / Determinism / Security-Safety；Tier 1 产品核心 = Offline / Auditability / Recoverability / Testability；Tier 2 优化 = Evolvability / Performance / Cost。Safety = 系统不得因 AI/自动化/Companion 行为在用户不知情时执行工程风险动作（Flash 显式确认） | architecture-drivers §2、ADR-0003 |
| 2 | **`archive_project` 命名**：删除 `delete_project` 模糊命名；产品层归档语义正式命名 archive_project；物理删除属 retention/privacy/admin/storage-cleanup，不在 Golden Journey | application-contract 2.1、target-architecture |
| 3 | **CAS 降级**：Content-addressable 存储非核心架构硬约束；冻结 ArtifactContentPort（Local=Workspace Files / Cloud=Object Storage）；hash 可存但 hash ≠ 必须 CAS；去重仅在证明需要时作为 Adapter 决策 | ADR-0005、ADR-0006、target-architecture、architecture-options |
| 4 | **Local Core Offline Guarantee 冻结**：断网可打开/浏览/编辑/版本/提案历史/依赖检查/本地 Build/Companion/Flash/Serial/历史证据/保存；云端 LLM/WebSearch/Sync 允许 ProviderUnavailable（合法降级）；本地模型非硬依赖 | architecture-drivers §3、ADR-0010、target-architecture §4 |

---

## Gate 检查清单

| # | 检查项 | 结果 | 证据 |
|---|---|---|---|
| 1 | **每个主要组件是否能追溯到 Contract** | ✅ PASS | target-architecture §6 组件→Contract 追溯表（UI=22 交互 / Application=21 能力 / Domain=8 对象+12 不变量 / Stale=stale-semantics / Events=logical-events） |
| 2 | **是否存在没有 Product Driver 支持的组件** | ✅ PASS | 组件全部对应 P-1..P-14；无独立组件无 Driver（architecture-drivers §1/§4） |
| 3 | **是否重新引入 Pipeline** | ✅ PASS | target-architecture §5 明确禁止 ArtifactPipeline/WorkflowStage/ProcessingStage/ArtifactFlow；任务执行是 Task Port（任务≠管道），领域无线性流程抽象 |
| 4 | **是否出现 speculative abstraction** | ✅ PASS | Ports 均来自契约能力面（Provider/Task/Device/Persistence/Events 都有冻结的交互与事件支撑）；预留项（tool invocation、多轮澄清扩展）标注"预留"未实现 |
| 5 | **Local Mode 是否无需 RabbitMQ/Postgres 即可运行** | ✅ PASS | ADR-0004（SQLite+文件）、ADR-0007（in-process runner）、ADR-0008（in-process 事件/SSE）；migration-strategy M-1..M-6 全部本地可跑；成功标准明确无 Postgres/RabbitMQ |
| 6 | **Cloud Mode 是否不改变产品语义** | ✅ PASS | ADR-0011（Same core, dual adapters；差异仅传输/存储/可达性，降级显式）；双模式一致性承诺（architecture-blockers §4） |
| 7 | **Companion 是否保持边界** | ✅ PASS | ADR-0009（Device Port 适配器；无领域状态/无提案决策/无真相源；证据流经事件）；target-architecture §5 禁止 Companion 持有领域状态 |
| 8 | **Proposal / Version / Build 是否仍然分离** | ✅ PASS | Domain I-1/I-2/I-6 + ADR-0006（内容寻址版本）；commit_manual_edit 唯一例外（D4 显式授权）；BuildRecord 独立（D2） |
| 9 | **Stale 是否保持 dependency-driven** | ✅ PASS | stale-semantics（依赖边 + impact 求值，D5）；DependencyEdge 是领域对象（8 类之一）；无页面级 Stale |
| 10 | **是否有旧架构惯性绑架新系统** | ✅ PASS | v2-contract-mapping DELETE 集合（DesignSpec/Stage/Pipeline/Orchestrator/RabbitMQ 契约/FakeRepository）未进入目标架构；迁移 = 资产移植非拓扑移植（ADR-0012） |
| 11 | **Runtime 决策经架构级论证**（Spec Hardening 补充） | ✅ PASS | ADR-0013（TypeScript 单运行时）：13 项标准 + 6 条仓库证据（adr-typescript-runtime-review.md）；逃生通道 = 逐模块 Engineering Port，不预建 |

## 结论

**Architecture Review PASS（10/10）**。目标架构 = Modular Monolith + Explicit Ports；无管道、无微服务、无 Event Sourcing；Local 模式零外部依赖；双模式语义一致。

**可以进入**：`/to-spec` → Spec Review → `/to-tickets`（仍不写业务实现代码）。

**备注**：ADR 编号已与仓库既有规范统一——0001（旧管道拓扑，历史保留）、0002（旧本地核心决策，V2 时代已提交，内容与新架构一致，保留）、0003-0012（本阶段新增 10 篇）。
