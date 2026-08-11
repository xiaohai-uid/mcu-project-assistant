# 0013 — Runtime: TypeScript / Node 20 Single Runtime (Full-Stack)

## Status

accepted

## Context

Implementation Spec 需要确定运行时语言。冻结 Mock UI 是 TypeScript（React 19）。候选：A 全 TS、B TS UI + Python Core、C TS Core + Python Engineering Adapter。完整比较见 `docs/rebuild/adr-typescript-runtime-review.md`（13 项标准 + 6 条仓库证据）。

关键证据：V2 工程算法均为小纯模块且测试完备（1:1 可搬运）；V2 复杂部分已裁定 REWRITE/DELETE（Python 原样复用无价值）；旧工程最高成本故障类 = 跨语言契约漂移；设备/编译工具均为 CLI（语言无关）；Windows 单运行时打包最简单。

## Considered Options

- **Option A — All TypeScript（chosen）**: React/TS UI + Node/TS Application + TS Domain + TS Adapters；V2 纯逻辑模块 TS 移植，测试 1:1 搬运为验收门。
- Option B — TS UI + Python Core: 全宽度跨语言 seam，且 Python Core 承载的多为已裁定 REWRITE 的部分。
- Option C — TS Core + Python Engineering Adapter: 原则正确，但把旧工程的漂移 seam 移到 Engineering Port（仍需 JSON schema + 契约测试）；待移植资产小且测试完备时，单一语言是更便宜的耦合消灭方式。

## Consequences

- 单一类型源：UI ↔ 核心共享 `shared-contracts`（消灭 TS/Python 双写漂移类故障）。
- 单一运行时：Windows 打包/安装最简单（P-8）；Local-first 离线运行最简单。
- **逃生通道（非前提）**：若某移植模块无法通过等价性测试（搬运测试在 TS 不绿），该模块单独退回 Python Engineering Adapter（Engineering Port 届时按需建立）；默认全 TS。
- 设备/编译工具经 CLI 调用（platformio/esptool/arduino-cli），Adapter 语言与工具语言解耦。
- 每个移植模块的 Required tests（v2-contract-mapping）为验收门，逐项过测试才进主路径。
