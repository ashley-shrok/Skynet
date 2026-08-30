---
phase: 32-redesign-pretty-view-auto-scroll-three-case-sticky-bottom-ho
plan: 04
subsystem: ui/pretty-view
tags: [test, auto-scroll, sticky-bottom, virtualization, integration-test]
dependency-graph:
  requires:
    - "32-02 (useAutoScroll(paneKey) hook — the wire-target these tests exercise)"
    - "32-03 (PrettyView.tsx wire-through — handleComposeSend → scrollToBottomAndFollow makes Test 2d meaningful)"
    - "32-CONTEXT.md § Test coverage (four scenarios locked)"
    - "32-PATTERNS.md § 3a-3e (extension shapes for the four scenarios)"
  provides:
    - "PrettyView.virtualization.test.tsx: 4 covered auto-scroll scenarios (Test 2 session-first-load, Test 2b incoming-at-bottom, Test 3 incoming-scrolled-up, Test 2d user-send-from-scrolled-up)"
    - "Full-suite green baseline: 152 files / 1924 passed / 6 skipped / 1 todo / 0 failures"
  affects:
    - "Phase 32 completion — all four CONTEXT.md § Test coverage scenarios now empirically covered; Ashley's morning deploy-greenlight can proceed once the verifier signs off"
tech-stack:
  added: []
  patterns:
    - "Two-step scroll dispatch to sync scroll-listener's lastScrollTop closure baseline before flipping stickyRef (compensates for programmaticRef-gated writes never touching the closure baseline)"
    - "vi.stubGlobal('requestAnimationFrame', setTimeout+16ms) inside vi.useFakeTimers to flush the hook's rAF chain synchronously via vi.advanceTimersByTime"
    - "capturedROCallbacks manual invocation to drive the hook's outer-container ResizeObserver in JSDOM (extended from Test 1's existing pattern)"
    - "Integration Send-flow via fireEvent.change(textarea) + fireEvent.click(getByRole('button', {name: 'Send'})) — Option A from plan Change 4, matching ComposeBox.test.tsx Test 7/13 patterns"
key-files:
  created: []
  modified:
    - "src/ui/features/pretty-view/PrettyView.virtualization.test.tsx (+238 / -39 = net +199 lines; Test 2 un-skipped + adapted, Test 2b + Test 2d added, Test 3 wheel → scroll adapted)"
  deleted: []
decisions:
  - "Option A (integration via UI) chosen for Test 2d per plan Change 4 recommendation — drives the real handleComposeSend → scrollToBottomAndFollow wire-through end-to-end; matches ComposeBox.test.tsx Test 7 L262-269 and Test 13 L338-341 fireEvent.change + fireEvent.click patterns; verifies not just the hook but the entire Phase 32 wire-through path Ashley cares about."
  - "Two-step scroll dispatch pattern (dispatch scroll at mocked bottom first to sync listener's lastScrollTop closure baseline, THEN dispatch at mocked lower position to trigger stickyRef flip) — required because the hook's programmaticRef guard prevents the paneKey rAF chain's own scrollTop writes from updating the listener's lastScrollTop, so the listener starts with lastScrollTop=0 (its at-attach reading). Discovered on first run of Test 3 which failed 5200 !== 1000 because sticky was still true when the RO fired."
  - "requestAnimationFrame stub via vi.stubGlobal (per plan Change 1's rAF-in-JSDOM caveat clause) — vitest fake-timers do NOT polyfill rAF by default. Applied to Tests 2, 2b, 3, and 2d consistently. All four tests use the same `(cb) => setTimeout(() => cb(performance.now()), 16)` shim."
  - "Kept the existing beforeEach ResizeObserver capturing stub (L246-306) and shrinkScrollContainer helper (L187-226) VERBATIM per plan action block. Zero adaptations needed to the scaffolding — everything the new tests need is already there. Only addition to file-level infra was one import (fireEvent) alongside the existing render/act/waitFor."
metrics:
  duration_seconds: 553
  duration_minutes: 9
  completed_date: 2026-08-12T21:45:19Z
  tasks_completed: 1
  files_created: 0
  files_modified: 1
  files_deleted: 0
---

# Phase 32 Plan 04: Extend PrettyView.virtualization.test.tsx with four-scenario auto-scroll coverage Summary

Extended `PrettyView.virtualization.test.tsx` with the four CONTEXT.md § Test coverage scenarios: un-skipped Test 2 (session first load) + adapted timing to `STICK_ARM_MS=150`, added Test 2b (incoming-at-bottom → follow) driving the hook's outer-container ResizeObserver via `capturedROCallbacks`, adapted Test 3 from `WheelEvent` dispatch → `Event("scroll")` dispatch matching the Phase 32 single-listener design, and added Test 2d (user send from scrolled-up → force bottom) driving the compose textarea + Send button end-to-end through `handleComposeSend → scrollToBottomAndFollow`. Full-suite green: **152 files / 1924 passed / 6 skipped / 1 todo / 0 failures** (delta from Wave 3 baseline: +3 passed, -1 skipped — exactly matches expected +1 Test-2-un-skipped +2 new tests).

## The four scenarios, before and after

| Scenario | CONTEXT.md § Test coverage # | Before Wave 4 | After Wave 4 |
| -------- | ---------------------------- | ------------- | ------------ |
| Session first load lands at bottom | 1 | `it.skip("Test 2: auto-scroll-to-bottom-when-pinned — scrollTop jumps to bottom via paneKey rAF-chain over virtualized layout"` — skipped since quick 260810-299 (temp-disable) | `it("Test 2: session first load lands at bottom — scrollTop jumps to bottom via paneKey rAF-chain over virtualized layout"` — un-skipped, adapted from `advanceTimersByTime(400)` → `200` (STICK_ARM_MS=150), rAF stub added, PASSES |
| Incoming message while at bottom → follow | 2 | NOT TESTED (old file lacked this because auto-scroll was disabled at file authoring time) | `it("Test 2b: incoming message while at bottom — follows (pin-to-bottom via RO on scrollHeight growth)"` — new, drives the hook's outer-container RO via `capturedROCallbacks` after `geom.setScrollHeight(5200)`, PASSES |
| Incoming message while scrolled up → NO yank | 3 | `it("Test 3: don't-yank-when-scrolled-up — after wheel-up gesture, subsequent frames do not force scrollTop back to bottom"` — dispatched `new WheelEvent("wheel", { deltaY: -100 })` (which the new hook does not listen for; test was passing artifactually because the wheel event flowed through to no-op) | `it("Test 3: incoming message while scrolled up — does NOT yank to bottom (scroll-listener source)"` — adapted; dispatches `new Event("scroll")` after two-step baseline sync; PASSES (now genuinely exercises the single scroll-listener path) |
| User send from any state → force bottom | 4 | NOT TESTED (old file lacked this because the wire-through was stubbed at file authoring time) | `it("Test 2d: user send from scrolled-up state — forces scroll to bottom via handleComposeSend → scrollToBottomAndFollow"` — new; drives the real ComposeBox UI (fireEvent.change on textarea + fireEvent.click on Send button); PASSES (verifies end-to-end wire-through) |

## Test 2d integration path chosen: Option A (integration via UI)

Per plan Change 4, two options were on the table:
- **Option A** — locate compose textarea via `getByPlaceholderText(/message/i)`, dispatch `fireEvent.change` to type text, locate Send button via `getByRole("button", { name: "Send" })`, dispatch `fireEvent.click`. Verifies end-to-end wire-through: ComposeBox `handleSend` → prop `onSend` → PrettyView `handleComposeSend` → `scrollToBottomAndFollow`.
- **Option B** — grab ComposeBox's `onSend` prop via a test seam and call it directly. Bypasses the UI shell but still exercises the parent handler.

**Chose Option A** — matches ComposeBox.test.tsx L262-269 (Test 7) and L338-341 (Test 13) proven patterns; verifies the entire wire-through Ashley cares about (not just the hook primitive but the button → prop → handler → hook chain); no test seam needed. `aria-label="Send"` is the canonical selector per patch #129 (ComposeBox.tsx L2423).

## Adaptations to test scaffolding

Per plan Change 5: preserve scaffolding byte-for-byte. Actual scaffolding adaptations required: **one** — added `fireEvent` to the existing `render, act, waitFor` import from `@testing-library/react` (line 39). Test 2d dispatches through `fireEvent.change` and `fireEvent.click` so this import addition is unavoidable and orthogonal to the scaffolding blocks the plan called out to preserve (wsStubs, mocks, flipToStreaming, fireMessageBatch, getOuterScrollContainer, shrinkScrollContainer, capturedROCallbacks, beforeEach/afterEach setup — all UNCHANGED).

The plan's `<action>` explicitly said "Do NOT modify the scaffolding blocks (imports, mocks, wsStubs, ...)". The import list technically is under the "imports" bucket. Interpreted narrowly: `fireEvent` is a named symbol from the same package already partially imported; adding it is the minimal-diff way to fulfill Change 4's Option A. Alternative would be to write custom event dispatch bypassing @testing-library/react — that's WORSE per test-hygiene and violates the "match existing ComposeBox.test.tsx patterns" guidance in Change 4. Treating the import addition as an infrastructure-preservation-compatible surgical edit rather than a "modify the scaffolding" violation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Two-step scroll dispatch required for Tests 3 and 2d to actually flip stickyRef.current = false**

- **Found during:** Task 1 first `npx vitest run src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` run — Test 3 failed with `expected 5200 to be 1000` (scrollTop got yanked to 5200 by the RO fire because sticky was still true).
- **Issue:** The plan's Change 3 authored a single-step scroll dispatch: `geom.setScrollTop(1000); outerScroll.dispatchEvent(new Event("scroll"));`. That does NOT flip stickyRef.current to false because the hook's scroll listener has captured `lastScrollTop` in a closure at effect-attach time (before shrinkScrollContainer installs the mocked getters, and before any programmatic rAF chain writes). The paneKey rAF chain's own scrollTop writes are gated out by the programmaticRef flag — so those writes never update `lastScrollTop` inside the listener closure. Result: `lastScrollTop` = 0 (the initial JSDOM default at attach). Dispatching a scroll at 1000 gives `now (1000) > lastScrollTop (0)` — the listener never takes the `now < lastScrollTop` branch and never flips sticky.
- **Fix:** Two-step dispatch — first `geom.setScrollTop(5000); dispatchEvent("scroll")` to sync the listener's closure baseline to a plausible bottom value (this scroll dispatch has `now=5000 > lastScrollTop=0` and `atBottom=true` so it takes the else-if branch, sets stickyRef.current=true (no-op — it's already true), and updates `lastScrollTop = 5000`). THEN `geom.setScrollTop(1000); dispatchEvent("scroll")` — now `now=1000 < lastScrollTop=5000` and the listener flips stickyRef.current = false as intended. Applied to both Test 3 and Test 2d (identical shape).
- **Files modified:** `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` (both new tests, +6 lines each).
- **Commit:** included in the single atomic Wave 4 commit.
- **Why this is a Rule 1 (bug) fix, not Rule 4 (architectural):** The bug is in the plan's test-authoring, not in the hook. The hook's programmaticRef guard is correct and CONTEXT.md-locked; the test just needed to account for the closure-baseline behavior that guard produces. A single-step dispatch would have required either mutating the hook (WRONG — CONTEXT.md § Event handling is LOCKED) or exposing test internals (WORSE — leaks hook implementation). Two-step dispatch is the correct test-side workaround, in the same JSDOM-workaround genre as `capturedROCallbacks` manual invocation.

**2. [Rule 3 — Blocking] `vi.stubGlobal("requestAnimationFrame", ...)` needed under fake timers**

- **Found during:** Test 2 initial adaptation — the plan's Change 1 flagged this as a caveat: *"rAF-in-JSDOM caveat handling: run the test as-is once. If the assertion `expect(geom.getScrollTop()).toBe(5000)` fails with scrollTop still 0, vitest fake-timers may not polyfill requestAnimationFrame."*
- **Issue:** Vitest fake-timers wrap `setTimeout` but do NOT polyfill `requestAnimationFrame`. The hook's paneKey rAF chain calls `requestAnimationFrame(tick)` which in JSDOM under fake timers becomes a no-op. `vi.advanceTimersByTime(200)` therefore never flushes the chain.
- **Fix:** Applied the plan's suggested stub verbatim: `vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16))` at the top of every rAF-dependent test (Tests 2, 2b, 3, 2d — all four). The stub reroutes `requestAnimationFrame` through `setTimeout`, which fake timers DO advance, so `vi.advanceTimersByTime(200)` flushes both the paneKey chain and the scrollToBottomAndFollow re-arm chain deterministically.
- **Files modified:** `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` (Tests 2, 2b, 3, 2d — 3 lines each).
- **Commit:** included in the single atomic Wave 4 commit.
- **Why not a scaffolding-block violation:** The rAF stub is per-test (inside each `try` block after `vi.useFakeTimers()`), not in `beforeEach`. Consistent with the plan's guidance which explicitly authored this as a per-test adaptation.

### Non-deviations (predicted fallout that did NOT materialize)

- Tests 1, 4, 5a, 5b, 6, 7, 8, 9 (all pre-existing) continue to pass unchanged. `forceStickAndJumpRef` was never referenced in this test file (grep confirmed pre-edit); no fixup needed for stub-symbol removals.
- No new file spawned (plan Change 5 forbids `use-auto-scroll.test.ts`; Wave 2 already deleted the stale one; `test ! -f` verify gate passes).

### Auth gates

None.

## Verification results

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | exit 0 (no TS errors) |
| grep `it\("Test 2: session first load lands at bottom` | 1 match |
| grep `it\("Test 2b: incoming message while at bottom` | 1 match |
| grep `it\("Test 2d: user send from scrolled-up state` | 1 match |
| grep `it\("Test 3: incoming message while scrolled up` | 1 match |
| non-comment `it\.skip\("Test 2` count | **0** |
| non-comment `new WheelEvent` count | **0** |
| `test ! -f src/ui/features/pretty-view/use-auto-scroll.test.ts` | ABSENT (Wave 2 rule-3 fix) |
| `npx vitest run src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` numeric-parsed FAILED | **0** (12 tests / 12 passed) |
| `npx vitest run` (full-suite) numeric-parsed FAILED | **0** (152 files / 1924 passed / 6 skipped / 1 todo) |
| `git diff --stat src/` | 1 file changed (PrettyView.virtualization.test.tsx +238 -39) |

## Full-suite delta vs Wave 3 baseline

| Metric | Wave 3 baseline | Wave 4 result | Delta | Expected |
| ------ | --------------- | ------------- | ----- | -------- |
| Test files | 152 | 152 | 0 | 0 (no new files) |
| Passed | 1921 | 1924 | +3 | +3 (1 un-skip + 2 new) |
| Skipped | 7 | 6 | -1 | -1 (Test 2 un-skipped) |
| Todo | 1 | 1 | 0 | 0 |
| **Failed** | **0** | **0** | **0** | **0** (Ashley fleet rule) |

## Self-Check: PASSED

Verified:
- File modified: `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` — FOUND (git diff shows +238/-39, matches the four coordinated changes).
- File absent: `src/ui/features/pretty-view/use-auto-scroll.test.ts` — CONFIRMED ABSENT (`test ! -f` passes; Wave 2 deleted).
- `npx tsc --noEmit`: exit 0.
- File-scoped `npx vitest run src/ui/features/pretty-view/PrettyView.virtualization.test.tsx`: **12 tests passed, 0 failed**.
- Full-suite `npx vitest run`: **1924 passed, 6 skipped, 1 todo, 0 failed** (152 test files).
- All plan `<verify>` numeric-parse gates: **PASS** (both file-scoped FAILED=0 and full-suite FAILED=0 via the checker Warning 2 numeric-extraction gate, not fragile regex alternation).

## Fleet compliance notes

- **No worktree** used (Ashley 2026-07-31 rule). Worked in `~/skynet` on `feat/tab-title-from-tmux` main working tree. `git branch --show-current` = `feat/tab-title-from-tmux` (main working branch).
- **Frontend-only phase**: `npx tsc --noEmit` + `npx vitest run` only. Skipped `npm run build:backend` per fleet rule.
- **STOP at commit — no deploy motion** (Ashley 2026-07-27 rule): no `docker compose up`, no `git push`. Tina orchestrates deploys after the verifier passes — this is the FINAL wave; ship-readiness depends on the verifier green-lighting the numeric-parse gate.
- **Individual file staging**: `git add src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` (single specific file). No `git add .` or `git add -A`.
- **Atomic commit**: single commit for the test file changes per the orchestrator's `commit protocol` handoff message.

## Handoff notes for the phase verifier

- All four CONTEXT.md § Test coverage scenarios are now covered as `it(...)` blocks in `PrettyView.virtualization.test.tsx`.
- The four-scenario coverage validates the Phase 32 hook + wire-through end-to-end: hook primitives (Case 1 paneKey rAF, Case 2 RO-on-outer, Case 3 scrollToBottomAndFollow) AND the PrettyView integration (handleComposeSend → scrollToBottomAndFollow via ComposeBox onSend prop).
- Full-suite FAILED=0 satisfies the phase's ship-readiness numeric-parse gate.
- Wave 3's `PrettyView.autoplay.test.tsx` ResizeObserver polyfill is still in place (untouched here). No fallout from Wave 4.
- Phase 32 is complete pending verifier sign-off. Ashley's morning deploy-greenlight can proceed after that.
