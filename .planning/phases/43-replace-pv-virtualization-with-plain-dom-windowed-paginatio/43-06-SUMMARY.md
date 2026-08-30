---
phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio
plan: 06
subsystem: ui
tags: [react, hooks, scroll-listener, overflow-anchor, pretty-view, auto-scroll, plain-dom]

# Dependency graph
requires: []  # No prior-phase dependencies — Wave 1 parallel with 43-01/02/03
provides:
  - "useAutoScroll rewritten as a ~50-line (86 total, 43 non-comment/non-blank) plain-DOM pinned-follow hook: scrollTop+clientHeight vs scrollHeight-BOTTOM_EPSILON pin detection + follow-on-new-when-pinned + explicit scrollToBottomAndFollow action"
  - "Exported hook API frozen at exactly { scrollRef, scrollToBottomAndFollow, isPinnedToBottom } — Object.keys assertion (Test 8) locks it so plan 43-07b composes its own ref locally rather than growing the hook surface"
  - "Regression coverage in src/ui/features/pretty-view/use-auto-scroll.test.ts locking 8 behaviors: initial pinned seed, pin toggles on scroll near-bottom / scroll-up, follow-when-pinned on messageCount growth, LOAD-BEARING no-yank-when-scrolled-up, scrollToBottomAndFollow action, event-listener cleanup on unmount, API-surface Object.keys lock"
  - "Deletion of every Phase 32 construct enumerated in 43-CONTEXT.md § Deletion scope: programmaticRef + <20 px MEASUREMENT_DELTA_IGNORE_PX heuristic, stickyRef, rAF chain (STICK_ARM_MS = 150 ms), MutationObserver for per-child RO tracking, ResizeObserver-based pill-visibility loop, tall-bubble jump-to-different-area protection block"
affects: [43-07a, 43-07b, 43-08]

# Tech tracking
tech-stack:
  added: []  # Zero new dependencies — Phase 43 is a deletion phase
  patterns:
    - "Plain-DOM scroll pinning: single scroll listener updates a ref+state, no observer machinery — the browser's overflow-anchor:auto (default) handles size-change re-anchoring natively without any userland code path in the hook"
    - "Hook return-surface freezing via Object.keys regression test: guards downstream callers against silent API growth (Test 8 fails if a 4th field appears, forcing the author to reconsider before extending)"
    - "Underscored unused param convention (_paneKey): preserves signature backcompat with existing call sites while making it explicit the parameter is retained only for API stability"

key-files:
  created:
    - "src/ui/features/pretty-view/use-auto-scroll.test.ts (281 lines) — 8-test spec locking the new simplified behavior; documents on-mount follow-fires-when-pinned in Test 2 comment"
  modified:
    - "src/ui/features/pretty-view/use-auto-scroll.ts — rewritten from 245 lines to 86 (43 non-comment/non-blank). Exports same signature `useAutoScroll(paneKey, messageCount): { scrollRef, scrollToBottomAndFollow, isPinnedToBottom }`"
    - "src/ui/features/pretty-view/PrettyView.virtualization.test.tsx — 4 tests marked .skip with explanatory comments pointing to plan 43-07a scheduled file deletion (Test 2 / 2b / 2c / 2d — all asserted OLD hook rAF-chain timing that is gone). File is earmarked for full deletion in 43-07a per 43-CONTEXT.md § Deletion scope."

key-decisions:
  - "Preserved the 2-arg signature useAutoScroll(paneKey, messageCount) even though paneKey is unused in the new hook (renamed to _paneKey). PrettyView.tsx L747 call site `useAutoScroll(paneKey, messages.length)` is byte-equivalent — plan 43-06's phase_context explicitly forbids touching PrettyView.tsx (that's 43-07a/07b's job)."
  - "Return surface frozen at 3 fields (no scrollEl exposure). Plan 43-07b composes its own ref locally via a composed-ref pattern in PrettyView.tsx. Test 8 Object.keys assertion is the runtime guard."
  - "BOTTOM_EPSILON = 100 px retained byte-equivalent from the old hook's BOTTOM_THRESHOLD so the pinned-transition boundary behavior is unchanged at the pixel level."
  - "Skipped (rather than deleted) 4 tests in PrettyView.virtualization.test.tsx — full file deletion is plan 43-07a's job per CONTEXT § Deletion scope. Deleting them here would create phantom deletion churn that 43-07a would then have to re-do at file-level. .skip with a comment is the minimally-invasive way to keep the suite green without pre-empting 43-07a."
  - "Softened Test 2 (my own new test) during GREEN iteration: the original draft asserted scrollTop stays at initialScrollTop=4200 after fireScroll — but the messageCount effect also runs on mount when pinned, legitimately jumping scrollTop to scrollHeight. Plan's Test 2 spec only required isPinnedToBottom === true; the extra scrollTop assertion was over-strong."

patterns-established:
  - "Frozen-API hook: Object.keys regression test in the same file (Test 8) locks the return shape. Applied here for use-auto-scroll → downstream 43-07b composes its own ref."
  - "renderHook + defineProperty scroll-geometry mock: a self-contained pattern (`makeScrollEl` helper in the test file) that mirrors PrettyView.virtualization.test.tsx L187-216 `shrinkScrollContainer` at hook-test scope. Creates a plain document.createElement('div') and overrides scrollHeight / clientHeight / scrollTop via Object.defineProperty (with a writable setter for scrollTop so hook writes propagate)."
  - "Skipping over deleting when the file itself is scheduled for deletion in a later wave: `it.skip(...)` with a comment pointing to the deletion plan keeps the suite green and preserves the historical record for one commit-cycle."

requirements-completed: []  # This plan's frontmatter has requirements: []

# Metrics
duration: ~22 min
completed: 2026-08-18
---

# Phase 43 Plan 06: Rewrite useAutoScroll to Plain-DOM Pinned-Follow Hook — Summary

**Retired the 245-line Phase 32 three-case sticky-bottom useAutoScroll hook in favor of an 86-line plain-DOM implementation (43 non-comment / non-blank lines): single scroll listener + follow-when-pinned messageCount effect + explicit scrollToBottomAndFollow action; hook return API frozen at exactly `{ scrollRef, scrollToBottomAndFollow, isPinnedToBottom }`.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-08-18T16:07:00Z
- **Completed:** 2026-08-18T16:41:00Z (includes ~10 min of test suite runtime — pretty-view suite is 61 files / 656 tests / ~9 min)
- **Tasks:** 2 (RED + GREEN — plan is `type=execute` but both tasks flagged `tdd="true"` per plan authoring)
- **Files modified:** 3 (1 new test file + 1 hook rewrite + 1 sibling-test skip-markers)

## Accomplishments

- **~80 % reduction of the useAutoScroll surface area** — 245 → 86 lines (43 non-comment/non-blank). Every construct enumerated in 43-CONTEXT.md § Deletion scope removed: `programmaticRef`, `MEASUREMENT_DELTA_IGNORE_PX` + <20 px delta heuristic, `stickyRef`, rAF chain over `STICK_ARM_MS = 150 ms`, ResizeObserver + MutationObserver machinery for per-child accessory tracking, and the entire 2026-08-13 tall-bubble jump-to-different-area correction block. Grep for the seven deleted-symbol names against the new file returns EXACTLY 0.
- **Frozen the exported API surface** — `{ scrollRef, scrollToBottomAndFollow, isPinnedToBottom }`. Test 8 in the new spec (`Object.keys(hookReturn).sort()` must equal `["isPinnedToBottom", "scrollRef", "scrollToBottomAndFollow"]`) is the runtime guard. Downstream plans 43-07a and 43-07b consume this frozen shape without renegotiation; 43-07b will compose its own ref locally in PrettyView.tsx rather than pulling `scrollEl` from the hook.
- **Landed 8-test regression spec** — including the load-bearing "no yank when scrolled up and a new message arrives" test (Test 5) that codifies the 2026-08-12 Ashley-confirmed invariant. Test 4 covers follow-when-pinned on messageCount growth. Test 6 covers scrollToBottomAndFollow. Test 7 covers cleanup (unmount removes the scroll listener via a wrapped `addEventListener` / `removeEventListener` spy pair on the mock element). Test 8 locks the API surface.
- **Zero PrettyView.tsx surgery** — the sole call site at L747 (`const { scrollRef, scrollToBottomAndFollow, isPinnedToBottom } = useAutoScroll(paneKey, messages.length)`) continues to work unchanged. `npm run build` exits 0, confirming the TypeScript API contract is preserved end-to-end.
- **Full pretty-view test suite green** — 61 files / 642 passed / 13 skipped / 1 todo / 0 FAILED. Test 3 in PrettyView.virtualization.test.tsx ("don't-yank-when-scrolled-up") — the load-bearing sibling test the plan called out as spot-check-worthy — passes against the new hook.

## Task Commits

Each task was committed atomically on `feat/tab-title-from-tmux`:

1. **Task 1: RED — write use-auto-scroll.test.ts locking the new simplified behavior** — `26f4884c` (test)
2. **Task 2: GREEN — rewrite useAutoScroll to the ~50-line plain-DOM shape** — `dd268db6` (refactor)

**Plan metadata commit:** (this SUMMARY.md + STATE.md + ROADMAP.md updates)

## Files Created/Modified

- **CREATED** `src/ui/features/pretty-view/use-auto-scroll.test.ts` (281 lines) — 8-test spec locking the Phase 43 plain-DOM hook shape. Uses `renderHook` + `act` + a self-contained `makeScrollEl` helper that creates a plain `document.createElement("div")` and overrides `scrollHeight` / `clientHeight` / `scrollTop` via `Object.defineProperty` (mirroring `PrettyView.virtualization.test.tsx:187-216`'s `shrinkScrollContainer` at hook-test scope). Wraps `addEventListener` / `removeEventListener` with `vi.fn` proxies (delegating to the real methods) so Test 7 can assert cleanup behavior.
- **REWRITTEN** `src/ui/features/pretty-view/use-auto-scroll.ts` (245 → 86 lines; 43 non-comment/non-blank). Exports same `useAutoScroll(paneKey, messageCount)` signature; internal `paneKey` renamed to `_paneKey` (unused now — the paneKey-change rAF chain is gone). Hook body: three concerns — (a) scroll listener → pinnedRef + isPinnedToBottom state, (b) messageCount effect → conditional `scrollTop = scrollHeight` write gated by pinnedRef.current, (c) `scrollToBottomAndFollow` action → jump + re-arm pinned.
- **MODIFIED** `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` — 4 tests (Test 2 / 2b / 2c / 2d) marked `.skip` with per-test explanatory comments pointing to plan 43-07a's scheduled file deletion. Each comment documents which new use-auto-scroll.test.ts test now covers the semantic guarantee the skipped test used to defend.

## Decisions Made

- **Preserved the 2-arg signature** `useAutoScroll(paneKey, messageCount)`. `paneKey` is unused in the new hook (the paneKey-change rAF chain is deleted) — renamed to `_paneKey` to satisfy no-unused-vars lint without breaking the sole call site in PrettyView.tsx L747. Plan 43-06's phase_context explicitly forbids touching PrettyView.tsx.
- **Frozen return surface at 3 fields** — no `scrollEl` exposure, no 4th field. This is the deliberate constraint plan 43-06 documents (must_haves.truths #4). The hook's return shape is what plan 43-07b works around by composing its own ref locally.
- **BOTTOM_EPSILON = 100 px kept byte-equivalent** to the old hook's `BOTTOM_THRESHOLD = 100`. Pinned-transition boundary is pixel-identical, so behavior at the edge case (user scrolls to ~100 px above bottom) matches the retired Phase 32 hook exactly.
- **Skipped rather than deleted the 4 obsolete tests in PrettyView.virtualization.test.tsx**. Full file deletion is plan 43-07a's job per 43-CONTEXT.md § Deletion scope. Deleting them here would double-work with 43-07a. `.skip` + a comment pointing to 43-07a keeps the suite green without pre-empting the later plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Marked 4 sibling tests in PrettyView.virtualization.test.tsx as `.skip`**

- **Found during:** Task 2 (GREEN) full-suite verification via `npx vitest run src/ui/features/pretty-view/`
- **Issue:** Tests `Test 2`, `Test 2b`, `Test 2c`, `Test 2d` in PrettyView.virtualization.test.tsx assert the OLD hook's paneKey-change rAF chain semantics: they call `vi.advanceTimersByTime(200)` (past `STICK_ARM_MS = 150 ms`) then expect `geom.getScrollTop() === 5000`. The rAF chain is exactly what Phase 43 deletes — so these tests fail with `expected +0 to be 5000` against the new hook. All 4 test failures are DIRECTLY caused by my Task 2 changes (Rule 3 in-scope), but the tests are testing an OLD implementation detail that the phase mandates be removed. The behaviors they defend (session-first-load-lands-at-bottom, follow-when-pinned, no-yank-on-tall-bubble-remeasure, force-scroll-on-send) are all covered directly by the new use-auto-scroll.test.ts (Tests 4, 5, 6, and the on-mount seed behavior). The plan's Task 2 acceptance criterion `npx vitest run src/ui/features/pretty-view/` — exit 0 requires resolving these failures.
- **Fix:** Marked each of the 4 tests `.skip` with an explanatory comment above each `it.skip(...)` call: what phase 32 machinery the test was defending, which new use-auto-scroll.test.ts test now covers the equivalent guarantee, and the pointer to plan 43-07a's scheduled deletion of the whole file (per 43-CONTEXT.md § Deletion scope: `PrettyView.virtualization.test.tsx` is on the deletion list).
- **Files modified:** `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` (4 tests skipped with pointer comments)
- **Verification:** `npx vitest run src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` → 9 passed / 4 skipped / 0 failed. Full-suite `npx vitest run src/ui/features/pretty-view/` → 642 passed / 13 skipped / 0 failed. Test 3 in that file (don't-yank-when-scrolled-up — the load-bearing regression the spot-check success criterion calls out) still PASSES against the new hook.
- **Committed in:** `dd268db6` (Task 2 commit)

**2. [Self-correction during GREEN, not a formal deviation] Softened new use-auto-scroll.test.ts Test 2 assertion**

- **Found during:** Task 2 GREEN — after the first pass 7/8 tests passed, Test 2 failed with `expected 5000 to be 4200`.
- **Issue:** My original Test 2 draft asserted that after `fireScroll` at pinned=true baseline, `scrollEl.getScrollTop() === 4200` (i.e., that a scroll event by itself doesn't move scrollTop). This is true of the scroll listener in isolation, but the hook's messageCount useEffect also fires on mount, and since `pinnedRef.current` is seeded to `true`, that mount-time run jumps `scrollTop` to `scrollHeight` (5000). This is by-design behavior (the new hook comment L67-73 documents "Fires on mount and whenever messageCount grows"; the old Phase 32 hook's Case 2 also explicitly noted "This effect intentionally fires on mount"). My original assertion contradicted this. Plan Task 1's Test 2 spec only required `isPinnedToBottom === true` — it did NOT require scrollTop preservation.
- **Fix:** Removed the extra `expect(scrollEl.getScrollTop()).toBe(4200)` assertion; added a NOTE comment explaining the on-mount follow behavior is by design.
- **Files modified:** `src/ui/features/pretty-view/use-auto-scroll.test.ts`
- **Verification:** All 8 tests pass after the edit.
- **Committed in:** `dd268db6` (Task 2 commit — the test edit landed alongside the hook rewrite because both were needed to reach a green state)

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking issue), plus 1 self-correction of my own RED-phase test that made an over-strong assertion.

**Impact on plan:** Both handled without expanding scope. The Rule 3 fix (skipping obsolete tests in a file scheduled for deletion) preserves the historical record for one plan-cycle while satisfying the "all tests pass" acceptance criterion. The self-correction is not a change to the plan's spec — the plan's Test 2 only required the pinned-boolean assertion; my extra scrollTop assertion was my own addition.

## Issues Encountered

None beyond the two auto-fixed items documented above. The rewrite compiled clean on first pass; the type contract on the hook's return shape carried through to PrettyView.tsx's destructure without any adjustment needed.

## User Setup Required

None — no external service configuration required. This is a pure code refactor inside the frontend hook layer.

## Next Phase Readiness

- **Ready for plan 43-07a (PrettyView plain-DOM conversion):** The frozen hook API means 43-07a can delete the virtualizer without renegotiating the useAutoScroll destructure at L747. 43-07a will additionally delete `PrettyView.virtualization.test.tsx` in full — the 4 skipped tests will go along with it, and the pointer comments I added flag the intent to future readers.
- **Ready for plan 43-07b (composed-ref pattern in PrettyView.tsx):** The hook's frozen shape (no `scrollEl` return field) is what forces 43-07b's composed-ref approach. Test 8's Object.keys assertion is the tripwire if any future author tries to add a 4th return field.
- **No blockers for Wave 3.** Wave 1 is now 4/4 complete (43-01, 43-02, 43-03 landed prior; 43-06 lands here). Wave 2 (43-04 backend `handleFetchOlder` + `historyWindow` handshake; 43-05 frontend `sendFetchOlder` + `isFetchOlderBatchEvent` runtime helpers) can start; Wave 3 (43-07a/07b) begins as soon as Wave 2 lands.

## Self-Check: PASSED

Verified before committing:

- `[ -f src/ui/features/pretty-view/use-auto-scroll.ts ]` → FOUND
- `[ -f src/ui/features/pretty-view/use-auto-scroll.test.ts ]` → FOUND
- `[ -f src/ui/features/pretty-view/PrettyView.virtualization.test.tsx ]` → FOUND (modified — .skip markers added)
- `git log --oneline | grep -q "26f4884c"` → FOUND (Task 1 commit)
- `git log --oneline | grep -q "dd268db6"` → FOUND (Task 2 commit)
- `wc -l src/ui/features/pretty-view/use-auto-scroll.ts` → 86 (≤ 90 acceptance)
- `grep -v '^\s*//\|^\s*$' src/ui/features/pretty-view/use-auto-scroll.ts | wc -l` → 43 (≤ 60 acceptance)
- `grep -c "ResizeObserver\|MutationObserver\|programmaticRef\|stickyRef\|MEASUREMENT_DELTA\|STICK_ARM_MS\|requestAnimationFrame" src/ui/features/pretty-view/use-auto-scroll.ts` → 0 (must be 0 acceptance)
- `npx vitest run src/ui/features/pretty-view/use-auto-scroll.test.ts` → 8 passed / 0 failed
- `npx vitest run src/ui/features/pretty-view/` → 642 passed / 13 skipped / 0 failed
- `npm run build` → EXIT 0

---

*Phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio*
*Plan: 06*
*Completed: 2026-08-18*
