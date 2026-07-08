"use client";

import { useParams, useRouter } from "next/navigation";
import { s, theme } from "@/lib/styles";
import { useState, useEffect } from "react";

interface ComponentItem {
  name: string; price: string; source: string; url?: string;
}

interface Tier {
  label: string; items: ComponentItem[]; total: string;
}

export default function RecommendationsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tiers, setTiers] = useState<Record<string, Tier>>({});
  const [priceComp, setPriceComp] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${id}`).then(r => r.json()).then(d => {
      if (d.component_list) {
        const cl = typeof d.component_list === "string" ? JSON.parse(d.component_list) : d.component_list;
        setTiers(cl.tiers || {});
      }
      if (d.price_comparison) {
        setPriceComp(typeof d.price_comparison === "string" ? JSON.parse(d.price_comparison) : d.price_comparison);
      }
    });
  }, [id]);

  const tierNames: Record<string, string> = { budget: "丐版", standard: "标准", premium: "旗舰" };

  return (
    <main style={s.container}>
      <h1>配件推荐</h1>
      {Object.entries(tiers).map(([key, tier]) => (
        <div key={key} style={{ ...s.card, marginTop: 16 }}>
          <h3>{tierNames[key] || key} — 约 {tier.total}</h3>
          <table style={s.table}>
            <thead><tr>
              {["配件", "参考价格", "来源"].map(h => <th key={h} style={s.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {tier.items.map((item, i) => (
                <tr key={i}>
                  <td style={s.td}>{item.name}</td>
                  <td style={s.td}>{item.price}</td>
                  <td style={s.td}>
                    {item.url ? <a href={item.url} target="_blank" style={{ color: theme.primary }}>{item.source}</a> : item.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={() => router.push(`/projects/${id}/code`)} style={s.btn("primary")}>生成代码</button>
        <button onClick={() => router.push(`/projects/${id}/components`)} style={s.btn("outline")}>编辑配件</button>
      </div>
    </main>
  );
}
