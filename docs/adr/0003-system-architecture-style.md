# 0003 — System Architecture Style: Modular Monolith + Explicit Ports

## Status

accepted

## Context

产品契约（CONTRACT FROZEN）要求：Local-first（断网完整可用）、单一所有者、审计可追溯、可测试、可演进（STM32/云同步/多 provider 预留）。旧工程是"网关 + 5 微服务 + RabbitMQ 管道"形态，已被契约判定为错误抽象方向（管道/阶段被删除）。Quality Attributes 三层（architecture-drivers §2）：**Tier 0 不可牺牲** = Reliability / Determinism / Security-Safety；**Tier 1 产品核心** = Offline / Auditability / Recoverability / Testability；**Tier 2 优化** = Evolvability / Performance / Cost。

## Considered Options

- **Modular Monolith + Explicit Ports（chosen）**: 单一可执行系统，分层 UI → Application → Domain → Ports → Adapters；外部依赖全部经 Port 隔离。
- 微服务拆分: 无 Product Driver 支持（单所有者、本地优先、无扩展需求）；引入部署/运维复杂度。
- Event Sourcing / CQRS / Actor: 无 Driver 证明必要（审计由版本+事件留痕满足，不需要事件源重放）。

## Consequences

- Domain 与 Application 不依赖任何外部实现（可完全离线测试）。
- Ports/Adapters 使双模式（Local/Cloud）与多 provider 成为适配器选择，而非架构改动。
- 禁止重新引入线性 Pipeline 抽象（ArtifactPipeline/WorkflowStage 等一律不建）。
