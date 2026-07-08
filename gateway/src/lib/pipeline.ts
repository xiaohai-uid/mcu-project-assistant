import { z } from "zod";
import type { StageHandler } from "./stage-handler";

export interface StageDefinition {
  input: string;
  output: string;
  handler: StageHandler;
  messageIn: z.ZodType;
  messageOut: z.ZodType;
}

export interface PipelineResult<T extends Record<string, StageDefinition>> {
  readonly stages: (keyof T & string)[];
  readonly allQueues: string[];
  getDownstream(stage: keyof T & string): (keyof T & string)[];
  handlerFor(queue: string): StageHandler | undefined;
  handlerEntries(): [string, StageHandler][];
}

export function definePipeline<T extends Record<string, StageDefinition>>(
  definition: T
): PipelineResult<T> {
  const stages = Object.keys(definition) as (keyof T & string)[];
  const allQueues: string[] = [];
  const queueToStage = new Map<string, keyof T>();

  for (const [stage, def] of Object.entries(definition)) {
    const inResult = def.messageIn.safeParse({ designDraftId: "00000000-0000-0000-0000-000000000000" });
    if (!inResult.success) throw new Error(`Stage "${stage}": messageIn schema must accept { designDraftId: uuid }`);
    const outResult = def.messageOut.safeParse({ designDraftId: "00000000-0000-0000-0000-000000000000" });
    if (!outResult.success) throw new Error(`Stage "${stage}": messageOut schema must accept { designDraftId: uuid }`);
    allQueues.push(def.input, def.output);
    queueToStage.set(def.output, stage);
  }

  const uniqueQueues = new Set(allQueues);
  if (uniqueQueues.size !== allQueues.length) {
    throw new Error("Duplicate queue names in pipeline definition");
  }

  return {
    stages,
    allQueues,
    getDownstream(stage: keyof T & string): (keyof T & string)[] {
      const idx = stages.indexOf(stage);
      if (idx === -1) return [];
      return stages.slice(idx + 1);
    },
    handlerFor(queue: string): StageHandler | undefined {
      const stage = queueToStage.get(queue);
      if (!stage) return undefined;
      return definition[stage as string].handler;
    },
    handlerEntries(): [string, StageHandler][] {
      return stages.map((stage) => [
        definition[stage as string].output,
        definition[stage as string].handler,
      ]);
    },
  };
}

export type PipelineStage = "requirement" | "recommendation" | "codegen" | "schematic" | "websearch";
export const PIPELINE_STAGES: readonly PipelineStage[] = [
  "requirement",
  "recommendation",
  "codegen",
  "schematic",
  "websearch",
] as const;

export const QUEUE_NAMES = {
  REQUIREMENT_INPUT: "requirement.input",
  REQUIREMENT_OUTPUT: "requirement.output",
  RECOMMENDATION_INPUT: "recommendation.input",
  RECOMMENDATION_OUTPUT: "recommendation.output",
  CODEGEN_INPUT: "codegen.input",
  CODEGEN_OUTPUT: "codegen.output",
  SCHEMATIC_INPUT: "schematic.input",
  SCHEMATIC_OUTPUT: "schematic.output",
  WEBSEARCH_INPUT: "websearch.input",
  WEBSEARCH_OUTPUT: "websearch.output",
} as const;
