import { NextRequest, NextResponse } from "next/server";
import { restoreSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ snapshotId: string }> }
) {
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { snapshotId } = await params;
    const result = await restoreSnapshot(snapshotId, userId);
    return NextResponse.json({
      message: "Snapshot restored successfully",
      draftId: result.draftId,
      snapshotName: result.name,
    });
  } catch (error: any) {
    if (error.message === "Snapshot not found") {
      return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    }
    console.error("Restore snapshot failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
