# Architecture Options — 比较与推荐

> 日期：2026-08-11
> 状态：Draft（ADR 依据；推荐项写入 ADR）
> 依据：architecture-drivers.md（P-1..P-14 + QA 排序）
> 纪律：每个选项给出推荐，不无限延后；但推荐 ≠ 实现，实现细节在 to-spec/tickets 后。

---

## 1. Local Persistence（四选一）

| 评价维度 | A: SQLite + workspace files | B: 纯 Git-friendly files | C: Local PostgreSQL | D: Hybrid（SQLite metadata + workspace files）★推荐 |
|---|---|---|---|---|
| 用户可理解性 | 中（工程文件可见，DB 隐式） | **高**（全部可见文件） | 低（需安装服务） | **高**（人读内容 = 文件；机器状态 = DB 不可见但可导出） |
| Git friendliness | 中（内容文件可 git，DB 需导出） | **最高**（纯文本/JSON 文件） | 低 | **高**（内容文件天然 git；DB 是操作状态） |
| Crash recovery | **高**（SQLite WAL + 事务） | 低（多文件半写） | 高（但服务本身是故障点） | **高**（事务覆盖元数据；内容文件按版本目录原子写） |
| Immutable version | 高（版本行 + 内容哈希） | 中（靠文件约定） | 高 | **高**（内容 = 版本目录/哈希文件，不可变由文件系统+约定保证） |
| Diff | 中（需结构化 diff 工具） | **高**（git diff 直接可用） | 低 | **高**（人读内容 diff = git；结构化 diff 在应用层） |
| Query | **高**（SQL） | 低（需遍历解析） | 高 | **高**（关系/依赖/Stale 查询走 SQLite） |
| Migration | 高（SQLite 版本化迁移） | 低（文件约定漂移风险） | 高（但重） | **高** |
| Backup | **高**（单文件 + 内容目录复制） | 高（整目录复制/git） | 中（需 pg_dump） | **高** |
| Windows 安装成本 | **零**（内嵌库） | 零 | **高**（装服务/权限） | **零** |
| Companion 集成 | 高（同一进程/本地服务读 DB） | 中 | 低 | **高** |
| Cloud sync | 中（需增量协议） | 高（git 语义天然同步） | 低 | **高**（内容文件同步 + 元数据合并） |

**推荐：Option D（Hybrid）**——SQLite 承载 metadata / relationships / operational state（projects、artifacts、versions、proposals、decisions、build/validation records、stale marks、preferences）；workspace files 承载 human-readable artifacts（firmware 代码、config、SVG schematic、docs）——Git-friendly、可 diff、用户可读；不可变版本由"版本目录/内容哈希"保证。理由：P-6（本地零依赖）、QA-2（事务性离线）、QA-3（审计）、QA-7（恢复）同时满足，且不牺牲用户可理解性。

## 2. Cloud Persistence（三选一）

| 评价维度 | Postgres relational | Postgres + JSONB | Object/file storage + relational metadata ★推荐 |
|---|---|---|---|
| 结构查询（关系/依赖/版本链） | **高** | 中（JSONB 查询可行但弱） | **高**（关系表 + 内容引用） |
| 不可变版本 | 中（行不可变约定） | 中 | **高**（对象存储 + 哈希校验；CAS 为适配器可选） |
| 大内容（固件/图/SVG） | 低（blob 膨胀） | 低 | **高**（对象存储） |
| Diff/审计 | 中 | 中 | **高**（内容哈希对比） |
| 迁移/演进 | 中 | 中 | 高（内容与元数据解耦） |
| 运维成本 | 中 | 中 | 中（多一个服务） |

**关键问题：ArtifactVersion 什么作为结构化 metadata，什么作为 file/blob/content？**

```
ArtifactVersion（结构化 metadata 行）
├── id / artifactRef / versionNumber / status / createdAt
├── contentRef（→ ArtifactContentPort：对象存储或本地文件路径）
├── sourceProposalRef / sourceEditRef（审计）
└── validationSummaryRef（可选摘要）

内容（file/blob）：
├── firmware 代码 / 配置 / SVG 图 / 需求 JSON
└── 按内容哈希寻址（不可变 + 去重 + diff 基础）
```

**推荐：Object/file storage + relational metadata**——关系表管元数据/关系/版本链（审计、查询、依赖求值），内容走哈希寻址存储。**不沿用旧 Postgres schema**（旧 schema 有漂移且无版本模型）。

## 3. Task Execution（Local / Cloud）

| 方案 | Local Mode | Cloud Mode |
|---|---|---|
| In-process task runner | ✅ 首选（异步执行器 + 取消 + 事件） | — |
| Durable local job queue | SQLite 任务表（崩溃恢复） | — |
| Companion-owned execution | 设备/工具链任务可委托 Companion | — |
| RabbitMQ | — | 可选适配器之一 |
| Redis-backed jobs / Postgres job table / managed queue | — | 其余可选适配器 |

**核心约束**：Application Contract 不能知道 Queue。

```
Task Execution Port（应用层定义）
├── submit_task(task) → taskRef
├── cancel_task(taskRef)
└── task events（started/progress/failed/succeeded/cancelled）
      ├── Local Adapter: in-process runner（+ SQLite 持久化任务表）
      └── Cloud Adapter: queue-backed runner（RabbitMQ/Redis/PG job table 任一）
```

**回答"RabbitMQ 是否属于核心架构"**：**否**。RabbitMQ 是 Cloud Deployment Adapter 的一个可选实现，不是架构的一部分；本地模式完全无队列依赖（P-12）。旧工程的 RabbitMQ 因此不自动保留（v2-contract-mapping 已 DELETE shared/rabbitmq 契约层）。

## 4. Event Transport

| 场景 | 推荐传输 | 理由 |
|---|---|---|
| Web UI ← 事件流（进度/Stale 更新/构建日志/AI 流式） | **SSE**（单一方向服务器→客户端；断线重连语义天然） | Logical Event ≠ Transport；SSE 足够且简单（QA-8） |
| AI streaming（token 级） | SSE（同通道或独立流） | 单向流；取消走命令通道 |
| 构建日志高频流 | SSE + 应用层合并（背压规则） | 不强制 WebSocket |
| 双向低频（命令） | HTTP POST（现有 fetch 语义） | 命令天然请求-响应 |
| 本地模式 UI ↔ 本地服务 | 同进程/本地 HTTP + SSE | 无额外 IPC 需求（首版） |
| Companion ↔ 本地服务 | 本地 HTTP/WebSocket（实现期定） | Companion 边界（ADR-0009） |
| 云端跨进程事件 | 事件桥（deployment adapter） | 逻辑事件不变 |

**结论**：不为"一套技术统一"强行 WebSocket 化。默认：**SSE for server→client events + HTTP for commands**；轮询仅作兜底（logical-events 规则）。

## 5. Companion Boundary

**Companion 负责**（Device/Toolchain Execution Port 的适配器）：
- toolchain discovery / board detection
- build execution / flash / serial
- local device evidence capture（遥测/日志 → 事件流出）

**Companion 不负责**：
- Product state（项目/artifact/版本真相）
- Proposal decision
- Artifact canonical truth
- UI business orchestration

**防"第二个 Backend"**：Companion 只实现 `Device Port`（检测/构建/烧录/串口/证据），无领域状态；所有证据经事件流入应用层持久化。Companion 适配器可替换（mock 适配器用于开发/测试）。

## 6. AI Provider

**AI Provider Port**（领域能力只依赖此接口）：
- streaming（token 流）
- cancellation
- structured output（schema 约束输出）
- BYOK / multiple providers
- tool invocation（预留）
- provider unavailable（显式事件）
- retry policy

领域能力（Requirement Analyzer / Firmware Generator / Diagnoser）**不得直接依赖具体 OpenAI/Gemini SDK**——依赖 Port + 提示/响应契约（结构 schema）。适配器：OpenAI-compatible（DeepSeek/BYO）、Gemini、Mock（复用 llm_client 的成熟模式：结构化输出 + 重试 + mock）。

---

## 7. 推荐汇总（→ ADR）

| 决策 | 推荐 | ADR |
|---|---|---|
| 架构风格 | Modular Monolith + Explicit Ports | 0003 |
| 本地持久化 | Hybrid: SQLite（metadata/关系/状态）+ workspace files（人读内容） | 0004 |
| 云持久化 | Relational metadata + object/blob storage（hash 可选，CAS 非硬约束） | 0005 |
| Artifact 内容存储 | ArtifactContentPort：不可变内容引用 + 哈希校验；人读内容镜像为工作区文件；CAS 延后 | 0006 |
| 任务执行 | Task Execution Port；Local = in-process + SQLite 任务表；Cloud = 队列适配器（RabbitMQ 仅部署选项） | 0007 |
| 事件传输 | SSE + HTTP commands；不强制 WebSocket | 0008 |
| Companion 边界 | Device Port 适配器，无领域状态 | 0009 |
| AI Provider | Provider Port + 契约 schema；领域不依赖 SDK | 0010 |
| 双模式一致性 | 同一核心 + Port 双适配器；降级显式 | 0011 |
| 迁移 | Extract proven capability（约束/引脚/兼容/数据/夹具），不迁移旧流程形态 | 0012 |
