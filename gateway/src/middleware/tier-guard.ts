import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";

const tierRank: Record<string, number> = {
  free: 0,
  hasKey: 0,
  subscription: 1,
  "pay-as-you-go": 1,
};

const PROFESSIONAL_ROUTES: { method: string; pattern: RegExp }[] = [
  { method: "PUT", pattern: /^\/api\/projects\/[^/]+\/code$/ },
  { method: "PUT", pattern: /^\/api\/projects\/[^/]+\/pins$/ },
  { method: "PUT", pattern: /^\/api\/projects\/[^/]+\/components$/ },
  { method: "GET", pattern: /^\/api\/projects\/[^/]+\/export$/ },
];

function isProfessionalRoute(method: string, pathname: string): boolean {
  return PROFESSIONAL_ROUTES.some(
    (r) => r.method === method && r.pattern.test(pathname)
  );
}

export function requireTier(minTier: string) {
  return async (req: NextRequest): Promise<NextResponse | undefined> => {
    const pathname = req.nextUrl.pathname;
    if (!isProfessionalRoute(req.method, pathname)) return undefined;

    const membership = req.headers.get("x-membership");

    if (membership) {
      const userRank = tierRank[membership] ?? 0;
      const requiredRank = tierRank[minTier] ?? 1;

      if (userRank < requiredRank) {
        return NextResponse.json(
          {
            error: "Professional feature. Upgrade required.",
            upgrade_url: "/membership",
          },
          { status: 403 }
        );
      }

      return undefined;
    }

    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = await verifyToken(auth.slice(7));
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const userRank = tierRank[payload.membership] ?? 0;
    const requiredRank = tierRank[minTier] ?? 1;

    if (userRank < requiredRank) {
      return NextResponse.json(
        {
          error: "Professional feature. Upgrade required.",
          upgrade_url: "/membership",
        },
        { status: 403 }
      );
    }

    return undefined;
  };
}
