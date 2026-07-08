"use client";

import { useRouter } from "next/navigation";
import { s, theme } from "@/lib/styles";
import { useState, useEffect } from "react";

interface Project {
  id: string;
  raw_description: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects").then(r => r.json()).then(d => { if (Array.isArray(d)) setProjects(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <main style={s.container}><p>加载中...</p></main>;

  return (
    <main style={s.container}>
      <div style={s.flexBetween}>
        <h1>项目历史</h1>
        <button onClick={() => router.push("/projects/new")} style={s.btn("primary")}>新建项目</button>
      </div>
      {projects.length === 0 ? (
        <div style={{ ...s.card, textAlign: "center", padding: 48, color: theme.gray }}>
          <p>还没有项目</p>
          <button onClick={() => router.push("/projects/new")} style={s.btn("primary")}>创建第一个项目</button>
        </div>
      ) : (
        <table style={s.table}>
          <thead><tr>
            {["项目名称", "状态", "创建时间", "操作"].map(h => <th key={h} style={s.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td style={s.td}>{p.raw_description?.slice(0, 40)}...</td>
                <td style={s.td}><span style={s.badge(p.status)}>{p.status}</span></td>
                <td style={s.td}>{new Date(p.created_at).toLocaleString("zh-CN")}</td>
                <td style={s.td}>
                  <button onClick={() => router.push(`/projects/${p.id}/review`)} style={s.btn("primary")}>查看</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
