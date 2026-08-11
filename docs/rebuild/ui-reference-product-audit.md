# UI Reference Product Audit

> 日期：2026-08-11
> 基线：`xiaohai-uid/mcu-project-assistant-ui-reference` `facec1e`（Approved UI Reference，FROZEN）
> 目的：把 UI Reference 从"样式参考"提升为 **Product Interaction Reference**——回答"新产品应该怎样被真实用户使用"
> 本审计只看 UI 表达的产品语义，不引用旧数据库对象，不设计后端

---

## 1. Information Architecture

```
┌──────────────────────────── TopNavBar（44px，固定，毛玻璃）────────────────────────────┐
│ [● ● ●] 品牌 MCU Assistant v2.4 │ 桥接器:在线 · MCU:ESP32-S3(COM6) │ Draft|Validated|Professional View │ Copilot已就绪 │ EN/中文 │ ⚙ │ ? │ 头像 │
└─────────────────────────────────────────────────────────────────────────────────────┘
   Home（Dashboard）                                    Workspace（默认 Draft）
   ┌──────────────────────────────┐        ┌───────────┬──────────────────────┬───────────┐
   │ 左列：新建项目卡              │        │ SideNav   │ Main Canvas          │ Copilot   │
   │       入门模板（2）           │        │ 项目上下文 │ （按侧栏标签切换）     │ 面板 320px│
   │ 右列：Recent Projects 网格    │        │ ───────── │ RequirementsView     │ Chat      │
   │       项目卡×2（版本/状态/    │        │ 工作流程:  │ HardwareSelectionView │ Context   │
   │       目标/RTOS/大小/操作）   │        │ 需求定义   │ WiringGuidanceView   │ History   │
   │                               │        │ 硬件选型   │ FirmwareView         │           │
   └──────────────────────────────┘        │ 引脚接线   │ BuildView            │           │
                                           │ 固件开发   │ CompanionView        │           │
                                           │ 编译烧录   │ SettingsView         │           │
                                           │ ───────── │                      │           │
                                           │ 工具与配置: │                      │           │
                                           │ 伴侣桥接器  │                      │           │
                                           │ 工作区设置  │                      │           │
                                           │ [烧录目标MCU]                      │           │
                                           └───────────┴──────────────────────┴───────────┘
```

### 一级导航（TopNavBar 分段控件）
- **Home** — Dashboard：最近项目 + 新建 + 模板
- **Draft** — 项目工作区（默认；侧栏 5 个工程步骤 + 2 个工具项 + Copilot 面板）
- **Validated** — 仅存在于类型与按钮中，**App 无独立视图**（点击后渲染同一工作区）→ 未实现占位
- **Professional View** — 同上，**无独立视图**（渲染同一工作区）→ 未实现占位
- 一级切换另有：语言切换按钮（顶栏）、设置入口（顶栏 ⚙ + 侧栏）、帮助（alert 弹窗）

### 二级导航（SideNavBar，仅 Workspace 可见）
- **工作流程组**：Requirements → Hardware → Wiring → Firmware → Build（顺序固定，线性推进语义）
- **工具与配置组**：Companion Bridge、Workspace Settings
- 项目上下文头部：项目名 + 目标 MCU + COM 口（当前项目标识）
- "烧录目标 MCU"主按钮（跳转 Build）

### 页面间关系与用户进入路径
1. **首启路径**：Home →（新建空白 / 选模板 / 打开项目卡）→ Draft 工作区（默认落到 Requirements 标签）
2. **主推进路径**：Requirements → Hardware → Wiring → Firmware → Build（各视图底部/头部有"下一步"主按钮）
3. **工具路径**：任意视图 ↔ Companion / Settings（侧栏直达）
4. **平行路径**：Copilot 面板随时可对话；"Apply Changes"可从面板直接触发提案接受；"Review Proposal"跳转 Firmware
5. **连接状态**：顶栏常驻桥接器/设备指示（绿/红点）

### Project 是否是核心容器
**是**。Workspace 的侧栏头部、Dashboard 项目卡、顶栏设备名全部围绕当前 Project；视图切换不离开 Project 上下文。参考已确立"Project = 核心容器 + 左侧工程步骤 = 容器内的视图导航"。

### IA 缺口（供 Mock 阶段裁决）
1. `Validated` / `Professional View` 两个一级标签无独立视图（死按钮）
2. 顶栏"Draft"（工作区模式）与项目卡状态"Draft"（artifact 状态）同名异构——语义混淆风险
3. 导航是"线性步骤"还是"任意可达"未表达（侧栏无 Stale/锁定/完成态）
4. Help 用 `alert()`，无帮助页
5. Home 的项目卡状态用英文原词（Stale/Validated/Draft）而非词典

---

## 2. Core Objects（用户认知中的对象）

> 只从 UI 出发。用户实际认为自己在操作这些对象：

| 对象 | UI 中的证据 | 关键属性 |
|---|---|---|
| **Project** | 项目卡（Home）、侧栏上下文头、顶栏设备名 | version（v1.2.4-alpha）、status（Stale/Validated/Draft）、target、framework（RTOS/框架）、lastEdit、size |
| **Starter Template** | 模板卡×2（IoT Weather Station / Basic Motor Control） | badge（ESP-IDF/HAL）、description |
| **Requirement / Capability** | 需求探索结果卡（4 项） | title、type（Analog/Digital/I2C/Power/Relay-PWM）、status（complete/partial/pending）、progress%、warning |
| **Proposal** | 规范审阅卡（3 条） | number、title、accepted（勾选）、initialIdea（口语）、formalizedRequirement（形式化）、impacts[] |
| **MCU Candidate** | 选型矩阵（3 个） | badge（RECOMMENDED/ALTERNATIVE/INDUSTRIAL）、core、wireless、flash/SRAM、I/O、Copilot 理由 |
| **Peripheral** | 外设清单（3 个，预映射） | type、interface、pinsNeeded、status（Mapped to…）、warningNote |
| **Pin Mapping** | 引脚矩阵表 + 板卡图引脚 | component、pinId、type（Analog/Digital/I2C）、colorDot、subLabels |
| **Firmware** | 固件代码视图（main.cpp） | 框架标签（Arduino/ESP-IDF）、代码、复制 |
| **Firmware Proposal / Diff** | 提案条（GPIO 冲突） | 状态（Pending Review）、boot risk、proposed remap（-IO12→+IO21）、Accept/Reject |
| **Build / Compile** | 编译控制台（PlatformIO/CMake） | 构建日志、内存/Flash 用量、烧录进度 |
| **Serial Console** | 串口监视器 | 命令输入、遥测输出行 |
| **Device** | 顶栏 + Companion + Build | COM 口、baud、连接状态、chip ID |
| **Telemetry Signal** | Companion 传感器卡 | 湿度值/泵状态/温度值、模拟滑块 |
| **Debug Evidence** | Build 日志 + Companion 遥测（隐式） | 时间线输出 |
| **Copilot Message** | Copilot 面板消息流 | text、warningNote、codeSnippet（filename/oldPin/newPin/code）、proposalCard（issueTitle/description/suggestedFix） |
| **Settings 项** | Settings 六标签 | 目标 MCU、串口/波特率、主题、语言、AI Provider、Companion、高级 |

### 对象关系（用户视角）
- Project 包含：Requirements（能力+提案）→ Hardware（MCU 候选+外设）→ Wiring（Pin Map）→ Firmware → Build/Device
- Proposal 附着于 Requirement 与 Firmware；Copilot 消息可以携带 Proposal 卡片
- Device/Companion 是 Project 的运行时对象（连接状态贯穿顶栏/Build/Companion）

---

## 3. Actions（用户动作清单）

### 工程动作
1. Create Project（空白 / 模板）— Home
2. Open Workspace — Home 项目卡
3. Describe Idea — Requirements 文本框
4. Clear Text — Requirements
5. Start Discovery — Requirements（AI 分析中禁用）
6. Toggle Proposal（勾选 = 纳入设计）— Requirements
7. Proceed to Hardware Selection — Requirements 底部
8. Select MCU — Hardware（点卡片/按钮）
9. Configure Wiring（下一步）— Hardware 顶部
10. Verify Electrical Rules — Wiring
11. Export PDF — Wiring
12. Generate Firmware（下一步）— Wiring
13. Copy Code — Firmware
14. Accept Change / Reject — Firmware 提案
15. Compile & Flash MCU — Build
16. Send Serial Command — Build
17. Flash Target MCU — SideNav 常驻按钮
18. View Logs / Flash Device / Open Workspace — Home 项目卡
19. Simulate Moisture / Simulate Temp — Companion
20. Override Relay On/Off — Companion

### 系统动作
21. 切换语言（顶栏快捷 / Settings Language）
22. 切换主题 System/Light/Dark — Settings Appearance
23. 选择 MCU 目标 / 串口波特率 — Settings General
24. 配置 AI Provider（Gemini Key 服务端）— Settings AI Provider
25. 发送 Copilot 消息 — Copilot 面板
26. 切换 Copilot 标签（Chat/Context/History）
27. Apply Changes（面板直接接受提案）
28. Review Proposal（跳转 Firmware）
29. 打开 Settings / Help
30. 缩放接线图（zoom in/out）

### 动作特征分析
- **全部动作是即时本地状态更新**（useState），无任何异步持久化动作；只有 discover/chat 两个 fetch 调用（且失败仅 console.error）
- 高风险动作（Flash/烧录）**无确认对话框**（参考原型缺失，Mock 必须补）
- 修改类动作（选 MCU/改引脚）**不触发下游失效提示**（Stale 语义缺失，Mock 必须补）
- 帮助/导出/校验用 `alert()`（原型简化，Mock 改为真实 UI）

---

## 4. State（用户可感知的状态）

| 状态 | UI 呈现 | 所属对象 |
|---|---|---|
| Draft | 项目卡状态点+标签（英文原词） | Project |
| Validated | 项目卡状态点+标签 | Project |
| Stale | 项目卡状态点+标签 | Project |
| complete / partial / pending | 能力卡徽标 + 进度条 + 待澄清警示（amber） | Requirement |
| accepted（勾选）/ 未勾选 | 提案卡高亮 vs 半透明降级 + checkbox | Proposal |
| Pending Engineering Review | Firmware 提案状态标签 | Firmware Proposal |
| accepted（提案后） | 接受后 pin 更新为 IO21 + Copilot 确认消息 | Firmware Proposal |
| Selected / 未选 | MCU 卡边框高亮 + 按钮态（Selected Target/Select Core） | MCU Candidate |
| Mapped to… | 外设状态徽标（绿） | Peripheral |
| Rules Verified | Wiring 头部绿徽标（静态） | Wiring |
| AI Working | 按钮 spinner + "正在解析…" | Discovery |
| Copilot Active | 顶栏蓝徽标 | Copilot |
| Bridge Online / MCU Connected | 顶栏绿点（字体色） | Device/Companion |
| MCU Disconnected | 顶栏红点（仅代码存在，默认 true） | Device |
| zoom level | 百分比显示 | Wiring 图 |
| 泵 Active/Idle | Companion 泵卡高亮态 | Telemetry |

### 状态语义缺口（已表达的都不完整）
- Proposal 只有"勾选/未勾选"，**无显式 Rejected 态**（拒绝 = 不勾选，语义含糊）
- Firmware 提案 Reject 后 `pending=false` 但**无任何视觉反馈**（只剩"接受"按钮消失）
- 项目卡状态是静态 mock 数据，与工作区内部状态**不联动**
- Rules Verified 是静态徽标，与"是否真的校验过"无关

---

## 5. Missing states（原型缺失的真实状态）

| 状态 | 现状 | 必须补充的原因（产品语义） |
|---|---|---|
| **Empty** | 无项目时 Home 空白；空 prompt 只有按钮禁用；无能力结果时整个 section 隐藏 | 首启体验必须表达"还没有项目/还没分析" |
| **Loading** | 仅 discover 按钮 spinner；视图切换无骨架屏 | 异步操作的普遍形态 |
| **Streaming** | discover/chat 一次性返回；无逐 token 效果 | AI 分析中"正在工作"的可感知进度 |
| **Error** | discover 失败只 console.error；无错误 UI | 必须表达失败 + 可重试 |
| **Retry** | 无 | 失败后的第一动作 |
| **Offline** | 无 | Local-first 产品的核心状态 |
| **Cancelled** | 无 | 长任务（发现/编译）可取消 |
| **Stale（工作区内）** | 仅项目卡有 Stale 字样；无下游失效呈现 | 产品核心模型（见下节 Stale 专项） |
| **Unsaved** | 无 | 编辑中的修改是否已入正式 artifact |
| **Permission / 高风险确认** | Flash 无确认 | 烧录/擦除必须确认（产品定义 §7） |
| **Device disconnected** | 顶栏红点存在但不可达（默认 true） | 运行时断连的呈现与恢复 |
| **Toolchain unavailable** | 无 | 编译前置缺失（未装 PlatformIO/IDF） |
| **Provider unavailable** | server 静默降级 mock，UI 无感知 | AI 服务不可用时必须告知 |
| **Partial success** | 能力 progress<100 存在，但无"部分失败"语义 | 部分能力提取失败的处理 |
| **Build failed** | Build 日志硬编码成功 | 编译失败 + AI 诊断是核心 Journey |
| **Build in progress** | 日志静态，无运行中态 | 编译进度 |
| **Rejected（显式）** | 无 | 提案拒绝的明确语义 |
| **Clarification** | "待补充明确"徽标存在，但无澄清交互流 | 需求不清时的对话闭环 |
| **Revalidation** | 无 | Stale 后重新验证的路径 |
| **Validation pending/failed** | 无 | 规则校验的过程与结果 |

---

## 6. 参考内部不一致（Mock 阶段必须裁决）

1. **泵继电器引脚三处不一致**：Hardware 外设卡 `IN -> IO5 (or IO21)`；App 初始 pinMappings `IO12`；Firmware 提案 `IO12 → IO21`。→ Mock 统一为：初始自动分配 IO12（触发 strapping 警告）→ 提案 → IO21。
2. **i18n key 漂移**：组件引用 `statusValidated` / `statusDraft` / `createNewDesc` / `initBlank` / `recentProjectsDesc` 在词典中不存在 → 渲染 undefined。→ Mock 必须补全词典并加 key 完整性测试。
3. **Validated / Professional View 死按钮**（见 IA 缺口 1）。
4. **项目卡状态英文原词** vs 词典（i18n 未覆盖）。
5. **`getInitialLanguage` 默认系统语言**，但顶栏一键切换与 Settings 切换并存——两处需保持同步语义。
6. **Hardware 视图顶部"需求已校验通过"横幅是静态的**——与实际校验状态无绑定。

---

## 7. 结论：UI Reference 表达的产品形态

1. **Project 容器成立**：Home 卡片 + 工作区上下文 + 视图导航 = 完整的 Project 工作区形态。
2. **五步工程推进成立**：Requirements → Hardware → Wiring → Firmware → Build 是用户的主路径。
3. **Proposal 模型成立**（两个实例）：需求形式化提案（initialIdea→formalized→impacts→勾选）与固件修改提案（diff→accept/reject）。**这是产品最独特的交互资产。**
4. **Companion/Device 是运行时层**：贯穿顶栏状态、Build 控制台、Companion 遥测。
5. **Copilot 是平行助手**：随时对话 + 携带提案卡片 + 一键应用。
6. **缺失面**：Empty/Loading/Error/Retry/Stale/Rejected/Cancelled/Offline/权限确认/真实校验——全部要由 Mock 阶段补上。
