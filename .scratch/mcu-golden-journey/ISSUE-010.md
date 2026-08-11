# ISSUE-010 — S8 Failure Diagnosis + Fix end-to-end

**Status:** resolved
**Blocked by:** ISSUE-009（Build e2e）
**Priority:** P0-core

## 1. User-visible outcome

Build 失败后用户点"让 Copilot 诊断"：诊断卡（原因 + 建议 + 修复 Diff 提案，如 platformio.ini lib_deps）；"应用修复（提案）"→ 新 Firmware 版本 → 重建成功。**本票证明 Proposal / ArtifactVersion / BuildRecord 三模型分离**（失败不改版本；修复提案被接受才产生新版本；重建是新 BuildRecord）。

## 2. Frozen upstream references

- UI：BuildView 失败态/诊断卡/修复按钮、ui-state-model.md（W14 诊断闭环）
- Interaction Contract：F3 Diagnose Failure / F4 Accept Fix Proposal / F5 Rebuild
- Application Capability：diagnose_build（application-contract 2.13；Fix 以 Proposal 形态）
- Domain Invariant：I-1/I-3/I-6（诊断不改资产；修复经 Proposal；Build 不产生版本）
- Product Decision：D2（示例链：v3→Build#17 FAIL→fix accepted→v4→Build#18 OK）、D4
- ADR：0010（AI Port）、0013
- Implementation Spec：§13 Build Spec（诊断→修复→重建链）、§15 S8
- Logical Events：diagnosis.completed、proposal.created/accepted、build.*

## 3. In scope

- diagnose_build：POST /builds/:id/diagnose → 诊断（原因/建议/Fix Proposal，type='build_fix'，payload = file + diff；经 AIProviderPort mock 脚本）
- Fix 提案复用 Proposal 机制（S3B/S6）：Accept（T2）→ **新 Firmware 版本**（内容变化）；Reject → 零变化
- 重建：POST /projects/:id/builds（复用 S7）→ 新 BuildRecord（同新版本）
- UI：诊断卡/修复 Diff/应用/重建切真实 API；Copilot 消息（diagnosis.completed）

## 4. Out of scope

- 自动修复（无用户确认的 apply——禁止）；真实 LLM 诊断（mock 脚本）
- 多错误聚合/智能定位（单错误场景：缺库）

## 5. Mock being replaced

```
mockBUILD_DIAGNOSIS（UI 预置诊断）
→ real diagnose_build（AI mock provider → 诊断 + build_fix 提案）
mock applyFix（AppContext 标志）
→ real resolve_proposal（build_fix accept → 新固件版本）
```

## 6. End-to-end flow

```
Build FAILED（S7，BuildRecord status=failed + diagnostics）
→ POST /builds/:id/diagnose → 诊断（原因：缺 Adafruit_SSD1306 库；建议：加 lib_deps）
→ create_proposal（type='build_fix'，base=当前 firmware 版本，diff=platformio.ini）
→ UI 诊断卡 + 修复 Diff
→ POST /proposals/:id/decision {accept} → T2 → **Firmware v2**（内容变化）
→ POST /projects/:id/builds → BuildRecord #2 → BUILD SUCCESS
→ 拒绝路径 → 版本不变 → 可重试诊断/重建
```

## 7. Minimum domain changes

- build_fix 提案类型（payload 形状：file + diff）；无新对象

## 8. Minimum persistence changes

- 无新表（复用 proposals/build_records）

## 9. Ports / Adapters

- AIProviderPort（mock 诊断脚本）；复用 S7 全部

## 10. Error states

- 409（非失败记录不可诊断）；503 ProviderUnavailable（诊断失败保留手动修复路径）；OutdatedProposal（固件被改后修复提案过期）

## 11. Tests first

- Domain：**三模型分离断言**——Build 失败不改版本；诊断不改资产；fix accept 恰一新版本；重建是新 BuildRecord 而非新版本
- Application：diagnose_build（幂等/取消/降级）；resolve_proposal（build_fix）
- Contract：/builds/:id/diagnose、decision 信封
- Browser/E2E：见 §12

## 12. Browser acceptance

```
Lab 触发"下次编译失败" → 编译 → BUILD FAILED + 错误日志
→ 点"让 Copilot 诊断" → 诊断卡（原因/建议）
→ 修复 Diff（platformio.ini +lib_deps）→ "应用修复（提案）"
→ 固件版本 v+1 → 点"重新编译" → BUILD SUCCESS
→ 构建历史：失败记录 + 成功记录（版本仅 1 次增加）
→ Lab 再次失败 → 拒绝修复 → 版本不变 → 重试路径可用
```

## 13. Definition of Done

- typecheck/lint/test 绿（三模型分离断言必须存在）；e2e:golden 相关用例绿
- 浏览器验收全过；Mock 诊断生产路径删除
- 无自动修复捷径（必须有用户 Accept）；无 fallback

## 14. Forbidden shortcuts

- 禁止"失败后自动改固件"（必须 Proposal + 用户决策）
- 禁止把 Build 失败当版本变化（D2）
- 禁止真实 LLM 接入（mock）；禁止本票实现 Flash/串口（S9）

---

## Delivery Record（2026-08-11，ZCode）

**实际实现**（S8 范围；无自动修复——Proposal Gate 无例外；无真实 LLM——AI mock）：
- `src/application/capabilities/diagnosis.ts` — diagnoseBuild（POST /builds/:id/diagnose：Build FAILED → AI mock 诊断（原因/建议）+ **build_fix 提案**（pending，不写版本——I-1）；幂等（同 build 已有 pending 提案返回既有）；非失败记录 409 build_not_failed；provider 不可用 503 保留手动修复路径）；applyFirmwareFix（T2：platformio.ini 行级 diff 确定性应用（幂等）→ **恰一新 Firmware 版本**；Reject 零变化——I-3）；isBuildFixPayload（payload 形状判别）
- **三模型分离断言**（测试核心）：Build 失败不改版本（D2）；诊断不改资产（I-1）；无 Accept 不写版本；fix accept 恰一版本；重建 = 新 BuildRecord 而非新版本
- AI mock 增 build-diagnosis schema；事件 diagnosis.completed（logical-events）
- resolveProposal 增 build_fix 分支（base 校验对自身 artifact——固件被改后修复提案过期 → OutdatedProposal）
- UI（Progressive Swap）：mock BUILD_DIAGNOSIS/applyFix 生产路径删除；真实 diagnose_build → 诊断卡（原因/建议/修复 Diff + proposalId）；应用修复走真实 resolve_proposal；重建复用 S7

**Tests**：application 5（三模型分离 + applyLineDiff 幂等 + 非失败 409）+ contract 2 + e2e golden 2 = 9 新增；`npm test` 291/291 全绿；typecheck/lint 0；app build 0

**Acceptance marking**：DETERMINISTIC（e2e mock 编译适配器覆盖 失败→诊断→修复→重建 全链；本机无 arduino-cli——Build FAILED 无法 REAL 触发）

**Deviations**：
1. build_fix 提案类型沿用 DB CHECK 'firmware'（冻结 DDL 无 build_fix；payload 形状 {file, diff} 判别——与固件生成 files 映射、revalidate 占位载荷三分）
2. 诊断文案（cause/fix）为 AI mock 脚本固定输出（冻结 UI 参考 W14 诊断卡同源）；真实 LLM 接入为后续项
3. applyLineDiff 为行级追加语义（lib_deps 追加到 [env] 段尾；M1 单段 platformio.ini 场景；多段/复杂补丁延后）
