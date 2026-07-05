import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

vi.mock("@/lib/database", () => ({
  db: {
    query: vi.fn(),
  },
}));

vi.mock("@/lib/rabbitmq", () => ({
  publishToQueue: vi.fn(),
  QUEUES: { REQUIREMENT_INPUT: "requirement.input" },
}));

import { db } from "@/lib/database";
import { checkPlatformAccess, getAllowedPlatforms } from "@/lib/platform-permissions";
import { POST } from "@/app/api/projects/start/route";
import type { Membership, Platform } from "@/lib/models";

type MockRows = { rows: Record<string, unknown>[] };

function mockRows(data: Record<string, unknown>[]): MockRows {
  return { rows: data };
}

beforeAll(() => {
  process.env.DAILY_QUOTA_LIMIT = "10";
});

beforeEach(() => {
  vi.clearAllMocks();
});

const TIERS: Membership[] = ["free", "hasKey", "subscription", "pay-as-you-go"];
const PLATFORMS: Platform[] = ["arduino", "esp32", "stm32"];

describe("checkPlatformAccess", () => {
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

describe("POST /api/projects/start platform validation", () => {
  it("returns 403 when free user requests esp32", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockRows([{ tier: "free" }])
    );

    const req = new Request("http://localhost/api/projects/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        description: "test",
        experienceLevel: "beginner",
        platform: "esp32",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Platform not allowed");
    expect(body.allowedPlatforms).toEqual(["arduino"]);
  });

  it("returns 403 when hasKey user requests stm32", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockRows([{ tier: "hasKey" }])
    );

    const req = new Request("http://localhost/api/projects/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        description: "test",
        experienceLevel: "beginner",
        platform: "stm32",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Platform not allowed");
    expect(body.allowedPlatforms).toEqual(["arduino"]);
  });

  it("allows subscription user to request stm32", async () => {
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockRows([{ tier: "subscription" }]))
      .mockResolvedValueOnce(mockRows([{ daily_quota_remaining: 5, daily_quota_reset_at: new Date().toISOString() }]))
      .mockResolvedValueOnce(mockRows([{ key_value_encrypted: null, key_type: "ai" }]))
      .mockResolvedValueOnce(mockRows([]));

    const req = new Request("http://localhost/api/projects/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        description: "test",
        experienceLevel: "beginner",
        platform: "stm32",
      }),
    });

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.designDraftId).toBeDefined();
  });

  it("defaults to arduino when no platform provided", async () => {
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockRows([{ tier: "free" }]))
      .mockResolvedValueOnce(mockRows([{ daily_quota_remaining: 5, daily_quota_reset_at: new Date().toISOString() }]))
      .mockResolvedValueOnce(mockRows([{ key_value_encrypted: null, key_type: "ai" }]))
      .mockResolvedValueOnce(mockRows([]));

    const req = new Request("http://localhost/api/projects/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        description: "test",
        experienceLevel: "beginner",
      }),
    });

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.designDraftId).toBeDefined();
  });

  it("allows pay-as-you-go user to request esp32", async () => {
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockRows([{ tier: "pay-as-you-go" }]))
      .mockResolvedValueOnce(mockRows([{ daily_quota_remaining: 5, daily_quota_reset_at: new Date().toISOString() }]))
      .mockResolvedValueOnce(mockRows([{ key_value_encrypted: null, key_type: "ai" }]))
      .mockResolvedValueOnce(mockRows([]));

    const req = new Request("http://localhost/api/projects/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        description: "test",
        experienceLevel: "beginner",
        platform: "esp32",
      }),
    });

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.designDraftId).toBeDefined();
  });

  it("returns 403 for unrecognized platform string", async () => {
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockRows([{ tier: "free" }])
    );

    const req = new Request("http://localhost/api/projects/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "user-1",
        description: "test",
        experienceLevel: "beginner",
        platform: "raspberry-pi",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
