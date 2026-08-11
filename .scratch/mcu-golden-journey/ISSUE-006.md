# ISSUE-006 — S5A Pin Map + Wiring Generation & Validation end-to-end

**Status:** resolved（2026-08-11，交付记录见下）
**Blocked by:** ISSUE-005（MCU Recommendation + Selection e2e）
**Priority:** P0-core

## 1. User-visible outcome

用户点击"配置引脚接线"后看到自动引脚分配（含 IO12 strapping 冲突卡与图上红标）；点击"校验电气规则"后得到真实校验结果（通过/问题清单）；引脚表行内编辑（手动，S2 已通）继续可用。本票不实现 Stale 传播（S5B）。

## 2. Frozen upstream references

- UI：WiringGuidanceView（引脚矩阵/布局图/冲突卡/校验按钮）、ui-state-model.md（W8/W9/W10、O5）
- Interaction Contract：D2 Generate Pin Map / D3 Validate Constraints / D4 Edit Pin
- Application Capability：generate_pin_map / validate_wiring / evaluate_constraints（application-contract 2.8/2.9/2.10）
- Domain Invariant：I-7（验证未运行≠通过，禁误报成功）；ValidationRecord 语义（6.6）
- Product Decision：D5（约束/警告级别）
- ADR：0013（TS 移植）
- Implementation Spec：§15 S5A、§14 V2 迁移表（constraints/engine.py、pins.py、layout.py）
- v2-contract-mapping：EXTRACT（constraint engine、pins、layout）

## 3. In scope

- 约束引擎移植（V2 constraints/engine.py → domain/services/constraint-engine.ts，**测试 1:1 搬运为验收门**）
- 引脚逻辑移植（shared/domain/pins.py → domain/knowledge/pins.ts）+ 布局（layout.py → services/wiring-layout.ts，M1 最小：矩阵即布局）
- generate_pin_map：POST /projects/:id/commands {capability:"generate_pin_map"} → 引脚表 + issues[]（severity warning/error；IO12 strapping 场景验证）；Pin Map artifact v1（有冲突=warning）
- validate_wiring：POST /versions/:vid/validations → ValidationRecord（kind='electrical_rules'，pass/warn/fail；**未运行≠通过**）；Wiring artifact 状态联动
- 外设映射校验（电压/总线兼容——复用 S4 移植的 compatibility）
- UI：分配/校验切真实 API；冲突卡数据来自真实 issues[]

## 4. Out of scope

- 依赖求值/StaleMark/Revalidate（S5B）——本票变更后不发 stale
- 固件生成（S6）；SVG 布局图渲染（延后；M1 矩阵）
- 真实 LLM 参与引脚分配（纯知识/约束求值）

## 5. Mock being replaced

```
mockAutoAssignPins（UI 内静态分配 + IO12 冲突）
→ real generate_pin_map（constraint-engine 移植 + pins 知识）
mock verifyRules（alert 提示）
→ real validate_wiring（ValidationRecord 落库）
```

## 6. End-to-end flow

```
Hardware v1（S4）→ POST /commands {generate_pin_map}
→ constraint-engine + pins 求值（MCU 引脚集 + 外设需求）→ 引脚表 + issues[]（IO12 strapping warning）
→ Pin Map v1（warning）→ UI 冲突卡 + 图上 IO12 红标
→ 行内编辑 IO12→IO21（S2 手动路径）→ Pin Map v2（冲突消除）
→ POST /versions/:vid/validations → ValidationRecord（pass/warn/fail）
→ UI "电气规则已校验"徽标（仅真实通过后）
```

## 7. Minimum domain changes

- ValidationRecord 类型（复用 domain-contract 6.6；记录而非 artifact）
- 无其他新对象

## 8. Minimum persistence changes

- 表：validation_records（artifact_version_id/kind/rules/result/started_at/completed_at）
- 索引：idx_validations_version

## 9. Ports / Adapters

- PersistencePort 扩展：UoW 增 createValidationRecord；只读 latestValidation
- 无新 Port（约束引擎是领域服务，非 Port）

## 10. Error states

- 409（上游未就绪/无 MCU）；400；validation 引擎错误 → 失败记录（**不得误报 pass**）

## 11. Tests first

- **搬运**：constraint-engine 测试（V2 test_engine 150 行用例）、pins 测试——TS 移植后 1:1 绿
- Domain：ValidationRecord（未运行≠通过；新版本需新验证）
- Application：generate_pin_map（issues 正确）、validate_wiring（结果/失败）
- Persistence：validation_records 约束
- Contract：/commands generate_pin_map、/versions/:vid/validations
- Browser/E2E：见 §12

## 12. Browser acceptance

```
进入 Wiring 视图 → 配置引脚接线 → 引脚表出现（IO4/IO12/IO8/IO9）+ 冲突卡（IO12 strapping）
→ 点"校验电气规则" → 徽标变"电气规则已校验"（问题保留展示）
→ 行内编辑继电器引脚 → IO21 → 冲突卡消除 → 再次校验 → 通过
→ 刷新 → 校验结果仍在（ValidationRecord 历史）
```

## 13. Definition of Done

- typecheck/lint/test 绿（**搬运测试绿是移植验收门**）；e2e:golden 相关用例绿
- 浏览器验收全过；Mock 分配/校验生产路径删除
- 无误报成功路径（测试证明）；无 fallback

## 14. Forbidden shortcuts

- 禁止 bulk-copy 约束引擎（逐文件 + 搬运测试）
- 禁止校验失败仍标记通过（I-7）
- 禁止本票实现 StaleMark/Revalidate（S5B）
- 禁止把分配结果硬编码在 UI

---

## Delivery Record（2026-08-11，ZCode）

**实际实现**（均为 S5A 范围；V2 逐文件提取 + 测试搬运）：
- `src/domain/services/constraint-engine.ts` — V2 worker/.../constraints/engine.py TS 移植（电压/引脚预算/总线冲突/确定性分配；**扩展 STRAPPING_PIN_USAGE 检查**——Golden Journey IO12 场景；VOLTAGE_TOO_LOW 对显式 supported 平台降 warning）
- `src/domain/knowledge/pins.ts` — V2 shared/domain/pins.py TS 移植（PLATFORM_PINS/COMPONENT_LIBRARIES/assignPins/resolveDependencies）
- components 目录扩展 6 个 V2 测试组件（dht22/lcd1602/bmp280/photoresistor/sg90/hc_05）——constraint-engine 搬运测试 1:1 所需
- ESP32-S3 平台引脚池对齐冻结 UI 参考分配（土壤→IO4、继电器→IO12、OLED→IO8/IO9；strapping 引脚可分配但带风险）
- ValidationRecord（I-7 未运行≠通过）+ 迁移 005（validation_records）+ UoW createValidationRecord/latestValidation
- `src/application/capabilities/wiring.ts` — generatePinMap（constraint-engine 求值 → Pin Map artifact + issues[]）/ validateWiring（electrical_rules pass/warn/fail）/ latestValidation
- HTTP：/commands generate_pin_map、POST/GET /versions/:vid/validations（409 no_hardware_selected）
- UI（Progressive Swap）：generatePins/verifyRules 走真实 API；冲突卡数据来自真实 issues[]；行内编辑（S2 手动路径）联动
- Mock 生产路径删除：autoAssignPins / verifyRules 内存提示移除（app/src/mock/engine.ts 仍保留其它 Journey 脚本，S10 全清）

**Tests**：knowledge(pins 19) + services(constraint-engine 13，含 V2 搬运 1:1 12 条) + application 6 + e2e 2 = 40（S5A 新增）；`npm test` 224/224 全绿；typecheck/lint 0

**Browser evidence**（真实 Chrome）：配置引脚接线 → 引脚表（IO4/IO12/IO8/IO9）+ 冲突卡（IO12 Strapping pin conflict）→ 校验 → "电气规则已校验"徽标（warn，问题保留）→ 行内编辑 IO12→IO21 → 冲突卡消除 → 再校验 → "all electrical rules passed"。DB 实测 validation_records 2 行（v1 warn / v2 pass）、pinmap v1(ai)/v2(manual)。截图 `.scratch/mcu-golden-journey/evidence/s5a-wiring.png`

**Deviations**：
1. V2 引擎 strapping 检查为新增（V2 无 strapping 概念——Arduino UNO 目录时代）；VOLTAGE_TOO_LOW 对 platform_compatibility=supported 降 warning（晶体管驱动外部供电场景，V2 测试不冲突）
2. ESP32-S3 引脚池顺序编码冻结 UI 参考分配（knowledge 数据层，非 UI 硬编码）；IO12 不入 reserved（reserved=系统独占；strapping=可用但风险，由引擎标记）
3. I2C/SPI 共享总线参与者展开为引脚行（冻结 UI 显示 OLED SDA/SCL 两行）；V2 引擎只出 sharedBuses
4. validate_wiring 的 strapping 规则表（ESP32-S3 系）为领域常量——M1 平台集固定；S10 若平台增补再升 knowledge
