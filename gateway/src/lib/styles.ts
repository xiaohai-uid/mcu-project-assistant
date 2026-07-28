import type { CSSProperties } from "react";

// ─── Design Token Colors ────────────────────────────────────
// Dark-first design system v2.0
// Palette: Indigo accent (#6366f1), deep slate surfaces
// Philosophy: Technical SaaS — dark, focused, high-contrast

export const colors = {
  primary: "#6366f1",
  accent: "#818cf8",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#3b82f6",
  light: "#242836",
  dark: "#f1f3f7",
  gray: "#9ca3b4",
  border: "#2e3345",
  bgLight: "#0f1117",
  white: "#1a1d27",
} as const;

// Dark-mode theme (default)
export const theme = { ...colors };

// Full design token set for component authors
export const token = {
  color: colors,
  font: {
    body: "'Inter', -apple-system, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
    heading: "'Inter', -apple-system, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
    code: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
  },
  fontSize: {
    caption: 12, body: 14, bodyLg: 16, h6: 18, h5: 20, h4: 24, h3: 28, h2: 32, h1: 40, display: 48,
  },
  spacing: {
    0: 0, 1: 2, 2: 4, 3: 8, 4: 12, 5: 16, 6: 20, 7: 24, 8: 32, 9: 40, 10: 48, 11: 64,
  },
  radius: { none: 0, sm: 4, md: 8, lg: 12, xl: 16, full: 9999 },
  shadow: {
    sm: "0 1px 3px rgba(0, 0, 0, 0.3)",
    md: "0 4px 16px rgba(0, 0, 0, 0.3)",
    lg: "0 8px 32px rgba(0, 0, 0, 0.4)",
    focus: "0 0 0 3px rgba(99, 102, 241, 0.2)",
  },
  zIndex: { base: 0, dropdown: 100, sticky: 200, modal: 300, toast: 400, tooltip: 500 },
} as const;

// Light-mode color overrides (for future theme toggle)
export const darkColors: Record<string, string> = {
  primary: "#6366f1",
  accent: "#818cf8",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#3b82f6",
  light: "#f0f2f5",
  dark: "#1a1d27",
  gray: "#5a6172",
  border: "#e2e5eb",
  bgLight: "#ffffff",
  white: "#ffffff",
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
    background: "#1a1d27", borderRadius: 12, padding: 24,
    minWidth: 400, maxWidth: 600, boxShadow: token.shadow.lg,
    border: `1px solid ${theme.border}`,
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
    background: "#1a1d27",
  } satisfies CSSProperties,
};
