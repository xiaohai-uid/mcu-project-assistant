"use client";

import { useParams, useRouter } from "next/navigation";
import { s, theme, token } from "@/lib/styles";
import { useState, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────
interface PinMapping {
  componentName: string;
  componentPin: string;
  microcontrollerPin: string;
  connectionType: string;
  pinVarName?: string;
}

interface ComponentItem {
  name: string;
  model?: string;
  quantity?: number;
  purpose?: string;
  price?: string;
  purchaseUrl?: string;
  libraryDependency?: string;
  interface?: string;
  category?: string;
}

interface ProjectData {
  id: string;
  status: string;
  raw_description?: string;
  generated_code: string | null;
  component_list: unknown;
  svg_content: string | null;
  pin_mappings: unknown;
  pin_table: unknown;
  library_deps: unknown;
  validation_warnings: unknown;
  requirement: unknown;
  experience_level: string;
}

type TabKey = "code" | "components" | "wiring" | "upload";

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "code", label: "代码", icon: "💻" },
  { key: "components", label: "元器件清单", icon: "🧩" },
  { key: "wiring", label: "接线图", icon: "🔌" },
  { key: "upload", label: "烧录指南", icon: "🚀" },
];

// ─── Main Page ────────────────────────────────────────────────
export default function ResultPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<ProjectData | null>(null);
  const [tab, setTab] = useState<TabKey>("code");
  const [mode, setMode] = useState<"beginner" | "professional">("beginner");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then((d: ProjectData) => {
        setData(d);
        if (d.experience_level === "professional") setMode("professional");
      });
  }, [id]);

  const copyCode = useCallback(() => {
    if (!data?.generated_code) return;
    navigator.clipboard.writeText(data.generated_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [data]);

  if (!data) {
    return (
      <main style={s.container}>
        <div style={{ textAlign: "center", padding: 64, color: theme.gray }}>加载中...</div>
      </main>
    );
  }

  const warnings = parseJson<string[]>(data.validation_warnings, []);
  const pinMappings = parseJson<PinMapping[]>(data.pin_mappings, []);
  const components = parseComponents(data.component_list);
  const libraries = parseJson<string[]>(data.library_deps, []);

  return (
    <main style={{ ...s.container, maxWidth: 1080 }}>
      {/* Header */}
      <div style={{ ...s.flexBetween, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>项目方案</h1>
          <p style={{ fontSize: 13, color: theme.gray, margin: "4px 0 0" }}>
            {data.raw_description ? truncate(data.raw_description, 60) : "Arduino UNO 项目"}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Mode Toggle */}
          <div style={{
            display: "flex", borderRadius: 6, overflow: "hidden",
            border: `1px solid ${theme.border}`,
          }}>
            <button
              onClick={() => setMode("beginner")}
              style={{
                padding: "6px 14px", fontSize: 13, border: "none", cursor: "pointer",
                background: mode === "beginner" ? theme.primary : "transparent",
                color: mode === "beginner" ? "#fff" : theme.gray,
              }}
            >
              新手模式
            </button>
            <button
              onClick={() => setMode("professional")}
              style={{
                padding: "6px 14px", fontSize: 13, border: "none", cursor: "pointer",
                background: mode === "professional" ? theme.primary : "transparent",
                color: mode === "professional" ? "#fff" : theme.gray,
              }}
            >
              专业模式
            </button>
          </div>
          <button onClick={() => router.push(`/projects/${id}/export`)} style={s.btn("outline")}>
            导出
          </button>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={{
          padding: "12px 16px", borderRadius: 8, marginBottom: 16,
          background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)",
        }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: theme.warning }}>
            ⚠️ {warnings.length} 个一致性警告
          </span>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: theme.gray, marginTop: 4 }}>{w}</div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={s.tabs}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={s.tab(tab === t.key)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ marginTop: 16 }}>
        {tab === "code" && (
          <CodeTab code={data.generated_code} copied={copied} onCopy={copyCode} editable={mode === "professional"} projectId={id} />
        )}
        {tab === "components" && (
          <ComponentsTab components={components} editable={mode === "professional"} />
        )}
        {tab === "wiring" && (
          <WiringTab svg={data.svg_content} pinMappings={pinMappings} />
        )}
        {tab === "upload" && (
          <UploadTab libraries={libraries} />
        )}
      </div>
    </main>
  );
}

// ─── Code Tab ─────────────────────────────────────────────────
function CodeTab({ code, copied, onCopy, editable, projectId }: {
  code: string | null; copied: boolean; onCopy: () => void; editable: boolean; projectId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(code || "");
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await fetch(`/api/projects/${projectId}/code`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generatedCode: draft }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!code) return <EmptyState text="代码生成中..." />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 12 }}>
        {editable && (
          <button onClick={() => { setEditing(!editing); setDraft(code); }} style={s.btn(editing ? "success" : "outline")}>
            {editing ? "退出编辑" : "编辑代码"}
          </button>
        )}
        <button onClick={onCopy} style={s.btn("primary")}>
          {copied ? "已复制 ✓" : "复制代码"}
        </button>
      </div>

      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{
              width: "100%", minHeight: 500, padding: 16, borderRadius: 8,
              background: "#12141c", color: "#e2e8f0", border: `1px solid ${theme.border}`,
              fontFamily: token.font.code, fontSize: 13, lineHeight: 1.6, resize: "vertical",
            }}
          />
          <button onClick={handleSave} style={{ ...s.btn("success"), marginTop: 8 }}>
            {saved ? "已保存 ✓" : "保存修改"}
          </button>
        </div>
      ) : (
        <pre style={{
          background: "#12141c", borderRadius: 8, padding: 20, overflow: "auto",
          maxHeight: 600, border: `1px solid ${theme.border}`,
        }}>
          <code style={{ fontFamily: token.font.code, fontSize: 13, lineHeight: 1.7, color: "#e2e8f0" }}>
            <SyntaxHighlight code={code} />
          </code>
        </pre>
      )}
    </div>
  );
}

// ─── Components Tab ───────────────────────────────────────────
function ComponentsTab({ components, editable }: { components: ComponentItem[]; editable: boolean }) {
  if (!components.length) return <EmptyState text="暂无元器件数据" />;

  const totalPrice = components.reduce((sum, c) => {
    const p = parseFloat(c.price?.replace(/[^\d.]/g, "") || "0");
    return sum + p * (c.quantity || 1);
  }, 0);

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>名称</th>
              <th style={s.th}>型号</th>
              <th style={s.th}>数量</th>
              <th style={s.th}>用途</th>
              <th style={s.th}>接口</th>
              <th style={s.th}>参考价</th>
              <th style={s.th}>购买</th>
            </tr>
          </thead>
          <tbody>
            {components.map((c, i) => (
              <tr key={i}>
                <td style={{ ...s.td, fontWeight: 500 }}>{c.name}</td>
                <td style={s.td}>{c.model || "-"}</td>
                <td style={s.td}>{c.quantity || 1}</td>
                <td style={s.td}>{c.purpose || c.category || "-"}</td>
                <td style={s.td}>
                  {c.interface ? (
                    <span style={{
                      padding: "2px 6px", borderRadius: 4, fontSize: 11,
                      background: "rgba(99,102,241,0.1)", color: theme.accent,
                    }}>
                      {c.interface}
                    </span>
                  ) : "-"}
                </td>
                <td style={s.td}>{c.price || "-"}</td>
                <td style={s.td}>
                  {c.purchaseUrl ? (
                    <a href={c.purchaseUrl} target="_blank" rel="noopener noreferrer"
                      style={{ color: theme.primary, fontSize: 13, textDecoration: "none" }}>
                      购买链接 →
                    </a>
                  ) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{
        marginTop: 16, padding: "12px 16px", borderRadius: 8,
        background: "rgba(99,102,241,0.06)", border: `1px solid ${theme.border}`,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontSize: 14, color: theme.gray }}>预估总价</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: theme.primary }}>
          ¥{totalPrice.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

// ─── Wiring Tab ───────────────────────────────────────────────
function WiringTab({ svg, pinMappings }: { svg: string | null; pinMappings: PinMapping[] }) {
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<"diagram" | "checklist">("diagram");

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setView("diagram")}
          style={{ ...s.btn(view === "diagram" ? "primary" : "outline"), padding: "6px 16px", fontSize: 13 }}>
          接线图
        </button>
        <button onClick={() => setView("checklist")}
          style={{ ...s.btn(view === "checklist" ? "primary" : "outline"), padding: "6px 16px", fontSize: 13 }}>
          接线清单
        </button>
      </div>

      {view === "diagram" ? (
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <button onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} style={{ ...s.btn("outline"), padding: "4px 12px" }}>−</button>
            <span style={{ fontSize: 13, color: theme.gray, minWidth: 40 }}>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(3, z + 0.25))} style={{ ...s.btn("outline"), padding: "4px 12px" }}>+</button>
          </div>
          <div style={{
            ...s.card, overflow: "auto", textAlign: "center",
            background: "#ffffff", borderRadius: 8, minHeight: 300,
          }}>
            {svg ? (
              <div
                style={{ transform: `scale(${zoom})`, transformOrigin: "top left", display: "inline-block" }}
                dangerouslySetInnerHTML={{ __html: sanitizeSvg(svg) }}
              />
            ) : (
              <p style={{ color: "#666", padding: 48 }}>接线图生成中...</p>
            )}
          </div>
        </div>
      ) : (
        <WiringChecklist pinMappings={pinMappings} />
      )}
    </div>
  );
}

function WiringChecklist({ pinMappings }: { pinMappings: PinMapping[] }) {
  if (!pinMappings.length) return <EmptyState text="暂无接线数据" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {pinMappings.map((pin, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
          borderRadius: 8, background: theme.white, border: `1px solid ${theme.border}`,
        }}>
          <span style={{
            width: 24, height: 24, borderRadius: "50%", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 12,
            background: theme.primary, color: "#fff", flexShrink: 0,
          }}>
            {i + 1}
          </span>
          <span style={{ fontSize: 14 }}>
            将 <strong>{pin.componentName}</strong> 的{" "}
            <code style={{ color: theme.accent, fontFamily: token.font.code }}>{pin.componentPin || "信号脚"}</code>{" "}
            接到 Arduino 的{" "}
            <code style={{ color: theme.success, fontFamily: token.font.code }}>{pin.microcontrollerPin}</code>
            {pin.connectionType && (
              <span style={{ fontSize: 12, color: theme.gray, marginLeft: 8 }}>({pin.connectionType})</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Upload Tab ───────────────────────────────────────────────
function UploadTab({ libraries }: { libraries: string[] }) {
  const steps = [
    { title: "安装 Arduino IDE", desc: "从官网下载并安装 Arduino IDE 2.x", url: "https://www.arduino.cc/en/software" },
    { title: "连接开发板", desc: "用 USB 数据线将 Arduino UNO 连接到电脑" },
    { title: "选择开发板", desc: "菜单 → 工具 → 开发板 → Arduino Uno" },
    { title: "选择端口", desc: "菜单 → 工具 → 端口 → 选择出现的 COM 口" },
    ...(libraries.length > 0
      ? [{ title: "安装依赖库", desc: `工具 → 管理库 → 搜索安装: ${libraries.join(", ")}` }]
      : []),
    { title: "粘贴代码", desc: "将「代码」标签页中的完整代码复制到 Arduino IDE 编辑器" },
    { title: "上传程序", desc: "点击 → 箭头按钮（上传），等待 'Done uploading' 提示" },
    { title: "验证运行", desc: "打开串口监视器（波特率 9600），观察传感器数据输出" },
  ];

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          return (
            <div key={i} style={{ display: "flex", gap: 16, position: "relative", paddingBottom: isLast ? 0 : 24 }}>
              {!isLast && (
                <div style={{
                  position: "absolute", left: 13, top: 32, bottom: 0, width: 2,
                  background: theme.border,
                }} />
              )}
              <div style={{
                width: 28, height: 28, borderRadius: "50%", display: "flex",
                alignItems: "center", justifyContent: "center", fontSize: 12,
                background: theme.light, color: theme.accent, fontWeight: 700,
                flexShrink: 0, zIndex: 1, border: `1px solid ${theme.border}`,
              }}>
                {i + 1}
              </div>
              <div style={{ paddingTop: 2 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{step.title}</div>
                <div style={{ fontSize: 13, color: theme.gray, marginTop: 2 }}>{step.desc}</div>
                {step.url && (
                  <a href={step.url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12, color: theme.primary, textDecoration: "none" }}>
                    {step.url}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {libraries.length > 0 && (
        <div style={{ marginTop: 24, ...s.card }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>命令行安装库（可选）</h4>
          <pre style={{
            background: "#12141c", borderRadius: 6, padding: 12,
            fontFamily: token.font.code, fontSize: 12, color: "#e2e8f0", overflow: "auto",
          }}>
            {libraries.map((lib) => `arduino-cli lib install "${lib}"`).join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Utilities ────────────────────────────────────────────────
function EmptyState({ text }: { text: string }) {
  return <div style={{ textAlign: "center", padding: 48, color: theme.gray }}>{text}</div>;
}

function parseJson<T>(val: unknown, fallback: T): T {
  if (!val) return fallback;
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return val as T;
}

function parseComponents(raw: unknown): ComponentItem[] {
  const parsed = parseJson<Record<string, unknown>>(raw, {});
  const items: ComponentItem[] = [];
  if (parsed.tiers && typeof parsed.tiers === "object") {
    for (const tier of Object.values(parsed.tiers as Record<string, unknown>)) {
      const t = tier as { items?: ComponentItem[] };
      if (t.items) items.push(...t.items);
    }
  } else if (Array.isArray(parsed)) {
    return parsed as ComponentItem[];
  }
  return items;
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + "..." : str;
}

function sanitizeSvg(raw: string): string {
  if (typeof window === "undefined" || !raw) return "";
  const doc = new DOMParser().parseFromString(raw, "image/svg+xml");
  doc.querySelectorAll("script").forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.toLowerCase().trim();
      if (name.startsWith("on") || value.startsWith("javascript:")) el.removeAttribute(attr.name);
    });
  });
  return doc.documentElement.outerHTML;
}

// Simple syntax highlighting for Arduino/C++ code
function SyntaxHighlight({ code }: { code: string }) {
  const lines = code.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} style={{ minHeight: "1.7em" }}>
          <span style={{ color: "#4a5568", userSelect: "none", display: "inline-block", width: 36, textAlign: "right", marginRight: 16 }}>
            {i + 1}
          </span>
          <span dangerouslySetInnerHTML={{ __html: highlightLine(line) }} />
        </div>
      ))}
    </>
  );
}

function highlightLine(line: string): string {
  // Escape HTML
  let html = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Comments
  html = html.replace(/(\/\/.*)$/, '<span style="color:#6b7280">$1</span>');
  // Preprocessor
  html = html.replace(/^(#\w+)/, '<span style="color:#c084fc">$1</span>');
  // Strings
  html = html.replace(/(&quot;.*?&quot;|".*?")/g, '<span style="color:#34d399">$1</span>');
  // Keywords
  const kw = /\b(void|int|float|const|if|else|for|while|return|true|false|HIGH|LOW|INPUT|OUTPUT|unsigned|long|char|bool|String)\b/g;
  html = html.replace(kw, '<span style="color:#818cf8">$1</span>');
  // Functions
  html = html.replace(/\b(pinMode|digitalWrite|analogRead|digitalRead|Serial|delay|begin|print|println|attach|read)\b/g, '<span style="color:#fbbf24">$1</span>');
  return html;
}
