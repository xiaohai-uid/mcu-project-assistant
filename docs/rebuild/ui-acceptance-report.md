# UI Acceptance Report — Golden Journey Mock

> 日期：2026-08-11
> 状态：**Mock UI 完成，浏览器走查通过，等待 UI Frozen 批准**
> Mock 位置：`C:\zcode\mcu`（独立前端，未触碰旧工程代码；`npm run dev` → http://localhost:5173）
> 相关文档：ui-reference-product-audit.md / core-journey-map.md / ui-state-model.md / keep-adapt-delete-new-audit.md

---

## 1. Product model（用户眼中的核心对象）

经 Mock 验证，产品由以下用户可见对象构成（每个对象有版本与状态，AI 不静默修改）：

| 对象 | 状态集合 | Mock 呈现 |
|---|---|---|
| **Project** | Draft / Validated / Stale | Home 项目卡 + 工作区侧栏上下文头 |
| **Requirement / Capability** | complete / partial / pending（+待澄清） | 能力卡 + 进度条 + 徽标 |
| **Proposal**（需求形式化） | pending / accepted / rejected | 提案卡：口语→形式化 Diff + 影响标签 + 三态决策 |
| **MCU Candidate** | 推荐/备选/工业级 + 约束警告 | 选型矩阵 |
| **Peripheral** | 预映射（Mapped to…） | 外设清单 |
| **Pin Map** | accepted / warning / stale | 引脚矩阵表 + 板卡图 + 冲突卡 |
| **Wiring** | warning / validated / stale | 布局图 + 电气规则校验状态 |
| **Firmware**（版本化） | proposal → accepted/rejected，v0→v1→… | 代码 + Diff + 版本徽标 |
| **Build** | building / succeeded / failed / cancelled | 编译日志 + 结果徽标 |
| **Debug Evidence** | validated（烧录后） | 串口证据流 |
| **Device / Companion** | none / detected / connected / flashing / disconnected | 顶栏 + Companion 视图 |
| **Copilot** | Chat / Context / History | 消息流 + 上下文卡 + 提案历史 |

**关键结论**：Proposal、Artifact 版本、Stale 三个概念在 UI 层面成立且可操作；Project 是容器。

## 2. Golden Journey（完整流程，全部浏览器验证）

```
创建项目(空白) → 描述想法(预填温室样例) → AI 解析(流式输出+可取消)
→ 4 项能力提取(2 完整+1 待澄清+1 部分) → 澄清问答(OLED 尺寸确认, 3/4 完整)
→ 3 条形式化提案 → 拒绝 #01 + 接受 #03 → 进入硬件选型(Requirements v1 提交)
→ MCU 候选矩阵(推荐/备选/工业级+约束警告) → 选 ESP32-S3 (Hardware v1)
→ 自动引脚分配(IO4/IO12/IO8/IO9) → ⚠️ IO12 Strapping 冲突卡
→ 校验电气规则 → 生成固件 → 提案 Diff(IO12→IO21 + boot 风险) → 接受 (Firmware v1, Pin Map 联动 IO21)
→ 编译 → BUILD SUCCESS (Build artifact 证据)
→ [失败支线] 下次编译失败 → fatal error (缺库) → AI 诊断 → platformio.ini 修复提案 → 应用 → 重建成功
→ [Stale 支线] 换 MCU(RP2040) → Pin Map/Wiring/Firmware/Build 级联 Stale → 全局横幅+视图拦截 → Revalidate All → 全部恢复 Validated
→ [Companion 支线] 检测开发板 → Flash(高风险确认) → 串口遥测流 → Debug Evidence
```

## 3. UI changes（相对 UI Reference 的调整）

| # | 调整 | 原因 |
|---|---|---|
| 1 | **修复 i18n key 漂移**（statusValidated/statusDraft/createNewDesc/initBlank/recentProjectsDesc 等缺失 key 补全，新增 ~200 key，双语） | 参考渲染 undefined；新增 `tools/i18n-check.ts` 防止复发 |
| 2 | **Proposal 三态**（pending/accepted/rejected + Accept/Reject/撤销按钮） | 参考只有勾选/未勾选，拒绝语义含糊 |
| 3 | **修正继电器引脚三处不一致**（IO5/IO12/IO21 → 统一 IO12 触发冲突 → 提案 IO21） | 参考内部矛盾 |
| 4 | **补全部缺失状态**：Empty/Loading/Error/Retry/Cancelled/Offline/Unsaved/PartialSuccess/Stale(工作区内)/Rejected/ProviderUnavailable/ToolchainUnavailable/DeviceDisconnected/Flashing | 产品定义要求（见 §4） |
| 5 | **Stale 呈现**：侧栏 artifact 状态点 + 全局 StaleBanner + 视图内拦截 + Revalidate All | 参考仅项目卡有 Stale 字样 |
| 6 | **Build 失败闭环**：错误日志 → AI 诊断卡 → 修复提案(diff) → 应用 → 重建 | 参考日志硬编码成功 |
| 7 | **Flash 高风险确认对话框**（Companion/Build/侧栏三处入口） | 产品定义 §7 |
| 8 | **Build 成功后允许重新编译**（参考逻辑禁用；作为 UX 缺口修复） | 走查中发现 |
| 9 | **State Lab**（左下角 science 按钮 + Settings→Advanced）：17 个场景触发器 | Mock 阶段专用，UI Frozen 后移除 |
| 10 | 保留参考全部视觉基线：macOS 玻璃风格/CSS 变量/布局/图标 | UI 基线冻结 |
| 11 | 删除参考的 express/Gemini server（纯前端 Mock，无后端调用） | Mock 阶段不允许接真实 AI |

## 4. State coverage（实现的状态）

**全局层**：Idle / Empty(Home+Requirements) / Loading(骨架) / Offline(顶栏+横幅) / DeviceDisconnected / ToolchainUnavailable / ProviderUnavailable / Unsaved(提示条)
**工作区层**：PromptEditing / Analyzing(流式+取消) / ClarificationPending / ProposalReady / Accepted / Rejected / CandidateReview / MappingGenerating / ConflictDetected(IO12) / RulesValidated / Generating / Building / BuildSucceeded / BuildFailed / Retrying / Cancelled / Stale / Revalidating / PartialSuccess
**对象层**：Proposal 三态 / Requirement 三态 / Device 五态 / Artifact 六态(Draft/Accepted/Validated/Stale/Error/Warning)

→ 详见 docs/rebuild/ui-state-model.md（每状态含"看到/能做/主操作/次操作/进入/退出/是否改正式 Artifact"）

## 5. Proposal workflow（AI 修改如何进入正式 Artifact）

**已实现并验证的两处 Proposal 实例：**

1. **需求形式化**（Discovery 输出）：
   `initialIdea(口语) → formalizedRequirement(形式化) + impacts → 用户逐条 Accept/Reject → 仅 Accepted 写入 Requirements artifact v1`
2. **固件引脚重映射**（Firmware 生成时检测 strapping 冲突）：
   `IO12 → IO21 Diff + boot 风险说明 + 影响范围 → Accept(新版本 v1 提交, Pin Map/Wiring 联动) / Reject(保留 v0 + Warning)`

**贯穿原则**（UI 中显式展示）："AI 绝不静默覆盖已接受的工程资产——每次 AI 变更都以提案形式等待您的审阅"。
**验证结果**：两个实例的 Accept/Reject 均正确驱动 artifact 版本变化与下游联动；Copilot 面板可携带提案卡并跳转审阅。

## 6. Stale workflow（依赖变化如何呈现）

**触发**：更换 MCU（或 Lab 强制）→ Pin Map / Wiring / Firmware / Build 级联 Stale。
**呈现（三层）**：
1. 侧栏 5 个工程标签出现琥珀状态点（对应 artifact）
2. 工作区顶部全局 StaleBanner："检测到已过期的工程资产——Hardware 已变更，以下下游资产已过期: Pin Map → Wiring → Firmware → Build" + [全部重新验证]
3. 视图内拦截：Firmware 生成按钮禁用（title=需先重新验证）、Build 编译按钮禁用、Wiring 生成固件禁用
**恢复**：Revalidate All → 逐项重生成（引脚重分配→规则重校验→固件新版本→构建）→ 全部转绿 + Copilot 确认。
**走查发现的待裁决问题**：Revalidate 时固件沿用"用户此前决策"自动接受（Mock 语义）——"重新验证是否自动应用先前决策"是产品问题（见 §10-4）。

## 7. Build workflow（编译成败呈现）

- **进行中**：逐行日志输出（CMake→编译→链接→镜像）+ 侧栏"正在编译…"
- **成功**：绿色 BUILD SUCCESS + 内存/Flash 用量 + Build artifact Validated；设备已连时出现 Flash 按钮
- **失败**：红色 fatal error（含文件/行号）+ BUILD FAILED 徽标 + [让 Copilot 诊断]
- **诊断**：AI 诊断卡（原因 + 建议）→ 修复提案 diff（platformio.ini lib_deps）→ [应用修复（提案）] → 重建 → 成功
- **工具链缺失**：Build 视图警告条 + 编译禁用 + [重新检测工具链]
- **取消**：构建中可取消 → "编译已取消" + 不写 artifact
- **Stale 拦截**：固件过期时编译按钮禁用（必须先 Revalidate）

## 8. Browser evidence（实际浏览器操作验证）

走查工具：Chrome DevTools MCP（http://localhost:5173），逐断言验证，全部通过：

| 场景 | 验证断言 | 结果 |
|---|---|---|
| Home 渲染 | 项目卡/状态徽标(已过期/已验证)/模板/新建 | ✅ |
| 创建项目 | 工作区创建、Requirements 空态 | ✅ |
| Discovery 流式 | "正在解析工程需求…" + 逐段输出 + 取消按钮 | ✅ |
| 能力提取 | 4 卡（2 完整+1 待澄清+1 部分）+ 部分成功提示 | ✅ |
| 澄清 | 问答卡 → 回答 → OLED 升级 complete(3/4) | ✅ |
| 提案决策 | 拒绝#01/接受#03 → 三态徽标 + Copilot 决策记录 | ✅ |
| 进入硬件 | Requirements v1 提交消息 | ✅ |
| MCU 矩阵 | 推荐/备选/工业级 + RP2040/STM32 约束警告 | ✅ |
| 引脚分配 | IO4/IO12/IO8/IO9 + Strapping 冲突卡 + 图上 IO12 红标 | ✅ |
| 规则校验 | "电气规则未校验"→校验后徽标变化 | ✅ |
| 固件 Diff | IO12→IO21 双栏 diff + boot 风险 + Accept/Reject | ✅ |
| 接受提案 | 固件 v1、Pin Map 联动 IO21、Copilot 确认 | ✅ |
| 构建成功 | BUILDING→BUILD SUCCESS + 用量 | ✅ |
| **构建失败** | 下次编译失败 → fatal error → FAIL 徽标 | ✅ |
| **AI 诊断+修复** | 诊断卡 + lib_deps diff 提案 → 应用 → 重建成功 | ✅ |
| **Stale 传播** | 换 RP2040 → 全局横幅 + Firmware 拦截 + 侧栏点 | ✅ |
| **Revalidate** | 全部重新验证 → 5 标签转绿 + Copilot 确认 | ✅ |
| 离线 | 顶栏"桥接器: 离线" + Requirements 横幅 | ✅ |
| 供应商不可用 | 横幅 + Copilot 输入禁用 | ✅ |
| 工具链缺失 | Build 警告 + 编译禁用 | ✅ |
| 设备断开 | 顶栏"MCU: 未连接" + Companion 空态 | ✅ |
| 空项目 | Home 空态 + 创建入口 | ✅ |
| 解析失败+重试 | 错误横幅 → 重试 → 成功提取 | ✅ |
| 慢速+取消 | 分析中取消 → "已取消" | ✅ |
| 主题三态 | dark/light/system 根类切换 | ✅ |
| 语言切换 | 中文↔English 即时生效 | ✅ |
| 质量门 | `tsc --noEmit` 0 错误；`tools/i18n-check` 308/308 key 完整 | ✅ |

截图证据：`docs/rebuild/evidence/`（10-requirements-zh.png、11-home-zh.png；走查过程另有内联截图随对话附件）。

## 9. Still mocked（仍为假的能力）

| 能力 | Mock 程度 |
|---|---|
| 所有"AI"输出 | 确定性脚本 + 延迟/流式模拟（无真实 LLM 调用） |
| Discovery/澄清/诊断 | 脚本数据（温室样例固定） |
| MCU 候选/引脚分配/冲突检测 | 静态数据 + 规则表（IO12 strapping 单规则） |
| 固件代码 | 模板生成（引脚占位符替换） |
| 编译 | 预置成功/失败日志脚本 |
| Flash/串口/遥测 | 模拟进度/模拟遥测行 |
| 设备/工具链检测 | 开关场景（State Lab 触发） |
| 提案历史/上下文 | 内存态（刷新即失） |
| 持久化 | 仅语言/主题 localStorage；工程数据无持久化 |
| 导出 PDF | alert 提示（未实现渲染） |

## 10. Questions exposed by UI（做完 UI 后才暴露的架构问题）

1. **Revalidate 的决策语义**：重新验证时固件"沿用先前接受的决策"自动通过（Mock 假设）——产品上"重新验证是否重走提案？还是沿用决策只重跑管线？"必须定夺，影响 Contract 设计。
2. **Build 后重编译入口**：成功态曾无重建入口（已修复为可重编译）；但"重编译是否产生新 Build 版本/证据"的版本语义未定。
3. **Stale 的阻塞级别**：Mock 中 Firmware/Build 主操作被硬拦截（按钮禁用）；但"带 Stale 继续"（如带警告接受）是否需要显式确认流，产品未定——目前 UI 无"强行继续"路径。
4. **部分成功/失败的粒度**：能力级 partial 已呈现，但"部分提取失败"与"下游部分 Stale"的组合呈现（某下游 error 而非 stale）未走查（Mock 无此路径）。
5. **Unsaved 语义**：UI 有提示条文案，但"编辑中离开视图"的确认流未实现——Draft vs 正式版本的分界需要 Contract 定义。
6. **Copilot 面板的宽度/常驻**：320px 常驻在窄屏/专业视图的取舍未验证（参考即如此，保留）。
7. **澄清的交互形态**：当前是单轮问答卡；"多轮澄清 + 可跳过"的完成条件是产品问题（跳过=默认规格的 Mock 假设）。
8. **Stale 触发源完整性**：Mock 只有"换 MCU"和强制触发；改外设/改需求/手动改引脚各自的下游影响面未全部覆盖（需要 Contract 阶段的依赖图定义）。

---

## 结论

- **Golden Journey（ESP32-S3 温室监测）在纯前端 Mock 下完整可走通**，含 Proposal 双实例与 Stale 全链路。
- **UI 基线 = UI Reference + 上述 11 项调整**；所有缺失状态已补齐并有 Lab 触发入口。
- 已知的 8 个产品问题已暴露，留待 UI Frozen 后 Contract 阶段裁决。
- 本报告交付后 **STOP**：等待 UI Frozen 批准；期间不进入 Contract / Domain / Persistence / 后端实现。
