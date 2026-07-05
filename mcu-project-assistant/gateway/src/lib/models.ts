export type Membership = "free" | "hasKey" | "subscription" | "pay-as-you-go";
export type AiModel = "free_api" | "user_key" | "premium_api";
export type ExperienceLevel = "beginner" | "professional";
export type Platform = "arduino" | "esp32" | "stm32";
export type DraftStatus =
  | "analyzing"
  | "recommending"
  | "generating"
  | "ready"
  | "stale"
  | "failed";

export interface ModelConfig {
  level: AiModel;
  endpoint: string;
  apiKey?: string;
  model: string;
}

export interface RequestContext {
  designDraftId: string;
  userId: string;
  membership: Membership;
  experienceLevel: ExperienceLevel;
  modelConfig: ModelConfig;
}
