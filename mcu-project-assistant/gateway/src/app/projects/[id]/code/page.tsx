"use client";

import { useParams, useRouter } from "next/navigation";
import { s, theme } from "@/lib/styles";
import { useState, useEffect } from "react";
import { apiPut } from "@/lib/api";

export default function CodePreviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [editable, setEditable] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${id}`).then(r => r.json()).then(d => {
      setCode(d.generated_code || "// 代码生成中...");
    });
  }, [id]);

  const handleSave = async () => {
    await apiPut(`/api/projects/${id}/code`, { generatedCode: code });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <main style={s.container}>
      <div style={s.flexBetween}>
        <h1>代码预览</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { setEditable(!editable); }} style={s.btn(editable ? "success" : "outline")}>
            {editable ? "退出编辑" : "编辑代码"}
          </button>
          <button onClick={() => router.push(`/projects/${id}/schematic`)} style={s.btn("primary")}>查看接线图</button>
        </div>
      </div>
      {editable && <div style={{ background: "#fff3cd", padding: "8px 16px", borderRadius: 4, margin: "8px 0", fontSize: 14 }}>编辑模式 — 修改后请保存</div>}
      <pre style={{ background: "#1e1e1e", color: "#d4d4d4", padding: 16, borderRadius: 8, overflow: "auto", maxHeight: 500, fontSize: 13, lineHeight: 1.5 }}>
        {editable ? (
          <textarea style={{ width: "100%", minHeight: 400, background: "#1e1e1e", color: "#d4d4d4", border: "none", outline: "none", fontFamily: "monospace", fontSize: 13, resize: "vertical" }}
            value={code} onChange={e => setCode(e.target.value)} />
        ) : (
          <code>{code}</code>
        )}
      </pre>
      {editable && (
        <button onClick={handleSave} style={{ ...s.btn("success"), marginTop: 8 }}>
          {saved ? "已保存 ✓" : "保存代码"}
        </button>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={() => router.push(`/projects/${id}/export`)} style={s.btn("primary")}>导出项目</button>
        <button onClick={() => router.push(`/projects/${id}/recommendations`)} style={s.btn("outline")}>返回配件</button>
      </div>
    </main>
  );
}
