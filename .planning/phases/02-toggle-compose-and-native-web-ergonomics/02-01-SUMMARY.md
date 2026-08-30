---
phase: 02-toggle-compose-and-native-web-ergonomics
plan: "01"
subsystem: pretty-view
tags: [keyboard-chord, mode-toggle, terminal, pretty-view, phase-1-cleanup]
dependency_graph:
  requires: []
  provides: [TOGGLE-01, TOGGLE-02, TOGGLE-03]
  affects:
    - src/ui/features/terminal/Terminal.tsx
    - src/ui/AppShell.tsx
    - src/ui/shell/tabUtils.tsx
tech_stack:
  added: []
  patterns:
    - document-capture-phase keyboard hook (mirror of patch #37/#39)
    - useImperativeHandle imperative handle method dispatch
    - display:none hiding (xterm stays mounted across mode flips)
key_files:
  created:
    - src/ui/hooks/use-keyboard-toggle-pretty-mode.ts
  modified:
    - src/ui/features/terminal/terminal-types.ts
    - src/ui/features/terminal/Terminal.tsx
    - src/ui/AppShell.tsx
    - src/ui/shell/tabUtils.tsx
decisions:
  - "Chord is Ctrl+Shift+O (e.code === KeyO) per D-32 — layout-independent, unbound in Chrome/VS Code/Ashley's OS"
  - "xterm div stays mounted with display:none in pretty mode — SSH connection and tmux attach survive mode flips (TOGGLE-03)"
  - "PrettyView and fallback rendered as siblings inside the existing flex-column wrapper between xterm div and MessageQueueDrawer — drawer is never re-mounted"
  - "useMemo import removed from tabUtils.tsx alongside isPrettyMode (was the only useMemo in the file)"
  - "Phase 1 #pretty=1 URL-fragment gate fully removed — old bookmarks silently ignored, chord is the only mechanism"
metrics:
  duration_seconds: 250
  completed_date: "2026-07-17"
  tasks_completed: 3
  files_modified: 5
---

# Phase 02 Plan 01: Mode Toggle Chord + Layout Preservation Summary

Delivered the keyboard-chord toggle infrastructure (Ctrl+Shift+O) that flips an active terminal tab between tmux xterm and Phase 1's PrettyView, with the message queue drawer preserved across mode flips.

## What Was Built

**TOGGLE-01**: Pressing Ctrl+Shift+O on an active terminal tab dispatches to that tab's Terminal component and flips `isPrettyMode` state. Non-terminal tabs (dashboard, RDP, VNC, files) ignore the chord.

**TOGGLE-02**: Every fresh Terminal mount starts with `useState(false)` — no persistence in localStorage, sessionStorage, URL fragment, Tab type, or open_tabs schema. Old `#pretty=1` bookmarks are silently ignored (Phase 1 gate removed).

**TOGGLE-03**: The message queue drawer at the bottom of the terminal tab is never re-mounted on mode flip. The outer `<div className="h-full w-full relative flex flex-col">` wrapper and the `{isMessageQueueOpen && …}` DrawerSibling conditional are byte-for-byte unchanged. PrettyView and its fallback are inserted as new siblings between the xterm div and the drawer conditional.

## Key Implementation Decisions

**xterm div kept mounted, hidden via `display: none`**: Rather than unmounting/remounting xterm on mode flip, the div is hidden with an inline `display: isPrettyMode ? "none" : undefined` style. This preserves the xterm.js instance, the SSH WebSocket connection, and the tmux attach across mode flips. The ref (`ref={xtermRef}`) is unchanged.

**PrettyView placement**: PrettyView renders as a sibling after the xterm div and before the MessageQueueDrawer conditional. Uses `className="flex-1 min-h-0"` to match the xterm div's flex geometry so it fills the same space. A fallback div (string "no active Claude session") covers hosts that lack a numeric id or an active tmux session (e.g., Windows hosts without autoTmux).

**Hook shape**: `use-keyboard-toggle-pretty-mode.ts` is a byte-for-byte copy of `use-keyboard-message-queue.ts` with constants changed (localStorage key, window event name, e.code). The three mirror-refs pattern (tabsRef, activeTabIdRef, toggleRef) ensures the effect registers once and reads fresh values on every keystroke.

**tabUtils.tsx cleanup**: Removed `useMemo` import (was the only usage), `PrettyView` import, `isPrettyMode` useMemo block, `targetTmuxSession` local (only referenced in the deleted PrettyView mount), and the PrettyView early-return. `TerminalTabContent` now flows unconditionally to the `<CommandHistoryProvider><TerminalFeature …/></CommandHistoryProvider>` return.

## Verification Evidence

Task 1 verify (grep checks):
- `useKeyboardTogglePrettyMode`, `keyboardTogglePrettyModeEnabled`, `keyboardTogglePrettyModeEnabledChanged`, `e.code === "KeyO"`, `addEventListener("keydown"`, `tab.type !== "terminal"` — all present in the 57-line hook file.

Task 2 verify (grep + tsc):
- `togglePrettyMode:` in terminal-types.ts — present
- `isPrettyMode`, `togglePrettyMode:`, `import { PrettyView }`, `<PrettyView`, `no active Claude session` — all present in Terminal.tsx
- `ref={xtermRef}` — preserved
- `isMessageQueueOpen && hostConfig.id != null` — byte-for-byte unchanged
- `className="h-full w-full relative flex flex-col"` — byte-for-byte unchanged
- `npx tsc --noEmit` — 0 errors across all modified files

Task 3 verify (grep + tsc):
- `grep -c "PrettyView" tabUtils.tsx` = 0
- `grep -c "isPrettyMode" tabUtils.tsx` = 0
- `grep -c "pretty=1" tabUtils.tsx` = 0
- `useKeyboardTogglePrettyMode` import + hook call present in AppShell.tsx
- `togglePrettyMode?.()` call in AppShell dispatcher — present
- `npx tsc --noEmit` — 0 errors

Files diff stat: exactly 5 files changed (all within plan's `files_modified` list), no other files touched.

## Chord Confirmation Note

The chord ships as Ctrl+Shift+O per D-32. Ashley's confirmation of non-collision with her live OS bindings happens at Plan 03's deploy checkpoint (browser UAT), not in this plan.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All components wire to real state and real data sources. PrettyView receives live `hostId` and `tmuxSession` values from Terminal's state.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | 4ff273d | feat(pretty-view): add keyboard chord hook for mode toggle (Ctrl+Shift+O) |
| 2 | 01606b2 | feat(pretty-view): per-pane isPrettyMode state + togglePrettyMode handle |
| 3 | 44cad70 | feat(pretty-view): wire Ctrl+Shift+O toggle into AppShell + remove Phase 1 fragment gate |

## Self-Check

### Files exist

- [x] `src/ui/hooks/use-keyboard-toggle-pretty-mode.ts` — created
- [x] `src/ui/features/terminal/terminal-types.ts` — modified
- [x] `src/ui/features/terminal/Terminal.tsx` — modified
- [x] `src/ui/AppShell.tsx` — modified
- [x] `src/ui/shell/tabUtils.tsx` — modified

### Commits exist

- [x] 4ff273d — Task 1 hook file
- [x] 01606b2 — Task 2 Terminal handle + state
- [x] 44cad70 — Task 3 AppShell wire + tabUtils cleanup
