"use client";

import { useRouter } from "next/navigation";
import { s, theme } from "@/lib/styles";
import { useState, useEffect } from "react";
import { apiPost, apiPut } from "@/lib/api";

interface ApiKey {
  id: string; provider: string; key_preview: string; created_at: string; is_active: boolean;
}

export default function KeysPage() {
  const router = useRouter();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newProvider, setNewProvider] = useState("openai");
  const [newKey, setNewKey] = useState("");

  useEffect(() => { fetch("/api/keys").then(r => r.json()).then(data => { if (Array.isArray(data)) setKeys(data); }).catch(() => {}); }, []);

  const addKey = async () => {
    await apiPost("/api/keys", { provider: newProvider, apiKey: newKey });
    setShowAdd(false); setNewKey("");
    window.location.reload();
  };

  const toggleKey = async (id: string, active: boolean) => {
    await apiPut(`/api/keys/${id}`, { isActive: !active });
    window.location.reload();
  };

  return (
    <main style={s.container}>
      <div style={s.flexBetween}>
        <h1>API Key 管理</h1>
        <button onClick={() => setShowAdd(true)} style={s.btn("primary")}>+ 添加 Key</button>
      </div>
      <div style={{ ...s.card, marginTop: 16 }}>
        <p style={{ fontSize: 14, color: theme.gray }}>绑定 AI API Key 可使用自己的模型配额。支持 OpenAI / 兼容接口。搜索 Key 用于实时比价。</p>
      </div>
      {showAdd && (
        <div style={{ ...s.modal }} onClick={() => setShowAdd(false)}>
          <div style={s.modalContent} onClick={e => e.stopPropagation()}>
            <h3>添加 API Key</h3>
            <label style={s.label}>提供商</label>
            <select style={s.select} value={newProvider} onChange={e => setNewProvider(e.target.value)}>
              <option value="openai">OpenAI</option>
              <option value="deepseek">DeepSeek</option>
              <option value="search">搜索 Key</option>
            </select>
            <label style={{ ...s.label, marginTop: 12 }}>API Key</label>
            <input style={s.input} type="password" value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="sk-..." />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={addKey} style={s.btn("primary")}>保存</button>
              <button onClick={() => setShowAdd(false)} style={s.btn("outline")}>取消</button>
            </div>
          </div>
        </div>
      )}
      <table style={{ ...s.table, marginTop: 16 }}>
        <thead><tr>
          {["提供商", "Key", "状态", "创建时间", "操作"].map(h => <th key={h} style={s.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {keys.map(k => (
            <tr key={k.id}>
              <td style={s.td}>{k.provider}</td>
              <td style={s.td}><code>{k.key_preview}</code></td>
              <td style={s.td}><span style={s.badge(k.is_active ? "ready" : "failed")}>{k.is_active ? "启用" : "禁用"}</span></td>
              <td style={s.td}>{new Date(k.created_at).toLocaleString("zh-CN")}</td>
              <td style={s.td}>
                <button onClick={() => toggleKey(k.id, k.is_active)} style={s.btn(k.is_active ? "danger" : "primary")}>
                  {k.is_active ? "禁用" : "启用"}
                </button>
              </td>
            </tr>
          ))}
          {keys.length === 0 && (
            <tr><td style={s.td} colSpan={5}><p style={{ textAlign: "center", color: theme.gray }}>还没有绑定 API Key</p></td></tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
