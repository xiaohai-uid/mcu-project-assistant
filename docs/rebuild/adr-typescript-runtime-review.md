# ADR Review — TypeScript/Node 20 全栈重写决策

> 日期：2026-08-11
> 状态：Review 完成 → 结论写入 ADR-0013
> 性质：**重大 Architecture Decision**——Implementation Spec 曾以"Mock UI 是 TS"为由默认全 TS；本评审按实际仓库证据决定，不机械接受任何倾向。
> 方法：Option A/B/C 正式比较（13 项标准），证据优先。

---

## 1. 候选方案

### Option A — 全 TypeScript 新核心
React/TS UI + Node/TS Application + TS Domain + TS Adapters；V2 Python 能力逐项移植（测试 1:1 搬运）。

### Option B — TypeScript UI + Python Core
TS UI；Python 保留 constraint engine / MCU knowledge / compiler tooling / engineering logic；经明确边界通信。

### Option C — TypeScript Product Core + Python Engineering Adapter
TS Domain/Application；成熟/高价值 Python 工程能力经 **Engineering Port** 以 Adapter/进程保留；证明值得后再逐步移植。

---

## 2. 比较（13 项标准）

| 标准 | A 全 TS | B TS UI + Python Core | C TS Core + Python Adapter |
|---|---|---|---|
| **单人+AI 长期维护成本** | 低（单一栈、单一类型系统、AI 单上下文） | 高（双栈持续维护） | 中高（核心 TS + 工程 Python 双栈；AI 需跨栈） |
| **类型契约漂移** | **消除**（UI↔核心共享 shared-contracts；无跨语言 seam） | 高（TS↔Python 全宽度 seam——旧工程反复踩的坑：requirement.py 与服务输出不一致、schema.sql 缺列、WEBSERACH typo） | 中（仅 Engineering Port 一个 seam；但该 seam 仍需要 JSON schema + 契约测试维护） |
| **调试复杂度** | 低（单进程） | 高（跨进程/跨语言） | 中（核心内单语言；工程能力跨进程） |
| **Windows 部署** | 低（单一 Node 运行时 + better-sqlite3 预编译） | 高（Node + Python 环境双安装/双升级） | 中高（同 B） |
| **Companion 集成** | 中（Companion 本为独立进程；设备工具均为 CLI：platformio/esptool/arduino-cli，语言无关） | 中（Python 近 esptool/pyserial） | 中（同 A；若 Companion 用 Python 则多一进程） |
| **Python MCU 生态价值** | 低（工具是 CLI，语言无关；pyserial 可用 Node serialport 替代） | 高（直接库级使用） | 中（仅工程能力部分） |
| **现有 V2 代码复用价值** | 中（纯逻辑模块可移植；**流程形态本就是 REWRITE/DELETE**） | 高（原样保留） | 高（原样保留） |
| **测试迁移成本** | 低（纯函数测试 1:1 搬运：constraint 150 行/platform 94 行/circuit 97 行等；断言不变） | 零（但保留双测试栈） | 低（核心部分搬运；工程部分保留） |
| **运行时复杂度** | 低（单进程单运行时） | 高 | 中 |
| **打包** | 低（单一产物） | 高（双运行时打包） | 中高 |
| **Local-first** | 优（单运行时离线；Local Core Offline Guarantee 更容易达成） | 中 | 中 |
| **Cloud deployment** | 优（同一 TS 核心直接部署） | 中（双运行时容器） | 中 |
| **未来插件能力** | 中（插件=TS 模块/进程，均可） | 中 | 优（工程插件可用 Python） |

---

## 3. 关键证据（仓库事实）

| 证据 | 事实 |
|---|---|
| E1 | V2 工程算法均为**小、纯、有测试**模块：constraints/engine.py（test 150 行）、platforms/registry.py（strapping 数据，test 94 行）、components（test 240 行）、shared/domain compatibility/pins/layout/classification（各有测试）。合计约 1-2k 行含测试——**移植 = 机械翻译，风险由 1:1 搬运测试兜底** |
| E2 | V2 中真正复杂/高风险的部分（firmware generator、arduino_cli adapter、stages/consumer、worker 拓扑）在 v2-contract-mapping 中已裁定 **REWRITE/DELETE**——Python 原样复用对它们**没有价值**（尤其 arduino_cli 被自家验收判定不可用，vault 2026-08-01） |
| E3 | 旧工程最昂贵的历史失败模式 = **跨语言契约漂移**：`shared/models/requirement.py` 与服务实际输出不一致；handlers 使用的列不在 schema.sql；`WEBSERACH` typo 无人发现。全 TS 从结构上消灭这一类 seam |
| E4 | 冻结 Mock UI 是 TS（React 19）；Progressive Swap 要求 UI 与后端共享行为契约——单一类型源（shared-contracts）让 swap 无类型摩擦 |
| E5 | Windows 桌面形态（P-8 零摩擦安装）：单一 Node 运行时 + better-sqlite3 预编译 = 最简单打包；双运行时 = 双安装/双升级 |
| E6 | 设备/编译工具均为 CLI（platformio、esptool、arduino-cli）：Adapter 语言与工具语言解耦；M1 无必须库级使用的 Python 依赖 |

## 4. 裁决

**选择 Option A（全 TypeScript 新核心）**，理由按证据：

1. **"重写已工作的工程算法"的收益 > 成本**：算法小、纯、有测试（E1）；成本 = 机械移植 + 搬运测试；收益 = 消灭 E3 这类最高历史成本故障类 + E4/E5 单一运行时。
2. **C 的"契约边界消灭耦合"论点成立，但代价是把旧工程的漂移 seam 原样搬到新位置**（Engineering Port 的 TS↔Python JSON 契约仍需 schema+测试维护）——本仓库的证据（E3）不支持再引入一个新的跨语言 seam。
3. **B 无优势**：双栈全宽度 seam，且 Python Core 承载的正是 E2 中已裁定 REWRITE 的部分。
4. **C 的合理内核被保留为逃生通道**：若某个移植模块无法通过等价性测试（搬运测试在 TS 不绿），**该模块单独退回 Python Engineering Adapter**（Engineering Port 届时才建）——A 是默认，C 是逐模块逃生，不是前提。

**风险与缓解**：
- 移植行为偏差 → 缓解：搬运测试 1:1 为移植验收门；逐模块过测试才进主路径（§20 迁移表规则）。
- 未来大型 Python 能力（如完整 Device Farm/调试器）→ 届时按证据决定是否建 Engineering Port（延后，不预建）。

**反对意见记录**：Option C 的维护者论点——"契约边界应该消灭耦合，而不是依靠单一语言"——在原则上正确；本裁决是仓库证据（E1/E3）对该原则的具体化：当待移植资产小且测试完备、且历史漂移成本已被证实时，单一语言是更便宜的耦合消灭方式。

---

## 5. 结论

- **Runtime 决策：Option A — TypeScript / Node 20 单运行时**（正式 ADR-0013）。
- 影响：migration-strategy（移植顺序按 TS 目标）、implementation-spec（技术栈硬约束）、v2-contract-mapping（纯逻辑模块 Action 标注 TS 移植 + 测试搬运）。
- 逃生通道：Engineering Port（Python Adapter）仅在**单个模块移植等价性失败**时按需建立，不预建。
