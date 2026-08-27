/**
 * Tests for auto-snapshot creation at pipeline completion.
 * When the pipeline completes (status → 'ready'), an auto-snapshot should be created.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Top-level mocks
vi.mock("@/lib/database", () => ({
  db: { query: vi.fn() },
}));

vi.mock("@/lib/snapshot", () => ({
  createSnapshot: vi.fn(),
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "snap-uuid"),
}));

describe("SchematicHandler auto-snapshot", () => {
  let SchematicHandler: typeof import("@/lib/handlers/schematic-handler").SchematicHandler;
  let db: typeof import("@/lib/database");
  let snapshot: typeof import("@/lib/snapshot");

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks(); // Clear call history on module-level mocks
    ({ SchematicHandler } = await import("@/lib/handlers/schematic-handler"));
    db = await import("@/lib/database");
    snapshot = await import("@/lib/snapshot");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates auto-snapshot when pipeline completes successfully", async () => {
    vi.spyOn(snapshot, "createSnapshot").mockResolvedValue({
      id: "snap-uuid",
      designDraftId: "draft-1",
      name: "自动快照 #1",
      isAuto: true,
      createdAt: "2024-01-01",
    });

    const handler = new SchematicHandler();
    const content = {
      designDraftId: "draft-1",
      svgContent: "<svg>test</svg>",
      pinTable: [],
      userId: "user-1",
    };

    await handler.doUpdate(content as any, vi.fn());

    expect(snapshot.createSnapshot).toHaveBeenCalledWith(
      "draft-1",
      "user-1",
      expect.objectContaining({ isAuto: true })
    );
  });

  it("does NOT create auto-snapshot when pipeline fails", async () => {
    const handler = new SchematicHandler();
    const content = {
      designDraftId: "draft-1",
      svgContent: "",
      pinTable: [],
      userId: "user-1",
      error: "Schematic failed",
    };

    await handler.doUpdate(content as any, vi.fn());
    expect(snapshot.createSnapshot).not.toHaveBeenCalled();
  });
});