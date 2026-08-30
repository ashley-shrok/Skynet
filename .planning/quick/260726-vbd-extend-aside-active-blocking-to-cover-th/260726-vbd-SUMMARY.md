---
phase: quick-260726-vbd
plan: 01
subsystem: aside
tags: [aside, composebox, ux, btw-prompt]
dependency_graph:
  requires: [Phase 14 Plan 04 — ComposeBox aside morph]
  provides: [generation-window blocking, /btw concisely prompt]
  affects: [PrettyView.tsx, claude-session-server.ts, claude-session-server.aside.test.ts]
tech_stack:
  added: []
  patterns: [useRef timer pattern, useCallback clearAsidePending, asidePending state flag]
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/backend/claude-session/claude-session-server.ts
    - src/backend/claude-session/claude-session-server.aside.test.ts
decisions:
  - asidePending armed even when onSend returns false — 60s timeout or X/Resume clears the false alarm (simpler than conditional arming)
  - clearAsidePending() single clear-primitive used by all four legitimate clear paths (aside_ready, aside_dismissed, handleAsideDismiss, session_changed)
  - /btw detection uses trimmed start-with-space OR exact-match: covers `/btw foo` and bare `/btw`, excludes `/btwXYZ`
metrics:
  duration: 8min
  completed: 2026-07-26
---

# Phase quick-260726-vbd Plan 01: Extend aside-active blocking to cover /btw generation window + insert concisely into BTW_PROMPT

**One-liner:** Widen ComposeBox aside-active predicate from post-aside_ready-only to cover the full /btw generation window via asidePending state + 60s safety timeout, and insert 'concisely' into BTW_PROMPT to bias Claude toward shorter answers.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Widen aside-active predicate in PrettyView to cover /btw generation window | 656d709 | src/ui/features/pretty-view/PrettyView.tsx |
| 2 | Insert `concisely` into BTW_PROMPT and update byte-for-byte test assertion | f17f331 | src/backend/claude-session/claude-session-server.ts, src/backend/claude-session/claude-session-server.aside.test.ts |

## What Was Built

### Task 1 — PrettyView.tsx changes

- `asidePending` state + `asidePendingTimerRef` declared alongside `asideText` with explanatory comment block covering the WHY (generation-window blocking parity, single Escape primitive, 60s safety timeout).
- `clearAsidePending()` useCallback: clears both the boolean flag and the timer ref. Single clear-primitive used by all four legitimate paths.
- `handleAsideDismiss`: added `clearAsidePending()` call alongside existing `setAsideText(null)`. Dismiss button now works identically from either the pending OR the displayed phase.
- `aside_ready` case: `clearAsidePending()` before `setAsideText(parsed.text)` — pending→displayed transition is atomic.
- `aside_dismissed` case: `setAsideText(null)` + `clearAsidePending()` — handles peer-tab dismiss or marker-disappearance path.
- `session_changed` case: added `clearAsidePending()` — fresh pane starts with no in-flight aside.
- Fresh-pane reset block: explicit `clearTimeout + setAsidePending(false)` on pane navigation.
- `handleComposeSend` useCallback: detects `/btw ` prefix or exact `/btw`, arms `asidePending` + 60s safety timer, delegates to `onSend` and returns its boolean unchanged.
- ComposeBox mount: `onSend={handleComposeSend}`, `asideActive={asideText !== null || asidePending}`.
- Unmount cleanup effect: `clearTimeout(asidePendingTimerRef.current)` on unmount.

### Task 2 — BTW_PROMPT changes

- `claude-session-server.ts`: `"Re-explain concisely whatever's..."` — `concisely` inserted after `Re-explain`.
- `claude-session-server.aside.test.ts`: byte-for-byte assertion updated to match new literal.
- em-dash (U+2014) and `/btw ` prefix tests unchanged; both still pass.

## Test Results

- Full verification suite: 169/169 tests across 15 test files — all pass.
- TypeScript typecheck (`npm run type-check`): zero errors.
- `grep -c 'asidePending' PrettyView.tsx` = 24 (>= 5 required).
- `grep -c 'concisely' claude-session-server.ts` = 1.
- `grep -c 'concisely' claude-session-server.aside.test.ts` = 1.
- `grep -c 'aside poll diag:' claude-session-server.ts` = 8 (unchanged from baseline).

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- 656d709 confirmed in git log.
- f17f331 confirmed in git log.
- PrettyView.tsx modified with all required changes.
- claude-session-server.ts modified with `concisely` insertion.
- claude-session-server.aside.test.ts updated with matching assertion.
- No other files touched. No package.json / lockfile changes.
