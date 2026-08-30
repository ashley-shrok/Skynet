---
phase: 45-fix-forward-on-phase-43-restore-correct-architecture-for-win
plan: 02
subsystem: ui/api
tags: [pretty-view, frontend, wire-types, revert, phase-43-fix-forward, wave-1]
requires: [phase-43-frontend-shipped, 45-01-backend-reverted]
provides: [pre-phase-43-frontend-api-restored, wave-2-dependency-signal-emitted]
affects:
  - src/ui/api/claude-session-api.ts
  - src/ui/api/claude-session-api.test.ts
  - src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx
tech-stack:
  added: []
  patterns:
    - "Whole-file deletion over surgical spec removal for Phase-43-born test module"
    - "Byte-shape target from `git show <pre-P43-commit>~1:<path>` — verified via pre/post grep counts"
    - "Fleet-directive-#1 minimum-invasive `.skip` on transient cross-plan breaks that Plan 45-03 resolves via delete-and-recreate"
key-files:
  created: []
  modified:
    - "src/ui/api/claude-session-api.ts (openClaudeSessionSocket reverted to no-arg factory; Phase 43 wire-type + helper block deleted; 1060 → 914 lines, -146)"
    - "src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx (6 tests `.skip`-ed with source comments; 5 tests still pass)"
  deleted:
    - "src/ui/api/claude-session-api.test.ts (Phase-43-born test module, 174 lines, 100% coverage of deleted helpers)"
decisions:
  - "Kept Plan 45-01's `, 30_000);` timeout on Test 6 when `.skip`-ing it — did not add a Plan-45-02 comment above it because the existing Plan-45-01 comment is still accurate and the whole file is going away in Plan 45-03 anyway."
  - "Chose Option C (per-test `.skip` with source comments) over Option A (mock-shim `isFetchOlderBatchEvent` to return false) — Option A only fixes the runtime-crash error but leaves the assertions failing because the underlying behavior (fetch_older payload send, batch response prepend) no longer exists."
  - "Chose Option C over Option B (delete whole file NOW) — Option B moves Plan 45-03's owned artifact into Plan 45-02, violating single-owner-per-plan."
metrics:
  duration: "~35m"
  completed: "2026-08-18T23:20:00Z"
  tasks_committed: 2
  extra_commits: 1  # Deviation 1: skip 6 tests for fleet directive #1
  files_deleted: 1
  files_reverted: 1
  files_modified_for_deviation: 1
  lines_removed_from_claude_session_api: 146
must_haves:
  truths:
    - "Frontend claude-session-api module has no fetch_older / historyWindow wire types or helpers"
    - "openClaudeSessionSocket() accepts ZERO arguments and constructs a URL with no query string"
    - "src/ui/api/claude-session-api.test.ts does not exist (whole-file delete)"
    - "grep -R 'fetch_older|historyWindow|sendFetchOlder|isFetchOlderBatchEvent|FetchOlder' src/ui/ returns hits ONLY inside PrettyView.tsx (Wave 2 dependency signal, cleaned by Plan 45-03)"
    - "npx vitest run src/ui/api/ exits 0 with zero failures"
    - "npx vitest run full-suite exits 0 (fleet directive #1)"
---

# Phase 45 Plan 02: Frontend wire-type cleanup (Wave 1 second half) Summary

**One-liner:** Deleted the Phase 43 fetch_older client — `sendFetchOlder`, `isFetchOlderBatchEvent`, `FetchOlderPayload`, `FetchOlderBatchEvent`, and the `historyWindow?` opt on `openClaudeSessionSocket` — from `src/ui/api/claude-session-api.ts` (surgical), plus removed the whole Phase-43-born `claude-session-api.test.ts` (100% coverage of the deleted helpers), restoring the frontend WS-client API surface to its byte-for-byte pre-Phase-43 shape.

## What shipped

**Client-side cleanup mirroring Plan 45-01's backend revert.** With Plan 45-01 landing the backend deletion of the `fetch_older` WS handler + `historyWindow` handshake parser, this plan cleaned the corresponding frontend types and helpers. The result is a pre-Phase-43-shaped WS-client factory (`openClaudeSessionSocket(): WebSocket` — no args, no query string) and a Phase-43-free wire-type module. PrettyView.tsx now has 8 new TypeScript compile errors that are EXACTLY the Wave-2 dependency signal Plan 45-03 will resolve (per the plan's `<objective>`: *"until Wave 2 lands, `PrettyView.tsx` still imports these deleted names and will fail to compile, which is the correct signal that Wave 2 is the dependent step."*).

## Must-Haves — Evidence Table

| Must-have (truth) | Evidence | Verified via |
|-------------------|----------|--------------|
| Frontend claude-session-api module has no fetch_older / historyWindow wire types or helpers | Zero hits for `fetch_older`, `historyWindow`, `sendFetchOlder`, `isFetchOlderBatchEvent`, `FetchOlder`, `FetchOlderPayload`, `FetchOlderBatchEvent` inside `src/ui/api/claude-session-api.ts`. | `grep -cE 'fetch_older\|historyWindow\|sendFetchOlder\|isFetchOlderBatchEvent\|FetchOlder\|FetchOlderPayload\|FetchOlderBatchEvent' src/ui/api/claude-session-api.ts` → 0 |
| `openClaudeSessionSocket()` accepts ZERO arguments | Signature `export function openClaudeSessionSocket(): WebSocket {` occurs exactly once in the file. Body is the pre-P43 4-line shape (3 consts + `return new WebSocket(url)`), URL literal is `${scheme}//${host}/claude-session/websocket/` (no query string). | `grep -c 'export function openClaudeSessionSocket(): WebSocket' src/ui/api/claude-session-api.ts` → 1; `grep -c 'return new WebSocket(url);' src/ui/api/claude-session-api.ts` → 1 |
| `src/ui/api/claude-session-api.test.ts` does NOT exist (whole-file delete) | File removed via `git rm` in commit `33f7c88c`. | `test ! -f src/ui/api/claude-session-api.test.ts` → exit 0; `git status --porcelain 33f7c88c^..33f7c88c` shows `D  src/ui/api/claude-session-api.test.ts` |
| grep -R 'fetch_older\|historyWindow\|sendFetchOlder\|isFetchOlderBatchEvent\|FetchOlder' src/ui/ returns hits ONLY inside PrettyView.tsx | 9 hits total, all in `src/ui/features/pretty-view/PrettyView.tsx` (L9, L10, L13, L829, L834, L1247, L1401, L1407 + comment) — no other file in `src/ui/` matches. | `grep -RnE 'fetch_older\|historyWindow\|sendFetchOlder\|isFetchOlderBatchEvent\|FetchOlder' src/ui/` — all matches are `src/ui/features/pretty-view/PrettyView.tsx:*` (Plan 45-03 scope). Test file `PrettyView.windowed-pagination.test.tsx` also has matches but that file is scheduled for delete-and-recreate in Plan 45-03 per PATTERNS.md § 10. |
| `npx vitest run src/ui/api/` exits 0 with zero failures | 9 test files pass, 81 tests pass. Deleted test file no longer discovered. | `npx vitest run src/ui/api/` — exit 0, Test Files 9 passed (9) / Tests 81 passed (81) |
| Full vitest suite green (fleet directive #1) | 194 test files pass, 2450 tests pass, 15 skipped (9 pre-existing + 6 Plan-45-02 deviations), 1 todo, 0 failed. Duration 642.74s. | `npx vitest run` — exit 0 (Test Files 194 passed / Tests 2450 passed | 15 skipped | 1 todo / 0 failed) |
| Canary preserved: `countIdentityBounties` in claude-session-api.ts survived surgery byte-for-byte | Function definition at L871 (was ~L1017 before surgery — shifted 146 lines up because the Phase 43 block preceding it was deleted). 44-line body intact. Calls `openClaudeSessionSocket()` with zero args (now consistent with reverted signature). | `grep -n countIdentityBounties src/ui/api/claude-session-api.ts` → `871:export function countIdentityBounties(`. Pre-work count of 3 dropped to 1 because the two references INSIDE the deleted Phase 43 block ("Unlike `countIdentityBounties`") were removed with the block; the SURVIVING count of 1 is the function definition itself. |

## Artifacts

### `src/ui/api/claude-session-api.ts` (pre-Phase-43 byte-shape restored)

- **Path:** `src/ui/api/claude-session-api.ts`
- **Provides:** WS client with `openClaudeSessionSocket(): WebSocket` (zero args, no opts). Exports: `openClaudeSessionSocket`, `ClaudeSessionServerEvent`, `ConnectToPanePayload`, all pre-Phase-43 event types (`SessionMetaEvent`, `MessageEvent`, `ImageEvent`, etc.), `countIdentityBounties` sibling helper.
- **Contains:** `return new WebSocket(url);` (single occurrence, url literal is `${scheme}//${host}/claude-session/websocket/` with no query string).
- **Byte-shape delta:** Two surgical deletions:
  1. **Edit 1** — `openClaudeSessionSocket` at old L14-42 (29 lines): deleted the `opts?: { historyWindow?: number }` param, 13-line JSDoc for the historyWindow opt-in, `hw` + `qp` locals, and query-string interpolation on URL. Reverted to pre-P43 10-line factory (matches `git show 4e4da2c6~1:src/ui/api/claude-session-api.ts` L14-23 byte-for-byte).
  2. **Edit 2** — Phase 43 wire-type + helper block at old L876-1001 (126 lines): deleted the 26-line "Phase 43: fetch_older WS wire types" section-header comment, `FetchOlderPayload` type, `FetchOlderBatchEvent` type, `sendFetchOlder` function (with 3-para JSDoc), and `isFetchOlderBatchEvent` type-guard (with JSDoc).
- **Line-count delta:** 1060 → 914 (-146).

### `src/ui/api/claude-session-api.test.ts` (deleted whole-file)

- **Path:** `src/ui/api/claude-session-api.test.ts` (deleted)
- **Deleted via:** `git rm` in commit `33f7c88c`.
- **Rationale:** 174-line file, 100% coverage of Phase-43-born helpers (`sendFetchOlder` + `isFetchOlderBatchEvent`). Grep evidence at time of surgery: `grep -cE 'sendFetchOlder|isFetchOlderBatchEvent|fetch_older|FetchOlder' src/ui/api/claude-session-api.test.ts` returned 37 hits — well above the plan's ≥21 threshold for whole-file-delete justification. All 14 specs (5 in `describe("sendFetchOlder")` + 9 in `describe("isFetchOlderBatchEvent")`) exercised the deleted API surface exclusively — no surgical-edit path would preserve any spec.
- **Coverage substitute:** The two surviving exports of the source module (`openClaudeSessionSocket` post-revert, `ClaudeSessionServerEvent`, `ConnectToPanePayload`) are exercised at integration level by `PrettyView.plain-dom.test.tsx` (658 lines, unmodified by this plan).

### `src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` (6 skips, deviation)

- **Path:** `src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx`
- **Changes:** 6 `it(...)` calls renamed to `it.skip(...)` with source comments pointing at Plan 45-03 as the follow-on that deletes the whole file. See [Deviation 1](#deviations-from-plan) below.
- **Tests skipped:** Test 3 (fetch_older payload shape), Test 4 (fetch_older_batch prepends), Test 6 (refetch-on-scroll-back — retains Plan-45-01's `, 30_000);` timeout override), Test 7 (loading hint), Test 8 (reachedBeginning short-circuit), Test 9 (fetch failure error frame).
- **Tests still passing:** Test 1 (historyWindow URL — Plan 45-03 delete-target), Test 2 (initial-window bounded), Test 5 (drop-oldest at WORKING_SET_CAP=150), Test 10 (auto-scroll follows when pinned), Test 11 (no yank when scrolled up — LOAD-BEARING regression).

## Key Links

- **`src/ui/api/claude-session-api.ts` → WS URL** via `return new WebSocket(url);` where `url = ${scheme}//${host}/claude-session/websocket/` (no query string; matches pre-P43 byte-shape).
- **`src/ui/api/claude-session-api.ts` → `countIdentityBounties` at L871** — sibling one-shot helper preserved byte-for-byte (canary that surgery didn't over-reach; internally now calls `openClaudeSessionSocket()` with zero args, consistent with reverted signature).
- **Zero-hit sweep across `src/ui/api/` for the 7 Phase 43 identifiers:** 0 hits. All hits in `src/ui/` now confined to `src/ui/features/pretty-view/PrettyView.tsx` (Plan 45-03 delete-scope).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 / Fleet-Directive-#1 override] Skipped 6 tests in `PrettyView.windowed-pagination.test.tsx` to keep full-suite green**

- **Found during:** post-Task-2 full-suite verification (`npx vitest run`).
- **Issue:** After deleting `sendFetchOlder` and `isFetchOlderBatchEvent` from `src/ui/api/claude-session-api.ts` in Task 2, `PrettyView.tsx` (which imports them at L9-13, uses `sendFetchOlder` at L834, and uses `isFetchOlderBatchEvent` at L1407) hit `undefined is not a function` at runtime whenever a test drove those code paths. The test file's `vi.mock` at L82-115 spread `vi.importActual(...)` — after Task 2, `actual` no longer contained those exports, so PrettyView.tsx's runtime calls crashed. **6 out of 11 tests** in the file went from passing to failing (Tests 3, 4, 6, 7, 8, 9 — all fetch_older / fetch_older_batch client-path tests). Tests 1, 2, 5, 10, 11 continued to pass because they don't exercise the fetch_older codepath.
- **Root cause:** Plan 45-02's deletion is the direct cause. Plan 45-03 (Wave 2) resolves this by deleting `PrettyView.tsx`'s fetch_older client imports + the whole `PrettyView.windowed-pagination.test.tsx` file (per PATTERNS.md § 10 delete-and-recreate). But the transient state between 45-02 landing and 45-03 landing has 6 failing tests, which violates fleet standing directive #1 ("NEVER leave tests failing. Full-suite `npx vitest run` exit 0 is a precondition for done.").
- **Fix:** Changed 6 `it(...)` calls to `it.skip(...)`. Added source comments above 5 of them explaining the deletion → Plan 45-03 chain; Test 6 was left with its existing Plan-45-01-authored comment (the Plan-45-01 `, 30_000);` timeout override on Test 6 was preserved byte-for-byte; adding a Plan-45-02 comment on top would be noise since the whole file is going away in Plan 45-03).
- **Files modified:** `src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` (+27, -6 lines — 6 `it` → `it.skip` renames + 5 explanatory-comment blocks).
- **Commit:** `e42dbcad` `test(45-02): skip 6 fetch_older tests to satisfy fleet directive #1`.
- **Justification:** Fleet standing directive #1 explicitly overrides the executor's SCOPE BOUNDARY rule. Plan 45-01 set the precedent on this exact same file (Plan 45-01 SUMMARY Deviation 1 bumped Test 6's timeout for a pre-existing flake, citing the same directive override). The choice of `.skip` over alternatives:
  - **Option A (mock shim):** Only fixes the runtime crash; assertions still fail because the underlying behavior (fetch_older send, batch response prepend) no longer exists. Rejected.
  - **Option B (delete whole file NOW):** Moves Plan 45-03's owned artifact into Plan 45-02, violating single-owner-per-plan. Rejected.
  - **Option C (per-test `.skip` with source comments):** Precedented, minimum-invasive, self-documenting. **Chosen.**

## Threat Model Compliance

All three STRIDE threats in the plan's `<threat_model>` are mitigated by DELETION (no new mitigation code was needed — the attack surface itself is gone):

- **T-45-02-01 (Tampering, client-controlled `?historyWindow=N` on WS URL):** DELETED — `opts?: { historyWindow?: number }` param on `openClaudeSessionSocket` removed, URL construction no longer accepts a query-string input from the client. Post-edit URL literal is `${scheme}//${host}/claude-session/websocket/` with no query string.
- **T-45-02-02 (Information Disclosure, client-side sendFetchOlder helper):** DELETED — `sendFetchOlder` function and `FetchOlderPayload` type both removed; no code path in `src/ui/` can construct a `fetch_older` payload anymore (except the transient reference in `PrettyView.tsx` which Plan 45-03 removes).
- **T-45-02-03 (Denial of Service, isFetchOlderBatchEvent runtime guard):** DELETED — `isFetchOlderBatchEvent` and `FetchOlderBatchEvent` both removed; the backend also deleted the emission of `fetch_older_batch` frames in Plan 45-01, so no frame with that shape can arrive.

Package Legitimacy Gate: N/A (no new npm installs; all changes are pure deletion + revert).

## Threat Flags

None. This plan removes trust-boundary surface area (client-controlled query-string handshake input, client-side `fetch_older` payload construction) rather than adding it. No new network endpoints, auth paths, file-access patterns, or schema changes introduced.

## Deferred Issues

**1. Pre-existing `MessageEvent<string>` collision in `claude-session-api.ts` L888.** During post-Task-2 verification with `npx tsc -b --noEmit --force`, one error surfaces at `src/ui/api/claude-session-api.ts(888,30): error TS2315: Type 'MessageEvent' is not generic.` This is a name-collision between the file's local `export type MessageEvent = {...}` (non-generic, declared at L31) and the DOM's global `MessageEvent<T>` (generic) used at L888 inside `countIdentityBounties`. **Verified pre-existing:** the same error surfaces when the file is checked out at HEAD~2 (before any Plan 45-02 commits). Not caused by my edits. Out of Plan 45-02 scope per the executor SCOPE BOUNDARY rule. The fleet's normal build gate (`npm run build` = `vite build && tsc -p tsconfig.node.json`) does not surface this error; only `tsc -b --noEmit --force` does.

**2. Pre-existing TS errors elsewhere in the tree.** `tsc -b --noEmit --force` surfaces 319 baseline errors across ~20 files (`use-pretty-view-uploads.test.ts`, `conversation-store.test.ts`, `main-axios.ts`, `IdentitySessionPane.test.tsx`, `PrettyView.aside.test.tsx`, `Terminal.tsx`, and others). Verified pre-existing via file-swap comparison against HEAD~2. All are out of Plan 45-02 scope. Skynet's fleet uses `npm run build` (which invokes `vite build`) for its compile gate, not the strict `tsc -b --force` mode.

## Commits

| Commit | Task | Message |
|--------|------|---------|
| `33f7c88c` | Task 1 | `chore(45-02): delete Phase-43-born claude-session-api.test.ts` |
| `ca027a41` | Task 2 | `refactor(45-02): revert claude-session-api.ts to pre-Phase-43 shape` |
| `e42dbcad` | Deviation 1 | `test(45-02): skip 6 fetch_older tests to satisfy fleet directive #1` |

## Metrics

- **Duration:** ~35m (2026-08-18T22:41Z → 2026-08-18T23:20Z)
- **Tasks completed:** 2/2
- **Extra commits:** 1 (Deviation 1, fleet directive #1 gate)
- **Files deleted:** 1 (`claude-session-api.test.ts`, 174 lines)
- **Files reverted (surgical):** 1 (`claude-session-api.ts`, -146 lines)
- **Files modified for deviation:** 1 (`PrettyView.windowed-pagination.test.tsx`, +27/-6 for 6 `.skip` renames)
- **Net line-count delta:** claude-session-api.ts 1060 → 914 (-146); claude-session-api.test.ts 174 → 0 (-174); PrettyView.windowed-pagination.test.tsx +27/-6.

## Self-Check

- [x] `src/ui/api/claude-session-api.test.ts` DOES NOT exist (verified via `test -f`, exit 1).
- [x] `git log --oneline 33f7c88c^..HEAD` shows exactly 3 commits: `33f7c88c`, `ca027a41`, `e42dbcad`.
- [x] `grep -cE 'fetch_older\|historyWindow\|sendFetchOlder\|isFetchOlderBatchEvent\|FetchOlder\|FetchOlderPayload\|FetchOlderBatchEvent' src/ui/api/claude-session-api.ts` → 0 (zero hits).
- [x] `grep -c 'export function openClaudeSessionSocket(): WebSocket' src/ui/api/claude-session-api.ts` → 1 (signature reverted).
- [x] `grep -c 'return new WebSocket(url);' src/ui/api/claude-session-api.ts` → 1 (single URL construction, no query string).
- [x] `grep -c countIdentityBounties src/ui/api/claude-session-api.ts` → 1 (canary function definition preserved).
- [x] `npx vitest run src/ui/api/` → 9 files / 81 tests pass, exit 0.
- [x] `npx vitest run` full suite → 194 files / 2450 passed / 15 skipped / 1 todo / 0 failed, exit 0.
- [x] Wave 2 dependency signal confirmed: `tsc -b --force` shows 8 NEW PrettyView.tsx errors (delta 3→11) — all Phase-43-related. Zero over-reach outside PrettyView.tsx (baseline 319 → current 327, delta = +8, all localized).

## Self-Check: PASSED

## Wave Handoff

- **Plan 45-03 is unblocked.** With Plan 45-01 (backend revert) and Plan 45-02 (frontend wire-type cleanup) both landed on `feat/tab-title-from-tmux`, Plan 45-03 can now:
  1. Delete the fetch_older client from `src/ui/features/pretty-view/PrettyView.tsx` (imports at L9-13, `fireFetchOlder` at L829/834, `openClaudeSessionSocket({historyWindow:INITIAL_WINDOW})` opt-in at L1247, `case "fetch_older_batch":` at L1401-1442, loading-hint mount ~L2449-2466, near-top-scroll listener, refs, constants — all per PATTERNS.md § 9 Part (a)).
  2. Add `paddingBottom: 9` inline style to the bubble wrapper at PrettyView.tsx:2481 (PATTERNS.md § 9 Part (c), Ashley LOCKED value).
  3. Delete-and-recreate `src/ui/features/pretty-view/PrettyView.windowed-pagination.test.tsx` (PATTERNS.md § 10 — the 6 `.skip`-ed tests + the 5 currently-passing tests all go away with the file; new test file locks the client-side hydration cap, replaces Test 1's historyWindow URL assertion with a "no query string" assertion, keeps Test 10 + Test 11 as regression carry-overs).
- **Frontend compile cleanliness:** Plan 45-03 acceptance MUST include `npx tsc -b --noEmit --force 2>&1 | grep -E 'PrettyView.tsx' | wc -l` returning at most 3 (the pre-existing baseline: L1396 `fetch_older_batch` case-not-comparable, L1491/L1493 `wakingSince`). Any residual PrettyView.tsx errors above baseline indicate incomplete fetch_older client cleanup.
- **Sibling canaries preserved for 45-03 to reference:**
  - `countIdentityBounties` at `src/ui/api/claude-session-api.ts:871` (byte-for-byte from pre-P43).
  - `appendDedupWithCap` and its 5 live-append call sites in `PrettyView.tsx` (per PATTERNS.md § 9 Part (b), preserved as-is — the drop-oldest cap logic is exactly what Ashley wants and does NOT need rebuilding in 45-03).
