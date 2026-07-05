"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function HomePage() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [mode, setMode] = useState<"beginner" | "professional">("beginner");

  const templates = [
    { title: "智能温控风扇", description: "根据温度自动调节转速" },
    { title: "智能灯控系统", description: "手机APP远程控制灯光" },
    { title: "门禁系统", description: "密码+指纹门禁控制" },
    { title: "循迹小车", description: "自动循迹行驶" },
  ];

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>MCU 项目助手</h1>
        <div>
          <button onClick={() => router.push(isLoggedIn ? "/settings" : "/api/auth")}>
            {isLoggedIn ? "设置" : "登录"}
          </button>
          <button onClick={() => router.push("/api/membership")} style={{ marginLeft: 8 }}>
            {isLoggedIn ? "会员中心" : "开通会员"}
          </button>
        </div>
      </header>

      <section style={{ marginTop: 32 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => setMode("beginner")}
            style={{ background: mode === "beginner" ? "#007bff" : "#eee", color: mode === "beginner" ? "#fff" : "#333", padding: "8px 16px", border: "none", borderRadius: 4, cursor: "pointer" }}
          >
            新手向导
          </button>
          <button
            onClick={() => setMode("professional")}
            style={{ background: mode === "professional" ? "#007bff" : "#eee", color: mode === "professional" ? "#fff" : "#333", padding: "8px 16px", border: "none", borderRadius: 4, cursor: "pointer" }}
          >
            专业模式
          </button>
        </div>

        {!isLoggedIn && (
          <div style={{ background: "#fff3cd", padding: 16, borderRadius: 4, marginBottom: 16 }}>
            未登录。您可以使用每日 AI 配额，或绑定 API Key 获取更多调用次数。
          </div>
        )}

        {mode === "beginner" ? (
          <>
            <p>选择一个预制模板开始，或告诉我想做什么：</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
              {templates.map((t) => (
                <div key={t.title} style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8 }}>
                  <h3>{t.title}</h3>
                  <p style={{ color: "#666" }}>{t.description}</p>
                </div>
              ))}
            </div>
            <textarea
              placeholder="描述你的单片机项目想法..."
              rows={4}
              style={{ width: "100%", marginTop: 16, padding: 8 }}
            />
            <button style={{ marginTop: 8, padding: "8px 24px", background: "#007bff", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
              开始生成
            </button>
          </>
        ) : (
          <>
            <p>专业模式：自定义平台、配件和代码。</p>
            <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
              <div>
                <label>平台：</label>
                <select>
                  <option>Arduino</option>
                  <option>ESP32</option>
                  <option>STM32</option>
                </select>
              </div>
              <div>
                <label>预算：</label>
                <select>
                  <option>丐版</option>
                  <option>标准</option>
                  <option>旗舰</option>
                </select>
              </div>
            </div>
            <textarea
              placeholder="描述项目需求..."
              rows={4}
              style={{ width: "100%", marginTop: 16, padding: 8 }}
            />
            <button style={{ marginTop: 8, padding: "8px 24px", background: "#28a745", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
              开始生成
            </button>
          </>
        )}
      </section>
    </main>
  );
}
