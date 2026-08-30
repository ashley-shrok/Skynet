---
phase: quick-260822-7no
plan: 01
subsystem: pretty-view / claude-session-server
tags:
  - phase-47-followup
  - pretty-view
  - load-more
  - refill-loop
  - observability
  - v2-policy
requirements:
  - QUICK-260822-7NO-01  # backend refill loop replaces v1 no-refill policy
  - QUICK-260822-7NO-02  # structured logs on the full click → WS → response path
dependency-graph:
  requires:
    - phase-47 (fetch_older_range wire contract, reshapeParsedLineToWireFrame,
      readSessionFileRange, PrettyView load-more state machine)
    - phase-50 (sessionIdFromFile threading through the parser)
  provides:
    - handleFetchOlderRange v2 refill loop (backend)
    - [fetch-older-range] req/slice/emit structured logs (backend)
    - [pv-load-more] click/response-ok/response-error console.info logs (frontend)
  affects:
    - src/backend/claude-session/claude-session-server.ts (refill loop + logs)
    - src/ui/features/pretty-view/PrettyView.tsx (2 console.info sites)
tech-stack:
  added: []
  patterns:
    - accumulator.unshift() prepend to preserve chronological oldest-first order
    - slice(-20) to keep the NEWEST 20 items (closest to the client's cursor)
    - outer-scoped `let logPreLen/logPostLen` populated inside setMessages(prev=>…)
      callback so log reflects actual state transition rather than stale closure
key-files:
  created: []
  modified:
    - src/backend/claude-session/claude-session-server.ts
    - src/backend/claude-session/claude-session-server.fetch-older-range.test.ts
    - src/ui/features/pretty-view/PrettyView.tsx
key-decisions:
  - "oldestLine = messages[0].line (not lastStartLine): client's next click
    seeks to a REAL surviving message, not the top of the batch's read window.
    Prevents the client from re-issuing a request that immediately lands in a
    stretch of skip lines the reader would re-scan."
  - "slice(-20) not slice(0,20): the accumulator is chronological oldest-first
    after each prepend; we want the NEWEST 20 frames (closest to the client's
    cursor) so the client's [...batch, ...prev] prepend is contiguous with what
    it already has."
  - "Mid-loop reader failure surfaces as an error frame (same shape as the
    FIRST read failure at L1592) — no partial success emit."
  - "Backend uses databaseLogger.info() matching the existing [ws-server] tag
    style; frontend uses console.info() matching Ashley's other browser-side
    diagnostic tags (grep-able from the console-forward transport dump)."
metrics:
  duration: ~15 min
  completed: 2026-08-22
---

# Quick 260822-7no: Load-more button refill to 20 bubbles + observability

## One-liner

Replace v1 no-refill partial-batch policy in `handleFetchOlderRange` with a
refill loop that reads OLDER 20-line slices until the accumulator holds ≥20
non-skip wire frames or the read cursor hits startLine=1; add structured
`[fetch-older-range]` (backend) and `[pv-load-more]` (frontend) logs across
the entire click → WS → response path.

## Background

Sally's session file is 88% skip lines (579/657 raw lines classify as
`kind:"skip"`: harness_wrapper, meta, no_message, empty_content, unknown-type,
etc.). Under v1, a single load-more click issued ONE `readSessionFileRange(20)`
call and emitted only the surviving non-skip frames from that window. On skip-
heavy JSONL this returned 0–4 messages even though 20 non-skip messages
existed further back in the file. Symptom: "button flashes → nothing appears
(sometimes)". Diagnosing this cost an hour of live tracing on 2026-08-22 because
there were zero structured logs on the click → WS → response path.

## What changed

### Task 1 — backend refill loop + tests (commits bc4c0f9f + 4cbdddbe)

**File:** `src/backend/claude-session/claude-session-server.ts` (handler at L1477).

**RED (bc4c0f9f):** Rewrote Test 8 for v2 semantics (17 msgs + 3 skips first
batch → refill reads next 20-line batch → accumulator hits 37 → slice(-20)
yields lines 98..120 with two skips at 109/116 removed). Added Test 9 (all-skip
file refills startLines 81→61→41→21→1 → messages=[], oldestLine=1,
hasMore=false, reader called 5x), Test 10 (partial file: beforeLine=25
refills to startLine=1 with rangeCount=4 → 20 messages spanning lines 2..24
minus skips, hasMore=true), and Test 11 (20 non-skip in first slice → no
refill, reader called exactly 1x — guards against the "always keep refilling"
regression). Tests 1–7 unchanged; under v1 code Tests 8/9/10 failed as
expected.

**GREEN (4cbdddbe):** Replaced the L1596–1636 parse-reshape-emit block with:

1. Iteration 1 reuses the FIRST `readSessionFileRange` result (unchanged).
2. `while (accumulator.length < 20 && currentBefore > 1)` loop:
   - Compute `nextStartLine = Math.max(1, currentBefore - 20)` and
     `nextRangeCount = Math.min(20, currentBefore - 1)`.
   - `readSessionFileRange(...)` with try/catch → mid-loop failure emits
     error frame and returns.
   - `accumulator.unshift(...survivors)` (prepend, keeps chronological
     oldest-first).
   - Update `lastStartLine`, `currentBefore`, `refillIterations`.
3. `messages = accumulator.slice(-20)` (newest 20, contiguous with the
   client's cursor).
4. `oldestLine = messages[0].line ?? lastStartLine` (fallback for all-skip
   case).
5. `hasMore = oldestLine > 1`.
6. Structured logs at three sites (see next section).

All 11 tests in `claude-session-server.fetch-older-range.test.ts` pass.
Scoped vitest across 15 related test files: **190 passed / 1 skipped**.
`npm run build:backend`: green.

### Task 2 — frontend `[pv-load-more]` instrumentation (commit c5ce8b6f)

**File:** `src/ui/features/pretty-view/PrettyView.tsx`.

Pure instrumentation — no behavior change, no new state, no render output
change.

- **Site A** (L779, `handleLoadOlder`): `console.info` fires AFTER the three
  defense-in-depth guards and BEFORE `ws.send`. Reads `messagesLenRef.current`
  (defined L1144) rather than closing over `messages` — the callback's deps
  are `[oldestLoadedLine]` and adding `messages` to deps would recreate the
  callback on every incoming message frame (unacceptable perf cost).
- **Site B** (L1717 error branch + L1753 success branch, `fetch_older_range_batch`
  case): captures `logPreLen`/`logPostLen` inside the `setMessages(prev => …)`
  callback via outer-scoped `let` bindings — React setters invoke the callback
  synchronously and 5 pre-existing sites in this file rely on the same
  behavior. Error-branch preLen/postLen collapse to `messagesLenRef.current`
  since no setMessages runs on error.

Scoped vitest for PrettyView + 17 related test files: **369 passed / 9
skipped / 1 todo**. `npm run build`: green (frontend + backend tsc).

## Structured logs added

**Backend** (`databaseLogger.info` on the `[ws-server]` tag family):

- `[fetch-older-range] req beforeLine=<n> count=<n>` — once per request,
  after validation + trust-boundary gates but before ANY I/O (including
  the rangeCount≤0 empty-success early return).
- `[fetch-older-range] slice startLine=<n> rawLines=<n> nonSkip=<n> total=<n>` —
  once per reader iteration (iteration 1 + each refill).
- `[fetch-older-range] emit oldestLine=<n> messagesLen=<n> hasMore=<b> refillIterations=<n>` —
  once per request, immediately before the final `ws.send`.

**Frontend** (`console.info` on the `[pv-load-more]` tag family; captured by
the console-forward transport):

- `[pv-load-more] click beforeLine=<n> currentMessagesLen=<n> sessionHasMore=<b> sessionTotalLines=<n>` —
  fires exactly once per click.
- `[pv-load-more] response ok=false messagesLen=0 oldestLine=<n> hasMore=<b> error="<str>" preLen=<n> postLen=<n>` —
  error branch of the response case.
- `[pv-load-more] response ok=true messagesLen=<n> oldestLine=<n> hasMore=<b> error=undefined preLen=<n> postLen=<n>` —
  success branch, captured inside setMessages so preLen/postLen reflect
  the actual state transition.

Grep sanity checks all pass:
```
grep -c "no refill" src/backend/claude-session/claude-session-server.ts           → 0
grep -c "\[fetch-older-range\]" src/backend/claude-session/claude-session-server.ts → 5 (3 log sites: req + slice x2 + emit + 1 comment)
grep -c "\[pv-load-more\]" src/ui/features/pretty-view/PrettyView.tsx            → 5 (3 log sites + 2 comments)
grep -c "refillIterations" src/backend/claude-session/claude-session-server.ts    → 4 (decl + increment + emit-log + comment ref)
grep -c "quick-260822-7no" src/backend/claude-session/claude-session-server.fetch-older-range.test.ts → 5 (Tests 8/9/10/11 + header)
```
Note: the plan's expected `[fetch-older-range]` count of "3" undercounted the
literal source occurrences — there are 3 UNIQUE log tags (req/slice/emit) but
`slice` appears at 2 source sites (iteration 1 and refill loop) so `grep -c`
returns 5. The runtime behavior matches the plan intent exactly: for a
request that requires zero refills, the request produces exactly 3 log lines
(req, slice, emit); for one that refills N times, it produces N+2 log lines
(req, slice × (N+1), emit).

## Scope guardrails (unchanged)

```
git diff --stat src/backend/claude-session/session-file-range-reader.ts       → empty
git diff --stat src/backend/claude-session/session-file-parser.ts             → empty
git diff --stat src/ui/features/pretty-view/LoadMoreOlderButton.tsx           → empty
git diff --stat src/ui/features/pretty-view/PrettyView.load-more.test.tsx     → empty
```

## Deviations from plan

- **oldestLine arithmetic in Test 8:** the plan text said `oldestLine === 84`
  but the actual accumulator math yields `oldestLine === 98`. The plan
  explicitly instructed to double-check the arithmetic ("DOUBLE-CHECK the
  arithmetic when writing the fixture — precompute the accumulator and use
  the actual computed value for oldestLine") and I did — Batch 2 (lines
  81..100, 20 items at positions 0..19) + Batch 1 survivors (17 items at
  positions 20..36) = 37 items. `slice(-20)` takes positions 17..36 →
  position 17 = line 98 (81+17). Test 8 asserts `oldestLine === 98` and
  passes.

- **Grep expected count for `[fetch-older-range]`:** plan expected 3, actual
  is 5. Explanation: the `slice` log fires at 2 source sites (iteration 1
  block and refill loop body) since iteration 1 reuses the FIRST read
  outside the loop. Plus 1 comment reference. The 3 UNIQUE log kinds
  (req/slice/emit) are all present as documented.

## Sally's session file — expected outcome (per plan)

Plan's Python-sim numbers: click 1 previously returned 3 bubbles (v1);
under v2 the refill loop should return 20. Executor did not run the backend
against Sally's live JSONL — deferred to tina's post-deploy verification
via a live click on `term.gigaashley.click` with browser devtools console
open, filtering for `[pv-load-more]` and `[fetch-older-range]`.

## Tests added / rewritten

- Test 8 (rewritten): `"Test 8: skip frames inside range → refill loop reads
  next slice until accumulator holds 20 non-skip frames (v2 refill policy
  — quick-260822-7no)"`
- Test 9 (new): `"Test 9: all-skip file → refill until startLine=1, emit
  empty success (quick-260822-7no)"`
- Test 10 (new): `"Test 10: partial refill halts at top-of-file with fewer
  than 20 messages (quick-260822-7no)"`
- Test 11 (new): `"Test 11: 20 non-skip lines in FIRST slice → no refill,
  exactly one reader call (quick-260822-7no)"`

Tina can grep for `quick-260822-7no` to locate all four post-ship.

## Commits (executor-authored)

- `bc4c0f9f` — test(quick-260822-7no): rewrite Test 8 + add Tests 9-11 for
  v2 refill-until-20-or-top (RED — asserts against v1 code as expected)
- `4cbdddbe` — feat(quick-260822-7no): refill loop for handleFetchOlderRange
  (v2 policy) (GREEN — all 11 tests pass)
- `c5ce8b6f` — feat(quick-260822-7no): [pv-load-more] click + response
  instrumentation (pure logging, no behavior change)

## Executor's green gate results

```
npx vitest run src/backend/claude-session/claude-session-server.fetch-older-range.test.ts
  → 11 passed
npx vitest related --run src/backend/claude-session/claude-session-server.ts src/backend/claude-session/session-file-range-reader.ts
  → 190 passed / 1 skipped across 15 files
npx vitest related --run src/ui/features/pretty-view/PrettyView.tsx
  → 369 passed / 9 skipped / 1 todo across 18 files
npm run build:backend  → green
npm run build          → green (frontend built, exit 0)
```

## Handoff to tina

- Files touched (all committed):
  - `src/backend/claude-session/claude-session-server.ts` (+106/-22)
  - `src/backend/claude-session/claude-session-server.fetch-older-range.test.ts` (+198/-24)
  - `src/ui/features/pretty-view/PrettyView.tsx` (+39/-0)
- Deploy motion pending (not run by executor per fleet rule Ashley 2026-08-08).
- Post-deploy verification: click load-more on Sally's session at
  `term.gigaashley.click`, filter browser devtools console for
  `[pv-load-more]` and `[fetch-older-range]`. Expected sequence:
  1 `req`, N `slice` (N ≥ 1, ≤ ~30 for the 657-line file), 1 `emit`, then
  1 `[pv-load-more] response ok=true …` with `messagesLen=20`. Sally's file
  should hit the top before running out of history (should see `hasMore=false`
  after ~30 clicks total).

## TDD Gate Compliance

- RED commit `bc4c0f9f`: 3 failing tests (Test 8/9/10), confirmed by
  vitest run against v1 implementation before the GREEN commit.
- GREEN commit `4cbdddbe`: refill loop implementation; all 11 tests pass.
- No REFACTOR commit (implementation was clean-first-time).

## Self-Check: PASSED
- `src/backend/claude-session/claude-session-server.ts` — FOUND (modified, refill loop present)
- `src/backend/claude-session/claude-session-server.fetch-older-range.test.ts` — FOUND (Tests 8/9/10/11 present)
- `src/ui/features/pretty-view/PrettyView.tsx` — FOUND (3 log sites present)
- Commit `bc4c0f9f` — FOUND
- Commit `4cbdddbe` — FOUND
- Commit `c5ce8b6f` — FOUND
