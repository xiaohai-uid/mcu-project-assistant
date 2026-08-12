// infrastructure/ai-provider.ts — production AI provider composition
import type { AIProviderPort } from "@/src/ports/ai-provider";
import { createSenseNovaAiProvider } from "@/src/adapters/ai/sensenova";
import { createZhipuAiProvider } from "@/src/adapters/ai/zhipu-glm";

export class AiProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderConfigurationError";
  }
}

export interface AiProviderEnvironment {
  MCU_AI_PROVIDER?: string;
  MCU_ZHIPU_API_KEY?: string;
  SENSENOVA_API_KEY?: string;
  SENSENOVA_BASE_URL?: string;
  SENSENOVA_CHAT_MODEL?: string;
}

export function createAiProvider(env: AiProviderEnvironment = process.env): AIProviderPort {
  const provider = env.MCU_AI_PROVIDER?.trim();

  if (provider === "zhipu") {
    return createZhipuAiProvider({ apiKey: env.MCU_ZHIPU_API_KEY ?? "" });
  }

  if (provider === "sensenova") {
    const apiKey = env.SENSENOVA_API_KEY?.trim();
    const baseUrl = env.SENSENOVA_BASE_URL?.trim();
    const model = env.SENSENOVA_CHAT_MODEL?.trim();
    if (!apiKey) throw new AiProviderConfigurationError("SENSENOVA_API_KEY must be set for sensenova");
    if (!baseUrl) throw new AiProviderConfigurationError("SENSENOVA_BASE_URL must be set for sensenova");
    if (!model) throw new AiProviderConfigurationError("SENSENOVA_CHAT_MODEL must be set for sensenova");
    return createSenseNovaAiProvider({ apiKey, baseUrl, model });
  }

  if (!provider) {
    throw new AiProviderConfigurationError(
      'MCU_AI_PROVIDER must be explicitly set to "zhipu" or "sensenova"; refusing to start with an implicit mock provider',
    );
  }

  throw new AiProviderConfigurationError(`Unsupported MCU_AI_PROVIDER "${provider}"; expected "zhipu" or "sensenova"`);
}
