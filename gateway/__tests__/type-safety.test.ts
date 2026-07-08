import { describe, it, expect } from "vitest";

import type { PipelineMessage } from "@/lib/stage-types";
import type { RequirementOutput, RecommendationOutput, CodegenOutput } from "@/lib/stage-types";
import { buildCodegenInput, buildSchematicInput, enrichRequirement } from "@/lib/stage-transforms";

describe("Handler type safety (no index signatures)", () => {
  it("RequirementOutput has no index signature", () => {
    const msg: RequirementOutput = { designDraftId: "abc", requirement: { text: "x" } };
    expect(msg.designDraftId).toBe("abc");
    expect(msg.requirement).toEqual({ text: "x" });
  });

  it("RecommendationOutput has no index signature", () => {
    const msg: RecommendationOutput = { designDraftId: "abc", componentList: { tiers: {} } };
    expect(msg.designDraftId).toBe("abc");
    expect(msg.componentList).toEqual({ tiers: {} });
  });

  it("CodegenOutput has no index signature", () => {
    const msg: CodegenOutput = { designDraftId: "abc", code: "void setup() {}", dependencies: ["Wire.h"] };
    expect(msg.code).toBe("void setup() {}");
    expect(msg.dependencies).toEqual(["Wire.h"]);
  });

  it("PipelineMessage is precise (only designDraftId)", () => {
    const msg: PipelineMessage = { designDraftId: "abc" };
    expect(msg.designDraftId).toBe("abc");
  });
});

describe("stage-transforms type safety (replaces as any)", () => {
  it("buildCodegenInput reads componentList.tiers without casting", () => {
    const content = {
      designDraftId: "abc",
      componentList: { tiers: { budget: [{ name: "R1" }] } },
    } as const;
    const row = { requirement: { lang: "zh" }, model_config: { temp: 0.2 }, platform: "esp32" };
    const result = buildCodegenInput(content as never, row);
    expect(result.components).toEqual([{ name: "R1" }]);
    expect(result.requirement).toEqual({ lang: "zh" });
    expect(result.modelConfig).toEqual({ temp: 0.2 });
    expect(result.platform).toBe("esp32");
  });

  it("buildSchematicInput reads component_list.tiers without casting", () => {
    const content = { designDraftId: "abc", pinMappings: [{ pin: 5 }] } as const;
    const row = { component_list: { tiers: { budget: [{ name: "LED" }] } }, platform: "stm32" };
    const result = buildSchematicInput(content as never, row);
    expect(result.components).toEqual([{ name: "LED" }]);
    expect(result.platform).toBe("stm32");
    expect(result.pinMappings).toEqual([{ pin: 5 }]);
  });

  it("enrichRequirement reads model_config without casting", () => {
    const content = { designDraftId: "abc", requirement: { text: "x" } } as const;
    const row = { model_config: { top_p: 1 } };
    const result = enrichRequirement(content as never, row);
    expect(result.modelConfig).toEqual({ top_p: 1 });
  });
});
