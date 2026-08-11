# 0009 — Companion Boundary: Device Port Adapter

## Status

accepted

## Context

Companion 是产品能力（P-11）：toolchain discovery / board detection / build / flash / serial / local device evidence。UI Frozen 已验证其边界（检测/烧录确认/串口遥测）。风险：Companion 逐渐变成"第二个 Backend"（指令 §十四）。

## Considered Options

- **Device Port Adapter（chosen）**: Companion 只实现 Device Port（detect/build/flash/serial/evidence capture）；无领域状态、无产品状态、无提案决策；证据经事件流入应用层持久化。
- Companion 持有项目状态: 违背 P-7（真相源唯一）、制造双写。
- 无边界直接集成: 耦合设备细节进领域。

## Consequences

- Companion 适配器可替换（Mock 适配器用于开发/测试/CI）。
- 高风险操作（flash）经应用层确认令牌 → Device Port 执行（I-8）。
- 证据（遥测/日志）由应用层决定持久化（DebugEvidence artifact），Companion 只负责采集与流式输出。
