// ports/ai-provider.ts — AIProviderPort（ADR-0010；ISSUE-003 §3/§9）
// 端口能力 = streaming / cancellation / structured output（schema 约束）/ provider unavailable（显式错误）。
// 领域能力只依赖 Port + 提示/响应契约（结构 schema）；Mock 适配器贯穿开发与测试（State Lab 同源）。
// 真实 provider 适配器（openai-compatible/gemini）留待后续 Slice——本票只有 mock 适配器 + Port 接口。

export type ProviderStatus = "available" | "unavailable" | "offline";

export class ProviderUnavailableError extends Error {
  constructor(message = "AI provider is unavailable") {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export interface StreamTextRequest {
  prompt: string;
  /** 行为契约提示（如 lab 注入：slow/fail/partial/providerDown——仅开发 harness 使用） */
  hint?: Record<string, unknown>;
  onChunk: (chunk: string) => void;
  signal: AbortSignal;
}

export interface StructuredRequest {
  prompt: string;
  /** 领域契约 schema 名（结构化输出形状由 schema 保证） */
  schema: string;
  context?: Record<string, unknown>;
  signal: AbortSignal;
}

export interface AIProviderPort {
  status(): Promise<ProviderStatus>;
  /** 流式文本生成（可取消：signal.aborted 时抛 AbortError） */
  streamText(req: StreamTextRequest): Promise<void>;
  /** 结构化输出（schema 约束；provider 不可用抛 ProviderUnavailableError） */
  generateStructured<T>(req: StructuredRequest): Promise<{ data: T }>;
}
