import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const DEFAULT_ORIGINS = "http://localhost:3000";

function getAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS || DEFAULT_ORIGINS;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function isOriginAllowed(origin: string, allowed: string[]): boolean {
  return allowed.includes(origin) || allowed.includes("*");
}

export function corsMiddleware(req: NextRequest): NextResponse | undefined {
  const origin = req.headers.get("origin");
  if (!origin) return undefined;

  const allowedOrigins = getAllowedOrigins();

  if (!isOriginAllowed(origin, allowedOrigins)) {
    return undefined;
  }

  if (req.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const response = NextResponse.next();
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}
