---
phase: 04-pretty-view-visual-reskin-glass-depth-aesthetic
plan: 02
subsystem: pretty-view visual reskin — per-component Glass depth application
tags:
  - pretty-view
  - visual
  - reskin
  - phase-4
  - glass
  - identity-hue
requires:
  - phase-4-design-tokens
  - pv-id-hue-plumbing
  - identity-badge-lg-variant
provides:
  - phase-4-glass-reskin-complete
affects:
  - src/ui/features/pretty-view/ChatMessage.tsx
  - src/ui/features/pretty-view/WipBubble.tsx
  - src/ui/features/pretty-view/PlanPendingBubble.tsx
  - src/ui/features/pretty-view/SessionHoldingBanner.tsx
  - src/ui/features/pretty-view/HarnessTasksPanel.tsx
  - src/ui/features/pretty-view/BackgroundedAgentsPanel.tsx
  - src/ui/features/pretty-view/BackgroundedShellsPanel.tsx
  - src/ui/features/pretty-view/PrettyView.tsx
  - src/ui/features/pretty-view/ComposeBox.tsx
tech-stack:
  added:
    - "Tailwind arbitrary-value classes consuming Wave 1 tokens: bg-[var(--color-pv-base)], shadow-[var(--shadow-pv-raised-md)], rounded-[var(--radius-pv-bubble)], hsla(var(--pv-id-hue),...) accents"
    - "backdrop-blur-xl + backdrop-blur-md + [-webkit-backdrop-filter:...] vendor-prefixed fallback classes"
  patterns:
    - "Per-pane identity hue applied via CSS custom property (--pv-id-hue) inherited from PrettyView root, consumed by leaf components' hsla() arbitrary values — no prop-drilling"
    - "Raised-bubble treatment vs ambient-panel treatment as two distinct visual languages: bubbles = raised physical objects (backdrop-blur-xl + multi-layer shadow + white/8 border); panels + banner = calm floating cards (backdrop-blur-md + quiet-card shadow + border-quiet)"
    - "Send button as the ONE identity-hue attention grab-point per VISUAL-08; reset + go-ahead take quieter neutral treatment with hue-tinted hover glow"
key-files:
  modified:
    - src/ui/features/pretty-view/ChatMessage.tsx
    - src/ui/features/pretty-view/WipBubble.tsx
    - src/ui/features/pretty-view/PlanPendingBubble.tsx
    - src/ui/features/pretty-view/SessionHoldingBanner.tsx
    - src/ui/features/pretty-view/HarnessTasksPanel.tsx
    - src/ui/features/pretty-view/BackgroundedAgentsPanel.tsx
    - src/ui/features/pretty-view/BackgroundedShellsPanel.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/ComposeBox.tsx
decisions:
  - "Root atmospheric depth applied via background-image (linear-gradient + 2 radial-gradients) — NEVER backdrop-filter/filter/transform/will-change/perspective, which would break SessionHoldingBanner sticky positioning per Plan 03-02 FRAGILITY WARNING (HARD LOCK)"
  - "Context-% fill bar ≥80% branch stays RED regardless of identity hue (semantic HARD LOCK — approaching-full is alarming beats per-pane identity signal)"
  - "Radial-gradient warm overlay uses resolved numeric ${pvHue} rather than hsla(var(--pv-id-hue),...) to avoid cross-browser @property interpolation edge cases; inner components' hsla(var(...)) work fine because they resolve at paint time"
  - "shadcn Textarea's built-in focus-visible:ring + focus-visible:border-ring defaults suppressed via focus-visible:ring-0 + focus-visible:outline-none so Phase 4 identity-hue focus ring wins cleanly"
  - "Terminal.tsx explicitly untouched — the plan's hardest constraint held across both Waves 1 and 2"
metrics:
  duration: ~15min
  completed: 2026-07-18
---

# Phase 4 Plan 2: Per-Component Glass Depth Reskin Summary

**One-liner:** All 9 pretty-view components reskinned to the Glass depth aesthetic — raised bubbles, ambient panels shelf, atmospheric root, quiet compose surround, identity-hue color chain end-to-end — with every behaviour byte-preserved and Terminal.tsx untouched.

## Files reskinned (9 total)

1. **ChatMessage.tsx** — bubble radius `--radius-pv-bubble`, `backdrop-blur-xl saturate-150` + webkit fallback, multi-layer raised shadow, white/8 border. Assistant branch: translucent mid-blue-gray gradient (`rgba(45,55,80,0.5) → rgba(28,35,55,0.55)`). User branch: identity-hue gradient (`hsla(var(--pv-id-hue),60%,45%,0.55) → hsla(var(--pv-id-hue),55%,30%,0.6)`) + hue-tinted rim + outer glow. prose-code → warm coral (`--color-pv-code-fg`) on chip rectangle. prose-pre gains inner shadow + hairline border.
2. **WipBubble.tsx** — shared assistant-bubble recipe. `animate-spin` preserved + `motion-reduce:animate-none` added (defensive: patch #51 did not previously gate; a paused Loader2 still reads as "waiting"). Loader tint shifts to `rgba(150,180,220,0.9)`.
3. **PlanPendingBubble.tsx** — shared assistant-bubble recipe. Static ClipboardList preserved per patch #63 (motion channel owned by WipBubble). Copy from patch #67 preserved.
4. **SessionHoldingBanner.tsx** — ambient-panel language (calm chrome), NOT raised-bubble. Linear-gradient over quiet surface, `--color-pv-border-quiet`, `--radius-pv-card`, `--shadow-pv-quiet-card`, `backdrop-blur-md` + webkit fallback. Static RefreshCcw preserved per Plan 03-02.
5. **HarnessTasksPanel.tsx** — shared ambient-panel recipe. Row fg swapped to `--color-pv-fg` family; static ArrowRight (in-progress) + Circle (pending) glyphs preserved unchanged.
6. **BackgroundedAgentsPanel.tsx** — shared ambient-panel recipe. subagentType tag pill upgraded to identity-hue accents (`hsla(var(--pv-id-hue),...)` × 3 for bg + border + text). Static ArrowRight glyph unchanged.
7. **BackgroundedShellsPanel.tsx** — shared ambient-panel recipe. Command line uses `--color-pv-fg-dim`. Static Terminal glyph unchanged.
8. **PrettyView.tsx** — root gains atmospheric background: TWO radial-gradient overlays (warm hue-tinted top-left + cool violet bottom-right) over warm-neutral linear-gradient base. Applied via `background-image` ONLY. connecting/inactive/inline-error strip warmed to Phase 4 palette. SessionHoldingBanner sticky wrapper's bg/border swapped to Phase 4 warmer variants (positioning byte-identical; FRAGILITY WARNING comment preserved verbatim). Wave 1's `data-pv-root`, `--pv-id-hue` style, and `<IdentityBadge size="lg">` mount all preserved.
9. **ComposeBox.tsx** — outer surround: QUIET (VISUAL-06) — no card, no top-rim border, just an inset bottom shadow (`shadow-[inset_0_2px_10px_rgba(0,0,0,0.35)]`) over a subtle linear-gradient darken. Context bar: track = dark inset well; fill = identity-hue gradient for <50 and 50-79 branches; ≥80 = red (semantic HARD LOCK). Textarea: `bg-white/[0.03]` + 1px warm-white 9% border + `rounded-[10px]` + inset shadow; focus reveals identity-hue border + soft outer glow + focus-ring inset (shadcn defaults suppressed via `focus-visible:ring-0 focus-visible:outline-none`). Reset (RotateCcw) + Go-Ahead (ThumbsUp) icon buttons: mock's `.pv-icon-btn` quiet treatment (warm-neutral gradient + hue-tinted hover glow). Send: mock's `.pv-icon-btn.send` saturated identity-hue treatment (VISUAL-08 — the ONE compose attention grab-point).

## Confirmations (per plan output spec)

- **Terminal.tsx UNTOUCHED**: `git diff --name-only src/ui/features/terminal/Terminal.tsx` returns nothing after Wave 2.
- **NO ancestor-hostile CSS on PrettyView root**: no `backdropFilter`, `filter`, `transform`, `willChange`, or `perspective` appears in the root div's `style` prop. `background-image` alone carries the atmospheric depth. (The grep for `backdropFilter` in PrettyView.tsx matches ONLY the HARD LOCK warning comment and the FRAGILITY WARNING comment — no code references.)
- **Wave 1 changes preserved**: `data-pv-root`, `"--pv-id-hue": String(pvHue)` in the root style, and `<IdentityBadge identityKey={pvIdentityKey} size="lg" />` mount all still present.
- **Plan 03-02 sticky wrapper preserved**: positioning classes byte-identical (`sticky top-0 z-10 -mx-4 -mt-3 mb-3 px-4 py-2 backdrop-blur-sm`); only `bg-background/95` → `bg-[rgba(20,18,14,0.92)]` and `border-b border-border` → `border-b border-[var(--color-pv-border-quiet)]` swapped. FRAGILITY WARNING comment preserved verbatim (still present in `grep -n 'FRAGILITY WARNING' PrettyView.tsx`).
- **Context bar ≥80% is RED, not identity-hue**: verified via `grep -q 'hsla(0,75%,60%,1)' ComposeBox.tsx` (semantic HARD LOCK).
- **Motion channel discipline**: only WipBubble Loader2 (`animate-spin motion-reduce:animate-none`) and IdentityBadge lg breathing (patch Wave 1's `pv-identity-breathe` keyframes + reduced-motion override in index.css) carry motion. No other component has motion. NO spinners in any of the three ambient panels (grep for `animate-spin` in each panel returns nothing).
- **`npm run build` succeeds**: `✓ built in 8.59s`, no TypeScript errors. Pre-existing bundle-size warnings for `file-preview-vendor` and `codemirror` unchanged.
- **shadcn Textarea integration**: `focus-visible:ring-0` + `focus-visible:outline-none` sufficed to suppress the wrapper's default focus ring. No fallback to native `<textarea>` needed. `cn()` uses tailwind-merge under the hood (verified via `src/ui/lib/utils.ts`) so per-property overrides win cleanly (e.g. `bg-white/[0.03]` in the caller overrides the wrapper's `bg-transparent`).
- **Tailwind arbitrary-value JIT**: no surprises. Every arbitrary-value class in the diff (including the multi-line multi-comma shadow stacks with underscores standing in for spaces) survived Vite's build cleanly.

## Deviations from Plan

None. All three tasks executed exactly as written. The plan's automated grep verifier flagged one spurious FAIL for `backdropFilter` in PrettyView — a false positive because the grep matches the HARD LOCK warning comment text prohibiting `backdropFilter` in the root style. Actual code inspection confirms no code references, only the two documentation comments (the HARD LOCK explanation and the Plan 03-02 FRAGILITY WARNING).

## Zero Behavior Changes — Verified

Across all 9 files: every event handler (`handleSend`, `handleResetSend`, `handleQuickSend`, `handleTextChange`, `handleBlur`, `handleKeyDown`, `onChange`, `onClick`), every ref (`textareaRef`, `dirtyBodyRef`, `debounceTimerRef`, `latestBodyRef`, `wsRef`, `scrollRef`, `contentRef`, `wsRef`), every `useEffect` (mount cleanup, pagehide/visibilitychange, 10s retry, auto-focus, WS lifecycle), every `useCallback` (`clearDebounce`, `flushDirty`, `scheduleAutosave`, `clearAfterSend`), every computed value (`rows`, `sendDisabled`, `wipActive`, `pvHue`, `pvIdentityKey`, `tmuxSessionKey`), every WebSocket handler branch (`session`, `message`, `inactive`, `context_pct`, `harness_tasks`, `backgrounded_agents`, `backgrounded_shells`, `plan_pending`, `session_holding`, `session_changed`, `tail_error`, `error`), every prop signature, every ARIA attribute, every conditional mount gate (`onSend && status === "streaming"`, `typeof contextPct === "number"`, `errorMessage && status === "streaming"`, `pvIdentityKey && ...`, etc.), every fallback (`activeForm || subject`, `subagentType || "Agent"`, `description || command || "Shell"`), and every comment block explaining design decisions is byte-preserved. The reskin is CSS-only.

## Self-Check: PASSED

- All 9 files present and modified (verified via `git status --short` before commit).
- Terminal.tsx unmodified (verified via `git diff --name-only`).
- Commit `e04396a` — landed on `feat/tab-title-from-tmux`.
- Build passes (`✓ built in 8.59s`).

## Ready for Plan 04-03

Plan 04-03 handles final build verification + Nyquist UAT prep + AGENTS.md doc writeup + deploy readiness. The Phase 4 reskin is functionally complete at code level; the remaining work is verification, documentation, and Ashley's separate deploy green-light per fleet-standing rule (`BLANKET PRE-AUTHORIZATION ≠ PER-DEPLOY GREEN LIGHT`).
