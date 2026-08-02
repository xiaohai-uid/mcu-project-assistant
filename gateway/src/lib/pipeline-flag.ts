/**
 * V2 Pipeline Feature Flag
 *
 * Controls whether new design runs use the V2 Design Worker pipeline
 * or the legacy V1 stage microservices.
 *
 * Environment: PIPELINE_V2_ENABLED=true|false
 * Default: false (V1 remains default until acceptance passes)
 */

export function isPipelineV2Enabled(): boolean {
  return process.env.PIPELINE_V2_ENABLED === "true";
}

export function getPipelineMode(): "v1" | "v2" {
  return isPipelineV2Enabled() ? "v2" : "v1";
}
