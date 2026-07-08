import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/database", () => ({
  db: { query: vi.fn() },
}));

import { db } from "@/lib/database";
import { GET } from "@/app/api/templates/route";

describe("GET /api/templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no templates exist", async () => {
    (db.query as any).mockResolvedValue({ rows: [] });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual([]);
  });

  it("returns templates with correct shape", async () => {
    const mockRows = [
      {
        id: "1",
        title: "Test Template",
        description: "A test",
        template_data: { tags: ["test"], platform: "arduino", experienceLevel: "beginner" },
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    (db.query as any).mockResolvedValue({ rows: mockRows });

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: "1",
      title: "Test Template",
      tags: ["test"],
      platform: "arduino",
    });
  });

  it("returns 500 on db error", async () => {
    (db.query as any).mockRejectedValue(new Error("DB error"));
    const response = await GET();
    expect(response.status).toBe(500);
  });
});
