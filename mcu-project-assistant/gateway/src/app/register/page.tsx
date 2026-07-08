"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { s, theme } from "@/lib/styles";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "注册失败");
        return;
      }
      setSuccess(true);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <main style={s.container}>
        <div style={{ maxWidth: 400, margin: "60px auto", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>注册成功</h1>
          <p style={{ color: theme.gray, fontSize: 14, marginBottom: 24 }}>
            现在你可以登录使用了
          </p>
          <button onClick={() => router.push("/login")} style={s.btn("primary")}>
            去登录
          </button>
        </div>
      </main>
    );
  }

  return (
    <main style={s.container}>
      <div style={{ maxWidth: 400, margin: "60px auto" }}>
        <h1 style={{ fontSize: 24, textAlign: "center", marginBottom: 8 }}>注册</h1>
        <p style={{ textAlign: "center", color: theme.gray, fontSize: 14, marginBottom: 24 }}>
          创建账号，免费使用 MCU 项目助手
        </p>

        <form onSubmit={handleSubmit}>
          {error && (
            <div style={{ background: "#fff1f2", color: "#be123c", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}

          <label style={s.label}>邮箱</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            style={s.input} placeholder="your@email.com" required />

          <label style={{ ...s.label, marginTop: 16 }}>密码</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            style={s.input} placeholder="至少 8 位密码" required minLength={8} />

          <button type="submit" disabled={loading}
            style={{ ...s.btn("primary", true), marginTop: 24, opacity: loading ? 0.6 : 1 }}>
            {loading ? "注册中..." : "注册"}
          </button>
        </form>

        <p style={{ textAlign: "center", fontSize: 13, color: theme.gray, marginTop: 16 }}>
          已有账号？
          <span style={{ color: theme.primary, cursor: "pointer", marginLeft: 4 }}
            onClick={() => router.push("/login")}>登录</span>
        </p>
      </div>
    </main>
  );
}
