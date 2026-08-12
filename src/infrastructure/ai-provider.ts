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
  MCU_ZHIPU_BASE_URL?: string;
  MCU_ZHIPU_CHAT_MODEL?: string;
  SENSENOVA_API_KEY?: string;
  SENSENOVA_BASE_URL?: string;
  SENSENOVA_CHAT_MODEL?: string;
  SENSENOVA_TIMEOUT_MS?: string;
}

function requireUrl(value: string | undefined, name: string): string {
  const raw = value?.trim();
  if (!raw) throw new AiProviderConfigurationError(`${name} must be set`);
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") throw new Error("https required");
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new AiProviderConfigurationError(`${name} must be a valid https URL`);
  }
}

function requireValue(value: string | undefined, name: string): string {
  const raw = value?.trim();
  if (!raw) throw new AiProviderConfigurationError(`${name} must be set`);
  return raw;
}

function optionalTimeout(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new AiProviderConfigurationError(`${name} must be a positive number`);
  return parsed;
}

export function createAiProvider(env: AiProviderEnvironment = process.env): AIProviderPort {
  const provider = env.MCU_AI_PROVIDER?.trim();

  if (provider === "zhipu") {
    return createZhipuAiProvider({
      apiKey: requireValue(env.MCU_ZHIPU_API_KEY, "MCU_ZHIPU_API_KEY"),
      baseUrl: requireUrl(env.MCU_ZHIPU_BASE_URL, "MCU_ZHIPU_BASE_URL"),
      model: requireValue(env.MCU_ZHIPU_CHAT_MODEL, "MCU_ZHIPU_CHAT_MODEL"),
    });
  }

  if (provider === "sensenova") {
    const apiKey = requireValue(env.SENSENOVA_API_KEY, "SENSENOVA_API_KEY");
    const baseUrl = requireUrl(env.SENSENOVA_BASE_URL, "SENSENOVA_BASE_URL");
    const model = requireValue(env.SENSENOVA_CHAT_MODEL, "SENSENOVA_CHAT_MODEL");
    return createSenseNovaAiProvider({
      apiKey,
      baseUrl,
      model,
      timeoutMs: optionalTimeout(env.SENSENOVA_TIMEOUT_MS, "SENSENOVA_TIMEOUT_MS"),
    });
  }

  if (!provider) {
    throw new AiProviderConfigurationError(
      'MCU_AI_PROVIDER must be explicitly set to "zhipu" or "sensenova"; refusing to start with an implicit mock provider',
    );
  }

  throw new AiProviderConfigurationError(`Unsupported MCU_AI_PROVIDER "${provider}"; expected "zhipu" or "sensenova"`);
}
