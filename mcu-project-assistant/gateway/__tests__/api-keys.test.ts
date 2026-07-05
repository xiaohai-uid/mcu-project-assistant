import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/database", () => ({
  db: {
    query: vi.fn(),
  },
}));

vi.mock("@/lib/encryption", () => ({
  encrypt: vi.fn((text: string) => `encrypted:${text}`),
  decrypt: vi.fn(),
}));

import { db } from "@/lib/database";
import { encrypt } from "@/lib/encryption";
import { POST as postCreate, GET as getList } from "@/app/api/keys/route";
import { PATCH as patchRevoke, POST as postRotate } from "@/app/api/keys/[id]/route";

function buildRequest(
  path: string,
  headers: Record<string, string>,
  body?: unknown
): NextRequest {
  const init: RequestInit & { headers: Record<string, string> } = {
    method: body ? "POST" : "GET",
    headers,
  };
  if (body) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest(`http://localhost:3000${path}`, init);
}

const mockKeyRow = {
  id: "key-1",
  label: "My Key",
  key_type: "ai",
  created_at: "2026-01-01T00:00:00Z",
};

describe("POST /api/keys", () => {
  it("creates a key and returns 201 with correct shape", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [mockKeyRow],
    });

    const req = buildRequest(
      "/api/keys",
      { "x-user-id": "user-1" },
      { label: "My Key", keyType: "ai" }
    );
    const res = await postCreate(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.id).toBe("key-1");
    expect(data.label).toBe("My Key");
    expect(data.keyType).toBe("ai");
    expect(data.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(encrypt).toHaveBeenCalled();
  });

  it("returns 401 without x-user-id", async () => {
    const req = buildRequest(
      "/api/keys",
      {},
      { label: "My Key", keyType: "ai" }
    );
    const res = await postCreate(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 without label", async () => {
    const req = buildRequest(
      "/api/keys",
      { "x-user-id": "user-1" },
      { keyType: "ai" }
    );
    const res = await postCreate(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("label");
  });

  it("returns 400 without keyType", async () => {
    const req = buildRequest(
      "/api/keys",
      { "x-user-id": "user-1" },
      { label: "My Key" }
    );
    const res = await postCreate(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("keyType");
  });

  it("returns 500 on database error", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB down")
    );

    const req = buildRequest(
      "/api/keys",
      { "x-user-id": "user-1" },
      { label: "My Key", keyType: "ai" }
    );
    const res = await postCreate(req);
    expect(res.status).toBe(500);
  });
});

describe("GET /api/keys", () => {
  it("lists keys and returns 200 with array", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [mockKeyRow],
    });

    const req = buildRequest("/api/keys", { "x-user-id": "user-1" });
    const res = await getList(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0].id).toBe("key-1");
    expect(data[0].label).toBe("My Key");
    expect(data[0].keyType).toBe("ai");
  });

  it("returns 401 without x-user-id", async () => {
    const req = buildRequest("/api/keys", {});
    const res = await getList(req);
    expect(res.status).toBe(401);
  });

  it("returns empty array when no keys", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [],
    });

    const req = buildRequest("/api/keys", { "x-user-id": "user-1" });
    const res = await getList(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });

  it("returns 500 on database error", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB down")
    );

    const req = buildRequest("/api/keys", { "x-user-id": "user-1" });
    const res = await getList(req);
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/keys/:id", () => {
  it("revokes a key and returns 200", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ id: "key-1" }],
    });

    const req = buildRequest("/api/keys/key-1", { "x-user-id": "user-1" });
    const ctx = { params: Promise.resolve({ id: "key-1" }) };
    const res = await patchRevoke(req, ctx);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("returns 401 without x-user-id", async () => {
    const req = buildRequest("/api/keys/key-1", {});
    const ctx = { params: Promise.resolve({ id: "key-1" }) };
    const res = await patchRevoke(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 404 on unknown id", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [],
    });

    const req = buildRequest("/api/keys/unknown", { "x-user-id": "user-1" });
    const ctx = { params: Promise.resolve({ id: "unknown" }) };
    const res = await patchRevoke(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 500 on database error", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB down")
    );

    const req = buildRequest("/api/keys/key-1", { "x-user-id": "user-1" });
    const ctx = { params: Promise.resolve({ id: "key-1" }) };
    const res = await patchRevoke(req, ctx);
    expect(res.status).toBe(500);
  });
});

describe("POST /api/keys/:id (rotate)", () => {
  it("rotates a key and returns 201 with new key metadata", async () => {
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        rows: [{ key_type: "ai", label: "My Key" }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [mockKeyRow],
      });

    const req = buildRequest("/api/keys/key-1", { "x-user-id": "user-1" });
    const ctx = { params: Promise.resolve({ id: "key-1" }) };
    const res = await postRotate(req, ctx);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.id).toBe("key-1");
    expect(data.label).toBe("My Key");
    expect(data.keyType).toBe("ai");
  });

  it("returns 401 without x-user-id", async () => {
    const req = buildRequest("/api/keys/key-1", {});
    const ctx = { params: Promise.resolve({ id: "key-1" }) };
    const res = await postRotate(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 404 on unknown id", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [],
    });

    const req = buildRequest("/api/keys/unknown", { "x-user-id": "user-1" });
    const ctx = { params: Promise.resolve({ id: "unknown" }) };
    const res = await postRotate(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 500 on database error", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB down")
    );

    const req = buildRequest("/api/keys/key-1", { "x-user-id": "user-1" });
    const ctx = { params: Promise.resolve({ id: "key-1" }) };
    const res = await postRotate(req, ctx);
    expect(res.status).toBe(500);
  });
});
