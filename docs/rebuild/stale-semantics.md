# Stale Semantics — 依赖驱动的失效语义

> 日期：2026-08-11（v2：Contract Frozen 修正——Decision 5 落地，级别由 impact 求值）
> 状态：**Frozen**
> 原则：**Stale 属于 Artifact Version 之间的依赖有效性，不属于任何 UI 页面。**
> UI 只是呈现方式（侧栏点/横幅/门禁）；语义在这里定义。
> 前置事实：product-decisions.md（Decision 1 + Decision 3 + Decision 5）+ domain-contract.md（DependencyEdge）

---

## 1. 依赖链（从 UI Frozen 行为反推）

```
Requirements ──▶ Hardware ──▶ Pin Map ──▶ Wiring ──▶ Firmware ──▶ Build / Validation
     │              │            │           │            │
     └──────────────┴────────────┴───────────┴────────────┴──▶ Debug Evidence（烧录后）
```

### 边语义（每条边：什么变化会传播）

| 边 | 传播条件（上游语义变化） | 传播结果 |
|---|---|---|
| Requirements → Hardware | 需求内容变化（能力集/提案集变化） | 下游进入依赖求值（级别由 impact 决定） |
| Hardware → Pin Map | MCU 变化（引脚集/平台） | 下游进入依赖求值（MCU 变化按 Decision 5 属 Blocking 级） |
| Pin Map → Wiring | 引脚分配变化 | 下游进入依赖求值 |
| Wiring → Firmware | 接线/引脚变化影响代码常量 | 下游进入依赖求值 |
| Firmware → Build | 固件内容变化 | 下游进入依赖求值（语义变化 → 需重验证） |
| （任意上游）→ Validation | 上游语义变化 | 验证证据过期，进入依赖求值 |

---

## 2. 什么变化会传播（Semantic vs Metadata）

### Semantic Change（传播）
- 需求内容/能力/已接受提案集变化
- MCU 选择变化
- 引脚分配变化（自动重分配或手动编辑）
- 固件内容变化（接受提案/手动编辑/修复应用）
- 冲突/警告集变化（新冲突出现、旧冲突复发、冲突解决）

### Metadata Change（不传播）
- 版本号/命名/时间戳
- Build 环境信息（toolchain/board/options 变更只影响该 BuildRecord，不影响内容版本）
- 语言/主题偏好
- 视图模式（beginner/professional）

**判别规则**：下游计算是否可能因该变化产生不同结果？是 → Semantic；否 → Metadata。

---

## 3. Propagation Result（传播结果结构）

每次传播产生一组：

```
StaleMark {
  artifact: PinMap | Wiring | Firmware | Build | Validation | DebugEvidence
  level: L1 Informational | L2 Validation Required | L3 Blocking
  reason: string            // 人类可读原因
  fromVersion: ref          // 哪个上游版本导致
  triggeredBy: ref          // 哪个变化（artifact.version.created / manual edit）
  revalidationRule: ref     // 对应 revalidate 规则
}
```

**规则**：
- 传播不删除下游、不修改下游内容——只打标记。
- 下游已 Error 的保持 Error（不降级为 Stale）。
- 一个下游可以同时有多个上游 Stale 源 → 级别取最高。

---

## 4. Stale Level 判定（Decision 3 + Decision 5 落地）

**级别不由 Artifact 类型硬编码**；由依赖求值计算：

```
StaleLevel = f( Change Classification, Dependency Relation, Known Validation Result )

输入① Change Classification（变化分类）：
  - metadata-only          → Informational
  - semantic-possibly-valid → Validation Required
  - hard-constraint-break   → Blocking

输入② Dependency Relation（该边传播语义 + 下游当前验证状态）
输入③ Known Validation Result（该下游最近一次验证记录）
```

| 分类 | 默认级别 | 示例 |
|---|---|---|
| Metadata-only change | **L1 Informational** | 名称、描述、UI 标记、非执行语义标签 |
| Semantic change，但当前结果仍可能有效 | **L2 Validation Required** | 某些 requirement 参数更新，需重新确认 downstream validity |
| 已知破坏硬约束或执行可信度 | **L3 Blocking** | MCU changed、pin assignment changed、target board changed、firmware dependency changed、incompatible peripheral mapping |

禁止把 `Firmware changed = Blocking` 这类静态规则写死在 UI 或 Domain（Decision 5）。

**门禁矩阵**：

| 动作 | L1 | L2 | L3 |
|---|---|---|---|
| 查看/浏览 | ✅ | ✅ | ✅ |
| 查看 Diff | ✅ | ✅ | ✅ |
| 修复/编辑 | ✅ | ✅ | ✅ |
| Revalidate | ✅ | ✅ | ✅ |
| 生成固件/编译 | ✅ | 提示后 ✅ | 视触发边（固件依赖 L3 → ❌ 提示 Revalidate） |
| Flash | ✅ | 提示后 ✅ | ❌ |
| 标记 Validation 成功 | ✅ | 需重验证 | ❌ |
| 宣称 Project Validated | ✅ | ❌（未全验证） | ❌ |

---

## 5. Revalidation Rule（Decision 1 落地）

```
Revalidate(artifact)
↓
读取该 artifact 所有上游的"已接受决策"（MCU 选择、已接受 Pin/Firmware Proposal）
↓
重新计算（自动分配 / 规则校验 / 固件生成 / 构建）
↓
结果对比 base 版本
├─ 无语义变化（内容等值）
│     → 标记 Validated（保留原版本身份，或按实现选择 bump 元数据版本）
└─ 有语义变化（内容不同）
      → create_proposal（新 Proposal，携带 diff/impacts）
      → ProposalReady → 用户 Accept / Reject
      → Accept → 新 ArtifactVersion → 继续下游 Revalidate
```

**明确禁止**：Revalidate 自动接受新的工程修改（新冲突/新引脚/新 Diff/新行为必须重新提案）。

**Revalidate 链式规则**：下游 Revalidate 依赖上游完成；上游产生新版本时，下游重新进入 Revalidate（而非沿用旧版本）。

---

## 6. 边界与延后项

1. **"内容等值"的判定粒度**：结构化 diff（字段级）判定语义变化；算法在实现阶段定（已列为 Architecture/Persistence Decision Input）。
2. **手动编辑**：所有者直接编辑 → 新版本（免提案，Decision 4）；仍触发依赖求值与 Stale 传播（本节规则适用）。
3. **Stale 默认级别**：按 Decision 5 由 impact 求值；具体"变化分类"的判定实现（如何区分 metadata/semantic/hard-break）在实现阶段按规则表落地。
4. **StaleMark 历史**：倾向当前态 + 事件留痕（logical-events artifact.stale）；是否永久历史化延后。
