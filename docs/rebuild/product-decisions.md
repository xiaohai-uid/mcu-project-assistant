# Product Decisions — Contract 阶段上游事实

> 日期：2026-08-11
> 状态：**Adopted（UI Frozen — Conditional Approved 后由产品负责人确认）**
> 依据：UI Acceptance 走查暴露的问题（ui-acceptance-report.md §10）+ UI Frozen 范围（§1-§22 冻结交互）
> 纪律：以下决策从产品行为出发，不是技术实现选择。

---

## Decision 1 — Revalidate 的语义

**状态：Adopted**

**决策**：Revalidate 默认沿用已经被用户明确接受的决策，但不得静默接受新的 Proposal。

**规则**：

```
Revalidate
↓
读取已接受决策（MCU 选择 / Pin Proposal / Firmware Proposal 等）
↓
重新计算
↓
┌─ 无语义变化 ──────────────→ Validated（不产生新提案）
│
└─ 有语义变化 ──────────────→ ProposalReady
     （新冲突 / 新引脚变化 /        → 用户 Accept / Reject
       新 Firmware Diff /
       新行为变化）
```

**明确禁止**：

> Revalidate 自动替用户接受新的工程修改。

**判别"语义变化"的初始清单**（详见 stale-semantics.md）：

| 类别 | 是否语义变化 | 示例 |
|---|---|---|
| 内容变化 | 是 | MCU 更换、需求内容变化、引脚分配变化、固件代码变化 |
| 冲突/警告集变化 | 是 | 新出现 strapping 冲突、已解决的冲突复发 |
| 纯元数据变化 | 否 | 版本号、时间戳、构建环境记录、命名 |

**为什么**：用户对 AI 修改的批准是逐条、可见、可逆的（UI 已验证三态 Proposal）。如果 Revalidate 自动接受新内容，等于绕过 Proposal gate，破坏"AI 不静默覆盖"原则；但每次都重走决策又会让"仅环境/元数据变化"的重验证变成噪声。分界线 = 是否产生**语义变化**。

---

## Decision 2 — Rebuild 的版本语义

**状态：Adopted**

**决策**：Build 不直接创建新的 Firmware Artifact Version。

**两条对象语义分离**：

### Artifact Version
代表：**工程资产本身发生变化**。
只在正式内容变化时产生（通常是接受 Proposal / 用户手动编辑）。

### Build Record
代表：**某个 Artifact Version 在某个环境中的一次验证执行**。
同一 Firmware Version 可以有多次 Build（不同环境、不同时间、不同结果）。

**示例**：

```
Firmware v3
↓
Build #17 FAILED
↓
Diagnosis
↓
Fix Proposal
↓
Accept  →  Firmware v4（内容变化才产生新版本）
↓
Build #18 SUCCESS（v4 的一次验证执行）
```

**明确规则**：
- Build #14 / #15 / #16 属于同一 Firmware Version → 不制造三个 Firmware Version
- BuildRecord 环境字段至少记录：toolchain、toolchain version、board target、options、timestamp、result、diagnostics（存储格式延后）

**为什么**：UI 走查暴露"Build 成功后无重建入口"与"失败后重建"的需求（acceptance-report §10-2）。如果每次 Build 都产生版本，版本号将失去"内容指纹"意义，Stale/回滚/提案 Diff 全部失真。版本 = 内容身份；Build = 验证证据。

---

## Decision 3 — Stale 的阻塞级别

**状态：Adopted**

**决策**：不把所有 Stale 一律 Blocking。采用三级语义：

### L1 — Informational Stale
变化不影响当前工程有效性。
- 允许：继续查看、继续操作
- 典型：元数据变化、不影响下游计算的信息性提示

### L2 — Validation Required
依赖已经变化，需要重新验证。
- 允许：浏览
- 要求：关键动作前提示用户（不硬拦截，但显式提示）

### L3 — Blocking Stale
存在安全性或确定性的硬依赖破坏。
典型触发：
- MCU 改变导致旧 Pin Map 不再可信
- Pin Map 改变但 Firmware 尚未重新确认
- 当前 Firmware 与目标 MCU 不兼容
- Build 所依赖的 Artifact 已发生语义变化

**禁止**（L3 下）：
- Flash
- 将 Validation 标记为成功
- 将项目宣称为 Validated

**不禁止**（L3 下仍然允许）：
- 查看旧内容
- 查看 Diff
- 修复
- Revalidate

**为什么**：UI 走查中 Stale 被实现为"主操作硬禁用"（acceptance-report §10-3）。一刀切 Blocking 会阻止用户查看/诊断/修复，且把"提示级"与"安全级"失效混为一谈。三级模型写进 Contract 后，UI 呈现可以精确到：徽标颜色（信息/需验证/阻塞）+ 动作门禁矩阵。

---

## Decision 4 — 手动编辑与 Proposal

**状态：Adopted（Contract Frozen 修正）**

**决策**：用户本人直接编辑正式 Artifact，不需要 Proposal。Proposal Gate 只约束 **AI / 自动化系统**试图修改正式 Artifact 的行为。

```
User manual edit
→ New Artifact Version          （直接产生，无需提案）

AI generated modification
→ Proposal → Diff → Impact → Accept / Reject → New Artifact Version
```

**仍必须触发 Stale**：

```
Manual Edit
↓
New Artifact Version
↓
Dependency Evaluation
↓
Possible Stale Propagation
```

**为什么**：Proposal 是 AI 安全边界，不应该变成所有人工编辑的审批系统。但人工编辑改变了工程事实，下游依赖仍然需要按 Decision 5 求值传播。

---

## Decision 5 — Stale 默认级别由 dependency impact 决定

**状态：Adopted（Contract Frozen 修正）**

**决策**：不通过"Artifact 类型"硬编码 Stale Level（禁止 `Firmware changed = Blocking` 这类静态规则写死在 UI 或 Domain）。

**级别判定输入**（至少表达）：

```
Change Classification（变化分类）
+ Dependency Relation（依赖关系）
+ Known Validation Result（已知验证结果）
→ Stale Level
```

**分类 → 级别默认映射**：

| 变化分类 | 默认级别 | 示例 |
|---|---|---|
| Metadata-only change | Informational | 名称、描述、UI 标记、非执行语义标签 |
| Semantic change，但当前结果仍可能有效 | Validation Required | 某些 requirement 参数更新，需重新确认 downstream validity |
| 已知破坏硬约束或执行可信度 | Blocking | MCU changed、pin assignment changed、target board changed、firmware dependency changed、incompatible peripheral mapping |

---

## Decision 6 — 删除语义

**状态：Adopted（Contract Frozen 修正）**

**决策**：核心工程对象默认**不进行数据库式静默级联删除**。

- 删除某个正式 Artifact Version 时，不允许顺手物理删除：Proposal history、BuildRecord、ValidationRecord、Dependency evidence。
- 用户层面的"删除"优先语义 = **Archive / Retire / Remove from active project**，而非 Hard delete all descendants。
- 仍被其他对象引用的正式工程资产：**阻止 destructive delete，或要求显式确认并展示 Impact**。
- 审计、Build、Validation 类历史记录默认保留。
- 真正物理清除属于 **retention / privacy / storage policy**，延后到 Persistence / Compliance 决策。

---

## Decision 7 — Clarification 不提升为独立 Aggregate

**状态：Adopted（Contract Frozen 修正）**

**决策**：多轮 Clarification 仍属于 Requirement Analysis / Discovery Session 中的交互记录，不创建重量级 Clarification Aggregate。

Application Contract 需支持：

```
Analysis
↓
Clarification Requested
↓
User Answer
↓
Analysis Continues
↓
Possible Further Clarification（可多轮）
```

未来如需持久化：保存 interaction history / analysis trace（存储结构延后）。

---

## 冻结声明

以上 7 项 Product Decision 与 UI Frozen 范围共同构成 Contract 阶段上游事实来源。后续 Interaction / Application / Domain / Persistence / Architecture 契约均不得违背以上决策；如发现冲突，回到本文件修订，而不是静默偏离。
