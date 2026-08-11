# 0012 — Migration Strategy: Extract Proven Capability, Not Old Architecture

## Status

accepted

## Context

V1（GitHub main 38f8c93）/ V2（本地 730a52d，7 提交未推送，冻结）→ 新产品。契约已裁定：算法/数据是资产，流程形态是负债（v2-contract-mapping REUSE/EXTRACT/REWRITE/DELETE）。迁移原则：**Extract proven capability, not old architecture**（指令 §十九）。

## Considered Options

- **Greenfield core + port proven algorithms（chosen）**: 新核心（Domain + Ports）按契约从零搭建；随后把已验证算法/数据（约束引擎、引脚逻辑、兼容性、平台/strapping 数据、编译适配器模式、acceptance 夹具、llm_client、货币聚合、加密、中间件栈）作为资产移植；不迁移任何流程形态（DesignSpec/Pipeline/Stage/Worker 拓扑/RabbitMQ 契约）。
- 在 V2 上增量改造: 继承坏基线（FakeRepository 默认、占位 API、未运行状态——vault 2026-08-01 判定）。
- 并行双轨长期共存: 无 Driver 支持（单产品）。

## Consequences

- 迁移资产清单 = v2-contract-mapping 的 REUSE/EXTRACT 集合；REWRITE 项按新契约重写；DELETE 项不进入。
- 迁移顺序（Architecture Review 通过后）：1) 新核心 + Persistence Port（SQLite）→ 2) 领域不变量测试 → 3) 移植约束/引脚/兼容算法 → 4) UI 从冻结 Mock 接入真实 Capability → 5) 编译适配器（ESP32 Golden Path）→ 6) 云适配器 → 7) 旧数据迁移（design_drafts 行 → Project/版本，仅当有用户数据）。
- V2 代码保持冻结（不删除不开发），直到新系统 Golden Journey 走通。
