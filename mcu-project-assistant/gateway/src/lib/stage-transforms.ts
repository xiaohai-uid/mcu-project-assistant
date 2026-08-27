import type { CodegenInput, SchematicInput, RecommendationOutput, CodegenOutput, RequirementOutput } from "./stage-types";

export function flattenComponentTiers(tiers: Record<string, unknown[]>): unknown[] {
  return Object.values(tiers || {}).flat();
}

export function enrichRequirement(
  content: RequirementOutput,
  row: Record<string, unknown> | undefined
): Record<string, unknown> {
  return {
    ...content,
    modelConfig: (row?.model_config as Record<string, unknown>) || {},
  };
}

export function buildCodegenInput(
  content: RecommendationOutput,
  row: Record<string, unknown> | undefined
): CodegenInput {
  const r = row || {};
  const componentList = (content.componentList as { tiers: Record<string, unknown[]> }) || { tiers: {} };
  return {
    designDraftId: content.designDraftId,
    components: flattenComponentTiers(componentList.tiers),
    requirement: (r.requirement as Record<string, unknown>) || {},
    modelConfig: (r.model_config as Record<string, unknown>) || {},
    platform: (r.platform as string) || "arduino",
    pinMappings: [],
  };
}

export function buildSchematicInput(
  content: CodegenOutput,
  row: Record<string, unknown> | undefined
): SchematicInput {
  const r = row || {};
  const componentList = (r.component_list as { tiers: Record<string, unknown[]> }) || { tiers: {} };
  const pinMappings = (content.pinMappings as unknown[]) || [];
  return {
    designDraftId: content.designDraftId,
    components: flattenComponentTiers(componentList.tiers),
    platform: (r.platform as string) || "arduino",
    pinMappings,
  };
}
