---
phase: 76-optimistic-bubbles-must-survive-the-wait-when-the-agent-was-
plan: 03
subsystem: pretty-view
tags:
  - multi-send-verification
  - dormancy
  - reconnect-mid-dormancy
  - phase-62-claim-verification
  - pretty-view
dependency_graph:
  requires:
    - 76-01 (signal unification — setDormant from pane_state handler — landed as prerequisite)
    - src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx Test 5c (reconnect-mid-dormancy single-send pattern)
  provides:
    - Test 5d — D-07 verification: multi-send during reconnect-mid-dormancy delivers in FIFO order
    - Phase 62 multi-send claim verified under real conditions with reconnect-mid-dormancy setup
  affects:
    - src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx (+143 lines, new Test 5d)
tech_stack:
  added: []
  patterns:
    - "Multi-WS harness pattern: wsStubs array grows on reconnect; ws1 close + vi.advanceTimersByTime(2001) to fire reconnect backoff; ws2 Signal-B-only delivery"
    - "FIFO clear pattern: typeAndEnter x2 with distinct content; sendWsFrame matching user-role frames in order; countPendingBubbles decrements in order"
    - "D-07 verification pattern: advance past 20001ms with both pendings still alive proves both sends armed 220s branch"
key_files:
  created: []
  modified:
    - path: src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx
      lines: "553-695 (Test 5d — multi-send during reconnect-mid-dormancy, D-07 verification)"
decisions:
  - "D-07 VERIFIED: Phase 62 multi-send claim holds under reconnect-mid-dormancy conditions. Two sends during dormancy-after-reconnect both arm 220s branch; FIFO clear delivers both in order with no failed bubbles."
  - "eventId values ev-5d-1 and ev-5d-2 chosen as string IDs — unique and non-colliding with all existing string-based eventIds in the file"
  - "Test uses content-distinct strings (message-one vs message-two) — exercises the ordered-clear path where FIFO head-match content equality distinguishes them clearly"
  - "FIFO discipline confirmed: first send (message-one) is the FIFO head; its matching frame clears it first; second send (message-two) clears second"
metrics:
  duration_min: 15
  completed_date: "2026-09-06"
  tasks_completed: 1
  files_modified: 1
  commits: 1
  tests_added: 1
requirements:
  - D-07
---

# Phase 76 Plan 03: D-07 Multi-Send Verification Summary

**One-liner:** Test 5d verifies Phase 62's multi-send-during-wake claim under reconnect-mid-dormancy conditions — two sends arm 220s branch, both clear in FIFO order when matching frames arrive; Phase 62 claim upheld.

## Test 5d Outcome: PASS

D-07 verification is complete. Phase 62's multi-send-during-wake claim holds under real conditions with the reconnect-mid-dormancy setup.

### What Test 5d Proved

The D-07 verification covered the scenario Alice described verbatim: "two spinning bubbles in flight during a widened wait, both deliver in order when wake completes, no bubbles lost or reordered, no dedup collision."

Specific assertions verified:
1. After two `typeAndEnter` calls during dormancy-after-reconnect: `countPendingBubbles === 2`
2. At T+20001ms: BOTH pendings still exist, no failed bubbles — proves BOTH sends armed the 220s branch (Plan 01's unified signal fix works for both sends, not just the first)
3. Delivering `{type:"message", role:"user", content:"message-one"}`: first pending cleared in FIFO order, `countPendingBubbles === 1`, `countConfirmedBubbles === 1`
4. Delivering `{type:"message", role:"user", content:"message-two"}`: second pending cleared, `countPendingBubbles === 0`, `countConfirmedBubbles === 2`
5. No failed bubbles at any point

## What Shipped

### Task 1: Test 5d (commit `2f9b6cf4`)

Added Test 5d immediately after Test 5c in `PrettyView.optimistic-bubbles.test.tsx` (lines 553-695). Test extends the reconnect-mid-dormancy structural template from Test 5c to a two-send scenario:

1. Mount PrettyView; get ws1; establish dormancy via BOTH Signal A (`{type:"dormant", dormant:true}`) and Signal B (`{type:"pane_state", state:"dormant"}`)
2. Simulate WS close (`ws1.readyState = 3; ws1.onclose?.()`) + `vi.advanceTimersByTime(2001)` to fire the reconnect backoff setTimeout
3. Get ws2 (fresh WS stub); `flipToStreaming(ws2)`
4. Deliver ONLY `{type:"pane_state", state:"dormant"}` on ws2 — NO Signal A re-emit (the race)
5. `typeAndEnter(container, "message-one")` — assert `countPendingBubbles === 1`
6. `typeAndEnter(container, "message-two")` — assert `countPendingBubbles === 2`
7. Assert no failed bubbles (`querySelectorAll("[data-pv-bubble-failed]").length === 0`)
8. `vi.advanceTimersByTime(20001)` — assert BOTH pendings still alive, no failed bubbles
9. Deliver `{type:"message", role:"user", content:"message-one", eventId:"ev-5d-1", line:1}` — assert `countPendingBubbles === 1`, `countConfirmedBubbles === 1`
10. Deliver `{type:"message", role:"user", content:"message-two", eventId:"ev-5d-2", line:2}` — assert `countPendingBubbles === 0`, `countConfirmedBubbles === 2`
11. Final no-failed-bubbles assertion

**No production code changes in this plan's commit.**

## Test Count Delta

Before: 21 tests in `PrettyView.optimistic-bubbles.test.tsx`
After: 22 tests (+1 Test 5d)

Full test run: 22/22 pass — Tests 5, 5b, 5c all still passing (no regressions).

## Evidence Log

- `/tmp/76-03-task1-run.log` — Test 5d solo run: `1 passed | 21 skipped (22)`
- Full suite: `22 passed (22)` — all prior tests unaffected

## D-07 Verification Result

**UPHELD.** Phase 62's multi-send-during-wake claim is now proven, not assumed.

The key question was: "Does Plan 01's unified dormancy signal fix scale to multiple sends?" Answer: YES. When Plan 01 feeds `setDormant(true)` from the `pane_state:dormant` frame on ws2, `dormantRef.current` is correctly `true` at arm time for BOTH sends — not just the first. The FIFO pending-sends array correctly maintains insertion order and the FIFO head-match clears them in order.

## Deviations from Plan

None — plan executed exactly as written. Test 5d was added and passes on Plan 01's HEAD exactly as specified. The acceptance criteria grep patterns that expect fields on the same line (e.g., `type: "message", role: "user", content: "message-one"` on one line) differ from the multiline object literal style used in the test file, but this is a grep format discrepancy only — the actual frames ARE present and the test verifies their behavior.

## Known Stubs

None — this is a test-only plan with no stubs.

## Threat Flags

No new threat surface introduced. Test-only file addition.

## Self-Check: PASSED

- FOUND: `src/ui/features/pretty-view/PrettyView.optimistic-bubbles.test.tsx`
- FOUND: commit `2f9b6cf4` in git log
