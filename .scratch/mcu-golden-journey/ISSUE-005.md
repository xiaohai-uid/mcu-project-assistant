# ISSUE-005 — S4 MCU Recommendation + Selection end-to-end

**Status:** resolved（2026-08-11，交付记录见下）
**Blocked by:** ISSUE-004（Proposal Accept/Reject e2e）
**Priority:** P0-core

## 1. User-visible outcome

用户在 Hardware 视图看到 MCU 候选矩阵（推荐/备选/工业级 + 对照需求的约束警告），选择后 Hardware artifact v1 生成（已选目标徽标）；更换 MCU 时提示下游将失效（Stale 由 S5B 实现，本票只发提示与事件）。

## 2. Frozen upstream references

- UI：HardwareSelectionView（候选矩阵/约束警告/外设映射）、ui-state-model.md（W7 CandidateReview）
- Interaction Contract：D1 Select MCU（首次=Hardware v1；更换=新版本+下游提示）
- Application Capability：recommend_mcu / select_mcu / evaluate_constraints（application-contract 2.6/2.7/2.8）
- Domain Invariant：I-4 前置（更换触发下游提示事件，标记在 S5B）
- Product Decision：D5（约束级别判定输入之一）
- ADR：0010（AI Port）、0013（TS）
- Implementation Spec：§15 S4、§14 V2 迁移表（platforms/components/compatibility/classification）
- v2-contract-mapping：EXTRACT（platforms registry、components registry、compatibility、classification）

## 3. In scope

- MCU 候选数据移植（V2 platforms/registry.py + strapping 数据 → domain/knowledge/platforms.ts，测试搬运）
- 组件/外设目录移植（components/registry.py → domain/knowledge/components.ts）
- 兼容性/分类纯逻辑移植（shared/domain/compatibility.py、classification.py → domain/knowledge/*.ts）
- recommend_mcu capability：POST /projects/:id/commands {capability:"recommend_mcu"} → 候选 + 约束警告（对照已接受需求）
- select_mcu：POST /projects/:id/commands {capability:"select_mcu", payload:{mcuId}} → Hardware artifact v1（或新版本）；更换时发 artifact.version.created + 提示事件（stale 标记在 S5B）
- 外设映射（从 requirements 能力推导）
- UI：候选矩阵/外设清单切真实 API

## 4. Out of scope

- 依赖求值/Stale 标记（S5B）——本票更换 MCU 只发事件与 UI 提示
- 引脚分配（S5A）；固件（S6）
- 真实 LLM 适配器（mock 候选脚本沿用；knowledge 数据是真实移植）

## 5. Mock being replaced

```
mockMCU_CANDIDATES / mockPERIPHERALS（UI 静态数组）
→ real recommend_mcu（knowledge 移植数据 + compatibility 校验）
mock selectMcu（内存 + STALE_FROM 占位）
→ real select_mcu（Hardware 版本落库；更换事件）
```

## 6. End-to-end flow

```
Requirements v1（S3B 完成）→ POST /commands {recommend_mcu}
→ knowledge/platforms + components + compatibility 求值 → 候选[{规格, 约束警告[]}]
→ UI 候选矩阵（推荐/备选/工业级 + ⚠️ 无 Wi-Fi 等）
→ POST /commands {select_mcu, {mcuId:"ESP32-S3"}} → Hardware v1（accepted）
→ UI 已选目标；外设映射展示
→ 再选 RP2040 → Hardware v2 + artifact.version.created（下游提示文案；S5B 才打 StaleMark）
```

## 7. Minimum domain changes

- 无新领域对象（Hardware 内容 = 版本 payload 形状：selectedMcuId + peripherals）
- knowledge 模块（platforms/components/compatibility/classification）为领域纯函数

## 8. Minimum persistence changes

- 无新表（hardware 版本复用 artifact_versions）
- Workspace：hardware/NNN.json 内容

## 9. Ports / Adapters

- PersistencePort（复用；无扩展）
- AIProviderPort（mock 候选生成可复用 recommend 脚本；若纯知识求值则不经 AI）
- 无新 Port

## 10. Error states

- 400 invalid_mcu；404；503（provider 若参与）；更换下游提示（事件，非错误）

## 11. Tests first

- Domain/knowledge：platforms（strapping 数据完整性）、components、compatibility（电压冲突）、classification——**搬运 V2 测试 1:1**
- Application：recommend_mcu（约束警告正确）、select_mcu（首选 v1/更换 v2 幂等）
- Contract：/commands recommend/select、错误信封
- Browser/E2E：见 §12

## 12. Browser acceptance

```
进入 Hardware 视图 → 候选矩阵（3 卡 + 约束警告）
→ 选择 ESP32-S3 → "已选目标" + Hardware v1
→ 切到 RP2040 → 警告"更换 MCU 使下游失效"（提示）
→ 刷新 → Hardware 仍为 RP2040 v2
```

## 13. Definition of Done

- typecheck/lint/test 绿（**搬运测试绿是移植验收门**）；e2e:golden 相关用例绿
- 浏览器验收全过；Mock 候选数据生产路径删除（knowledge 为真实数据）
- 无 bulk copy（逐文件迁移 + 测试搬运）；无 fallback

## 14. Forbidden shortcuts

- 禁止 bulk-copy V2（逐文件：Source→Destination→测试搬运）
- 禁止本票实现 Stale 标记/依赖求值（S5B）
- 禁止真实 LLM 网络调用（mock 适配器）
- 禁止把 strapping/约束数据硬编码进 UI

---

## Delivery Record（2026-08-11，ZCode）

**实际实现**（均为 S4 范围；V2 逐文件提取 + 测试搬运）：
- `src/domain/knowledge/classification.ts` — V2 shared/domain/classification.py TS 移植（CATEGORY_MAP 全量 + mapFunctionalityToCategory）
- `src/domain/knowledge/compatibility.ts` — V2 shared/domain/compatibility.py TS 移植（checkCompatibility/allocateTiers/detectConflicts）
- `src/domain/knowledge/platforms.ts` — V2 worker platforms/registry.py + catalog/platforms/arduino_uno.yaml 1:1 移植 + Golden Journey 目标平台（ESP32-S3 strapping 数据 / RP2040 / STM32F401RE，冻结 UI MCU_CANDIDATES 事实源；candidateTier 推荐/备选/工业级）
- `src/domain/knowledge/components.ts` — V2 worker components/registry.py + catalog/components/*.yaml 移植（Golden Journey 子集：soil_moisture/relay/oled_096；Registry 机制与 V2 等价）
- `src/application/capabilities/mcu.ts` — recommendMcu（纯 knowledge 求值：候选 + 对照需求约束警告 + 外设映射；不经 AI）/ selectMcu（Hardware v1/v2；同 MCU 幂等；更换发 artifact.version.created + 提示）
- 分析任务 output 落库（tasks.output；S3B §3 言明）：TaskContext.setOutput seam + runner 终态保留 output
- HTTP：/commands recommend_mcu / select_mcu（错误信封 invalid_mcu）
- UI（Progressive Swap）：Hardware 视图候选矩阵/外设清单走真实 recommend_mcu；selectMcu 走真实版本落库；更换下游失效提示（Stale 标记留 S5B）
- Mock 生产路径删除：MCU_CANDIDATES/PERIPHERALS 静态数组不再作为候选数据源（knowledge 为真实数据）

**Tests**：knowledge 4 文件（classification 6 / compatibility 15 / platforms 12 / components 11）+ application 9 + contract 4 + e2e 1 = 58（S4 新增，含 V2 搬运测试 1:1）；`npm test` 187/187 全绿；typecheck/lint 0

**Browser evidence**（真实 Chrome）：Hardware 视图候选矩阵 3 卡（推荐/备选/工业级 + RP2040/STM32 ⚠️ 无 Wi-Fi 约束警告）→ 选择 ESP32-S3（"已选目标" + Hardware v1）→ 切 RP2040（"MCU changed…downstream stale" 警告 + v2 落库）。DB 实测 hardware v1/v2；workspace hardware/0002.json = {selectedMcuId:"RP2040", peripherals:[soil,relay,oled]}。截图 `.scratch/mcu-golden-journey/evidence/s4-mcu.png`

**Deviations**：
1. recommend_mcu/select_mcu 同步返回（200），不经 /commands 的 202 taskId 包装——纯 knowledge 求值无长任务（spec §10.1 202 适用于异步 AI capability；记录在案）
2. V2 catalog 仅 arduino_uno；Golden Journey 目标平台（ESP32-S3/RP2040/STM32F401RE）按冻结 UI 候选 + ESP32-S3 strapping 工程事实补齐（strapping 数据 = S5A 约束引擎输入）
3. 组件目录为 Golden Journey 子集（3 组件）；其余 V2 catalog 组件未搬（无消费者；S10 按需）
4. select_mcu 同 MCU 幂等（spec §10.2 自然幂等）；更换只发提示，Stale 标记 S5B
