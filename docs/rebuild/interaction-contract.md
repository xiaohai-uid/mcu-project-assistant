# Interaction Contract — Golden Journey

> 日期：2026-08-11
> 状态：Draft（Contract Review 后 Frozen）
> 方法：完全从 UI Frozen 反推。每个用户动作定义 10 个字段。
> **本文件只表达产品行为。禁止出现 SQL / Queue / Express route / Postgres schema / RabbitMQ routing key。**
> 前置事实：product-decisions.md（Revalidate 语义 / Rebuild 版本语义 / Stale 三级）

字段说明：
- **User Action** — 用户在 UI 上做的一件事
- **Current State** — 动作发生时允许的（典型）状态
- **Allowed?** — 该状态下是否允许此动作
- **Required Input** — 用户/系统必须提供什么
- **Immediate UI Result** — 点击后立刻看到的
- **Async Result** — 异步完成后看到的
- **Possible Failure** — 可能失败的方式与呈现
- **Next State** — 成功后进入的状态
- **Artifact Effect** — 对正式工程资产的影响（版本/状态）
- **Requires Confirmation?** — 是否需要确认对话框

---

## A. 项目层

### A1. Create Project
| 字段 | 内容 |
|---|---|
| User Action | 创建项目（空白 / 从模板） |
| Current State | Home（空或项目列表） |
| Allowed? | 总是允许 |
| Required Input | 名称（空白时用默认名）；模板可选 |
| Immediate UI Result | 进入工作区（Requirements 视图），空态 |
| Async Result | 无（同步创建） |
| Possible Failure | 名称非法（长度/字符）→ 内联校验提示 |
| Next State | Workspace / Requirements（Idle） |
| Artifact Effect | 创建空 Project；无 artifact 版本 |
| Requires Confirmation? | 否（删除才需要确认） |

### A2. Open Project / 打开项目
| 字段 | 内容 |
|---|---|
| User Action | 从 Home 项目卡打开工作区 |
| Current State | Home |
| Allowed? | 总是允许（项目存在） |
| Required Input | 项目 id |
| Immediate UI Result | 骨架加载 → 工作区恢复上次视图（尽量保持 Project Context） |
| Async Result | artifact 状态加载完成 |
| Possible Failure | 项目不存在/无权限 → 错误提示返回 Home |
| Next State | Workspace（上次 sidebar 或 Requirements） |
| Artifact Effect | 无（只读加载） |
| Requires Confirmation? | 否 |

### A3. Delete Project / 归档项目
| 字段 | 内容 |
|---|---|
| User Action | 删除项目 |
| Current State | Home 项目卡 |
| Allowed? | 总是允许 |
| Required Input | 项目 id |
| Immediate UI Result | 确认对话框（高风险）+ **Impact 展示**（将归档的版本/记录数量） |
| Async Result | 项目标记为归档/退役（移出活跃列表）；**不静默级联物理删除**（Decision 6） |
| Possible Failure | 无（Mock 中同步） |
| Next State | Home（列表刷新，归档项从活跃列表移除） |
| Artifact Effect | 项目与内容 Archive/Retire；Proposal/Build/Validation 历史默认保留；物理清除属 retention policy（延后） |
| Requires Confirmation? | **是**（删除确认 + Impact 展示） |

---

## B. Requirement Discovery

### B1. Analyze Requirement
| 字段 | 内容 |
|---|---|
| User Action | 输入描述 → 开始需求解析 |
| Current State | Requirements / Idle 或 ProposalReady |
| Allowed? | 描述非空；在线；Provider 可用；requirements 未处于 Analyzing |
| Required Input | 自然语言描述 |
| Immediate UI Result | 按钮转 Analyzing（spinner）；流式输出区出现；可取消 |
| Async Result | 能力卡逐个出现 → 澄清（若有缺口）或提案就绪 |
| Possible Failure | Provider 不可用/超时 → 错误横幅 + 重试；离线 → 解析禁用（提示）；取消 → "已取消" |
| Next State | Clarifying（有缺口）或 ProposalReady（无缺口） |
| Artifact Effect | 无（分析结果未接受前不写入） |
| Requires Confirmation? | 否 |

### B2. Cancel Analysis
| 字段 | 内容 |
|---|---|
| User Action | 分析中点击取消 |
| Current State | Analyzing |
| Allowed? | 仅 Analyzing 中 |
| Required Input | 无 |
| Immediate UI Result | "已取消"提示；部分结果保留展示 |
| Async Result | 分析终止，无写入 |
| Possible Failure | 无 |
| Next State | Cancelled（可重新开始） |
| Artifact Effect | 无（取消不写入） |
| Requires Confirmation? | 否 |

### B3. Retry Analysis
| 字段 | 内容 |
|---|---|
| User Action | 失败后点击重试 |
| Current State | Error |
| Allowed? | 描述仍有效；Provider 可用 |
| Required Input | 无（沿用描述）或修改后描述 |
| Immediate UI Result | 回到 Analyzing |
| Async Result | 同 B1 |
| Possible Failure | 再次失败 → 错误横幅保留 |
| Next State | Clarifying / ProposalReady / Error |
| Artifact Effect | 无 |
| Requires Confirmation? | 否 |

### B4. Submit Clarification
| 字段 | 内容 |
|---|---|
| User Action | 澄清卡中回答问题并提交（或跳过=默认规格） |
| Current State | Clarifying |
| Allowed? | 澄清存在（**可多轮**，Decision 7：回答后可能再次出现澄清） |
| Required Input | 回答文本（或跳过）；roundId 标识当前轮 |
| Immediate UI Result | 回到 Analyzing（续跑）；"正在最终化需求…" |
| Async Result | 能力卡更新（pending→complete）→ 提案就绪；或**再次进入 Clarifying**（多轮） |
| Possible Failure | Provider 失败 → 错误横幅 |
| Next State | ProposalReady（或再次 Clarifying） |
| Artifact Effect | 无（尚未写入） |
| Requires Confirmation? | 否（跳过需轻提示"将使用默认规格"） |

---

## C. Proposal

### C1. Accept Proposal
| 字段 | 内容 |
|---|---|
| User Action | 提案卡点击"接受"（需求提案 / 固件 Diff 提案通用） |
| Current State | ProposalReady |
| Allowed? | 提案 pending 或 rejected（可改主意） |
| Required Input | 无 |
| Immediate UI Result | 提案徽标转"已接受"；Copilot 记录决策 |
| Async Result | 无（同步） |
| Possible Failure | 无 |
| Next State | Accepted（可继续推进 / 可撤销） |
| Artifact Effect | **进入下一步时才写入**：Accepted 提案内容 → Requirements artifact vN+1（需求提案）；固件提案接受 → Firmware vN+1 + Pin Map/Wiring 联动 |
| Requires Confirmation? | 否 |

### C2. Reject Proposal
| 字段 | 内容 |
|---|---|
| User Action | 提案卡点击"拒绝" |
| Current State | ProposalReady |
| Allowed? | 提案 pending 或 accepted（可改主意） |
| Required Input | 无 |
| Immediate UI Result | 徽标转"已拒绝"（灰化）；Copilot 记录 |
| Async Result | 无 |
| Possible Failure | 无 |
| Next State | Rejected（可重新接受） |
| Artifact Effect | **无任何 artifact 变化**（Proposal ≠ Version；拒绝不改正式资产） |
| Requires Confirmation? | 否 |

---

## D. Hardware

### D1. Select MCU
| 字段 | 内容 |
|---|---|
| User Action | 候选矩阵中选中一个 MCU |
| Current State | Hardware / CandidateReview |
| Allowed? | 始终（候选列表就绪） |
| Required Input | 无（点击选择） |
| Immediate UI Result | 卡片高亮"已选目标"；外设映射更新（如引脚前缀变化） |
| Async Result | 无；若此前已有下游 artifact → 立即级联 Stale（横幅 + 侧栏点，级别由 impact 求值，Decision 5） |
| Possible Failure | 无 |
| Next State | Selected（可进入引脚接线） |
| Artifact Effect | 首次选择 → Hardware artifact v1（Accepted）；更换 → 新版本 + 下游 Stale（MCU 变化属 Blocking 类，Decision 5） |
| Requires Confirmation? | 否（但更换时明确展示 Stale 后果提示） |

### D4. Edit Pin（手动编辑，Decision 4）
| 字段 | 内容 |
|---|---|
| User Action | 引脚矩阵中直接修改引脚号（所有者手动编辑） |
| Current State | Wiring / Review（任意） |
| Allowed? | **始终允许（免 Proposal）**——Proposal Gate 只约束 AI/自动化（Decision 4） |
| Required Input | 新引脚号 |
| Immediate UI Result | 引脚表更新；Pin Map 版本徽标 +1 |
| Async Result | **Dependency Evaluation**：若影响下游（Wiring/Firmware/Build）→ 按 Decision 5 传播 Stale |
| Possible Failure | 引脚冲突/非法 → 内联提示（仍可保存为 Warning 版本） |
| Next State | Pin Map 新版本（Accepted/Warning）；下游可能 Stale |
| Artifact Effect | **直接产生新 ArtifactVersion（免提案）**；触发依赖求值 |
| Requires Confirmation? | 否（但 Stale 后果在保存后展示） |

### D2. Generate Pin Map（配置引脚接线）
| 字段 | 内容 |
|---|---|
| User Action | 点击"配置引脚接线" |
| Current State | Hardware / Selected |
| Allowed? | 已选 MCU；下游无 Blocking Stale 未处理 |
| Required Input | 无（基于已接受需求 + MCU 自动分配） |
| Immediate UI Result | Wiring 视图加载态"正在自动分配引脚…" |
| Async Result | 引脚表 + 布局图出现；若检测到冲突 → 冲突卡（如 IO12 strapping） |
| Possible Failure | 约束不可满足（无可用引脚）→ 错误 + 建议换 MCU/外设 |
| Next State | Wiring / Review（带警告）或 Validated（无警告） |
| Artifact Effect | Pin Map artifact v1（无冲突=Accepted；有冲突=Warning） |
| Requires Confirmation? | 否 |

### D3. Validate Constraints（校验电气规则）
| 字段 | 内容 |
|---|---|
| User Action | 点击"校验电气规则" |
| Current State | Wiring / Review |
| Allowed? | 引脚已生成；非 Stale |
| Required Input | 无 |
| Immediate UI Result | "正在校验…" |
| Async Result | 规则结果：全部通过（绿徽标）/ 发现问题（冲突卡保留） |
| Possible Failure | 规则引擎不可用 → 校验失败提示（不误报成功） |
| Next State | RulesValidated（或 Warning 保留） |
| Artifact Effect | ValidationRecord 写入（该 Pin Map/Wiring 版本的验证证据）；Wiring artifact Validated/Warning |
| Requires Confirmation? | 否 |

---

## E. Firmware

### E1. Generate Firmware
| 字段 | 内容 |
|---|---|
| User Action | 点击"生成固件代码" |
| Current State | Wiring / RulesValidated 或带警告 |
| Allowed? | 下游非 Blocking Stale |
| Required Input | 无 |
| Immediate UI Result | Firmware 视图"正在生成固件…" |
| Async Result | 代码展示 + **Proposal Diff**（如引脚重映射）或直接就绪 |
| Possible Failure | Provider 失败 → 错误 + 重试 |
| Next State | Firmware / Proposal（有语义变化）或 Accepted 直达（无变化） |
| Artifact Effect | 无（提案未接受不写版本） |
| Requires Confirmation? | 否 |

### E2. Accept Firmware Diff
| 字段 | 内容 |
|---|---|
| User Action | Diff 提案点"接受更改" |
| Current State | Firmware / Proposal |
| Allowed? | 提案 pending |
| Required Input | 无 |
| Immediate UI Result | 版本徽标更新；代码切换为新版本；Pin Map/Wiring 联动 |
| Async Result | 无 |
| Possible Failure | 无 |
| Next State | Firmware / Accepted |
| Artifact Effect | Firmware vN+1（Accepted）+ Pin Map vN+1 + Wiring 更新（联动传播） |
| Requires Confirmation? | 否 |

### E3. Reject Firmware Diff
| 字段 | 内容 |
|---|---|
| User Action | Diff 提案点"拒绝" |
| Current State | Firmware / Proposal |
| Allowed? | 提案 pending |
| Required Input | 无 |
| Immediate UI Result | "已拒绝"；代码保留旧版本；风险提示（如 strapping 风险仍在） |
| Async Result | 无 |
| Possible Failure | 无 |
| Next State | Firmware / Rejected（可重生成/重新接受） |
| Artifact Effect | 无内容变化；Firmware 保留 vN（Warning 状态，风险已知） |
| Requires Confirmation? | 否（拒绝本身不确认；风险后果在 UI 中说明） |

---

## F. Build / Diagnosis

### F1. Build
| 字段 | 内容 |
|---|---|
| User Action | 点击"编译"（或"编译并烧录"） |
| Current State | Build / Idle |
| Allowed? | 工具链可用；Firmware 已接受且非 Blocking Stale |
| Required Input | 无 |
| Immediate UI Result | 日志逐行输出（CMake→编译→链接→镜像）；可取消 |
| Async Result | 成功徽标 / 失败徽标 + 错误日志 |
| Possible Failure | 编译失败（缺库/语法）→ BUILD FAILED + 诊断入口；工具链缺失 → 编译禁用 + 警告条 |
| Next State | BuildSucceeded / BuildFailed |
| Artifact Effect | BuildRecord 追加（该 Firmware Version 的一次验证执行）；成功 → Validation 证据；失败 → Error 记录。**不产生新 Firmware Version**（Decision 2） |
| Requires Confirmation? | 否 |

### F2. Cancel Build
| 字段 | 内容 |
|---|---|
| User Action | 构建中点取消 |
| Current State | Building |
| Allowed? | 仅 Building 中 |
| Required Input | 无 |
| Immediate UI Result | "编译已取消" |
| Async Result | 终止；无写入 |
| Possible Failure | 无 |
| Next State | Cancelled（可重编译） |
| Artifact Effect | 无 |
| Requires Confirmation? | 否 |

### F3. Diagnose Failure
| 字段 | 内容 |
|---|---|
| User Action | 失败后点"让 Copilot 诊断" |
| Current State | BuildFailed |
| Allowed? | 有失败 BuildRecord；Provider 可用 |
| Required Input | 无（自动带失败日志与上下文） |
| Immediate UI Result | "正在诊断…" |
| Async Result | 诊断卡：原因 + 建议 + **Fix Proposal（Diff）** |
| Possible Failure | Provider 不可用 → 诊断失败（保留手动修复路径） |
| Next State | Diagnosed（提案待决策） |
| Artifact Effect | 无（诊断不改资产） |
| Requires Confirmation? | 否 |

### F4. Accept Fix Proposal
| 字段 | 内容 |
|---|---|
| User Action | 诊断卡点"应用修复（提案）" |
| Current State | Diagnosed |
| Allowed? | 提案存在且 pending |
| Required Input | 无 |
| Immediate UI Result | "修复已应用"提示；代码/配置更新 |
| Async Result | 无 |
| Possible Failure | 无 |
| Next State | 待重建（Build / Idle） |
| Artifact Effect | Firmware（或依赖配置）**新版本** vN+1（内容变化） |
| Requires Confirmation? | 否 |

### F5. Rebuild
| 字段 | 内容 |
|---|---|
| User Action | 点"重新编译" |
| Current State | BuildFailed / Diagnosed / Cancelled / 任意 Build 后 |
| Allowed? | 工具链可用；Firmware 非 Blocking Stale |
| Required Input | 无 |
| Immediate UI Result | 同 F1 |
| Async Result | 同 F1 |
| Possible Failure | 同 F1 |
| Next State | BuildSucceeded / BuildFailed |
| Artifact Effect | 同 F1：新 BuildRecord（**同一 Version 可多次 Build**，Decision 2） |
| Requires Confirmation? | 否 |

---

## G. Stale / Revalidate

### G1. Revalidate（含 Revalidate All）
| 字段 | 内容 |
|---|---|
| User Action | Stale 横幅/视图点"重新验证" |
| Current State | 存在 L2/L3 Stale |
| Allowed? | 有 Stale 下游 |
| Required Input | 无 |
| Immediate UI Result | "正在重新验证…"逐项进度 |
| Async Result | 逐项结果：**无语义变化 → Validated；有语义变化 → 新 ProposalReady**（Decision 1） |
| Possible Failure | 重新计算失败 → 该项 Error（可重试） |
| Next State | 全部 Validated / 部分 ProposalReady |
| Artifact Effect | 无语义变化 → 下游版本状态转 Validated（可保留版本号或标记）；有语义变化 → 新版本待决策 |
| Requires Confirmation? | 否（但产生新 Proposal 时等待决策，不自动接受） |

### G2. 查看 Stale 内容 / Diff
| 字段 | 内容 |
|---|---|
| User Action | 在 Stale 状态下浏览旧内容、查看 Diff |
| Current State | 任意 Stale 级别 |
| Allowed? | **始终允许**（L3 也不阻止查看） |
| Required Input | 无 |
| Immediate UI Result | 旧版本内容展示 + Stale 徽标 |
| Async Result | 无 |
| Possible Failure | 无 |
| Next State | 不变 |
| Artifact Effect | 无 |
| Requires Confirmation? | 否 |

---

## H. Device / Companion

### H1. Detect Board
| 字段 | 内容 |
|---|---|
| User Action | Companion/Settings 点"检测开发板" |
| Current State | Companion / none 或 disconnected |
| Allowed? | Companion 可用 |
| Required Input | 无 |
| Immediate UI Result | "正在检测…" |
| Async Result | 板卡信息（型号/COM 口/波特率）→ Connected |
| Possible Failure | 未连接/驱动问题 → 保持 disconnected + 提示 |
| Next State | Connected |
| Artifact Effect | 无（DeviceSession 建立；Debug Evidence 待烧录后） |
| Requires Confirmation? | 否 |

### H2. Flash
| 字段 | 内容 |
|---|---|
| User Action | 点"烧录"（Build/Companion/侧栏入口） |
| Current State | Device Connected；Firmware 已接受且非 Blocking Stale |
| Allowed? | 见 Current State；**L3 Stale 时禁止**（Decision 3） |
| Required Input | 无 |
| Immediate UI Result | **确认对话框**（设备/风险说明） |
| Async Result | 烧录进度 → 完成 → 串口打开；Debug Evidence 写入 |
| Possible Failure | 设备断开 → 烧录中止 + 提示；校验失败 → 拒绝烧录 |
| Next State | Flashing → Connected + Serial |
| Artifact Effect | Debug Evidence artifact 版本写入（烧录证据） |
| Requires Confirmation? | **是**（高风险确认） |

### H3. Device Disconnect
| 字段 | 内容 |
|---|---|
| User Action | 设备断开（主动或意外） |
| Current State | Connected / Flashing |
| Allowed? | 任意 |
| Required Input | 无 |
| Immediate UI Result | 顶栏红点"MCU: 未连接"；Companion/Build 设备空态 |
| Async Result | 烧录中则中止（不写半成品证据） |
| Possible Failure | 无 |
| Next State | Disconnected |
| Artifact Effect | 无（进行中的 Flash 无证据写入） |
| Requires Confirmation? | 否 |

---

## 约束声明

1. 本表只描述产品行为；任何动作的"实现"（存储/传输/路由）在 Application Contract 之后决定。
2. 所有异步动作均支持：进度呈现（流式/日志/进度条）、失败呈现（错误横幅/徽标）、取消（长任务）。
3. AI 产生的内容一律先到 Proposal；Proposal 决策后才有 Artifact 效果（Accept 才写版本，Reject 零效果）。
4. 高风险动作（Flash、Delete Project）必须确认；其余不确认。
5. Stale 按三级模型（product-decisions.md Decision 3）：L1 信息级 / L2 需验证（关键动作前提示）/ L3 阻塞（禁 Flash、禁标 Validation 成功、禁宣称 Validated；不阻查看/Diff/修复/Revalidate）。
