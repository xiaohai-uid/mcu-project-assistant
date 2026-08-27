"use client";

import { useParams, useRouter } from "next/navigation";
import { s, theme } from "@/lib/styles";
import { useState, useEffect } from "react";

interface Snapshot {
  id: string; created_at: string;
}

export default function ExportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  useEffect(() => {
    fetch(`/api/projects/${id}`).then(r => r.json()).then(d => { /* snapshot list */
    });
    fetch(`/api/projects/${id}/snapshots`).then(r => r.json()).then(d => setSnapshots(Array.isArray(d) ? d : [])).catch(() => {});
  }, [id]);

  const exportProject = async (fmt: string) => {
    const res = await fetch(`/api/projects/${id}/export?format=${fmt}`);
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `project-${id}.${fmt === "zip" ? "zip" : fmt}`; a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <main style={s.container}>
      <h1>项目导出</h1>
      <div style={{ ...s.card, marginTop: 16 }}>
        <h3>导出格式</h3>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={() => exportProject("ino")} style={s.btn("primary")}>下载 .ino</button>
          <button onClick={() => exportProject("svg")} style={s.btn("primary")}>下载 SVG</button>
          <button onClick={() => exportProject("zip")} style={s.btn("success")}>下载全部 (ZIP)</button>
        </div>
      </div>
      <div style={{ ...s.card, marginTop: 16 }}>
        <div style={s.flexBetween}>
          <h3>版本快照</h3>
          <button onClick={() => fetch(`/api/projects/snapshot`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: id }) }).then(() => window.location.reload())}
            style={s.btn("outline")}>创建快照</button>
        </div>
        {snapshots.length === 0 ? (
          <p style={{ color: theme.gray }}>暂无快照</p>
        ) : (
          <table style={s.table}>
            <thead><tr>
              {["版本", "时间", "操作"].map(h => <th key={h} style={s.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {snapshots.map((snap, i) => (
                <tr key={snap.id}>
                  <td style={s.td}>v{snapshots.length - i}</td>
                  <td style={s.td}>{new Date(snap.created_at).toLocaleString("zh-CN")}</td>
                  <td style={s.td}><button onClick={() => router.push(`/api/snapshots/${snap.id}/restore`)} style={s.btn("outline")}>恢复</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <button onClick={() => router.push(`/projects/${id}/schematic`)} style={{ ...s.btn("outline"), marginTop: 16 }}>返回接线图</button>
    </main>
  );
}
