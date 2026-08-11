# Architecture Blockers — 技术决策清单

> 日期：2026-08-11
> 状态：Draft
> 目的：区分"现在终于有足够依据可以做的技术决策"与"仍应延后的决策"。
> 依据：UI Frozen（22 项交互）+ Product Decisions（3 项）+ Interaction/Application/Domain/Stale/Events 契约。

---

## 1. 现在有足够依据的技术决策（Contract 已支撑）

| # | 决策 | 依据 | 状态 |
|---|---|---|---|
| T-1 | **BuildRecord 字段集**：toolchain、toolchainVersion、boardTarget、options、timestamp、result、diagnostics | Product Decision 2 + domain-contract §3 | ✅ 可定 |
| T-2 | **版本不可变 + 单调版本号**：ArtifactVersion 内容不可原地修改；版本按 artifact 递增 | domain-contract I-2 | ✅ 可定 |
| T-3 | **Proposal gate 无例外**：AI 修改必经 create_proposal→resolve_proposal | domain-contract §2 | ✅ 可定 |
| T-4 | **逻辑事件分类表**（4 域 30+ 事件）与订阅粒度（高频流可合并） | logical-events.md | ✅ 可定 |
| T-5 | **Stale 三级 + 门禁矩阵**（L3 禁 Flash/禁标成功/禁宣称 Validated） | Product Decision 3 + stale-semantics §4 | ✅ 可定 |
| T-6 | **Revalidate 规则**（沿用决策重算；语义变化→提案）与"内容等值"用结构化 diff 判定 | Product Decision 1 + stale-semantics §5 | ✅ 可定（diff 粒度待实现验证） |
| T-7 | **Capability 边界**（20 个能力：Command/Query、可取消、幂等、事件） | application-contract.md | ✅ 可定 |
| T-8 | **依赖边清单**（6 条边 + 传播条件）与默认级别（Hardware→PinMap L3、Firmware→Build L2 等，待产品确认 §stale-6.3） | stale-semantics §1 | ⚠️ 级别需产品确认 |
| T-9 | **高风险操作确认令牌**：flash/delete 需要显式确认（UI 对话框 → 令牌入能力入参） | interaction-contract H2/A3 | ✅ 可定 |
| T-10 | **禁止"默认 Fake"**：真实实现或显式注入；mock 仅限 dev/演示（MOCK_MODE） | V2 教训 + v2-contract-mapping §5 | ✅ 可定 |

## 2. 仍应延后的决策（无契约依据或属实现选择）

| # | 决策 | 延后原因 | 何时可决 |
|---|---|---|---|
| D-1 | 传输：RabbitMQ / SSE / WebSocket / in-process bus | 逻辑事件已定义，传输是 Local/Cloud 双模式实现选择 | Architecture 阶段 |
| D-2 | 存储引擎：Postgres / SQLite / 文件+git | 契约只需"版本不可变、可追溯、双模式一致"；引擎选择属于 Persistence Requirements 之后 | Architecture 阶段 |
| D-3 | Local-first 双模式的具体形态（本地仓库结构、同步协议） | 契约保证语义一致即可；机制未定 | Architecture 阶段 |
| D-4 | Companion 传输/协议（HTTP/WS/IPC） | UI 边界已冻结；真实协议在 UI Frozen 后 | Architecture 阶段 |
| D-5 | 认证实现（JWT/本地无账号/设备绑定） | Authorization Boundary 已定义（所有者）；实现延后 | Architecture 阶段 |
| D-6 | Provider 抽象实现（Gemini/DeepSeek/OpenAI 适配细节） | Capability 已隔离；适配器实现延后 | Architecture 阶段 |
| D-7 | "内容等值" diff 的字段级算法 | stale-semantics 已定规则；算法在实现时验证 | Contract Frozen 后 |
| D-8 | 事件存储/重放（事件源 vs 快照） | 只要求"可追溯"；机制延后 | Architecture 阶段 |
| D-9 | 多用户/多项目权限模型细化 | 产品范围无多人协作（产品定义 §8）；单所有者 | 产品扩展时 |

## 3. 必须先裁决的架构阻塞项（Contract Review 提交产品）

| # | 阻塞项 | 现状 | 需要什么 |
|---|---|---|---|
| B-1 | **Stale 默认级别映射**（哪些边 L2 / 哪些边 L3） | stale-semantics §6.3 提出初始映射（Hardware→PinMap L3、PinMap→Firmware L3、Firmware→Build L2） | 产品确认或调整 |
| B-2 | **手动编辑的版本语义**（所有者直接写 → 新版本，无需提案） | domain-contract §5-3 倾向"门禁针对 AI" | 产品确认 |
| B-3 | **Revalidate 中"语义变化"的检测范围**（结构化 diff 覆盖哪些字段） | stale-semantics §6.1 | Contract Frozen 时确认 |
| B-4 | **删除项目的级联范围**（版本+记录+证据全删？） | interaction A3 倾向全删 | 产品确认 |
| B-5 | **Debug Evidence 的归档触发**（手动归档 vs 烧录自动） | domain-contract §5-4 倾向版本化证据 | 产品确认 |

## 4. 双模式一致性承诺（写入契约的硬要求）

> 同一个 Capability（如 analyze_requirement、run_build、resolve_proposal）在 Local Mode 与 Cloud Mode 下语义一致：相同输入 → 相同事件序列 → 相同不变量成立。差异只允许在：传输、存储位置、Provider 可达性（降级策略）——且降级必须显式（ProviderUnavailable 事件），不得静默改变语义。

这使 T-1..T-10 与 D-1..D-9 的决策可以并行推进：契约冻结不影响传输/存储选择，反之亦然。
