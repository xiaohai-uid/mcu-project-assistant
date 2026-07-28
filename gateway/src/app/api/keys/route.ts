import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/database";
import { encrypt } from "@/lib/encryption";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { label, keyType } = body;

    if (!label) {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }
    if (!keyType) {
      return NextResponse.json({ error: "keyType is required" }, { status: 400 });
    }

    const rawKeyValue = uuidv4();
    const keyValueEncrypted = encrypt(rawKeyValue);

    const result = await db.query(
      `INSERT INTO api_keys (id, user_id, key_type, key_value_encrypted, label, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id, label, key_type, created_at`,
      [uuidv4(), userId, keyType, keyValueEncrypted, label]
    );

    const row = result.rows[0];
    return NextResponse.json(
      { id: row.id, label: row.label, keyType: row.key_type, createdAt: row.created_at },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create API key failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.query(
      "SELECT id, label, key_type, created_at FROM api_keys WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC",
      [userId]
    );

    const keys = result.rows.map((row: { id: string; label: string; key_type: string; created_at: string }) => ({
      id: row.id,
      label: row.label,
      keyType: row.key_type,
      createdAt: row.created_at,
    }));

    return NextResponse.json(keys);
  } catch (error) {
    console.error("List API keys failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
