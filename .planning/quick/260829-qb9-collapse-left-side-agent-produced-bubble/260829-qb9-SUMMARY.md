---
phase: quick-260829-qb9
plan: 01
subsystem: pretty-view
tags:
  - pretty-view
  - ui
  - collapse
  - accessibility
dependency_graph:
  requires: []
  provides:
    - collapse-by-default for RelayInboundBubble
    - collapse-by-default for RelayOutboundBubble
    - collapse-by-default for ChatMessage assistant branch
  affects:
    - src/ui/features/pretty-view/RelayInboundBubble.tsx
    - src/ui/features/pretty-view/RelayOutboundBubble.tsx
    - src/ui/features/pretty-view/ChatMessage.tsx
tech_stack:
  added: []
  patterns:
    - collapsed state via useState(true) at component root
    - header-as-button with aria-expanded + aria-label toggle
    - body+footer gated on {!collapsed && (<>...</>)}
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/RelayInboundBubble.tsx
    - src/ui/features/pretty-view/RelayInboundBubble.test.tsx
    - src/ui/features/pretty-view/RelayOutboundBubble.tsx
    - src/ui/features/pretty-view/RelayOutboundBubble.test.tsx
    - src/ui/features/pretty-view/ChatMessage.tsx
    - src/ui/features/pretty-view/ChatMessage.test.tsx
decisions:
  - Collapse state held at component root (not inside conditional) to satisfy Rules of Hooks
  - rawExpanded reset on outer collapse via setCollapsed callback (state sharing) rather than moving state inside conditional
  - ChatMessage collapse header always rendered for assistant branch (even when body is gated)
  - Autoplay useEffect left unconditional per fleet no-streaming rule — audio fires while collapsed (fine)
  - useEffect /relay-pointer fetch gated on !collapsed via early-return + collapsed in dep array
metrics:
  duration: ~10 minutes
  completed: "2026-08-29T19:10:42Z"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 6
---

# Phase quick-260829-qb9 Plan 01: Collapse Left-Side Agent-Produced Bubbles Summary

**One-liner:** Collapse-by-default for RelayInboundBubble, RelayOutboundBubble, and ChatMessage assistant branch using native button headers with aria-expanded ARIA semantics.

## What Was Built

All three left-side (agent-produced) bubble types in PrettyView now start collapsed on mount, showing only a header row. Clicking expands the body; clicking again re-collapses.

**RelayInboundBubble:** The existing header `<div>` was replaced with a `<button type="button">` carrying `aria-expanded`, `aria-label`, and a `▶`/`▼` caret glyph. Body+footer wrapped in `{!collapsed && <div data-testid="relay-inbound-body">...}`. The `/relay-pointer` fetch useEffect is gated on `!collapsed` (early return + dep array) so unexpanded bubbles generate no network traffic.

**RelayOutboundBubble:** Same header-button pattern. The outer body+footer is gated on `!collapsed`. The inner `rawExpanded` state (for the "▸ raw command" toggle) resets to `false` on each outer collapse via a functional update callback — ensuring re-expand always shows the inner toggle in its default collapsed state.

**ChatMessage (assistant branch only):** A new minimal `● assistant ▶` pill header (`<button data-testid="chatmessage-collapsed-header">`) is prepended inside the inner bubble div for the assistant role. The entire body content (isQuickReply/injected/markdown ternary, showSendingSpinner, speak button) is gated on `{(isUser || !collapsed) && (<>...</>)}`. The user branch is byte-identical — no header, always expanded, wrapper stays `flex justify-end`.

**Test updates:** All three test files updated with C1-C4 new collapse regression tests. Existing tests that asserted body visibility on mount were updated to click the expand header first. The fetch-triggering tests (RelayInboundBubble Tests 2, 3) now click-to-expand before waiting for fetch calls.

## Deviations from Plan

**1. [Rule 1 - Bug] rawExpanded state reset via functional update callback**
- **Found during:** Task 1 (C4 test failure)
- **Issue:** `rawExpanded` is a top-level hook (required by Rules of Hooks) so it persists across outer collapse/expand cycles. The plan stated inner state "naturally resets" on each expand cycle assuming it would unmount — but component never unmounts.
- **Fix:** Modified `setCollapsed` onClick to `(v) => { if (v) setRawExpanded(false); return !v; }` — when collapsing (v is true), reset rawExpanded so that re-expand finds it false.
- **Files modified:** `RelayOutboundBubble.tsx`
- **Commit:** f49da842

No other deviations — plan executed as written.

## Commits

| Hash | Message |
|------|---------|
| f49da842 | feat(quick-260829-qb9): collapse-by-default for all left-side agent-produced bubbles |

## Test Results

Scoped vitest run on 3 test files: **49 tests, 49 passed, 0 failed.**

```
 Test Files  3 passed (3)
      Tests  49 passed (49)
   Duration  59.15s
```

## Known Stubs

None.

## Threat Flags

None — this change is purely presentational (collapse state, no new network endpoints, no auth paths, no schema changes).

## Self-Check: PASSED

- src/ui/features/pretty-view/RelayInboundBubble.tsx: FOUND
- src/ui/features/pretty-view/RelayOutboundBubble.tsx: FOUND
- src/ui/features/pretty-view/ChatMessage.tsx: FOUND
- Commit f49da842: FOUND
