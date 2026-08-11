# ISSUE-008 — S6 Firmware Proposal + Diff end-to-end

**Status:** resolved
**Blocked by:** ISSUE-007（Stale Propagation + Revalidate e2e）
**Priority:** P0-core

## 1. User-visible outcome

用户点击"生成固件代码"：生成中提示 → 代码区 + 提案 Diff（-IO12 → +IO21 + boot 风险 + 影响范围）；接受 → Firmware 新版本（**真实 Git-friendly 文件** src/main.cpp + platformio.ini 落在 workspace，可打开）；拒绝 → 保留旧版本 + 风险提示；若引脚在此期间被改 → 旧提案 OutdatedProposal 拒绝应用。

## 2. Frozen upstream references

- UI：FirmwareView（代码/Diff/接受/拒绝/版本徽标）、ui-state-model.md（W11/W4'/W5/W6）
- Interaction Contract：E1 Generate Firmware / E2 Accept Firmware Diff / E3 Reject Firmware Diff
- Application Capability：generate_firmware_proposal / resolve_proposal（复用）
- Domain Invariant：I-1/I-2/I-3（Proposal Gate + 不可变 + 版本语义）、D2（版本=内容身份；Build 不产生版本）
- Product Decision：D2、D4（门禁）、D1（语义变化）
- ADR：0006（ArtifactContentPort：workspace 文件）、0013
- Implementation Spec：§5 工作区（firmware/NNN/src/main.cpp 真实文件）、§7 版本提交、§12 Proposal Engine、§15 S6
- v2-contract-mapping：firmware/generator.py → REWRITE（TS）

## 3. In scope

- 固件生成器（V2 firmware/generator.py 模式 → domain/services/firmware-generator.ts：模板 + 引脚常量注入；**输出 = Proposal + diff + impacts，不直接写版本**）
- 固件提案类型（type='firmware_generation'，payload = files 内容，diff = 引脚行对比；type='pin_remap' 场景由 IO12→IO21 演示）
- ArtifactContentPort 写**真实文件**（firmware/NNN/src/main.cpp + platformio.ini；版本目录原子写；用户可打开、可 git）
- Accept（T2 复用）：新 Firmware 版本 + **Pin Map/Wiring 联动**（继电器引脚 → IO21 新版本）——通过 S7 依赖求值链路联动（marks 由 S5B 已建）
- Reject（T3 复用）：零变化 + 风险提示（strapping 风险仍在）
- **OutdatedProposal 强制**：固件提案 base 校验（S3B 机制复用，本票固件场景测试）
- UI：代码区/Diff 卡/接受拒绝/版本徽标切真实 API

## 4. Out of scope

- 编译（S7）；诊断（S8）；SVG；手动编辑固件 UI（延后）
- 真实 LLM 生成业务逻辑（mock 脚本 + 模板；Provider 接入后续）

## 5. Mock being replaced

```
mockBuildFirmwareCode / mockMakeFirmwareProposal（UI 模板 + 内存）
→ real generate_firmware_proposal（firmware-generator.ts + workspace 真实文件 + diff）
mock accept/reject（AppContext 内存）
→ real resolve_proposal（S3B 机制，固件类型）
```

## 6. End-to-end flow

```
Wiring 已校验（S5A）→ POST /commands {generate_firmware}
→ firmware-generator（模板 + 引脚注入 IO12）→ create_proposal（base=当前 wiring 版本；不写版本）
→ UI Diff 卡（-IO12 → +IO21 + boot 风险 + impacts）
→ POST /proposals/:id/decision {accept} → T2：
    写真实文件（firmware/NNN/src/main.cpp）→ Firmware v1（source='proposal'）
    → Pin Map/Wiring 联动新版本（继电器 IO21）
→ UI 版本徽标 v1；workspace 文件可打开
→ reject 路径 → 零版本变化 + 风险提示
→ 冲突：引脚被改后旧提案 accept → 409 OutdatedProposal
```

## 7. Minimum domain changes

- Firmware 内容形状（files 映射）；无新对象（Proposal 机制复用）
- firmware-generator 服务（REWRITE：输出提案而非版本）

## 8. Minimum persistence changes

- 无新表；Workspace：firmware/NNN/src/main.cpp + platformio.ini（**真实文件，禁 SQLite JSON**）

## 9. Ports / Adapters

- ArtifactContentPort（复用；firmware 版本目录）
- PersistencePort（复用；无扩展）
- AIProviderPort（mock 生成脚本，可复用）

## 10. Error states

- 409 OutdatedProposal（固件场景）；503 ProviderUnavailable；409 stale_blocked（L3 未处理）

## 11. Tests first

- Domain：firmware-generator（输出形状 = Proposal+diff；引脚注入正确）；版本联动（Accept → Pin Map 新版本）
- **OutdatedProposal（固件）**：base 变更后固件提案 accept 必须失败
- Application：generate_firmware_proposal（幂等/取消）
- Adapter：WorkspaceFiles 写 firmware 目录（原子、路径正确、文件真实存在）
- Contract：/commands generate_firmware、/proposals/:id/decision
- Browser/E2E：见 §12

## 12. Browser acceptance

```
Wiring 视图 → 生成固件 → 代码区 + 提案 Diff（-IO12 → +IO21 + boot 风险卡）
→ 接受更改 → 版本徽标 v1、继电器引脚联动 IO21
→ 打开 workspace firmware/0001/src/main.cpp → 文件真实存在且可读（Git-friendly）
→ 再次生成（改回 IO12 场景或 Lab）→ 拒绝 → 旧版本保留 + 风险提示
→ 手动改引脚后对旧提案 accept → OutdatedProposal 提示
```

## 13. Definition of Done

- typecheck/lint/test 绿（OutdatedProposal 固件场景 + 文件真实存在断言）；e2e:golden 相关用例绿
- 浏览器验收全过（含打开 workspace 文件）；Mock 固件/提案生产路径删除
- 固件源码不在 SQLite（测试断言）；无 fallback

## 14. Forbidden shortcuts

- 禁止固件源码藏进 SQLite JSON（必须真实 workspace 文件）
- 禁止生成器直接写版本（必须 Proposal——门禁无例外）
- 禁止本票实现编译/诊断（S7/S8）
- 禁止 bulk-copy V2 generator（REWRITE 输出形状）

---

## Delivery Record（2026-08-11，ZCode）

**实际实现**（S6 范围；无编译/诊断——S7/S8；无手动编辑固件 UI）：
- `src/domain/services/firmware-generator.ts` — V2 firmware/generator.py REWRITE→TS：确定性模板 + 引脚注入（形状对齐冻结 UI 参考代码）；STRAPPING_PINS 知识常量（IO0/IO12/IO45/IO46）；继电器在 strapping 引脚 → bootRisk + 重映射建议 IO21；输出 = files 载荷（src/main.cpp + platformio.ini），**不写版本（I-1 门禁无例外）**
- ArtifactContentPort 扩展 subpath：固件版本 = 真实 workspace 文件（firmware/NNNN/src/main.cpp + platformio.ini，Git-friendly，原子写）；**固件源码不在 SQLite（DoD 断言：contentRef 指向 main.cpp 文件）**
- `src/application/capabilities/firmware.ts` — generateFirmwareProposal（只产出 Proposal；diff=引脚行对比；impacts firmware/pinmap/wiring；base=pinmap 版本）；applyFirmwareAccept（T2 一次决策事务：写真实文件 + Firmware 版本 + Pin Map v2 继电器 IO21 + Wiring 联动 + marks 解除）；isFirmwareFilesPayload（区分 S5B revalidate 占位载荷）
- resolveProposal 固件分支：pinmap-base OutdatedProposal 校验（引脚变更 → 旧提案 409 拒绝应用）；Reject 零变化（I-3）
- HTTP：/commands generate_firmware（409 no_pin_map / blocking_stale）
- UI（Progressive Swap）：mock buildFirmwareCode/makeFirmwareProposal 生产路径删除；真实 generate_firmware → Diff 卡（-IO12 → +IO21 + boot 风险 + 影响范围 + V0→V1）+ 代码区；接受/拒绝走真实 resolve_proposal；无风险提案（重生成）隐藏 Diff/风险区（bootRisk 标志）

**Tests**：generator 5 + application 5（含真实文件存在断言 + OutdatedProposal 固件场景）+ contract 5 + e2e 1 = 16 新增；`npm test` 268/268 全绿；typecheck/lint 0；app build 0

**Browser evidence**（真实 Chrome，真实 HTTP）：生成固件 → 代码区（PUMP_RELAY_PIN 21）+ 提案 Diff 卡（启动风险提示 IO12、-IO12 → +IO21、影响范围 firmware/pinmap/wiring、V0→V1）→ 接受更改 → 固件 v1 徽标 + Relay pin IO21（联动）+ "固件已接受"横幅 → workspace 实测 firmware/0001/src/main.cpp + platformio.ini 真实存在可读 → 再次生成（无风险卡片）→ 拒绝 → "提案已拒绝——保留上一版本"+ strapping 风险提示。DB 实测 proposals 2 行（accept/reject）、firmware 版本 1（contentRef=firmware/0001/src/main.cpp）、pinmap v2（继电器 IO21）。

**Deviations**：
1. 固件提案类型沿用 DB CHECK 'firmware'（ticket 的 firmware_generation/pin_remap 语义由 payload/diff 表达——payload=files 映射，diff=引脚行对比；DB 约束未改）
2. 生成器始终产出 Proposal（含无 diff 场景——I-1 统一门禁；E1 的"Accepted 直达（无变化）"优化未实现，黄金旅程恒走提案路径）
3. 接受固件提案不触发 evaluateDownstream（一次接受事务 = 一个完整决策，联动版本同事务落库；marks 由 applyFirmwareAccept 显式解除）
4. Wiring 联动内容形状 `{ pinMappings: [...] }`（S7 编译将消费）；S5A 链路 wiring artifact 未落库时由接受事务创建
