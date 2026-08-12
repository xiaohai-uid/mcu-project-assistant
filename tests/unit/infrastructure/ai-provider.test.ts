import { describe, expect, it } from "vitest";
import {
  AiProviderConfigurationError,
  createAiProvider,
} from "@/src/infrastructure/ai-provider";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("AI provider composition", () => {
  it("keeps the checked-in environment template aligned with fail-closed production selection", () => {
    const template = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");

    expect(template).toContain("MCU_AI_PROVIDER=sensenova");
    expect(template).toContain("SENSENOVA_API_KEY=");
    expect(template).toContain("SENSENOVA_BASE_URL=https://token.sensenova.cn/v1");
    expect(template).toContain("SENSENOVA_CHAT_MODEL=deepseek-v4-flash");
    expect(template).toContain("MCU_AI_PROVIDER=zhipu");
    expect(template).toContain("MCU_ZHIPU_API_KEY=");
    expect(template).toContain("never silently falls back to mock");
    expect(template).not.toContain("OPENAI_API_KEY");
    expect(template).not.toContain("default AIProviderPort is the deterministic mock");
  });

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
    expect(
      createAiProvider({
        MCU_AI_PROVIDER: "zhipu",
        MCU_ZHIPU_API_KEY: "test-key",
        MCU_ZHIPU_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
        MCU_ZHIPU_CHAT_MODEL: "glm-4.5-flash",
      }).name,
    ).toBe("zhipu-glm");
  });

  it("rejects zhipu when the API key is missing", () => {
    expect(() =>
      createAiProvider({
        MCU_AI_PROVIDER: "zhipu",
        MCU_ZHIPU_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
        MCU_ZHIPU_CHAT_MODEL: "glm-4.5-flash",
      }),
    ).toThrow(/MCU_ZHIPU_API_KEY/i);
  });

  it("rejects zhipu when the base URL is missing", () => {
    expect(() =>
      createAiProvider({
        MCU_AI_PROVIDER: "zhipu",
        MCU_ZHIPU_API_KEY: "test-key",
        MCU_ZHIPU_CHAT_MODEL: "glm-4.5-flash",
      }),
    ).toThrow(/MCU_ZHIPU_BASE_URL/i);
  });

  it("rejects zhipu when the chat model is missing", () => {
    expect(() =>
      createAiProvider({
        MCU_AI_PROVIDER: "zhipu",
        MCU_ZHIPU_API_KEY: "test-key",
        MCU_ZHIPU_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
      }),
    ).toThrow(/MCU_ZHIPU_CHAT_MODEL/i);
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

  it("rejects malformed real-provider URLs without exposing credentials", () => {
    expect(() =>
      createAiProvider({
        MCU_AI_PROVIDER: "sensenova",
        SENSENOVA_API_KEY: "super-secret-test-key",
        SENSENOVA_BASE_URL: "not-a-url",
        SENSENOVA_CHAT_MODEL: "deepseek-v4-flash",
      }),
    ).toThrow(/SENSENOVA_BASE_URL/i);
    expect(() =>
      createAiProvider({
        MCU_AI_PROVIDER: "sensenova",
        SENSENOVA_API_KEY: "super-secret-test-key",
        SENSENOVA_BASE_URL: "not-a-url",
        SENSENOVA_CHAT_MODEL: "deepseek-v4-flash",
      }),
    ).not.toThrow(/super-secret-test-key/);
  });
});
