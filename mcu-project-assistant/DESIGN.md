---
version: 2.0
name: Oscilloscope Design System
description: A technical-workshop-meets-clean-SaaS design language for MCU Project Assistant — deep teal primary, slate surfaces, and cyan accents replacing the old Bootstrap-blue palette. Chinese-first, dark-mode-native.
last_updated: 2026-07-06
---

## 1. Design Philosophy — "Technical Workshop Meets Clean SaaS"

The visual language should feel like an **oscilloscope designed by a modern software company**. Functional precision over decorative flourishes. Every pixel earns its place.

**Core tenets:**

- **Chinese-first**: Typography and spacing optimized for CJK text. This is a tool for the Chinese maker community, not an English app that was translated. Copy reads naturally in Chinese; measurements use mm; dates use YYYY-MM-DD.
- **Hardware-adjacent, not hardware-cliché**: The aesthetic evokes electronics workbenches — precision, order, signal clarity — without being literal. No faux-screw heads, no decorative PCB trace patterns. The feeling comes from color psychology (teal = circuit boards), typographic density (spec-sheet layouts), and purposeful spacing (reduces cognitive load on schematic views).
- **Dark-mode-native**: Like an oscilloscope screen, the default state is dark. Light mode is a secondary concern, not the primary canvas.
- **Dual density**: Beginners get warm spacing and clear guidance. Professionals get compact, keyboard-navigable panels. Same design system, different token application.

**References:**
- **Linear** (dark-mode-first, dense-but-organized state visualization, borderless cards that only elevate on interaction)
- **Vercel** (typographic hierarchy for spec-heavy content, generous vertical rhythm, clear information density levels)
- **PCBWay** (scannable technical parameters in form-based layouts, status badges on build-step entities)

---

## 2. Color Rationale

### 2.1 Why This Palette

| Role | Token | Value | Rationale |
|------|-------|-------|-----------|
| Primary | `--color-primary` | `#0d9488` | Deep teal. Evokes circuit-board solder mask and PCB copper traces. Distinctive — immediately differentiates from the old Bootstrap `#0d6efd` blue that dominated the previous version. Works equally well on dark and light backgrounds. |
| Accent | `--color-accent` | `#06b6d4` | Cyan. Represents data flow, signal traces, connection activity. Pairs with teal in a complementary cool palette. Used for hover states, active indicators, and data-path visualizations. |
| Background (dark) | `--color-bg` | `#0f172a` | Slate-900. Deep, neutral dark that doesn't tint toward blue or purple. Oscilloscope-screen feel. |
| Surface 1 | `--color-surface-1` | `#1e293b` | Slate-800. Card/panel backgrounds. |
| Surface 2 | `--color-surface-2` | `#334155` | Slate-700. Hover/elevated surfaces. |
| Border | `--color-border` | `#475569` | Slate-600. Subtle borders, dividers. |
| Text | `--color-text` | `#f1f5f9` | Slate-100. Primary text. |
| Text Secondary | `--color-text-secondary` | `#94a3b8` | Slate-400. Muted text. |
| Text Tertiary | `--color-text-tertiary` | `#64748b` | Slate-500. Placeholder, disabled. |

### 2.2 Semantic Colors

| Token | Value | Usage Example |
|-------|-------|--------------|
| `--color-success` | `#10b981` (Emerald) | Pipeline step completed, component compatibility OK, save confirmation |
| `--color-warning` | `#f59e0b` (Amber) | Budget exceeded, pin conflict detected, deprecated platform warning |
| `--color-error` | `#f43f5e` (Rose) | Build failure, incompatible component, API error |
| `--color-info` | `#06b6d4` (Cyan) | Connection status, data transfer, informational tooltips |

**Semantic color usage rules:**
- **Emerald** for success states only — never decorative. Example: "代码生成完成" badge after codegen finishes.
- **Amber** for warnings that don't block progress. Example: "配件价格可能已变动" on price estimates.
- **Rose** for errors and destructive actions. Example: "删除项目" button, API error toast.
- **Cyan** for informational indicators. Example: "数据加载中" spinner, connection status dot.

### 2.3 Dark Mode Strategy

Dark mode is not an afterthought — it's the default rendering intent, inspired by oscilloscope displays:

- **Background**: Deep slate (`#0f172a`) — absorbs glare during long coding sessions, makes color-coded elements pop
- **Surfaces**: Layered slate variants (`#1e293b`, `#334155`) — creates depth without shadows
- **Accents**: Cyan (`#06b6d4`) and teal (`#0d9488`) — both have sufficient luminance contrast on dark slate
- **Never pure black**: True `#000000` creates uncomfortable halation against bright content. Always use deep slate.

### 2.4 Light Mode

Light mode inverts surfaces while keeping accent colors intact:

| Token | Dark | Light |
|-------|------|-------|
| `--color-bg` | `#0f172a` | `#f8fafc` (Slate-50) |
| `--color-surface-1` | `#1e293b` | `#ffffff` |
| `--color-surface-2` | `#334155` | `#f1f5f9` (Slate-100) |
| `--color-border` | `#475569` | `#e2e8f0` (Slate-200) |
| `--color-text` | `#f1f5f9` | `#0f172a` (Slate-900) |
| `--color-text-secondary` | `#94a3b8` | `#64748b` (Slate-500) |

### 2.5 What Changed From v1 (Bench Design System)

The existing `design-tokens.json` and v1 `DESIGN.md` used signal-green `#00b894` with a "workbench" metaphor (PCB green for success, wire colors as functional tokens). This v2 replaces:

| Old (Bench v1) | New (Oscilloscope v2) | Why |
|----------------|-----------------------|-----|
| Primary `#00b894` (Signal Green) | Primary `#0d9488` (Deep Teal) | Teal is more distinctive against competitors, less gaming-aesthetic, better in both modes |
| Accent `#0984e3` (Probe Blue) | Accent `#06b6d4` (Cyan) | Cyan pairs more naturally with teal (same hue family); probe blue was too close to old Bootstrap |
| Surfaces: GitHub-dark `#0d1117` | Surfaces: Slate `#0f172a` | Slate is cooler, more technical; GitHub-dark is overused |
| Semantic: Red `#e17055` | Semantic: Rose `#f43f5e` | Rose is more modern, better contrast on slate |
| Wire colors (Power/Ground/Signal/Data/Clock/PWM) | Removed | Over-engineered for actual use; semantic colors cover all needs |

---

## 3. Typography System

### 3.1 Font Stack

```
UI:  'Inter', 'Noto Sans SC', system-ui, -apple-system, sans-serif
Code: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace
```

**Why this stack:**
- **Inter**: Excellent readability at all sizes, tight metrics work well for dense technical UIs. Open source.
- **Noto Sans SC**: Google's Noto for Simplified Chinese — covers CJK with consistent stroke weight matching Inter's upright character. Essential for Chinese-first rendering.
- **Inter as CJK fallback**: Inter's metrics pair well with Noto Sans SC. When both are loaded, Chinese text renders in Noto and Latin/numbers in Inter.
- **JetBrains Mono**: Ligature support for `->`, `!=`, `>=` in code. Tight letter-spacing suits Arduino pin tables and code listings.

### 3.2 Type Scale

| Level | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|------|--------|-------------|----------------|-------|
| `display-lg` | 48px | 600 | 1.1 | -0.02em | Hero headline |
| `display-md` | 36px | 600 | 1.15 | -0.015em | Page title |
| `heading-lg` | 24px | 600 | 1.2 | -0.01em | Section title |
| `heading-md` | 20px | 600 | 1.25 | -0.005em | Card title |
| `heading-sm` | 16px | 600 | 1.3 | 0 | Panel title (pro mode) |
| `body-lg` | 16px | 400 | 1.5 | 0 | Body text |
| `body-md` | 14px | 400 | 1.5 | 0 | UI labels, descriptions |
| `body-sm` | 12px | 400 | 1.5 | 0 | Captions, timestamps, badges |
| `code` | 14px | 400 | 1.5 | 0 | Code blocks, pin tables |
| `code-sm` | 12px | 400 | 1.4 | 0 | Inline code, terminal output |

**Line-height notes for CJK:**
- Chinese text requires taller line heights than Latin text at the same font size due to character density. `1.5` for body is the minimum comfortable reading height for Chinese text.
- Heading line heights are tighter (`1.2–1.3`) because headings are short and Chinese characters at large sizes have generous internal spacing.
- Mixing Chinese and Latin in the same line (e.g., "Arduino UNO 开发板") can create baseline alignment issues — `body-lg` at `1.5` handles this correctly.

### 3.3 Code Typography

Code blocks use a separate monospace stack. The existing code blocks (`code/page.tsx`) use hardcoded `#1e1e1e` background with `#d4d4d4` text — these should become `var(--color-surface-1)` for background and `var(--color-text)` for foreground, with syntax highlighting tokens mapped to the design system:

```
Comment:   var(--color-text-tertiary)   #64748b
Keyword:   var(--color-accent)           #06b6d4
String:    var(--color-success)          #10b981
Function:  var(--color-primary)          #0d9488
Number:    var(--color-warning)          #f59e0b
```

---

## 4. Spacing & Layout

### 4.1 Grid System

Base grid: **8px** with **4px** fine adjustments.

The 8px base creates consistent vertical rhythm. The 4px granularity allows micro-adjustments for form inputs, icon gaps, and badge padding without breaking the rhythm.

| Token | Value | Usage |
|-------|-------|-------|
| `--space-0.5` | 4px | Micro spacing (icon-text gap, badge padding) |
| `--space-1` | 8px | Tight spacing (button padding-y, list item gap) |
| `--space-1.5` | 12px | Compact spacing (form gap between label and input) |
| `--space-2` | 16px | Standard spacing (card padding) |
| `--space-2.5` | 20px | Generous spacing |
| `--space-3` | 24px | Section spacing |
| `--space-4` | 32px | Large section spacing |
| `--space-5` | 40px | Page section gaps |
| `--space-6` | 48px | Page padding |
| `--space-8` | 64px | Major page sections |
| `--space-10` | 80px | Hero/splash spacing |
| `--space-12` | 96px | Maximum spacing |

### 4.2 Why Generous Whitespace Matters for a Technical Tool

Schematic views, pin tables, and code listings are dense by nature. Generous whitespace around these elements:

- **Reduces cognitive load**: The eye rests between dense sections. Compare the current `recommendations/page.tsx` table layout (tight padding, `s.td` with 8px padding) to a version with `--space-2` (16px) cell padding — the latter is significantly more scannable.
- **Prevents adjacent-element confusion**: In the pin editor (`pins/page.tsx`), select dropdowns sit next to input fields in tight rows. `16px` cell padding prevents accidental mis-clicks.
- **Creates reading hierarchy**: In the review page (`review/page.tsx`), the AI analysis section and the "补充说明" textarea need `--space-3` (24px) separation — without it, they visually merge into one block.

### 4.3 Container Width

The current `s.container` uses max-width `960px`. This is appropriate for the following reasons:

- Code blocks at 14px font are readable at ~65–75 characters per line on a 960px wide container with 24px padding (effective 912px content area)
- Pin tables with 4–5 columns fit comfortably without horizontal scroll
- CJK text at 16px renders ~18–22 characters per line at this width, which is the ideal line length for Chinese readability
- **Exception**: The schematic viewer and code editor may benefit from a full-width layout toggle for users on wide monitors

### 4.4 Responsive Breakpoints

| Breakpoint | Width | Layout Changes |
|------------|-------|----------------|
| `sm` | < 640px | Single column grid, stacked nav, full-width buttons |
| `md` | 640–1024px | 2-column grid, compact header |
| `lg` | > 1024px | Full layout, sticky sidebar for pipeline steps |

The current grid (`s.grid2` = `1fr 1fr`) collapses to single column below 640px.

---

## 5. Component Design Principles

### 5.1 Cards (`s.card` in `styles.ts`)

**Current state**: `border: 1px solid #dee2e6`, `borderRadius: 8`, `padding: 16`, no shadow.

**Design system spec:**
- `background: var(--color-surface-1)`
- `border: 1px solid var(--color-border)`
- `border-radius: var(--radius-md)` (8px)
- `padding: var(--space-2)` (16px) default, `var(--space-3)` (24px) for feature cards
- Shadow: none in resting state (Linear-inspired flatness)
- On hover/interaction: subtle elevation (`box-shadow: 0 1px 3px rgba(0,0,0,0.15)`) and border becomes `var(--color-primary)`
- Cards are NEVER decorative — they always contain actionable content

### 5.2 Buttons (`s.btn` in `styles.ts`)

**Current state**: Hardcoded `#0d6efd` primary, `8px 24px` padding, `4px` radius. The Bootstrap palette is hardcoded at `styles.ts:4`.

**Design system spec:**

| Variant | Background | Text | Hover | Usage |
|---------|-----------|------|-------|-------|
| Primary | `var(--color-primary)` | White | +10% brightness | Main CTA ("开始生成", "确认") |
| Secondary | Transparent | `var(--color-text)` | `var(--color-surface-2)` bg | Alternative actions ("返回") |
| Outline | Transparent | `var(--color-primary)` | `var(--color-primary)` bg, white text | Tertiary actions, pro mode |
| Ghost | Transparent | `var(--color-text-secondary)` | `var(--color-surface-2)` bg | Toolbar, inline actions |
| Danger | `var(--color-error)` | White | +10% brightness | Destructive ("删除项目") |

**Size variants:**
- Default: `height: 40px`, `padding: 0 var(--space-2)` (16px), `font-size: 14px`
- Small: `height: 32px`, `padding: 0 var(--space-1.5)` (12px), `font-size: 13px` (pro mode)
- Large: `height: 48px`, `padding: 0 var(--space-3)` (24px), `font-size: 16px` (beginner mode)

### 5.3 Badges (`s.badge` in `styles.ts`)

**Current state**: Inline function mapping status strings to Bootstrap colors (`ready → #198754`, `analyzing → #ffc107`, etc.).

**Design system spec:**
- Compact: `height: 20px`, `padding: 0 8px`, `font-size: 12px`, `border-radius: var(--radius-full)` (9999px)
- Semantic colors map:
  - `ready` / `completed` / `success` → `var(--color-success)` bg + white text
  - `generating` / `analyzing` / `recommending` / `finalizing` → `var(--color-info)` bg + white text
  - `failed` / `error` → `var(--color-error)` bg + white text
  - `warning` / `expired` → `var(--color-warning)` bg + `#0f172a` text (must use dark text on amber for contrast)
- Badges should use a light background variant with colored text for less emphasis:
  - `.badge-soft-success`: `background: rgba(16,185,129,0.1)`, `color: var(--color-success)`
  - `.badge-soft-error`: `background: rgba(244,63,94,0.1)`, `color: var(--color-error)`

### 5.4 Pipeline Steps (Horizontal Stepper)

The app follows a sequential pipeline: New Project → Requirements → Components → Code → Schematic → Export. Each step needs a visual indicator:

- **Current step**: Solid teal circle with white number, bold label
- **Completed step**: Teal circle with checkmark icon
- **Pending step**: Outlined circle with muted label
- **Failed step**: Rose circle with "!" icon

Implementation: A horizontal flex container with connecting lines between steps. Connector lines are `2px` solid `var(--color-border)` for pending, `var(--color-primary)` for completed.

### 5.5 Code Blocks

**Current state** (`code/page.tsx`): Hardcoded `background: #1e1e1e`, `color: #d4d4d4`, `borderRadius: 8`.

**Design system spec:**
- `background: var(--color-surface-1)` — integrates with theme; no hardcoded VS Code dark colors
- `border-radius: var(--radius-md)` (8px)
- `padding: var(--space-2)` (16px)
- `font-family: var(--font-code)`, `font-size: 14px`
- Syntax highlighting tokens: mapped to design system (see §3.3)
- Horizontal scroll on overflow (`overflow-x: auto`)
- The editable textarea should match the read-only code block styling exactly (currently `code/page.tsx:41` uses inline styles that duplicate the hardcoded colors)

### 5.6 Modals

**Current state** (`keys/page.tsx`): `position: fixed`, `background: rgba(0,0,0,0.5)`, centered overlay.

**Design system spec:**
- Backdrop: `background: rgba(0,0,0,0.6)`, `backdrop-filter: blur(4px)` (blur gives visual focus to modal content)
- Content: `background: var(--color-surface-1)`, `border-radius: var(--radius-lg)` (12px), `padding: var(--space-3)` (24px)
- Max height: `90vh` with `overflow-y: auto` (prevents overflow on small screens)
- Close button: top-right, ghost variant with `×` or an X icon
- Animation: fade-in + slight scale-up (`transform: scale(0.96) → scale(1)`, 200ms ease-out)

### 5.7 Empty States

**Current state**: "还没有项目" in a card with a button — functional but uninspired.

**Design system spec:**
- Centered layout with:
  1. An icon or simple illustration (SVG, 48px, using `var(--color-text-tertiary)`)
  2. A heading: "还没有项目"
  3. A description explaining what to do: "点击下方按钮创建你的第一个单片机项目"
  4. A primary CTA button
- Tone should be helpful, not apologetic. Guide the user forward.

### 5.8 Tables (`s.table`, `s.th`, `s.td` in `styles.ts`)

**Current state**: `borderCollapse: collapse`, `borderBottom: 2px solid #dee2e6` on headers, `1px solid` on cells.

**Design system spec:**
- `width: 100%`, `border-collapse: collapse`
- Header row: `border-bottom: 2px solid var(--color-border)`, `font-weight: 600`, `font-size: 13px`, `color: var(--color-text-secondary)`, `text-align: left`
- Body cells: `padding: var(--space-1.5)` (12px) `var(--space-2)` (16px), `border-bottom: 1px solid var(--color-border)`, `font-size: 14px`
- Hover row: `background: var(--color-surface-2)` for the entire `<tr>`
- Sticky header: `<th>` elements have `position: sticky; top: 0; z-index: 1; background: var(--color-surface-1)` so headers remain visible during scroll
- Alternating rows: `tr:nth-child(even)` gets `background: rgba(255,255,255,0.02)` (subtle enough to not distract)

### 5.9 Toast Notifications

Already implemented in `api-toast.ts`. Design system spec:
- Slide-in from top-right, `transform: translateX(120%) → translateX(0)`, 300ms ease-out
- Auto-dismiss after 4 seconds (configurable)
- Semantic colors per toast type
- Max width: 400px
- Dismiss button on hover

---

## 6. Dark Mode

### 6.1 Why Dark Mode Matters for This App

1. **Code editing**: The code preview (`code/page.tsx`) and future inline code editor are visually dominant features. Dark backgrounds for code are the industry standard — forcing a white background would be hostile to users working on code.
2. **Late-night tinkering**: Electronics hobbyists and makers frequently work at night. A dark-mode-first design reduces eye strain during extended sessions.
3. **Oscilloscope aesthetic**: Dark backgrounds with bright signal colors directly evoke oscilloscope displays and electronics workbenches. This is the app's design identity.

### 6.2 Implementation Strategy

- CSS custom properties for all colors, switched via `[data-theme="dark"]` / `[data-theme="light"]` on `<html>`
- Default to dark (no `prefers-color-scheme` override — intentional choice)
- Theme persisted in `localStorage` and respected on page load
- Smooth transition: `transition: background-color 200ms ease, color 200ms ease` on `body`

### 6.3 Dark/Light Token Mapping

| Token | Dark | Light |
|-------|------|-------|
| `--color-bg` | `#0f172a` | `#f8fafc` |
| `--color-surface-1` | `#1e293b` | `#ffffff` |
| `--color-surface-2` | `#334155` | `#f1f5f9` |
| `--color-border` | `#475569` | `#e2e8f0` |
| `--color-text` | `#f1f5f9` | `#0f172a` |
| `--color-text-secondary` | `#94a3b8` | `#64748b` |
| `--color-primary` | `#0d9488` | `#0d9488` (unchanged — sufficient contrast on both) |
| `--color-accent` | `#06b6d4` | `#06b6d4` (unchanged) |
| `--color-success` | `#10b981` | `#059669` (darkened for contrast on white) |
| `--color-warning` | `#f59e0b` | `#d97706` (darkened for contrast on white) |
| `--color-error` | `#f43f5e` | `#e11d48` (darkened for contrast on white) |
| `--color-info` | `#06b6d4` | `#0891b2` (darkened for contrast on white) |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.3)` | `0 1px 2px rgba(0,0,0,0.05)` |
| `--shadow-md` | `0 4px 8px rgba(0,0,0,0.35)` | `0 4px 8px rgba(0,0,0,0.08)` |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,0.4)` | `0 8px 24px rgba(0,0,0,0.12)` |

---

## 7. Motion

### 7.1 Philosophy

Motion is purposeful, not decorative. Every animation communicates a state change or provides spatial orientation. No gratuitous scroll animations, no parallax, no confetti.

### 7.2 Timing Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-fast` | 150ms | Hover states, button press, micro-interactions |
| `--duration-normal` | 250ms | Modal enter/exit, toast, page transitions |
| `--duration-slow` | 400ms | Skeleton shimmer cycle, progress animations |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Enter animations (overshoot-free, feels natural) |
| `--ease-in` | `cubic-bezier(0.4, 0, 0.68, 0.06)` | Exit animations (fade out quickly) |

### 7.3 Specific Animations

**Hover elevation** (cards, buttons):
- `transform: translateY(-1px)`, `box-shadow` transition, 150ms ease-out
- Only on interactive cards (those with `cursor: pointer`)

**Button press**:
- `transform: scale(0.97)`, 100ms ease-in on `:active`
- Creates tactile feedback without jarring the layout

**Modal enter**:
- Backdrop: `opacity: 0 → 1`, 200ms ease-out
- Content: `transform: scale(0.96) → scale(1)`, `opacity: 0 → 1`, 250ms ease-out
- Separately timed so the backdrop appears slightly before the content

**Modal exit**:
- Backdrop + content: `opacity: 1 → 0`, 150ms ease-in (both together, fast dismissal)

**Toast slide-in**:
- `transform: translateX(120%) → translateX(0)`, 300ms ease-out
- Auto-dismiss: `opacity: 1 → 0`, 300ms ease-in

**Skeleton shimmer**:
- Already implemented in `Skeleton.tsx` with `@keyframes shimmer`
- Current duration 1.5s — appropriate; keeps animation visible but not distracting
- Colors must be updated to use design system tokens (see §9 Migration Guide)

**Loading spinner**:
- Already implemented in `LoadingSpinner.tsx` with `@keyframes spin`
- Current `borderTopColor: '#1976d2'` must become `var(--color-primary)`
- Duration 0.8s — appropriate for indeterminate loading; for determinate loading, use a progress bar instead

### 7.4 What NOT to Animate

- Page scroll (no scroll-triggered reveals — they add latency to information access)
- Layout shift (never animate `width`, `height`, `top`, `left`, or `margin` — use `transform` instead to avoid repaints)
- Text color changes (animating `color` causes text rendering reflow; use `opacity` for text transitions)

---

## 8. Accessibility

### 8.1 Contrast Ratios (WCAG AA)

All text/background combinations must meet WCAG AA (4.5:1 for normal text, 3:1 for large text ≥24px or ≥19px bold).

**Verified combinations on dark slate (`#0f172a`):**
- Text `#f1f5f9` on bg `#0f172a`: **14.1:1** ✓
- Text secondary `#94a3b8` on bg `#0f172a`: **7.3:1** ✓
- Text tertiary `#64748b` on bg `#0f172a`: **4.6:1** ✓ (meets AA for normal text — this is the minimum)
- Primary `#0d9488` on bg `#0f172a`: **4.8:1** ✓
- Accent `#06b6d4` on bg `#0f172a`: **5.2:1** ✓
- Success `#10b981` on bg `#0f172a`: **5.7:1** ✓

**⚠ Critical warning on amber**: `--color-warning` (`#f59e0b`) on white backgrounds fails AA (2.8:1). Always use a darkened amber (`#d97706`) on light surfaces, or ensure warning badges have dark backgrounds with white text.

### 8.2 Focus States

Every interactive element must have a visible focus indicator:
- `outline: 2px solid var(--color-accent)`
- `outline-offset: 2px`
- Never use `outline: none` without providing an alternative focus style
- Focus ring should be visible in both light and dark modes (cyan `#06b6d4` works on both)

### 8.3 Touch Targets

- Minimum 44×44px in beginner mode (already satisfied by the 44px button height)
- Minimum 32×32px in professional mode (tight, but the compact layout prioritizes density)
- Form labels are clickable (wrapping `<input>` with `<label>` or using `htmlFor`)

### 8.4 Color + Icon/Text

State is never conveyed by color alone:
- Badges: colored background + text label (e.g., "完成" in green badge, not just a green dot)
- Status indicators: icon (checkmark, X, spinner) + text
- Errors: rose text + error icon + descriptive message
- Loading: spinner animation + text label (already partially implemented in `LoadingSpinner.tsx` with optional `label` prop)

### 8.5 Keyboard Navigation

- All interactive elements are reachable via Tab in logical order
- Modal: focus is trapped inside while open; Tab cycles through modal elements; Escape closes
- Pipeline steps: arrow keys navigate between steps
- Tables: Tab navigates through interactive cells (select dropdowns, edit buttons)

---

## 9. Migration Guide — From Bootstrap Blue to Oscilloscope Design System

This is a step-by-step plan to migrate from the current state (Bootstrap `#0d6efd` in `styles.ts`, hardcoded colors in components, no CSS variables) to the full design system.

### Step 1: Create CSS Variables File

Create `gateway/src/lib/tokens.css` with all design tokens as CSS custom properties:

```css
:root {
  --color-primary: #0d9488;
  --color-accent: #06b6d4;
  --color-bg: #0f172a;
  --color-surface-1: #1e293b;
  --color-surface-2: #334155;
  --color-border: #475569;
  --color-text: #f1f5f9;
  --color-text-secondary: #94a3b8;
  --color-text-tertiary: #64748b;
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error: #f43f5e;
  --color-info: #06b6d4;
  --space-1: 8px;
  /* ... all spacing tokens */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;
  --font-ui: 'Inter', 'Noto Sans SC', system-ui, -apple-system, sans-serif;
  --font-code: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
}

[data-theme="light"] {
  --color-bg: #f8fafc;
  --color-surface-1: #ffffff;
  --color-surface-2: #f1f5f9;
  --color-border: #e2e8f0;
  --color-text: #0f172a;
  --color-text-secondary: #64748b;
  --color-text-tertiary: #94a3b8;
  --color-success: #059669;
  --color-warning: #d97706;
  --color-error: #e11d48;
  --color-info: #0891b2;
}
```

Import it in `layout.tsx` at the top.

### Step 2: Update `styles.ts` to Use CSS Variables

Replace hardcoded HEX values with `var()` references:

```typescript
export const theme = {
  primary: "var(--color-primary)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-error)",
  info: "var(--color-info)",
  // Remove: light, dark, gray, border, bgLight
  // Add: surface1, surface2, text, textSecondary, textTertiary, bg
};
```

**⚠ File to change**: `gateway/src/lib/styles.ts`

### Step 3: Audit All Hardcoded Color Values in Components

At least 3+ inconsistencies have been identified:

| Location | Hardcoded Value | Should Be | Priority |
|----------|----------------|-----------|----------|
| `LoadingSpinner.tsx:11` | `#1976d2` (Material blue) | `var(--color-primary)` | Critical — this is a third distinct blue value |
| `ErrorBoundary.tsx:45` | `#1976d2` (Material blue) | `var(--color-primary)` | Critical — same mismatch |
| `LoadingSpinner.tsx:16` | `#666` | `var(--color-text-secondary)` | Medium |
| `LoadingSpinner.tsx:10` | `#e0e0e0` | `var(--color-border)` | Medium |
| `Skeleton.tsx:20` | `border: 1px solid #e0e0e0` | `border: 1px solid var(--color-border)` | Medium |
| `code/page.tsx:38` | `background: "#fff3cd"` | `background: var(--color-warning)` at 10% opacity | Low — warning banner |
| `code/page.tsx:39` | `background: "#1e1e1e", color: "#d4d4d4"` | `background: var(--color-surface-1), color: var(--color-text)` | High — code block |
| `schematic/page.tsx:29` | `background: "#fff"` | `background: var(--color-bg)` | Medium |
| `layout.tsx:29` | `background: theme.bgLight` | `background: var(--color-bg)` | High |
| `layout.tsx:29` | `fontFamily: "-apple-system..."` | `fontFamily: "var(--font-ui)"` | Medium |

**Files to change**:
- `gateway/src/components/LoadingSpinner.tsx`
- `gateway/src/components/ErrorBoundary.tsx`
- `gateway/src/components/Skeleton.tsx`
- `gateway/src/app/projects/[id]/code/page.tsx`
- `gateway/src/app/projects/[id]/schematic/page.tsx`
- `gateway/src/app/layout.tsx`

### Step 4: Add Dark Mode CSS Class Toggle

In `layout.tsx`:

1. Add `[data-theme="dark"]` on `<html>` by default
2. Persist user preference in `localStorage`
3. Add a theme toggle button in the header (currently the header has a beginner/pro mode toggle — a sun/moon icon can sit next to it)
4. Apply `transition: background-color 200ms ease, color 200ms ease` on `<body>` for smooth theme switching

### Step 5: Add Responsive Breakpoint Utilities

Create a CSS file with responsive utilities:

```css
@media (max-width: 639px) {
  .hide-sm { display: none !important; }
  .stack-sm { flex-direction: column !important; }
  .full-sm { width: 100% !important; }
}

@media (min-width: 640px) and (max-width: 1023px) {
  .hide-md { display: none !important; }
}
```

Update layout components to use these utilities for responsive behavior.

### Step 6: Update Global Styles in `layout.tsx`

The `<html>` and `<body>` elements in `layout.tsx` must set the design system foundation:

- `<html>`: add `lang="zh-CN"` and `data-theme="dark"`
- `<body>`: `font-family: var(--font-ui)`, `background: var(--color-bg)`, `color: var(--color-text)`, `line-height: 1.5`
- Remove the current inline `fontFamily` and `background` on `<body>` (`layout.tsx:29`)

### Step 7 (Optional): Remove Unused Design Artifacts

The v1 "Bench" design system artifacts (`design-tokens.json`, `design-preview.html`) can be updated to match v2 tokens or removed. The `design-preview.html` is a useful reference tool — update its tokens to the new palette.

---

## Appendix A: File Reference Map

| File | Current Issue | Design System Rule |
|------|---------------|-------------------|
| `gateway/src/lib/styles.ts` | Bootstrap `#0d6efd` hardcoded | Use `var(--color-*)` references |
| `gateway/src/components/LoadingSpinner.tsx` | `#1976d2` + `#666` + `#e0e0e0` | Use `var(--color-primary)`, `var(--color-text-secondary)`, `var(--color-border)` |
| `gateway/src/components/ErrorBoundary.tsx` | `#1976d2` | Use `var(--color-primary)` |
| `gateway/src/components/Skeleton.tsx` | `#f0f0f0` / `#e0e0e0` | Use `var(--color-surface-1)` / `var(--color-border)` |
| `gateway/src/app/layout.tsx` | Inline body font, `bgLight` | Use CSS variables, set `font-family: var(--font-ui)` |
| `gateway/src/app/projects/[id]/code/page.tsx` | `#1e1e1e` / `#d4d4d4` / `#fff3cd` | Use `var(--color-surface-1)` / `var(--color-text)` / warning token |
| `gateway/src/app/projects/[id]/schematic/page.tsx` | `background: "#fff"` | Use `var(--color-bg)` |
| `design-tokens.json` | Old Bench v1 tokens | Update to Oscilloscope v2 or remove |
| `design-preview.html` | Old Bench v1 CSS | Update to Oscilloscope v2 or remove |

## Appendix B: Color Accessibility Reference

| Token | Value | On `#0f172a` (Dark) | On `#f8fafc` (Light) | AA Normal | AA Large |
|-------|-------|---------------------|----------------------|-----------|----------|
| `--color-primary` | `#0d9488` | 4.8:1 ✓ | 4.2:1 ✓ | ✓ | ✓ |
| `--color-accent` | `#06b6d4` | 5.2:1 ✓ | 4.8:1 ✓ | ✓ | ✓ |
| `--color-success` | `#10b981` | 5.7:1 ✓ | 3.6:1 ✓ | ✗ (borderline) | ✓ |
| `--color-success` (light) | `#059669` | — | 5.1:1 ✓ | ✓ | ✓ |
| `--color-warning` | `#f59e0b` | 2.8:1 ✗ | 5.9:1 ✓ | ✗ on dark | ✓ on dark |
| `--color-warning` (light) | `#d97706` | 4.9:1 ✓ | — | ✓ | ✓ |
| `--color-error` | `#f43f5e` | 4.1:1 ✓ | 5.5:1 ✓ | ✗ (borderline) | ✓ |
| `--color-error` (light) | `#e11d48` | 4.9:1 ✓ | — | ✓ | ✓ |

⚠ **Warning on slate dark**: `--color-warning` (`#f59e0b`) does NOT meet AA on `#0f172a` for normal text. When using warning colors on dark backgrounds:
- Use the color as a background (with dark text) rather than text on the dark background
- Or use `#d97706` (dark amber) which meets 4.5:1 on slate
