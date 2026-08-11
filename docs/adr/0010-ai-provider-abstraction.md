# 0010 — AI Provider Abstraction: AI Provider Port

## Status

accepted

## Context

BYOK（P-10）、多 provider（Gemini/DeepSeek/OpenAI 兼容）、流式/取消/结构化输出（UI Frozen + application-contract）。领域能力（Requirement Analyzer / Firmware Generator / Diagnoser）不得依赖具体 SDK（指令 §十五）。旧 llm_client（OpenAI 兼容结构化输出 + 重试 + mock）是成熟资产（v2-contract-mapping REUSE）。

## Considered Options

- **AI Provider Port（chosen）**: 端口能力 = streaming / cancellation / structured output（schema 约束）/ BYOK / provider unavailable（显式事件）/ retry policy / tool invocation（预留）。领域能力只依赖 Port + 提示/响应契约（结构 schema）。适配器：OpenAI-compatible（DeepSeek/BYO）、Gemini、Mock。
- 直接依赖 OpenAI SDK: 锁死 provider、BYOK 受限、无法 mock 测试（QA-4）。
- 每能力各写客户端: 重复、不一致的降级/重试语义。

## Consequences

- Provider 可用性变化以 `provider.unavailable` 事件呈现（UI 已冻结该状态），降级显式。
- 结构化输出 schema 是领域契约的一部分（版本内容/提案 payload 的形状由 schema 保证——延续 llm_client 的 Pydantic 模式）。
- Mock 适配器贯穿开发与测试（State Lab 同源）。
- **Offline 边界（Local Core Offline Guarantee，architecture-drivers §3）**：断网时云端 LLM 允许进入 ProviderUnavailable（合法降级）；本地模型 Provider 未来可经同一 Port 接入，但**本地模型不是当前架构硬依赖**。
