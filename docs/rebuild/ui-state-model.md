# UI State Model — Golden Journey（ESP32-S3 Smart Greenhouse）

> 日期：2026-08-11
> 范围：第一个 Golden Journey 的 UI 状态机。状态 = 用户可感知的状态（非 TS enum 清单）。
> 每个状态：用户看到什么 / 能做什么 / 主操作 / 次操作 / 如何进入 / 如何退出 / 是否修改正式 Artifact
> 状态分三层：**全局层**（贯穿所有视图）、**工作区层**（每个工程视图）、**对象层**（artifact/提案/设备对象自身状态）

---

## 0. 状态总览

### 全局层
| # | 状态 | 出现视图 |
|---|---|---|
| G1 | Idle（就绪） | 全部 |
| G2 | Empty（空工作区） | Home / Requirements / Hardware |
| G3 | Loading（骨架加载） | 视图切换 / 数据载入 |
| G4 | Offline（离线） | 顶栏 + 全视图提示条 |
| G5 | DeviceDisconnected（设备断开） | 顶栏 + Build + Companion |
| G6 | ToolchainUnavailable（工具链缺失） | Build + Companion |
| G7 | ProviderUnavailable（AI 供应商不可用） | Requirements/Firmware + Copilot |
| G8 | Unsaved（有未确认编辑） | 编辑类视图 |

### 工作区层（Golden Journey 主推进）
| # | 状态 | 视图 |
|---|---|---|
| W1 | PromptEditing（描述编辑中） | Requirements |
| W2 | Analyzing（AI 分析中，流式） | Requirements + Copilot |
| W3 | ClarificationPending（澄清待答） | Requirements |
| W4 | ProposalReady（提案待决策） | Requirements / Firmware |
| W5 | Accepted（已接受） | 各 artifact |
| W6 | Rejected（已拒绝） | 各 artifact |
| W7 | CandidateReview（候选审阅中） | Hardware |
| W8 | MappingGenerating（引脚分配生成中） | Wiring |
| W9 | ConflictDetected（冲突/警告） | Wiring |
| W10 | RulesValidated（规则已校验） | Wiring |
| W11 | Generating（固件生成中） | Firmware |
| W12 | Building（编译中） | Build |
| W13 | BuildSucceeded（编译成功） | Build |
| W14 | BuildFailed（编译失败） | Build |
| W15 | Retrying（重试中） | 全工作区 |
| W16 | Cancelled（已取消） | 长任务视图 |
| W17 | Stale（下游失效） | 工作区任意 artifact |
| W18 | Revalidating（重新验证中） | Wiring/Firmware/Build |
| W19 | PartialSuccess（部分成功） | Requirements |

### 对象层
| # | 状态 | 对象 |
|---|---|---|
| O1 | Proposal: Pending / Accepted / Rejected | Proposal（需求提案 + 固件提案） |
| O2 | Requirement: Complete / Partial / Pending | Capability 卡 |
| O3 | Device: Detected / Connected / Flashing / Disconnected | Companion |
| O4 | Telemetry: Streaming / Idle | Companion 遥测 |
| O5 | Artifact: Draft / Accepted / Validated / Stale / Error | 各 artifact |

---

## 1. 全局层状态明细

### G1 Idle
- 看到：正常可操作界面，无任何进行中指示
- 能做：所有可用操作
- 主操作：取决于当前视图
- 次操作：切视图 / 开设置 / 语言
- 进入：任何状态完成/退出后
- 退出：发起任何动作
- 改 Artifact：否

### G2 Empty
- 看到：Home 无项目卡（空态插画 + "创建第一个项目"）；Requirements 无能力结果；提示文案
- 能做：创建项目 / 输入描述 / 用模板
- 主操作：Initialize Blank
- 次操作：选模板
- 进入：首次进入 / 无数据
- 退出：创建项目 / 描述并分析
- 改 Artifact：否

### G3 Loading
- 看到：视图骨架屏（卡片轮廓 shimmer）；顶栏/按钮无禁用
- 能做：等待；可切走
- 主操作：无（等待）
- 次操作：切换视图
- 进入：切换视图 / 打开项目
- 退出：数据就绪 → Idle
- 改 Artifact：否

### G4 Offline
- 看到：顶栏桥接器红点 + 全局提示条"离线模式：更改将保存在本地"；AI 操作禁用说明
- 能做：本地编辑、查看
- 主操作：继续本地工作
- 次操作：重试连接
- 进入：网络断开（Mock 可触发）
- 退出：连接恢复 → Idle
- 改 Artifact：允许本地 Draft 编辑（不写正式版本）

### G5 DeviceDisconnected
- 看到：顶栏"MCU: 未连接"红点；Build/Companion 显示设备空态 + 重连按钮
- 能做：除 Flash/Serial 外全部
- 主操作：重新检测设备
- 次操作：继续编译（不烧录）
- 进入：设备断开（Mock 可触发）
- 退出：检测到设备 → Connected
- 改 Artifact：否

### G6 ToolchainUnavailable
- 看到：Build 视图警告条"未检测到 ESP32 工具链（PlatformIO/IDF）"；Compile 按钮禁用 + 说明
- 能做：查看设置、尝试重检测
- 主操作：检测工具链（重试）
- 次操作：打开工具链设置说明
- 进入：检测失败（Mock 可触发）
- 退出：检测成功 → Idle
- 改 Artifact：否（不产生编译证据）

### G7 ProviderUnavailable
- 看到：Requirements/Firmware 提示条"AI 服务暂不可用"；Copilot 输入禁用或降级说明
- 能做：手动编辑（非 AI 路径）
- 主操作：重试
- 次操作：手动输入
- 进入：Mock 触发（provider 失败）
- 退出：重试成功
- 改 Artifact：否（AI 提案不产生）

### G8 Unsaved
- 看到：编辑对象上的"未保存"徽标（黄点）；切走时确认提示
- 能做：保存 / 丢弃 / 继续编辑
- 主操作：保存（或"纳入设计"）
- 次操作：丢弃
- 进入：编辑了未确认内容
- 退出：保存 → 版本更新；丢弃 → 还原
- 改 Artifact：仅在保存/接受时

---

## 2. 工作区层状态明细（Golden Journey）

### W1 PromptEditing
- 看到：描述输入框可编辑；"开始需求解析"按钮可用
- 能做：输入/清空/开始
- 主操作：Start Discovery
- 次操作：Clear Text
- 进入：进入 Requirements 且无结果 / 修改描述
- 退出：点击开始 → W2；清空 → 回到空
- 改 Artifact：否（只是输入草稿）

### W2 Analyzing（流式）
- 看到：按钮 spinner + "正在解析需求…"；Copilot 面板逐段输出分析（模拟 token 流）；能力卡逐个出现（渐入）
- 能做：等待；取消（新增）
- 主操作：无（自动）
- 次操作：Cancel（新增）
- 进入：Start Discovery
- 退出：完成 → W4 / W3（有澄清缺口）；失败 → 错误条 + Retry（W15）
- 改 Artifact：否（未接受前不写入）

### W3 ClarificationPending
- 看到：pending 能力卡 amber 徽标 + 澄清问题卡片（"OLED 尺寸是 0.96" 还是 1.3"？"）；回答输入
- 能做：回答问题 / 跳过
- 主操作：提交回答（重新分析该能力）
- 次操作：跳过（按默认规格处理）
- 进入：W2 检测到模糊项
- 退出：回答 → W2 续跑 → W4
- 改 Artifact：否

### W4 ProposalReady
- 看到：能力卡（complete/partial）+ 提案卡列表（每张：initialIdea vs formalizedRequirement + impacts + 勾选）；底部"进入硬件选型"
- 能做：逐条勾选/取消（= Accept/Reject）、进入下一步
- 主操作：Proceed to Hardware Selection
- 次操作：调整提案勾选
- 进入：W2 完成
- 退出：进入硬件（要求至少一条 Accepted）→ W7
- 改 Artifact：**是**——进入下一步时 Accepted 提案写入 Requirements artifact（正式版本 v1）

### W5 Accepted（对象级）
- 看到：artifact 卡绿徽标"已接受 v2"；提案勾选态
- 能做：继续推进 / 查看版本
- 主操作：下一步
- 次操作：查看 Diff/版本历史
- 进入：Accept 动作
- 退出：上游变更 → W17 Stale；重新编辑 → W4
- 改 Artifact：接受动作本身即版本提交

### W6 Rejected
- 看到：提案灰化 + "已拒绝"徽标（参考只有未勾选，Mock 补显式 Rejected）
- 能做：重新接受（改主意）
- 主操作：无（该提案不进入 artifact）
- 次操作：重新勾选
- 进入：显式 Reject 按钮
- 退出：重新接受 → W5
- 改 Artifact：否

### W7 CandidateReview
- 看到：MCU 候选矩阵（3 卡）+ 外设预映射；"需求已校验通过"横幅（绑定 W5）
- 能做：选 MCU、看外设、下一步
- 主操作：Select Core（选中后 Configure Wiring 可用）
- 次操作：切换候选 / 返回需求
- 进入：W4 进入
- 退出：选中 → 下一步 → W8
- 改 Artifact：**是**——选中 MCU 创建 Hardware artifact

### W8 MappingGenerating
- 看到：Wiring 视图加载态："正在分配引脚…"；分配逐个出现
- 能做：等待
- 主操作：无
- 次操作：Cancel
- 进入：Configure Wiring
- 退出：完成 → W9（有冲突）或 W10（无冲突）
- 改 Artifact：否（生成中）

### W9 ConflictDetected
- 看到：**关键状态**——水泵继电器分配 IO12 → strapping 警告卡（amber/rose）+ 引脚表中该行高亮 + Copilot 消息携带修复提案
- 能做：手动改引脚 / 交给 AI 提案 / 接受当前分配（担风险）
- 主操作：生成固件（带警告继续）或 接受 Copilot 提案
- 次操作：手动修改 Pin Map
- 进入：W8 检测到冲突
- 退出：AI 提案接受 → W10（风险消除）→ W11；带警告继续 → W11
- 改 Artifact：接受提案才写入 Wiring artifact（版本 + 警告记录）；带警告继续 = Warning 状态写入

### W10 RulesValidated
- 看到："电气规则已校验"绿徽标（动态，真校验后出现）；无警告
- 能做：生成固件 / 导出 PDF
- 主操作：Generate Firmware
- 次操作：Export PDF / Verify Rules（重跑）
- 进入：校验通过
- 退出：→ W11；上游变 → W17
- 改 Artifact：校验结果写入 Validation 证据（artifact 状态 Validated 或 Warning）

### W11 Generating（固件生成中）
- 看到：Firmware 视图代码区 loading + "正在生成固件…"
- 能做：等待 / 取消
- 主操作：无
- 次操作：Cancel
- 进入：Generate Firmware
- 退出：完成 → W4（固件提案）
- 改 Artifact：否（生成中）

### W4' ProposalReady（固件提案 Diff）
- 看到：代码 + 提案条（**- IO12 → + IO21** diff 高亮 + boot 风险说明 + Impact）+ Accept/Reject 按钮；状态"Pending Engineering Review"
- 能做：Accept / Reject / Copy Code
- 主操作：Accept Change
- 次操作：Reject
- 进入：W11 完成
- 退出：Accept → W5（Firmware v2 Accepted，Pin Map 联动更新 IO21）；Reject → W6（Firmware v1 保留 IO12 + Warning）
- 改 Artifact：**是**——Accept 产生 Firmware 新版本（版本化证明）

### W12 Building
- 看到：Build 控制台逐行输出（CMake → 编译 → 链接 → 镜像）；进度指示；"编译并烧录"按钮变运行态
- 能做：等待 / 取消
- 主操作：无（自动）
- 次操作：Cancel Build
- 进入：Compile & Flash / Flash Target MCU
- 退出：→ W13 或 W14
- 改 Artifact：否（构建中不写正式证据）

### W13 BuildSucceeded
- 看到：绿色"BUILD SUCCESS" + 内存/Flash 用量条 + 烧录成功（若连接设备）+ "已验证"徽标
- 能做：Flash（未烧时）/ 查看日志 / 重新编译
- 主操作：Flash（或确认完成）
- 次操作：View Logs / Rebuild
- 进入：编译成功
- 退出：上游变 → W17；重新编译 → W12
- 改 Artifact：**是**——Build artifact 写入（编译证据，状态 Validated）

### W14 BuildFailed
- 看到：红色错误输出（含行号/错误码）+ AI 诊断卡（原因 + 修复建议）+ 修复提案按钮
- 能做：接受 AI 修复提案 / 手动改 / 重试
- 主操作：Apply Fix（接受提案 → 回固件 → 重新编译）
- 次操作：Retry / 查看完整日志
- 进入：编译失败
- 退出：接受修复 → W11/W12；重试 → W15
- 改 Artifact：失败写入 Build artifact（Error 状态）；修复提案不自动改固件（需 Accept）

### W15 Retrying
- 看到：重试 spinner + "重试中…"；失败上下文保留
- 能做：取消
- 主操作：无
- 次操作：Cancel
- 进入：Retry / 重检测
- 退出：成功 → 原目标态；失败 → 回到错误态
- 改 Artifact：否

### W16 Cancelled
- 看到：长任务中止提示（"已取消"）+ 部分结果保留（如已生成的能力卡）
- 能做：重新开始 / 继续
- 主操作：重试/重新生成
- 次操作：查看部分结果
- 进入：用户取消 / Mock 触发
- 退出：重新生成 → W2/W8/W11/W12
- 改 Artifact：否（取消不写入）

### W17 Stale（核心验证状态）
- 看到：受影响 artifact 徽标"已过期"(amber) + 影响提示条"Hardware 变更影响 Pin Map / Wiring / Firmware / Build"+ 主操作被拦截说明
- 能做：查看影响 / 选择重新验证路径 / 撤销上游变更
- 主操作：Review Impact（列出下游清单）
- 次操作：逐项 Revalidate / 撤销
- 进入：上游 artifact 修改（如换 MCU、改外设、改需求）
- 退出：全部下游 Revalidate → Validated（W18）；撤销 → 回滚
- 改 Artifact：否（Stale 标记本身不写内容，但进入 Revalidate 后重新生成版本）

### W18 Revalidating
- 看到：逐项重验证进度（Pin Map → Wiring → Firmware → Build 逐个转绿）
- 能做：等待 / 跳过单项
- 主操作：无（自动链式）
- 次操作：跳过（标记为手动验证）
- 进入：W17 中选择重新验证
- 退出：全部通过 → W13/Validated；失败 → W14/警告
- 改 Artifact：**是**——每项重验证产生新版本

### W19 PartialSuccess
- 看到：能力卡部分 complete/部分 pending；Copilot 说明"4 项能力中 3 项已提取，1 项待确认"
- 能做：澄清 / 继续
- 主操作：处理待确认项
- 次操作：按部分结果继续
- 进入：W2 部分失败/模糊
- 退出：澄清完成 → W4；按部分继续 → W4
- 改 Artifact：进入下一步时仅 Accepted 部分写入

---

## 3. 对象层状态明细

### O1 Proposal: Pending / Accepted / Rejected
- 看到：提案卡三态徽标（待审阅 amber / 已接受绿 / 已拒绝灰）
- 能做：Pending→Accept/Reject；Accepted→可撤销；Rejected→重新接受
- 主操作：Accept / Reject
- 进入：AI 生成提案；退出：决策完成
- 改 Artifact：仅 Accept 时

### O2 Requirement: Complete / Partial / Pending
- 看到：能力卡徽标 + 进度条 + warning 样式
- 进入：Discovery 输出；退出：澄清后升级

### O3 Device: Detected / Connected / Flashing / Disconnected
- 看到：顶栏点色 + Companion 设备卡；Flashing 时进度 + 确认框
- 能做：Flash 前确认（高风险）；断连时重连
- 进入：检测/连接/烧录/断开（Mock 触发）
- 改 Artifact：烧录后写 Debug Evidence

### O4 Telemetry: Streaming / Idle
- 看到：Companion 传感器数值流更新（模拟）；串口行滚动
- 能做：发送串口命令 / 覆盖继电器
- 改 Artifact：遥测不写正式 artifact（证据采集后可选归档）

### O5 Artifact: Draft / Accepted / Validated / Stale / Error
- 看到：侧栏/卡片上的 artifact 状态点
- 语义：Draft=未确认；Accepted=已纳入；Validated=有验证证据；Stale=下游失效；Error=生成/验证失败
- 改 Artifact：本状态即 artifact 属性

---

## 4. 状态迁移图（Golden Journey 主线）

```
Home/Empty ──创建──▶ W1 PromptEditing ──开始──▶ W2 Analyzing ──模糊──▶ W3 ClarificationPending ──回答──┐
                                                                                                        ▼
    W7 CandidateReview ◀──Proceed── W4 ProposalReady ◀──完成（可能 W19 Partial）──────────────────────────┘
        │ Select MCU（Hardware artifact v1）
        ▼
    W8 MappingGenerating ──▶ W9 ConflictDetected ──▶(接受 AI 提案/带警告继续)──▶ W10 RulesValidated
        ▼
    W11 Generating ──▶ W4' 固件提案 ──Accept──▶ Firmware v2 Accepted ──▶ W12 Building ──▶ W13 BuildSucceeded
        │ Reject                                                          │              │
        ▼                                                                 ▼              ▼
    Firmware v1 + Warning                                          W14 BuildFailed ──▶ AI 诊断 ──▶ 修复提案 ──▶ W11/W12
                                                                       │
    任意上游修改 ──▶ W17 Stale ──Review Impact──▶ W18 Revalidating ──▶ Validated
```

**贯穿规则**
- AI 不静默覆盖：任何 AI 输出先到 Proposal（W4/W4'），用户决策后才写入 artifact（W5/W6）
- 上游变化必触发 Stale（W17），Stale 不删除下游，仅标记 + 拦截主操作
- 编译证据（W13/W14）是 Build artifact 的状态；失败也持久化（Error），可追溯
