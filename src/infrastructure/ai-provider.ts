// infrastructure/ai-provider.ts — production AI provider composition
import type { AIProviderPort } from "@/src/ports/ai-provider";
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
}

export function createAiProvider(env: AiProviderEnvironment = process.env): AIProviderPort {
  const provider = env.MCU_AI_PROVIDER?.trim();

  if (provider === "zhipu") {
    return createZhipuAiProvider({ apiKey: env.MCU_ZHIPU_API_KEY ?? "" });
  }

  if (!provider) {
    throw new AiProviderConfigurationError(
      'MCU_AI_PROVIDER must be explicitly set to "zhipu"; refusing to start with an implicit mock provider',
    );
  }

  throw new AiProviderConfigurationError(`Unsupported MCU_AI_PROVIDER "${provider}"; expected "zhipu"`);
}
