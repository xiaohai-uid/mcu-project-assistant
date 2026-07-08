import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/database";
import { encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const result = await db.query(
      "UPDATE api_keys SET is_active = false, revoked_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id",
      [id, userId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Revoke API key failed", { error });
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

    const existing = await db.query(
      "SELECT key_type, label FROM api_keys WHERE id = $1 AND user_id = $2 AND is_active = true",
      [id, userId]
    );

    if (existing.rows.length === 0) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    const { key_type, label } = existing.rows[0];

    await db.query(
      "UPDATE api_keys SET is_active = false, revoked_at = NOW() WHERE id = $1",
      [id]
    );

    const rawKeyValue = uuidv4();
    const keyValueEncrypted = encrypt(rawKeyValue);

    const result = await db.query(
      `INSERT INTO api_keys (id, user_id, key_type, key_value_encrypted, label, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id, label, key_type, created_at`,
      [uuidv4(), userId, key_type, keyValueEncrypted, label]
    );

    const row = result.rows[0];
    return NextResponse.json(
      { id: row.id, label: row.label, keyType: row.key_type, createdAt: row.created_at },
      { status: 201 }
    );
  } catch (error) {
    logger.error("Rotate API key failed", { error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
