# PRD — MCU Golden Journey Implementation（施工执行索引）

> 日期：2026-08-11
> 状态：**IMPLEMENTATION READY CANDIDATE**（Ticket Review PASS 后待批准）
> 上游事实来源（本区**不复制**，只引用）：`docs/rebuild/`（implementation-spec.md v2 / spec-hardening-review.md / contract 系列 / ui-* / product-decisions.md / stale-semantics.md / logical-events.md）+ `docs/adr/`（0003–0013）+ `C:\zcode\mcu`（冻结 Mock UI，Progressive Swap 源）
> Tracker 约定：`.scratch/<feature-slug>/PRD.md + ISSUE-NNN.md`（仓库 AGENTS.md / docs/agents/issue-tracker.md）

---

## 1. 施工主轴（S1–S10 → 12 张垂直工单）

| Ticket | Slice | 标题 | 优先级 | Blocked by |
|---|---|---|---|---|
| ISSUE-001 | S1 | Create Project end-to-end | P0-blocking | None |
| ISSUE-002 | S2 | Manual Artifact Version end-to-end | P0-blocking | 001 |
| ISSUE-003 | S3A | Requirement Analysis + Clarification end-to-end | P0-blocking | 002 |
| ISSUE-004 | S3B | Proposal Accept/Reject end-to-end | P0-blocking | 003 |
| ISSUE-005 | S4 | MCU Recommendation + Selection end-to-end | P0-core | 004 |
| ISSUE-006 | S5A | Pin Map + Wiring Generation & Validation end-to-end | P0-core | 005 |
| ISSUE-007 | S5B | Stale Propagation + Revalidate end-to-end | P0-core | 006 |
| ISSUE-008 | S6 | Firmware Proposal + Diff end-to-end | P0-core | 007 |
| ISSUE-009 | S7 | Build end-to-end | P0-core | 008 |
| ISSUE-010 | S8 | Failure Diagnosis + Fix end-to-end | P0-core | 009 |
| ISSUE-011 | S9 | Flash Confirmation + Serial end-to-end | P0-core | 010 |
| ISSUE-012 | S10 | Golden Journey Hardening + Legacy Cleanup | P0-hardening | 011 |

## 2. Dependency Graph

```
ISSUE-001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012
（线性主链）
```

## 3. Parallel-safe Tickets

**无。** 全部 sequential：共享热点文件（HTTP surface、PersistencePort/UnitOfWork、app 装配、shared-contracts）与共享 schema 迁移链（projects→artifacts→proposals→stale_marks→build_records→preferences），且为单执行者顺序施工。原则：**顺序正确 > 并行数量**；不强行拆出横向 Ticket。

## 4. Schema growth sequence（随 Slice 增长，禁止一次性建全）

| Ticket | 新增表 | 新增列/说明 | Workspace 新增 |
|---|---|---|---|
| 001 | projects | archive 字段 | project.json |
| 002 | artifacts, artifact_versions | kind CHECK(5)、version_no UNIQUE、content_ref/hash、status、source_kind、source_proposal_id（外键先建后引） | requirements/hardware/pinmap/wiring/firmware 内容目录（按需） |
| 003 | tasks | capability/status/input | —（分析为瞬态+任务表） |
| 004 | proposals | type/payload/diff/impacts/status/base_version_id | — |
| 005 | （无新表） | hardware 版本复用 artifact_versions | — |
| 006 | validation_records | kind/rules/result | — |
| 007 | stale_marks | level L1-L3/reason/source_version_id/resolved_at | — |
| 008 | （无新表） | firmware 版本 = 真实文件 | firmware/NNN/src/main.cpp + platformio.ini |
| 009 | build_records | 环境快照字段/status/stdout_ref | .build/<buildId>.log |
| 010 | （无新表） | build_fix 提案复用 proposals | — |
| 011 | preferences | last_device/toolchain_info | .evidence/<sessionId>.log |
| 012 | （无新表） | 无迁移；仅清理 | — |

## 5. Mock replacement sequence（Progressive Swap）

| Ticket | 被替换的 Mock 行为（C:\zcode\mcu） | 真实路径 |
|---|---|---|
| 001 | `createProject()`（AppContext CREATE_PROJECT） | real application/persistence（HTTP /projects） |
| 002 | `editPin()` 手动编辑提交 / 版本徽标 | commit_manual_edit → ArtifactVersion + Workspace |
| 003 | `runDiscoveryScript`（流式/澄清） | analyze_requirement + submit_clarification（AI mock provider 为真实适配器） |
| 004 | 提案卡三态决策（setProposalDecision） | resolve_proposal + OutdatedProposal |
| 005 | MCU_CANDIDATES/PERIPHERALS 静态数据 | recommend_mcu（knowledge/compatibility 移植） |
| 006 | `autoAssignPins` + 规则校验 | generate_pin_map（constraint-engine TS 移植）+ validate_wiring |
| 007 | STALE_FROM / revalidateAll（AppContext） | dependency-evaluation + stale_marks + revalidate_artifact |
| 008 | buildFirmwareCode / makeFirmwareProposal | generate_firmware_proposal（真实文件 + diff） |
| 009 | runBuildScript（日志脚本） | run_build（CompilerPort esp32-arduino）+ BuildRecord |
| 010 | BUILD_DIAGNOSIS 脚本 | diagnose_build（AI mock provider）+ fix proposal |
| 011 | Companion mock（detectBoard/flashDevice/serial） | DevicePort companion-local（+ mock 适配器保留测试） |
| 012 | 全部残留 mock path 删除；无 fallback 双路径 | 唯一主路径 |

## 6. V2 extraction sequence（文件级，禁止 bulk copy）

| Ticket | Source（V2/旧） | Destination | Action | 验收 |
|---|---|---|---|---|
| 003 | services/requirement-service（提示词/输出 schema） | application 内 analyze 提示契约 | EXTRACT 数据 | 能力测试 |
| 005 | worker/.../platforms/registry.py、components/registry.py、shared/domain/compatibility.py、classification.py | domain/knowledge/*.ts | EXTRACT（TS 移植） | 搬运测试绿 |
| 006 | worker/.../constraints/engine.py、shared/domain/pins.py、layout.py | domain/services/constraint-engine.ts、knowledge/pins.ts、services/wiring-layout.ts | EXTRACT（TS 移植） | 搬运测试绿（constraint 150 行等） |
| 008 | worker/.../firmware/generator.py | domain/services/firmware-generator.ts | REWRITE（Proposal 输出） | 新测试 |
| 009 | worker/.../models/compile_result.py、adapters/compiler/arduino_cli.py | domain/models/build-record.ts（形状）、adapters/compiler/esp32-arduino.ts | EXTRACT 形状 / REWRITE | 适配器测试 |
| 010 | gateway e2e acceptance fixtures | tests/fixtures/ | EXTRACT | e2e 引用 |
| 012 | gateway/ services/ worker/ shared/ trial_run.py 等 | （删除） | DELETE（提取完成后） | 无引用残留 |

## 7. 门禁命令（ISSUE-001 建立；此后每张 Ticket Gate 引用）

- `npm run typecheck`（tsc --noEmit）
- `npm run lint`（eslint）
- `npm test`（vitest run：unit + integration + contract）
- `npm run e2e:golden`（Golden Journey 浏览器 E2E）
- 浏览器手工验收：按各 Ticket §12 Browser acceptance 步骤

## 8. 纪律（全部 Ticket 强制）

- Vertical：一张 Ticket = 一个用户可观察能力，穿透 UI→Application→Domain→Persistence/Adapter→Tests→Browser
- 禁止横向票（database-only / backend-only / frontend-only / testing-only，纯必要基础设施小任务除外）
- 禁止大爆炸票（"build new architecture foundation"）与过度小票（"Add Project type/enum/table/route" 四连拆）
- 每 Slice 结束系统可运行；Progressive Swap 完成后删除该 Mock production path（允许留在测试 fixture）；禁止 try real / catch fallback mock
- Ticket 内禁止重新决策（SQLite/SSE/语言等已冻结）；遇到 Spec 未覆盖 → 标 `Status: needs-human`（tracker 标签）
- `/commands` 只是 HTTP 收口；Application 内部调用明确函数（analyzeRequirement()/recommendMcu()…），禁止 CommandBus/Registry/Handler 框架
- PersistencePort 禁止 God Interface：只有需要原子事务的操作进 UoW；普通查询走窄 read capability；若接口膨胀 >~20 方法即停止收口

## 9. 本区文件

- PRD.md（本文件）
- ISSUE-001.md … ISSUE-012.md（施工工单，14 节模板）
- REVIEW.md（Ticket Review：逐张 10 项 + 整体 A–D）
