---
phase: 04-pretty-view-visual-reskin-glass-depth-aesthetic
plan: 01
subsystem: pretty-view visual reskin — foundation layer
tags:
  - pretty-view
  - visual
  - reskin
  - phase-4
  - tokens
  - identity-badge
requires: []
provides:
  - phase-4-design-tokens
  - pv-id-hue-plumbing
  - identity-badge-lg-variant
  - pv-identity-breathe-keyframes
affects:
  - src/ui/index.css
  - src/ui/features/terminal/IdentityBadge.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
tech-stack:
  added:
    - "Tailwind v4 @theme inline tokens: 12 color, 2 radius, 3 shadow"
    - "@keyframes pv-identity-breathe + prefers-reduced-motion variant"
patterns:
  - "IdentityBadge size prop (default md = byte-identical patch #17/#38) — additive extension at natural point"
  - "CSS custom property (--pv-id-hue) scoped per PrettyView root, consumed by downstream hsla(var(...)) arbitrary-value classes"
key-files:
  modified:
    - src/ui/index.css
    - src/ui/features/terminal/IdentityBadge.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
decisions:
  - "Fallback hue 35 (warm amber, mock's Tina hue) for panes with no identity OR identity with no colorHue — deliberate break from terminal-pane hash-based fallback per CONTEXT.md § Decisions 2"
  - "Additive size prop on IdentityBadge with md default (rather than a wrapper component) — single source of truth, minimal Terminal.tsx-unaware surface"
  - "Terminal.tsx explicitly untouched — the plan's hardest constraint; verified via git diff --stat"
metrics:
  duration: ~10min
  completed: 2026-07-18
---

# Phase 4 Plan 1: Foundation — Design Tokens + IdentityBadge lg + PrettyView Hue Plumbing Summary

**One-liner:** Phase 4 Glass reskin foundation shipped — 17 new `@theme` tokens (colors/radii/shadows) + breathing keyframes + `--pv-id-hue` root plumbing + IdentityBadge `size="lg"` treatment ready for Plan 04-02's per-component reskin.

## Tokens added to `@theme inline {}`

**Colors (12 total, all `--color-pv-*`):**
- `--color-pv-base` `#14120e` (warm off-black gradient top)
- `--color-pv-base-mid` `#100e0b`
- `--color-pv-base-end` `#0a0907`
- `--color-pv-surface-quiet` `rgba(255, 240, 215, 0.025)` (ambient panel tint)
- `--color-pv-surface-quiet-alt` `rgba(255, 240, 215, 0.008)`
- `--color-pv-border-quiet` `rgba(255, 240, 215, 0.05)`
- `--color-pv-border-quiet-strong` `rgba(255, 240, 215, 0.09)` (textarea outline per VISUAL-07)
- `--color-pv-fg` `#e8e4d8` (warm off-white text)
- `--color-pv-fg-muted` `#a89a80`
- `--color-pv-fg-dim` `#7a6f60`
- `--color-pv-code-fg` `#ffb896` (warm coral for inline `<code>`)

**Radii (2):**
- `--radius-pv-bubble` `14px`
- `--radius-pv-card` `10px`

**Shadow stacks (3):**
- `--shadow-pv-raised-md` — 3-layer: ambient drop + inset top-rim highlight + hairline outer stroke
- `--shadow-pv-quiet-card` — 2-layer subtle floating card
- `--shadow-pv-root` — root container shadow (available if Plan 04-02 wants to apply outer treatment)

**Zero adjustments from the plan-enumerated set** — all values ship as specified. No empirical tweaks were needed since consumption is still deferred to Plan 04-02.

## Keyframes + reduced-motion

- `@keyframes pv-identity-breathe` — 0/100 `filter: brightness(1)`, 50 `brightness(1.08)`.
- `@media (prefers-reduced-motion: reduce) { .pv-identity-breathe { animation: none !important; } }` — added between `@keyframes blink` (preserved) and `.session-tint` (preserved).

## IdentityBadge — `md` byte-identical, `lg` new

- `md` branch (default): patch #17 + patch #38 byte-preserved: 120px width, 80px avatar, 15/13pt fonts, `top-2 right-2`, `hover:opacity-0`, `aria-hidden="true"`.
- `lg` branch (Phase 4 pretty-view): 56px avatar on left, name+title stacked to right, `flex-row items-center gap-3`, `top-3 right-3`, `borderRadius: 12`, warm-glass linear-gradient background, `backdrop-filter: blur(24px) saturate(1.4)` + `WebkitBackdropFilter` fallback, `border` + inset rim + outer glow via `hsla(${hue}, 65%, 55%, ...)`, avatar boxShadow triple layer, `animation: pv-identity-breathe 5s ease-in-out infinite` + `.pv-identity-breathe` classname marker, `hover:opacity-0` and `aria-hidden="true"` preserved.
- Fallback hue in `lg` branch: `identity.colorHue ?? 35` — matches PrettyView's root fallback.
- File is 114 lines total (well under 130-line cap).

## PrettyView.tsx wiring

- Imports added: `sessionMatchKey`, `useSessionIdentity` (from `@/features/terminal/session-hue`); `IdentityBadge` (from `@/features/terminal/IdentityBadge`).
- Derives `pvIdentityHue` via `useSessionIdentity(tmuxSession)`, `pvIdentityKey` via `sessionMatchKey(tmuxSession)`, and `pvHue = pvIdentityHue ?? 35`.
- Root `<div>` gets `data-pv-root` attribute + inline style merging `"--pv-id-hue": String(pvHue)` with the incoming `style` prop.
- `<IdentityBadge identityKey={pvIdentityKey} size="lg" />` mounts as first child of root, gated on `pvIdentityKey && ...`.
- All existing state hooks, `useAutoScroll`, WS effect + all its handler cases (including Phase 3's `session_holding` / `session_changed`), and all child mounts are byte-preserved.

## Terminal.tsx: UNCHANGED

Verified via `git diff --stat src/ui/features/terminal/Terminal.tsx` — no output. The `<IdentityBadge identityKey={identityKey} />` call site at line 2888 continues to work byte-identically because the new `size?: "md" | "lg"` prop defaults to `"md"` (the pre-Phase-4 output).

## Build

`npm run build` → `✓ built in 13.24s`. No TypeScript errors, no CSS errors. Bundle-size warning for `file-preview-vendor` + `codemirror` is pre-existing (unrelated to this plan).

## Deviations from Plan

None. Plan executed exactly as written.

## Self-Check: PASSED

- `src/ui/index.css` — FOUND (Phase 4 tokens + keyframes + reduced-motion variant present).
- `src/ui/features/terminal/IdentityBadge.tsx` — FOUND (size prop + both branches present).
- `src/ui/features/pretty-view/PrettyView.tsx` — FOUND (imports + hue derivation + root style + IdentityBadge mount present).
- Commit `06b1f08` — FOUND in `git log`.

## Ready for Plan 04-02

The token vocabulary is now available. Plan 04-02 consumes `bg-[var(--color-pv-base)]`, `shadow-[var(--shadow-pv-raised-md)]`, `rounded-[var(--radius-pv-bubble)]`, `bg-[hsla(var(--pv-id-hue),75%,52%,0.18)]`, `border-[hsla(var(--pv-id-hue),75%,52%,0.28)]`, etc. across ChatMessage, ComposeBox, HarnessTasksPanel, BackgroundedAgentsPanel, BackgroundedShellsPanel, WipBubble, PlanPendingBubble, SessionHoldingBanner, and PrettyView's own body chrome.
