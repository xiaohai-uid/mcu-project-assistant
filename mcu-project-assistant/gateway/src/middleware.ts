import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";

const protectedPaths = ["/api/projects", "/api/auth/profile"];

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));
  if (!isProtected) {
    return NextResponse.next();
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);

  if (!payload) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-user-id", payload.userId);
  requestHeaders.set("x-membership", payload.membership);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/api/:path*"],
};
