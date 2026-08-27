"use client";

import { useParams, useRouter } from "next/navigation";
import { s, theme } from "@/lib/styles";
import { useState, useEffect } from "react";
import { apiPut } from "@/lib/api";

interface PinMapping {
  component: string; pin: string; mcuPin: string; purpose: string;
}

export default function PinsEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [mappings, setMappings] = useState<PinMapping[]>([]);
  const [availablePins] = useState(["D2","D3","D4","D5","D6","D7","D8","D9","D10","D11","D12","D13","A0","A1","A2","A3","A4","A5"]);

  useEffect(() => {
    fetch(`/api/projects/${id}`).then(r => r.json()).then(d => {
      if (d.pin_mappings) {
        setMappings(typeof d.pin_mappings === "string" ? JSON.parse(d.pin_mappings) : d.pin_mappings);
      }
    });
  }, [id]);

  const updateMapping = (idx: number, field: keyof PinMapping, val: string) => {
    setMappings(prev => prev.map((m, i) => i === idx ? { ...m, [field]: val } : m));
  };

  const save = async () => {
    await apiPut(`/api/projects/${id}/pins`, { pinTable: mappings, svgContent: null });
    router.push(`/projects/${id}/schematic`);
  };

  return (
    <main style={s.container}>
      <h1>引脚编辑器</h1>
      <p style={{ color: theme.gray }}>拖拽式引脚映射 — 为每个配件分配 MCU 引脚。</p>
      <table style={s.table}>
        <thead><tr>
          {["配件", "配件引脚", "MCU 引脚", "用途"].map(h => <th key={h} style={s.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {mappings.map((m, i) => (
            <tr key={i}>
              <td style={s.td}>{m.component}</td>
              <td style={s.td}><code>{m.pin}</code></td>
              <td style={s.td}>
                <select style={s.select} value={m.mcuPin} onChange={e => updateMapping(i, "mcuPin", e.target.value)}>
                  {availablePins.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </td>
              <td style={s.td}><input style={s.input} value={m.purpose} onChange={e => updateMapping(i, "purpose", e.target.value)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={save} style={s.btn("primary")}>保存并刷新接线图</button>
        <button onClick={() => router.push(`/projects/${id}/code`)} style={s.btn("outline")}>返回代码</button>
      </div>
    </main>
  );
}
