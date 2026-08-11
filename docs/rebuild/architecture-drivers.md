# Architecture Drivers

> 日期：2026-08-11
> 状态：Frozen（Architecture 决策的唯一依据）
> 方法：不从技术喜好出发；从冻结的 Contract 提炼真正的约束。
> 前置：CONTRACT FROZEN（product-decisions 1-7 + interaction + application + domain + stale + events）

---

## 1. Product Drivers

| # | Driver | 来源契约 | 对架构的约束 |
|---|---|---|---|
| P-1 | **Project 长生命周期** | Domain: Project | 存储与身份必须支持长期演进；删除 = 归档（D6） |
| P-2 | **ArtifactVersion 不可变** | Domain I-2 | 内容层必须支持不可变快照 + 单调版本号 + 内容寻址 |
| P-3 | **Proposal Gate** | Domain I-1/I-3 + D4 | 必须存在显式的"提案→决策→版本"写入路径；AI 无直接写能力 |
| P-4 | **Stale propagation（dependency-driven）** | stale-semantics + D5 | 依赖关系是一等数据；级别由 impact 求值；传播是命令后的求值动作 |
| P-5 | **Build 多次执行（BuildRecord）** | D2 | 构建必须独立于版本；环境快照可记录；可重复执行 |
| P-6 | **Local-first** | 产品定义 | 核心流程（分析/选型/引脚/固件/构建）**可脱离云端**完成 |
| P-7 | **Cloud-enhanced** | 产品定义 | 同步/备份/Hosted AI 是增强；不得成为唯一真相源 |
| P-8 | **Windows developer environment** | 产品定义 | 本地安装零摩擦（无 Docker 依赖）、COM/USB 透传、路径/编码注意 |
| P-9 | **ESP32-S3 Golden Path** | 产品定义 + UI | 编译工具链（Arduino-ESP32/PlatformIO）为首要适配目标 |
| P-10 | **BYOK** | 产品定义 + 旧资产 | 多 provider 密钥管理（加密存储、服务端/本地边界） |
| P-11 | **Local Companion** | UI Frozen §20 | 设备/工具链执行边界；Capability-scoped；高风险确认 |
| P-12 | **可脱离云端完成核心工程流程** | P-6 强化 | 本地模式不得依赖 RabbitMQ/Postgres/云队列（双模式一致性承诺） |
| P-13 | **AI 不静默覆盖 + 全部修改可见** | D1 + UI Frozen | 事件流必须让 UI 实时呈现分析/构建/Stale 变化 |
| P-14 | **不重新引入 Pipeline** | 指令 §十七 | 架构围绕 Project/Artifacts/Versions/Proposals/Dependencies/Commands/Events，禁止 ArtifactPipeline/WorkflowStage 类抽象 |

## 2. Quality Attributes（三层优先级，v2 修正）

> 本产品涉及：BYOK API Key、本地工具链执行、MCU 编译、USB/Serial、Flash、本地文件、Companion 权限、AI 自动生成工程修改——因此 **Security/Safety 不可放到较低优先级**。

### Tier 0 — 不可牺牲
| 属性 | 含义 |
|---|---|
| **Reliability** | 工程工具的第一承诺：同输入同输出；验证失败就是失败（旧工程最大教训："验证误报成功"） |
| **Determinism** | 确定性执行路径；结果可复现；验证未运行 ≠ 通过 |
| **Security / Safety** | **系统不能因为 AI、自动化或 Companion 行为，在用户不知情的情况下执行具有明显工程风险的动作**——例如 Flash 始终保持显式确认边界；BYOK 密钥保护；命令参数结构化（禁止 LLM 生成任意 shell 无验证执行） |

### Tier 1 — 产品核心
| 属性 | 含义 |
|---|---|
| **Offline Capability** | 见 §3 Local Core Offline Guarantee：断网仍可完成核心工程流程（本地工具链/Companion/Flash/Serial/证据查看） |
| **Auditability** | 版本/提案/构建记录全链路可追溯（D2/D6） |
| **Recoverability** | 崩溃/断电不丢工程事实（本地事务性存储 WAL、内容防半写） |
| **Testability** | 契约驱动开发要求能力层可独立测试（Ports/Adapters、Mock 贯穿） |

### Tier 2 — 优化属性
| 属性 | 含义 |
|---|---|
| **Evolvability** | 未来 STM32/多 MCU/云同步扩展（显式 Ports，领域不依赖具体 provider/存储/传输） |
| **Performance** | 构建/分析秒级任务；流式反馈（事件背压合并） |
| **Cost** | 单所有者产品；云模式成本可控（无微服务集群） |

## 3. Local Core Offline Guarantee（v2 新增，正式冻结）

> Local-first ≠ 所有 AI 功能断网可用。以下为**正式冻结的离线边界**。

**无互联网时，用户仍应可以**（若对应本地能力已安装）：
- 打开 Project、浏览 Artifact、编辑 Artifact、查看版本、查看 Proposal 历史
- 进行本地依赖检查（Stale/约束求值）
- 使用本地已有 Toolchain Build、使用 Companion、检测设备、Flash、Serial
- 查看历史 Build / Validation / Evidence、保存项目

**允许因网络不可用进入 `ProviderUnavailable / Offline` 的能力**（合法降级，非产品故障；UI Frozen 已有对应状态）：
- 云端 LLM、Web Search、Cloud Sync、Remote Provider、云增强能力

**本地模型 Provider**：未来若配置本地模型，可经同一个 AI Provider Port 获得真正离线 AI——但**本地模型不是当前架构硬依赖**。

## 4. 非目标（明确不做，除非 Driver 出现）

- 微服务森林 / Actor System / Event Sourcing / CQRS / 多 Broker / Kubernetes / distributed saga（指令 §十六）
- 多人实时协作、多 MCU 系统（产品定义 §8）
- 面向普通用户的 Git 要求（产品定义：Git-friendly 但不要求懂 Git）

## 5. Driver 对选项的直接影响

| 待决问题 | 受 Driver 约束 |
|---|---|
| 本地持久化 | P-6/P-8（零依赖、离线）、Offline/Recoverability（Tier1） |
| 云持久化 | P-7（增强非真相源）、Auditability（Tier1） |
| 任务执行 | P-12（本地无队列依赖）、P-14（无 pipeline）、Reliability/Determinism（Tier0） |
| 事件传输 | P-13（实时呈现）、Performance（Tier2） |
| Companion 边界 | P-11（capability-scoped）、Security/Safety（Tier0 高风险确认） |
| Provider 抽象 | P-10（BYOK/多 provider）、Testability（Tier1，可 mock） |
