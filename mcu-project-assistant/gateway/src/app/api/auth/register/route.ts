import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/database";
import { isValidEmail, isValidPassword } from "@/lib/validation";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: "邮箱格式错误" }, { status: 400 });
    }

    if (!password || !isValidPassword(password)) {
      return NextResponse.json(
        { error: "密码至少需要 8 位" },
        { status: 400 }
      );
    }

    const existing = await db.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
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
  } catch (error) {
    console.error("Registration failed:", error);
    return NextResponse.json({ error: "服务器错误，请稍后重试" }, { status: 500 });
  }
}
