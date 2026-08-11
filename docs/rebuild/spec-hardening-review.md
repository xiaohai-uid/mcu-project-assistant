# Spec Hardening Review — Gate 检查

> 日期：2026-08-11
> 状态：**✅ SPEC FROZEN**（Hardening 十项门禁 PASS；产品负责人批准条件满足）
> 性质：不增加设计——删除未经批准的新决策、压缩过度抽象、确保 Golden Journey 足够小且可被弱 AI 逐切片实现。
> 检查对象：implementation-spec.md v2 + adr-typescript-runtime-review.md + ADR-0013

---

## Hardening 十项门禁

| # | 检查项 | 结果 | 证据 |
|---|---|---|---|
| 1 | **Runtime/Language 决策经 Architecture 级论证** | ✅ | adr-typescript-runtime-review.md：A/B/C 三案 × 13 项标准 + 6 条仓库证据（E1 小纯模块测试完备、E2 复杂部分本为 REWRITE、E3 跨语言漂移是历史最高成本故障、E4 Mock TS、E5 Windows 单运行时、E6 工具全 CLI）；结论 = **Option A 全 TS**（ADR-0013）；逃生通道 = 单模块移植失败才按需建 Engineering Port（不预建、不机械接受任何倾向） |
| 2 | **API surface 最小** | ✅ | **29 → 21 端点**：22 个 action 端点折叠为 1 个 `/commands` + 2 个任务交互 + 4 个资源动作（archive/decision/build/validate）；Retry = 幂等键重发；Capability ≠ Route 一对一（映射表明示） |
| 3 | **Ports 都有真实 seam** | ✅ | Abstraction Necessity Review 四问逐 Port 过：保留 7 个（Persistence/ArtifactContent/AI/Task/Compiler/Device/Events）均有第二适配器或隔离外部系统或支撑双模式；**WebSearchPort 移出**（M1 无消费者，无 seam 不建接口） |
| 4 | **Repository 未机械一对象一接口** | ✅ | 6 个仓储接口（Project/Artifact/Proposal/Build/Dependency…）**合并为 1 个 PersistencePort（UnitOfWork）**——依据 Transaction Boundary（T1/T2 跨 versions+proposals+stale+artifacts）+ Aggregate Access Pattern；事务边界在 Port 不在散仓储 |
| 5 | **SSE 未演变为 Event Store** | ✅ | 删除 ring buffer / Last-Event-ID / replay / offset；M1 正式语义 = 断线→重连→**Query 当前任务状态**→恢复实时流；Logical Event ≠ Durable Event Log 明文写入（§10.3） |
| 6 | **SQLite 只持久化真正必要状态** | ✅ | 逐表"Why persist independently?"：**11 → 9 表**——dependency_edges 降为代码常量（静态配置）、device_sessions 降为运行时状态（last_device/toolchain 进 preferences）；StaleMark 只存当前态不建历史子系统；Build 大体积证据分离到 workspace（.build/.evidence/.artifacts），DB 只存 metadata/refs/summary/diagnostics |
| 7 | **Companion M1 足够小** | ✅ | 正式限制 5 项（discover toolchain / detect board / structured build / flash+确认 / basic serial）；排除 8 类（debugger/USB 抽象/device fleet/remote/plugin/generalized runner/arbitrary shell/telemetry） |
| 8 | **Web Search / Membership 不扩大 Golden Journey** | ✅ | Web Search **移出 M1**（Golden Journey 不依赖价格；KEEP ≠ M1 必须接入）；会员/计费/配额**移出 M1**（M1 本地单用户无账号硬依赖；BYOK 加密适配器保留为本地 app-data 配置；不删除既有 Auth 资产但 M1 不接入） |
| 9 | **M0–M9 是真纵向演进** | ✅ | 替换为 **Vertical Slice Sequence（S1–S10）**：每 Slice = User-visible capability / UI Mock 替换 / Capability / Min domain / Min persistence / Adapter / Tests / Browser acceptance / DoD 九字段；S1=Create Project e2e（UI→App→Persistence），S2=Manual Version e2e，S3=Analysis+Proposal e2e…；**禁止伪横向切片与大爆炸 M0**（首个 Slice 只建最小骨架；schema 随 Slice 增长） |
| 10 | **弱 AI 可逐 Slice 实现** | ✅ | §15 每 Slice 九字段明确到文件/接口/表/测试；§17 Ticket 规则（垂直切片 + 单上下文窗口大小限制 + 禁止横向拆分）；§14 迁移表逐文件带验收测试 |

---

## 变化汇总（v1 → v2，供产品确认）

| 项 | v1 | v2 | 说明 |
|---|---|---|---|
| **Runtime** | 默认全 TS（未论证） | **Option A 全 TS（ADR-0013 正式论证）** | 13 项标准 + 6 条证据；逃生通道=逐模块 Engineering Port |
| **API 数量** | 29 端点 | **21 端点** | action 折叠为 commands + 资源动作 |
| **Port 数量** | 8 Ports + 6 Repos | **7 Ports（6 Repos → 1 UoW PersistencePort）** | WebSearch 移出；按事务边界合并 |
| **SQLite 表** | 11 表 | **9 表** | dependency_edges→代码常量；device_sessions→运行时+preferences |
| **SSE** | ring buffer + Last-Event-ID + replay | **无 replay**；断线→查状态→续流 | 无 Event Store |
| **Companion** | 能力未收紧 | **5 项** | 8 类排除 |
| **移出 M1** | WebSearch 在 ports；Auth 在 security | **Web Search / 会员体系 / Event Store / Engineering Port 均移出** | KEEP ≠ M1 必须接入 |
| **Sequence** | M0–M9（仍偏横向） | **S1–S10 Vertical Slices（九字段/切片）** | 每 Slice 端到端可运行 |
| **Ticket 规则** | 未定义 | **垂直 Ticket + 大小限制** | 禁止横向拆分 |

---

## 结论

**SPEC FROZEN ✅（2026-08-11）**。Implementation Spec v2 满足全部十项 Hardening 门禁：Runtime 已论证、API/Port/表最小、无 Event Store、Companion 收紧、M1 面积受控、纵向切片可执行。

之后才允许：**/to-tickets**（按 §17 垂直 Ticket 规则拆解；仍不写业务代码）。
