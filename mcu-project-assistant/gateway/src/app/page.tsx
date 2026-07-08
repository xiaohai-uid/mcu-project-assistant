"use client";

import { useRouter } from "next/navigation";
import { s, theme } from "@/lib/styles";

export default function HomePage() {
  const router = useRouter();

  const templates = [
    { title: "智能温控风扇", desc: "根据温度自动调节转速", platform: "Arduino", icon: "🌀" },
    { title: "智能灯控系统", desc: "手机APP远程控制灯光", platform: "ESP32", icon: "💡" },
    { title: "门禁系统", desc: "密码+指纹门禁控制", platform: "Arduino", icon: "🔐" },
    { title: "循迹小车", desc: "自动循迹行驶", platform: "Arduino", icon: "🚗" },
    { title: "环境监测站", desc: "温湿度+空气质量监测", platform: "ESP32", icon: "🌡️" },
    { title: "智能灌溉系统", desc: "土壤湿度自动浇灌", platform: "STM32", icon: "🌱" },
  ];

  return (
    <main style={s.container}>
      <section style={{ textAlign: "center", padding: "48px 0" }}>
        <h1 style={{ fontSize: 36, margin: 0 }}>MCU 项目助手</h1>
        <p style={{ color: theme.gray, fontSize: 16, marginTop: 8 }}>输入想法，AI 自动生成完整单片机方案 — 需求分析、配件推荐、代码、接线图</p>
        <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 24 }}>
          <button onClick={() => router.push("/projects/new")} style={{ ...s.btn("primary"), fontSize: 16, padding: "12px 32px" }}>新手向导</button>
          <button onClick={() => router.push("/projects/new?mode=professional")} style={{ ...s.btn("outline"), fontSize: 16, padding: "12px 32px" }}>专业模式</button>
        </div>
      </section>

      <section>
        <h2>快速开始模板</h2>
        <div style={s.grid2}>
          {templates.map((t) => (
            <div key={t.title} style={{ ...s.card, cursor: "pointer" }}
              onClick={() => router.push(`/projects/new?template=${t.title}`)}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 28 }}>{t.icon}</span>
                <div>
                  <h3 style={{ margin: 0 }}>{t.title}</h3>
                  <p style={{ color: theme.gray, margin: "4px 0 0", fontSize: 14 }}>{t.desc}</p>
                  <span style={{ fontSize: 12, color: theme.info, marginTop: 4 }}>{t.platform}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 48, padding: 24, background: theme.light, borderRadius: 8, display: "flex", gap: 32, justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: theme.primary }}>3</div>
          <div style={{ fontSize: 14, color: theme.gray }}>支持平台</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: theme.primary }}>6+</div>
          <div style={{ fontSize: 14, color: theme.gray }}>预制模板</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: theme.primary }}>AI</div>
          <div style={{ fontSize: 14, color: theme.gray }}>智能生成</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: theme.primary }}>SVG</div>
          <div style={{ fontSize: 14, color: theme.gray }}>接线图</div>
        </div>
      </section>
    </main>
  );
}
