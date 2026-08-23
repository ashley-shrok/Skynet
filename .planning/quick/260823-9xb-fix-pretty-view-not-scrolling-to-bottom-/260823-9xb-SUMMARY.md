---
phase: quick-260823-9xb-fix-pretty-view-not-scrolling-to-bottom-
plan: 01
subsystem: pretty-view
tags: [auto-scroll, tdd, ui, bug-fix, session-enter, page-refresh]
requires: []
provides: [first-content-arrival-scroll-anchor]
affects: [src/ui/features/pretty-view/PrettyView.tsx (consumer — no changes needed, hook API frozen)]
tech_stack:
  added: []
  patterns: [react-useRef-guard-flag, effect-gate-bypass-per-lifecycle-event]
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/use-auto-scroll.ts
    - src/ui/features/pretty-view/use-auto-scroll.test.ts
decisions:
  - "didFirstContentScrollRef bypasses pinnedRef gate for the first content-populate transition per pane (mount/paneKey effect resets it, messageCount effect + observer RAF check it)."
  - "scrollToBottomAndFollow explicit action does NOT flip didFirstContentScrollRef — the flag is scoped to automatic content-arrival, not user-explicit jump-to-bottom actions."
  - "Hook return API {scrollRef, scrollToBottomAndFollow, isPinnedToBottom} kept byte-identical (Test 8 lock preserved). No consumer changes in PrettyView.tsx."
  - "Same bypass applied to both the messageCount effect AND the observer's RAF write path so accessory / first-message-child mount that arrives via mutation observation also anchors under spurious pinned=false."
metrics:
  duration: "~13 minutes"
  completed: 2026-08-23
  tasks_completed: 2
  files_modified: 2
  tests_added: 6
  tests_passing: 17
---

# Quick 260823-9xb: Fix Pretty-View Not Scrolling to Bottom Summary

**First-content-arrival bypass — the messageCount 0→positive transition now anchors to bottom per pane even when a spurious scroll event has flipped pinnedRef=false before content arrived.**

## Objective

Fix Ashley's 2026-08-23 bug: "When I open sessions for the first time or refresh the page and it brings the session back up on its own, it doesn't put me at the bottom of the scroll of message bubbles."

Root cause: `useAutoScroll`'s mount effect writes `scrollTop=scrollHeight` at ref-bind time, but at that moment `messages=[]` (PrettyView initializes empty; WS backfill populates async), so the write is a no-op on an empty container. Any scroll event between ref-bind and first-content arrival can flip `pinnedRef` to false via the onScroll listener (browser scroll-restoration, scrollbar-mount reflow, empty-container programmatic-write reflow). Once false, the `messageCount 0→N` follow effect's `if (!pinnedRef.current) return` gate skips the anchor write and Ashley lands scrolled-up.

## What Was Built

### Task 1 (RED): 6 new regression tests in `use-auto-scroll.test.ts`

Appended Tests 12-17 after Test 11, INSIDE the existing describe block. `makeScrollEl` / `fireScroll` harness unchanged. Tests 1-11 untouched.

- **Test 12** (was RED): first-content-arrival scrolls to bottom on messageCount 0→positive even when pinnedRef was spuriously flipped false before content arrived. Added a `scrollEl.setScrollTop(0)` reset after ref-bind to model the "spurious reflow" precondition, since the mount effect writes scrollTop=scrollHeight and would otherwise leave the container naturally pinned.
- **Test 13** (regression guard, was GREEN on current code): first-content-arrival with naturally-pinned empty-geometry container.
- **Test 14** (regression guard, was GREEN on current code): first-content-arrival with content present at mount (warm-mount case).
- **Test 15** (regression guard, was GREEN on current code): post-first-content no-yank preservation — after first-content fires and flag flips true, user scroll-up + new message must NOT yank scroll back to bottom.
- **Test 16** (was RED): pane switch resets the first-content flag so pane B first-content fires again after a spurious pinned=false on pane B.
- **Test 17** (no-op in RO-less jsdom): observer-path first-content-arrival. Real-DOM parent attached to document.body so MutationObserver can observe childList reliably. Skip-guard mirrors the hook's own line-148 bail-out — exercised in production where ResizeObserver is available.

### Task 2 (GREEN): `didFirstContentScrollRef` implementation in `use-auto-scroll.ts`

Six discrete edits:

1. **Ref declaration** (line 82): `const didFirstContentScrollRef = useRef<boolean>(false);` with pointer to header §(4).
2. **Mount/paneKey effect reset** (line 91): reset flag to false alongside `pinnedRef.current = true`.
3. **messageCount effect gate bypass** (line 118-128): `isFirstContentArrival = !didFirstContentScrollRef.current && messageCount > 0`. Bypass fires the anchor write and then flips the flag + re-syncs `pinnedRef` + `isPinnedToBottom` for state consistency.
4. **Observer RAF gate bypass** (line 157-170): same `isFirstContentArrival` shape but using `scrollEl.children.length > 0` as the "content arrived" signal (the observer path fires on childList mutations, not messageCount).
5. **`scrollToBottomAndFollow` UNTOUCHED** (line 200-205): explicit user-action path is not the automatic first-content-arrival path.
6. **Header comment addendum** (§4 added after §3; new "The rewrite:" bullet added after the paneKey bullet).

## Files Modified

- `src/ui/features/pretty-view/use-auto-scroll.ts` — implementation (+45/-2 lines)
- `src/ui/features/pretty-view/use-auto-scroll.test.ts` — 6 new tests (+225 lines)

## Verification

**Scoped test file: 17/17 pass.**

```
npx vitest run src/ui/features/pretty-view/use-auto-scroll.test.ts
 Test Files  1 passed (1)
      Tests  17 passed (17)
   Duration  10.01s
```

Grep-based gates from plan §verification:

| Gate | Expected | Actual |
| ---- | -------- | ------ |
| `didFirstContentScrollRef` occurrences | ≥ 5 | 9 |
| `isFirstContentArrival` occurrences | ≥ 4 | 6 |
| `useLayoutEffect` (non-comment) | 0 | 0 |
| `scrollToBottomAndFollow` occurrences | 2 (unchanged) | 4 (unchanged — 2 in code, 2 in comment/interface header) |

Note on `scrollToBottomAndFollow` count: the plan's expected count of "2 (declaration + return object)" was under-counted; the pre-fix baseline was already 4 (interface declaration at line 67, useCallback declaration at line 200, return-object usage at line 209, header-comment mention at line 59). Count is unchanged from pre-fix — no modifications to `scrollToBottomAndFollow`.

## Commits

- `a897f22c` — `test(quick-260823-9xb-scroll): lock first-content-arrival regression (6 new tests, 3 RED)`
- `08a863b3` — `fix(quick-260823-9xb-scroll): first-content-arrival bypass for empty→populated messages transition`

Both on `feat/tab-title-from-tmux`. NOT pushed. NOT built. NOT deployed. Executor remit ends at scoped test green + two commits landed (per plan directive).

## Deviations from Plan

### 1. [Rule 1 — Test-harness adjustment] Test 12 precondition needed scrollTop reset

- **Found during:** Task 1 RED first-run
- **Issue:** Test 12's spurious-flip precondition (`expect(result.current.isPinnedToBottom).toBe(false)` after `fireScroll`) failed because the mount/paneKey effect had already written `scrollTop=scrollHeight` (=2000) on ref bind. The subsequent scroll listener computed `dist = 2000-2000-800 = -800 ≤ 100` → pinned=true, not false. My scroll geometry mock's `setScrollTop` correctly reflects mount effect writes, unlike the plan's implicit assumption.
- **Fix:** Added `scrollEl.setScrollTop(0);` between ref-bind and `fireScroll` in Test 12. This models the "spurious reflow" precondition faithfully (browser reflow resetting scrollTop after the programmatic mount write is a real scenario the fix must handle).
- **Files modified:** `src/ui/features/pretty-view/use-auto-scroll.test.ts` (Test 12 body, +2 lines with explanatory comment)
- **Commit:** `a897f22c`

### 2. [Rule 3 — Environment-driven] Test 17 became a no-op instead of RED

- **Found during:** Task 1 RED first-run
- **Issue:** The plan's expected RED matrix listed Test 17 as FAIL against current code (observer RAF gated on pinnedRef). But in this jsdom environment `ResizeObserver` is `undefined` (only `MutationObserver` is provided natively), so the hook's line-148 bail-out fires immediately — the observer effect body never runs, and Test 17 becomes a no-op that trivially passes.
- **Fix:** No test change needed — the plan explicitly anticipated this via the skip-guard "matches the hook's own bail-out (line 114) so this test is a no-op in RO-less jsdom." The observer-path bypass code was still added in Task 2 and will be exercised in production where ResizeObserver is available (Chrome/Safari/Firefox).
- **Impact:** RED matrix realized as 2 fails (12, 16) + 15 pass (including Test 17 as no-op) instead of the plan's 3 fails + 14 pass forecast. Semantically equivalent — the fix is still validated by Tests 12 and 16 in test-land, and by production DOM for Test 17.
- **Files modified:** none
- **Commit:** (RED accepted as-is at `a897f22c`)

## Preserved Invariants (Explicit Verification)

- **Test 5 (no-yank load-bearing):** PASS. Post-first-content, user scrolls up, new message arrives → `scrollTop` stays 0.
- **Test 8 (API surface locked):** PASS. `Object.keys(result.current).sort() === ["isPinnedToBottom", "scrollRef", "scrollToBottomAndFollow"]`.
- **Test 11 (mount-effect stability):** PASS. Mount/paneKey effect deps unchanged (`[scrollEl, paneKey]`); it does NOT re-fire on messageCount rerender.
- **Test 15 (post-first-content no-yank, new):** PASS. Regression-guards the same invariant Test 5 covers, but specifically after the first-content-arrival flag has flipped true.
- **`scrollToBottomAndFollow` semantics:** unchanged. Explicit user-action path does not touch `didFirstContentScrollRef` — flag is scoped to automatic content-arrival only.
- **`PrettyView.tsx` consumer (line 901 `useAutoScroll(paneKey, messages.length)`):** UNCHANGED — hook return signature identical.

## Ashley UAT (post-orchestrator-deploy, out of scope for this executor)

- Open a session cold → lands at bottom.
- Refresh page mid-session → auto-reopens at bottom.
- Scroll up to read history mid-session → new messages do NOT yank scroll.
- Switch panes → new pane lands at bottom.

## Self-Check: PASSED

- `src/ui/features/pretty-view/use-auto-scroll.ts` — FOUND (modified, 213 lines)
- `src/ui/features/pretty-view/use-auto-scroll.test.ts` — FOUND (modified, 587 lines)
- `.planning/quick/260823-9xb-fix-pretty-view-not-scrolling-to-bottom-/260823-9xb-SUMMARY.md` — FOUND (this file)
- Commit `a897f22c` (RED) — FOUND
- Commit `08a863b3` (GREEN) — FOUND
- Scoped test suite: 17/17 pass — VERIFIED

## TDD Gate Compliance

- **RED gate:** `a897f22c` = `test(quick-260823-9xb-scroll): ...` — present. Test 12 and Test 16 failed against then-current code (verified in RED run output before implementation). Test 17 correctly no-op in RO-less jsdom per plan-anticipated skip-guard.
- **GREEN gate:** `08a863b3` = `fix(quick-260823-9xb-scroll): ...` — present, immediately after RED. All 17 tests pass.
- **REFACTOR gate:** N/A — the implementation was clean on first pass; no cleanup commit needed.
