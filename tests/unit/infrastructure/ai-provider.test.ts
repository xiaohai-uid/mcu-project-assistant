import { describe, expect, it } from "vitest";
import {
  AiProviderConfigurationError,
  createAiProvider,
} from "@/src/infrastructure/ai-provider";

describe("AI provider composition", () => {
  it("rejects an unset provider instead of selecting mock", () => {
    expect(() => createAiProvider({})).toThrowError(AiProviderConfigurationError);
    expect(() => createAiProvider({})).toThrow(/MCU_AI_PROVIDER.*zhipu/i);
  });

  it("rejects an unknown provider instead of selecting mock", () => {
    expect(() => createAiProvider({ MCU_AI_PROVIDER: "invalid-provider" })).toThrowError(
      AiProviderConfigurationError,
    );
    expect(() => createAiProvider({ MCU_AI_PROVIDER: "invalid-provider" })).toThrow(/unsupported/i);
  });

  it("rejects mock when it is not an explicit production provider mode", () => {
    expect(() => createAiProvider({ MCU_AI_PROVIDER: "mock" })).toThrowError(AiProviderConfigurationError);
  });

  it("binds zhipu explicitly to the real GLM adapter", () => {
    expect(createAiProvider({ MCU_AI_PROVIDER: "zhipu", MCU_ZHIPU_API_KEY: "test-key" }).name).toBe("zhipu-glm");
  });
});
