# Production Path Baseline

审计日期：2026-08-12  
执行端：本地 Codex  
审查计划端：网页端 ChatGPT（对话：`MCU 项目开发流程`）

## 0. 审计边界

本阶段只做事实审计，不修改业务代码、不提交 Git。目标是把当前真正可运行的主路径拆开，并为每个边界标注 `REAL`、`MOCK`、`DETERMINISTIC`、`BLOCKED` 或 `UNVERIFIED`。

权威源码根目录：`C:\codex\mcu-project-assistant`。

外部全源码 bundle：`C:\codex\mcu-project-assistant-REVIEW-BUNDLE.md`，SHA-256：`02FA3EE1B348C8338F94893745EE89763E2D934E72094A46C3BE5590DD3ECB91`。网页端要求的 `.ai-bridge/mcu-review-bundle-parts/` 在当前源码根目录不存在；已核对的分片副本位于 `C:\codex\lingbi-review\.ai-bridge\mcu-review-bundle-parts\`，不属于 MCU 仓库，因此没有复制进源码仓库。

本报告不记录任何 API key 或环境变量值，只记录是否设置。

## 1. Git 基线

| 项目 | 结果 |
|---|---|
| 根目录 | `C:\codex\mcu-project-assistant` |
| 分支 | `main` |
| HEAD | `c5d9498 docs: report thinking-mode real latency (162s) and final decision` |
| 工作树 | 基线时 clean；当前仅新增本报告目录 `docs/audit/`（未改业务代码、未提交） |
| 上一提交 | `a721a6d feat(zhipu): thinking mode required — reasoning quality over speed` |
| 再上一提交 | `d217617 docs: reveal real-data verification results in final report` |

## 2. 运行验证

| 命令 | 结果 | 证据边界 |
|---|---|---|
| `npm test` | PASS；53 files，313 tests | 测试夹具大量注入 mock AI / companion-local；不是全真实依赖证明 |
| `npm run typecheck` | PASS | TypeScript 静态检查 |
| `npm run lint` | PASS | `src app/src tests` |
| `npm run build` | PASS；Vite 47 modules | 只构建 Node/UI TypeScript，不调用 arduino-cli |
| `arduino-cli` 检测 | `NOT_FOUND` | 真实固件编译链 `BLOCKED_TOOLCHAIN` |
| `MCU_AI_PROVIDER` | `UNSET` | 当前服务器入口会走 Mock AI 分支 |
| `MCU_ZHIPU_API_KEY` | `UNSET` | 本轮无法做真实 GLM smoke |
| `.env` | absent | 只有 `.env.example`，未发现本地 provider 凭据 |

## 3. 唯一需求分析主路径

```text
React AppContext
  → app/src/api/client.ts::api.analyzeRequirement
  → POST /api/v1/projects/:projectId/commands
  → src/adapters/http/app.ts::handleCommands
  → src/application/capabilities/analysis.ts::analyzeRequirement
  → TaskExecutionPort::submit（in-process）
  → AIProviderPort::status / streamText / generateStructured
  → EventPort::publish
  → SSE /api/v1/projects/:projectId/events
  → React EventSource / AppContext reducer
```

### 3.1 逐段证据

1. UI 触发：`app/src/state/AppContext.tsx:745-753` 调用 `clientApi.analyzeRequirement`，拿到 `taskId` 后订阅项目 SSE；`app/src/api/sse.ts:49-64` 使用 `EventSource`，断线只自动重连，没有 Last-Event-ID/replay。
2. HTTP 收口：`app/src/api/client.ts:108-113` 发送 `capability=analyze_requirement`；`src/adapters/http/app.ts:296-319` 映射到 capability，成功返回 `202 { taskId }`，provider 不可用返回 503。
3. 应用能力：`src/application/capabilities/analysis.ts:66-90` 先读项目、检查归档状态、执行 provider status 预检，再提交异步任务；`analysis.ts:98-205` 执行流式文本、结构化输出、澄清门、完成事件和 proposal 生成。
4. 任务执行：`src/adapters/task/in-process.ts:15-80` 任务写 SQLite 后在当前 Node 进程中异步执行，终态再写回 SQLite；取消依靠当前进程内存中的 `AbortController`。
5. 事件：生产入口 `src/infrastructure/server.ts:25` 注入 `createSseEvents()`；HTTP 事件路由在 `src/adapters/http/app.ts:423-434,689`；SSE adapter 在内存订阅集合中直接写事件，无持久 replay。

## 4. 生产组合根绑定结论

生产入口是 `src/infrastructure/server.ts`：

| 边界 | 当前绑定 | 状态 | 证据 |
|---|---|---|---|
| Persistence | SQLite + migrations + project store | `REAL` | `server.ts:21-23`；默认 `data/mcu.db` |
| Task execution | in-process + SQLite task rows | `REAL`（单进程） | `server.ts:39`；`in-process.ts:15-80` |
| Events | in-process SSE | `REAL`（无 replay） | `server.ts:25`；`events/sse.ts` |
| AI，当前默认 | `createMockAiProvider()` | `MOCK_DEFAULT` | `server.ts:27-32`；仅当 `MCU_AI_PROVIDER === "zhipu"` 才注入真实适配器 |
| AI，显式 zhipu | `createZhipuAiProvider({ apiKey })` | `REAL_CODE_PATH / UNVERIFIED_RUNTIME` | `server.ts:29-32`；当前没有 key，未执行真实请求 |
| Compiler | `createEsp32ArduinoCompiler()` | `REAL_ADAPTER / BLOCKED_TOOLCHAIN` | `server.ts:40`；`esp32-arduino.ts:19-33,44-87`；本机无 `arduino-cli` |
| Device | `createCompanionLocalDevice()` | `DETERMINISTIC_SIMULATION` | `server.ts:41`；固定 ESP32-S3/COM6/115200，非物理检测 |
| Serial | companion-local session buffer + timer | `DETERMINISTIC_SIMULATION` | `companion-local.ts:15-20,55-80` |

### 4.1 最重要结论：当前默认启动不是 Real AI

源码注释称“显式选择、无 fallback”，但分支语义是：只要 `MCU_AI_PROVIDER` 不是精确字符串 `zhipu`，就直接注入 `createMockAiProvider()`。因此在本次真实环境（变量 unset）中，服务器若启动，日志会是 `ai=mock`，需求分析不会触达 GLM。

这不是 `try/catch` 回退，而是默认 Mock 分支；从产品验收角度仍然属于 Mock 生产入口，和 bundle 中“无 mock 生产路径”的结论不一致。

## 5. 真实 GLM 适配器审计

`src/adapters/ai/zhipu-glm.ts` 提供真实代码路径：

- endpoint：`https://open.bigmodel.cn/api/paas/v4`（`zhipu-glm.ts:17`）。
- model：`glm-4.5-flash`（`zhipu-glm.ts:18`）。
- 工作请求强制 `thinking: { type: "enabled" }`（`zhipu-glm.ts:98`）。
- `streamText` 使用真实 `fetch` + SSE 解析（`zhipu-glm.ts:153-201`）。
- `generateStructured` 使用 JSON response format，并有结构化重试（`zhipu-glm.ts:203-282`）。
- 默认请求超时 240s（`zhipu-glm.ts:90-91`）。
- 适配器没有 Mock fallback；不可用时返回 unavailable，由 capability 走 503/失败事件。

本轮状态：`BLOCKED_EXTERNAL_CREDENTIAL`。未读取或打印任何密钥；没有真实 GLM 请求、首 token 计时或完整分析结果证据。bundle 中记录的历史“思考模式约 162s”属于此前运行记录，本轮未复现。

## 6. 构建、烧录和串口边界

### 6.1 Build

`src/adapters/compiler/esp32-arduino.ts:19-87` 是真实本地工具链 adapter：`spawnSync(arduino-cli, ["version"])` 做发现，`spawn(..., shell:false)` 执行构建并流式收集输出。当前机器 `arduino-cli=NOT_FOUND`，所以真实固件 build 是 `BLOCKED_TOOLCHAIN`。

`npm run build` 的 PASS 只表示 Node/React bundle 构建成功，不是固件 build 成功。

### 6.2 Flash / serial

生产组合根固定注入 `createCompanionLocalDevice()`。该 adapter 的源码注释和行为都明确是确定性模拟：

- `detectBoard` 固定返回 ESP32-S3 WROOM-1、COM6、115200（`companion-local.ts:15-20`）。
- `flash` 通过固定进度事件和延迟返回 `exitCode: 0`（`companion-local.ts:28-50`）。
- serial 通过内存 session 和 `tickSerial()` 生成遥测（`companion-local.ts:55-80`）。

因此当前 Flash/serial 只能标注 `DETERMINISTIC_SIMULATION` / `COMPANION_ONLY`，不能标注真实硬件成功。bundle 的 deterministic acceptance 标注与源码一致；“烧录成功”不能被解释为物理板已烧录。

## 7. 持久化和崩溃恢复审计

SQLite task store 确实实现了 `claimNextTask`：`src/adapters/persistence/sqlite/project-store.ts:288-291,464-469`，并且把 `queued/running` 纳入 claim 查询。`src/ports/persistence.ts:28` 也公开了该接口。

但当前 `src/adapters/task/in-process.ts:15-80` 只在 `submit()` 中创建当前任务的函数闭包和 `AbortController`，并直接执行；源码搜索没有发现生产启动时调用 `claimNextTask()` 的 worker/recovery loop。测试验证了 store 的 claim 语义，但没有证明服务器重启后能重新构造并执行原 capability。

结论：数据库层有“可 claim”能力，但端到端的启动恢复链 `BLOCKED/UNWIRED`。不要把“持久化 task row + store 单测”写成“重启可恢复任务已验证”。

## 8. Mock 残留和 bundle 声明交叉核对

bundle 头部声称“313 测试全绿、唯一生产主路径、无 mock 生产路径”，并记录真实 GLM 已接入、build/flash 因工具链/硬件缺失而 deterministic 或 blocked。

本次源码复核结果：

- `313/313`、typecheck、lint、UI build 与 bundle 一致。
- 真实 GLM adapter、真实 arduino-cli adapter 存在，与 bundle 一致。
- 无 arduino-cli、无物理板，与 bundle 的 blocked/deterministic 记录一致。
- 但“无 mock 生产路径”不能直接采信：`server.ts:29-32` 在 provider 未设置时注入 Mock AI。
- UI 仍保留可达的 mock-only 表面：`app/src/App.tsx:124-139` 的 State Lab 浮动入口、`app/src/components/SettingsView.tsx:144` 的 `gemini-3.6-flash (mock)`、`SettingsView.tsx:188` 的 StateLab、`app/src/state/AppContext.tsx:33` 和 `app/src/components/HomeDashboardView.tsx:5` 对 `mock/engine` 的导入。`app/src/lib/i18n.ts:290-291,623-624` 也明确写出 Mock scenarios/mock-only controls。
- `app/src/mock/engine.ts` 自身注释说历史 mock 脚本已经删除，但当前 UI 仍依赖其中的常量/工具；这可以是开发工具残留，但它不支持“用户生产界面完全没有 mock 表面”的强结论。

## 9. 交给计划端的最高优先级发现

### P0/P1 — 默认环境静默进入 Mock AI

**证据**：`src/infrastructure/server.ts:27-32`。`MCU_AI_PROVIDER` unset 或任意非 `zhipu` 值都会注入 Mock。

**影响**：用户可能得到看似成功的需求分析、能力卡和 proposal，但没有真实模型参与；这会污染真实运行数据，也使“唯一生产主路径”判断失真。

### P1 — 真实硬件 Flash 尚未成立

**证据**：`server.ts:41` → `companion-local.ts:15-80`；固定 COM6、固定进度、内存遥测；本机没有物理板。

**影响**：当前只能验收 UI/Port/安全令牌/证据写入等 deterministic 行为，不能宣称烧录或串口链路已在 MCU 上成功。

### P1 — task 崩溃恢复接口存在，但生产启动没有接线

**证据**：store/port 有 `claimNextTask`，但 `createInProcessTasks` 没有 recovery loop，仓库搜索没有生产调用点；任务函数只存在于当前进程闭包。

**影响**：进程重启后，持久化的 queued/running 行不会自动恢复执行；当前测试只证明数据库 claim 语义。

### P1 — UI 仍暴露 Mock-only State Lab / mock model label

**证据**：`App.tsx:124-139`、`SettingsView.tsx:144,188`、`AppContext.tsx:33`、`i18n.ts:290-291,623-624`。

**影响**：源码和界面仍能把 mock 场景作为用户可见功能；与 bundle 的“mock 仅测试/开发适配器”表述不完全一致，需要计划端决定它是否应保留为显式开发工具。

### P1 — 本轮没有真实 GLM 运行证据

**证据**：`MCU_AI_PROVIDER` 与 `MCU_ZHIPU_API_KEY` 均 unset；适配器单测使用 stub fetch；历史 162s 记录未在本轮复现。

**影响**：真实 provider 的网络可达性、当前账号配额、SSE 帧形状、首 token/完成延迟仍是 `UNVERIFIED`。

## 10. 下一阶段建议（由网页端裁决）

本地执行端暂不自行修复以上问题。请计划端选择下一步顺序：

1. 先修复 provider 选择语义，使默认启动 fail-closed 或显式 dev-only Mock；
2. 再决定 State Lab 是否保留为显式开发入口并隔离生产 UI；
3. 再补生产启动 recovery loop，或明确把当前任务恢复能力降级为 store-only；
4. 在凭据和工具链/物理板可用后，分别做真实 GLM smoke 与真实 build/flash 验收。

本阶段结论：代码静态路径和确定性测试链可运行；真实 AI/固件/硬件链没有全量闭环，且默认 server 绑定仍会落入 Mock AI。
