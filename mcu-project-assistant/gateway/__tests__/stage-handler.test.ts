import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Shared mock channel used by both the test and the handler
let mockPublish: ReturnType<typeof vi.fn>;
let mockAck: ReturnType<typeof vi.fn>;

vi.mock("@/lib/database", () => ({
  db: {
    query: vi.fn(),
  },
  withTransaction: vi.fn((cb) => cb({ query: vi.fn() })),
}));

vi.mock("@/lib/rabbitmq", () => ({
  getChannel: () => ({
    get publish() { return mockPublish; },
    get ack() { return mockAck; },
  }),
}));

describe("StageHandler error handling", () => {
  let StageHandler: typeof import("@/lib/stage-handler").StageHandler;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    mockPublish = vi.fn();
    mockAck = vi.fn();
    ({ StageHandler } = await import("@/lib/stage-handler"));

    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs DB update error on pipeline failure instead of swallowing it", async () => {
    const db = await import("@/lib/database");

    class TestHandler extends StageHandler {
      protected doUpdate(): Promise<void> {
        return Promise.resolve();
      }
      protected doSelect(): Promise<Record<string, unknown> | undefined> {
        return Promise.resolve(undefined);
      }
      protected buildNextPayload(): Record<string, unknown> | null {
        return null;
      }
    }

    const handler = new TestHandler("test_stage", "Test stage failed", null);
    vi.spyOn(handler, "doUpdate").mockRejectedValue(new Error("pipeline failure"));
    vi.spyOn(db.db, "query").mockRejectedValue(new Error("DB connection lost"));

    await handler.handle({ content: Buffer.from('{"designDraftId":"d1"}') } as any);

    expect(consoleErrorSpy).toHaveBeenCalledWith("Test stage failed:", expect.any(Error));
    expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to mark design draft as failed", expect.any(Error));
    expect(mockAck).toHaveBeenCalled();
  });

  it("still acks message when both pipeline and DB fail", async () => {
    const db = await import("@/lib/database");

    class TestHandler extends StageHandler {
      protected doUpdate(): Promise<void> {
        return Promise.reject(new Error("pipeline failure"));
      }
      protected doSelect(): Promise<Record<string, unknown> | undefined> {
        return Promise.resolve(undefined);
      }
      protected buildNextPayload(): Record<string, unknown> | null {
        return null;
      }
    }

    const handler = new TestHandler("test_stage", "Test stage failed", null);
    vi.spyOn(db.db, "query").mockRejectedValue(new Error("DB connection lost"));

    await handler.handle({ content: Buffer.from('{"designDraftId":"d1"}') } as any);

    expect(mockAck).toHaveBeenCalledTimes(1);
  });

  it("logs when DB update succeeds (no extra error logged)", async () => {
    const db = await import("@/lib/database");

    class TestHandler extends StageHandler {
      protected doUpdate(): Promise<void> {
        return Promise.reject(new Error("pipeline failure"));
      }
      protected doSelect(): Promise<Record<string, unknown> | undefined> {
        return Promise.resolve(undefined);
      }
      protected buildNextPayload(): Record<string, unknown> | null {
        return null;
      }
    }

    const handler = new TestHandler("test_stage", "Test stage failed", null);
    vi.spyOn(db.db, "query").mockResolvedValue({ rows: [] });

    await handler.handle({ content: Buffer.from('{"designDraftId":"d1"}') } as any);

    expect(consoleErrorSpy).toHaveBeenCalledWith("Test stage failed:", expect.any(Error));
    const dbErrorCalls = consoleErrorSpy.mock.calls.filter(
      (call) => call[0] === "Failed to mark design draft as failed"
    );
    expect(dbErrorCalls).toHaveLength(0);
  });
});