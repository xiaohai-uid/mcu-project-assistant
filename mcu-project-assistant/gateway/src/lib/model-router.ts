import { Membership, ModelConfig, AiModel } from "./models";

const FREE_API_ENDPOINT =
  process.env.FREE_API_ENDPOINT || "https://api.deepseek.com/v1/chat/completions";
const FREE_API_MODEL = process.env.FREE_API_MODEL || "deepseek-chat";
const FREE_API_KEY = process.env.FREE_API_KEY || "";

const PREMIUM_API_ENDPOINT =
  process.env.PREMIUM_API_ENDPOINT || "https://api.openai.com/v1/chat/completions";
const PREMIUM_API_MODEL = process.env.PREMIUM_API_MODEL || "gpt-4o";
const PREMIUM_API_KEY = process.env.PREMIUM_API_KEY || "";

export function resolveModelConfig(
  membership: Membership,
  userApiKey?: string
): ModelConfig {
  if (membership === "subscription" || membership === "pay-as-you-go") {
    return {
      level: "premium_api" as AiModel,
      endpoint: PREMIUM_API_ENDPOINT,
      apiKey: PREMIUM_API_KEY,
      model: PREMIUM_API_MODEL,
    };
  }

  if (userApiKey) {
    return {
      level: "user_key" as AiModel,
      endpoint: FREE_API_ENDPOINT,
      apiKey: userApiKey,
      model: FREE_API_MODEL,
    };
  }

  return {
    level: "free_api" as AiModel,
    endpoint: FREE_API_ENDPOINT,
    apiKey: FREE_API_KEY,
    model: FREE_API_MODEL,
  };
}
