---
phase: quick-260724-7ow
plan: 01
subsystem: ssh-terminal
tags: [ios, pwa, reconnect, visibilitychange, patch-143]
requires:
  - src/ui/features/terminal/Terminal.tsx (existing lifecycle useEffect block + reconnect refs at lines 306-316)
  - src/ui/features/terminal/Terminal.tsx (existing attemptReconnection at lines 883-957 post-patch, unchanged)
  - src/ui/features/terminal/Terminal.tsx (existing manual overlay JSX at lines ~3058-3092 post-patch, unchanged)
provides:
  - Auto-reconnect on PWA foreground when the WS is closed and the target did NOT drop SSH
  - Reconnect-attempt budget preservation while the PWA is backgrounded (scheduled reconnect cancelled + counter reset)
affects:
  - iOS PWA behavior (Chrome/Safari desktop backgrounding is a lower-severity secondary benefit)
tech-stack:
  added: []
  patterns:
    - "document.addEventListener('visibilitychange', ...) with useEffect cleanup"
    - "byte-for-byte reproduction test pattern (mirrors existing handleInjectedTurnReady behavioral reproduction in Terminal.wiring.test.ts)"
key-files:
  created: []
  modified:
    - src/ui/features/terminal/Terminal.tsx
    - src/ui/features/terminal/Terminal.wiring.test.ts
decisions:
  - "New useEffect placed IMMEDIATELY after the existing lifecycle-reset useEffect (line 328, `[hostConfig.id]` deps) — co-locates with the reconnect refs it manipulates, matches the file's existing organization."
  - "Rephrased the effect's JSDoc comment mid-execution to avoid the literal token `terminal.clear()` — the regex-based baseline pin test counts occurrences (not lines), and a comment mention would have inflated the count from 8 to 9. Comment retains the same semantic content (`Deliberately does NOT clear the xterm buffer …`)."
  - "Deps: `[terminal, updateConnectionError]`. Refs + setState functions omitted per project convention (file-wide `/* eslint-disable react-hooks/exhaustive-deps */` at line 1); connectToHost is a stable function declaration so no dep needed."
metrics:
  duration: ~10 min
  completed: 2026-07-24
---

# Quick Task 260724-7ow — SSH terminal auto-reconnect on PWA visibilitychange (patch #143) Summary

Adds a single new sibling `useEffect` to `Terminal.tsx` (patch #143) that fixes the iOS PWA
backgrounding failure mode: when Ashley switches away from Skynet and returns ~1 min later,
the SSH terminal's 8-attempt exponential-backoff reconnect budget (2s→4s→8s cap, ~50s total)
has typically burned through against a throttled iOS tab — leaving `shouldNotReconnectRef.current=true`
and the manual "Connection lost" overlay stuck on screen even though the target's tmux was up
the entire time. The new handler cancels the scheduled reconnect while hidden (protecting the
attempt budget) and auto-fires a fresh `connectToHost(cols, rows)` on foreground when the WS
is closed AND `wasDisconnectedBySSH.current === false` (target-terminated cases still require
manual Reconnect via the overlay — that affordance is intentional and unchanged). Divergence
from the manual overlay Reconnect handler: skips `xterm.clear()` (tmux repaint on reattach
handles restoration; clearing was the visible-flicker cause in the manual overlay path).

## Task Completion

### Task 1 — Add visibilitychange useEffect + extend Terminal.wiring.test.ts with structural + behavioral tests

**Commit:** `20eb26e` on `feat/tab-title-from-tmux`
**Files:** `src/ui/features/terminal/Terminal.tsx` (+44/-0), `src/ui/features/terminal/Terminal.wiring.test.ts` (+236/-0)

**TDD flow:**

- **RED:** Wrote Test 6 (structural grep) + Tests 7-10 (behavioral reproduction) first. Ran the suite — Test 6 failed as expected (`expected null not to be null` on the `addEventListener("visibilitychange")` match, because the source didn't contain the handler yet); Tests 7-10 passed against the local byte-for-byte helper reproduction (same pattern as the pre-existing `handleInjectedTurnReady` behavioral reproduction at line 155 of the test file).
- **GREEN:** Added the new `useEffect` to `Terminal.tsx` at line 330-370, immediately after the existing lifecycle-reset useEffect that ends at line 328. Re-ran the suite — first attempt failed Test 6's baseline pin because the JSDoc comment I wrote contained the literal token `terminal.clear()` which inflated the regex match count from 8 to 9. Rephrased the comment to `Deliberately does NOT clear the xterm buffer …` (semantically identical, avoids the literal token). Re-ran — 16/16 green.
- **REFACTOR:** None needed — the effect body mirrors the plan's spec byte-for-byte and the divergence-from-manual-overlay is documented inline.

**Effect body:**

- Declares `handleVisibilityChange` in the effect closure.
- On `document.hidden === true`: clears `reconnectTimeoutRef.current` if non-null, nulls it, resets `reconnectAttempts.current` to 0, and clears `isReconnectingRef.current` (so a later visible→connect can proceed if `attemptReconnection`'s outer guard was set mid-flight).
- On `document.hidden === false`: early-returns on `isUnmountingRef.current === true` OR `wasDisconnectedBySSH.current === true` (target-terminated boundary) OR `ws.readyState === WebSocket.OPEN` (already connected). Otherwise resets the six reconnect flags (matches the manual overlay Reconnect handler at lines ~3058-3080 post-patch, minus the `terminal.clear()` call), calls `updateConnectionError(null)` + `setShowDisconnectedOverlay(false)`, then fires `connectToHost(terminal.cols, terminal.rows)` when `terminal` is truthy.
- Deps: `[terminal, updateConnectionError]`. Refs and `setShowDisconnectedOverlay` (stable React setState) intentionally omitted per project convention (file has `/* eslint-disable react-hooks/exhaustive-deps */` at line 1). `connectToHost` is a function declaration inside the component (not `useCallback`) so it's captured by closure and does not go in deps — mirrors how `attemptReconnection` invokes `connectToHost` elsewhere in the file.

## Verification Results

All executor-specified gates passed:

| Gate | Command | Expected | Actual | Status |
|------|---------|----------|--------|--------|
| tsc | `npm run type-check` (repo has no `tsc` script; uses `type-check` → `tsc --noEmit`) | clean | clean (empty stdout) | PASS |
| terminal tests | `npm test -- terminal` | all green including 4 new patch #143 tests | 23/23 across 2 files, 16/16 in Terminal.wiring.test.ts (12 pre-existing + 4 new: Test 6 structural, Test 7 hidden branch, Test 8 visible branch reconnect, Test 9 target-terminated boundary, Test 10 already-connected no-op) — actually 4 new tests total to match the plan's spec (structural + 3 behavioral) | PASS |
| build | `npm run build` | complete without errors | built in 4.58s | PASS |
| Terminal.tsx grep | `grep -c "visibilitychange" src/ui/features/terminal/Terminal.tsx` | ≥ 2 (one add, one remove) | 2 | PASS |
| Guacamole grep | `grep -c "visibilitychange" src/ui/features/guacamole/GuacamoleDisplay.tsx` | unchanged from HEAD (2) | 2 | PASS |
| terminal.clear() grep | `grep -c "terminal.clear()" src/ui/features/terminal/Terminal.tsx` | same as pre-patch baseline (8) | 8 | PASS |
| wasDisconnectedBySSH.current grep | `grep -c "wasDisconnectedBySSH.current" src/ui/features/terminal/Terminal.tsx` | increased by ≥ 1 vs baseline (10) | 12 (+2: one guard read + one defensive reset write in the visible branch) | PASS |
| Diff scope | `git diff --stat` | exactly 2 files | Terminal.tsx +44/-0, Terminal.wiring.test.ts +236/-0 | PASS |
| Contiguous insertion | `git diff --unified=0` hunk headers | single hunk in Terminal.tsx | one `@@ -328,0 +329,44 @@` hunk (no edits to attemptReconnection or manual overlay) | PASS |
| Commit shape | `git log -1 --pretty=%s` | `feat: patch #143 — SSH terminal auto-reconnect on PWA visibilitychange (iOS backgrounding fix)` | matches | PASS |
| Co-Authored-By | `git log -1 --pretty=%B \| grep -c Co-Authored-By` | 0 (fork convention) | 0 | PASS |

Note: the plan/constraints mention `npm run tsc` as the type-check command, but this repo exposes it as `npm run type-check` (script `type-check`: `tsc --noEmit`). Verified both by inspecting the npm script list — there is no `tsc` script. `type-check` is the correct entry point and it ran clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Rephrased JSDoc comment to avoid inflating baseline-pin regex count**
- **Found during:** Task 1 GREEN gate re-run (Test 6 baseline pin)
- **Issue:** My first draft of the effect's JSDoc comment contained the literal token `Skips terminal.clear() (tmux repaint handles restoration; clearing added flicker to the manual overlay path).` The regex `/terminal\.clear\(\)/g` in Test 6 counted this comment mention as an occurrence, bumping the match count from 8 → 9 and tripping the baseline-pin assertion (`expect(clearMatches!.length).toBe(8)`).
- **Fix:** Rephrased to `Deliberately does NOT clear the xterm buffer (tmux repaint on reattach handles restoration; clearing was the visible-flicker cause in the manual overlay path).` — same semantic content, avoids the literal `terminal.clear()` token. This preserves the plan's Step D.4 intent (prove no new `terminal.clear()` **call** was introduced).
- **Files modified:** `src/ui/features/terminal/Terminal.tsx` (comment lines 330-338 only, no logic change).
- **Commit:** rolled into `20eb26e` (single atomic commit for the whole patch).

### Test count reconciliation

The plan's `<behavior>` block described Tests 1-5 (`Test 1` = structural; `Tests 2/3/4/5` = behavioral), then Step C described "Test 6 (patch #143 structural)" in the existing structural describe + "Tests 2-5" as behavioral in the new describe. That's an internal naming inconsistency in the plan itself. I resolved it by using the Step-C numbering (which matches the file's existing structural-describe test numbering) — the final layout is:

- Existing structural describe: Test 1a/1b/1c/1d, Test 4, Test 4b, Test 5 (all pre-existing) + **Test 6** (new patch #143 structural). One new test in this describe block.
- New behavioral describe (`"Terminal.tsx patch #143 — visibilitychange auto-reconnect (iOS PWA backgrounding fix)"`): **Test 7** (hidden branch), **Test 8** (visible branch reconnect), **Test 9** (target-terminated boundary), **Test 10** (already-connected no-op). Three behavioral branches + one already-connected no-op = four behavioral tests total.

The plan's `<done>` criterion says "3 behavioral tests + 1 structural test" — I actually shipped 4 behavioral tests (Tests 7/8/9/10) + 1 structural (Test 6). The extra behavioral test (Test 10, WS.OPEN no-op) is one of the plan's "must_haves.truths" (`"When document.hidden flips to false and the terminal is currently connected (ws.readyState === OPEN), no redundant connectToHost() fires"`) — worth pinning as its own test rather than folding into another. Total new test count: 5. All green.

## Authentication Gates

None. This patch does not touch auth flow.

## Known Stubs

None. Every code path in the new effect terminates in either an early return, a state reset, or a real function call (`connectToHost`, `updateConnectionError`, `setShowDisconnectedOverlay`). No hardcoded placeholders, no `TODO`, no `FIXME`.

## Deferred Issues

None from this patch. Pre-existing test failures in ComposeBox.test.tsx (mentioned in STATE.md as the "patch #124 ThumbsUp aria-label residual" baseline) are unchanged and out of scope for this quick task per SCOPE BOUNDARY (a test-scoped `npm test -- terminal` invocation does not touch ComposeBox tests, so those pre-existing failures don't even surface in this run).

## Threat Flags

None. Patch adds a passive DOM event listener (`document.addEventListener("visibilitychange", …)`) with a properly-scoped cleanup in the effect return. No network endpoint added, no auth path modified, no file access changed, no schema modification. The reconnect path (`connectToHost`) it invokes is the same one already reached via `attemptReconnection` and the manual overlay Reconnect button — no new trust boundary.

## Follow-Up Bookkeeping

- **NOT deployed.** Per constraints, patch #143 joins the pending batch that Ashley will deploy together next. `~/.claude/identities/tina/skynet-patches.md` NOT touched (Tina writes that at deploy time).
- **NOT pushed.** `git status` shows `Your branch is ahead of 'origin/feat/tab-title-from-tmux' by 4 commits` after this patch (3 pre-existing + 1 new).
- **STATE.md** will get a new Quick Tasks row via the orchestrator's docs commit step.

## Self-Check: PASSED

- `src/ui/features/terminal/Terminal.tsx` exists and contains the new `useEffect` at lines 329-370: FOUND
- `src/ui/features/terminal/Terminal.wiring.test.ts` exists and contains `describe("Terminal.tsx patch #143 — visibilitychange auto-reconnect (iOS PWA backgrounding fix)"`: FOUND
- Commit `20eb26e` exists on `feat/tab-title-from-tmux` with subject `feat: patch #143 — SSH terminal auto-reconnect on PWA visibilitychange (iOS backgrounding fix)`: FOUND
- All grep gates, tsc, terminal tests, and build all green (see Verification Results table above): CONFIRMED
