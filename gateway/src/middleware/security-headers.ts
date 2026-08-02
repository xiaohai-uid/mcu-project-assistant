import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const STATIC_ASSET_PATTERNS = [
  /\.(png|jpg|jpeg|gif|svg|webp|ico|avif)$/i,
  /\.(woff2?|eot|ttf|otf)$/i,
];

const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'",
};

function isStaticAsset(pathname: string): boolean {
  return STATIC_ASSET_PATTERNS.some((p) => p.test(pathname));
}

export function securityHeadersMiddleware(req: NextRequest): NextResponse | undefined {
  if (isStaticAsset(req.nextUrl.pathname)) {
    return undefined;
  }

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  // x-request-id: propagate from upstream or generate new
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  response.headers.set("x-request-id", requestId);

  return response;
}
