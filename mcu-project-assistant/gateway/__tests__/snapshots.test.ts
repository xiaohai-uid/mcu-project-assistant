import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/database", () => ({
  db: {
    query: vi.fn(),
  },
}));

import { db } from "@/lib/database";
import { GET as listSnapshots, POST as createSnapshotRoute } from "@/app/api/projects/[id]/snapshots/route";
import { POST as restoreSnapshotRoute } from "@/app/api/snapshots/[snapshotId]/restore/route";

function buildRequest(path: string, headers: Record<string, string>, body?: unknown): NextRequest {
  const init: RequestInit & { headers: Record<string, string> } = {
    method: body ? "POST" : "GET",
    headers,
  };
  if (body) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest(`http://localhost:3000${path}`, init);
}

describe("POST /api/projects/:designDraftId/snapshots", () => {
  it("creates manual snapshot with name, returns 201", async () => {
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ id: "draft-1", title: "Test", raw_description: "desc", status: "analyzing", current_stage: "requirement", experience_level: "beginner", membership_tier: "free" }] })
      .mockResolvedValueOnce({ rows: [{ id: "snap-1", created_at: "2026-01-01T00:00:00Z" }] });

    const req = buildRequest("/api/projects/draft-1/snapshots", { "x-user-id": "user-1" }, { name: "My Snapshot" });
    const res = await createSnapshotRoute(req, { params: Promise.resolve({ id: "draft-1" }) });
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.name).toBe("My Snapshot");
    expect(data.isAuto).toBe(false);
  });

  it("returns 400 if name missing", async () => {
    const req = buildRequest("/api/projects/draft-1/snapshots", { "x-user-id": "user-1" }, {});
    const res = await createSnapshotRoute(req, { params: Promise.resolve({ id: "draft-1" }) });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("name is required");
  });

  it("returns 401 without x-user-id", async () => {
    const req = buildRequest("/api/projects/draft-1/snapshots", {}, { name: "Test" });
    const res = await createSnapshotRoute(req, { params: Promise.resolve({ id: "draft-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent draft", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    const req = buildRequest("/api/projects/draft-none/snapshots", { "x-user-id": "user-1" }, { name: "Test" });
    const res = await createSnapshotRoute(req, { params: Promise.resolve({ id: "draft-none" }) });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:designDraftId/snapshots", () => {
  it("returns empty array", async () => {
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [{ id: "draft-1" }] })
      .mockResolvedValueOnce({ rows: [] });

    const req = buildRequest("/api/projects/draft-1/snapshots", { "x-user-id": "user-1" });
    const res = await listSnapshots(req, { params: Promise.resolve({ id: "draft-1" }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toEqual([]);
  });

  it("returns 401 without x-user-id", async () => {
    const req = buildRequest("/api/projects/draft-1/snapshots", {});
    const res = await listSnapshots(req, { params: Promise.resolve({ id: "draft-1" }) });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/snapshots/:snapshotId/restore", () => {
  it("restores draft", async () => {
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        rows: [{
          id: "snap-1",
          design_draft_id: "draft-1",
          snapshot_data: JSON.stringify({ title: "Restored", rawDescription: "restored desc", status: "analyzing", currentStage: "requirement", experienceLevel: "beginner", membershipTier: "free" }),
          name: "My Snapshot",
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const req = buildRequest("/api/snapshots/snap-1/restore", { "x-user-id": "user-1" });
    const res = await restoreSnapshotRoute(req, { params: Promise.resolve({ snapshotId: "snap-1" }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.message).toBe("Snapshot restored successfully");
    expect(data.draftId).toBe("draft-1");
    expect(data.snapshotName).toBe("My Snapshot");
  });

  it("returns 404 for non-existent snapshot", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    const req = buildRequest("/api/snapshots/snap-none/restore", { "x-user-id": "user-1" });
    const res = await restoreSnapshotRoute(req, { params: Promise.resolve({ snapshotId: "snap-none" }) });
    expect(res.status).toBe(404);
  });

  it("returns 401 without x-user-id", async () => {
    const req = buildRequest("/api/snapshots/snap-1/restore", {});
    const res = await restoreSnapshotRoute(req, { params: Promise.resolve({ snapshotId: "snap-1" }) });
    expect(res.status).toBe(401);
  });
});
