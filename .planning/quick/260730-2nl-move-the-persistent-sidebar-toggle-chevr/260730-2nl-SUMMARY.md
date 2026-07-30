---
phase: 260730-2nl-move-the-persistent-sidebar-toggle-chevr
plan: "01"
subsystem: ui
tags: [sidebar, chevron, toggle, desktop, transition]
dependency_graph:
  requires: []
  provides: [sidebar-chevron-edge-anchoring]
  affects: [src/ui/AppShell.tsx]
tech_stack:
  added: []
  patterns: [conditional-left-from-sidebar-width, lockstep-transition]
key_files:
  created: []
  modified:
    - src/ui/AppShell.tsx
decisions:
  - "Used conditional left expression guarded by !isTouchDevice && sidebarOpen to preserve touch and desktop-closed behavior exactly"
  - "Mirrored sidebarDragging transition pattern from sidebar column (width 0.2s -> left 0.2s) verbatim"
  - "Dropped max(env(safe-area-inset-left)) wrapper for the open-desktop branch only — safe-area is irrelevant at the sidebar inner edge"
metrics:
  duration: ~3min
  completed: "2026-07-30"
---

# Phase 260730-2nl Plan 01: Move Persistent Sidebar Toggle Chevron to Sidebar Inner Edge - Summary

**One-liner:** Chevron button now rides the sidebar's inner (right) edge on desktop-open via computed `left: ${(sidebarEditing ? 560 : sidebarWidth) + 8}px` with lockstep `left 0.2s` transition.

## What Was Done

Single-file edit to `src/ui/AppShell.tsx`: replaced the chevron `<button>`'s static `style` prop (3 keys: `top`, `left`, `zIndex`) with a computed form (4 keys: `top`, `left`, `zIndex`, `transition`).

## Before / After Diff

**Before (lines 1518-1522):**
```tsx
style={{
  top: "max(env(safe-area-inset-top), 8px)",
  left: "max(env(safe-area-inset-left), 8px)",
  zIndex: 30,
}}
```

**After (lines 1518-1525):**
```tsx
style={{
  top: "max(env(safe-area-inset-top), 8px)",
  left: !isTouchDevice && sidebarOpen
    ? `${(sidebarEditing ? 560 : sidebarWidth) + 8}px`
    : "max(env(safe-area-inset-left), 8px)",
  zIndex: 30,
  transition: sidebarDragging ? "none" : "left 0.2s",
}}
```

## Verification Results

**Grep sanity checks (all passed):**
- `sidebarEditing ? 560 : sidebarWidth` — 2 hits (line 1521 chevron, line 1556 sidebar column)
- `transition: sidebarDragging` — 2 hits (line 1524 chevron, line 1557 sidebar column)
- `max(env(safe-area-inset-left), 8px)` — 1 hit (line 1522, fallback branch preserved)
- `navigateToList` count — 4 (unchanged; touch branch untouched)

**Automated:**
- `npx tsc --noEmit` — exit 0 (no output, clean)
- `npx vitest run src/ui/AppShell.persistence.test.tsx` — 4/4 passed

## Commit

- SHA: `1e14cba`
- Message: `fix(app-shell): anchor persistent sidebar-toggle chevron to sidebar inner edge on desktop`
- Branch: `feat/tab-title-from-tmux`
- Files changed: `src/ui/AppShell.tsx` (+4, -1)

No push performed. No build performed. No deploy performed.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- `src/ui/AppShell.tsx` modified: confirmed
- Commit `1e14cba` exists: confirmed
- `tsc --noEmit` exit 0: confirmed
- `vitest` 4/4 pass: confirmed
- `navigateToList` count unchanged (4): confirmed
- No other files touched: confirmed
