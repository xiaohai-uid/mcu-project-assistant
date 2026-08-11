# KEEP / ADAPT / DELETE / NEW 审计 — MCU Project Assistant UI-First 重建

> 日期：2026-08-11
> 状态：待用户审核（本轮只做审计，不 implement）
> 基线：
> - 正式旧工程 GitHub main：`38f8c93`（fix: next build 零错误零警告）
> - 本地 V2 在途工作：`C:\codex\mcu-project-assistant` main `730a52d`（Phase 11 cutover - V2 is production default，领先 origin/main 7 个提交，**未推送**；另有未提交的 AGENTS.md / CLAUDE.md 改动）
> - Approved UI Reference：`xiaohai-uid/mcu-project-assistant-ui-reference` `facec1e`（FROZEN，只读）
> - 产品定义：AI MCU Project Workspace（长生命周期 Project + 版本化 Artifacts + 单一 Project Copilot + Local-first + Web Workspace + Local Companion）

---

## 0. 探索事实（审计依据）

### 0.1 旧工程（GitHub main 38f8c93）

- 单体仓库：`gateway/`（Next.js 14 App Router，TS）、`services/`（5 个 Python FastAPI 微服务）、`shared/`（Python 共享库）、`docker/`、`docs/`、`trial_run.py`
- 域根对象：**DesignDraft**（`design_drafts` 表），管道状态机 `analyzing → recommending → generating → finalizing → ready / failed / stale`
- 管道：5 阶段（requirement → recommendation → codegen → schematic，websearch 解耦并行）经 RabbitMQ 连接；网关内 Orchestrator 消费输出队列并发布到下一阶段输入队列；`StageHandler` 抽象基类（事务内 doUpdate → doSelect → buildNextPayload）
- `pipeline.ts` 有 `definePipeline()`（Zod 校验），但 `PIPELINE_STAGES` / `QUEUE_NAMES` 仍是静态常量——ADR-0001（accepted）的"Babel 式两阶段迁移"只完成了一半
- `cascade.ts`：`getDownstreamStages` + `invalidateDownstream` → 把整个 draft 置 `stale`（draft 级，非 artifact 级）
- 数据库：Postgres 16；表 users / memberships / api_keys / design_drafts / project_snapshots / project_templates。**Schema 漂移**：handlers 实际 UPDATE 的 `requirement`、`component_list`、`generated_code`、`library_deps`、`pin_mappings`、`validation`、`svg_content`、`pin_table`、`price_comparison`、`error_message`、`model_config`、`platform` 等列**不在** `schema.sql` / `001-schema.sql` 中（只有基础列）——V2 时代 DB 层从未真正接通过（与 vault 2026-08-01 审计"Gateway V2 API 未写库"结论一致）
- API：24 条 REST 路由（auth / projects CRUD+start+snapshots+code+pins+components+export / membership / billing topup+balance / keys / templates / quota / health / docs / openapi.json）
- SSE：`/api/projects/[id]/stream` —— 是 **SSE 包装的服务器端轮询**（2s 间隔、150 次、5 分钟超时），不是真实事件推送
- 前端：12 个 App Router 页面（landing/wizard/professional/recommendations/code/pins/schematic/review/progress/result/export/membership/keys/login/register）；轮询 `useDesignDraft`（2s）；`experience_level`（beginner/professional）控制密度
- 设计系统：DESIGN.md v2 "Oscilloscope"（深青主色 #0d9488、暗色优先、中文优先、双密度 token）；design-tokens.json
- i18n：**无框架**——需求服务语言检测（zh/en），UI 文案硬编码中文优先
- 主题：暗色原生 + 浅色 CSS 变量；**无 System 选项**
- 认证：JWT（jsonwebtoken + bcryptjs）+ middleware 注入 x-user-id/x-membership + tier-guard + 内存滑动窗口限流（可选 Redis）+ 安全头 + CORS + 登录限流
- 会员：free / hasKey / subscription / pay-as-you-go（含充值余额 payg_balance）；平台权限矩阵（free/hasKey 仅 arduino；subscription/payg 含 esp32/stm32）
- BYOK：AES-256-GCM + scrypt 派生密钥，`iv:authTag:ciphertext` 格式，`key_hash` 快速查找
- 模型路由：free_api（DeepSeek）/ user_key / premium_api（GPT-4o）；MOCK_MODE 全链路 mock
- 测试：gateway Vitest 17 文件 / 254 测试 + Playwright e2e（wizard/registration/export）；Python pytest（shared/tests + codegen + schematic，CI 中 69 项）；信任基线修复过"验证误报"（verified=false 启发式检查）
- CI：gateway-tests / python-tests / docker-build 三 job；CD：tag 触发 docker 构建
- 错误模型：ApiError + withErrorHandler + api-toast；阶段失败 → draft `failed` + error_message
- 已知问题（vault 2026-07-29/08-01 审计）：平台参数实际用 Arduino 引脚与 Uno 板；价格混币种曾标 USD（已修复）；trial 的约束被改写、原理图占位 SVG、验证误报（已部分修复为"未验证"诚实标记）

### 0.2 本地 V2 在途工作（C:\codex main 730a52d，未推送）

- 新增 `worker/`：Python 包 `mcu_worker`（domain: design_spec / circuit_ir / pin_allocation / component_selection / stage；constraints 引擎 / firmware 生成器 / circuit 生成器 / platforms 注册表 / components 注册表；stages: requirement / constraint_validation / firmware_generation…；jobs/consumer；adapters/compiler/arduino_cli + 内置 arduino-cli.tar.gz；observability）
- worker 测试 ~20 文件 / 141 项（test_models 254 行、test_pipeline_definition、test_stages、test_constraints 等）
- 与 origin/main 差 178 文件 / +9107 −2717 行（含 gateway V2 API、acceptance fixtures、feature flags）
- vault 2026-08-01 验收审计结论：**V2 远未完成**——design-worker 持续 Restarting(0)；Gateway V2 API 占位响应（未写库、未发队列）；PipelineRuntime 默认 FakeRepository；feature flag 无调用；Arduino CLI 不可用；10 个 acceptance case 只有 JSON。**禁止切流。**

### 0.3 Approved UI Reference（facec1e，冻结基线）

- React 19 + Vite 6 + Tailwind 4 + lucide-react + motion；express + `@google/genai`（Gemini 3.6-flash）演示服务层（仅 3 个 endpoint：health / copilot/discover / copilot/chat，无持久化、无认证）
- 视觉：Apple-inspired macOS 生产力风格——SF Pro 字体栈、毛玻璃侧栏（backdrop-blur）、12px 圆角卡片、macOS 红绿灯、accent #007aff / #0a84ff、canvas #f5f5f7 / #161618、44px 顶栏、256px 左栏、320px 右侧 Copilot 面板
- 视图：Home Dashboard（项目卡：version + 状态 Stale/Validated/Draft + 目标 + RTOS/框架 + 模板）；Workspace（左栏 Requirements/Hardware/Wiring/Firmware/Build + Companion/Settings；顶栏分段 Draft|Validated|Professional View；右栏 Project Copilot Chat/Context/History）
- 数据形态：ProjectState（discovery、ProposalItem（initialIdea→formalizedRequirement、impacts、accepted）、DiscoveredRequirement（complete/partial/pending、progress、warning）、PinMapping、firmware 提案 diff（IO12→IO21、接受/拒绝）、Copilot 消息（codeSnippet、proposalCard））
- Settings 6 标签：General / Appearance / Language / AI Provider / Local Companion / Advanced；主题 System/Light/Dark；语言 EN/简体中文；MCU 目标；串口波特率；服务端 Gemini Key
- i18n.ts：完整 zh/en 词典 + localStorage（mcu_app_lang / mcu_app_theme）+ 系统语言/主题检测；**但存在 key 漂移**（组件引用的 `statusValidated`/`statusDraft`/`createNewDesc`/`initBlank`/`recentProjectsDesc` 等不在词典中，会渲染 undefined）
- 内容面：需求发现（capabilities + 形式化提案审阅）、MCU 候选矩阵（RECOMMENDED/ALTERNATIVE/INDUSTRIAL）、外设预映射、引脚矩阵 + ESP32-S3 strapping 警告（IO0/IO45/IO46/IO12）、电气规则校验、固件代码 + 提案 diff、编译烧录 + 串口监视器、Companion 遥测/传感器模拟/继电器覆盖、Build 日志（PlatformIO/CMake）

---

## 1. 逐项审计

### 1.1 Domain model（领域模型整体）

- **CURRENT**：CONTEXT.md 词汇表以 DesignDraft / Pipeline / Stage / Orchestrator 为核心，把"一句话 → 管道 → 生成结果"当成产品领域。
- **TARGET**：Project + Artifact（Requirements/Architecture/Hardware/BOM/Pin Map/Wiring/Firmware/Validation/Build/Debug Evidence）+ Artifact 生命周期（Draft/Proposed/Accepted/Validated/Stale/Warning/Error）+ Proposal/Diff/Impact/Accept/Reject/New Version。Platform / Membership / Model Config / Tier 等工程词保留。
- **DECISION**：ADAPT（重写词汇表，保留有用的工程词）
- **REASON**：领域根从"一次生成"换成"长期工作区"；但 Platform/Membership/ModelConfig/Tier 在新型产品里仍然真实存在，不推倒。
- **CHANGE REQUIRED**：重写 CONTEXT.md（新词汇表 + 每条 Avoid 词）；新增 ADR-0002（Project/Artifact 模型）；删除 DesignDraft/Pipeline/Stage/Orchestrator 词条。
- **REUSABLE TESTS**：无（领域词表无测试）；`type-safety.test.ts`（类型面纪律）保留。
- **OBSOLETE TESTS**：无直接对应。
- **UI MAPPING**：词汇表服务全部 UI——参考的 Draft/Validated 分段、项目卡状态、提案审阅卡片即是新词表的视觉化。
- **RISK**：低（纯文档），但它决定后续所有 schema/API/测试的形态——必须先定。

### 1.2 DesignDraft

- **CURRENT**：域根对象。`design_drafts` 表 + `DraftStatus`（analyzing/recommending/generating/finalizing/ready/stale/failed）+ `useDesignDraft` 轮询钩子 + 全部 API 路由以 `designDraftId` 为键。
- **TARGET**：不再是域根。其数据行语义迁移为 Project（+ 首版 Artifacts）。
- **DECISION**：DELETE（作为概念与状态机）
- **REASON**：它是"一次生成记录"，没有 artifact 生命周期、版本、提案语义；新模型下生成结果必须可版本化、可被提案修改、可显式接受。旧状态机（analyzing→…→ready）无法表达。
- **CHANGE REQUIRED**：`design_drafts` 表 expand-contract 迁移为 `projects` + `artifacts` + `artifact_versions` + `proposals`；`DraftStatus` → artifact 状态集合（Draft/Proposed/Accepted/Validated/Stale/Warning/Error）；`useDesignDraft` → `useProject`/`useArtifact`。
- **REUSABLE TESTS**：`cascade.test.ts` 的失效传播逻辑（改写为 artifact 级）、`snapshots.test.ts` 的版本语义（改写）、`validation.test.ts`。
- **OBSOLETE TESTS**：`pipeline-integration.test.ts`（断言完整 draft 状态机流转）、wizard e2e（一次性向导流）、progress/result 相关页面测试。
- **UI MAPPING**：参考中 Home 项目卡（status: Stale/Validated/Draft）与 Draft|Validated 分段视图即新模型；无"草稿状态机进度条"式 UI。
- **RISK**：**最高**。schema、API、前端、测试全链受影响；建议 expand-contract（先建 projects/artifacts 并行，再删 design_drafts）。

### 1.3 Project model

- **CURRENT**：不存在 Project 实体（只有 design_drafts 行 + `project_templates` + `project_snapshots` 关联）。
- **TARGET**：长期存在的工程工作区根对象：名称/目标平台/视图模式（beginner|professional）/当前版本/关联 Artifacts/关联 Copilot 会话/设备（Companion）绑定。Git-friendly（本地目录 = 可进 git 的事实源）。
- **DECISION**：NEW
- **REASON**：产品定义明确 Project 是核心生命周期载体（Idea→…→Completed），且 Beginner/Professional 是同一 Project 的两种视图。
- **CHANGE REQUIRED**：新表 `projects`（+ 目录布局规范）；`experience_level` 从 draft 列迁移为 project 级视图偏好；项目级 API。
- **REUSABLE TESTS**：`templates.test.ts` 的模板应用逻辑（新 Project 从模板初始化）。
- **OBSOLETE TESTS**：无直接对应（旧无 Project）。
- **UI MAPPING**：Home Dashboard 项目卡（新建/模板/打开工作区）、SideNavBar 项目上下文头、顶栏 Professional View 分段。
- **RISK**：中。与 DesignDraft 迁移联动。

### 1.4 Pipeline

- **CURRENT**：RabbitMQ 五阶段线性链（requirement→recommendation→codegen→schematic，websearch 并行）；`definePipeline()` 拓扑声明（ADR-0001，只完成一半）；`StageHandler` 事务基类；阶段超时 60s → draft failed。
- **TARGET**：没有"产品级 pipeline"。取而代之：Project 事件 + Artifact 生成任务（按 artifact 触发：需求发现、硬件评估、引脚求解、固件生成、验证、构建），AI 修改走 Proposal/Diff/Impact/Accept/Reject/New Version；上游变化 → 下游 Stale → Review Impact → Update → Revalidate。
- **DECISION**：DELETE（线性一锤子链）/ 底层能力 ADAPT
- **REASON**：管道是"一句话 → 生成结果"的架构；新模型是长生命周期、部分更新、可回滚、可重验证的 artifact 工作区。但 `definePipeline()` 的 Zod 消息校验、拓扑校验（重名/缺失/下游推导）是真正有价值的底层能力，值得下沉到 worker 的 artifact 任务声明中。
- **CHANGE REQUIRED**：网关删除 orchestrator 消费链；任务拓扑声明复用 `definePipeline` 模式（V2 `test_pipeline_definition.py` 已验证此形态）。
- **REUSABLE TESTS**：`pipeline.test.ts`（definePipeline 校验语义）、worker `test_pipeline_definition.py` / `test_stages.py`（若 V2 域模型被采纳）。
- **OBSOLETE TESTS**：`pipeline-integration.test.ts`、任何断言 analyzing→…→ready 流转的测试。
- **UI MAPPING**：参考无"管道进度"UI；Build 视图的"编译流水线日志"是构建任务日志，不是领域管道。
- **RISK**：高。消息契约、幂等/重试语义要重新设计；RabbitMQ 保留与否见 1.7。

### 1.5 Stage

- **CURRENT**：网关侧概念——阶段 = 输入队列 + 输出队列 + handler + Zod 消息 schema（`PipelineStage` 五枚举）；`cascade.ts` 维护顺序。
- **TARGET**：worker 内 artifact 处理器（V2 已有雏形：stages/requirement、constraint_validation、firmware_generation…），无"队列链阶段"概念；每个处理器产出/更新一个 artifact 版本。
- **DECISION**：DELETE（网关概念）/ ADAPT（worker 侧阶段 → artifact 处理器）
- **REASON**：网关内 Stage/StageHandler 与"队列链"绑定；artifact 处理器按 artifact 而非队列组织。V2 worker 的 stages 方向正确，但需重新锚定到 artifact 语义。
- **CHANGE REQUIRED**：移除 gateway StageHandler/cascade/handler-index/stage-transforms；worker 处理器改为"输入 artifact 版本 → 输出 artifact 版本 + 提案"签名。
- **REUSABLE TESTS**：worker `test_stages.py`、`test_reliability.py`（重试/超时语义）——前提是采纳 V2 域模型（见风险 3）。
- **OBSOLETE TESTS**：`cascade.test.ts` 原样（改为 artifact 级失效）、`stage-transforms` 相关。
- **UI MAPPING**：左侧栏 WORKFLOW PIPELINE（Requirements→Hardware→Wiring→Firmware→Build）是"工程步骤导航"，可保留为 artifact 视图导航，而非管道阶段。
- **RISK**：中。V2 取舍未定前不要动 worker 侧。

### 1.6 Orchestrator

- **CURRENT**：网关内 RabbitMQ 消费者（`startOrchestrator` + `run-consumer.ts`），消费输出队列 → 更新 draft → 发布下一阶段。
- **TARGET**：不存在的角色。取代者是：worker 任务调度（消费 artifact 任务）+ 领域事件（artifact 状态变化、Stale 传播、提案创建）。Copilot 是唯一入口，内部多 agent/服务是细节。
- **DECISION**：DELETE
- **REASON**：链式编排是线性管道的产物；artifact 工作区需要的是"事件驱动 + 任务队列"，且本地模式必须无 broker 也能跑（见 1.7）。
- **CHANGE REQUIRED**：删除 orchestrator.ts / run-consumer.ts；worker 内实现 artifact 任务消费者（V2 `jobs/consumer.py` 为种子）。
- **REUSABLE TESTS**：worker `test_consumer.py`（改写为 artifact 任务语义）。
- **OBSOLETE TESTS**：gateway `pipeline-integration.test.ts`。
- **UI MAPPING**：Copilot 面板的"Apply Changes / Review Proposal"是用户侧编排入口。
- **RISK**：中。与 Pipeline/RabbitMQ 一起动。

### 1.7 RabbitMQ

- **CURRENT**：托管模式消息总线（amqplib 网关侧 + pika 服务侧；`shared/rabbitmq/client.py` + `queues.py`；10 条队列；持久化消息；无 DLQ）。
- **TARGET**：托管模式保留（artifact 任务 + 事件），**本地模式无 broker**（进程内队列）；Trust Baseline 契约已声明"broker-free 本地核心不得依赖 Postgres/Redis/RabbitMQ"——这是既有承诺，必须兑现。
- **DECISION**：ADAPT
- **REASON**：RabbitMQ 本身是可靠基建，但新架构的队列语义从"阶段链"变为"artifact 任务/事件"；且 Local-first 要求本地可运行。队列名/消息 schema 与 Python 侧手动同步的问题（ADR-0001 承认）在新契约下应一并解决（跨语言 schema 生成或统一任务契约）。
- **CHANGE REQUIRED**：队列拓扑重定义（artifact 任务、事件总线）；本地进程内队列实现；消息契约版本化。
- **REUSABLE TESTS**：`shared/tests/test_*` 中与 MQ 无关的领域测试；`worker/test_consumer.py`。
- **OBSOLETE TESTS**：依赖 5 阶段链拓扑的集成测试。
- **UI MAPPING**：无直接 UI；Companion 连接状态、Copilot Active 徽标是运行时状态的可视化。
- **RISK**：高（双模式 = 双实现面；本地/托管行为必须一致，否则"本地能跑、云端挂"）。

### 1.8 Database

- **CURRENT**：Postgres 16（pg 参数化查询无 ORM）；`shared/database/schema.sql` + migrations/001、002；**代码引用的 artifact 列不在 DDL 中**（schema 漂移，见 0.1）。
- **TARGET**：托管模式 Postgres 保留；本地模式本地存储（SQLite 或文件 + git）；Project/Artifact/版本/提案/设备证据表；Git-friendly 布局。
- **DECISION**：ADAPT
- **REASON**：Postgres 与参数化查询实践可靠；但 schema 必须重写（漂移本身就是"DB 层从未真正接通"的证据——重建时不可沿用旧 DDL）。
- **CHANGE REQUIRED**：新 DDL（projects/artifacts/artifact_versions/proposals/project_memberships/…）；迁移脚本 expand-contract；本地存储适配器接口（repository 抽象，V2 的 FakeRepository 问题要在这里根治——默认值必须是真实现，不允许"默认 Fake"）。
- **REUSABLE TESTS**：`encryption.test.ts`、`jwt.test.ts` 等不依赖 schema 的测试；`worker/test_models.py`（若采纳）。
- **OBSOLETE TESTS**：任何依赖旧 design_drafts DDL 的测试（会因 schema 重写失败而重写）。
- **UI MAPPING**：无直接 UI；Home 项目卡/版本号来自 projects/artifacts 表。
- **RISK**：高。schema 重写 + 本地/托管双后端 + 迁移数据（旧 draft 行 → Project）。

### 1.9 Persistence（Artifact 持久化）

- **CURRENT**：artifact 内容以 JSONB 列挂在 design_drafts 上（且 DDL 缺失）；`project_snapshots` 只存**标量**（title/rawDescription/status/currentStage/experienceLevel/membershipTier）——快照恢复会丢 componentList/code/schematic；模板存 template_data JSONB。
- **TARGET**：Artifact 是版本化、有生命周期状态（Draft/Proposed/Accepted/Validated/Stale/Warning/Error）的持久化对象；AI 修改 Accepted artifact 必须走 Proposal→Diff→Impact→Accept/Reject→New Version；上游变化 → 下游 Stale（不删除下游）。
- **DECISION**：ADAPT（快照概念）→ 基本重写为 Artifact 版本化持久化
- **REASON**：现持久化是"管道产物一次性落库"；新模型要求可回滚、可追踪、可重验证。快照的"自动保存/回滚"意图是好的，但粒度错了（要按 artifact 版本，而非整 draft 标量）。
- **CHANGE REQUIRED**：artifacts + artifact_versions 表（每版本 = 数据 + 状态 + 提案来源 + 校验证据）；快照功能迁移为"版本历史"；恢复 = 回滚到某 artifact 版本并级联 Stale。
- **REUSABLE TESTS**：`snapshots.test.ts`（改写为版本历史语义）、`templates.test.ts`。
- **OBSOLETE TESTS**：断言快照只含标量的测试。
- **UI MAPPING**：FirmwareView 提案 diff（接受/拒绝）、RequirementsView 提案卡片（accepted/impacts）、Home 项目卡版本号（v1.2.4-alpha）——全部是 artifact 版本的呈现。
- **RISK**：高。级联 Stale 的传播算法 + 版本存储形态（DB JSONB vs 文件）是核心设计决策，属于架构阻塞项。

### 1.10 Gateway

- **CURRENT**：Next.js 14 App Router；职责 = 页面 + 24 API + 认证中间件 + orchestrator 消费者 + 模型路由。
- **TARGET**：Web Workspace 服务器（页面 + API + 认证 + 事件推送）；**不再包含 orchestrator**；与 worker 解耦（经 API/事件而非直接消费队列）。
- **DECISION**：ADAPT
- **REASON**：Next.js 与中间件栈（JWT/限流/安全头/tier-guard/CORS）可靠且与参考 UI 技术栈兼容（React）；但网关承担的管道编排职责要移走。
- **CHANGE REQUIRED**：删除 orchestrator/run-consumer/rabbitmq 发布职责；新增 copilot/artifact/companion API 面；SSE 事件推送（见 1.12）。
- **REUSABLE TESTS**：`middleware.test.ts`、`jwt.test.ts`、`rate-limit` 相关、`tier-permissions.test.ts`、`daily-quota.test.ts`。
- **OBSOLETE TESTS**：`pipeline-integration.test.ts`、依赖 5 服务拓扑的集成测试。
- **UI MAPPING**：参考是 SPA（React+Vite），网关页面层将按参考重建——网关的"页面"职责保留但内容全换。
- **RISK**：中。

### 1.11 API

- **CURRENT**：24 REST 路由，`designDraftId` 为键；`POST /api/projects/start` 一次性启动管道；`/api/projects/[id]/code|pins|components|export` 等结果读取；auth/membership/billing/keys/quota/templates/snapshots；openapi.json + docs UI。
- **TARGET**：REST 保留 + 新 API 面：projects（CRUD/打开/模板初始化）、artifacts（列表/版本/diff）、proposals（创建/审阅/接受/拒绝/影响分析）、copilot（discover/chat，参考 server.ts 的两个 endpoint 为雏形）、companion（toolchains/boards/build/flash/serial/device/debug）、settings/语言/主题；**删除**一次性 start 管道接口。
- **DECISION**：ADAPT
- **REASON**：REST + OpenAPI 是成熟面；但资源模型从 designDraft 换成 project/artifact/proposal，endpoint 面大部分重设计。
- **CHANGE REQUIRED**：路由重写；OpenAPI 契约更新；版本化。
- **REUSABLE TESTS**：`api-keys.test.ts`、`billing.test.ts`、`membership.test.ts`、`validation.test.ts`（认证/会员/校验语义不变）。
- **OBSOLETE TESTS**：projects/start、progress、result 相关路由测试。
- **UI MAPPING**：参考组件全部经 fetch 调 API（discover/chat）；所有视图的数据源 = 新 API 面。
- **RISK**：中。

### 1.12 SSE

- **CURRENT**：`/api/projects/[id]/stream` —— SSE 包装的 2s 轮询（150 次/5min 超时）。
- **TARGET**：真实事件推送：artifact 状态变化、提案就绪、构建进度、串口遥测（Companion）、Copilot 流式回复。轮询仅作兜底。
- **DECISION**：ADAPT
- **REASON**：方向对（SSE 是 Web 端合适的推送机制），但现实现只是轮询换皮；新模型的遥测/构建日志/长任务需要真实推送。
- **CHANGE REQUIRED**：事件源（worker → 网关 → SSE 通道）；事件契约（artifact.*/proposal.*/build.*/telemetry.*）。
- **REUSABLE TESTS**：无直接复用（现有 stream 测试可重写为事件契约测试）。
- **OBSOLETE TESTS**：依赖轮询语义的流测试。
- **UI MAPPING**：BuildView 串口/遥测控制台、CompanionView 实时遥测流、Copilot 消息——全部需要实时通道。
- **RISK**：中。

### 1.13 Error model

- **CURRENT**：ApiError + withErrorHandler（统一 JSON 错误）+ api-toast + ErrorBoundary/LoadingSpinner/Skeleton；阶段失败 → draft `failed` + error_message + failure_reason。
- **TARGET**：保留 ApiError/withErrorHandler/toast 模式；映射到 artifact 级：处理器失败 → 该 artifact `Error` 状态（不弄死整个 Project）；提案冲突 → 明确冲突错误；Companion 高风险操作 → 确认流 + 错误回滚。
- **DECISION**：KEEP
- **REASON**：错误处理栈是可靠的通用工程能力，按指令不得无意义推倒；只需把"draft failed"语义提升为"artifact Error + 可重试"。
- **CHANGE REQUIRED**：错误码契约扩充（artifact/proposal/companion 域）；错误 → artifact 状态映射。
- **REUSABLE TESTS**：`validation.test.ts`、middleware 错误路径测试。
- **OBSOLETE TESTS**：无。
- **UI MAPPING**：参考无专门错误 UI（原型）；沿用 macOS 风格 toast。
- **RISK**：低。

### 1.14 AI services（总体）

- **CURRENT**：5 个独立 FastAPI 服务（requirement/recommendation/websearch/codegen/schematic），共享 `shared/llm_client.py`（OpenAI 兼容、Pydantic 结构化输出、重试、MOCK_MODE）。
- **TARGET**：artifact 处理器集合（可多实现、可插拔 provider），由 Copilot 编排；LLM 客户端层保留（这是"可靠的 AI adapter"，指令点名不得推倒）。
- **DECISION**：ADAPT
- **REASON**：LLM 客户端（结构化输出 + 重试 + mock）是经过验证的资产；服务边界（需求/选型/搜索/代码/图）与 artifact 类型一一对应，重组成本低。
- **CHANGE REQUIRED**：服务 → artifact 处理器签名（输入 artifact 版本 → 输出新版本/提案）；provider 抽象（Gemini/DeepSeek/OpenAI/本地——参考已用 Gemini，旧栈是 DeepSeek/GPT-4o，统一为 OpenAI 兼容 + Gemini 适配）。
- **REUSABLE TESTS**：`shared/tests/test_classification.py`、`test_compatibility.py`、`test_layout.py`、`test_pins.py`（领域纯逻辑，与服务解耦）。
- **OBSOLETE TESTS**：依赖队列拓扑的服务测试。
- **UI MAPPING**：Copilot 面板"Copilot 正在分析…"、Requirements 视图"AI 已合成"徽标。
- **RISK**：中。provider 统一是隐形工作量（Gemini 流式 + OpenAI 兼容差异）。

### 1.15 Requirement analysis → Requirement Discovery

- **CURRENT**：requirement-service（LLM 结构化 Requirement + 语言检测 + 模糊检测 + clarification 队列）+ shared/models/requirement.py（与服务的 exactComponents/pinRequirements/powerBudget 输出**不一致**——服务版更先进）。
- **TARGET**：参考形态的 Discovery：输入描述 → 提取硬件能力列表（complete/partial/pending + progress + warning）+ 形式化提案（initialIdea→formalizedRequirement + impacts + accepted）+ 澄清；提案可逐条接受/拒绝后才进入硬件；生成 Requirements artifact。
- **DECISION**：ADAPT
- **REASON**：现有 LLM 分析 + 澄清基础可复用；但输出形态要升级为"能力 + 提案审阅"（这正是参考定义的产品交互），且澄清从队列轮询改为提案语义。
- **CHANGE REQUIRED**：输出 schema 对齐参考（DiscoveredRequirement/ProposalItem）；提案进入 proposals 持久化；"纳入设计"→ 生成 Requirements artifact（Accepted）。
- **REUSABLE TESTS**：requirement 服务的结构化输出测试（重写 schema 后）；`shared/tests/test_classification.py`。
- **OBSOLETE TESTS**：断言旧 Requirement 形状的测试。
- **UI MAPPING**：RequirementsView 全视图（需求探索 + 能力卡片 + 规范审阅卡片 + 进入硬件按钮）。
- **RISK**：中。schema 变更连带下游推荐/固件输入。

### 1.16 Hardware recommendation

- **CURRENT**：recommendation-service（SQLite 组件库 + LLM 兜底 + 三档 tier budget/standard/premium + 电压冲突检测 + 平台兼容）；`shared/domain/compatibility.py`、`classification.py`；SQLite 每服务一个的部署形态。
- **TARGET**：MCU 候选评估（参考：RECOMMENDED/ALTERNATIVE/INDUSTRIAL + wireless/flash/sram/IO 矩阵 + Copilot 分析）+ 外设映射（含总线预分配）+ BOM artifact（tier + 总价 + 冲突 + 来源）+ 约束（引脚预算/电压/ESP32 strapping）。
- **DECISION**：ADAPT
- **REASON**：组件库 + 冲突检测是硬资产（V2 约束引擎方向更对）；但要补"MCU 候选评估"（旧栈把平台当输入参数，参考把它当选择结果）与 strapping/引脚预算约束。
- **CHANGE REQUIRED**：组件 DB 补充 ESP32/STM32 芯片候选数据（旧数据是 Arduino UNO 形状——vault 已记录"平台参数实际仍使用 Arduino 引脚与 Uno 板"）；输出 Hardware/BOM artifact + MCU 候选；约束引擎接入（V2 `constraints/engine.py`）。
- **REUSABLE TESTS**：`test_compatibility.py`（电压冲突——核心）、`test_classification.py`、worker `test_catalog.py`/`test_registry.py`/`test_engine.py`（若采纳 V2）。
- **OBSOLETE TESTS**：平台权限仅 arduino 的假设测试。
- **UI MAPPING**：HardwareSelectionView（候选矩阵 + 外设 + 选芯 → 进入引脚接线）。
- **RISK**：高（数据资产倾斜：旧组件库/模板/提示词全是 Arduino UNO 形状，而 Golden Path 是 ESP32——需要系统性补 ESP32 数据）。

### 1.17 Web search

- **CURRENT**：websearch-service（1688/DigiKey/Mouser/LCSC/DDG 多源爬取 + 限流 + 去重 + **货币安全聚合**（comparable=false + priceGroups）+ FALLBACK_PRICES 兜底）；与主链解耦。
- **TARGET**：保留为 BOM 价格增强（可选、解耦、有兜底）；作为"Hosted AI/云增强"能力之一，本地模式可禁用。
- **DECISION**：KEEP
- **REASON**：货币安全聚合与兜底是经过验证的可靠实现（vault 记录 7/7 测试 + live 3/3）；web 爬取天然不稳，兜底设计正确。按指令不得推倒可靠工程。
- **CHANGE REQUIRED**：最小——接口改为"按 BOM artifact 查询价格 → 更新 BOM 的 price 字段（Warning 状态）"；DigiKey 403 实测问题保留为已知限制（fallback 生效）。
- **REUSABLE TESTS**：websearch 全部（聚合/去重/货币/兜底/live 测试保留但默认排除）。
- **OBSOLETE TESTS**：无。
- **UI MAPPING**：HardwareSelection/BOM 价格区域（参考原型未完整展示价格，落地时补）。
- **RISK**：低。

### 1.18 Code generation → Firmware artifact

- **CURRENT**：codegen-service（Jinja2 模板 arduino/esp32/stm32 + LLM 业务逻辑 + 引脚分配 + 库依赖解析 + 启发式结构检查 verified=false）；网关侧 pin consistency 校验在 schematic 阶段做。
- **TARGET**：Firmware artifact（版本化）+ 提案 diff（参考：GPIO 冲突 → 提案重映射 IO12→IO21 → 接受/拒绝 → 新版本）；真实编译由 Companion 承担（PlatformIO/IDF/Arduino CLI）；Golden Path ESP32。
- **DECISION**：ADAPT
- **REASON**：模板 + LLM + 诚实验证标记（verified=false）是对的方向；但"生成一次"要变成"版本 + 提案 + 可编译验证"闭环。V2 `firmware/generator.py` + `arduino_cli.py` 是种子（虽被判定不可用，方向正确）。
- **CHANGE REQUIRED**：固件生成器输出 → Firmware artifact 版本 + 提案；编译验证移到 Companion（本地真实工具链）；模板按 ESP32 优先补全。
- **REUSABLE TESTS**：`test_codegen.py`（模板渲染）、worker `test_firmware.py`、`test_models.py`（若采纳）。
- **OBSOLETE TESTS**：验证只做启发式检查的测试（将被真实编译取代）。
- **UI MAPPING**：FirmwareView（代码 + 提案 diff + 接受/拒绝 + 启动风险提示）。
- **RISK**：高（真实编译链路 = 新工作量；V2 的 arduino-cli 集成被判定不可用，需重做且要覆盖 ESP32 工具链）。

### 1.19 Schematic / Wiring

- **CURRENT**：schematic-service（SVG 布局 + 引脚表 + BOM + 线色图例）；schematic-handler 有 codegen↔schematic pin 一致性校验（validation_warnings）；导出功能存在。
- **TARGET**：Pin Map artifact（参考：引脚矩阵 + 类型色点 + 子标签）+ Wiring artifact（物理布局图 + 电气规则校验 + **strapping 引脚警告**（ESP32-S3 IO0/IO45/IO46/IO12）+ 导出 PDF）；规则校验从"生成后校验"变为"验证步骤"（Rules Verified 状态）。
- **DECISION**：ADAPT
- **REASON**：SVG 生成 + pin 一致性校验是真实资产；参考补充了 strapping 知识面与"规则已验证"产品状态，这正是 Validation artifact 的雏形。
- **CHANGE REQUIRED**：Pin Map 与 Wiring 拆为独立 artifact；strapping 规则库（V2 `platforms/registry.py` 可承载）；PDF 导出（参考 Export PDF 按钮）；"Verify Electrical Rules"成为显式验证动作。
- **REUSABLE TESTS**：`test_layout.py`、`test_pins.py`、`test_schematic.py`、schematic-handler 一致性校验测试。
- **OBSOLETE TESTS**：占位 SVG 相关断言（vault 记录原理图为占位 SVG）。
- **UI MAPPING**：WiringGuidanceView（引脚拓扑矩阵 + 布局图 + strapping 警告 + 校验规则按钮 + 导出 PDF + 生成固件）。
- **RISK**：中。

### 1.20 Authentication

- **CURRENT**：JWT（jsonwebtoken + bcryptjs）+ middleware 校验 + x-user-id/x-membership 注入 + 登录限流 + CORS + 安全头。
- **TARGET**：托管模式完整保留；本地模式认证降级（设备本地用户/免登录），不阻塞本地工作区。
- **DECISION**：KEEP
- **REASON**：认证栈可靠、独立、被充分测试；新架构本地优先要求"本地可用"，但托管模式认证语义不变。
- **CHANGE REQUIRED**：本地模式的认证可选化（feature：本地无账号可工作，云端需要账号）。
- **REUSABLE TESTS**：`jwt.test.ts`、`middleware.test.ts`、`registration.e2e.ts`、login-rate-limit。
- **OBSOLETE TESTS**：无。
- **UI MAPPING**：参考无登录页（原型免登录）；Web 版需保留旧登录/注册页视觉适配。
- **RISK**：低。

### 1.21 Membership

- **CURRENT**：free / hasKey / subscription / pay-as-you-go 四档；daily quota（10/次）；平台权限矩阵（free/hasKey 仅 arduino）；billing topup/balance（payg 余额）。
- **TARGET**：分层保留（免费/BYO/订阅/按量）但**与 artifact 模型解耦**（平台权限改为"功能能力"而非"平台白名单"——参考中 ESP32 是主流目标，free 用户也应能用基础 ESP32 流程，订阅解锁高级能力：web search、hosted AI、云同步）。
- **DECISION**：ADAPT
- **REASON**：商业模式（免费引流/BYO/订阅）没有变化理由；但"free 只许 arduino"与 ESP32 Golden Path 产品定位冲突，权限面要从平台白名单改为能力矩阵。
- **CHANGE REQUIRED**：权限矩阵重定义（能力：discovery/hardware/wiring/firmware/build/flash/websearch/cloud-sync/高级模型）；quota 语义保留。
- **REUSABLE TESTS**：`membership.test.ts`、`daily-quota.test.ts`、`billing.test.ts`、`tier-permissions.test.ts`（重写矩阵后保留结构）。
- **OBSOLETE TESTS**：`platform-permissions.test.ts` 旧矩阵断言。
- **UI MAPPING**：Settings → AI Provider 标签；参考无会员页（原型），Web 版保留旧 membership 页适配。
- **RISK**：中（商业规则与权限耦合，改动需产品确认）。

### 1.22 BYOK

- **CURRENT**：AES-256-GCM + scrypt 密钥派生 + `key_hash` 快速查找 + 轮换支持（ENCRYPTION_KEY_OLD）+ keys CRUD API。
- **TARGET**：保留；新增 provider 维度（Gemini/OpenAI/DeepSeek 用户自带 key）；Settings 提供 UI。
- **DECISION**：KEEP
- **REASON**：加密体系是安全资产（指令点名 security 不得推倒）；BYOK 是产品模型的一部分（Local-first + Hosted AI 增强）。
- **CHANGE REQUIRED**：provider 字段扩展；密钥生命周期管理（过期/吊销）可保留现状。
- **REUSABLE TESTS**：`encryption.test.ts`、`api-keys.test.ts`。
- **OBSOLETE TESTS**：无。
- **UI MAPPING**：Settings → AI Provider（Gemini Key 服务端存储描述与参考一致）。
- **RISK**：低。

### 1.23 Frontend

- **CURRENT**：12 个 Next.js 页面（landing/wizard/professional/recommendations/code/pins/schematic/review/progress/result/export/membership/keys/login/register）+ Oscilloscope 设计系统（DESIGN.md/design-tokens.json）+ styles.ts 内联样式 + 2s 轮询。
- **TARGET**：按 Approved UI Reference 重建（Home/Requirements/Hardware/Wiring/Firmware/Build/Companion/Settings + Copilot 面板 + Draft|Validated|Professional View 分段）；Web Workspace 形态。
- **DECISION**：DELETE（旧页面与设计系统）→ 按参考重建
- **REASON**：指令明确 UI 基线冻结，禁止把旧 UI 改回来；旧页面是"向导 + 结果页"形态，与工作区形态不符；旧设计系统（Oscilloscope）被参考（Apple macOS）取代。
- **CHANGE REQUIRED**：页面层整体重写（参考组件为基线，接入真实 API/数据）；保留可复用模式：`useDesignDraft` 轮询模式 → useProject/useArtifact、api.ts/api-error.ts 模式、ErrorBoundary/Skeleton。
- **REUSABLE TESTS**：无（旧页面测试即 e2e；wizard e2e 作废，registration/export e2e 保留改写）。
- **OBSOLETE TESTS**：wizard.e2e.ts、progress/result 页面相关。
- **UI MAPPING**：参考全视图即为目标 UI。
- **RISK**：高（工作量最大面；参考是静态原型——无持久化、无认证、i18n key 漂移——"视觉落地到真应用"是真实工作，不是复制粘贴）。

### 1.24 i18n

- **CURRENT**：无框架；requirement-service 语言检测（zh/en 提示词）+ UI 硬编码中文优先。
- **TARGET**：框架化 i18n（zh/en），Settings 可切换，默认跟随系统语言；参考 i18n.ts 词典为起点但**必须修复 key 漂移**（statusValidated/statusDraft/createNewDesc/initBlank/recentProjectsDesc 等组件引用不存在于词典）。
- **DECISION**：NEW
- **REASON**：产品定义明确"Settings 中可切换语言"；旧实现无法支撑（硬编码）。
- **CHANGE REQUIRED**：引入 i18n 基础设施（词典 + 切换 + 持久化）；服务端错误文案本地化；补全参考词典缺口。
- **REUSABLE TESTS**：无（新基础设施，需新测试：key 完整性测试——参考的漂移说明这必须有测试）。
- **OBSOLETE TESTS**：无。
- **UI MAPPING**：Settings → Language 标签 + 顶栏 EN/中文 快捷切换 + 全组件词典。
- **RISK**：中（词典完备性测试是新增必做项）。

### 1.25 Theme system

- **CURRENT**：Oscilloscope 设计系统（暗色原生 + 浅色 CSS 变量，无 System）；token 在 design-tokens.json / styles.ts。
- **TARGET**：参考的 macOS 设计变量（--canvas-bg/--sidebar-bg/--panel-*/--accent-blue/--control-*）+ System/Light/Dark 三态 + localStorage 持久化 + 系统偏好检测。
- **DECISION**：NEW（采用参考变量体系）
- **REASON**：UI 基线冻结，参考的 CSS 变量即事实标准；System 主题是参考已实现的产品能力。
- **CHANGE REQUIRED**：index.css 变量体系移植；旧 DESIGN.md/design-tokens.json 归档；暗/亮双变量覆盖测试。
- **REUSABLE TESTS**：无。
- **OBSOLETE TESTS**：无（旧无主题测试）。
- **UI MAPPING**：Settings → Appearance（主题三选）+ 全局变量。
- **RISK**：低。

### 1.26 Testing

- **CURRENT**：gateway Vitest 254（17 文件）+ Playwright e2e（wizard/registration/export）+ Python pytest（shared/tests + codegen + schematic，CI 69 项）+ worker 本地 141 项（未推送）+ 契约测试（LICENSE/能力边界，vault 记录）。
- **TARGET**：测试框架全保留；测试面按 artifact 模型重排：artifact 生命周期、提案/diff、Stale 级联、i18n key 完整性、主题双模式、Companion 权限、真实编译（ESP32/Arduino）、事件契约；Playwright 覆盖新 UI。
- **DECISION**：ADAPT
- **REASON**：Vitest/pytest/Playwright 是可靠资产；指令点名 tests 不得无意义推倒——保留框架与领域逻辑测试，淘汰"一次性管道"语义的测试。
- **CHANGE REQUIRED**：测试清单重排（见各条目 REUSABLE/OBSOLETE）；新增 artifact 生命周期测试族；CI 纳入 worker + companion + e2e。
- **REUSABLE TESTS**：见各条目（合计约 40% 现有测试可保留/改写）。
- **OBSOLETE TESTS**：pipeline-integration、wizard e2e、旧 draft 状态机断言、依赖缺失 DDL 列的测试。
- **UI MAPPING**：无。
- **RISK**：中（淘汰判断需要 artifact 模型定稿后逐条确认）。

### 1.27 Docker

- **CURRENT**：docker-compose 7 服务（postgres/rabbitmq/5×python/gateway）+ Dockerfiles + healthchecks + CI docker-build。
- **TARGET**：托管模式拓扑：web-workspace（网关）+ worker + companion（可选独立进程）+ postgres + rabbitmq（可选）；本地模式：单进程可跑（无容器依赖）。
- **DECISION**：ADAPT
- **REASON**：容器化实践可靠；拓扑随架构变。Companion 需要宿主机 USB/串口透传（/dev、COM 口）——容器化策略要专门设计。
- **CHANGE REQUIRED**：compose 服务重排；worker 镜像替换 5 个 python 服务（或按 artifact 处理器分镜像）；Companion 设备透传。
- **REUSABLE TESTS**：docker-build CI job；healthcheck 模式。
- **OBSOLETE TESTS**：无（构建测试保留）。
- **UI MAPPING**：无。
- **RISK**：中（Companion 设备透传是新问题）。

### 1.28 CI

- **CURRENT**：ci.yml（gateway-tests / python-tests / docker-build 三 job）+ cd.yml（tag 构建）。
- **TARGET**：保留三 job + 新增 worker-tests、UI 构建 + 参考 e2e、契约测试（跨语言 schema 一致性）、i18n/主题检查。
- **DECISION**：ADAPT
- **REASON**：CI 结构可靠；按新测试面扩 job。
- **CHANGE REQUIRED**：新 job 接入；cd.yml 产物更新（web-workspace/worker 镜像）。
- **REUSABLE TESTS**：CI 配置本身。
- **OBSOLETE TESTS**：无。
- **UI MAPPING**：无。
- **RISK**：低。

### 1.29 Contracts

- **CURRENT**：shared/models Pydantic + gateway stage-types（松散）+ pipeline.ts Zod（半完成）+ openapi.json 端点 + 手动同步 Python/TS（ADR-0001 承认）；`shared/domain/*` 纯逻辑。
- **TARGET**：artifact/proposal/事件契约（Pydantic + Zod 双侧 + OpenAPI）；跨语言同步问题在重建中一并解决（生成或单侧定义）；契约测试纳入 CI。
- **DECISION**：ADAPT
- **REASON**：契约意识已存在（ADR-0001 方向对）；新模型需要 artifact 级契约 + 事件契约，且必须解决 TS/Python 双写漂移（历史教训：requirement.py 与服务输出不一致、schema.sql 与 handlers 列漂移）。
- **CHANGE REQUIRED**：契约定义集中化；新增 artifact/proposal/event schema；跨语言一致性测试。
- **REUSABLE TESTS**：`type-safety.test.ts`、pipeline Zod 校验测试。
- **OBSOLETE TESTS**：旧 stage-types 松散类型断言。
- **UI MAPPING**：无。
- **RISK**：中（双写漂移是旧工程反复踩的坑，重建必须根治）。

### 1.30 Existing docs

- **CURRENT**：ARCHITECTURE.md / DESIGN.md / DEPLOYMENT.md / CONTEXT.md / ADR-0001 / docs/agents（domain/issue-tracker/triage-labels）/ docs/architecture*/research/ops/testing/ / .scratch PRD（domain-extraction、pipeline-topology）。
- **TARGET**：ARCHITECTURE/DEPLOYMENT 重写为新拓扑；DESIGN.md 归档（被参考取代）；CONTEXT.md 新词汇表；新增 ADR-0002（Project/Artifact）、ADR-0003（Local-first 存储）；旧 PRD 归档；docs/agents 保留。
- **DECISION**：ADAPT
- **REASON**：文档实践（ADR/契约/agents 约定）是资产；内容全部过时需重写。
- **CHANGE REQUIRED**：重写 + 归档。
- **REUSABLE TESTS**：无。
- **OBSOLETE TESTS**：无。
- **UI MAPPING**：无。
- **RISK**：低（但 CONTEXT.md 词汇决定后续所有产出语言，先写）。

### 1.31 Local Companion（新产品能力）

- **CURRENT**：**不存在**。参考仅有 UI 原型（CompanionView 遥测/模拟/覆盖 + Settings 的 Local Companion 标签 + BuildView 编译烧录 + 串口监视器）；旧工程 V2 有 arduino-cli adapter 种子（被判定不可用）。
- **TARGET**：首版能力：Detect Toolchains / Detect Boards / Build / Flash / Read Serial / Device Information / Debug Evidence；权限 capability-scoped；高风险（Flash/Erase/改设备状态）明确确认；串口/设备抽象（ESP32 golden path 优先）。
- **DECISION**：NEW
- **REASON**：产品定义明确 Web Workspace + Local Companion；旧工程完全没有实现。
- **CHANGE REQUIRED**：Companion 进程/服务（本地运行，WebSocket/HTTP 与 Web 工作区通信）；capability 权限模型 + 确认流；工具链抽象（PlatformIO/IDF/Arduino CLI）；调试证据持久化（Debug Evidence artifact）。
- **REUSABLE TESTS**：无（全新）；V2 `arduino_cli.py` 可参考但按不可用处理。
- **OBSOLETE TESTS**：无。
- **UI MAPPING**：CompanionView + BuildView + Settings → Local Companion 标签 + TopNav 连接指示。
- **RISK**：**高**（全新面 + 安全性要求 + 多平台（win32 本机）/工具链差异）。

### 1.32 补充项（未在清单但必须裁决）

| 项 | 现状 | 决策 | 理由 |
|---|---|---|---|
| Snapshots | project_snapshots 标量快照 | ADAPT → artifact 版本历史 | 意图对、粒度错（见 1.9） |
| Templates | project_templates + seed-templates.ts | ADAPT → 参考的 Starter Templates（ESP32/Arduino 模板初始化 Project） | 参考 Home 有模板面板 |
| Billing（payg） | billing topup/balance | KEEP | 商业层可靠，与会员解耦后保留 |
| MOCK_MODE | llm_client + 服务级 mock | KEEP | 开发/演示必需（参考也有无 key fallback） |
| trial_run.py | E2E 管线 runner | DELETE | 被真实 worker + 真实验证取代 |
| design-preview.html / design-tokens.json / ui-preview* | 旧设计系统产物 | DELETE（归档） | 被参考取代 |
| verify-token.js | 一次性脚本 | DELETE | 无用途 |
| .scratch/ domain-extraction、pipeline-topology PRD | 旧 feature PRD | 归档 | 历史决策保留，不删除仓库历史 |
| 本地 V2 7 个提交（worker/ + gateway V2 + acceptance fixtures） | 未推送、被判定未完成 | **待用户裁决**（见架构阻塞项 5） | 域模型方向有价值，实现被判定 Fake/不可运行 |

---

## 2. 汇总

**KEEP（保留，基本不动）**
- Authentication（JWT + bcrypt + middleware 栈）
- BYOK 加密体系（AES-256-GCM + key_hash + 轮换）
- Web search（货币安全聚合 + 兜底 + 解耦）
- Error model（ApiError / withErrorHandler / toast）
- MOCK_MODE / llm_client 模式（OpenAI 兼容结构化输出）
- 测试框架（Vitest / pytest / Playwright）
- Docker 构建实践 / CI 三 job 骨架
- 领域纯逻辑库：`shared/domain/compatibility.py`（电压冲突）、`classification.py`、`layout.py`、`pins.py`
- 成员/计费/quota 测试族（membership/daily-quota/billing/api-keys/encryption/jwt/middleware/validation）

**ADAPT（改造复用）**
- Domain model（词汇表重写，保留 Platform/Membership/ModelConfig/Tier）
- RabbitMQ（托管模式 + 本地无 broker 双模式）
- Database（Postgres 保留托管；本地存储新增；schema 重写修复漂移）
- Gateway（去 orchestrator，留页面/API/中间件）
- API（REST 保留，资源面重设计为 project/artifact/proposal/copilot/companion）
- SSE（轮询换皮 → 真实事件推送）
- AI services（5 服务 → artifact 处理器；LLM 客户端保留）
- Requirement analysis → Requirement Discovery（能力 + 提案形态）
- Hardware recommendation（补 MCU 候选评估 + 约束引擎 + ESP32 数据）
- Code generation → Firmware artifact + 提案 diff + 真实编译
- Schematic/Wiring → Pin Map/Wiring artifacts + strapping 规则 + 电气规则验证
- Membership（能力矩阵替代平台白名单）
- Snapshots → artifact 版本历史；Templates → Starter Templates
- Testing / CI / Docker / Contracts / Existing docs

**DELETE（删除或归档）**
- DesignDraft（作为域根与状态机）
- Pipeline（线性一锤子链；`definePipeline` 校验能力下沉）
- Stage / StageHandler / cascade / handler-index / stage-transforms（网关侧）
- Orchestrator（网关内链式消费者 + run-consumer）
- 旧前端 12 页 + Oscilloscope 设计系统（被冻结参考取代）
- trial_run.py、verify-token.js、design-preview.html、ui-preview*（归档）
- 旧 schema.sql / migrations 001（DDL 漂移，重写）

**NEW（新产品新增）**
- Project model（projects 表 + 工作区语义 + Git-friendly 布局）
- Artifact 模型（artifacts / artifact_versions / proposals + 生命周期状态 + Stale 级联 + 提案/接受/拒绝/版本）
- i18n 基础设施（词典 + 切换 + key 完整性测试）
- Theme system（System/Light/Dark，参考 CSS 变量）
- Local Companion（工具链/板检测、构建、烧录、串口、设备信息、调试证据 + capability 权限 + 高风险确认）
- 事件推送通道（artifact.*/proposal.*/build.*/telemetry.*）
- 按参考重建的 UI（Home/Requirements/Hardware/Wiring/Firmware/Build/Companion/Settings + Copilot 面板 + Draft|Validated|Professional View）

---

## 3. TOP 10 MIGRATION RISKS

1. **域根切换（DesignDraft → Project + Artifacts）**：schema、API、前端、测试全链受影响，是最大爆炸半径；必须 expand-contract 双轨迁移。
2. **V2 在途工作合法性**：7 个未推送提交，被自家验收审计判定"远未完成/禁止切流"（FakeRepository 默认、占位 API、Arduino CLI 不可用）。若直接在其上重建，等于继承坏基线；若丢弃，损失约束引擎/电路 IR 等好方向。**需要用户裁决。**
3. **Schema 漂移证据**：handlers 使用的 artifact 列不在任何 DDL 中 → 旧 DB 层从未真正接通。重建时不能"沿用旧 schema"，必须重写；同时旧测试中依赖这些列的会被连锁打断。
4. **参考是静态原型**：无持久化、无认证、i18n key 漂移（≥5 个 undefined 渲染）、全部 mock 数据。"视觉落地为真应用"（接数据、接 API、修词典）是真实工作量，不是前端复制。
5. **Local-first 双模式**：托管（Postgres+RabbitMQ）与本地（无 broker、无云依赖）必须行为一致；Trust Baseline 契约已承诺 broker-free，本地模式是新增实现面。
6. **一次性管道语义 vs artifact 生命周期**：消息/队列/任务语义重设计（部分更新、版本化、可回滚、可重验证），旧链路（60s 超时、整 draft 失败）不适用。
7. **Stale 级联算法**：draft 级单状态 → artifact 级多依赖图（Hardware 变 → Pin Map/Wiring/Firmware/Validation 级联 Stale → Review Impact → Update → Revalidate）；旧 cascade 只有一行 UPDATE，新算法是全新复杂度。
8. **提案/Diff 工作流**：AI 禁止静默覆盖 Accepted artifact → 需要 diff 计算、影响分析、接受/拒绝 UI + API + 版本管理；目前零实现（参考只有原型交互）。
9. **ESP32 Golden Path vs Arduino 形状的数据资产**：组件库、Jinja2 模板、提示词、平台参数全部以 Arduino UNO 为形状（vault 已记录）；ESP32 数据/模板/strapping 知识要系统性补齐，工作量被低估风险高。
10. **Local Companion 全新面**：工具链/板检测、烧录、串口、调试证据 + capability-scoped 权限 + 高风险确认 + Windows 本机（COM/USB）差异；参考只有 UI 幻影，安全模型从零设计。

（候补 11：旧测试约 60% 依赖一次性管道语义，淘汰判断需 artifact 模型定稿后逐条进行，过早淘汰可能误删有效覆盖。）

---

## 4. ARCHITECTURAL BLOCKERS（动工前必须裁决）

1. **Artifact 存储形态**：Postgres JSONB vs 文件目录（git-committed）+ 索引。Local-first + Git-friendly 倾向文件 + git；托管模式需要云同步设计。影响 schema、版本、diff 全部下层。
2. **本地无 broker 模式**：worker 本地运行的任务/事件通道（进程内队列？文件事件？），与托管 RabbitMQ 的语义等价性。
3. **Copilot 编排面**：单一 Copilot 入口下的内部 agent/服务拓扑——artifact 处理器是长驻 worker 还是按需调度？provider 抽象（Gemini/DeepSeek/OpenAI/本地）的统一层。
4. **Companion 协议与权限模型**：Web 工作区 ↔ Companion 的传输（HTTP/WS）、capability 清单、高风险操作确认流、设备证据格式。
5. **V2 7 提交的取舍**（用户裁决）：采纳域模型（design_spec/circuit_ir/constraints）→ 在其上重构 artifact 语义；还是完全重写。
6. **i18n/主题平台化时机**：参考 key 漂移修复 + 主题变量作为 UI 重建第一层，还是与视图并行（推荐先平台后视图）。

---

## 5. 推荐的迁移顺序（分层，每层以可运行产物结束）

按"Grow the system in layers"原则，UI 参考可全程作为视觉基线并行：

1. **第 0 层 · 领域冻结**：重写 CONTEXT.md 词汇表；ADR-0002（Project/Artifact/Proposal 模型）；ADR-0003（Local-first 存储形态 = 阻塞项 1 裁决结果）。
2. **第 1 层 · 数据层**：新 DDL（projects/artifacts/artifact_versions/proposals）+ expand-contract 迁移（旧 design_drafts 行 → Project 首版）+ 契约测试（schema 一致性，根治漂移）。
3. **第 2 层 · 处理器层**：worker 按 artifact 处理器重组（裁决 V2 后决定基线）；约束引擎/电路 IR/固件生成接入 artifact 签名；任务/事件通道（含本地进程内实现）。
4. **第 3 层 · 服务层**：网关去 orchestrator；artifact/proposal API 面；copilot discover/chat 接口；SSE 事件推送。
5. **第 4 层 · UI 层**：i18n 基础设施（修复参考 key 漂移）+ 主题变量 → 按参考重建视图（Home → Requirements → Hardware → Wiring → Firmware → Build → Companion → Settings → Copilot 面板）→ Draft|Validated|Professional View 分段接真实数据。
6. **第 5 层 · 验证/构建闭环**：Pin Map/Wiring 电气规则验证（strapping 知识库）→ Firmware 提案 diff 全流程 → 真实编译（ESP32 Golden Path）→ Build/Flash/Serial。
7. **第 6 层 · Local Companion**：工具链/板检测 → Build/Flash/Serial/Device Info → Debug Evidence artifact + 权限/确认流。
8. **第 7 层 · Local-first + 云增强**：本地存储 + git 布局 → 云同步/备份/Hosted AI 作为增强（复用 websearch/BYOK/会员）。
9. **第 8 层 · 测试清扫**：按 artifact 语义重排测试族；淘汰一次性管道测试；i18n/主题/契约新测试入 CI；e2e 覆盖新 UI。

---

## 6. 备注

- 本审计基于 GitHub main `38f8c93` + C:\codex 本地 V2 `730a52d` + UI Reference `facec1e`（只读，未修改）。
- 旧仓库文档规范（AGENTS.md → docs/agents/ → .scratch 本地 tracker）已遵守：本审计是规划文档而非 issue ticket，故按指令默认路径放 `docs/rebuild/`，未入 `.scratch/`。
- 本文件未提交、未推送；审核通过后由你决定提交时机。
