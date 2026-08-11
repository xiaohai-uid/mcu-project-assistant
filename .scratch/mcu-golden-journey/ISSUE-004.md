# ISSUE-004 — S3B Proposal Accept/Reject end-to-end

**Status:** resolved（2026-08-11，交付记录见下）
**Blocked by:** ISSUE-003（Requirement Analysis + Clarification e2e）
**Priority:** P0-blocking

## 1. User-visible outcome

分析完成后，用户在审阅区看到形式化提案（初始想法 vs 正式规格 + 影响范围），逐条 Accept/Reject（三态徽标）；"进入硬件选型"后 Accepted 提案写入 Requirements artifact v1；**Reject 零变化**；若提案基于旧版本（期间内容被改）→ 明确提示 OutdatedProposal，不静默应用。

## 2. Frozen upstream references

- UI：提案卡三态（pending/accepted/rejected）、AI 不静默覆盖提示、ui-state-model.md（W4/W5/W6/O1）
- Interaction Contract：C1 Accept / C2 Reject / B4（进入硬件前置）
- Application Capability：create_proposal（内部）/ resolve_proposal（application-contract 2.4/2.5）
- Domain Invariant：I-1（Proposal Gate，AI 不静默覆盖）、I-3（Reject 零效果、Accept 恰一新版本）、I-2（版本不可变）
- Product Decision：D4（门禁只约束 AI）、D1（语义变化判定基础）
- ADR：0003/0013
- Implementation Spec：§7 版本提交（AI 路径 T2 事务）、§12 Proposal Engine（OutdatedProposal 强制）、§15 S3B
- Logical Events：proposal.created/accepted/rejected、artifact.version.created

## 3. In scope

- Proposal 领域类型（type/payload/diff/impacts/reason/status/baseVersionId）+ 决策状态机（pending→accepted|rejected，可逆）
- create_proposal（内部能力：analyze 完成后为每个形式化项产出提案，引用 base 版本）
- resolve_proposal：POST /proposals/:id/decision {decision:"accept"|"reject"}
- **OutdatedProposal 校验**：accept 时 baseVersionId === artifact.currentVersionId；不符 → 409 + UI 提示重新生成（强制，含测试）
- Accept 事务 T2：写内容（ArtifactContentPort）→ 插版本（source_kind='proposal'）→ 更新 current → proposals.status='accepted'（同事务）
- Reject 事务 T3：仅提案状态更新 → 零版本变化
- Requirements artifact v1（capabilities + acceptedProposalIds 摘要）随"进入硬件选型"提交
- UI：提案卡切换真实 API；三态徽标；OutdatedProposal 提示条
- 幂等：同决策重复提交 no-op

## 4. Out of scope

- MCU 推荐/选择（S4）；依赖求值/Stale（S5B）
- Firmware 类提案（S6/S8 复用本票 Proposal 机制）
- 手动编辑路径（S2 已完成，门禁仅 AI）

## 5. Mock being replaced

```
mockSetProposalDecision（AppContext DISC_DECISION 内存态）
→ real resolve_proposal（POST /proposals/:id/decision → SQLite proposals 表 + 版本事务）
mock proceedToHardware（accepted 数 >0 即前进）
→ real requirements 版本提交（accepted 提案写入 artifact v1）
```

## 6. End-to-end flow

```
分析完成（S3A）→ create_proposal × N（base = 当前 requirements 版本，无写入）
→ UI 提案卡（三态）→ POST /proposals/:id/decision {decision:"reject"} → 零版本变化（T3）
→ POST /proposals/:id/decision {decision:"accept"} → 事务 T2：
    写内容 → 插版本 v1（source_kind='proposal'）→ current 更新 → proposal accepted
→ "进入硬件选型" → Requirements artifact v1 落库
→ 冲突路径：用户手动改内容后旧提案 accept → 409 OutdatedProposal → UI "提案基于旧版本，请重新生成"
```

## 7. Minimum domain changes

- Proposal 类型 + 决策状态机 + OutdatedProposal 校验服务（proposal-service）
- 版本提交 AI 路径（version-commit-service T2）

## 8. Minimum persistence changes

- 表：proposals（project_id/artifact_id/base_version_id/type/payload/diff/impacts/reason/status/created_by/created_at/decided_at）
- 索引：idx_proposals_project、idx_proposals_base

## 9. Ports / Adapters

- PersistencePort 扩展：UoW 增 createProposal/resolveProposal；只读 listProposals/getProposal
- ArtifactContentPort（复用 S2）；EventPort（复用 S3A）

## 10. Error states

- 409 OutdatedProposal（details: proposalId/baseVersionId/currentVersionId）→ UI 过期提示
- 404 not_found；400 invalid_decision；幂等重复决策 no-op

## 11. Tests first

- Domain：Proposal 不变量（拒绝零效果；accept 幂等恰一版本；决策可逆且历史保留）
- **OutdatedProposal**：base 变更后 accept 必须失败（domain + application + contract 三层）
- Application：resolve_proposal（授权=所有者；幂等键）
- Persistence：T2/T3 事务原子性（版本+指针+提案状态同事务）
- Contract：POST /proposals/:id/decision、409 信封
- Browser/E2E：见 §12

## 12. Browser acceptance

```
项目 → 描述 → 解析 → 澄清 → 提案卡出现（3 条）
→ 拒绝 #01（灰化"已拒绝"）→ 接受 #03（绿"已接受"）
→ "进入硬件选型" → 进入 Hardware 视图
→ 返回 Requirements → 提案历史可见决策记录
→ Lab/手动改内容后对旧提案 accept → 过期提示条（OutdatedProposal）
```

## 13. Definition of Done

- typecheck/lint/test 绿（OutdatedProposal 测试必须存在且通过）；e2e:golden 相关用例绿
- 浏览器验收全过；Mock 提案决策生产路径删除
- 无 fallback 双路径；Reject 确实零 artifact 变化（测试证明）

## 14. Forbidden shortcuts

- 禁止 AI 内容绕过 Proposal 直接写版本（门禁无例外——commit_manual_edit 仅人工通道且已在 S2）
- 禁止旧提案静默应用（OutdatedProposal 必须抛错）
- 禁止本票实现 MCU/Stale/Firmware 逻辑
- 禁止 CommandBus/Registry；禁止 mock fallback

---

## Delivery Record（2026-08-11，ZCode）

**实际实现**（均为 S3B 范围）：
- `src/domain/models/proposal.ts` — Proposal 领域（pending→accepted|rejected 可逆、决策历史保留、OutdatedProposal 强制校验 assertProposalCurrent）
- 迁移 004：proposals 表（type/status CHECK、decision_history JSON、索引）+ tasks.output 列
- `src/application/capabilities/proposals.ts` — createProposal（内部）/ resolveProposal（OutdatedProposal 409 / 幂等 no-op）/ commitRequirements（proceed 聚合 T2）/ createProposalsFromAnalysis
- 分析能力集成：完成后经 create_proposals_from_analysis 落库提案（引用 requirements base 版本）
- Mock 适配器输出 proposals（DISCOVERY_PROPOSALS 迁移服务端）
- HTTP：GET /projects/:pid/proposals、POST /proposals/:id/decision、POST /projects/:pid/requirements/commit
- UI（Progressive Swap）：提案卡三态走真实 resolve_proposal；"进入硬件选型"走真实 commitRequirements（v1 落库）；OutdatedProposal 提示条
- Mock 生产路径删除：setProposalDecision 内存态 / proceedToHardware 内存版本 +1 移除

**Tests**：domain 6 / application 7 / persistence 4 / contract 7 / e2e 2 = 26（S3B 新增）；`npm test` 126/126 全绿；typecheck/lint 0

**Browser evidence**（真实 Chrome）：解析→澄清→提案卡 3 条（pending）→ 拒绝 #01（灰化"已拒绝"）→ 接受 #03（绿"已接受"）→ 进入硬件选型 → Hardware 视图 + "Requirements artifact v1 committed"。DB 实测：proposals 3 行（rejected/pending/accepted）、requirements v1（source_kind=proposal、内容=capabilities+acceptedProposalIds+acceptedTitles）。截图 `.scratch/mcu-golden-journey/evidence/s3b-proposals.png`

**Deviations**：
1. **I-3 聚合语义**：accept 只更新提案状态（含 OutdatedProposal 校验），版本恰一在 proceed（requirements 聚合 v1）——冻结 UI 事实源（mock proceedToHardware 一次性提交 v1）与多 accept + OutdatedProposal 冲突的唯二自洽解；单提案类（S6 firmware）accept 直生版本
2. `POST /projects/:pid/requirements/commit` 为 proceed 落库最小入口（spec §10.1 无 proceed 端点；ticket §3/§6 明示随进入硬件选型提交）
3. `tasks.output` 列增补（ISSUE-003 §3 已言明"tasks 表 output"；本票落地）
4. source_kind CHECK 扩展 'proposal'（迁移 002 原位修订——发布前无已部署库）
