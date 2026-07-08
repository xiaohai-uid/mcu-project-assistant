import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

interface LoginEntry {
  attempts: number;
  windowStart: number;
}

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

const store = new Map<string, LoginEntry>();

function getIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "127.0.0.1"
  );
}

export function loginRateLimit(req: NextRequest): NextResponse | undefined {
  const pathname = req.nextUrl.pathname;
  if (req.method !== "POST" || !pathname.startsWith("/api/auth/")) {
    return undefined;
  }

  const ip = getIp(req);
  const now = Date.now();
  const entry = store.get(ip);

  if (entry) {
    if (now - entry.windowStart > WINDOW_MS) {
      store.set(ip, { attempts: 1, windowStart: now });
      return undefined;
    }

    entry.attempts++;

    if (entry.attempts > MAX_ATTEMPTS) {
      const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
      return NextResponse.json(
        { error: "Too many requests. Try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        }
      );
    }
  } else {
    store.set(ip, { attempts: 1, windowStart: now });
  }

  return undefined;
}