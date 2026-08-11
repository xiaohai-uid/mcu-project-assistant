# Logical Events — 逻辑事件模型

> 日期：2026-08-11
> 状态：Draft（Contract Review 后 Frozen）
> 原则：UI 已证明需要进度/状态推送（acceptance-report §10）。这里只定义**逻辑事件**（名称 + 语义载荷），
> **不决定** RabbitMQ / SSE / WebSocket / Redis / in-process bus——传输选择延后到 Architecture 阶段。

---

## 1. 事件分类

| 域 | 事件 | 语义 | 主要消费方 |
|---|---|---|---|
| **Project** | `project.created` / `project.deleted` | 项目生命周期 | UI Home |
| **Analysis** | `requirement.analysis.started` | 分析开始（含 analysisId） | Requirements 视图、Copilot |
| | `requirement.analysis.progress` | 流式进度（chunk / 阶段标记） | 流式输出区 |
| | `requirement.analysis.clarification.requested` | 需要澄清（问题+可选项，**roundId 支持多轮**，Decision 7） | 澄清卡 |
| | `requirement.analysis.completed` | 分析完成（能力 + 提案摘要） | 能力卡、提案区 |
| | `requirement.analysis.failed` | 分析失败（原因） | 错误横幅 + 重试 |
| | `requirement.analysis.cancelled` | 用户取消 | "已取消"提示 |
| **Proposal** | `proposal.created` | 新提案（引用 base 版本） | 提案卡、Copilot、历史 |
| | `proposal.accepted` / `proposal.rejected` | 决策完成 | 三态徽标、历史、审计 |
| **Artifact** | `artifact.version.created` | 新版本（内容身份变化） | 版本徽标、侧栏点 |
| | `artifact.stale` | 下游被打 Stale 标记（含 level/reason） | 侧栏点、StaleBanner、门禁 |
| | `artifact.revalidating` / `artifact.revalidated` | Revalidate 过程/完成 | Revalidate 进度 |
| **Validation** | `validation.started` / `validation.completed` / `validation.failed` | 规则校验过程 | 校验徽标 |
| **Build** | `build.started` | 构建开始（BuildRecord 引用） | Build 视图、侧栏 |
| | `build.output` | 逐行输出（stream） | 日志区 |
| | `build.failed` / `build.succeeded` / `build.cancelled` | 构建结束 | 结果徽标、诊断入口 |
| **Diagnosis** | `diagnosis.completed` | 诊断完成（原因+建议+fix proposal） | 诊断卡 |
| **Device** | `device.detected` / `device.connected` / `device.disconnected` | 会话状态 | 顶栏、Companion |
| | `device.flashing` / `device.flash.completed` / `device.flash.failed` | 烧录过程/结果 | 烧录进度、确认后流程 |
| | `serial.output` | 串口遥测行 | Serial 控制台、DebugEvidence |
| **Runtime** | `provider.available` / `provider.unavailable` | AI 供应商状态 | 全局横幅、Copilot 禁用 |
| | `toolchain.available` / `toolchain.unavailable` | 工具链状态 | Build 门禁 |

---

## 2. 事件载荷（逻辑结构，非序列化格式）

```text
LogicalEvent {
  id: string
  type: 上表事件名
  projectRef?: ref
  timestamp: ISO8601
  payload: 事件专有字段（见下）
}

// 示例载荷
requirement.analysis.progress   { analysisId, stage: "streaming"|"capabilities"|"finalizing", chunk?: string }
proposal.created                { proposalRef, kind, baseVersionRef, summary, impacts[] }
artifact.stale                  { artifactKind, level: L1|L2|L3, reason, fromVersionRef, triggeredBy }
build.output                    { buildRef, line, kind: cmd|info|ok|err|warn }
device.flashing                 { deviceRef, progressPercent }
serial.output                   { deviceRef, line }
```

---

## 3. 事件规则

1. **只读通知**：事件是事实广播，不是命令（命令走 Application Capability）。
2. **可重放**：UI 可以按需重放（如打开项目时恢复状态）——事件源语义可选，但事件必须可追溯（id + timestamp + projectRef）。
3. **顺序保证**：同一 projectRef 内的事件有序（跨项目无需全局序）。
4. **背压/丢弃**：`build.output` / `serial.output` 这类高频流事件允许合并/丢弃旧样本（UI 只关心最新日志尾部）。
5. **订阅粒度**：按 projectRef 订阅；`serial.output` / `build.output` 可单独订阅（高频）。
6. **不绑定传输**：以上只是逻辑契约；本地模式可用进程内分发，Cloud 模式可用任何通道——语义不变（Local-first 双模式一致性的前提）。

---

## 4. 与 Capability 的对应

每个异步 Capability（application-contract.md §2）的 Progress Events 字段引用的就是本节事件名。例如：
- `analyze_requirement` → `requirement.analysis.*`
- `run_build` → `build.*`
- `flash_device` → `device.flashing` / `device.flash.*`
- `revalidate_artifact` → `artifact.revalidating` / `artifact.revalidated` / `proposal.created`

UI 的呈现层（Stale 横幅、流式输出、构建日志、遥测）全部由事件驱动，不轮询（轮询仅作兜底——这是 UI Acceptance 已验证的呈现需求）。
