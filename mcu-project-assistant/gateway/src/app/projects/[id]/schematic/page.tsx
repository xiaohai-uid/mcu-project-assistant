"use client";

import { useParams, useRouter } from "next/navigation";
import { s, theme } from "@/lib/styles";
import { useState, useEffect } from "react";

// Strip dangerous elements/attributes from SVG before rendering (XSS hardening)
function sanitizeSvg(raw: string): string {
  if (typeof window === "undefined" || !raw) return "";
  const doc = new DOMParser().parseFromString(raw, "image/svg+xml");
  // Remove <script> and event-handler attributes
  doc.querySelectorAll("script").forEach(el => el.remove());
  doc.querySelectorAll("*").forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = attr.value.toLowerCase().trim();
      if (name.startsWith("on") || value.startsWith("javascript:")) {
        el.removeAttribute(attr.name);
      }
    });
  });
  // Drop external resource references
  doc.querySelectorAll("a[href]").forEach(el => {
    const href = el.getAttribute("href") || "";
    if (href.startsWith("javascript:")) el.removeAttribute("href");
  });
  return doc.documentElement.outerHTML;
}

export default function SchematicViewerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [svg, setSvg] = useState("");
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    fetch(`/api/projects/${id}`).then(r => r.json()).then(d => {
      if (d.svg_content) setSvg(sanitizeSvg(d.svg_content));
    });
  }, [id]);

  return (
    <main style={s.container}>
      <div style={s.flexBetween}>
        <h1>接线图</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} style={s.btn("outline")}>-</button>
          <span style={{ fontSize: 14 }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} style={s.btn("outline")}>+</button>
        </div>
      </div>
      <div style={{ ...s.card, overflow: "auto", textAlign: "center", background: "#fff" }}>
        {svg ? (
          <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left", display: "inline-block" }}
            dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <p style={{ color: theme.gray, padding: 48 }}>接线图生成中...</p>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={() => router.push(`/projects/${id}/pins`)} style={s.btn("primary")}>编辑引脚</button>
        <button onClick={() => router.push(`/projects/${id}/export`)} style={s.btn("success")}>导出项目</button>
        <button onClick={() => router.push(`/projects/${id}/code`)} style={s.btn("outline")}>返回代码</button>
      </div>
    </main>
  );
}
