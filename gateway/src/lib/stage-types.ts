export type StageName = "requirement" | "recommendation" | "codegen" | "schematic" | "websearch";

export interface RequirementOutput {
  designDraftId: string;
  requirement?: Record<string, unknown>;
}

export interface RecommendationOutput {
  designDraftId: string;
  componentList?: { tiers: Record<string, unknown[]> };
}

export interface CodegenOutput {
  designDraftId: string;
  code?: string;
  dependencies?: unknown[];
  pinMappings?: unknown[];
  validation?: Record<string, unknown>;
}

export interface SchematicOutput {
  designDraftId: string;
  svgContent?: string;
  pinTable?: unknown[];
  error?: string;
}

export interface WebsearchOutput {
  designDraftId: string;
  prices?: unknown[];
}

export interface RecommendationInput {
  designDraftId: string;
  modelConfig: Record<string, unknown>;
  requirement?: Record<string, unknown>;
  componentList?: unknown;
}

export interface CodegenInput {
  designDraftId: string;
  components: unknown[];
  requirement: Record<string, unknown>;
  modelConfig: Record<string, unknown>;
  platform: string;
  pinMappings: unknown[];
}

export interface SchematicInput {
  designDraftId: string;
  components: unknown[];
  platform: string;
  pinMappings: unknown[];
}

export interface PipelineMessage {
  designDraftId: string;
}
