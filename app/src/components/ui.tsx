// ============================================================
// 共享 UI 原语 — Mock 新增状态的可复用呈现
// ============================================================
import { useState, type ReactNode } from "react";
import type { ArtifactStatus, Language } from "../types";
import { format, t, type TranslationKey } from "../lib/i18n";

// ---------- Artifact 状态徽标 ----------

const STATUS_STYLE: Record<ArtifactStatus, string> = {
  draft: "bg-[var(--control-bg)] border-[var(--panel-border-subtle)] text-[var(--text-secondary)]",
  accepted: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  validated: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  stale: "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
  error: "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400",
  warning: "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
};

const STATUS_KEY: Record<ArtifactStatus, TranslationKey> = {
  draft: "artDraft",
  accepted: "artAccepted",
  validated: "artValidated",
  stale: "artStale",
  error: "artError",
  warning: "artWarning",
};

const STATUS_DOT: Record<ArtifactStatus, string> = {
  draft: "bg-[var(--text-muted)]",
  accepted: "bg-emerald-500",
  validated: "bg-emerald-500",
  stale: "bg-amber-500",
  error: "bg-rose-500",
  warning: "bg-amber-500",
};

export function StatusBadge({
  status,
  version,
  lang,
  label,
}: {
  status: ArtifactStatus;
  version?: number;
  lang: Language;
  label?: string;
}) {
  const text = label ?? t(lang, STATUS_KEY[status]);
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono font-medium ${STATUS_STYLE[status]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`}></span>
      {text}
      {version !== undefined && version > 0 && ` · v${version}`}
    </span>
  );
}

// ---------- Empty ----------

export function EmptyState({
  icon,
  title,
  desc,
  action,
  lang,
}: {
  icon: string;
  title: string;
  desc: string;
  action?: ReactNode;
  lang: Language;
}) {
  void lang;
  return (
    <div className="mac-card p-10 flex flex-col items-center justify-center text-center gap-2.5">
      <div className="w-10 h-10 rounded-lg bg-[var(--control-bg)] text-[var(--text-muted)] flex items-center justify-center">
        <span className="material-symbols-outlined text-[22px]">{icon}</span>
      </div>
      <h3 className="text-xs font-semibold text-[var(--text-primary)]">{title}</h3>
      <p className="text-xs text-[var(--text-secondary)] max-w-[380px] leading-relaxed">{desc}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ---------- Error / 警告条 ----------

export function ErrorBanner({
  title,
  desc,
  onRetry,
  retryLabel,
  lang,
}: {
  title: string;
  desc?: string;
  onRetry?: () => void;
  retryLabel?: string;
  lang: Language;
}) {
  void lang;
  return (
    <div className="p-3.5 rounded-lg border border-rose-500/30 bg-rose-500/10 flex items-start gap-2.5">
      <span className="material-symbols-outlined text-rose-500 text-[18px] mt-0.5">error</span>
      <div className="flex-1">
        <div className="text-xs font-semibold text-rose-600 dark:text-rose-400">{title}</div>
        {desc && <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-2.5 py-1 rounded-md text-[11px] font-medium border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
        >
          {retryLabel ?? "Retry"}
        </button>
      )}
    </div>
  );
}

export function InfoBanner({
  icon,
  title,
  desc,
  tone = "amber",
  lang,
  action,
}: {
  icon?: string;
  title: string;
  desc?: string;
  tone?: "amber" | "blue" | "rose";
  lang: Language;
  action?: ReactNode;
}) {
  void lang;
  const tones = {
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    blue: "border-[#007aff]/30 bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff]",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  };
  return (
    <div className={`p-3 rounded-lg border flex items-start gap-2.5 ${tones[tone]}`}>
      {icon && <span className="material-symbols-outlined text-[17px] mt-0.5">{icon}</span>}
      <div className="flex-1">
        <div className="text-xs font-semibold">{title}</div>
        {desc && <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

// ---------- Stale ----------

export function StaleBanner({
  from,
  staleKinds,
  lang,
  onRevalidate,
  revalidating,
}: {
  from: string;
  staleKinds: string[];
  lang: Language;
  onRevalidate: () => void;
  revalidating: boolean;
}) {
  return (
    <InfoBanner
      icon="history_toggle_off"
      title={t(lang, "staleBannerTitle")}
      desc={`${format(t(lang, "staleBannerDesc"), { from })} ${staleKinds.join(" → ")}`}
      lang={lang}
      action={
        <button
          onClick={onRevalidate}
          disabled={revalidating}
          className="px-2.5 py-1 rounded-md text-[11px] font-medium mac-button-primary disabled:opacity-60 shrink-0"
        >
          {revalidating ? t(lang, "staleRevalidating") : t(lang, "staleRevalidateAll")}
        </button>
      }
    />
  );
}

export function staleKindsFor(
  artifacts: Record<string, { kind: string; status: string }>,
  order: string[]
): string[] {
  return order.filter((k) => artifacts[k]?.status === "stale");
}

// ---------- Confirm（高风险操作确认） ----------

export function ConfirmDialog({
  open,
  title,
  desc,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  lang,
}: {
  open: boolean;
  title: string;
  desc: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  lang: Language;
}) {
  void lang;
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="mac-card w-[380px] p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-rose-500 text-[20px]">warning</span>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        </div>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-4">{desc}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 mac-button-secondary rounded-md text-xs">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-rose-500 text-white hover:bg-rose-600 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Loading ----------

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-[var(--control-bg)] rounded-md ${className}`} />;
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

// ---------- Streaming 文本 ----------

export function StreamingDots({ lang: _lang }: { lang: Language }) {
  return (
    <span className="inline-flex gap-0.5 items-center">
      <span className="animate-bounce [animation-delay:0ms]">·</span>
      <span className="animate-bounce [animation-delay:150ms]">·</span>
      <span className="animate-bounce [animation-delay:300ms]">·</span>
    </span>
  );
}

// ---------- 手动引脚编辑（Wiring） ----------

export function PinEditor({
  value,
  onSave,
  onCancel,
  lang: _lang,
}: {
  value: string;
  onSave: (v: string) => void;
  onCancel: () => void;
  lang: Language;
}) {
  const [v, setV] = useState(value);
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={v}
        onChange={(e) => setV(e.target.value.toUpperCase())}
        className="w-16 px-1.5 py-0.5 rounded border border-[var(--panel-border)] bg-[var(--panel-solid)] text-[11px] font-mono text-[var(--text-primary)] focus:outline-none focus:border-[#007aff]"
      />
      <button
        onClick={() => onSave(v)}
        className="px-2 py-0.5 rounded text-[10px] font-medium mac-button-primary"
      >
        OK
      </button>
      <button onClick={onCancel} className="px-2 py-0.5 rounded text-[10px] mac-button-secondary">
        ✕
      </button>
    </div>
  );
}
