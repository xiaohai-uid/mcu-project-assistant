import { NextRequest, NextResponse } from "next/server";
import { getQuotaStatus } from "@/lib/daily-quota";

export async function GET(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const status = await getQuotaStatus(userId);
    if (!status) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(status);
  } catch {
    return NextResponse.json({ error: "Failed to fetch quota status" }, { status: 500 });
  }
}
