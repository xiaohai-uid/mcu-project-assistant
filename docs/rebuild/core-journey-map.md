# Core Journey Map & Golden Journey

> 日期：2026-08-11
> 依据：UI Reference Product Audit（docs/rebuild/ui-reference-product-audit.md）+ 旧工程 capability inventory（docs/rebuild/keep-adapt-delete-new-audit.md）+ 产品定义（AI MCU Project Workspace）
> 纪律：只定义用户与旅程，不定义 API / DB / Worker

---

## 1. Core Journey Map

### Journey A — 从想法到工程项目（P0）
```
Create Project（空白/模板）
  ↓
Describe idea（自然语言）
  ↓
AI Discovery：提取硬件能力（complete/partial/pending + warning）
  ↓
澄清缺口（pending 能力 → 补充问题 → 回答）
  ↓
形式化提案（initialIdea → formalizedRequirement → impacts）
  ↓
用户逐条 Accept / Reject（AI 不静默写入）
  ↓
Requirements artifact Accepted
  ↓
进入硬件选型
```

### Journey B — MCU / Hardware Selection（P0）
```
Requirements 已 Accepted
  ↓
MCU 候选矩阵（RECOMMENDED / ALTERNATIVE / INDUSTRIAL）
  ↓
对照能力比较（wireless / flash / SRAM / I/O）
  ↓
约束警告（引脚数、无线需求、功耗）
  ↓
用户选择 MCU
  ↓
外设预映射（总线分配 + warningNote）
  ↓
Hardware artifact 创建
```

### Journey C — Pin / Wiring Design（P0）
```
已选 MCU + 外设
  ↓
自动引脚分配（ADC / I2C / 数字）
  ↓
电气规则校验 → 冲突 / 警告（如 strapping pin）
  ↓
用户查看 Pin Map + Wiring 图
  ↓
处理冲突（AI 提案 or 用户手动改）
  ↓
Accept → Wiring artifact（含警告）→ 可进入固件
```

### Journey D — Firmware Generation（P0）
```
Wiring 已确认
  ↓
生成固件（骨架 + 业务逻辑）
  ↓
Firmware Proposal + Diff（如 IO12→IO21 重映射）
  ↓
Impact 说明（boot 风险）
  ↓
Accept / Reject
  ↓
Firmware artifact 新版本（Accepted）
```

### Journey E — Build / Validation（P0）
```
Firmware Accepted
  ↓
Build（编译）
  ↓
成功 → Build artifact（编译证据）
  ↓
或失败 → 错误输出
  ↓
AI 诊断 → 修复提案（Diff）
  ↓
Accept → 重新 Build
  ↓
Validated
```

### Journey F — Physical Device Loop（P1：UI 先 Mock，真实后置）
```
连接开发板
  ↓
检测板卡（Board detected / COM port）
  ↓
Flash（高风险 → 明确确认）
  ↓
Serial 监视（遥测流）
  ↓
运行时证据（Debug Evidence）
  ↓
AI 诊断 → 修改提案 → 回到 Journey D/E
```

### Journey G — Stale Propagation & Revalidation（P0，UI 必须验证）
```
上游修改（改 MCU / 换外设 / 改需求）
  ↓
下游 Artifact 标 Stale（Pin Map → Wiring → Firmware → Build）
  ↓
用户看到 Stale 提示（badge / 警告）
  ↓
Review Impact → 选择重新验证路径
  ↓
下游逐个 Revalidate → 恢复 Validated
```

### Journey H — Settings / 语言 / 主题（P0 基础设施）
```
打开 Settings（顶栏 ⚙ 或侧栏）
  ↓
General：目标 MCU / 串口波特率
  ↓
Appearance：System / Light / Dark
  ↓
Language：中文 / English（即时生效）
  ↓
AI Provider：服务端 Key / BYOK
  ↓
Local Companion：设备 / 工具链状态
```

---

## 2. 优先级划分

| 优先级 | Journey | 理由 |
|---|---|---|
| **P0（本轮 Mock 必须走通）** | A 想法→工程、B 硬件选型、C 引脚/接线、D 固件提案、E 构建/验证、G Stale 传播、H 设置/语言/主题 | 构成 Golden Journey 完整闭环；Proposal 与 Stale 是产品定义要求必须验证的核心交互 |
| **P1（UI Mock 覆盖，实现后置）** | F 物理设备环（Companion 边界 Mock：检测/烧录/串口/遥测） | 产品定义 §7 要求首版 Companion 能力，但真实协议延后 |
| **Future** | STM32 目标、多 MCU 系统、云同步/备份、Hosted AI、多人协作、版本历史管理页、导出 PDF 真渲染、校准工作台、功耗预算分析、文档生成、Git 集成 | 产品定义明确"不做"或延后的能力 |

---

## 3. Golden Journey（唯一首条最小完整旅程）

### 选择：**ESP32-S3 温室监测器（Smart Greenhouse Monitor）**

完整路径：
```
1. 创建项目（空白）
2. 描述想法：土壤湿度监测 + 5V 水泵继电器 + OLED 显示 + Wi-Fi 上报
3. AI Discovery：
   - 能力① 土壤湿度（Analog, complete）
   - 能力② 水泵控制（Relay/PWM, complete）
   - 能力③ OLED 显示（I2C, pending → 澄清确认 0.96" SSD1306）
   - 能力④ 供电/电源（Power, partial）
   - 提案① 无线连接（Accept）
   - 提案② 环境传感（Accept）
   - 提案③ 数据持久化 NVS（Reject）
4. Requirements Accepted → 进入硬件
5. MCU 候选：ESP32-S3（RECOMMENDED，选中）/ RP2040（ALTERNATIVE）/ STM32F401（INDUSTRIAL）
   → 外设预映射（soil→IO4 ADC、relay、OLED→I2C IO8/IO9）
6. 引脚分配 → 电气规则校验 → ⚠️ 冲突：水泵继电器被分配到 **IO12（ESP32-S3 strapping pin，boot 风险）**
7. 生成固件 → Firmware Proposal：**IO12 → IO21 重映射**（diff + 风险说明）
8. Accept → Firmware v2（Accepted）
9. Build → 成功（编译证据）
   - 失败场景（可触发）：编译器错误 → AI 诊断 → 修复提案 → Accept → Rebuild → 成功
10. Companion（Mock）：板卡检测 → Flash（确认对话框）→ Serial 遥测流 → 调试证据
11. Stale 场景（可触发）：改选 MCU（如切 RP2040）→ Pin Map/Wiring/Firmware/Build 级联 Stale → 重新验证路径
```

### 为什么是它（对照要求逐条论证）

| 要求 | 满足情况 |
|---|---|
| 体现 AI 价值 | Discovery（自然语言→能力+提案）、MCU 选型分析、固件生成、编译失败诊断——四个 AI 触点 |
| 体现硬件约束 | ESP32-S3 strapping 引脚（IO0/IO45/IO46/IO12）、ADC 通道、I2C 总线、继电器 flyback 保护、引脚预算 |
| 体现 Proposal | 两个实例：需求形式化提案（3 条逐条接受/拒绝）+ 固件引脚重映射 Diff（接受/拒绝）——参考原型已内置此交互 |
| 体现 Artifact lifecycle | Requirements(Accepted) → Hardware → Pin Map/Wiring(含警告) → Firmware(v2) → Build(证据)；Stale 级联覆盖 |
| 能最终真实编译 | ESP32-S3 = 产品定义 Golden Path；Arduino-ESP32 工具链是单板最简真实编译路径（阶段后置，Mock 先模拟） |
| 不依赖复杂 Companion | 编译路径不需要 Companion；只有 Flash/Serial 需要（Mock 边界即可验证） |
| 不覆盖所有 MCU | 单板（ESP32-S3）+ 3 个外围器件 |

**额外优势**：参考原型（已批准冻结）的演示数据本身就是"Smart Greenhouse + ESP32-S3 + strapping 冲突 + IO12→IO21 提案"——Golden Journey 与批准基线完全一致，不存在"为了旅程改 UI"的偏差；同时修正了参考的三处引脚不一致（见 product audit §6.1）。

---

## 4. 每个 Journey 对应的 UI 验证点（Mock 阶段核对清单）

- **A**：Empty 首启 → 描述 → 分析中（spinner/流式）→ 能力卡 → 澄清交互 → 提案卡 Accept/Reject → 进入硬件
- **B**：候选矩阵 → 选中 → 外设映射 → Hardware artifact 生成提示
- **C**：自动分配 → 校验中 → 冲突警告（strapping）→ Pin Map 表 + 图 → 处理冲突
- **D**：生成中 → Diff 视图 → Accept/Reject → 版本变化可见
- **E**：Build 中（进度）→ 成功/失败 → AI 诊断卡 → 修复提案 → Rebuild
- **F**（Mock）：板检测/COM 口 → Flash 确认对话框 → Serial 流 → 证据
- **G**：改 MCU → 下游 Stale badge → Impact 列表 → 逐项重新验证
- **H**：语言即时切换、主题三态、设置持久化（localStorage）

---

## 5. 关于 Journey F 与 Stale 的关键裁决（本轮 UI 验证目标）

1. **Stale 呈现形态**：不预设"badge or blocking"——Mock 中同时实现徽标 + 主操作拦截两个层次，浏览器走查后由用户体验决定（写进 Acceptance Report §6）。
2. **Stale 后能否 Build**：Mock 中"Build 前检查"强制要求 Firmware 非 Stale（否则给确认式提示），验证这是否是正确产品语义。
3. **Companion 边界**：只做 UI 状态机（detected/connected/flashing/serial），不做真实协议——真实协议设计留待 UI Frozen 后。
