import type { CSSProperties } from "react";

// ─── Design Token Colors ────────────────────────────────────
// Source: design-tokens.json v1.0.0
// Palette: Deep teal primary (#0d9488), slate surfaces, cyan accent
// Philosophy: Technical workshop meets clean SaaS — oscilloscope aesthetic

export const colors = {
  primary: "#0d9488",
  accent: "#06b6d4",
  success: "#10b981",
  warning: "#d97706",
  danger: "#e11d48",
  info: "#0ea5e9",
  light: "#f8fafc",
  dark: "#0f172a",
  gray: "#64748b",
  border: "#e2e8f0",
  bgLight: "#f8fafc",
  white: "#ffffff",
} as const;

// Light-mode theme (backwards compatible — all 29 references keep working)
export const theme = { ...colors };

// Full design token set for component authors
export const token = {
  color: colors,
  font: {
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
    heading: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
    code: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Source Code Pro', Consolas, monospace",
  },
  fontSize: {
    caption: 12, body: 14, bodyLg: 16, h6: 18, h5: 20, h4: 24, h3: 28, h2: 32, h1: 40, display: 48,
  },
  spacing: {
    0: 0, 1: 2, 2: 4, 3: 8, 4: 12, 5: 16, 6: 20, 7: 24, 8: 32, 9: 40, 10: 48, 11: 64,
  },
  radius: { none: 0, sm: 4, md: 8, lg: 12, xl: 16, full: 9999 },
  shadow: {
    sm: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
    md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
    lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
    focus: "0 0 0 3px rgba(13, 148, 136, 0.2)",
  },
  zIndex: { base: 0, dropdown: 100, sticky: 200, modal: 300, toast: 400, tooltip: 500 },
} as const;

// Dark-mode color overrides (slate-900 canvas, teal-300 text, slate-700 borders)
export const darkColors: Record<string, string> = {
  primary: "#5eead4",
  accent: "#22d3ee",
  success: "#34d399",
  warning: "#fbbf24",
  danger: "#fb7185",
  info: "#38bdf8",
  light: "#1e293b",
  dark: "#f8fafc",
  gray: "#94a3b8",
  border: "#334155",
  bgLight: "#0f172a",
  white: "#1e293b",
};

// ─── Component Styles ────────────────────────────────────────

export const s = {
  container: { maxWidth: 960, margin: "0 auto", padding: 24 } satisfies CSSProperties,

  card: { border: `1px solid ${theme.border}`, borderRadius: 8, padding: 16 } satisfies CSSProperties,

  flexBetween: { display: "flex", justifyContent: "space-between", alignItems: "center" } satisfies CSSProperties,

  flexCenter: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,

  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 } satisfies CSSProperties,

  input: { width: "100%", padding: 8, border: `1px solid ${theme.border}`, borderRadius: 6 } satisfies CSSProperties,

  textarea: { width: "100%", padding: 8, border: `1px solid ${theme.border}`, borderRadius: 6, resize: "vertical" } satisfies CSSProperties,

  select: { padding: "6px 12px", border: `1px solid ${theme.border}`, borderRadius: 6 } satisfies CSSProperties,

  btn(style: "primary" | "success" | "danger" | "outline" = "primary", block = false): CSSProperties {
    const map = { primary: theme.primary, success: theme.success, danger: theme.danger, outline: "transparent" } as const;
    return {
      background: map[style],
      color: style === "outline" ? theme.primary : "#fff",
      border: style === "outline" ? `1px solid ${theme.primary}` : "none",
      padding: "8px 24px", borderRadius: 6, cursor: "pointer",
      fontWeight: 500, fontSize: 14, lineHeight: "20px",
      display: block ? "block" : undefined,
      width: block ? "100%" : undefined,
      transition: "background 150ms, opacity 150ms",
    };
  },

  badge(status: string): CSSProperties {
    const m: Record<string, string> = {
      ready: theme.success, analyzing: theme.warning, failed: theme.danger,
      generating: theme.info, recommending: theme.info, finalizing: theme.info,
    };
    return {
      background: m[status] || theme.gray, color: "#fff",
      padding: "2px 8px", borderRadius: 4, fontSize: 11,
      fontWeight: 500, letterSpacing: "0.03em", lineHeight: "18px",
    };
  },

  label: { display: "block", marginBottom: 4, fontWeight: 500, fontSize: 14 } satisfies CSSProperties,

  modal: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300,
  } satisfies CSSProperties,

  modalContent: {
    background: "#fff", borderRadius: 12, padding: 24,
    minWidth: 400, maxWidth: 600, boxShadow: token.shadow.lg,
  } satisfies CSSProperties,

  table: { width: "100%", borderCollapse: "collapse" } satisfies CSSProperties,

  th: {
    textAlign: "left", padding: "8px 12px", borderBottom: `2px solid ${theme.border}`,
    fontSize: 14, fontWeight: 600,
  } satisfies CSSProperties,

  td: {
    padding: "8px 12px", borderBottom: `1px solid ${theme.border}`, fontSize: 14,
  } satisfies CSSProperties,

  tabs: {
    display: "flex", gap: 0, marginBottom: 16, borderBottom: `2px solid ${theme.border}`,
  } satisfies CSSProperties,

  tab(active: boolean): CSSProperties {
    return {
      padding: "8px 20px", cursor: "pointer", fontSize: 14,
      borderBottom: active ? `2px solid ${theme.primary}` : "2px solid transparent",
      color: active ? theme.primary : theme.gray,
      fontWeight: active ? 600 : 400,
      transition: "color 150ms, border-color 150ms",
    };
  },

  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "12px 24px", borderBottom: `1px solid ${theme.border}`,
    background: "#fff",
  } satisfies CSSProperties,
};
