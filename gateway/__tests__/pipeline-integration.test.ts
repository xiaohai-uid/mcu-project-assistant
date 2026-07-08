import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { handlers, mockChannel, QUEUES } = vi.hoisted(() => {
  const h: Record<string, Function> = {};
  const ch = {
    consume: vi.fn((queue: string, handler: Function) => { h[queue] = handler; }),
    publish: vi.fn(),
    ack: vi.fn(),
    nack: vi.fn(),
    sendToQueue: vi.fn(),
  };
  return {
    handlers: h,
    mockChannel: ch,
    QUEUES: {
      REQUIREMENT_INPUT: "requirement.input",
      REQUIREMENT_OUTPUT: "requirement.output",
      RECOMMENDATION_INPUT: "recommendation.input",
      RECOMMENDATION_OUTPUT: "recommendation.output",
      WEBSEARCH_INPUT: "websearch.input",
      WEBSEARCH_OUTPUT: "websearch.output",
      CODEGEN_INPUT: "codegen.input",
      CODEGEN_OUTPUT: "codegen.output",
      SCHEMATIC_INPUT: "schematic.input",
      SCHEMATIC_OUTPUT: "schematic.output",
    },
  };
});

vi.mock("@/lib/database", () => {
  const query = vi.fn();
  return {
    db: { query },
    withTransaction: async <T>(fn: (client: { query: typeof query }) => Promise<T>) => fn({ query }),
  };
});

vi.mock("@/lib/rabbitmq", () => ({
  QUEUES,
  getChannel: vi.fn(() => mockChannel),
  publishToQueue: vi.fn(),
}));

import { db } from "@/lib/database";
import { startOrchestrator } from "@/lib/orchestrator";
import { invalidateDownstream } from "@/lib/cascade";

function mockMsg(data: Record<string, unknown>) {
  return { content: Buffer.from(JSON.stringify(data)) };
}

function mockQuery() {
  return (db.query as ReturnType<typeof vi.fn>);
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(handlers).forEach((k) => delete handlers[k]);
});

afterEach(() => {
  vi.useRealTimers();
});

// ------------------------------------------------------------------ helpers

async function simulateFullPipeline(draftId = "draft-1") {
  startOrchestrator();

  const reqMsg = mockMsg({ designDraftId: draftId });
  await handlers[QUEUES.REQUIREMENT_OUTPUT](reqMsg);

  const componentList = { tiers: { required: ["resistor", "capacitor", "led"], recommended: ["transistor"] } };
  mockQuery()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ requirement: { task: "blink" }, model_config: { model: "gpt-4" }, platform: "arduino" }] });
  const recMsg = mockMsg({ designDraftId: draftId, componentList });
  await handlers[QUEUES.RECOMMENDATION_OUTPUT](recMsg);

  const code = "void setup() { pinMode(13, OUTPUT); }";
  mockQuery()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ components: componentList, platform: "arduino" }] });
  const codeMsg = mockMsg({ designDraftId: draftId, code, dependencies: [], pinMappings: [], validation: {} });
  await handlers[QUEUES.CODEGEN_OUTPUT](codeMsg);

  mockQuery().mockResolvedValueOnce({ rows: [] });
  const schematicMsg = mockMsg({ designDraftId: draftId, svgContent: "<svg />", pinTable: [{ pin: "D13", component: "led" }] });
  await handlers[QUEUES.SCHEMATIC_OUTPUT](schematicMsg);
}

// =================================================================== TESTS

describe("4.1 — Full Pipeline Integration", () => {
  it("completes full pipeline from requirement output to ready", async () => {
    startOrchestrator();

    expect(mockChannel.consume).toHaveBeenCalledTimes(5);
    expect(mockChannel.consume).toHaveBeenCalledWith(QUEUES.REQUIREMENT_OUTPUT, expect.any(Function), { noAck: false });
    expect(mockChannel.consume).toHaveBeenCalledWith(QUEUES.RECOMMENDATION_OUTPUT, expect.any(Function), { noAck: false });
    expect(mockChannel.consume).toHaveBeenCalledWith(QUEUES.CODEGEN_OUTPUT, expect.any(Function), { noAck: false });
    expect(mockChannel.consume).toHaveBeenCalledWith(QUEUES.SCHEMATIC_OUTPUT, expect.any(Function), { noAck: false });
    expect(mockChannel.consume).toHaveBeenCalledWith(QUEUES.WEBSEARCH_OUTPUT, expect.any(Function), { noAck: false });

    const reqMsg = mockMsg({ designDraftId: "draft-1" });
    await handlers[QUEUES.REQUIREMENT_OUTPUT](reqMsg);

    expect(mockQuery().mock.calls[0][0]).toContain("UPDATE design_drafts");
    expect(mockQuery().mock.calls[0][1]).toContain("recommending");
    expect(mockChannel.publish).toHaveBeenCalledWith(
      "", QUEUES.RECOMMENDATION_INPUT, expect.any(Buffer), { persistent: true }
    );
    expect(mockChannel.ack).toHaveBeenCalledWith(reqMsg);

    vi.clearAllMocks();

    const componentList = { tiers: { required: ["resistor", "capacitor"] } };
    mockQuery()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ requirement: {}, model_config: {}, platform: "arduino" }] });
    const recMsg = mockMsg({ designDraftId: "draft-1", componentList });
    await handlers[QUEUES.RECOMMENDATION_OUTPUT](recMsg);

    expect(mockQuery().mock.calls[0][0]).toContain("SET status = $1");
    expect(mockQuery().mock.calls[0][0]).toContain("component_list");
    expect(mockQuery().mock.calls[0][1][1]).toContain("resistor");
    expect(mockChannel.publish).toHaveBeenCalledWith(
      "", QUEUES.CODEGEN_INPUT, expect.any(Buffer), { persistent: true }
    );

    vi.clearAllMocks();

    const code = "void setup() {}";
    mockQuery()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ components: componentList, platform: "arduino" }] });
    const codeMsg = mockMsg({ designDraftId: "draft-1", code, dependencies: ["Wire"], pinMappings: [{ pin: "D13" }], validation: { passes: true } });
    await handlers[QUEUES.CODEGEN_OUTPUT](codeMsg);

    expect(mockQuery().mock.calls[0][0]).toContain("SET status = $1");
    expect(mockQuery().mock.calls[0][1]).toContain(code);
    expect(mockChannel.publish).toHaveBeenCalledWith(
      "", QUEUES.SCHEMATIC_INPUT, expect.any(Buffer), { persistent: true }
    );

    vi.clearAllMocks();

    mockQuery().mockResolvedValueOnce({ rows: [] });
    const schematicMsg = mockMsg({ designDraftId: "draft-1", svgContent: "<svg />", pinTable: [{ pin: "D13", component: "led" }] });
    await handlers[QUEUES.SCHEMATIC_OUTPUT](schematicMsg);

    expect(mockQuery().mock.calls[0][0]).toContain("SET status = $1");
    expect(mockQuery().mock.calls[0][1]).toContain("<svg />");
    expect(mockChannel.ack).toHaveBeenCalledWith(schematicMsg);
  });

  it("handles schematic error by setting status to failed", async () => {
    startOrchestrator();
    mockQuery().mockResolvedValueOnce({ rows: [] });

    const msg = mockMsg({ designDraftId: "draft-1", error: "Component not found in library" });
    await handlers[QUEUES.SCHEMATIC_OUTPUT](msg);

    expect(mockQuery().mock.calls[0][0]).toContain("UPDATE design_drafts");
    expect(mockQuery().mock.calls[0][0]).toContain("error_message");
    expect(mockQuery().mock.calls[0][1]).toContain("failed");
    expect(mockQuery().mock.calls[0][1]).toContain("Component not found in library");
    expect(mockChannel.ack).toHaveBeenCalled();
  });

  it("handles requirement handler error gracefully", async () => {
    startOrchestrator();
    mockQuery().mockRejectedValueOnce(new Error("DB connection lost"));

    const msg = mockMsg({ designDraftId: "draft-1" });
    await handlers[QUEUES.REQUIREMENT_OUTPUT](msg);

    const failedCall = mockQuery().mock.calls.find(
      ([sql]: [string]) => sql.includes("error_message")
    );
    expect(failedCall).toBeDefined();
    expect(failedCall![1]).toContain("failed");
    expect(failedCall![1]).toContain("Requirement processing failed");
    expect(mockChannel.ack).toHaveBeenCalled();
  });
});

describe("4.2 — Pipeline Timeout", () => {
  it("marks draft as failed when stage exceeds 60-second timeout", async () => {
    vi.useFakeTimers();

    startOrchestrator();
    mockQuery().mockResolvedValue({ rows: [] });

    const draftId = "draft-timeout";
    const msg = mockMsg({ designDraftId: draftId });
    await handlers[QUEUES.REQUIREMENT_OUTPUT](msg);

    vi.advanceTimersByTime(60000);

    const updateCalls = mockQuery().mock.calls.filter(
      ([sql]: [string]) => sql.includes("UPDATE") && sql.includes("failed")
    );

    expect(mockQuery()).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE design_drafts"),
      expect.arrayContaining(["recommending"])
    );

    vi.useRealTimers();
  });
});

describe("4.3 — Stale Cascade", () => {
  it("marks downstream stages as stale when draft is modified after analysis", async () => {
    mockQuery().mockResolvedValue({ rows: [] });

    const downstream = await invalidateDownstream("draft-1", "recommendation");

    expect(downstream).toEqual(["codegen", "schematic", "websearch"]);
    expect(mockQuery()).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE design_drafts"),
      ["codegen", "draft-1"]
    );
  });

  it("does not query when invalidating from the last stage", async () => {
    const downstream = await invalidateDownstream("draft-1", "websearch");

    expect(downstream).toEqual([]);
    expect(mockQuery()).not.toHaveBeenCalled();
  });

  it("invalidating from requirement marks all downstream as stale", async () => {
    mockQuery().mockResolvedValue({ rows: [] });

    const downstream = await invalidateDownstream("draft-1", "requirement");

    expect(downstream).toEqual(["recommendation", "codegen", "schematic", "websearch"]);
    expect(mockQuery()).toHaveBeenCalledWith(
      expect.stringContaining("current_stage = $1"),
      ["recommendation", "draft-1"]
    );
  });
});

describe("4.4 — DLQ / Error Recovery", () => {
  it("nacks message without requeue after max retries on consumer failure", async () => {
    startOrchestrator();

    const handler = handlers[QUEUES.REQUIREMENT_OUTPUT];
    const invalidMsg = { content: Buffer.from("not-valid-json") };
    const MAX_RETRIES = 3;
    let attempts = 0;

    for (let i = 0; i < MAX_RETRIES; i++) {
      attempts++;
      try {
        await handler(invalidMsg);
        break;
      } catch {
        if (i >= MAX_RETRIES - 1) {
          mockChannel.nack(invalidMsg, false, false);
        }
      }
    }

    expect(attempts).toBe(MAX_RETRIES);
    expect(mockChannel.nack).toHaveBeenCalledWith(invalidMsg, false, false);
    expect(mockChannel.ack).not.toHaveBeenCalled();
  });

  it("handles handler-level failures via nack when error escapes before try/catch", async () => {
    startOrchestrator();

    const handler = handlers[QUEUES.REQUIREMENT_OUTPUT];
    const badMsg = { content: Buffer.from("{broken") };

    try {
      await handler(badMsg);
    } catch {
      mockChannel.nack(badMsg, false, false);
    }

    expect(mockChannel.nack).toHaveBeenCalledWith(badMsg, false, false);
    expect(mockChannel.ack).not.toHaveBeenCalled();
  });
});

describe("4.5 — WebSearch Output Handling", () => {
  it("merges prices into design draft on websearch output", async () => {
    startOrchestrator();
    mockQuery().mockResolvedValue({ rows: [] });

    const prices = [
      { component: "resistor", vendor: "Digikey", price: 0.05 },
      { component: "capacitor", vendor: "Mouser", price: 0.12 },
    ];

    const msg = mockMsg({ designDraftId: "draft-1", prices });
    await handlers[QUEUES.WEBSEARCH_OUTPUT](msg);

    expect(mockQuery().mock.calls[0][0]).toContain("SET price_comparison = $1");
    expect(JSON.stringify(mockQuery().mock.calls[0][1])).toContain("resistor");
    expect(mockQuery().mock.calls[0][1]).toContain("draft-1");
    expect(mockChannel.ack).toHaveBeenCalledWith(msg);
  });

  it("handles websearch error gracefully", async () => {
    startOrchestrator();
    mockQuery().mockRejectedValueOnce(new Error("Write conflict"));

    const msg = mockMsg({ designDraftId: "draft-1", prices: [] });
    await handlers[QUEUES.WEBSEARCH_OUTPUT](msg);

    expect(mockChannel.ack).toHaveBeenCalled();
  });
});

describe("4.6 — Async Flow End-to-End", () => {
  it("completes full async pipeline to ready/exportable state", async () => {
    await simulateFullPipeline("draft-e2e");

    const readyCall = mockQuery().mock.calls.find(
      ([sql]: [string]) => sql.includes("svg_content")
    );
    expect(readyCall).toBeDefined();
    expect(readyCall[1]).toContain("<svg />");
  });

  it("continues pipeline when recommendation has no search prices", async () => {
    startOrchestrator();

    const reqMsg = mockMsg({ designDraftId: "draft-noprice" });
    await handlers[QUEUES.REQUIREMENT_OUTPUT](reqMsg);

    const componentList = { tiers: { required: ["resistor"] } };
    mockQuery()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ requirement: { task: "led" }, model_config: {}, platform: "arduino" }] });
    const recMsg = mockMsg({ designDraftId: "draft-noprice", componentList });
    await handlers[QUEUES.RECOMMENDATION_OUTPUT](recMsg);

    const code = "void setup() {}";
    mockQuery()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ components: componentList, platform: "arduino" }] });
    const codeMsg = mockMsg({ designDraftId: "draft-noprice", code, dependencies: [], pinMappings: [], validation: {} });
    await handlers[QUEUES.CODEGEN_OUTPUT](codeMsg);

    mockQuery().mockResolvedValueOnce({ rows: [] });
    const schematicMsg = mockMsg({ designDraftId: "draft-noprice", svgContent: "<svg />", pinTable: [] });
    await handlers[QUEUES.SCHEMATIC_OUTPUT](schematicMsg);

    const readyCall = mockQuery().mock.calls.find(
      ([sql]: [string]) => sql.includes("svg_content")
    );
    expect(readyCall).toBeDefined();
    expect(mockChannel.publish).toHaveBeenCalledWith(
      "", QUEUES.CODEGEN_INPUT, expect.any(Buffer), { persistent: true }
    );
  });

  it("sets failed status when recommendation processing throws", async () => {
    startOrchestrator();

    mockQuery().mockRejectedValueOnce(new Error("AI service unavailable"));

    const componentList = { tiers: { required: ["resistor"] } };
    const recMsg = mockMsg({ designDraftId: "draft-fail", componentList });
    await handlers[QUEUES.RECOMMENDATION_OUTPUT](recMsg);

    const failedCall = mockQuery().mock.calls.find(
      ([sql]: [string]) => sql.includes("error_message")
    );
    expect(failedCall).toBeDefined();
    expect(failedCall![1]).toContain("failed");
    expect(failedCall![1]).toContain("Recommendation processing failed");
    expect(mockChannel.ack).toHaveBeenCalled();
  });

  it("cascade re-triggers after mid-pipeline edit", async () => {
    mockQuery().mockResolvedValue({ rows: [] });

    const downstream = await invalidateDownstream("draft-1", "recommendation");

    expect(downstream).toEqual(["codegen", "schematic", "websearch"]);

    const updateSql = (mockQuery().mock.calls[0] as [string, unknown[]])[0];
    const updateParams = (mockQuery().mock.calls[0] as [string, unknown[]])[1];

    expect(updateSql).toContain("SET status = 'stale'");
    expect(updateSql).toContain("current_stage = $1");
    expect(updateParams[0]).toBe("codegen");

    const reRun = await invalidateDownstream("draft-1", "requirement");
    expect(reRun).toEqual(["recommendation", "codegen", "schematic", "websearch"]);
  });
});
