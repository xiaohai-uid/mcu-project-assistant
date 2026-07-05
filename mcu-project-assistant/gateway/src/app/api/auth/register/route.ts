import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/database";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    if (!password || password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    const existing = await db.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await db.query(
      `WITH new_user AS (
        INSERT INTO users (email, password_hash)
        VALUES ($1, $2) RETURNING id, email
      )
      INSERT INTO memberships (user_id, tier, daily_quota_remaining)
      SELECT id, 'free', 10 FROM new_user
      RETURNING (SELECT id FROM new_user), (SELECT email FROM new_user)`,
      [email, passwordHash]
    );

    return NextResponse.json({ userId: result.rows[0].id, email: result.rows[0].email });
  } catch {
    return NextResponse.json({ error: "Registration failed" }, { status: 400 });
  }
}
