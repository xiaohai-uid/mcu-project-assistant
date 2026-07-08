import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/database";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const format = _req.nextUrl.searchParams.get("format") || "zip";
    const result = await db.query(
      "SELECT generated_code, svg_content, pin_table FROM design_drafts WHERE id = $1",
      [id]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const row = result.rows[0];

    if (format === "ino") {
      return new NextResponse(row.generated_code || "", {
        headers: { "Content-Type": "text/plain", "Content-Disposition": `attachment; filename="project-${id}.ino"` },
      });
    }

    if (format === "svg") {
      return new NextResponse(row.svg_content || "", {
        headers: { "Content-Type": "image/svg+xml", "Content-Disposition": `attachment; filename="schematic-${id}.svg"` },
      });
    }

    const code = row.generated_code || "// No code generated";
    const svg = row.svg_content || "<svg xmlns='http://www.w3.org/2000/svg'><text x='10' y='20'>No schematic</text></svg>";
    const body = JSON.stringify({ code, svg, pins: row.pin_table });
    return new NextResponse(body, {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="project-${id}.json"` },
    });
  } catch {
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
