# Spec Review — Gate 检查

> 日期：2026-08-11
> 状态：**PASS（10/10 + 一致性核查）**——Implementation Spec 可提交为 SPEC FROZEN CANDIDATE
> 检查对象：docs/rebuild/implementation-spec.md（上游：CONTRACT FROZEN + ARCHITECTURE FROZEN）

---

## 1. 十项门禁

| # | 检查项 | 结果 | 证据 |
|---|---|---|---|
| 1 | **覆盖 Frozen Golden Journey** | ✅ | §4 Scope 完整链（创建→发现→澄清→提案→MCU→冲突→固件 Diff→构建→失败→诊断→修复→重建→Validated）；§19 E2E 分支覆盖 |
| 2 | **覆盖所有核心 UI 状态** | ✅ | §17.1 错误→UI 映射（含 L2/L3/Provider/Toolchain/DeviceDisconnected/Cancelled/OutdatedProposal）；§19 UI Lab 分支全列 |
| 3 | **完整落实 Decision 1–7** | ✅ | D1=§10/§11（Revalidate 沿用决策+语义变化提案）；D2=§6.5/§13（Build 不产生版本）；D3=§11（三级）；D4=§10 Manual Edit（免提案，仅 owner）；D5=§11（impact 求值，无类型硬编码）；D6=§6.1/§8.1（archive 语义）；D7=§6.4/§12（多轮澄清 roundId、不建 Aggregate） |
| 4 | **与 Frozen Architecture 一致** | ✅ | Modular Monolith 分层（§5 目录=架构分层）；Ports（§14）与 ADR-0003/0005/0006/0007/0008/0009/0010 一一对应；ArtifactContentPort（ADR-0006）；CAS 非硬约束 |
| 5 | **只有一条生产主路径** | ✅ | §5.2 处置表：旧目录随里程碑删除；"任何时刻只存在一条主路径"约束 |
| 6 | **没有 Pipeline 借尸还魂** | ✅ | 无 ArtifactPipeline/WorkflowStage/ProcessingStage/ArtifactFlow；领域只有 8 对象 + 服务（proposal/version-commit/dependency-evaluation/constraint/firmware/build/diagnosis）；任务执行 = Task Port（M1 in-process 直调） |
| 7 | **没有过度基础设施** | ✅ | Non-Goals 全表（§4）+ §24；无 ES/CQRS/DAG/Agent Framework/队列强制 |
| 8 | **Local 完全不依赖 RabbitMQ/Postgres** | ✅ | §15 全本地适配器（SQLite+workspace+in-process）；§5.2 删除 shared/rabbitmq；Cloud Adapter 仅接口（M1 不实现） |
| 9 | **明确 Progressive Swap** | ✅ | §22：逐 Capability 替换、UI Journey/状态机不变、Mock 行为契约测试、浏览器验证、swap 顺序与 M2-M9 对齐 |
| 10 | **弱 AI 能否按 Spec 实现** | ✅ | §5 真实目录、§6-7 类型级字段/迁移/不变量、§9 完整 SQL DDL、§14 代码级接口、§16.1 端点表、§20 文件级迁移表、§21 里程碑+退出条件——无需重新设计 |

## 2. 一致性核查（命名/路径/类型/Schema）

| 项 | 核查结果 |
|---|---|
| 文件路径 | §5.1 目录与 §20 迁移目的地一致（domain/services/constraint-engine.ts 等）；与架构分层一致 |
| 类型名 | 8 对象名与 domain-contract 完全一致（Project/Artifact/ArtifactVersion/Proposal/BuildRecord/ValidationRecord/DependencyEdge/DeviceSession + StaleMark 为边运行时态）；Port 名 = ADR 名（ArtifactContentPort/TaskExecutionPort/AIProviderPort/DevicePort/CompilerPort/WebSearchPort/EventPort） |
| Capability 名 | 与 application-contract 21 个一致（analyze_requirement/submit_clarification/create_proposal/resolve_proposal/commit_manual_edit/recommend_mcu/select_mcu/generate_pin_map/validate_wiring/generate_firmware_proposal/run_build/diagnose_build/revalidate_artifact/flash_device/device_session/read_serial/set_preferences/查询族/subscribe_events/create_project/**archive_project**）；delete_project 已全部更名 |
| Port 名 | §14 仓储接口 = application-contract 查询/命令面；CompilerPort 结构化参数（禁原始命令） |
| Schema | §9 DDL 与 §6 类型字段一一对应（含 CHECK 约束/UNIQUE/索引）；不可变规则 = 仓储层禁止 UPDATE content 字段；事务边界 §10 明示 |
| Migration | schema_migrations 版本化；无 Cloud 预留字段；workspace 布局 §8.2 与 ArtifactContentPort 一致 |
| Test location | §19 分层目录与 §5.1 tests/ 结构一致；V2 测试搬运目标（§20 Required tests）明确 |

## 3. 遗留开放项（不阻塞 Spec 冻结，标注为实现期输入）

1. Firmware 手动编辑 UI（M1 不做；commit_manual_edit 仅覆盖 pin_map）——后续里程碑
2. Copilot chat 真实对话（M1 保持 UI 冻结的脚本回复；Provider Port 已支持）
3. Wiring SVG 布局图（M1 允许仅矩阵；layout 算法已 EXTRACT 待接）
4. 多轮澄清的最大轮数/超时（roundId 已支持；完成条件 UI 冻结为单轮+跳过，扩展延后）

## 结论

**Spec Review PASS（10/10）**。Implementation Spec 是完整施工图：目录真实、类型级字段、完整 DDL、代码级 Ports、HTTP/SSE 端点表、文件级迁移表、M0-M9 里程碑（每个可运行）、Progressive Swap 规则、全链路追溯。

**交付：SPEC FROZEN CANDIDATE** —— 等待产品负责人批准 SPEC FROZEN 后执行 `/to-tickets`（施工任务拆解，仍不写业务代码）。
