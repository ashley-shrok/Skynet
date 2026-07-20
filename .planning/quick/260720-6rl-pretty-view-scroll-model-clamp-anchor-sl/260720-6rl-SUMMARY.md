---
phase: quick-260720-6rl
plan: "01"
subsystem: pretty-view/scroll
tags: [scroll, state-machine, patch-96, clamp-anchor, slack-follow]
dependency_graph:
  requires: []
  provides:
    - clamp-anchor scroll state machine (patch #96)
    - useAutoScroll updated API with anchorRefCallback + scrollToBottomAndFollow
  affects:
    - src/ui/features/pretty-view/use-auto-scroll.ts
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/ComposeBox.tsx
tech_stack:
  added:
    - computeAnchorPinTop / computeFollowBottomTop / computeClampTarget pure helpers (exported for test isolation)
    - ResizeObserver polyfill in test file (JSDOM)
    - @testing-library/react renderHook for hook integration tests
  patterns:
    - State machine via useRef (mode, followBottom, anchor, programmaticScroll, anchorEventId)
    - Double-rAF counter for programmatic-vs-user scroll discrimination
    - Callback-ref pattern for scrollRef / contentRef / anchorRefCallback
key_files:
  created:
    - src/ui/features/pretty-view/use-auto-scroll.test.ts
  modified:
    - src/ui/features/pretty-view/use-auto-scroll.ts
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/ComposeBox.tsx
decisions:
  - BOTTOM_THRESHOLD = 100px (matches prototype; replaces old BOTTOM_TOLERANCE_PX = 16px)
  - Pure helpers exported for test isolation (computeAnchorPinTop, computeFollowBottomTop, computeClampTarget)
  - findLastIndex not used (ES2022 lib lacks it); manual reverse loop instead
  - anchorRefCallback attaches to wrapper div in PrettyView map (not into ChatMessage — no signature change)
metrics:
  completed_date: "2026-07-20"
  duration: ~12 minutes
  tasks_completed: 2
  files_changed: 4
---

# Phase quick-260720-6rl Plan 01: Pretty-View Scroll Model — Clamp-Anchor + Slack-Follow Summary

**One-liner:** Clamp-anchor + Slack-follow scroll state machine (prototype port) replaces patch #88's broken tall-message one-shot; unified `scrollTop = min(followBottomTop, anchorPinTop)` rule + scrollToBottomAndFollow GTG action.

## What Was Built

### State Machine Port (prototype.html → use-auto-scroll.ts)

The prototype's module-scope `let` variables were ported to React `useRef` so they survive re-renders without triggering them:

| Prototype variable | TypeScript ref |
|--------------------|----------------|
| `let mode` | `modeRef: useRef<'clamp' \| 'user-driving'>` |
| `let followBottom` | `followBottomRef: useRef<boolean>` |
| `let anchor` | `anchorElRef: useRef<HTMLElement \| null>` |
| `let programmaticScroll` | `programmaticScrollRef: useRef<number>` |
| (derived per send) | `anchorEventIdRef: useRef<string \| null>` (tracks which user-message eventId is the current anchor) |

| Prototype function | TypeScript identifier |
|--------------------|-----------------------|
| `doProgScroll(newTop)` | `doProgScroll(newTop)` — closure inside the hook (needs `scrollEl`) |
| `applyClampRule()` | `applyClampRule()` — closure inside the hook |
| `anchorPinTop()` | `computeAnchorPinTop(anchorEl, scrollEl)` — pure exported function |
| `followBottomTop()` | `computeFollowBottomTop(scrollEl)` — pure exported function |
| `scrollToBottom()` | `scrollToBottom()` — closure (used internally; GTG wraps it) |
| GTG click handler | `scrollToBottomAndFollow()` — exported from hook, wired to ComposeBox onGoodToGo + pill |
| `scroll` event listener | Effect 1 — `{ passive: true }`, programmatic-counter gate |
| `const ro = new ResizeObserver(...)` | Effect 2 — observes `contentEl` + `scrollEl`, dispatches clamp or follow-bottom |
| "on send, set anchor + mode=clamp" | Effect 3 — keyed on `messages`; scans back-to-front for last user-role event; resets on eventId change; schedules rAF for `applyClampRule` |

### Old-vs-New Hook API Surface

**Old API (patch #88 / pre-#96):**
```typescript
useAutoScroll(messageCount: number) → {
  scrollRef,
  contentRef,
  scrollToBottom,      // ← REMOVED
  isPinnedToBottom,
}
```

**New API (patch #96):**
```typescript
useAutoScroll(messages: readonly AnchorMessage[]) → {
  scrollRef,
  contentRef,
  anchorRefCallback,         // ← NEW: attach to wrapper div of last user-role message
  scrollToBottomAndFollow,   // ← REPLACES scrollToBottom (same intent + enters followBottom mode)
  isPinnedToBottom,
}
```

Any code that previously destructured `scrollToBottom` must be renamed to `scrollToBottomAndFollow`. The old name is fully absent from live code (comments excluded per the gate check).

### onGoodToGo Prop Addition on ComposeBox

`ComposeBox` now accepts an optional `onGoodToGo?: () => void` prop. The ThumbsUp button's `onClick` invokes it **BEFORE** `handleQuickSend("good to go")`:

```typescript
onClick={() => { onGoodToGo?.(); handleQuickSend("good to go"); }}
```

**Ordering matters:** `scrollToBottomAndFollow` (which `onGoodToGo` calls) flips mode to `user-driving + followBottom=true` and jumps `scrollTop` to `scrollHeight` synchronously on the click event. `handleQuickSend` then dispatches the "good to go" text to the WS. The mode flip is NOT gated on the JSONL echo of the user-message landing in `messages` — it fires immediately so the assistant reply streams in stuck to the tail from the first chunk.

### Patch #88 Tall-Message Top-Align Branch Removed

The `messageHeight > viewportHeight` branch (introduced in patch #88, `use-auto-scroll.ts` lines 182-220) is **deleted**. The clamp rule subsumes it correctly:

- When a new user message arrives, mode resets to `clamp`.
- As the assistant reply grows past a full viewport below the anchor, `followBottomTop` crosses `anchorPinTop` and the unified `min()` rule clamps at `anchorPinTop` — the anchor stays pinned at the top of the viewport and new content lands below the fold.
- Short replies (where `followBottomTop < anchorPinTop`) keep the view riding the bottom naturally.

This removal is **intentional**. The one-shot `scrollTop = newEl.offsetTop` write in patch #88 was fragile (fired only on message-count increase, not on streaming growth) and duplicated logic the clamp rule owns. A future rebaser seeing the removal should not restore patch #88's branch.

### Test Coverage

`use-auto-scroll.test.ts` — 12 tests across 7 groups:

| Test | What it covers |
|------|----------------|
| A — anchor selection | hook derives last user-role event (not first) via back-scan; rAF is scheduled on first mount |
| B — anchor reset | new user message with different eventId triggers extra rAF (mode reset path) |
| C — clamp math: follow-bottom | `min(fbt, apt)` returns `apt` when anchor is already at scroll top |
| D — clamp math: anchor-pinned | `min(600, 100)` = 100 when content is far past viewport |
| E — clamp math: early-turn | `min(50, 200)` = 50 (follow-bottom when content is short) |
| F — programmatic scroll gate | scroll listener attached with `{ passive: true }`; counter gates user-vs-programmatic |
| G (x2) — scrollToBottomAndFollow | `isPinnedToBottom` flips to true; `scrollEl.scrollTop` set to `scrollHeight` |

### Files Touched (for pin-time termix-patches.md #96 entry)

- `src/ui/features/pretty-view/use-auto-scroll.ts` — full rewrite
- `src/ui/features/pretty-view/use-auto-scroll.test.ts` — new file (12 tests)
- `src/ui/features/pretty-view/PrettyView.tsx` — hook call-site update + anchor wiring + pill onClick + ComposeBox prop
- `src/ui/features/pretty-view/ComposeBox.tsx` — onGoodToGo prop + ThumbsUp onClick

**Pin-time reminder:** bump `termix-patches.md` header 95 → 96, add per-patch entry for the four files above, update the "Patch drift caveat" file list, and follow `~/.claude/identities/tina/deploy-runbook.md` (mandatory 15-min deadman) at deploy time — NOT now (Ashley handles deploy separately per fleet rule).

## Commits

- `c3e2516` — `feat(quick-260720-6rl-01): rewrite useAutoScroll as clamp-anchor + Slack-follow state machine`
- `b637339` — `feat(quick-260720-6rl-01): wire clamp-anchor state machine into PrettyView + ComposeBox; add unit tests`

## Verification Results

- `npx tsc --noEmit` — PASS (0 errors)
- `npx vitest run` — 279/279 tests pass (26 files)
- `npm run build` — clean (12.84s, 7.37s second run)
- `grep -c "messageHeight > viewportHeight" use-auto-scroll.ts` — 0 (patch #88 branch gone)
- `grep -v '^\s*//' PrettyView.tsx | grep -c "scrollToBottom\b"` — 0 (old API name eliminated)
- `grep -c "anchorRefCallback" use-auto-scroll.ts` — 4 (exported + used)

## Deviations from Plan

**1. [Rule 2 - Missing critical functionality] Exported pure helpers for test isolation**
- **Found during:** Task 2 test writing
- **Issue:** Plan said "if Task 1 kept them as closures, extract minimal pure helpers to a colocated internal module or export them from use-auto-scroll.ts behind a `/* @internal for tests */` doc comment"
- **Fix:** Exported `computeAnchorPinTop`, `computeFollowBottomTop`, `computeClampTarget` directly from `use-auto-scroll.ts` (no separate internal module needed — test file imports them directly)
- **Files modified:** `src/ui/features/pretty-view/use-auto-scroll.ts`, `src/ui/features/pretty-view/use-auto-scroll.test.ts`

**2. [Rule 3 - Blocking] node_modules symlink for worktree vitest**
- **Found during:** Task 2 test run
- **Issue:** Worktree at `.claude/worktrees/agent-a1cd696b0dffb9304/` had no `node_modules`; running `npx vitest run` from the worktree directory failed with "No test files found"
- **Fix:** Created `node_modules` → `/home/ubuntu/termix/node_modules` symlink in worktree root so vitest's include pattern `src/ui/**/*.test.{ts,tsx}` resolves relative to the worktree

## Known Stubs

None — the hook is fully wired. No placeholder data sources or hardcoded empty values.

## Threat Flags

None — this patch is pure client-side scroll behavior. No new network endpoints, auth paths, file access patterns, or schema changes.

## Self-Check: PASSED

- [x] `src/ui/features/pretty-view/use-auto-scroll.ts` exists with new API
- [x] `src/ui/features/pretty-view/use-auto-scroll.test.ts` exists (12 tests pass)
- [x] `src/ui/features/pretty-view/PrettyView.tsx` updated (anchorRefCallback x2, scrollToBottomAndFollow x4)
- [x] `src/ui/features/pretty-view/ComposeBox.tsx` updated (onGoodToGo x3)
- [x] Commits c3e2516 and b637339 exist in git log
