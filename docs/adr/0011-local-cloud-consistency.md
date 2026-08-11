# 0011 — Local/Cloud Consistency Strategy: Same Core, Dual Adapters

## Status

accepted

## Context

Local-first + Cloud-enhanced（P-6/P-7）。双模式一致性承诺（architecture-blockers §4）：同一 Capability 在两种模式下语义一致（相同输入 → 相同事件序列 → 相同不变量）；差异只允许在传输/存储/Provider 可达性，且降级必须显式。

## Considered Options

- **Same core, dual adapters（chosen）**: Domain + Application 完全共享；Persistence/Task/AI/Events/Device 各有两个（或更多）适配器；无"本地分支逻辑"。
- 两套代码/两套语义: 违背承诺，测试面翻倍，行为漂移。
- 云为唯一真相、本地为缓存: 违背 Local-first（断网不可用）。

## Consequences

- Provider 不可用 / 离线等差异以显式事件呈现，不静默改变语义（UI 已冻结 Offline/ProviderUnavailable 状态）。
- 契约测试（capability 级）可在任一模式跑通即证明一致性。
- 云同步 = 内容搬运 + 元数据合并（ADR-0004/0005 的内容约定），不引入新语义。
