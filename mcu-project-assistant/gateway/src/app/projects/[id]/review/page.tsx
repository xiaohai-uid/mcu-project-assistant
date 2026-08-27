"use client";

import { useParams, useRouter } from "next/navigation";
import { s, theme } from "@/lib/styles";
import { useState, useEffect } from "react";

interface Project {
  id: string; raw_description: string; requirement: string; status: string;
}

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [confirmed, setConfirmed] = useState("");

  useEffect(() => {
    fetch(`/api/projects/${id}`).then(r => r.json()).then(setProject);
  }, [id]);

  if (!project) return <main style={s.container}><p>加载中...</p></main>;

  const req = project.requirement ? (typeof project.requirement === "string" ? JSON.parse(project.requirement) : project.requirement) : {};

  return (
    <main style={s.container}>
      <h1>需求确认</h1>
      <div style={s.card}>
        <h3>原始描述</h3>
        <p>{project.raw_description}</p>
      </div>
      {req.structured && (
        <div style={{ ...s.card, marginTop: 16 }}>
          <h3>AI 分析结果</h3>
          <p><strong>核心功能：</strong>{req.structured.coreFunction}</p>
          <p><strong>传感器：</strong>{(req.structured.sensors || []).join(", ")}</p>
          <p><strong>执行器：</strong>{(req.structured.actuators || []).join(", ")}</p>
          <p><strong>通信方式：</strong>{req.structured.communication || "无"}</p>
          <p><strong>电源要求：</strong>{req.structured.power || "未指定"}</p>
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <label style={s.label}>补充说明</label>
        <textarea style={s.textarea} rows={3} value={confirmed} onChange={e => setConfirmed(e.target.value)} placeholder="如有需要补充或修正的需求，请在此说明..." />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={() => router.push(`/projects/${id}/recommendations`)} style={s.btn("primary")}>确认，下一步</button>
        <button onClick={() => router.push("/projects/new")} style={s.btn("outline")}>返回修改</button>
      </div>
    </main>
  );
}
