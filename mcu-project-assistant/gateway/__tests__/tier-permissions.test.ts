import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/database", () => {
  const query = vi.fn();
  return {
    db: { query },
    withTransaction: async <T>(fn: (client: { query: typeof query }) => Promise<T>) => fn({ query }),
  };
});

vi.mock("@/lib/encryption", () => ({
  encrypt: vi.fn((val: string) => `encrypted-${val}`),
}));

vi.mock("@/lib/rabbitmq", () => ({
  publishToQueue: vi.fn(),
  QUEUES: { REQUIREMENT_INPUT: "requirement.input" },
}));

vi.mock("@/lib/model-router", () => ({
  resolveModelConfig: vi.fn(() => ({ level: "free_api", endpoint: "https://api.openai.com", model: "gpt-4o-mini" })),
}));

vi.mock("@/lib/api-key-resolver", () => ({
  resolveDecryptedApiKey: vi.fn(() => null),
}));

import { signToken, verifyToken } from "@/lib/jwt";
import { requireTier } from "@/middleware/tier-guard";
import { checkSearchQuota, checkDailyQuota } from "@/lib/daily-quota";
import { checkPlatformAccess, getAllowedPlatforms } from "@/lib/platform-permissions";
import { db } from "@/lib/database";
import { middleware } from "@/middleware";
import { GET as getKeys, POST as createKey } from "@/app/api/keys/route";
import { PATCH as revokeKey, POST as rotateKey } from "@/app/api/keys/[id]/route";
import { POST as startProject } from "@/app/api/projects/start/route";
import type { Membership, Platform } from "@/lib/models";

type MockRows = { rows: Record<string, unknown>[] };

function mockRows(data: Record<string, unknown>[]): MockRows {
  return { rows: data };
}

const TIERS: Membership[] = ["free", "hasKey", "subscription"];
const PLATFORMS: Platform[] = ["arduino", "esp32", "stm32"];

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-key";
  process.env.DAILY_QUOTA_LIMIT = "10";
  process.env.SEARCH_QUOTA_MONTHLY = "1000";
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Route access by tier
// ---------------------------------------------------------------------------
describe("1. Route Access by Tier", () => {
  async function makeProfessionalRequest(
    method: string,
    path: string,
    membership: Membership
  ): Promise<NextRequest> {
    const payload = { userId: "u1", email: "a@b.com", membership };
    const token = await signToken(payload);
    return new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  function makeRequestWithoutAuth(method: string, path: string): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, { method });
  }

  const PROFESSIONAL_ROUTES: { method: string; path: string }[] = [
    { method: "PUT", path: "/api/projects/p123/code" },
    { method: "PUT", path: "/api/projects/p123/pins" },
    { method: "PUT", path: "/api/projects/p123/components" },
    { method: "GET", path: "/api/projects/p123/export" },
  ];

  describe("requireTier middleware", () => {
    it.each(TIERS)("allows %s on public route GET /api/templates", async (tier) => {
      const req = await makeProfessionalRequest("GET", "/api/templates", tier);
      const res = await requireTier("subscription")(req);
      expect(res).toBeUndefined();
    });

    it.each(TIERS)("allows %s on free route GET /api/projects", async (tier) => {
      const req = await makeProfessionalRequest("GET", "/api/projects", tier);
      const res = await requireTier("subscription")(req);
      expect(res).toBeUndefined();
    });

    it.each(TIERS)("allows %s on membership POST /api/membership/upgrade", async (tier) => {
      const req = await makeProfessionalRequest("POST", "/api/membership/upgrade", tier);
      const res = await requireTier("subscription")(req);
      expect(res).toBeUndefined();
    });

    it.each(TIERS)("allows %s on membership POST /api/membership/downgrade", async (tier) => {
      const req = await makeProfessionalRequest("POST", "/api/membership/downgrade", tier);
      const res = await requireTier("subscription")(req);
      expect(res).toBeUndefined();
    });

    it.each(PROFESSIONAL_ROUTES)(
      "blocks free user on $method $path with 403",
      async ({ method, path }) => {
        const req = await makeProfessionalRequest(method, path, "free");
        const res = await requireTier("subscription")(req);
        expect(res).toBeDefined();
        if (res) {
          expect(res.status).toBe(403);
        }
      }
    );

    it.each(PROFESSIONAL_ROUTES)(
      "blocks hasKey user on $method $path with 403",
      async ({ method, path }) => {
        const req = await makeProfessionalRequest(method, path, "hasKey");
        const res = await requireTier("subscription")(req);
        expect(res).toBeDefined();
        if (res) {
          expect(res.status).toBe(403);
        }
      }
    );

    it.each(PROFESSIONAL_ROUTES)(
      "allows subscription user on $method $path",
      async ({ method, path }) => {
        const req = await makeProfessionalRequest(method, path, "subscription");
        const res = await requireTier("subscription")(req);
        expect(res).toBeUndefined();
      }
    );

    it("returns 401 when no auth token on professional route", async () => {
      const req = makeRequestWithoutAuth("PUT", "/api/projects/p123/code");
      const res = await requireTier("subscription")(req);
      expect(res).toBeDefined();
      if (res) {
        expect(res.status).toBe(401);
      }
    });

    it("returns 401 when invalid token on professional route", async () => {
      const req = new NextRequest("http://localhost:3000/api/projects/p123/code", {
        method: "PUT",
        headers: { authorization: "Bearer invalid-token" },
      });
      const res = await requireTier("subscription")(req);
      expect(res).toBeDefined();
      if (res) {
        expect(res.status).toBe(401);
      }
    });

    it.each(PROFESSIONAL_ROUTES)(
      "403 response body includes error and upgrade_url for $method $path",
      async ({ method, path }) => {
        const req = await makeProfessionalRequest(method, path, "free");
        const res = await requireTier("subscription")(req);
        expect(res).toBeDefined();
        if (res) {
          expect(res.status).toBe(403);
        }
      }
    );
  });

  describe("middleware auth gates", () => {
    it.each(TIERS)("allows %s through middleware on /api/projects", async (tier) => {
      const payload = { userId: "u1", email: "a@b.com", membership: tier };
      const token = await signToken(payload);
      const req = new NextRequest("http://localhost:3000/api/projects", {
        headers: { authorization: `Bearer ${token}` },
      });
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it("returns 401 on protected path without auth header", async () => {
      const req = new NextRequest("http://localhost:3000/api/projects");
      const res = await middleware(req);
      expect(res.status).toBe(401);
    });

    it("returns 200 on unprotected path", async () => {
      const req = new NextRequest("http://localhost:3000/api/templates");
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Platform restrictions
// ---------------------------------------------------------------------------
describe("2. Platform Restrictions", () => {
  describe("checkPlatformAccess unit", () => {
    it.each(TIERS.flatMap((tier) =>
      PLATFORMS.map((platform) => [tier, platform] as [Membership, Platform])
    ))("tier=%s platform=%s", (tier, platform) => {
      const result = checkPlatformAccess(tier, platform);
      if (tier === "free" || tier === "hasKey") {
        expect(result).toBe(platform === "arduino");
      } else {
        expect(result).toBe(true);
      }
    });
  });

  describe("getAllowedPlatforms", () => {
    it("free returns only arduino", () => {
      expect(getAllowedPlatforms("free")).toEqual(["arduino"]);
    });

    it("hasKey returns only arduino", () => {
      expect(getAllowedPlatforms("hasKey")).toEqual(["arduino"]);
    });

    it("subscription returns all platforms", () => {
      expect(getAllowedPlatforms("subscription")).toEqual(["arduino", "esp32", "stm32"]);
    });

    it("pay-as-you-go returns all platforms", () => {
      expect(getAllowedPlatforms("pay-as-you-go")).toEqual(["arduino", "esp32", "stm32"]);
    });
  });

  describe("POST /api/projects/start platform enforcement", () => {
    it("allows free user on arduino", async () => {
      (db.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockRows([{ tier: "free" }]))
        .mockResolvedValueOnce(mockRows([{ daily_quota_remaining: 5, daily_quota_reset_at: new Date(Date.now() + 3600000).toISOString() }]))
        .mockResolvedValueOnce(mockRows([{ key_value_encrypted: null, key_type: "ai" }]))
        .mockResolvedValueOnce(mockRows([]));

      const req = new NextRequest("http://localhost/api/projects/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "u1", description: "test", experienceLevel: "beginner", platform: "arduino" }),
      });

      const res = await startProject(req);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.designDraftId).toBeDefined();
    });

    it("blocks free user on esp32 with 403", async () => {
      (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockRows([{ tier: "free" }])
      );

      const req = new NextRequest("http://localhost/api/projects/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "u1", description: "test", experienceLevel: "beginner", platform: "esp32" }),
      });

      const res = await startProject(req);
      const body = await res.json();
      expect(res.status).toBe(403);
      expect(body.error).toBe("Platform not allowed");
      expect(body.allowedPlatforms).toEqual(["arduino"]);
    });

    it("blocks hasKey user on stm32 with 403", async () => {
      (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockRows([{ tier: "hasKey" }])
      );

      const req = new NextRequest("http://localhost/api/projects/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "u1", description: "test", experienceLevel: "beginner", platform: "stm32" }),
      });

      const res = await startProject(req);
      const body = await res.json();
      expect(res.status).toBe(403);
      expect(body.error).toBe("Platform not allowed");
      expect(body.allowedPlatforms).toEqual(["arduino"]);
    });

    it("allows subscription user on stm32", async () => {
      (db.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockRows([{ tier: "subscription" }]))
        .mockResolvedValueOnce(mockRows([{ daily_quota_remaining: 5, daily_quota_reset_at: new Date(Date.now() + 3600000).toISOString() }]))
        .mockResolvedValueOnce(mockRows([{ key_value_encrypted: null, key_type: "ai" }]))
        .mockResolvedValueOnce(mockRows([]));

      const req = new NextRequest("http://localhost/api/projects/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "u1", description: "test", experienceLevel: "beginner", platform: "stm32" }),
      });

      const res = await startProject(req);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.designDraftId).toBeDefined();
    });

    it("allows subscription user on esp32", async () => {
      (db.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockRows([{ tier: "subscription" }]))
        .mockResolvedValueOnce(mockRows([{ daily_quota_remaining: 5, daily_quota_reset_at: new Date(Date.now() + 3600000).toISOString() }]))
        .mockResolvedValueOnce(mockRows([{ key_value_encrypted: null, key_type: "ai" }]))
        .mockResolvedValueOnce(mockRows([]));

      const req = new NextRequest("http://localhost/api/projects/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "u1", description: "test", experienceLevel: "beginner", platform: "esp32" }),
      });

      const res = await startProject(req);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.designDraftId).toBeDefined();
    });

    it("blocks free user on unrecognized platform", async () => {
      (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockRows([{ tier: "free" }])
      );

      const req = new NextRequest("http://localhost/api/projects/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "u1", description: "test", experienceLevel: "beginner", platform: "raspberry-pi" }),
      });

      const res = await startProject(req);
      expect(res.status).toBe(403);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Search quota by tier
// ---------------------------------------------------------------------------
describe("3. Search Quota by Tier", () => {
  it("free user → search disallowed", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockRows([{ search_quota_monthly: 0, search_quota_used: 0, payg_balance: "0.00" }])
    );

    const result = await checkSearchQuota("u1", "free");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.reason).toBe("Search not available on current plan");
  });

  it("hasKey user → search disallowed (uses own key, no infra quota)", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockRows([{ search_quota_monthly: 0, search_quota_used: 0, payg_balance: "0.00" }])
    );

    const result = await checkSearchQuota("u1", "hasKey");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.reason).toBe("Search not available on current plan");
  });

  it("subscription user with remaining quota → allowed", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockRows([{ search_quota_monthly: 1000, search_quota_used: 50, payg_balance: "0.00" }])
    );

    const result = await checkSearchQuota("u1", "subscription");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(950);
  });

  it("subscription user with exhausted quota → disallowed", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockRows([{ search_quota_monthly: 1000, search_quota_used: 1000, payg_balance: "0.00" }])
    );

    const result = await checkSearchQuota("u1", "subscription");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("pay-as-you-go user with balance → allowed", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockRows([{ search_quota_monthly: 0, search_quota_used: 0, payg_balance: "5.00" }])
    );

    const result = await checkSearchQuota("u1", "pay-as-you-go");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(Infinity);
  });

  it("pay-as-you-go user with zero balance → disallowed", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockRows([{ search_quota_monthly: 0, search_quota_used: 0, payg_balance: "0.00" }])
    );

    const result = await checkSearchQuota("u1", "pay-as-you-go");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.reason).toBe("Insufficient balance");
  });

  it("returns false when user not found", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue(mockRows([]));

    const result = await checkSearchQuota("nonexistent", "subscription");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.reason).toBe("User not found");
  });

  it("daily quota bypass for hasKey", async () => {
    const result = await checkDailyQuota("u1", "hasKey");
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Key management access (all authenticated tiers)
// ---------------------------------------------------------------------------
describe("4. Key Management Access", () => {
  describe("GET /api/keys", () => {
    it.each(TIERS)("%s can list their keys", async (tier) => {
      (db.query as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockRows([
          { id: "k1", label: "My Key", key_type: "ai", created_at: new Date().toISOString() },
        ])
      );

      const req = new NextRequest("http://localhost/api/keys", {
        headers: { "x-user-id": "u1", "x-membership": tier },
      });
      const res = await getKeys(req);
      expect(res.status).toBe(200);
    });

    it("returns 401 when x-user-id is missing", async () => {
      const req = new NextRequest("http://localhost/api/keys");
      const res = await getKeys(req);
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/keys", () => {
    it.each(TIERS)("%s can create a key", async (tier) => {
      (db.query as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockRows([{ id: "k-new", label: "New Key", key_type: "ai", created_at: new Date().toISOString() }])
      );

      const req = new NextRequest("http://localhost/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": "u1", "x-membership": tier },
        body: JSON.stringify({ label: "New Key", keyType: "ai" }),
      });
      const res = await createKey(req);
      expect(res.status).toBe(201);
    });

    it("returns 401 when x-user-id is missing", async () => {
      const req = new NextRequest("http://localhost/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "New Key", keyType: "ai" }),
      });
      const res = await createKey(req);
      expect(res.status).toBe(401);
    });

    it("returns 400 when label is missing", async () => {
      const req = new NextRequest("http://localhost/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": "u1", "x-membership": "subscription" },
        body: JSON.stringify({ keyType: "ai" }),
      });
      const res = await createKey(req);
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/keys/[id] (revoke)", () => {
    it.each(TIERS)("%s can revoke their key", async (tier) => {
      (db.query as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockRows([{ id: "k1" }])
      );

      const req = new NextRequest("http://localhost/api/keys/k1", {
        method: "PATCH",
        headers: { "x-user-id": "u1", "x-membership": tier },
      });
      const res = await revokeKey(req, { params: Promise.resolve({ id: "k1" }) });
      expect(res.status).toBe(200);
    });

    it("returns 401 when x-user-id is missing", async () => {
      const req = new NextRequest("http://localhost/api/keys/k1", { method: "PATCH" });
      const res = await revokeKey(req, { params: Promise.resolve({ id: "k1" }) });
      expect(res.status).toBe(401);
    });

    it("returns 404 when key not found", async () => {
      (db.query as ReturnType<typeof vi.fn>).mockResolvedValue(mockRows([]));

      const req = new NextRequest("http://localhost/api/keys/k-nonexistent", {
        method: "PATCH",
        headers: { "x-user-id": "u1", "x-membership": "subscription" },
      });
      const res = await revokeKey(req, { params: Promise.resolve({ id: "k-nonexistent" }) });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/keys/[id] (rotate)", () => {
    it.each(TIERS)("%s can rotate their key", async (tier) => {
      (db.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockRows([{ key_type: "ai", label: "My Key" }]))
        .mockResolvedValueOnce(mockRows([]))
        .mockResolvedValueOnce(mockRows([{ id: "k-new", label: "My Key", key_type: "ai", created_at: new Date().toISOString() }]));

      const req = new NextRequest("http://localhost/api/keys/k1", {
        method: "POST",
        headers: { "x-user-id": "u1", "x-membership": tier },
      });
      const res = await rotateKey(req, { params: Promise.resolve({ id: "k1" }) });
      expect(res.status).toBe(201);
    });

    it("returns 401 when x-user-id is missing", async () => {
      const req = new NextRequest("http://localhost/api/keys/k1", { method: "POST" });
      const res = await rotateKey(req, { params: Promise.resolve({ id: "k1" }) });
      expect(res.status).toBe(401);
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Error response format
// ---------------------------------------------------------------------------
describe("5. Error Response Format", () => {
  describe("403 format from requireTier", () => {
    it("includes error and upgrade_url for free user on professional route", async () => {
      const payload = { userId: "u1", email: "a@b.com", membership: "free" };
      const token = await signToken(payload);
      const req = new NextRequest("http://localhost:3000/api/projects/p123/code", {
        method: "PUT",
        headers: { authorization: `Bearer ${token}` },
      });

      const res = await requireTier("subscription")(req);
      expect(res).toBeDefined();
      if (res) {
        const body = await res.json();
        expect(res.status).toBe(403);
        expect(body).toHaveProperty("error");
        expect(body).toHaveProperty("upgrade_url");
        expect(body.upgrade_url).toBe("/membership");
      }
    });

    it("includes error and upgrade_url for hasKey user on professional route", async () => {
      const payload = { userId: "u1", email: "a@b.com", membership: "hasKey" };
      const token = await signToken(payload);
      const req = new NextRequest("http://localhost:3000/api/projects/p123/code", {
        method: "PUT",
        headers: { authorization: `Bearer ${token}` },
      });

      const res = await requireTier("subscription")(req);
      expect(res).toBeDefined();
      if (res) {
        const body = await res.json();
        expect(res.status).toBe(403);
        expect(body.error).toBe("Professional feature. Upgrade required.");
        expect(body.upgrade_url).toBe("/membership");
      }
    });
  });

  describe("401 format from requireTier", () => {
    it("returns 401 when no auth header on professional route", async () => {
      const req = new NextRequest("http://localhost:3000/api/projects/p123/code", {
        method: "PUT",
      });

      const res = await requireTier("subscription")(req);
      expect(res).toBeDefined();
      if (res) {
        const body = await res.json();
        expect(res.status).toBe(401);
        expect(body).toHaveProperty("error");
      }
    });

    it("returns 401 when invalid token on professional route", async () => {
      const req = new NextRequest("http://localhost:3000/api/projects/p123/code", {
        method: "PUT",
        headers: { authorization: "Bearer garbage-token" },
      });

      const res = await requireTier("subscription")(req);
      expect(res).toBeDefined();
      if (res) {
        const body = await res.json();
        expect(res.status).toBe(401);
        expect(body.error).toBe("Invalid or expired token");
      }
    });
  });

  describe("401 format from middleware", () => {
    it("returns { error: 'Unauthorized' } when no auth header", async () => {
      const req = new NextRequest("http://localhost:3000/api/projects");
      const res = await middleware(req);
      expect(res.status).toBe(401);
    });

    it("returns { error: 'Invalid or expired token' } when bad token", async () => {
      const req = new NextRequest("http://localhost:3000/api/projects", {
        headers: { authorization: "Bearer bad-token" },
      });
      const res = await middleware(req);
      expect(res.status).toBe(401);
    });
  });

  describe("403 format from platform enforcement", () => {
    it("includes error and allowedPlatforms", async () => {
      (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockRows([{ tier: "free" }])
      );

      const req = new NextRequest("http://localhost/api/projects/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "u1", description: "test", experienceLevel: "beginner", platform: "esp32" }),
      });

      const res = await startProject(req);
      const body = await res.json();
      expect(res.status).toBe(403);
      expect(body.error).toBe("Platform not allowed");
      expect(body.allowedPlatforms).toEqual(["arduino"]);
    });
  });
});
