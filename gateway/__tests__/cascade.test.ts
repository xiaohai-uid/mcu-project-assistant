import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/database", () => ({
  db: { query: vi.fn() },
}));

import { db } from "@/lib/database";
import { STAGE_ORDER, getDownstreamStages, invalidateDownstream } from "@/lib/cascade";

describe("STAGE_ORDER", () => {
  it("has correct order", () => {
    expect(STAGE_ORDER).toEqual(["requirement", "recommendation", "codegen", "schematic", "websearch"]);
  });
});

describe("getDownstreamStages", () => {
  it("returns stages after requirement", () => {
    expect(getDownstreamStages("requirement")).toEqual(["recommendation", "codegen", "schematic", "websearch"]);
  });

  it("returns stages after recommendation", () => {
    expect(getDownstreamStages("recommendation")).toEqual(["codegen", "schematic", "websearch"]);
  });

  it("returns stages after codegen", () => {
    expect(getDownstreamStages("codegen")).toEqual(["schematic", "websearch"]);
  });

  it("returns empty for websearch (last stage)", () => {
    expect(getDownstreamStages("websearch")).toEqual([]);
  });
});

describe("invalidateDownstream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates DB and returns downstream stages", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

    const result = await invalidateDownstream("draft-1", "requirement");

    expect(result).toEqual(["recommendation", "codegen", "schematic", "websearch"]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE design_drafts"),
      ["recommendation", "draft-1"]
    );
  });

  it("returns empty and does not query for last stage", async () => {
    const result = await invalidateDownstream("draft-1", "websearch");

    expect(result).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("invalidates from recommendation stage", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

    const result = await invalidateDownstream("draft-1", "recommendation");

    expect(result).toEqual(["codegen", "schematic", "websearch"]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE design_drafts"),
      ["codegen", "draft-1"]
    );
  });
});
