"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { s, theme } from "@/lib/styles";

interface StageEvent {
  stage: string;
  status: "done" | "active" | "pending";
  preview?: Record<string, unknown>;
}

interface ProgressState {
  stages: StageEvent[];
  progress: number;
  status: "connecting" | "running" | "complete" | "error" | "timeout";
  error?: { stage: string; message: string; suggestion: string };
  warnings?: string[];
}

const STAGE_META: Record<string, { label: string; icon: string }> = {
  requirement: { label: "需求分析", icon: "📝" },
  recommendation: { label: "器件选型", icon: "🧩" },
  codegen: { label: "代码生成", icon: "💻" },
  schematic: { label: "接线图", icon: "🔌" },
};

export default function ProgressPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;
  const eventSourceRef = useRef<EventSource | null>(null);

  const [state, setState] = useState<ProgressState>({
    stages: Object.keys(STAGE_META).map((key) => ({
      stage: key,
      status: "pending" as const,
    })),
    progress: 0,
    status: "connecting",
  });

  useEffect(() => {
    const es = new EventSource(`/api/projects/${projectId}/stream`);
    eventSourceRef.current = es;

    es.addEventListener("connected", () => {
      setState((prev) => ({ ...prev, status: "running" }));
    });

    es.addEventListener("stage", (e) => {
      const data = JSON.parse(e.data);
      setState((prev) => ({
        ...prev,
        stages: prev.stages.map((st) =>
          st.stage === data.stage ? { ...st, status: "done", preview: data.preview } : st
        ),
      }));
    });

    es.addEventListener("progress", (e) => {
      const data = JSON.parse(e.data);
      setState((prev) => {
        const stages = prev.stages.map((st, i) => {
          const stageOrder = Object.keys(STAGE_META);
          const currentIdx = stageOrder.indexOf(data.currentStage);
          if (st.status === "done") return st;
          if (i === currentIdx) return { ...st, status: "active" as const };
          return st;
        });
        return { ...prev, stages, progress: data.progress };
      });
    });

    es.addEventListener("complete", (e) => {
      const data = JSON.parse(e.data);
      setState((prev) => ({
        ...prev,
        status: "complete",
        progress: 100,
        warnings: data.warnings || [],
        stages: prev.stages.map((st) => ({ ...st, status: "done" as const })),
      }));
      // Auto-navigate to result after 1.5s
      setTimeout(() => router.push(`/projects/${projectId}/result`), 1500);
    });

    es.addEventListener("error", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        setState((prev) => ({ ...prev, status: "error", error: data }));
      } catch {
        setState((prev) => ({
          ...prev,
          status: "error",
          error: { stage: "unknown", message: "连接中断", suggestion: "请刷新页面重试" },
        }));
      }
      es.close();
    });

    es.addEventListener("timeout", () => {
      setState((prev) => ({ ...prev, status: "timeout" }));
      es.close();
    });

    return () => { es.close(); };
  }, [projectId, router]);

  return (
    <main style={{ ...s.container, maxWidth: 720 }}>
      <div style={{ padding: "48px 0" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
            {state.status === "complete" ? "✅ 方案生成完成" :
             state.status === "error" ? "❌ 生成失败" :
             state.status === "timeout" ? "⏱️ 生成超时" : "⚡ 正在生成方案..."}
          </h1>
          <p style={{ color: theme.gray, fontSize: 14 }}>
            {state.status === "running" ? "AI 正在分析需求、选型、生成代码和接线图" :
             state.status === "complete" ? "即将跳转到结果页..." :
             state.status === "connecting" ? "正在连接..." : ""}
          </p>
        </div>

        {/* Progress bar */}
        {state.status === "running" && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ height: 4, background: theme.light, borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${state.progress}%`,
                background: `linear-gradient(90deg, ${theme.primary}, ${theme.accent})`,
                borderRadius: 2, transition: "width 0.5s ease",
              }} />
            </div>
            <div style={{ textAlign: "right", fontSize: 12, color: theme.gray, marginTop: 4 }}>
              {state.progress}%
            </div>
          </div>
        )}

        {/* Steps */}
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {state.stages.map((stage, i) => {
            const meta = STAGE_META[stage.stage];
            const isLast = i === state.stages.length - 1;
            return (
              <div key={stage.stage} style={{ display: "flex", gap: 16, position: "relative", paddingBottom: isLast ? 0 : 32 }}>
                {/* Connector line */}
                {!isLast && (
                  <div style={{
                    position: "absolute", left: 15, top: 36, bottom: 0, width: 2,
                    background: stage.status === "done" ? theme.success : theme.border,
                  }} />
                )}
                {/* Dot */}
                <div style={{
                  width: 32, height: 32, borderRadius: "50%", display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: 14,
                  flexShrink: 0, zIndex: 1,
                  background: stage.status === "done" ? theme.success :
                             stage.status === "active" ? theme.primary : theme.light,
                  color: stage.status === "pending" ? theme.gray : "#fff",
                  border: stage.status === "active" ? `2px solid ${theme.accent}` : "2px solid transparent",
                  animation: stage.status === "active" ? "pulse 2s infinite" : "none",
                }}>
                  {stage.status === "done" ? "✓" : meta.icon}
                </div>
                {/* Content */}
                <div style={{ paddingTop: 4 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: stage.status === "pending" ? theme.gray : theme.dark }}>
                    {meta.label}
                  </div>
                  {stage.status === "done" && stage.preview && (
                    <div style={{ fontSize: 13, color: theme.gray, marginTop: 2 }}>
                      {formatPreview(stage.stage, stage.preview)}
                    </div>
                  )}
                  {stage.status === "active" && (
                    <div style={{ fontSize: 13, color: theme.accent, marginTop: 2 }}>处理中...</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Error state */}
        {state.status === "error" && state.error && (
          <div style={{
            marginTop: 32, padding: 20, borderRadius: 8,
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
          }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: theme.danger }}>
              失败阶段：{STAGE_META[state.error.stage]?.label || state.error.stage}
            </div>
            <div style={{ fontSize: 14, color: theme.gray, marginBottom: 8 }}>{state.error.message}</div>
            <div style={{ fontSize: 14, color: theme.dark }}>💡 {state.error.suggestion}</div>
            <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
              <button onClick={() => router.push(`/projects/new`)} style={s.btn("primary")}>修改描述重试</button>
              <button onClick={() => window.location.reload()} style={s.btn("outline")}>直接重试</button>
            </div>
          </div>
        )}

        {/* Timeout state */}
        {state.status === "timeout" && (
          <div style={{ marginTop: 32, textAlign: "center" }}>
            <button onClick={() => window.location.reload()} style={s.btn("primary")}>重新连接</button>
          </div>
        )}

        {/* Warnings */}
        {state.warnings && state.warnings.length > 0 && (
          <div style={{
            marginTop: 24, padding: 16, borderRadius: 8,
            background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)",
          }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: theme.warning, marginBottom: 8 }}>
              ⚠️ {state.warnings.length} 个一致性警告
            </div>
            {state.warnings.map((w, i) => (
              <div key={i} style={{ fontSize: 13, color: theme.gray }}>{w}</div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.4); }
          50% { box-shadow: 0 0 0 8px rgba(99,102,241,0); }
        }
      `}</style>
    </main>
  );
}

function formatPreview(stage: string, preview: Record<string, unknown>): string {
  switch (stage) {
    case "requirement":
      return `识别到 ${preview.components || "?"} 个组件`;
    case "recommendation":
      return `已匹配 ${preview.totalComponents || "?"} 个器件`;
    case "codegen":
      return `生成 ${preview.codeLines || "?"} 行代码`;
    case "schematic":
      return "接线图已生成";
    default:
      return "";
  }
}
