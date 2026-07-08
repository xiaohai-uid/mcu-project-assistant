"use client";

import { useRouter, usePathname } from "next/navigation";
import { s, theme } from "@/lib/styles";
import { useState, useEffect } from "react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loggedIn, setLoggedIn] = useState(false);
  const [mode, setMode] = useState<"beginner" | "professional">("beginner");

  useEffect(() => { setLoggedIn(!!localStorage.getItem("token")); }, [pathname]);

  const navLinks = [
    { label: "首页", path: "/" },
    { label: "新项目", path: "/projects/new" },
    { label: "项目历史", path: "/projects" },
    { label: "会员中心", path: "/membership" },
    { label: "API Key", path: "/keys" },
  ];

  return (
    <html lang="zh-CN">
      <head>
        <title>MCU 项目助手</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", background: theme.bgLight, color: theme.dark }}>
        <header style={s.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <strong style={{ fontSize: 18, cursor: "pointer" }} onClick={() => router.push("/")}>MCU 项目助手</strong>
            <nav style={{ display: "flex", gap: 16 }}>
              {navLinks.map((l) => (
                <span key={l.path} onClick={() => router.push(l.path)}
                  style={{ cursor: "pointer", fontSize: 14, color: pathname === l.path ? theme.primary : theme.gray, fontWeight: pathname === l.path ? 600 : 400 }}>
                  {l.label}
                </span>
              ))}
            </nav>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", gap: 4, background: theme.light, borderRadius: 4, padding: 2 }}>
              <button onClick={() => { setMode("beginner"); router.push("/projects/new"); }
              } style={{ padding: "4px 12px", border: "none", borderRadius: 3, cursor: "pointer", background: mode === "beginner" ? theme.primary : "transparent", color: mode === "beginner" ? "#fff" : theme.gray, fontSize: 13 }}>新手</button>
              <button onClick={() => { setMode("professional"); router.push("/projects/new?mode=professional"); }
              } style={{ padding: "4px 12px", border: "none", borderRadius: 3, cursor: "pointer", background: mode === "professional" ? theme.primary : "transparent", color: mode === "professional" ? "#fff" : theme.gray, fontSize: 13 }}>专业</button>
            </div>
            {loggedIn ? (
              <>
                <button onClick={() => router.push("/keys")} style={s.btn("outline")}>设置</button>
                <button onClick={() => { localStorage.removeItem("token"); setLoggedIn(false); router.push("/"); router.refresh(); }} style={{ ...s.btn("outline"), color: theme.danger, borderColor: theme.danger }}>退出</button>
              </>
            ) : (
              <button onClick={() => router.push("/login")} style={s.btn("primary")}>登录</button>
            )}
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
