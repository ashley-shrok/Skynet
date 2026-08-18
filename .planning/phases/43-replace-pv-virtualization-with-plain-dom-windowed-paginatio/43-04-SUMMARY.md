---
phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio
plan: 04
subsystem: api
tags: [websocket, ssh, backend, tail, historywindow, fetch-older, session-file, phase-43]

# Dependency graph
requires:
  - phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio
    provides: "43-01 tailSessionFile initialLines param; 43-02 resolveEventIdToLine + readSessionFileRange helpers; 43-03 openClaudeSessionSocket({historyWindow}) + FetchOlderPayload + FetchOlderBatchEvent wire types"
provides:
  - "Backend handleFetchOlder handler resolving eventId anchor → line then reading [max(1, anchorLine-count), anchorLine-1] slice"
  - "parseHistoryWindow(req) URL-query-param parser mirroring the JWT-URL fallback pattern"
  - "Connection-scoped historyWindowParsed threaded into both tailSessionFile call sites (rotation + fresh-connect) with backcompat-safe undefined-passthrough"
  - "__handleFetchOlderForTests + __parseHistoryWindowForTests seam exports for direct vitest coverage"
  - "PHASE-43 OBSERVATION CHANNEL START/END anchor comments enabling executable delimiter-anchored byte-diff verification"
affects:
  - 43-05 (frontend runtime helpers — sendFetchOlder + isFetchOlderBatchEvent will consume this backend surface)
  - 43-07a (PrettyView plain-DOM scroller — will call openClaudeSessionSocket({historyWindow}) at connect)
  - 43-07b (PrettyView fetch_older_batch case in onmessage switch — will consume the response frames)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Delimiter-anchored region-diff pattern (anchor comments + awk extract + diff) for surgical-edit byte-preservation verification — survives arbitrary line-number shifts"
    - "Extracted WS handler with dedicated test seam (mirrors handleIdentityCountBounties + handleIdentityGetRoleFile shape)"
    - "URL-query-param handshake parse extracted to standalone helper (parseHistoryWindow) for direct vitest coverage"

key-files:
  created:
    - "src/backend/claude-session/claude-session-server.fetch-older.test.ts — 12 tests locking handleFetchOlder's full decision matrix"
    - "src/backend/claude-session/claude-session-server.history-window.test.ts — 14 tests locking URL parse + tailSessionFile threading + observation fan-out invariant"
  modified:
    - "src/backend/claude-session/claude-session-server.ts — 5 surgical regions (Region A handler + seam, Region B dispatch, Region C URL parse, Region D+D2 tailSessionFile threading × 2 call sites); pre-edit anchor comments wrap onLine handler for byte-preservation verify"

key-decisions:
  - "FETCH_OLDER_MAX_COUNT = 500 cap balances against client working-set-cap start of 150 with 3× headroom while rejecting unbounded requests"
  - "HISTORY_WINDOW_MAX = 5000 mirrors the tailSessionFile 1_000_000 defensive cap with a tighter emission-side ceiling"
  - "handleFetchOlder always emits a response frame (success OR error) so the client loading indicator always clears — never silently drops"
  - "Region B fetch_older branch placed BEFORE aside_arm dispatch (both are per-connection stateful messages; placement is stylistic — dispatch order doesn't matter because msg.type comparisons are mutually exclusive)"
  - "historyWindowParsed threaded into BOTH tailSessionFile call sites (transitionToActiveNew rotation restart AND fresh startActiveSessionFlow) — session rotation replay receives the same emission-window discipline as fresh-connect replay"
  - "Anchor comments PHASE-43 OBSERVATION CHANNEL START/END stay as inert production comments — they enable future phases to verify observation-channel preservation via the same awk+diff pattern without re-establishing the boundary each time"

patterns-established:
  - "Delimiter-anchored byte-diff: awk '/START/,/END/' | diff snapshot for surgical-edit invariant verification. Replaces fragile line-range-based git-diff checks that break as unrelated code shifts around."
  - "Extracted handler + test seam pair (public handleX + underscored __handleXForTests) established as the standard pattern for WS message handlers in claude-session-server.ts"

requirements-completed: []

# Metrics
duration: 15min
completed: 2026-08-18
---

# Phase 43 Plan 04: Backend historyWindow handshake + fetch_older WS handler Summary

**handleFetchOlder handler resolving eventId → line via resolveEventIdToLine + reading via readSessionFileRange, plus historyWindow URL-query-param parse threaded into both tailSessionFile call sites — observation channel byte-preserved via delimiter-anchored awk diff.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-08-18T16:50:33Z
- **Completed:** 2026-08-18T17:06:24Z
- **Tasks:** 2
- **Files modified:** 1 (src/backend/claude-session/claude-session-server.ts)
- **Files created:** 2 (fetch-older.test.ts, history-window.test.ts)

## Accomplishments

- Backend serves the full wire contract described by Plan 43-03's types: client sends `{ anchorEventId, count }`, server does eventId → line resolution + range read + graceful error framing.
- historyWindow URL-query-param handshake landed with connection-scoped variable threaded into both `tailSessionFile()` call sites — session-rotation replay and fresh-connect replay both honor the bound.
- Observation channel proven byte-for-byte unchanged via executable delimiter-anchored awk diff (498-line region, empty diff exit code 0). No parseSessionLine, layer1-detect, context-pct, plan-pending, backgroundedAgents/Shells, dormant-poll, or id-reset branch touched.
- 26 new tests (12 fetch-older + 14 history-window including MED-4 observation fan-out lock) pass; full backend suite 1106/1106 green; both builds exit 0.
- Anchor comments `PHASE-43 OBSERVATION CHANNEL START/END` inserted as inert production markers enabling future phases to run the same byte-verify pattern without re-establishing the boundary.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED — failing specs)** — `4a37a9fe` (test)
2. **Task 2 (GREEN — handler + parse + threading + byte-verify)** — `3583671e` (feat)

_Both new test files landed as one RED commit; the surgical edits and full byte-verify diff landed as one GREEN commit. TDD RED/GREEN gate sequence: 4a37a9fe (test) → 3583671e (feat) verified in `git log --oneline -3`._

## Files Created/Modified

- **src/backend/claude-session/claude-session-server.ts** (modified) — 5 surgical regions plus 2 anchor comments:
  - Import: `resolveEventIdToLine`, `readSessionFileRange` from `./session-file-range.js`
  - Region A (near L717 handleIdentityCountBounties area): `handleFetchOlder` + `__handleFetchOlderForTests` + `parseHistoryWindow` + `__parseHistoryWindowForTests` + `FETCH_OLDER_MAX_COUNT` + `HISTORY_WINDOW_MAX` constants
  - Region B (near L4437 aside_arm dispatch): `if (msg.type === "fetch_older")` branch delegating to `handleFetchOlder`
  - Region C (after JWT auth at L1901): `const historyWindowParsed = parseHistoryWindow(req);` at connection init
  - Region D (transitionToActiveNew rotation restart, ~L3085): `historyWindowParsed` as 5th arg to `tailSessionFile()`
  - Region D2 (startActiveSessionFlow fresh-connect, ~L5492): `historyWindowParsed` as 5th arg to `tailSessionFile()`
  - Anchor comments: `PHASE-43 OBSERVATION CHANNEL START` (before L2014 `const onLine`) and `PHASE-43 OBSERVATION CHANNEL END` (after L2510 `};`)
- **src/backend/claude-session/claude-session-server.fetch-older.test.ts** (created, 300 lines) — 12 tests covering handleFetchOlder's full decision matrix
- **src/backend/claude-session/claude-session-server.history-window.test.ts** (created, 250 lines) — 14 tests covering URL parse boundaries, tailSessionFile threading, and MED-4 observation-fan-out invariant

## Decisions Made

- **Count cap = 500** — Client working-set cap start-point is 150 (per CONTEXT.md § "Working set"); 500 gives 3× headroom for scroll-back-past-cap refetches while rejecting unbounded requests.
- **historyWindow cap = 5000** — Tighter emission-side ceiling than the tailSessionFile 1_000_000 defensive cap; realistic session lengths stay well under this bound.
- **Both tailSessionFile call sites receive the bound** — Rotation replay and fresh-connect replay share the same emission-window discipline. Missing/undefined historyWindow falls through to `-n +1` byte-for-byte (backcompat preserved for legacy `countIdentityBounties` and any wscat smoke-test caller).
- **Anchor comments stay in production** — Inert `//` comments cost nothing at runtime and enable future phases touching claude-session-server.ts to verify observation-channel preservation via the same `awk /START/,/END/ | diff` pattern without re-establishing the boundary.
- **Error frames instead of silent drops** — Every failure path in `handleFetchOlder` emits `{ frames: [], error: <string> }` so the client's loading indicator clears. Error strings match the wire contract in `src/ui/api/claude-session-api.ts` `FetchOlderBatchEvent`.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met on first pass:
- handleFetchOlder occurs 6× (definition + seam export + dispatch call + comment refs) — required ≥3 ✓
- readSessionFileRange occurs 4× (import + call + comments) — required ≥2 ✓
- resolveEventIdToLine occurs 4× (import + call + comments) — required ≥2 ✓
- "fetch_older" string literal occurs 2× (dispatch case guard + response type literal in error paths) — required ≥2 ✓
- historyWindow occurs 10× (helper + calls + comment refs) — required ≥3 ✓
- PHASE-43 OBSERVATION CHANNEL START = 1 exactly ✓
- PHASE-43 OBSERVATION CHANNEL END = 1 exactly ✓
- awk-anchored byte-diff of observation region: empty (exit 0) — the executable proof ✓
- git diff HEAD -- docker/nginx*.conf: empty (nginx untouched, per CLAUDE.md caveat verification) ✓

## Issues Encountered

None. Test-first (TDD) discipline produced clean RED (26/26 fail with `TypeError: __handleFetchOlderForTests is not a function` and companion `__parseHistoryWindowForTests`) → GREEN (26/26 pass) → full backend suite green (441/441 claude-session, 1106/1106 all-backend) → both builds clean on the first Task 2 commit.

The observation-fan-out test (Test 13, MED-4) is asserted at the `parseSessionLine` layer (the choke-point where observation and emission paths diverge — everything downstream of `parseSessionLine` in the onLine body is either observation-branch [before the emission switch] or emission-branch [in the switch]). Feeding 100 lines through parseSessionLine and asserting call count = 100 proves the fan-out invariant precisely: the observation-side derivation cannot be bounded by historyWindow because it fires on every line the tail emits.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Backend fully implements the wire contract described by 43-03's types. A bench WS client could now connect with `?historyWindow=50`, receive up to 50 lines of initial replay, send `{ type: "fetch_older", anchorEventId, count }`, and receive `{ type: "fetch_older_batch", frames, reachedBeginning }` in response.
- Ready for 43-05 (frontend runtime helpers `sendFetchOlder` + `isFetchOlderBatchEvent`) which the plan already noted as the next consumer.
- Ready for 43-07a/b (PrettyView plain-DOM scroller + onmessage switch extension) once the frontend helpers land.
- Observation channel preservation is now an executable invariant — future phases modifying claude-session-server.ts can `awk /PHASE-43 OBSERVATION CHANNEL START/,/PHASE-43 OBSERVATION CHANNEL END/ | diff` against a snapshot to prove they didn't inadvertently touch the observation body.

## Self-Check: PASSED

**Files exist:**
- FOUND: /home/ubuntu/skynet/.planning/phases/43-replace-pv-virtualization-with-plain-dom-windowed-paginatio/43-04-SUMMARY.md
- FOUND: /home/ubuntu/skynet/src/backend/claude-session/claude-session-server.fetch-older.test.ts
- FOUND: /home/ubuntu/skynet/src/backend/claude-session/claude-session-server.history-window.test.ts

**Commits exist:**
- FOUND: 4a37a9fe (test RED)
- FOUND: 3583671e (feat GREEN)

## TDD Gate Compliance

- RED gate: `4a37a9fe test(43-04): add failing specs for handleFetchOlder + historyWindow handshake + observation fan-out` ✓
- GREEN gate: `3583671e feat(43-04): historyWindow handshake + fetch_older WS handler with eventId→line resolution` ✓
- REFACTOR: not needed on this plan (Task 2 GREEN code is clean per test suite + build)

---
*Phase: 43-replace-pv-virtualization-with-plain-dom-windowed-paginatio*
*Completed: 2026-08-18*
