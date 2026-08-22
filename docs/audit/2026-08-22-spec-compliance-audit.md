# 商用规格完成度与偏移审计

日期：2026-08-22
对象：mcu-project-assistant 对照 `.scratch/mcu-commercial-product/spec.md`（30 条用户故事 + 实现决策 + 测试决策）与 issues/01–07 七张纵向工单
方法：逐张工单的 Resolution 声明对照代码实体验证；规格决策逐条抽查；测试实际运行

---

## 一、总体结论

**七张纵向工单的实现声明全部属实**——身份卡、约束引擎身份诊断、钉死的工具链、四门就绪推导、实物验收状态机、立创价格观察与 BOM 导出、黄金旅程 e2e，全部在代码中找到对应实体，且 s10 商用黄金旅程 e2e 在本机实跑通过。

但存在 **1 处实质规格违反、2 处追踪缺口、4 处文档性漂移**。整体判定：**工程骨架完成度高，数据边界守住了诚实原则，首发候选矩阵的数据治理未达规格标准。**

## 二、工单验证矩阵

| 工单 | 标称 | 代码验证 | 判定 |
|---|---|---|---|
| 01 参考套件身份卡 | resolved | `ReferenceKitDefinition` 含 facts[]×source×confidence×objectLevel；HardwareSelectionView 渲染板卡/模组/版本/事实/官方链接 | ✅ 属实 |
| 02 精确器件与接线约束 | resolved | ComponentDefinition 带 exact/family/unresolved + pendingReason；ConstraintEngine 身份诊断；接线校验拒绝缺失/不匹配板卡快照 | ✅ 属实 |
| 03 可复现构建 local-ready | resolved | `ESP32_S3_ARDUINO_CORE_VERSION="3.3.11"`、FlashMode=qio/FlashSize=8M/PSRAM=opi 显式钉死；CLI 版本独立字段 | ✅ 属实 |
| 04 统一商用就绪报告 | resolved | 四门推导（现名 `deriveAcceptancePolicy`）+ `/readiness-report` + Delivery 视图 | ✅ 属实（符号已改名，见漂移 D3） |
| 05 实物上传与串口验收 | resolved | POST/GET `/physical-acceptance`；验收评估器拒绝 companion 夹具冒充实物；哈希/串口输出强校验 | ✅ 属实（真实硬件仍是外部前置条件，规格允许） |
| 06 立创价格观察与 BOM | resolved | `/bom` + items + price-observations + CSV/Markdown 导出；观察绑定精确 SKU/料号，数量档分离 | ✅ 属实 |
| 07 黄金旅程与交付报告 | resolved | `deriveDeliveryReport` + `/delivery-report`；`tests/e2e/s10-commercial-golden-journey.e2e.test.ts` 本机实跑 **PASS** | ✅ 属实 |

## 三、发现的偏移

### V1【实质违反】未核验平台仍参与首发候选矩阵 ★需产品决策★

规格实现决策（line 64）：*"其他平台不能以未经核验的静态事实参与首发推荐或商业就绪判断"*；
Out of Scope（line 96）：*"UNO、RP2040、STM32 若没有经过来源核对，不能继续以完整支持身份出现"*。

实测 `platforms.ts`：

| 平台记录 | candidateTier | facts 数组 | 来源 | 后果 |
|---|---|---|---|---|
| esp32-s3-devkitc-1-n8r8-v1.1 | （参考套件） | ✅ | ✅ | 合规 |
| ESP32-S3（芯片级） | recommended | ❌ | ❌ | 参与矩阵，静态事实 |
| RP2040 | **alternative** | ❌ | ❌ | **以未核验事实进入首发候选** |
| STM32F401RE | **industrial** | ❌ | ❌ | 同上 |
| arduino_uno | 无 | ❌ | ❌ | 已正确排除出矩阵 |

修复选项：A) 移除 RP2040/STM32 的 candidateTier（最严格合规格）；B) 保留但加 `provenance: "unverified"` 标记并全链路显示"未核验"、禁止其进入商业就绪判断；C) 补来源核对后保留。规格原文倾向 A 或 B。

### G1【追踪缺口】推荐缺少"缺失事实"字段

ISSUE-004 决策：*"Recommendation trace: each recommendation links to the exact facts and constraints that caused it, **plus the missing facts that could change the result**"*。
实测 `McuCandidate` 有 reason/constraints/referenceKit.facts（引用了什么），但**没有 missingFacts 枚举**。用户故事 25 只兑现了一半。

### G2【追踪缺口】知识目录仍为代码常量（规格自declared）

spec Problem Statement 自认 *"知识目录仍有静态参数混用和缺少来源的问题"*；platforms.ts 源码注释自认 *"M1 数据为代码常量；未来可配置化再升表/文件"*。非隐藏漂移，但应用架构评审 R1（KnowledgePort + 版本化数据文件）是正确解法，待执行。

### 文档性漂移（本次已修或注记）

- **D1** `map.md` 状态过期：写 02/03 "next"、04–07 "waits on…"，实际全部 resolved（git 提交链可证）。→ 本次已同步更新。
- **D2** `map.md` "Physical acceptance … still pending" —— 这条**仍然为真**（本机无开发板），保留。
- **D3** 工单 04 Resolution 引用旧符号名 `deriveCommercialReadiness`，2026-08-22 已改名 `deriveAcceptancePolicy`。→ 已在工单文件加历史注记。
- **D4** `auth/*` 路由（登录/会话）不在任何规格内。核实为托管内测部署的单用户 Basic 认证门 + 排水保护，不是多用户 SaaS，不违反 Out of Scope；建议后续补一行 ADR 说明其定位。

## 四、测试与证据状态

- 全量 578 passed / 5 failed / 7 skipped：5 个失败全部为环境诚实失败（本机无 arduino-cli → production-runtime BLOCKED_TOOLCHAIN 等），**恰好符合规格测试决策"缺工具只能是 blocked，不能成为 pass"**。vault 记忆证实同日早些时候装好夹具时曾全绿（594），非代码回归。
- s10 黄金旅程 e2e 实跑 PASS，其中 companion 夹具被故意拒绝为实物验收——付费门保持阻塞，诚实性设计有效。
- 新增的应用架构改造（R2a/R2b/R3/R4）与规格无冲突：三态徽章正是用户故事 17 的强化，权限三级表强化了用户故事 10 的提案边界。

## 五、结论一句话

**该做的都做了，且没撒谎；但首发候选矩阵里还坐着两位没有身份证的客人（RP2040/STM32），规格明文不允许他们上桌。**
