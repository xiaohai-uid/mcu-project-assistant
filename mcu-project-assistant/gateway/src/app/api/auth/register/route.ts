import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/database";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await db.query(
      `WITH new_user AS (
        INSERT INTO users (email, password_hash)
        VALUES ($1, $2) RETURNING id, email
      )
      INSERT INTO memberships (user_id, tier)
      SELECT id, 'free' FROM new_user
      RETURNING (SELECT id FROM new_user), (SELECT email FROM new_user)`,
      [email, passwordHash]
    );

    return NextResponse.json({ userId: result.rows[0].id, email: result.rows[0].email });
  } catch {
    return NextResponse.json({ error: "Registration failed" }, { status: 400 });
  }
}
