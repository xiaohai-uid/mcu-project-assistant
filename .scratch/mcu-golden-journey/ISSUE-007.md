# ISSUE-007 — S5B Stale Propagation + Revalidate end-to-end

**Status:** resolved
**Blocked by:** ISSUE-006（Pin Map + Wiring Generation & Validation e2e）
**Priority:** P0-core

## 1. User-visible outcome

用户更换 MCU（或手动改引脚）后：侧栏受影响 artifact 出现琥珀点、工作区顶部出现 Stale 横幅（含影响链与级别）、Firmware/Build 主操作被拦截（L3 门禁）；点击"重新验证"后逐项恢复（无语义变化→Validated；有语义变化→新 Proposal 待决策，不自动接受）。

## 2. Frozen upstream references

- UI：StaleBanner/侧栏状态点/门禁、ui-state-model.md（W17/W18、O5）、ui-acceptance-report §6
- Interaction Contract：G1 Revalidate / G2 查看 Stale 内容
- Application Capability：revalidate_artifact（application-contract 2.14）
- Domain Invariant：I-4（上游语义变化→下游 Stale，不删除下游）、I-8（L3 禁 Flash/禁标成功/禁宣称 Validated）、I-9（Stale 属依赖有效性）
- Product Decision：D1（Revalidate 沿用决策；语义变化必新提案）、D3（三级）、D5（级别由 impact 求值）
- ADR：0003/0013
- Implementation Spec：§7 版本提交后触发依赖求值、§11 Dependency Evaluation Service（输入/输出）、§15 S5B
- stale-semantics.md：六边依赖图 + 门禁矩阵 + Revalidate 规则

## 3. In scope

- DependencyEdge（**代码常量**——六条边 seed，不建表）与 Dependency Evaluation Service（输入 old/new/classification/edges/knownValidation → StaleEvaluation[]；级别 = f(分类, 依赖, 验证)，**禁类型硬编码**）
- StaleMark 当前态持久化（stale_marks 表：level L1/L2/L3、reason、source_version_id、resolved_at；**不建历史子系统**）
- 版本提交后自动触发依赖求值（T1/T2 同事务写 marks——S2/S4 的事务扩展）
- 门禁：L3 下 flash/validation-success/project-validated 拒绝（UI 拦截 + 应用层校验）
- revalidate_artifact：POST /projects/:id/commands {capability:"revalidate_artifact"} → 逐项重算：**无语义变化→Validated；有语义变化→create_proposal（复用 S3B 机制）待决策**
- 语义变化检测：结构化 diff（版本内容对比；算法本票实现最小版——字段级对比规则表）
- UI：Stale 横幅/侧栏点/门禁/Revalidate 进度切真实 API

## 4. Out of scope

- StaleMark 历史化/审计子系统（延后决策，禁止提前实现）
- 通用 DAG/Workflow 引擎（仅六边固定图 + 求值服务）
- 固件生成（S6）；L3 与 Flash 的实际联动（S9 接入门禁）

## 5. Mock being replaced

```
mockSTALE_FROM / mockRevalidateAll（AppContext 内存标志 + 链式重置）
→ real dependency-evaluation + stale_marks + revalidate_artifact
mock Stale 徽标/横幅（UI 静态）
→ real 状态点/横幅（服务端 marks 数据）
```

## 6. End-to-end flow

```
换 MCU（S4 select_mcu）→ 事务内依赖求值：
   classification=hard-constraint-break（MCU 变化）→ 下游 pin_map/wiring/firmware/build 打 L3/L2 marks
→ artifact.stale 事件 → UI 横幅 + 侧栏琥珀点 + 门禁（Firmware 生成按钮禁用）
→ 手动改引脚（S2）→ 求值 → wiring/firmware/build marks
→ POST /commands {revalidate_artifact} → 逐项：
    pin_map 重算（同决策）→ 无语义变化 → Validated
    firmware 重算 → 有语义变化 → create_proposal（等待用户 Accept/Reject——不自动接受，D1）
→ 用户决策后 → 继续下游 → 全部恢复
→ L3 期间 flash 请求 → 拒绝（I-8）
```

## 7. Minimum domain changes

- DependencyEvaluation 服务 + StaleMark 类型（当前态）；DependencyEdge 为常量数据
- 无其他新对象

## 8. Minimum persistence changes

- 表：stale_marks（project_id/artifact_id/affected_version_id/level/reason/source_version_id/triggered_by/created_at/resolved_at；UNIQUE(artifact_id, affected_version_id) 未解决时）
- 索引：idx_stale_project

## 9. Ports / Adapters

- PersistencePort 扩展：UoW 增 saveStaleMarks/resolveStaleMarks；只读 activeStaleMarks
- 无新 Port

## 10. Error states

- 409 BlockingStale（L3 门禁拒绝：flash/标成功/宣称 Validated）；409（无 stale 时 revalidate）

## 11. Tests first

- Domain：**D5 判定表**（metadata→L1 / semantic→L2 / hard-break→L3；同输入同输出；禁类型硬编码——firmware 变化 ≠ 恒 L3）、求值输出结构（target/reason/level/source/affected/requiresRevalidation）
- Application：revalidate_artifact（无语义变化→Validated；有→Proposal；不自动接受——D1 测试）、门禁拒绝
- Persistence：stale_marks 约束/解决语义（resolved_at）
- Contract：/commands revalidate_artifact、409 BlockingStale 信封
- Browser/E2E：见 §12

## 12. Browser acceptance

```
选 ESP32-S3 → 引脚生成 → 固件生成（S6 前置可先手工完成或本票用占位）
→ 回到 Hardware 换 RP2040 → 侧栏琥珀点 + 顶部 Stale 横幅（Pin Map→Wiring→Firmware→Build）
→ Firmware 视图"生成固件"按钮被拦截（L3）
→ 点"全部重新验证" → 逐项进度 → 无语义变化项转绿；有语义变化项出提案卡（不自动接受）
→ 决策后全部 Validated → 横幅消失
→ Lab 触发"强制下游过期"→ 门禁再次生效
```

## 13. Definition of Done

- typecheck/lint/test 绿（D5 判定表 + D1 不自动接受测试必须存在）；e2e:golden 相关用例绿
- 浏览器验收全过；Mock Stale/Revalidate 生产路径删除
- 无 Stale 历史子系统；无 DAG 引擎；无 fallback

## 14. Forbidden shortcuts

- 禁止按 Artifact type 硬编码级别（D5：如 `firmware changed = Blocking`）
- 禁止 Revalidate 自动接受新提案（D1）
- 禁止 StaleMark 历史化（延后决策）
- 禁止通用 DAG/Workflow 框架；禁止本票实现固件生成（S6）

---

## Delivery Record（2026-08-11，ZCode）

**实际实现**（S5B 范围；无 Stale 历史子系统、无 DAG 引擎、无固件生成）：
- `src/domain/services/dependency-evaluation.ts` — classifyChange（metadata/semantic-possibly-valid/hard-constraint-break）、evaluateStale（D5 判定表：分类+依赖+下游是否有内容 → L1/L2/L3，**禁按 artifact type 硬编码**）、DEPENDENCY_EDGES 六边代码常量、transitiveDownstreamOf（I-4 失效沿链传播）
- 迁移 006：stale_marks 表 + idx_stale_project + **部分唯一索引**（未解决时 (artifact_id, affected_version_id) 唯一）；saveStaleMarks 合并语义（多上游源 → 级别取最高）
- **T1/T2 同事务**：select_mcu / generate_pin_map / commit_manual_edit（D4 手动编辑仍触发传播）在版本提交事务内写 marks（computeDownstreamMarks 只读计算，随 uow.saveStaleMarks 落库）
- `src/application/capabilities/revalidate.ts` — revalidateArtifact（**无语义变化→Validated 保留版本身份；有语义变化→create_proposal 待决策，D1 不自动接受**）；revalidateScope（kind|all；依赖序逐项；单项失败 outcome=error 可重试）；assertNotBlocking（L3 门禁：flash/mark_validated；按 artifact 过滤）；重算决策同源：pinmap 用纯计算 computePinMapContent（无版本副作用）
- resolveProposal(accept) → 解除该 artifact 的 Stale marks（stale-semantics §5：Accept → 新决策 → 继续下游 Revalidate）
- validateWiring 接入 L3 门禁（门禁矩阵：L3 下标记 Validation 成功 ❌）
- HTTP：/commands revalidate_artifact（409 no_stale/blocking_stale）、GET /projects/:id/stale-marks（get_stale_scope，kind 解析）、validate_wiring 409 blocking_stale
- 事件：artifact.revalidating / artifact.revalidated / proposal.created
- UI（Progressive Swap）：mockSTALE_FROM / mockRevalidateAll 生产路径**删除**；真实 marks 驱动侧栏琥珀点 / StaleBanner / 门禁（Firmware 生成按钮 L3 拦截）；Revalidate 提案卡（接受/拒绝）；Lab"强制下游过期"改为真实 MCU 切换（真实依赖求值）

**Tests**：D5 判定表（含 firmware 变化 ≠ 恒 L3）+ 传递闭包 + D1 不自动接受 + L3 门禁 + stale_marks 持久化 + contract（5）+ e2e golden（2）= 28 新增；`npm test` 252/252 全绿；typecheck/lint 0；app build 0

**Browser evidence**（真实 Chrome，真实 HTTP）：需求→硬件→ESP32-S3→引脚生成（IO12 冲突卡）→ wiring/firmware 占位 v1（S2 手动路径，S6 前置）→ 换 RP2040 → **顶部 Stale 横幅"引脚图 → 接线 → 固件"+ 侧栏琥珀点** → Firmware"生成固件"按钮被拦截（L3 tooltip）→ 全部重新验证 → wiring 自动转绿；pinmap/firmware 语义变化**出提案卡（不自动接受）** → 接受 → 横幅消失、按钮恢复 → 再换 MCU → 门禁再次生效。DB 实测 stale_marks 3 行 L3（select_mcu 触发，同事务）。

**Deviations**：
1. Build/Validation 为边界（非 artifact kind——5 类 Artifact 冻结）→ 不产生 Build/Validation 行级 mark；Build 门禁由 run_build 命令层 assertNotBlocking 承接（S7 接入）；横幅链文本含 Build（视图静态尾段）
2. 接受任意提案即解除该 artifact marks（S5B 无版本提交机制——固件版本落库在 S6）；风险记录：L3 期间接受旧提案将解除标记（所有者显式决策，门禁矩阵允许编辑；S6 后 accept 走版本提交链）
3. wiring/firmware 无重算器（firmware 占位重算 S6 替换；wiring 依赖上游驱动）→ revalidate 时按"上游已解决即有效"处理（stale-semantics §5 链式规则）
4. revalidate_artifact 为同步 HTTP（knowledge 求值，确定性快）——contract 2.14 标 Command 异步；与 S4/S5A 已建立的同步命令模式一致
