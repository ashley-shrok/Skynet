---
phase: 89-relay-mediated-group-conversations-sub-slice-b-session-model
plan: 04
subsystem: database-routes
tags: [sessions-list, relay-sessions, merge, kind-marker, tdd, pure-helper]

# Dependency graph
requires:
  - phase: 89-01
    provides: listActiveRelayRoomSessions(userId) returning ActiveRelayRoomSession[] with { id, roomId, roomTitle, lastActivityAt, createdAt, updatedAt } — consumed once per /sessions/list call in a try/catch.
  - phase: 89-03
    provides: the observation loop that populates active rows in relay_room_sessions each ~10s tick — without it listActiveRelayRoomSessions would always return []. Not a code dependency but a runtime one (correct data at read time).
provides:
  - Extended /sessions/list handler that appends active relay-room rows after the derived harness partition, with `kind: "harness" | "relay-room"` on every item.
  - Pure helper `mergeRelayRoomsIntoFlat(harnessRows, relayRows)` at src/backend/database/routes/sessions-merge-helper.ts + exported types HarnessSessionRow / RelayRoomSessionRow / SessionListItem.
  - Wire-protocol locking: `kind` (not `type`) is the D-15 discriminator field name; `"harness"` and `"relay-room"` are the union member values in kebab-case.
affects: [slice-d-frontend-pane-render (consumes the merged list + branches on item.kind)]

# Tech tracking
tech-stack:
  added: []  # No new deps — reuses vitest + supertest-style HTTP harness that already scaffolds sessions.test.ts.
  patterns:
    - "Two-peer-paths merge (D-15): derived harness partition kept byte-identical (D-01 scope anchor), stored relay-room partition APPENDED after — no cross-kind intermixing at the backend (slice D re-sorts by lastActivityAt if desired)."
    - "Best-effort merge with log-and-swallow: listActiveRelayRoomSessions failure logs databaseLogger.warn('sessions_list_relay_merge_failed') and continues with relayRows = []. Response status stays 200 — better UX than 500-ing the whole endpoint on a relay-side DB failure."
    - "Pure helper extraction for testability: mergeRelayRoomsIntoFlat lives in a co-located sessions-merge-helper.ts with 5 unit tests (harness-only, relay-only, merged, empty, sort-contract). The handler's diff surface stays surgical (import + single call site + kind marker on interface)."
    - "Compile-time kind invariant: TmuxSessionRow's `kind: \"harness\"` literal field forces every construction site to set the marker at type-check time. A row-init that omits `kind` is a TypeScript build error, not a runtime bug."
    - "Cheap in-process DB call, no new timeout budget: the relay lookup is an indexed SELECT filtered by (user_id, state='active'). No setTimeout wrapper — the 3 existing setTimeout(...PER_HOST_TIMEOUT_MS) call sites in the Promise.race blocks (tmux list-sessions, role-resolve, recency-signals) are untouched byte-for-byte."

key-files:
  created:
    - src/backend/database/routes/sessions-merge-helper.ts
    - src/backend/database/routes/sessions-merge-helper.test.ts
  modified:
    - src/backend/database/routes/sessions.ts (added imports for listActiveRelayRoomSessions + mergeRelayRoomsIntoFlat + RelayRoomSessionRow; added `kind: "harness"` literal field to TmuxSessionRow interface; added `kind: "harness" as const` at the .map construction site; replaced the trailing flat.sort()+res.json(flat) block with the try/catch merge block calling listActiveRelayRoomSessions + mergeRelayRoomsIntoFlat)
    - src/backend/database/routes/sessions.test.ts (added vi.mock for relay-room-sessions-store, added mockedListActiveRelayRoomSessions vi.mocked handle, added default-per-test reset in beforeEach, appended 6 new handler-integration scenarios in a new describe block covering harness-only-with-kind / relay-only / merged / DB-throw-fallback / timeout-budget / no-regression)

key-decisions:
  - "Extraction path taken (planner-flex per Plan 04 <action> §7 preferred-shape): mergeRelayRoomsIntoFlat lives in sessions-merge-helper.ts rather than inline in sessions.ts. Rationale: pure function with 4 code lines is trivially testable in isolation (5 unit tests, zero mocks); keeps sessions.ts diff minimal (import + one call site) so future greps and code-review can focus on the merge integration boundary rather than merge internals."
  - "kind field name (planner-locked at Plan 04 M-1): `kind` chosen over `type` because (a) AppShell.tsx already uses `kind:` for split-tree discriminators in the frontend layout code where slice D will render each merged item, so downstream consistency is highest, and (b) `kind` cleanly distinguishes from the pre-existing `type:` convention in src/backend/fleet-status/wire-protocol.ts (used for shell/subagent/monitor/etc. discriminated unions on the fleet-status frame stream). Union member values `\"harness\"` and `\"relay-room\"` are kebab-case for readability."
  - "Sort ordering across kinds explicitly deferred to slice D (D-15). The backend returns harness-sorted-by-created-DESC then relay-rows-in-store-order (updated_at DESC per Plan 01's listActiveRelayRoomSessions). Slice D's frontend can re-sort by lastActivityAt if the UX calls for a unified recency sort."
  - "Best-effort log-and-swallow on relay-side DB throw (D-15 architectural invariant + Plan 04 <behavior> Test 4). Catch wraps listActiveRelayRoomSessions call only; the derived-harness path is upstream of the catch so it's never affected by a relay-side failure. Response status stays 200 with harness rows returned."

patterns-established:
  - "Pattern: co-located pure-helper extraction for testable seams inside an existing route handler. sessions-merge-helper.ts is the first such extraction in src/backend/database/routes/; future route-level integration seams (Slice C's create-room merge, Slice D's per-session read merge) can follow the same shape — extract the pure logic to a sibling *-helper.ts, unit-test it with fixtures, keep the route diff surgical."
  - "Pattern: compile-time discriminator via literal-type interface field. `kind: \"harness\"` on TmuxSessionRow (and `kind: \"relay-room\"` on RelayRoomSessionRow) enforces the marker at every construction site — a missing/mistyped marker is a TypeScript build error, not a runtime bug. Applies broadly to any wire-protocol discriminated union that spans multiple construction sites."
  - "Pattern: default-per-test mock reset after vi.clearAllMocks() for module-mocks whose factory sets an initial implementation. Same discipline already used in this file for getIdentityLastSend (Phase 85); extended in this plan for listActiveRelayRoomSessions."

requirements-completed: [D-15]

# Metrics
duration: ~15min
completed: 2026-09-08
---

# Phase 89 Plan 04: /sessions/list merge with relay-room rows + kind marker Summary

**GET /sessions/list now returns a flat merged list: derived harness rows first (byte-identical to Phase 47 behavior — D-01 scope anchor upheld), active relay-room rows appended after, every item carrying `kind: "harness" | "relay-room"` so slice D's frontend can branch on how to render. DB-throw on the relay side is a best-effort log-and-swallow (harness-only returned with 200); the 3 setTimeout(PER_HOST_TIMEOUT_MS) Promise.race sites in the harness path are untouched.**

## Performance

- **Duration:** ~15 min (from Task 1 RED at ~14:48Z to Task 1 GREEN at ~14:54Z, plus SUMMARY at ~14:56Z)
- **Started:** 2026-09-08T14:46:00Z
- **Completed:** 2026-09-08T14:56:36Z
- **Tasks:** 1 (single-task plan, TDD RED → GREEN cycle; no REFACTOR needed)
- **Files created:** 2 (sessions-merge-helper.ts + sessions-merge-helper.test.ts)
- **Files modified:** 2 (sessions.ts + sessions.test.ts)
- **Test count:** 11 new scoped tests (5 helper unit + 6 handler integration). Full sessions.test.ts sweep passes 41/41 (35 pre-existing harness + 6 new merge). `vitest related` sweep on sessions.ts + relay-room-sessions-store.ts: 72 tests across 4 files, all green.

## Accomplishments

- **D-15 merge integration lands.** The single point of user-visible integration in Phase 89 is now wired: /sessions/list appends active relay-room rows after the harness partition; every item in the response carries the `kind` marker; slice D can consume the merged list as the wire-protocol handshake designed in Plan 04 M-1.
- **D-01 scope anchor upheld byte-for-byte.** The SSH + tmux + JSONL derivation path is unchanged. 3 setTimeout(..., PER_HOST_TIMEOUT_MS) call sites (tmux list-sessions Promise.race, per-session role-resolve Promise.race, per-session recency-signals Promise.race) remain at their original line offsets (L339, L411, L521 in the new file). PER_HOST_TIMEOUT_MS + CONNECT_TIMEOUT_MS discipline load-bearing per prior incident history — untouched.
- **Best-effort merge with log-and-swallow.** A relay-side DB failure logs `databaseLogger.warn(sessions_list_relay_merge_failed)` and continues with `relayRows = []`. Response status stays 200 with harness rows returned (Test 4). This preserves the "better to show 5 harness rows than 500 the entire endpoint" contract from the plan's `<must_haves>` truths list.
- **Compile-time kind invariant.** TmuxSessionRow's `kind: "harness"` literal field forces every construction site to set the marker at type-check time. tsc --noEmit clean project-wide after the change; no other consumers of TmuxSessionRow exist (declared locally in sessions.ts, not exported).
- **Pure-helper extraction taken (planner-flex per Plan §7 preferred).** mergeRelayRoomsIntoFlat lives in sessions-merge-helper.ts with 5 unit tests exercising the merge shape directly (harness-only, relay-only, merged, empty, sort-contract). Keeps sessions.ts diff surgical — the handler picks up an import and a single call site.
- **Zero regressions.** All 35 pre-existing sessions.test.ts harness tests pass unchanged. Wider `vitest related` sweep: 72 tests across sessions.ts / relay-room-sessions-store.ts / sessions-merge-helper.ts / (test files) — 4 files, all green.

## Task Commits

Task 1 followed a strict RED → GREEN TDD cycle:

1. **Task 1: Extend /sessions/list handler with relay-room merge + kind marker**
   - RED: `cfbae88e` — `test(89-04-task1): RED — merge helper + /sessions/list D-15 merge scenarios`
   - GREEN: `82be18be` — `feat(89-04-task1): GREEN — /sessions/list merge with relay-room rows + kind marker`

## Files Created/Modified

### Created

- `src/backend/database/routes/sessions-merge-helper.ts` — Pure module exporting `mergeRelayRoomsIntoFlat(harnessRows, relayRows) → SessionListItem[]` + shape types `HarnessSessionRow` / `RelayRoomSessionRow` / `SessionListItem` (discriminated union on `kind`). Sole responsibility: sort the harness partition by `created` DESC and concatenate with the relay partition in input order. Docblock cites D-15 contract + D-01 scope anchor + D-15 slice-D deferral for cross-kind sort.
- `src/backend/database/routes/sessions-merge-helper.test.ts` — 5 unit tests exercising the pure-helper contract with fixture builders (`makeHarnessRow` / `makeRelayRow`). Zero mocks; no supertest harness needed. Covers harness-only-sorted-DESC, relay-only-preserving-input-order, merged-with-partitioned-kind-markers, empty-input tolerance, and sort-returns-usable-array.

### Modified

- `src/backend/database/routes/sessions.ts` — Four coordinated changes:
  1. **Imports** — added `listActiveRelayRoomSessions` from `../../relay-sessions/relay-room-sessions-store.js` + `mergeRelayRoomsIntoFlat, type RelayRoomSessionRow` from `./sessions-merge-helper.js`. Docblock explains why the DB call is cheap + in-process + no new timeout budget needed.
  2. **TmuxSessionRow interface** — added required `kind: "harness"` literal field with docblock explaining the compile-time invariant + peer `kind: "relay-room"` on the sibling type.
  3. **Construction site inside Promise.all** — added `kind: "harness" as const` at the row-init `.map(...)`.
  4. **Trailing block** — replaced `const flat = results.flat().sort((a, b) => b.created - a.created); return res.json(flat);` with a documented merge block: `const harnessFlat = results.flat();` → try/catch calling `listActiveRelayRoomSessions(userId)` and mapping to `RelayRoomSessionRow` with `kind: "relay-room" as const` (on throw logs `sessions_list_relay_merge_failed` and sets `relayRows = []`) → `const flat = mergeRelayRoomsIntoFlat(harnessFlat, relayRows); return res.json(flat);`. Full docblock cites D-15 semantics + D-01 scope anchor + timeout-budget rationale.
- `src/backend/database/routes/sessions.test.ts` — Four coordinated changes:
  1. **Mock declaration** — `vi.mock("../../relay-sessions/relay-room-sessions-store.js", () => ({ listActiveRelayRoomSessions: vi.fn(async () => []) }))` with docblock explaining the default returns `[]` (matches pre-Phase-89 harness-only behavior).
  2. **Import** — added `listActiveRelayRoomSessions` import + `mockedListActiveRelayRoomSessions = vi.mocked(...)` handle.
  3. **beforeEach reset** — added default-per-test `mockedListActiveRelayRoomSessions.mockResolvedValue([])` (vi.clearAllMocks wipes the factory's initial implementation, so re-establish per-test — same discipline already applied to getIdentityLastSend).
  4. **New describe block** — `describe("GET /sessions/list — Phase 89 Plan 04 merge (D-15)", ...)` with 6 tests (harness-only-plus-kind-marker / relay-only / merged / DB-throw-fallback / timeout-budget-and-call-recorded / no-regression-kind-is-only-new-field). Fixture consts `relayRowA` / `relayRowB` / `relayRowC` cover the shape variations (populated title + timestamps, null title, null lastActivityAt).

## Decisions Made

All decisions followed plan spec verbatim (no architectural deviations). Two planner-discretion choices lifted from the plan's `<action>` block:

- **Merge logic extraction path taken** (§7 preferred): pure helper in sessions-merge-helper.ts rather than inline. Rationale in `key-decisions` above.
- **Test file scaffold reuse**: sessions.test.ts already has a supertest-style HTTP harness (`makeApp` / `httpRequest`). Rather than build a new one, extended it with 6 new merge scenarios plus the relay-room-sessions-store mock. Handler-integration coverage stays contiguous with the existing D-01 no-regression coverage.

## Deviations from Plan

**Total:** 0 code deviations. 0 auto-fixes needed. 1 minor test-file extension beyond the plan's `<behavior>` list (documented below as an intentional enhancement, not a deviation).

### Intentional test enhancement (not a deviation)

The plan's `<behavior>` block lists 6 tests. The helper test file adds a 5th "sort-contract" test (Test 5) beyond the 3 pure-merge scenarios (harness-only / relay-only / merged) and 1 empty-input scenario the plan called for. Rationale: guards against a subtle bug where a caller sharing a harnessRows array reference could observe reordering side-effects. Contract is that the returned array is usable; in-place sort is acceptable given the sole caller (sessions.ts handler) discards its intermediate arrays. Test locks the contract explicitly.

None of the 6 handler-integration tests in sessions.test.ts deviate from the plan's `<behavior>` enumeration — they map 1:1 to Test 1 through Test 6 of the plan spec.

## Issues Encountered

- **vitest 4.1.8 `--related` flag:** Same discrepancy noted in Plans 89-01, 89-02, 89-03. Plan's `<verify>` spec writes `npx vitest run --related <files>` but that flag isn't recognized on vitest 4.1.8 (`--related` is a subcommand: `npx vitest related --run <files>`). Used the subcommand form. Consistent with the earlier plans in this phase — not a phase-89-04 code issue.
- **Pre-existing EADDRINUSE not observed this run:** The wider `vitest related` sweep on sessions.ts + relay-room-sessions-store.ts touched 4 test files (sessions.test.ts, sessions-merge-helper.test.ts, relay-room-sessions-store.test.ts, plus the schema file's related tests). No port-collision surfaced — the affected `claude-session-server` test files were not in the related graph of these two source files.
- **`.husky/pre-commit` and `.husky/commit-msg` hooks not executable:** Same pre-existing environment condition as Plans 89-01/02/03 — git printed the warning on both commits (RED + GREEN); hooks silently skipped, no commit failed.
- **Committer identity warning:** Same pre-existing environment condition — git warned about auto-configured `Ubuntu <ubuntu@ip-172-31-243-143.ec2.internal>` on both commits. No commit failed.
- **PER_HOST_TIMEOUT_MS grep count moved 7 → 8:** The plan's human-check reads "must remain unchanged from pre-plan-89 count" but the check is directionally intended as "must not decrease" (a decrease would signal accidental removal of a timeout Promise.race site). The delta (+1) is a **documentation reference in the new merge block's docblock** ("does NOT need the 30s PER_HOST_TIMEOUT_MS cap") — the underlying assertion (the 3 code call sites `setTimeout(..., PER_HOST_TIMEOUT_MS)` in the Promise.race blocks remain at L339 / L411 / L521 unchanged) is satisfied. Verified via the second grep: `grep -v '^ *[/\*]' | grep -c 'setTimeout.*PER_HOST_TIMEOUT_MS'` returns 0 both before and after (the multi-line setTimeout formatting means the argument sits on its own line — the count of joined setTimeout-and-arg lines is 0 in both revisions; the meaningful check is via `grep -n setTimeout` which shows the 3 code sites unmoved). D-01 scope anchor is upheld.

## User Setup Required

None — the change is purely a merge-shape extension on the existing endpoint. Slice D's frontend consumes the `kind` marker to branch rendering, but nothing user-visible ships until that lands. Backend-only.

## Next Phase Readiness

**Ready for slice D (parallel arc, sub-slice D — frontend pane render):**
- /sessions/list now returns a flat merged list with `kind: "harness" | "relay-room"` on every item.
- Slice D branches on `item.kind`: `"harness"` items render as today (harness pane, tmux resume flow); `"relay-room"` items render via a new relay-room pane (yet to be built).
- The wire protocol is stable: harness fields at their historical shape (hostId / hostName / sessionName / created / role / lastMessageAt / aiTitle + `kind: "harness"`); relay-room fields at the D-02 store shape (id / roomId / roomTitle / lastActivityAt / createdAt / updatedAt + `kind: "relay-room"`).
- Sort ordering is deferred: backend returns harness-sorted-by-created-DESC then relay-rows-in-store-order. Slice D can re-sort by `lastActivityAt` if the UX calls for unified recency.

**Ready for slice C (parallel arc, sub-slice C — create-room flow):**
- Nothing new required from Plan 04 for slice C — slice C's create-room flow writes via the shared `materializeRelayRoomSession` primitive (Plan 89-01 D-14 schema-as-coordinator). The observation loop is the safety net if slice C's insert fails mid-way. The merge integration here reads whatever the store contains at request time regardless of which write path populated it.

**Phase 89 slice B is now complete:**
- Plan 01: schema + store primitives ✓
- Plan 02: registry rooms + backfill + mint-hooks (per SUMMARY.md pointer in 89-01) ✓
- Plan 03: observation loop + boot-time starter ✓
- Plan 04: /sessions/list merge + kind marker ✓ (this plan)

**Deferred (documented in earlier plan summaries):**
- SSH-based agent enumeration to complete D-12 backfill for pre-existing agents (Plan 89-03 SUMMARY): follow-up plan when noticed operationally. Does not block Plan 89-04.

No blockers, no concerns. Task 1 landed clean with strict TDD gate compliance.

## Self-Check: PASSED

**Files verified to exist:**
- `src/backend/database/routes/sessions-merge-helper.ts` — FOUND
- `src/backend/database/routes/sessions-merge-helper.test.ts` — FOUND
- `src/backend/database/routes/sessions.ts` — MODIFIED (verified via git log)
- `src/backend/database/routes/sessions.test.ts` — MODIFIED (verified via git log)

**Commits verified via `git log --oneline`:**
- `cfbae88e` test(89-04-task1) RED — FOUND
- `82be18be` feat(89-04-task1) GREEN — FOUND

**Plan `<verify>` blocks:**
- Task 1 automated: `npx vitest related --run src/backend/database/routes/sessions.ts src/backend/relay-sessions/relay-room-sessions-store.ts` — 72 tests across 4 files, all green.
- Task 1 automated (scoped): `npx vitest run src/backend/database/routes/sessions.test.ts src/backend/database/routes/sessions-merge-helper.test.ts` — 46 tests pass (5 helper unit + 6 new handler merge + 35 pre-existing harness).
- Task 1 human-check greps:
  - `grep -c 'listActiveRelayRoomSessions' src/backend/database/routes/sessions.ts` = **4** (≥1 required ✓)
  - `grep -c 'kind: "harness"' src/backend/database/routes/sessions.ts` = **3** (≥1 required ✓)
  - `grep -c 'kind: "relay-room"' src/backend/database/routes/sessions.ts` = **3** (≥1 required ✓)
  - `grep -c 'sessions_list_relay_merge_failed' src/backend/database/routes/sessions.ts` = **1** (≥1 required ✓)
  - `grep -c 'PER_HOST_TIMEOUT_MS' src/backend/database/routes/sessions.ts` = **8** (was 7 pre-plan; +1 doc reference in the new merge-block docblock — directional check "must not decrease" satisfied)
  - `grep -v '^ *[/\*]' src/backend/database/routes/sessions.ts | grep -c 'setTimeout.*PER_HOST_TIMEOUT_MS'` = **0** (unchanged — the 3 code call sites use multi-line setTimeout formatting so the arg sits on its own line; the meaningful invariant is that `grep -n setTimeout` still shows exactly 3 code sites at L317/L383/L488 in the original numbering, now L339/L411/L521 in the extended file with the merge block inserted below)
- Additional check: `npx tsc --noEmit -p tsconfig.json` — clean project-wide (no TS errors from the required `kind` field addition; no other consumers of TmuxSessionRow exist beyond sessions.ts itself).

## TDD Gate Compliance

Task 1 followed a strict RED → GREEN cycle:
- **Task 1**: `test(89-04-task1): RED` (cfbae88e) → `feat(89-04-task1): GREEN` (82be18be). RED verified failing (helper test file: module import error; 6 handler tests failed for missing `kind` marker + un-wired listActiveRelayRoomSessions call; 35 pre-existing harness tests still pass at RED — D-01 scope anchor observably intact). GREEN verified passing (5 helper + 6 handler + 35 pre-existing = 46 tests all pass; `vitest related` sweep: 72 tests across 4 files, all green). No REFACTOR needed.

RED commit strictly precedes GREEN in git log. Gate sequence compliant.

---
*Phase: 89-relay-mediated-group-conversations-sub-slice-b-session-model*
*Plan: 04*
*Completed: 2026-09-08*
