# Contract Review — 冻结状态报告

> 日期：2026-08-11（v2：Contract Frozen 修正完成）
> 状态：**✅ CONTRACT FROZEN**（产品负责人批准，条件已全部满足）
> 后续约束：**Architecture 不得改变已冻结的 Product / Interaction / Application Contract。若架构与 Contract 冲突 → 修改架构，不是修改 Contract 来迁就旧代码。**

---

## 0. 修正记录（v1 → v2）

| # | 修正 | 状态 |
|---|---|---|
| 1 | domain-contract 对象数统一为 **8 类**（Project/Artifact/ArtifactVersion/Proposal/BuildRecord/ValidationRecord/DependencyEdge/DeviceSession）；DependencyEdge 补强独立生命周期论证（声明拓扑 + 运行时 StaleMark） | ✅ |
| 2 | **Decision 4**（手动编辑免 Proposal；门禁只约束 AI/自动化；仍触发依赖求值与 Stale）→ product-decisions + domain-contract（I-11）+ interaction（D4）+ application（commit_manual_edit） | ✅ |
| 3 | **Decision 5**（Stale 级别由 dependency impact 求值：Change Classification + Dependency Relation + Known Validation Result；禁止类型硬编码）→ product-decisions + stale-semantics §4 | ✅ |
| 4 | **Decision 6**（不静默级联物理删除；归档语义；被引用资产破坏性删除需确认+Impact；历史保留；物理清除延后）→ product-decisions + domain-contract（I-10）+ interaction（A3）+ application（delete_project） | ✅ |
| 5 | **Decision 7**（多轮 Clarification 不提升 Aggregate；Analysis Session 内交互记录；roundId）→ product-decisions + domain-contract（I-12）+ interaction（B4）+ application（2.2/2.3）+ logical-events | ✅ |
| 6 | 其余歧义（Revalidate Diff UI 粒度 / Debug Evidence retention / Decision history 存储粒度 / StaleMark 历史化）明确**延后为 Architecture / Persistence Decision Input** | ✅ |

## 1. 已冻结的 Contract（一致性已验证）

| 契约 | 文档 | 冻结内容 |
|---|---|---|
| Product Decisions | product-decisions.md | **7 项**：D1（Revalidate 沿用决策、语义变化必提案）、D2（版本≠Build、BuildRecord 分离）、D3（Stale 三级）、D4（手动编辑免提案）、D5（Stale 级别由 impact 求值）、D6（归档语义、禁静默级联）、D7（Clarification 不提升 Aggregate） |
| Interaction | interaction-contract.md | 22 个用户动作 × 10 字段（含新增 D4 Edit Pin）；纯产品行为，零实现词汇 |
| Application | application-contract.md | 21 个 Capability（含 commit_manual_edit；8 个异步可取消 + 事件化；AI 全部以 Proposal 收口，人工路径唯一例外） |
| Domain | domain-contract.md | **8 个领域对象** + 12 条不变量 + 拒绝表（ProposalDecision/Clarification/Capability 卡片不建对象） |
| Stale | stale-semantics.md | 依赖链 6 边 + 传播条件 + Semantic/Metadata 判别 + StaleMark 结构 + 三级门禁矩阵 + Revalidate 规则 + **impact 求值判定（D5）** |
| Events | logical-events.md | 4 域 30+ 逻辑事件（含澄清 roundId）+ 载荷结构 + 规则——传输无关 |
| V2 Mapping | v2-contract-mapping.md | 全模块 REUSE/EXTRACT/REWRITE/DELETE 裁定（含理由） |
| Architecture | architecture-blockers-v2.md | 10 项可决技术决策 + 9 项延后 + 双模式一致性承诺 |

**一致性核查通过**：
- Interaction 每个异步动作都有对应 Capability + 事件组（无孤儿）
- Proposal gate 贯穿 Interaction C/D/E/F + Application 2.4/2.5 + Domain I-1/I-3（唯一例外 = commit_manual_edit，D4 显式授权）
- Decision 2 在 Application 2.12 + Domain §3 + Interaction F1 三处一致
- Decision 1 在 Application 2.14 + stale-semantics §5 + Interaction G1 三处一致
- Decision 3/5 在 Interaction 约束声明 5 + stale-semantics §4 + Application 2.15 门禁一致

## 2. 冻结时确认的延后项（Architecture / Persistence Decision Input，不阻塞）

| # | 项 | 备注 |
|---|---|---|
| A-1 | Revalidate Diff 的 UI 展示粒度（结构化 diff 字段范围） | 算法实现时定 |
| A-2 | Debug Evidence retention（归档触发） | 倾向烧录成功自动归档 |
| A-3 | Decision history 存储粒度 | 倾向全留（审计/回滚） |
| A-4 | StaleMark 是否永久历史化 | 倾向当前态 + 事件留痕 |

## 3. 现在终于有足够依据的技术决策（T-1..T-10）

1. BuildRecord 字段集（环境快照 + 结果 + 诊断）
2. ArtifactVersion 不可变 + 单调版本号
3. Proposal gate 无例外（AI 修改必经提案）
4. 逻辑事件分类表 + 订阅粒度
5. Stale 三级门禁矩阵
6. Revalidate 规则 + 内容等值判定方向
7. Capability 边界清单（20 项）
8. 依赖边清单与传播条件
9. 高风险操作确认令牌（flash/delete）
10. 禁止"默认 Fake"（真实实现或显式注入）

## 4. 仍应延后的决策（D-1..D-9）

传输（RabbitMQ/SSE/WS/in-process）· 存储引擎（Postgres/SQLite/文件+git）· Local-first 双模式机制 · Companion 协议 · 认证实现 · Provider 适配实现 · diff 算法 · 事件存储/重放 · 多用户权限细化

**核心保证**：双模式一致性承诺（architecture-blockers-v2.md §4）使契约冻结与传输/存储决策完全解耦——契约冻结不阻塞后续架构探索，反之亦然。

---

## 结论

**CONTRACT FROZEN** ✅（2026-08-11 批准）。7 项 Product Decisions + 22 项 Interaction + 21 Capabilities + 8 个领域对象 + Stale 三级（impact 求值）+ 30+ 逻辑事件 + V2 映射全部冻结。

后续 Architecture 阶段：若与 Contract 冲突 → **修改架构**。Architecture Review 通过后执行 /to-spec → Spec Review → /to-tickets（仍不实现）。
