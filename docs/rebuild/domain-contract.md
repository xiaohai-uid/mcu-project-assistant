# Domain Contract — 对象与不变量

> 日期：2026-08-11（v2：Contract Frozen 修正——8 类对象 + Decision 4/6/7 落地）
> 状态：**Frozen**
> 方法：Interaction + Application Contract 完成后才允许设计 Domain。
> 纪律：**候选对象必须解释"为什么这个对象必须拥有独立生命周期和不变量"**。UI 出现一张卡片 ≠ 建一张表；V2 有 DesignSpec ≠ 保留；旧系统有 Stage ≠ 包装成 Artifact Stage。

---

## 1. 候选对象裁定（**8 个独立 Domain Object**）

| 候选对象 | 裁定 | 理由（独立生命周期 + 不变量） |
|---|---|---|
| **Project** | ✅ 保留（1/8） | 长期工作区容器：拥有 artifact 集合；生命周期 = 创建→编辑→归档→删除；不变量：名称非空、视图模式（beginner/professional）是偏好非领域属性、**归档/删除按 Decision 6（不静默级联物理删除）** |
| **Artifact** | ✅ 保留（2/8） | 一类工程资产的容器（requirements/hardware/pinmap/wiring/firmware/validation/build/debug）；不变量：种类固定枚举、持有"当前版本"指针、不直接持有可变内容 |
| **ArtifactVersion** | ✅ 保留（3/8） | 内容快照 + 状态；**不可变**；不变量：版本号按 artifact 单调递增、内容一经创建不可原地修改、状态机（draft→accepted→validated/stale/error/warning）、一个版本 = 一次"内容身份" |
| **Proposal** | ✅ 保留（4/8，一等公民） | 见 §2；不变量：提案 ≠ 版本、拒绝零效果、引用 base 版本、单一决策 |
| **BuildRecord** | ✅ 保留（5/8） | 验证执行证据；不变量：引用唯一 ArtifactVersion + 环境快照、同版本可多次 Build（Decision 2）、结果三态（succeeded/failed/cancelled）、失败也落记录 |
| **ValidationRecord** | ✅ 保留（6/8） | 规则验证执行证据；不变量：引用版本、结果 pass/warn/fail、**验证未运行 ≠ 通过**（不得误报成功）、新版本需新验证 |
| **DependencyEdge** | ✅ 保留（7/8） | 见上表注释：依赖关系一等实体（声明拓扑 + 运行时 StaleMark）；级别由 impact 求值 |
| **DeviceSession** | ✅ 保留（8/8） | Companion 会话：检测→连接→烧录→断开；不变量：单活动会话、会话本身不是项目数据（瞬态）、烧录/遥测证据以 DebugEvidence 持久化、断开中止进行中操作 |
| **Clarification** | ⚠️ 不建独立对象 | 见 Decision 7：多轮澄清仍是 Requirement Analysis / Discovery Session 内的交互记录；不提升为独立 Aggregate |
| **ProposalDecision** | ⚠️ 不建独立对象 | 是 Proposal 的状态属性（pending/accepted/rejected），不是独立生命周期；拒绝"每 UI 卡片一张表"反模式 |
| **Requirement/Capability/MCU Candidate/Peripheral** | ⚠️ 不建独立对象 | 是 ArtifactVersion 的**内容**（requirements 版本内容 = 能力+提案摘要；hardware 版本内容 = MCU+外设）；无独立生命周期 |
| **Copilot 消息/提案卡** | ⚠️ 不建领域对象 | UI 层呈现（可引用 proposal/version 渲染）；领域对象是 Proposal/ArtifactVersion |
| **DesignSpec / Stage / Pipeline / Orchestrator** | ❌ 删除 | V2 概念；见 v2-contract-mapping.md；新域根是 Project + ArtifactVersion |

---

## 2. Proposal 一等模型（强制）

```
Current Artifact Version
↓
AI Analysis（analyze / recommend / generate / diagnose）
↓
Proposal { baseVersion, kind, payload, diff, impacts[] }
↓
Diff 展示 → Impact 展示
↓
User Decision
├─ Reject → 零 artifact 变化（版本不变）
└─ Accept → 恰产生一个新 ArtifactVersion（内容 = payload）
```

**明确规则**：
1. **Proposal ≠ ArtifactVersion**：提案是"待决内容"；版本是"已决内容"。提案被拒绝不能改变正式 Artifact。
2. 每个 Proposal 恰有一个决策（pending → accepted | rejected），决策可改主意，但决策历史保留。
3. Accept 的幂等语义：同一提案重复 Accept 不产生多个版本（第二次是 no-op 或返回已有版本）。
4. AI 的任何修改路径（需求形式化、引脚修复、固件重映射、构建修复）**必须**经过 Proposal——没有例外，没有"直接写"。
5. Proposal 携带 diff（新旧内容对比）与 impacts[]（受影响下游），这是 UI Diff 视图的数据源。

---

## 3. ArtifactVersion 与 BuildRecord 分离（强制）

```
Artifact
└── ArtifactVersion        ← 内容身份；仅内容变化时产生
      ├── status: draft / accepted / validated / stale / error / warning
      └── BuildRecord[]    ← 验证执行；同版本可多次
            ├── environment: { toolchain, toolchainVersion, boardTarget, options }
            ├── timestamp
            ├── result: succeeded / failed / cancelled
            └── diagnostics[]
```

**规则**：
1. Firmware Version 只在正式内容变化时产生（接受 Fix Proposal / 接受固件提案 / 手动编辑）。
2. Build #14/#15/#16 同一版本多次构建 → 一个 Firmware Version + 三个 BuildRecord。
3. Build 失败不产生新版本；诊断 + 修复提案被接受后才产生新版本（Decision 2 示例：v3 → Build#17 FAIL → fix accepted → v4 → Build#18 OK）。
4. BuildRecord 环境字段至少：toolchain、toolchain version、board target、options、timestamp、result、diagnostics（存储格式延后）。

---

## 4. 核心不变量清单（全局）

| # | 不变量 | 来源 |
|---|---|---|
| I-1 | AI 不静默覆盖已接受内容（一切修改经 Proposal） | UI Frozen §4 + Product Decisions |
| I-2 | ArtifactVersion 不可变（内容只增不改） | 版本语义 |
| I-3 | Reject 零效果；Accept 恰一新版本 | Proposal 模型 |
| I-4 | 上游语义变化 → 下游 Stale（不删除下游） | UI Frozen §15 |
| I-5 | Revalidate 沿用已接受决策；语义变化必须新 Proposal | Decision 1 |
| I-6 | Build/Validation 不产生新内容版本；失败也落记录 | Decision 2 |
| I-7 | 验证未运行 ≠ 通过（禁误报成功） | 旧工程教训（trust baseline） |
| I-8 | L3 Stale 禁 Flash / 禁标 Validation 成功 / 禁宣称 Validated；不阻查看/Diff/修复/Revalidate | Decision 3 |
| I-9 | Stale 属于依赖有效性，不属于页面 | UI Frozen §15 |
| I-10 | 删除语义：不静默级联物理删除；用户级删除 = 归档/退役；被引用资产的破坏性删除需确认 + 展示 Impact；审计/Build/Validation 历史默认保留；物理清除属 retention/privacy/storage policy（延后） | Decision 6 |
| I-11 | **手动编辑（所有者本人）免 Proposal 直接产生新版本**；Proposal Gate 只约束 AI/自动化；手动编辑仍触发依赖求值与 Stale 传播 | Decision 4 |
| I-12 | 多轮 Clarification 不提升为独立 Aggregate；作为 Analysis Session 的交互记录；未来持久化为 interaction history / analysis trace（延后） | Decision 7 |

---

## 5. 已裁决（Contract Frozen 修正）与延后项

**已裁决（不再开放）**：
1. 手动编辑版本语义 → **Decision 4**（所有者直接写 = 新版本，无需提案；仍触发依赖求值/Stale）
2. 删除级联范围 → **Decision 6**（归档语义；不静默级联；被引用资产破坏性删除需确认+Impact；历史记录保留）
3. Clarification 地位 → **Decision 7**（不提升 Aggregate；Analysis Session 内交互记录；多轮支持）
4. Stale 默认级别 → **Decision 5**（按 dependency impact 求值，不按 artifact 类型硬编码）

**保留为 Architecture / Persistence Decision Input（不阻塞 Frozen）**：
1. Revalidate Diff 的 UI 展示粒度（结构化 diff 字段范围）
2. Debug Evidence retention（归档触发：倾向烧录成功自动归档，仍开放）
3. Decision history 的具体存储粒度（倾向全留：审计/回滚依据）
4. StaleMark 是否永久历史化（倾向当前态 + 事件留痕）
