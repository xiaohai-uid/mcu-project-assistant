"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { s, theme } from "@/lib/styles";
import { useState } from "react";

function NewProjectForm() {
  const router = useRouter();
  const params = useSearchParams();
  const isPro = params.get("mode") === "professional";
  const template = params.get("template");

  const [description, setDescription] = useState(template ? `帮我做一个${template}` : "");
  const [platform, setPlatform] = useState("arduino");
  const [budget, setBudget] = useState("standard");

  const handleSubmit = async () => {
    if (!description.trim()) return;
    const res = await fetch("/api/projects/start", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawDescription: description,
        experienceLevel: isPro ? "professional" : "beginner",
        ...(isPro ? { platform, budgetTier: budget } : {}),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      router.push(`/projects/${data.id}/review`);
    }
  };

  return (
    <main style={s.container}>
      <h1>{isPro ? "专业模式" : "新建项目"}</h1>
      {!isPro && <div style={{ ...s.card, marginBottom: 16 }}><p>描述你的单片机项目想法，AI 将自动分析需求并推荐方案。</p></div>}

      {isPro && (
        <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
          <div>
            <label style={s.label}>平台</label>
            <select style={s.select} value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="arduino">Arduino</option>
              <option value="esp32">ESP32</option>
              <option value="stm32">STM32</option>
            </select>
          </div>
          <div>
            <label style={s.label}>预算</label>
            <select style={s.select} value={budget} onChange={(e) => setBudget(e.target.value)}>
              <option value="budget">丐版</option>
              <option value="standard">标准</option>
              <option value="premium">旗舰</option>
            </select>
          </div>
        </div>
      )}

      <label style={s.label}>{isPro ? "项目需求" : "项目想法"}</label>
      <textarea style={{ ...s.textarea, height: isPro ? 150 : 120 }} value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={isPro ? "详细描述项目需求和功能要求..." : "例如：做一个自动浇花系统，检测土壤湿度，干燥时自动浇水..."} />
      <button onClick={handleSubmit} disabled={!description.trim()}
        style={{ ...s.btn("primary"), marginTop: 16, opacity: description.trim() ? 1 : 0.5 }}>
        {isPro ? "开始生成" : "开始分析需求"}
      </button>
    </main>
  );
}

export default function NewProjectPage() {
  return (
    <Suspense fallback={<main style={s.container}><p>加载中...</p></main>}>
      <NewProjectForm />
    </Suspense>
  );
}
