# 夜间执行报告 — MCU Project Assistant M1 Golden Journey（S1–S10）

> 日期：2026-08-12（执行窗口 2026-08-11 13:10 → 2026-08-12 01:30 左右）
> 仓库：`C:\codex\mcu-project-assistant`（main）
> 授权：夜间执行计划（无进一步批准按序执行 S1–S10，12 票，每票全生命周期）

## 1. 状态

**COMPLETE — 12/12 票 resolved，全部门禁绿，唯一生产主路径，工作树干净。**
无 STOP 条件触发（无冻结文档矛盾、无新主产品决策需求、无架构冻结修订、无高风险不可逆操作、无安全边界失败）。
硬件缺失（无 arduino-cli / 无物理开发板）与真实 provider 不存在按计划不阻塞 → DETERMINISTIC 适配器 + 验收标注。

## 2. 票证表

| 票 | 切片 | 内容 | 状态 | 提交 | 验收 |
|---|---|---|---|---|---|
| ISSUE-001 | S1 | 项目创建/归档/刷新保留 | resolved | `62c6ca5` | ✅ |
| ISSUE-002 | S2 | 手动编辑 → 版本历史 | resolved | `a9b4d07` | ✅ |
| ISSUE-003 | S3A | 需求分析（流式/澄清/能力） | resolved | `951f743` | ✅ |
| ISSUE-004 | S3B | 提案决策/OutdatedProposal | resolved | `b4dd83f` | ✅ |
| ISSUE-005 | S4 | MCU 候选/约束/选芯 | resolved | `1e41952` | ✅ |
| ISSUE-006 | S5A | 引脚/冲突/规则校验 | resolved | `044b0b4` | ✅ |
| ISSUE-007 | S5B | Stale 三级/Revalidate | resolved | `1805f76` | ✅ |
| ISSUE-008 | S6 | 固件 Diff/真实文件 | resolved | `32efb4c` | ✅ |
| ISSUE-009 | S7 | 编译/历史/工具链 | resolved | `2891fe3` | ✅ |
| ISSUE-010 | S8 | 诊断/修复/重建 | resolved | `2471fd0` | DETERMINISTIC |
| ISSUE-011 | S9 | 烧录确认/串口 | resolved | `ebca0d1` `74df8ca` | DETERMINISTIC |
| ISSUE-012 | S10 | 硬化/旧目录清理 | resolved | `24aa555` `5aa7b86` | DETERMINISTIC |

## 3. Golden Journey — REAL vs DETERMINISTIC vs BLOCKED

| 阶段 | 模式 | 说明 |
|---|---|---|
| 创建项目 → 需求解析 → 提案 → 选芯 → 引脚 → 校验 → 固件 | **REAL** | 真实 HTTP API + SQLite + workspace 真实文件；AI 输出为服务端确定性 mock 适配器（AIProviderPort），数据路径全程真实 |
| 工具链检测 | **REAL** | 真实 `discoverToolchain`（本机无 arduino-cli → `unavailable`，UI banner + rescan 真实行为） |
| 构建（build/取消/记录） | **DETERMINISTIC** | mock compiler 适配器（CompilerPort 契约 + `.build/<id>.log` + BuildRecord 断言）；无 arduino-cli |
| 诊断/修复/重建 | **DETERMINISTIC** | mock AI 诊断（诊断卡 + build_fix 提案）+ 真实 line-diff 应用（三模型分离测试证明） |
| 设备检测/烧录确认/串口/断开 | **DETERMINISTIC** | companion-local 适配器（DevicePort 契约；60s 一次性令牌、L3 门禁、`.evidence/`、SSE 全真实） |
| 任何阶段 | **BLOCKED: 无** | 无真实硬件/LLM 依赖的阻塞项；剩余阻塞仅"真实 arduino-cli 硬件链"与"真实 LLM provider"（见 §10） |

## 4. 测试总数

- **304 unit/contract**（52 files）✅
- **18 e2e golden**（11 files）✅
- 门禁：`tsc --noEmit` 0 错误、`eslint src app/src tests` 0 问题、`npm run build`（typecheck + vite build）OK
- 安全组：flash-security 8 tests（一次性/过期/复用/设备绑定/无令牌/L3/中断无证据）全绿

## 5. DB 最终表（9 表，migrations v1→v8）

| 表 | 行数（本地验收数据） | 切片引入 |
|---|---|---|
| projects | 7 | S1 |
| artifacts | 10 | S2 |
| artifact_versions | 21 | S2 |
| proposals | 15 | S3B |
| validation_records | 0* | S5A |
| stale_marks | 8 | S5B |
| build_records | 0* | S7 |
| tasks | 4 | S3A |
| preferences | 1 | S9 |

\* 验收数据中无成功构建/规则校验记录（无 arduino-cli；功能由测试断言覆盖）。

## 6. Workspace 布局（真实文件）

```
workspace/
├── .evidence/session-*.log          # S9 烧录证据（成功才写；中断无半成品）
├── <projectId>/
│   ├── requirements/0001.json…      # 需求版本内容
│   ├── hardware/…                   # 硬件（MCU/外设）
│   ├── pinmap/…                     # 引脚映射
│   ├── wiring/…                     # 接线
│   └── firmware/0001..0003/
│       ├── src/main.cpp             # 真实固件文件（IO21 relay remap 后）
│       └── platformio.ini
└── （.build/ 由构建写入；本机无 arduino-cli 无记录）
```

## 7. Remaining Progressive Swap = 0

- 生产 UI 无内存 mock 执行路径：`app/mock/engine.ts` 仅存 UI 常量（TEMPLATES/DEFAULT_PROMPT/sleep）；无 try/catch 回退 mock、无隐式双路径（S10 全量核查 + 删除）。
- 服务端：AI/Compiler/Device 为**显式注入的 Port 适配器**（真实实现或测试 fixture），无 fallback。

## 8. V2 迁移结果

| 处置 | 对象 |
|---|---|
| REWRITTEN (TS) | firmware-generator、constraint-engine、classification、compatibility、pins、platforms、components 数据（V2 Python → TS，搬运测试 1:1 为验收门） |
| EXTRACTED | 依赖求值/Stale 语义（V2 无此能力，S5B 新建）、DevicePort/CompilerPort/EventPort 边界 |
| DELETED | gateway/（136）+ shared/（30）+ worker/（78）+ services/ + catalog/ + docker/ + trial-output/ + trial_run.py + verify-token.js + 旧设计预览 + ARCHITECTURE/DESIGN/DEPLOYMENT + pytest.ini + cd.yml = **282 文件**（删除前引用核查：零残留） |
| STILL RETAINED | 无（V2 工作树副本全删；冻结内容以 git 历史留存） |
| REUSED | 无运行时复用（全部 TS 重写；UI 参考契约冻结为 docs/rebuild/ 文档） |

## 9. 架构合规性

- 模块化单体（ADR-0003/0013）：`src/domain` + `src/application/capabilities` + `src/adapters` + `src/ports` + `src/infrastructure`；6 个 Port 全部有真实实现或测试适配器。
- 不变量（I-1/I-2/I-3/I-4/I-7/I-8/I-10/I-11 + D1/D2/D4/D5/D6）在能力层实现并由测试断言（proposal gate 无例外、版本不可变触发器、零效果拒绝、stale 传播不删除、未验证≠通过、L3 禁 flash、delete=archive、manual edit 触发 stale、级别按 impact 求值）。
- 表增长按切片（S1 projects → S9 preferences），9 表终态一致。
- CI 已更新为单体门禁形态（typecheck/lint/test/e2e:golden/build）。

## 10. 安全/保障

- **Safety Tier 0（Flash）**：一次性确认令牌（60s TTL、单次使用、设备绑定）→ 缺失/过期/复用/错设备/无令牌全拒；L3 Stale 门禁；设备断开中止（不留半成品证据）；AI/Companion/重试无绕过路径（测试 + 浏览器双证明）。
- 归档 = 令牌确认（D6 语义，复用同机制）。
- 服务器回环绑定（127.0.0.1）、无 device_sessions 表（会话运行时态）、证据进 workspace（.evidence/）。
- 本票未引入任何新业务能力（S10 声明）；无 shell 注入面（编译经 CompilerPort，任务 in-process）。

## 11. 剩余阻塞（非 STOP，按验收标注）

| 阻塞 | 影响 | 解除路径 |
|---|---|---|
| 无 arduino-cli / 物理硬件 | 构建/烧录为 DETERMINISTIC（mock/companion-local 适配器） | 安装 PlatformIO/arduino-cli + 接真实设备后重跑 e2e |
| 无真实 LLM provider | AI 输出为确定性 mock 适配器 | 实现真实 AIProviderPort（OpenAI/DeepSeek 等） |
| 会话内 UI state（刷新后需重走流程） | 既有设计（S1-S9 一致）；§12 断言的是 SQLite/workspace 持久化 | 后续里程碑可加 openProject 版本恢复 |

## 12. 按序提交（main）

```
62c6ca5 feat: implement project creation vertical slice (S1)
a9b4d07 feat: implement manual artifact version slice (S2)
951f743 feat: implement requirement analysis vertical slice (S3A)
b4dd83f feat: implement proposal decision flow (S3B)
1e41952 feat: implement mcu recommendation and selection (S4)
044b0b4 feat: implement pin map and wiring validation (S5A)
1805f76 feat: implement stale propagation and revalidate slice (S5B)
32efb4c feat: implement firmware proposal and diff slice (S6)
2891fe3 feat: implement build slice (S7)
2471fd0 feat: implement failure diagnosis and fix slice (S8)
253fb5e docs: commit frozen contract and ADR set (S1-S9 reference docs)
ebca0d1 feat: implement flash confirmation and serial slice (S9)
74df8ca docs: mark ISSUE-011 resolved with S9 delivery record
24aa555 chore: golden journey hardening and legacy cleanup (S10)
5aa7b86 docs: mark ISSUE-012 resolved with S10 delivery record
```

## 13. git status

`git status --short`：**空**（工作树干净）。数据/workspace 为 gitignore 运行时数据。
