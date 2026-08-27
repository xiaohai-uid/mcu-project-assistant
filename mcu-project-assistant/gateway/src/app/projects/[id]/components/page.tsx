"use client";

import { useParams, useRouter } from "next/navigation";
import { s, theme } from "@/lib/styles";
import { useState, useEffect } from "react";
import { apiPut } from "@/lib/api";

interface ComponentItem {
  name: string; price: string; source: string;
}

export default function ComponentsEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [components, setComponents] = useState<ComponentItem[]>([]);

  useEffect(() => {
    fetch(`/api/projects/${id}`).then(r => r.json()).then(d => {
      if (d.component_list) {
        const cl = typeof d.component_list === "string" ? JSON.parse(d.component_list) : d.component_list;
        const all: ComponentItem[] = [];
        if (cl.tiers) Object.values(cl.tiers as Record<string, Tier>).forEach((t: Tier) => all.push(...t.items));
        setComponents(all);
      }
    });
  }, [id]);

  const updateComponent = (idx: number, field: keyof ComponentItem, value: string) => {
    setComponents(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  const addComponent = () => setComponents(prev => [...prev, { name: "", price: "", source: "" }]);

  const removeComponent = (idx: number) => setComponents(prev => prev.filter((_, i) => i !== idx));

  const save = async () => {
    await apiPut(`/api/projects/${id}/components`, { components });
    router.push(`/projects/${id}/code`);
  };

  return (
    <main style={s.container}>
      <h1>配件编辑器</h1>
      <p style={{ color: theme.gray }}>增删改配件列表，自定义你的方案。</p>
      <table style={s.table}>
        <thead><tr>
          {["配件名称", "参考价格", "来源"].map(h => <th key={h} style={s.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {components.map((c, i) => (
            <tr key={i}>
              <td style={s.td}><input style={s.input} value={c.name} onChange={e => updateComponent(i, "name", e.target.value)} /></td>
              <td style={s.td}><input style={{ ...s.input, width: 100 }} value={c.price} onChange={e => updateComponent(i, "price", e.target.value)} /></td>
              <td style={s.td}>
                <input style={{ ...s.input, width: 120 }} value={c.source} onChange={e => updateComponent(i, "source", e.target.value)} />
                <button onClick={() => removeComponent(i)} style={{ ...s.btn("danger"), marginLeft: 8, padding: "4px 12px" }}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addComponent} style={{ ...s.btn("outline"), marginTop: 8 }}>+ 添加配件</button>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={save} style={s.btn("success")}>保存并继续</button>
        <button onClick={() => router.push(`/projects/${id}/recommendations`)} style={s.btn("outline")}>返回</button>
      </div>
    </main>
  );
}

interface Tier { label: string; items: ComponentItem[]; total: string; }
