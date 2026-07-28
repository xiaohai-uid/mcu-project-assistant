import { NextResponse } from "next/server";
import { db } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await db.query(
      `SELECT id, title, description, template_data, created_at
       FROM project_templates WHERE is_public = true ORDER BY title ASC`
    );

    const templates = result.rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      tags: row.template_data?.tags || [],
      platform: row.template_data?.platform || "arduino",
      experienceLevel: row.template_data?.experienceLevel || "beginner",
      createdAt: row.created_at,
    }));

    return NextResponse.json(templates);
  } catch (error) {
    console.error("List templates failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
