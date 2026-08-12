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

  it("rejects SenseNova when the API key is missing", () => {
    expect(() =>
      createAiProvider({
        MCU_AI_PROVIDER: "sensenova",
        SENSENOVA_BASE_URL: "https://example.invalid/v1",
        SENSENOVA_CHAT_MODEL: "deepseek-v4-flash",
      }),
    ).toThrow(/SENSENOVA_API_KEY/i);
  });

  it("rejects SenseNova when the base URL is missing", () => {
    expect(() =>
      createAiProvider({
        MCU_AI_PROVIDER: "sensenova",
        SENSENOVA_API_KEY: "test-key",
        SENSENOVA_CHAT_MODEL: "deepseek-v4-flash",
      }),
    ).toThrow(/SENSENOVA_BASE_URL/i);
  });

  it("rejects SenseNova when the chat model is missing", () => {
    expect(() =>
      createAiProvider({
        MCU_AI_PROVIDER: "sensenova",
        SENSENOVA_API_KEY: "test-key",
        SENSENOVA_BASE_URL: "https://example.invalid/v1",
      }),
    ).toThrow(/SENSENOVA_CHAT_MODEL/i);
  });

  it("binds SenseNova explicitly to the real adapter", () => {
    expect(
      createAiProvider({
        MCU_AI_PROVIDER: "sensenova",
        SENSENOVA_API_KEY: "test-key",
        SENSENOVA_BASE_URL: "https://example.invalid/v1",
        SENSENOVA_CHAT_MODEL: "deepseek-v4-flash",
      }).name,
    ).toBe("sensenova");
  });
});
