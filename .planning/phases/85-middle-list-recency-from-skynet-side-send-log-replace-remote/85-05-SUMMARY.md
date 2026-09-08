---
phase: 79-middle-list-recency-from-skynet-side-send-log-replace-remote
plan: 05
subsystem: backend/database/routes

tags: [sessions-list, source-swap, lastMessageAt, send-log, D-07, D-08, initial-seed, fail-open, test-only-export]

# Dependency graph
requires:
  - phase: 79
    plan: 02
    provides: getIdentityLastSend(identityName): Promise<number | null> — identity-name-keyed fail-open reader (single-seam contract for all Phase 85 read consumers)
  - phase: 79
    plan: 04
    provides: ssh-poll-orchestrator source-swap pattern + __scanTailForNewestMessageAtForTests test-only export convention (mirrored here for the sessions.ts byte-parallel copy)
  - phase: 43
    plan: 01
    provides: byte-parallel isAshleyRealUserTurn + scanTailForNewestMessageAt copies in sessions.ts (D-08 discipline; both stay defined after this swap)
  - phase: 47
    plan: 02
    provides: scanTailForLatestAiTitle in sessions.ts (co-tenant on the tail buffer; stays called by the aiTitleBlock after the D-07 swap)

provides:
  - /sessions/list per-row TmuxSessionRow.lastMessageAt sources from getIdentityLastSend(row.sessionName) instead of scanTailForNewestMessageAt(tailRaw)
  - sendLogLookupBlock — a NEW third parallel per-row block in the Promise.all alongside roleResolveBlock + aiTitleBlock (renamed from recencySignalsBlock to reflect its narrowed scope)
  - __scanTailForNewestMessageAtForTests test-only export in sessions.ts — preserves the byte-level regression coverage of the retired scanner (D-08 byte-parallel copy still asserted at the predicate-matrix level)
  - Structured debug log per row per request with operation="sessions_list_last_message_at_from_store" (hostId + sessionName + lookupResult) — forensic trace for post-deploy verification
  - Belt-and-suspenders try/catch around getIdentityLastSend with operation="sessions_list_send_log_lookup_failed" fail-open log (the store module is already fail-open per Phase 85-02; the try/catch is on the per-row hot path)
  - 5 new Phase 85 test cases covering: cold-cache null, store-populated hit, aiTitle unaffected by swap, SSH tail timeout does NOT regress row.lastMessageAt, store throw fail-open

affects:
  - phase-85-06 (frontend send-time HTTP POST + client-side optimistic advance): once 85-06 lands, both the WS-live orchestrator frame (85-04) AND the initial page-load seed (this plan) will source lastMessageAt from the same store. No more ~2s flicker window on first paint.
  - src/backend/fleet-status/ssh-poll-orchestrator.ts (85-04 sibling): unchanged by this plan; the __scanTailForNewestMessageAtForTests parallel-export in both files keeps the byte-parallel copy discipline alive on both sides.

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three-block per-row Promise.all in /sessions/list: roleResolveBlock (SSH frontmatter read), sendLogLookupBlock (DB-local store read, INDEPENDENT of SSH), aiTitleBlock (JSONL tail scan wrapped in PER_HOST_TIMEOUT_MS race). Independence of the store lookup from the SSH pathway means a slow tail-scan or Promise.race timeout can never regress row.lastMessageAt."
    - "D-08 preservation via test-only export __scanTailForNewestMessageAtForTests — mirrors the Phase 85-04 convention on ssh-poll-orchestrator; decouples the retired scanner's regression coverage from the retired route observable while keeping the predicate contract asserted at the byte level."
    - "recencySignalsBlock → aiTitleBlock rename in-file. Log operation tag PRESERVED as `sessions_list_recency_signals_skip` for backward-compat with post-deploy log-tailing dashboards (semantic scope has narrowed to the aiTitle axis only; docblock notes the rationale)."

key-files:
  created: []
  modified:
    - src/backend/database/routes/sessions.ts (+130 lines / -47 lines) — new getIdentityLastSend import block (10 lines with D-07 header comment); expanded docblock above scanTailForNewestMessageAt with the D-08 preservation note (~13 lines); new __scanTailForNewestMessageAtForTests test-only export (17 lines); refactored per-row Promise.all block from two to three parallel branches (sendLogLookupBlock added, aiTitleBlock narrowed from the old recencySignalsBlock inner IIFE — no more `lastMessageAt` field in the return shape, no more `row.lastMessageAt = null` in the catch path).
    - src/backend/database/routes/sessions.test.ts (+280 lines / -47 lines) — new vi.mock for identity-send-log-store (10 lines); new mockedGetIdentityLastSend handle; beforeEach re-establishes null default post-vi.clearAllMocks; imported __scanTailForNewestMessageAtForTests alongside router; predicate-matrix helpers (scanSingleLine + scanMultiLine) retargeted to call the test-only export directly (~20 lines swapped in for ~55 lines removed); Test 1 "happy path" and Test 5 "message-bearing filter" in the "lastMessageAt derivation" describe block reframed to expect null (their mocks don't populate the store, and the JSONL-tail derivation has retired); new "GET /sessions/list — lastMessageAt from send-log store (Phase 85 Plan 05)" describe block with 5 it() cases + local test bodies at the tail of the file.

key-decisions:
  - "Wrap the store lookup in a dedicated third parallel block (`sendLogLookupBlock`) instead of hoisting it as the first `await` before Promise.all. Reasons: (1) preserves per-row concurrency — the store lookup runs alongside roleResolveBlock and aiTitleBlock rather than serializing before them; (2) makes the failure-isolation boundary explicit and symmetric with the other two blocks (each block owns its own try/catch); (3) reads cleanly next to the aiTitleBlock docblock note that lastMessageAt is INDEPENDENT of the SSH pathway."
  - "Renamed inner IIFE binding from `recencySignalsBlock` to `aiTitleBlock` in-source to reflect the narrowed scope (lastMessageAt has retired from this block). But KEPT the log operation tag as `sessions_list_recency_signals_skip` for backward-compat with any post-deploy log-tailing dashboards that grep this string. Docblock notes the semantic scope has narrowed. Same pattern the plan's action step allowed (`pick one and document`)."
  - "The plan's action step said `for each row, call row.lastMessageAt = await getIdentityLastSend(row.sessionName) — do this BEFORE the SSH pathway (before resolveHostById, before connectOneShot)`. Practically impossible — `rows` (session records) don't EXIST until AFTER tmux list-sessions runs via SSH. Interpreted contextually: the store lookup happens per-row-once-rows-exist, INDEPENDENT of the downstream SSH tail-scan pathway. Result matches the plan's `even hosts that are unreachable via SSH still yield rows with a valid lastMessageAt from the store` intent for the case where SSH succeeds far enough to list sessions but fails on the tail-scan (Test 85-05-04 explicitly covers this scenario)."
  - "Kept __scanTailForNewestMessageAtForTests as an ASYNC-wrapped helper in the predicate-matrix suite (async function scanSingleLine that just returns the sync result). The test bodies (Cases 1-10 + Mixed-tail integration) all use `await scanSingleLine(...)` — preserving the async signature avoids editing 11 test bodies for a signature change. Zero coverage loss."
  - "Log level for the per-row store lookup is `debug` (not `info`) — /sessions/list is called on every AppShell page-load and every navigation; the log fires per-row per-request. `debug` keeps it out of default log output but available for post-deploy forensic tailing per the plan's cross-cutting verification block. Mirrors the Phase 85-04 log-level decision (identical rationale for the WS-live poll)."
  - "In Test 1 & Test 5 of the pre-existing `lastMessageAt derivation` describe block (L475+ and L696+), the mocked SSH tail returns real message-bearing JSONL that would have driven row.lastMessageAt to specific timestamps via the retired scanner. Since Task 1's swap severed the tail→lastMessageAt link, these assertions were reframed to expect `null` (the mocked store is untouched → default null). Alternative was to overhaul the test setup to also stamp the mocked store, but that would double-cover ground the new Phase 85 describe block already covers cleanly (Test 85-05-02). Preferred the smaller diff + explicit narrative note in each test."

patterns-established:
  - "D-08 preservation via test-only export in both byte-parallel copies: (1) __scanTailForNewestMessageAtForTests in ssh-poll-orchestrator.ts (Phase 85-04); (2) __scanTailForNewestMessageAtForTests in sessions.ts (Phase 85-05, this plan). Any future scanner mutation must land at both sites AND both test-only exports so the byte-parallel invariant is caught at the byte level in both regression suites."
  - "Three-parallel-block per-row Promise.all pattern for /sessions/list (roleResolveBlock + sendLogLookupBlock + aiTitleBlock). Any future additional per-row derivation should follow the same shape: independent try/catch per block, dedicated log operation tag per skip path, and INDEPENDENT of any block that runs a Promise.race timeout so a slow SSH exec cannot regress an already-derived field."

requirements-completed: [D-07, D-08]

# Metrics
duration: 14m 59s
completed: 2026-09-07
---

# Phase 85 Plan 05: /sessions/list lastMessageAt source swap Summary

**Per-row `TmuxSessionRow.lastMessageAt` derivation in `/sessions/list` swapped from `scanTailForNewestMessageAt(tailRaw)` (JSONL tail scan on Ashley's-real-user-turn predicate) to `getIdentityLastSend(row.sessionName)` (Phase 85-02 identity-name-keyed send-log store). This is the initial-seed path AppShell reads on page-load to feed `seedSessionLastMessageAt` in the frontend working store — sibling swap to Plan 85-04's WS-live orchestrator frame. Both sources of truth now converge from the moment the page paints (no ~2s flicker window on first load). The byte-parallel copies of `scanTailForNewestMessageAt` + `isAshleyRealUserTurn` STAY DEFINED per D-08 discipline, with regression coverage preserved via a new `__scanTailForNewestMessageAtForTests` test-only export mirroring the Phase 85-04 convention on ssh-poll-orchestrator. `scanTailForLatestAiTitle` continues to consume the same tail buffer as the sole tail consumer in the new `aiTitleBlock` (Phase 47 axis unchanged).**

## Performance

- **Duration:** 14m 59s (899s)
- **Started:** 2026-09-07T17:36:40Z
- **Completed:** 2026-09-07T17:51:39Z
- **Tasks:** 2 (both TDD-flagged per plan)
- **Files modified:** 2 (`sessions.ts`, `sessions.test.ts`)
- **Files created:** 0 (SUMMARY.md counted separately in Task Commits section below)

## Accomplishments

### Source swap (Task 1)

- **`getIdentityLastSend` import** at the top of `sessions.ts` from `../../fleet-status/identity-send-log-store.js` (10 lines with D-07 rationale header explaining the initial-seed path + flicker-avoidance intent).
- **Three-block per-row Promise.all** replaces the two-block prior:
  - `roleResolveBlock` — unchanged (SSH frontmatter read wrapped in Promise.race(PER_HOST_TIMEOUT_MS)).
  - `sendLogLookupBlock` (NEW) — awaits `getIdentityLastSend(row.sessionName)`, wraps in try/catch, sets `row.lastMessageAt` on success, leaves null on throw. INDEPENDENT of the SSH pathway.
  - `aiTitleBlock` (renamed from `recencySignalsBlock`, narrowed) — JSONL tail scan for the ai-title axis only. Return shape narrowed to `{ aiTitle: string | null }`; the `lastMessageAt` field is REMOVED from the inner IIFE. Catch block no longer touches `row.lastMessageAt` (it's already set by the sendLogLookupBlock).
- **Retired `scanTailForNewestMessageAt(tailRaw)` call** from the inner IIFE. `scanTailForLatestAiTitle(tailRaw)` stays as the sole tail consumer in this block (aiTitle axis unchanged per D-08).
- **D-08 preservation docblock** added above the `scanTailForNewestMessageAt` function definition (L148) noting the byte-parallel copy contract with ssh-poll-orchestrator + the fact that `isAshleyRealUserTurn` is treated the same way.
- **`__scanTailForNewestMessageAtForTests` test-only export** (17 lines) mirroring the Phase 85-04 convention on ssh-poll-orchestrator.ts. Preserves byte-level regression coverage of the retired scanner without going through the route observable.

### Test suite (Task 2)

- **`vi.mock("../../fleet-status/identity-send-log-store.js", ...)`** factory at the top of `sessions.test.ts` (hoisted, no closure over test-scope state). Default returns `null` from `getIdentityLastSend`. Individual tests override with `mockImplementation` / `mockResolvedValue`.
- **`mockedGetIdentityLastSend` handle** exposed for per-test overrides.
- **beforeEach re-establishes the null default** post-`vi.clearAllMocks()` so per-test overrides don't leak.
- **5 new `it()` blocks** in a new `describe("GET /sessions/list — lastMessageAt from send-log store (Phase 85 Plan 05)")` block at the tail of the file:
  - **85-05-01** — cold cache (store returns null for every identity) → every row lastMessageAt:null. Confirms getIdentityLastSend is called per row for every session in the tmux list-sessions output.
  - **85-05-02** — stamp of `ivy → 9000` → row for identity `ivy` returns `lastMessageAt: 9000`; sibling identities (unstamped) return null. Confirms the store value flows through to the response.
  - **85-05-03** — aiTitle unaffected: store returns 8500 for tanya AND the tail carries an ai-title line — both signals populate independently. Confirms the D-08 aiTitle axis is untouched by the swap.
  - **85-05-04** — SSH tail timeout independence: discovery hangs → aiTitleBlock Promise.race trips → row.aiTitle is null BUT row.lastMessageAt still holds the store value (7777). This is the critical assertion: pre-D-07 the recency-signals catch wiped both signals to null; post-D-07 the sendLogLookupBlock is independent and cannot be regressed.
  - **85-05-05** — store throw fail-open: getIdentityLastSend throws for `ivy` → ivy's row.lastMessageAt is null (fail-open in try/catch); siblings unaffected (lulabelle gets 4200 from the store).

### Test regression handling (Rule 3 auto-fix, inline with Task 1)

Six pre-existing tests failed after the Task 1 swap because they asserted `row.lastMessageAt` values derived from the (now retired) JSONL tail scanner:

- **Predicate-matrix suite (5 tests):** `scanSingleLine` and `scanMultiLine` helpers retargeted to call `__scanTailForNewestMessageAtForTests` directly. Cases 1 (KEEP typed prose), Case 2 (KEEP slash-command), 2026-08-29 positive regression, and Mixed-tail integration all re-green. Zero coverage loss — the predicate contract is asserted at the byte level (identical to the pre-swap observable-based assertions).
- **Integration suite (2 tests):** Test 1 "happy path" in the `lastMessageAt derivation` describe block (L475+) and Test 5 "message-bearing filter" (L696+) reframed to expect null on `lastMessageAt` (their mocks don't populate the store; the JSONL tail no longer drives that field). Explicit narrative note added to each test citing the Phase 85 (D-07) rationale and pointing readers to the new Phase 85 describe block for store-lookup coverage.

## Grep-Gated Contract Checks

| Grep target | Expected | Actual | Status |
|---|---|---|---|
| `getIdentityLastSend` in sessions.ts | >= 2 | 4 | ✓ (import + call + 2 log-op refs) |
| `scanTailForNewestMessageAt(tailRaw)` in sessions.ts | 0 | 0 | ✓ (call retired) |
| `^function scanTailForNewestMessageAt` in sessions.ts | 1 | 1 | ✓ (definition preserved per D-08) |
| `scanTailForLatestAiTitle(tailRaw)` in sessions.ts | 1 | 1 | ✓ (aiTitle unchanged) |
| `^function isAshleyRealUserTurn` in sessions.ts | 1 | 1 | ✓ (definition preserved per D-08) |
| `__scanTailForNewestMessageAtForTests` in sessions.ts | 1 (export) + 1 (definition) | 2 | ✓ (test-only export added) |
| `Phase 85` in sessions.test.ts | >= 1 | 11 | ✓ |

## Task Commits

Each task was committed atomically on `feat/tab-title-from-tmux`:

1. **Task 1: Swap /sessions/list per-row lastMessageAt derivation** — `a41496fc` (feat) — 2 files changed, 175 insertions(+), 107 deletions(-). Includes the test-regression fixes as Rule 3 auto-fix (the fixes are inseparable from the swap; the failures are direct consequences of Task 1's source change and belong in the same commit for `git bisect` cleanliness).
2. **Task 2: /sessions/list send-log store round-trip — 5 new cases** — `f1d0f5a7` (test) — 1 file changed, 275 insertions(+). Adds `vi.mock` for the store, imports the mocked `getIdentityLastSend`, and appends the 5 new Phase 85 test cases at the tail of the file.

_TDD flow note:_ Plan authored Task 1 (module change) before Task 2 (new tests) — same "shape-first, tests-validate-contract" ordering as Plans 85-01, 85-02, 85-04. The Task 1 commit's own scoped test run (30/30 green after the regression fixes) already validates the swap semantically via the pre-existing test suite; Task 2's 5 new cases add explicit round-trip coverage against the mocked store.

## Files Created/Modified

- `src/backend/database/routes/sessions.ts` (modified) — +130 lines / -47 lines net. Key edits:
  - L15-25: `getIdentityLastSend` import with D-07 header comment.
  - L148-181: expanded docblock above `scanTailForNewestMessageAt` with the D-08 preservation note.
  - L183-201: new `__scanTailForNewestMessageAtForTests` test-only export.
  - L317-461 (was 313-430): refactored per-row Promise.all block — sendLogLookupBlock added, aiTitleBlock narrowed from the old recencySignalsBlock inner IIFE.
- `src/backend/database/routes/sessions.test.ts` (modified) — +280 lines / -47 lines net. Key edits:
  - L75-83: new `vi.mock("../../fleet-status/identity-send-log-store.js", ...)` factory block.
  - L128-130: new `import { getIdentityLastSend }` after the store `vi.mock`; new `mockedGetIdentityLastSend` handle.
  - L281-284: new beforeEach null default re-establishment.
  - L268: `__scanTailForNewestMessageAtForTests` imported alongside router.
  - L537-546 (was 523-530): Test 1 "happy path" in `lastMessageAt derivation` reframed to expect null with Phase 85 rationale note.
  - L753-762 (was 743-748): Test 5 "message-bearing filter" reframed similarly.
  - L807-833 (was 796-849): scanSingleLine + scanMultiLine helpers retargeted to call the test-only export directly (~20 lines swapped in for ~55 lines removed).
  - L1481-1740 (appended): new `describe("GET /sessions/list — lastMessageAt from send-log store (Phase 85 Plan 05)")` block with 5 `it()` cases + inline test bodies.

## Decisions Made

None beyond the ones already locked in the plan / CONTEXT.md / above key-decisions block. Executor followed plan-authored action bodies with the plan's contextual guidance (the plan explicitly allowed picking a naming convention: "rename to `sessions_list_ai_title_skip` — pick one and document"; kept the historical `sessions_list_recency_signals_skip` tag for backward-compat with post-deploy log-tailing dashboards).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing test regressions from the source swap fixed inline with Task 1**

- **Found during:** Task 1 verification (`npx vitest run src/backend/database/routes/sessions.test.ts` after the swap landed).
- **Issue:** 6 pre-existing tests failed after the swap because they asserted `row.lastMessageAt` values derived from the (now retired) JSONL tail scanner. Plan's Task 2 done-block requires "Any existing sessions.test.ts test cases remain green" — a hard requirement.
- **Fix:** Added a test-only export `__scanTailForNewestMessageAtForTests` in `sessions.ts` (mirrors the Phase 85-04 pattern on `ssh-poll-orchestrator.ts`), retargeted the predicate-matrix helpers (scanSingleLine + scanMultiLine) to call it directly, and reframed Tests 1 & 5 in the `lastMessageAt derivation` describe block to expect null (their mocks don't populate the store). Zero coverage loss — the D-08 predicate contract is asserted at the byte level (stronger than the pre-swap observable-based assertions).
- **Files modified:** `src/backend/database/routes/sessions.ts` (+17 lines for the test-only export + ~13 lines expanded docblock), `src/backend/database/routes/sessions.test.ts` (~-55/+20 net for the helper rewrites + ~-13/+18 for the two reframed integration tests).
- **Commit:** `a41496fc` (committed as part of Task 1 since the failures are direct-caused by Task 1's swap and cannot be separated cleanly).

### Deferred (out-of-scope pre-existing issues)

**Pre-existing backend TS errors NOT introduced by this plan** — unchanged since Plan 85-01's SUMMARY logged them:

- `src/backend/database/routes/host.ts(473,15)` — TS2322 Type 'unknown' not assignable to 'string'
- `src/backend/database/routes/host.ts(1182,17)` — TS2322 Type 'unknown' not assignable to 'string'
- `src/backend/database/routes/pretty-view-fetch-host-file.ts(440,56)` — TS2345 Argument type 'string | string[]' not assignable to 'string'

Zero errors in the two files touched by this plan. Verified via `npm run build:backend 2>&1 | grep -E "sessions\.ts|sessions\.test\.ts"` → no hits. Already logged to `deferred-items.md` by Plan 85-01; no new entries added.

**Untracked artifact NOT touched by this plan** — `""/"` directory (literally a directory whose name is two escaped double-quotes then a slash) exists in the repo root as reported by `git status` at plan start. Not created by this plan, not related to Phase 85, and outside the plan's file scope. Left untouched per the scope-boundary rule.

**Unrelated modified file NOT touched by this plan** — `src/ui/features/pretty-view/PrettyView.tsx` was already modified at plan start (per `git status --short`). Not related to Phase 85 (frontend file; this plan only touches backend `sessions.ts` + its test). Left untouched — the two commits made by this plan (`a41496fc`, `f1d0f5a7`) stage only the two Phase 85 files.

---

**Total deviations:** 1 auto-fixed (Rule 3 — inline test-regression handling).
**Impact on plan:** Zero coverage loss — the D-08 predicate contract is asserted at the byte level, stronger than the pre-swap observable-based assertions. Test count improved: 30 → 35 (+5 net for the Phase 85 suite; the 6 rewritten tests are 1:1 replacements).

## Issues Encountered

**1. Plan's action step "for each row, call row.lastMessageAt = await getIdentityLastSend(row.sessionName) — do this BEFORE the SSH pathway (before resolveHostById, before connectOneShot)" is impossible as literally written.**

`rows` (session records) are constructed FROM the tmux list-sessions SSH exec output (L288-301 pre-swap). They don't exist until after that exec succeeds. Interpreted the plan's intent contextually: the store lookup happens per-row-once-rows-exist, INDEPENDENT of the downstream aiTitle tail-scan pathway. Test 85-05-04 explicitly covers the case the plan's overshoot statement gestured at (aiTitle SSH timeout does NOT regress row.lastMessageAt because the sendLogLookupBlock ran independently).

**2. Plan's Task 2 done-block "no regressions to existing tests" contradicts Task 1's inherent test breakage.**

Same class of issue Plan 85-04 hit (documented in its `## Issues Encountered`). Task 1's swap changes the source-of-truth for row.lastMessageAt — existing tests that asserted specific values derived from the OLD source-of-truth necessarily fail. Interpreted pragmatically as Rule 3 auto-fix scope: the test failures are direct consequences of Task 1's authored change, and fixing them is inseparable from the swap. Committed both under Task 1 (`a41496fc`) so a `git bisect` on a future regression would see a green tree at the Task 1 commit boundary.

**3. Plan's Task 1 verify command specifies `npx vitest run --related` which is unsupported in vitest 4.1.8.**

Same issue Plans 85-01, 85-02, 85-04 hit. Substituted the direct-path form `npx vitest run src/backend/database/routes/sessions.test.ts` — the module under test is covered by exactly one test file, so the direct form gives the same signal.

## User Setup Required

None. The swap is purely an in-process source-of-truth swap for an existing wire field. On the next `npm run start:backend` / container recreate, the /sessions/list route starts reading from the `identity_send_log` table Plan 85-01 already created. On first boot (no backfill per D-09) the table is empty → every identity's `row.lastMessageAt` is `null` → middle-zone falls through to insertion-order fallback until natural fill populates via the Plan 85-06 frontend send hook.

## Next Phase Readiness

- **Phase 85 Plan 06** (frontend send-time HTTP POST to `/api/stamp-identity-send` + client-side optimistic advance): the READ side of the initial-seed round-trip is now live. Once Plan 85-06 fires the write on send, the round-trip closes end-to-end for BOTH read paths: (1) WS-live orchestrator frame (Plan 85-04) reads store on next poll tick; (2) initial page-load `/sessions/list` (this plan) reads store on page-load. Both converge from the same source of truth → no flicker on first paint.
- **Ship blockers:** none from this plan. The 3 pre-existing tsc errors are unchanged and out of scope (Plan 85-01 already logged them to `deferred-items.md`).
- **Executor exit posture:** two atomic commits (`a41496fc`, `f1d0f5a7`) on `feat/tab-title-from-tmux`, NOT pushed / NOT docker-built / NOT deployed — held at the executor's remit boundary. Orchestrator owns pull + full-suite + push + build + recreate + verify + coord per fleet directive.

## Self-Check

### Created files exist

- `/home/ubuntu/skynet-tiffany/.planning/phases/85-middle-list-recency-from-skynet-side-send-log-replace-remote/85-05-SUMMARY.md` — FOUND (this file)

### Modified files contain the expected additions (grep gates from plan Task 1/2 done-blocks)

- `grep -c "getIdentityLastSend" src/backend/database/routes/sessions.ts` = 4 ✓ (>= 2 required — import + call + 2 log-op refs)
- `grep -c "scanTailForNewestMessageAt(tailRaw)" src/backend/database/routes/sessions.ts` = 0 ✓ (== 0 required — call removed)
- `grep -c "^function scanTailForNewestMessageAt" src/backend/database/routes/sessions.ts` = 1 ✓ (== 1 required — definition preserved per D-08)
- `grep -c "^function isAshleyRealUserTurn" src/backend/database/routes/sessions.ts` = 1 ✓ (== 1 required — definition preserved per D-08)
- `grep -c "scanTailForLatestAiTitle(tailRaw)" src/backend/database/routes/sessions.ts` = 1 ✓ (== 1 required — aiTitle scan preserved)
- `grep -c "__scanTailForNewestMessageAtForTests" src/backend/database/routes/sessions.ts` = 2 ✓ (test-only export added; definition + name in docblock)
- `grep -c "Phase 85" src/backend/database/routes/sessions.test.ts` = 11 ✓ (>= 1 required per Task 2 done-block)

### Commits exist on branch feat/tab-title-from-tmux

- `a41496fc feat(85-05): swap /sessions/list lastMessageAt derivation to send-log store (D-07)` — FOUND
- `f1d0f5a7 test(85-05): /sessions/list send-log store round-trip — 5 new cases` — FOUND

### Scoped tests green

- `npx vitest run src/backend/database/routes/sessions.test.ts` = 35/35 pass, exit 0 (was 30/30 pre-swap; +5 net for the Phase 85 suite).

### Backend build clean (only pre-existing unrelated tsc errors)

- `npm run build:backend` exit code non-zero due to 3 pre-existing errors in `host.ts` (473,15 + 1182,17) and `pretty-view-fetch-host-file.ts` (440,56) — unchanged and unrelated to this plan. Zero errors in `sessions.ts` or `sessions.test.ts`.

## Self-Check: PASSED

---

*Phase: 79-middle-list-recency-from-skynet-side-send-log-replace-remote*
*Plan: 05*
*Completed: 2026-09-07*
