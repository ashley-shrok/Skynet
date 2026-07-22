---
phase: 260722-mp6-patch-126-pwa-safe-area-polish
plan: 01
subsystem: ui/pwa
tags: [pwa, ios, safe-area, css, layout]
type: execute
wave: 1
requires: []
provides:
  - PATCH-126-BLEND-BODY-BG
  - PATCH-126-DROP-SHELL-BOTTOM-PAD
  - PATCH-126-SIDEBAR-SCROLL-INSET
affects: []
tech-stack:
  added: []
  patterns: [safe-area-inset, css-var-cascade, pb-arbitrary-value]
key-files:
  created: []
  modified:
    - src/ui/index.css
    - src/ui/AppShell.tsx
    - src/ui/sidebar/ConversationsPanel.tsx
decisions:
  - Kept var(--background) fallback (no hardcoded oklch) — .dark class IS an ancestor of body per shadcn setup; visual verification will confirm on Ashley's device.
  - Left desktop paddingBottom pathway alone via env() 0-resolution rather than adding a media query — matches the "3 tiny edits, no scope expansion" plan intent.
metrics:
  duration: 4min
  completed_date: 2026-07-22
---

# Phase 260722-mp6 Plan 01: PWA Safe-Area Polish (Patch #126) Summary

**One-liner:** Three-file, +2/-2 diff blending body bg with Skynet-gray (`--background`), dropping AppShell's bottom safe-area padding (letting the shell bg extend to the viewport bottom), and adding `pb-[env(safe-area-inset-bottom)]` to the ConversationsPanel scroll container so the last item rests above the iOS home indicator.

## Objective

Resolve Ashley's UAT feedback on the patch #125 iOS install:
1. Black bars in the top/bottom safe-area regions (body bg leaking through) → blend body bg with Skynet-gray.
2. ConversationsPanel scroll content hiding behind the iOS home indicator → add bottom safe-area inset to the scroll container.

Ship only these two polish issues — no root-cause chase for 100dvh-vs-flex, no preemptive padding on other scroll containers, no rebrand.

## The 3 Edits

### EDIT 1 — `src/ui/index.css` (body block, lines 39–41)

**Before:**
```css
body {
  overscroll-behavior: none;
}
```

**After:**
```css
body {
  overscroll-behavior: none;
  background-color: var(--background);
}
```

**Rationale:** `.dark` is the shadcn dark-mode class typically applied on `<html>` or `<body>`. `--background` is set inside `.dark` as an `oklch()` value (line 191), so `var(--background)` resolves directly without an `hsl()` wrapper. If visual verification shows the body still black in dark mode on Ashley's device, the fallback is to hardcode `background-color: oklch(0.155 0.004 128.73);` — not applied here because the plan says "if after visual verification…"

### EDIT 2 — `src/ui/AppShell.tsx` (outer div style, lines 1738–1742)

**Before:**
```tsx
style={{
  height: "100dvh",
  paddingTop: "max(env(safe-area-inset-top), 0px)",
  paddingBottom: "max(env(safe-area-inset-bottom), 0px)",
}}
```

**After:**
```tsx
style={{
  height: "100dvh",
  paddingTop: "max(env(safe-area-inset-top), 0px)",
}}
```

**Rationale:** Status-bar clock/battery still need content pushed down (keep `paddingTop`). The home-indicator region is fine to extend under now that body bg matches (edit 1) and the interior scroll padding (edit 3) keeps interactive content above it. `className`, `height: "100dvh"`, outer fragment, children, and all other attributes untouched.

### EDIT 3 — `src/ui/sidebar/ConversationsPanel.tsx` (scroll container, line 229)

**Before:**
```tsx
<div className="flex-1 min-h-0 overflow-y-auto">
```

**After:**
```tsx
<div className="flex-1 min-h-0 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
```

**Rationale:** Desktop no-op (`env()` resolves to 0). iOS pushes last item above home indicator. No other scroll containers touched (SessionsPanel, dashboard cards, pretty view) — Ashley only reported hitting this one, per plan's "only reported hitting this one" scope note.

## Verification Results

### `npx tsc --noEmit`

```
(no output — exit 0, clean)
```

### `git diff --stat`

```
 src/ui/AppShell.tsx                   | 1 -
 src/ui/index.css                      | 1 +
 src/ui/sidebar/ConversationsPanel.tsx | 2 +-
 3 files changed, 2 insertions(+), 2 deletions(-)
```

Exactly 3 files, +2/-2 lines — matches plan `<verification>` block byte-for-byte.

### Plan `<verify>` automated block (all four assertions pass)

```
FILE_LIST: OK          (git diff --name-only matches the exact 3-file set)
BODY_BG: OK            (grep 'background-color: var(--background)' index.css)
SHELL_PB_DROPPED: OK   (! grep 'paddingBottom.*safe-area-inset-bottom' AppShell.tsx)
SIDEBAR_INSET: OK      (grep 'pb-\[env(safe-area-inset-bottom)\]' ConversationsPanel.tsx)
```

## Deviations from Plan

**None.** Plan executed exactly as written. No fallback to hardcoded `oklch(0.155 0.004 128.73)` needed at implementation time — that fallback is contingent on Ashley's visual verification and belongs to any hypothetical follow-up, not this patch.

## Auth Gates

None — pure client-side CSS/JSX edits.

## Commit

**Message (as landed):**
```
feat(pwa): patch #126 — safe-area polish (blend body bg, drop shell bottom pad, sidebar scroll-inset)

- body: add background-color: var(--background) so top/bottom safe-area regions render Skynet-gray instead of browser-default black.
- AppShell outer div: drop paddingBottom so shell bg extends to viewport bottom edge; keep paddingTop so status-bar clock/battery stay readable.
- ConversationsPanel scroll container: append pb-[env(safe-area-inset-bottom)] so last item rests above the iOS home-indicator region (desktop no-op).

Resolves Ashley UAT feedback on patch #125 iOS install. Desktop rendering unchanged (env resolves to 0). tsc-clean. 3-file diff.
```

**Commit sha:** `0f87d02` on branch `feat/tab-title-from-tmux`

## Ready For Tina

- `feat/tab-title-from-tmux` branch has patch #126 as commit `0f87d02` (single atomic commit stacked on the #118–#125 batch).
- tsc clean, no test-file changes, no manifest/index.html/icons/nginx touched.
- Deploy behind the mandatory 15-min deadman rollback timer after Ashley greenlights the visual behavior (top+bottom safe-area regions render Skynet-gray, sidebar last-item sits above the home indicator, status-bar readable, desktop unchanged).

## Known Stubs

None.

## Threat Flags

None — CSS-only + tiny inline-style tweak + one className append. No new endpoints, auth paths, file access, or schema changes.

## Self-Check: PASSED

- src/ui/index.css: FOUND, contains `background-color: var(--background)`.
- src/ui/AppShell.tsx: FOUND, no `paddingBottom.*safe-area-inset-bottom` line.
- src/ui/sidebar/ConversationsPanel.tsx: FOUND, contains `pb-[env(safe-area-inset-bottom)]`.
- Commit `0f87d02`: FOUND in `git log --oneline`.
