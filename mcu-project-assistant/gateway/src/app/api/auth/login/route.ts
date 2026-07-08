import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/database";
import { signToken } from "@/lib/jwt";
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

    const userResult = await db.query(
      "SELECT id, email, password_hash FROM users WHERE email = $1",
      [email]
    );

    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
    }

    const user = userResult.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
    }

    const membershipResult = await db.query(
      "SELECT tier FROM memberships WHERE user_id = $1",
      [user.id]
    );
    const membership = membershipResult.rows[0]?.tier || "free";

    const token = await signToken({ userId: user.id, email: user.email, membership });

    const response = NextResponse.json({ token, userId: user.id, email: user.email, membership });
    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    console.error("Login failed:", error);
    return NextResponse.json({ error: "服务器错误，请稍后重试" }, { status: 500 });
  }
}
