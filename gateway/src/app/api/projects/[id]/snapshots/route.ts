import { NextRequest, NextResponse } from "next/server";
import { createSnapshot, listSnapshots } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const snapshots = await listSnapshots(id, userId);
    return NextResponse.json(snapshots);
  } catch (error: any) {
    if (error.message === "Design draft not found") {
      return NextResponse.json({ error: "Design draft not found" }, { status: 404 });
    }
    console.error("List snapshots failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const body = await req.json();
    if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const snapshot = await createSnapshot(id, userId, { name: body.name.trim(), isAuto: false });
    return NextResponse.json(snapshot, { status: 201 });
  } catch (error: any) {
    if (error.message === "Design draft not found") {
      return NextResponse.json({ error: "Design draft not found" }, { status: 404 });
    }
    console.error("Create snapshot failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
