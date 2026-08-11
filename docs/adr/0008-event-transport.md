# 0008 — Event Transport: SSE + HTTP Commands

## Status

accepted

## Context

Logical Events 已冻结（30+ 事件，传输无关）。UI 需要实时呈现：AI streaming、build logs、progress、stale updates（P-13/QA-8）。不为"一套技术统一"强行 WebSocket 化（指令 §十三）。

## Considered Options

- **SSE for server→client events + HTTP POST for commands（chosen）**: 单向事件流用 SSE（断线重连天然、实现简单）；命令保持请求-响应；高频流（build.output/serial）在应用层合并（背压规则）。
- WebSocket 全量: 双向通道但需自建重连/心跳/协议；命令仍要请求-响应语义——无收益。
- Polling 为主: 违背实时呈现要求（流式 AI 无法轮询表达）。

## Consequences

- 逻辑事件经 Event Transport Port 发布；Web UI 适配器 = SSE；本地模式同进程直发；云模式经桥（部署适配器）。
- 轮询仅作兜底（断线重连间隙）。
- Companion ↔ 本地服务的传输在实现期选择（本地 HTTP/WS），不影响本决策。
