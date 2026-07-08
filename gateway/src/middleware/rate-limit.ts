import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";

interface RateLimitEntry {
  timestamps: number[];
}

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

const store = new Map<string, RateLimitEntry>();

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

  let entry = store.get(ip);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(ip, entry);
  }

  entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

  if (entry.timestamps.length >= limit) {
    const oldest = entry.timestamps[0];
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

  entry.timestamps.push(now);
  const resetMs = now + windowMs;

  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit", String(limit));
  response.headers.set("X-RateLimit-Remaining", String(limit - entry.timestamps.length));
  response.headers.set("X-RateLimit-Reset", String(Math.ceil(resetMs / 1000)));
  return response;
}
