"use client";

import { useRouter } from "next/navigation";
import { s, theme } from "@/lib/styles";
import { useState, useEffect } from "react";

const plans = [
  { id: "free", label: "免费", price: "¥0/月", quota: "每日 3 次 AI", features: ["基础模板", "静态价格参考", "代码只读预览"] },
  { id: "hasKey", label: "BYO Key", price: "自备 Key", quota: "无限（按 Key 计费）", features: ["自选 AI 模型", "实时比价", "代码导出", "专业编辑模式"] },
  { id: "subscription", label: "会员", price: "¥29/月", quota: "无限 AI", features: ["全部 Key 功能", "高级 AI 模型", "优先队列", "所有导出格式"] },
];

export default function MembershipPage() {
  const router = useRouter();
  const [currentPlan, setCurrentPlan] = useState("free");
  const [usage, setUsage] = useState({ used: 0, limit: 3, balance: 0 });

  useEffect(() => {
    fetch("/api/membership").then(r => r.json()).then(d => setCurrentPlan(d.plan || "free")).catch(() => {});
    fetch("/api/quota").then(r => r.json()).then(d => setUsage(d)).catch(() => {});
  }, []);

  return (
    <main style={s.container}>
      <h1>会员中心</h1>
      <div style={{ background: theme.light, padding: 16, borderRadius: 8, marginBottom: 16, display: "flex", gap: 24 }}>
        <div><strong>当前套餐：</strong>{plans.find(p => p.id === currentPlan)?.label || currentPlan}</div>
        <div><strong>已用/限额：</strong>{usage.used}/{usage.limit}</div>
        <div><strong>余额：</strong>¥{usage.balance}</div>
      </div>
      <div style={s.grid2}>
        {plans.map(p => {
          const active = p.id === currentPlan;
          return (
            <div key={p.id} style={{ ...s.card, border: active ? `2px solid ${theme.primary}` : `1px solid ${theme.border}`, position: "relative" }}>
              {active && <span style={{ position: "absolute", top: 8, right: 8, background: theme.primary, color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>当前</span>}
              <h3>{p.label}</h3>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{p.price}</div>
              <div style={{ fontSize: 14, color: theme.gray, marginTop: 4 }}>{p.quota}</div>
              <ul style={{ padding: "12px 0 0 20px", margin: 0 }}>
                {p.features.map((f, i) => <li key={i} style={{ fontSize: 14, marginBottom: 4 }}>{f}</li>)}
              </ul>
              {!active && p.id !== "free" && (
                <button onClick={() => router.push(`/api/membership/upgrade?plan=${p.id}`)} style={{ ...s.btn(p.id === "subscription" ? "primary" : "outline"), marginTop: 12, width: "100%" }}>
                  开通
                </button>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
