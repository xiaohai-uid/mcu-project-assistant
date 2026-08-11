# Ticket Review — 施工工单审查

> 日期：2026-08-11
> 状态：**PASS（12/12 逐张 + 整体 A–D）** → IMPLEMENTATION READY CANDIDATE
> 审查对象：.scratch/mcu-golden-journey/ISSUE-001..012（+ PRD.md）

---

## 1. 逐张 10 项检查（PASS = ✅）

| Ticket | 用户可见 | Vertical | 大小适中 | 引用 Frozen Spec | 仅本 Slice schema | Progressive Swap | 有测试 | Browser Acceptance | 无 speculative abstraction | 无未来能力混入 |
|---|---|---|---|---|---|---|---|---|---|---|
| 001 S1 | ✅ 建项目/归档/刷新保留 | ✅ UI→App→DB | ✅ 极小（仅 projects 表+3 路由） | ✅ 8 处引用 | ✅ 仅 projects | ✅ mockCreateProject | ✅ 五层 | ✅ 步骤化 | ✅ | ✅ |
| 002 S2 | ✅ 手动编辑→版本历史 | ✅ | ✅ | ✅ | ✅ 仅 artifacts/versions | ✅ mockEditPin | ✅ | ✅ | ✅ | ✅ Stale 明确外置 S5B |
| 003 S3A | ✅ 流式/澄清/能力卡 | ✅ | ✅（拆分自 S3） | ✅ | ✅ 仅 tasks | ✅ mockRunDiscovery | ✅ | ✅ | ✅ 无 Event Store | ✅ 提案外置 S3B |
| 004 S3B | ✅ 提案三态/OutdatedProposal | ✅ | ✅ | ✅ | ✅ 仅 proposals | ✅ mockDecision | ✅（Outdated 三层） | ✅ | ✅ | ✅ |
| 005 S4 | ✅ 候选/约束/选芯 | ✅ | ✅ | ✅ | ✅ 无新表 | ✅ mockCandidates | ✅（搬运门） | ✅ | ✅ | ✅ Stale 外置 S5B |
| 006 S5A | ✅ 引脚/冲突/校验 | ✅ | ✅（拆分自 S5） | ✅ | ✅ 仅 validation_records | ✅ mockAutoAssign | ✅（搬运门） | ✅ | ✅ | ✅ |
| 007 S5B | ✅ Stale 三级/Revalidate | ✅ | ✅ | ✅ | ✅ 仅 stale_marks | ✅ mockSTALE | ✅（D5/D1 测试） | ✅ | ✅ 无 DAG/历史 | ✅ |
| 008 S6 | ✅ 固件 Diff/真实文件 | ✅ | ✅ | ✅ | ✅ 无新表（workspace 文件） | ✅ mockFirmware | ✅（Outdated 固件） | ✅ 含打开文件 | ✅ | ✅ 编译外置 S7 |
| 009 S7 | ✅ 编译/历史/工具链 | ✅ | ✅ | ✅ | ✅ 仅 build_records | ✅ mockBuild | ✅（D2/无 shell） | ✅ | ✅ | ✅ 诊断外置 S8 |
| 010 S8 | ✅ 诊断/修复/重建 | ✅ | ✅ | ✅ | ✅ 无新表 | ✅ mockDiagnosis | ✅（三模型分离） | ✅ | ✅ | ✅ |
| 011 S9 | ✅ 烧录确认/串口 | ✅ | ✅ | ✅ | ✅ 仅 preferences | ✅ mockDevice | ✅（安全验收组） | ✅ | ✅ 会话不建表 | ✅ 排除 8 类 |
| 012 S10 | ✅ 全链/唯一主路径 | ✅（非功能票=硬化） | ✅ | ✅ | ✅ 无新表 | ✅ 全量删除 Mock | ✅（27 项回归） | ✅ | ✅ | ✅ 禁止首次实现功能 |

## 2. 整体检查

### A. 是否存在横向 Ticket
**无。** 全部 12 张均为垂直/用户可观察切片；无 database-only / backend-only / frontend-only / testing-only 票（S10 为硬化+清理票，非技术层票；S1 内嵌最小脚本建立属必要基础设施小任务，随票声明）。

### B. 是否存在大爆炸 Ticket
**无。** 无 "build new architecture foundation" 类票；S1 明确禁止一次建全表/全路由/全 Ports。

### C. 是否存在过度小票
**无。** 无 "Add Project type / enum / table / route" 四连拆；类型/表/路由均内嵌于对应切片票（如 S1 含 Project 类型+projects 表+/projects 路由）。

### D. 每个 Slice 是否让产品继续可运行
**是（12/12）。** 每张票 §13 DoD 均含可运行/可演示门（浏览器验收 + e2e 相关用例绿）；S1–S11 每步完成即可运行，S12 收敛唯一主路径。

## 3. 拆分说明（非机械一 Slice = 一 Ticket）

- **S3 → ISSUE-003（S3A Analysis+Clarification）/ ISSUE-004（S3B Proposal Accept/Reject）**：各自用户可见完整（能力卡 / 提案决策），避免一次票过大；不拆成 AI Port / Proposal 表横向票
- **S5 → ISSUE-006（S5A Pin+Wiring+Validation）/ ISSUE-007（S5B Stale+Revalidate）**：同上；Stale 需要依赖求值独立验收（D5/D1 测试组）
- 其余 Slice 单票（S1/S2/S4/S6/S7/S8/S9/S10 均在一个上下文窗口可理解实现）

## 4. 结论

**Ticket Review PASS（12/12 + A–D）**。工单集满足：垂直、用户可见、大小适中、全引用 Frozen Spec、schema 随票增长、Progressive Swap 明确、测试与浏览器验收齐备、无投机抽象、无未来能力混入、无横向/大爆炸/过小票、每票可运行。

**交付：IMPLEMENTATION READY CANDIDATE** —— 等待产品负责人批准后，从 ISSUE-001（S1 Create Project end-to-end）开始施工。
