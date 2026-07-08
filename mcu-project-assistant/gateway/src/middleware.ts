import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";
import { corsMiddleware } from "@/middleware/cors";
import { rateLimitMiddleware } from "@/middleware/rate-limit";
import { securityHeadersMiddleware } from "@/middleware/security-headers";
import { requireTier } from "@/middleware/tier-guard";
import { loginRateLimit } from "@/middleware/login-rate-limit";
import { withMiddlewareErrorHandler } from "@/middleware/error-handler";

const protectedPaths = [
  "/api/projects",
  "/api/auth/profile",
  "/api/membership",
  "/api/billing",
];

function mergeHeaders(target: Headers, source: Headers): void {
  for (const [k, v] of source.entries()) {
    target.set(k, v);
  }
}

function getToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return req.cookies.get("token")?.value ?? null;
}

async function _middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  const corsRes = corsMiddleware(req);
  if (corsRes && req.method === "OPTIONS") return corsRes;

  const headerRes = securityHeadersMiddleware(req);

  const rateLimitRes = await rateLimitMiddleware(req);
  if (rateLimitRes?.status === 429) return rateLimitRes;

  const loginLimitRes = loginRateLimit(req);
  if (loginLimitRes) return loginLimitRes;

  if (protectedPaths.some((p) => pathname.startsWith(p))) {
    const token = getToken(req);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-user-id", payload.userId);
    requestHeaders.set("x-membership", payload.membership);

    const authRes = NextResponse.next({ request: { headers: requestHeaders } });

    const tierRes = await requireTier("subscription")(new NextRequest(req));
    if (tierRes) return tierRes;

    if (corsRes) mergeHeaders(authRes.headers, corsRes.headers);
    if (headerRes) mergeHeaders(authRes.headers, headerRes.headers);
    if (rateLimitRes) mergeHeaders(authRes.headers, rateLimitRes.headers);

    return authRes;
  }

  const nextRes = NextResponse.next();
  if (corsRes) mergeHeaders(nextRes.headers, corsRes.headers);
  if (headerRes) mergeHeaders(nextRes.headers, headerRes.headers);
  if (rateLimitRes) mergeHeaders(nextRes.headers, rateLimitRes.headers);

  return nextRes;
}

export const middleware = withMiddlewareErrorHandler(_middleware);

export const config = {
  matcher: ["/api/:path*"],
};