import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";
import { logger } from "@/lib/logger";

// ─── Abstract Store Interface ─────────────────────────────────
interface RateLimitStore {
  get(key: string): Promise<number[] | null>;
  set(key: string, timestamps: number[], ttlMs: number): Promise<void>;
}

/** In-memory store (single-instance, development fallback) */
class MemoryStore implements RateLimitStore {
  private map = new Map<string, { timestamps: number[]; expiresAt: number }>();

  async get(key: string): Promise<number[] | null> {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return entry.timestamps;
  }

  async set(key: string, timestamps: number[], ttlMs: number): Promise<void> {
    this.map.set(key, { timestamps, expiresAt: Date.now() + ttlMs });
    // Periodic cleanup
    if (this.map.size > 10000) {
      const now = Date.now();
      for (const [k, v] of this.map) {
        if (now > v.expiresAt) this.map.delete(k);
      }
    }
  }
}

/** Redis store (production, multi-instance) */
class RedisStore implements RateLimitStore {
  private client: any = null;
  private prefix = "rl:";

  constructor(private url: string) {}

  private async getClient() {
    if (!this.client) {
      // Dynamic import to avoid hard dependency
      const { createClient } = await import("redis");
      this.client = createClient({ url: this.url });
      this.client.on("error", (err: Error) => logger.error("Redis error", { error: err.message }));
      await this.client.connect();
      logger.info("Redis rate-limit store connected");
    }
    return this.client;
  }

  async get(key: string): Promise<number[] | null> {
    const client = await this.getClient();
    const raw = await client.get(this.prefix + key);
    return raw ? JSON.parse(raw) : null;
  }

  async set(key: string, timestamps: number[], ttlMs: number): Promise<void> {
    const client = await this.getClient();
    await client.set(this.prefix + key, JSON.stringify(timestamps), { PX: ttlMs });
  }
}

// ─── Store Initialization ─────────────────────────────────────
function createStore(): RateLimitStore {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    return new RedisStore(redisUrl);
  }
  logger.warn("REDIS_URL not set — using in-memory rate limit store (not suitable for multi-instance)");
  return new MemoryStore();
}

const store = createStore();

// ─── Rate Limiting Logic ──────────────────────────────────────
const windowMs = 60_000;
const tierLimits: Record<string, number> = {
  free: 60,
  professional: 300,
  enterprise: 1000,
};

const mapMembershipToTier: Record<string, string> = {
  free: "free",
  hasKey: "free",
  subscription: "professional",
  "pay-as-you-go": "professional",
};

const FALLBACK_LIMIT = 60;

async function getTier(req: NextRequest): Promise<string> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return "free";
  const payload = await verifyToken(auth.slice(7));
  if (!payload) return "free";
  return mapMembershipToTier[payload.membership] ?? "free";
}

function getClientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? req.headers.get("x-real-ip")
    ?? "127.0.0.1";
}

export async function rateLimitMiddleware(req: NextRequest): Promise<NextResponse | undefined> {
  const tier = await getTier(req);
  const limit = tierLimits[tier] ?? FALLBACK_LIMIT;
  const ip = getClientIp(req);
  const now = Date.now();

  let timestamps = (await store.get(ip)) || [];
  timestamps = timestamps.filter((ts) => now - ts < windowMs);

  if (timestamps.length >= limit) {
    const oldest = timestamps[0];
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfter },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil((oldest + windowMs) / 1000)),
        },
      }
    );
  }

  timestamps.push(now);
  await store.set(ip, timestamps, windowMs);

  const resetMs = now + windowMs;
  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit", String(limit));
  response.headers.set("X-RateLimit-Remaining", String(limit - timestamps.length));
  response.headers.set("X-RateLimit-Reset", String(Math.ceil(resetMs / 1000)));
  return response;
}
