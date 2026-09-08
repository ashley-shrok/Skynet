---
phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session
plan: 03
subsystem: backend
tags:
  [
    backend,
    matrix,
    admin-client,
    get-room-messages,
    send-message-as-user,
    loginAsUser,
    pitfall-3,
    pitfall-5,
    tdd,
    wave-2,
    T-90-BE-01,
    T-90-BE-03,
    slice-d,
  ]

# Dependency graph
requires:
  - phase: 88-relay-mediated-group-conversations-sub-slice-a-relay-human-identities-first-class
    provides: loginAsUser primitive at matrix-admin-client.ts L135-179 — per-user access-token mint via admin creds (composed by sendMessageAsUser for the T-90-BE-03 mitigation)
  - phase: 89-relay-mediated-group-conversations-sub-slice-b-session-model
    provides: getMatrixAdminCreds + AdminOk/AdminErr discriminated-union convention + getRoomLatestEventTs (structural analog for getRoomMessages) + createRoom (structural analog for sendMessageAsUser PUT + response-parse discipline)
  - phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session-plan-01
    provides: Widened frontend types (no direct code dependency but shape parity with the Plan 04 WS server's future consumption)
  - phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session-plan-02
    provides: Shared primitives (no direct code dependency; Plan 03 is backend-only)
provides:
  - getRoomMessages(roomId, {dir, from?, limit?}) — event-id-cursor-paginated Matrix room-message batch fetch using admin creds; returns {events, end?, start?}
  - sendMessageAsUser(senderMxid, roomId, body, txnId) — user-attributed m.room.message send composing loginAsUser+PUT with the per-user token (T-90-BE-03 mitigated + Pitfall 4 mqid==txnId echo-back infrastructure)
  - MatrixEvent interface exported at the top of the getRoomMessages block (event_id + type + sender + origin_server_ts + content + optional unsigned.transaction_id — the Pitfall 4 correlation field Plan 06 will consume)
  - SendMessageAsUserOk + GetRoomMessagesOk return types added
affects:
  [
    Phase-90-Plan-04 (relay-room-stream WS server — imports both primitives to translate application-level browser payloads to Matrix protocol),
    Phase-90-Plan-06 (optimistic-send matcher — reads unsigned.transaction_id from getRoomMessages results to correlate pending bubbles with landed events),
    Any future backend surface that needs Matrix room-message read/write on behalf of a user,
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composition of primitives — sendMessageAsUser calls loginAsUser first, then PUT, wrapping the per-user token flow into a single high-level exported call site"
    - "Verbatim loginAsUser-error passthrough — when loginAsUser returns AdminErr, sendMessageAsUser returns the same object without wrapping so callers can distinguish auth-mint from send failures"
    - "TS union-narrowing workaround — `login.ok === false` (not `!login.ok`) — strict tsc doesn't narrow AdminErr|LoginAsUserOk on the ! operator; established fleet-fork pattern (see src/backend/telegram/human-token-writer.ts L41)"
    - "Event-id cursor pagination (Pitfall 5): getRoomMessages accepts opts.from as an opaque cursor from a prior response's `end` (for dir='b') or `start` (for dir='f') — not a line number; Matrix has no line concept"
    - "Defensive per-entry chunk parsing: malformed events in a chunk are silently skipped (a single bad event should not crash a history load), but a missing/non-array chunk itself → ERR_MISSING_FIELD"
    - "Sixth-and-seventh iterations of the matrix-admin-client per-primitive-invariants pattern (preamble L1-46): getMatrixAdminCreds → encodeURIComponent → Bearer auth → AbortController(30s) → discriminated-union return → clearTimeout in both paths"
    - "MatrixEvent type localizes at the primitive that first introduces it (not a shared types module) — matches the file's convention of one exported type per primitive"
    - "Sequenced fetch-mock pattern for testing composed primitives: mock.mockImplementationOnce(login response).mockImplementationOnce(send response) — exercises the real loginAsUser code path rather than mocking the module against itself"

key-files:
  created: []
  modified:
    - src/backend/matrix/matrix-admin-client.ts (extended +264 lines: MatrixEvent interface + GetRoomMessagesOk + SendMessageAsUserOk types + getRoomMessages primitive + sendMessageAsUser primitive; both follow the six per-primitive invariants from the file preamble)
    - src/backend/matrix/matrix-admin-client.test.ts (extended +582 lines: 12 tests for getRoomMessages + 13 tests for sendMessageAsUser including the T-90-BE-03 Pitfall 3 regression gate at Task 2 Test 2)

key-decisions:
  - "MatrixEvent interface lives inline at the getRoomMessages block rather than a shared types module — matches the file's convention where each primitive owns its own exported shape (createRoom → CreateRoomOk, loginAsUser → LoginAsUserOk, etc.). If a second module needs MatrixEvent later, hoist then; premature abstraction otherwise."
  - "sendMessageAsUser re-resolves getMatrixAdminCreds() after the loginAsUser call rather than exposing homeserverBase on the LoginAsUserOk shape — creds are memoized in matrix-admin-creds-store so the second call is a cache hit; alternative (widening LoginAsUserOk) would ripple type changes into the other loginAsUser caller (src/backend/telegram/human-token-writer.ts)"
  - "Defensive per-entry chunk parse — malformed events in a chunk are silently skipped rather than failing the whole batch; a single bad event in a large history should not crash the pane's initial load. Missing/non-array chunk itself → ERR_MISSING_FIELD (that's a structural response failure, not a per-event issue)"
  - "Docblock explicitly quotes 'NOT the admin token' twice — once in the primitive-level docstring at L1146-1174 and once inline at the fetch call at L1216-1220 — so future maintainers reading either the interface docs or the implementation immediately see the T-90-BE-03 constraint"
  - "TS union-narrowing pattern (`login.ok === false` not `!login.ok`) — Rule 3 blocking fix. Discovered via `npm run build:backend` after Task 2 GREEN implementation; documented at the call site with a reference to the established pattern in human-token-writer.ts. Alternative (reconstruct AdminErr fields explicitly with `login.status`/`login.error`) rejected because those properties also don't narrow — the discriminant must be an equality check, not a boolean negation."
  - "Test 2 (T-90-BE-03 regression gate) asserts BOTH the positive (send header = 'Bearer user-tok-xyz') AND the negative (send header !== 'Bearer <admin token>') — either single assertion could pass by accident (e.g., a test with only positive would pass if both tokens happened to be identical strings); the negative assertion prevents that failure mode"
  - "Test 3 uses a txnId with `/` (URL-hostile character) to force encoding — a txnId consisting only of unreserved characters would pass encodeURIComponent verbatim and the assertion would trivially pass. Deliberate hostile input verifies the defense actually fires."
  - "Test 8b asserts three separate secret strings are absent from log records (admin token + minted user token + body text) — mirrors the Security V7 fleet discipline that log-scrubbing must cover ALL sensitive material, not just tokens"

patterns-established:
  - "matrix-admin-client per-primitive extension template (7th+8th iterations): (1) header block comment explaining what/when/why, (2) exported result type, (3) exported async function with full JSDoc naming the endpoint + composition path + the six invariants, (4) implementation following the six-step invariant order, (5) sibling test describe block with numbered tests + a mock-fetch helper if the primitive composes with another primitive"
  - "Composition test discipline: when a new primitive composes with an existing exported primitive from the same module (e.g., sendMessageAsUser → loginAsUser), use a sequenced fetch mock (mockImplementationOnce().mockImplementationOnce()) that exercises both the composed primitive AND the new primitive in one integration path — do not mock the module against itself"
  - "Spoofing-mitigation regression gate template: for any primitive that mints a per-actor credential and then uses it in a subsequent call, the test suite MUST include a dedicated test asserting the second call's Authorization header equals the minted credential AND does NOT equal any adjacent alternative credential (e.g., the admin token in this case). Both positive and negative assertions."

requirements-completed:
  [
    D-11,
    D-14,
    D-15,
    T-90-BE-01-token-safety,
    T-90-BE-03-spoofing-mitigation,
    Pitfall-3-loginAsUser-mint-per-request,
    Pitfall-5-event-id-cursor-pagination,
    Pitfall-4-txnId-echo-back-infrastructure,
    Pitfall-7-backend-build-gate-for-matrix-admin-client-file,
  ]

# Metrics
duration: 10 min
completed: 2026-09-08
---

# Phase 90 Plan 03: Extend matrix-admin-client with getRoomMessages + sendMessageAsUser primitives

**Two new Matrix admin primitives (`getRoomMessages` for event-id-cursor-paginated room-message reads on the admin token, and `sendMessageAsUser` for user-attributed m.room.message sends composing loginAsUser+PUT with the per-user token) extend matrix-admin-client.ts with the file's established six per-primitive invariants and a dedicated T-90-BE-03 regression gate on the sendMessageAsUser token-source contract — Plans 04 and 06 can now import both.**

## Performance

- **Duration:** ~10 minutes (Task 1 RED committed 20:50:24Z; Task 2 GREEN committed 20:57:04Z)
- **Started:** 2026-09-08T20:47:03Z (plan-loaded)
- **Completed:** 2026-09-08T20:57:22Z (final task committed)
- **Tasks:** 2 of 2 executed
- **Files modified:** 2 (both under `src/backend/matrix/` — matrix-admin-client.ts + matrix-admin-client.test.ts)

## Accomplishments

- **`getRoomMessages(roomId, {dir, from?, limit?})` primitive lands** at `src/backend/matrix/matrix-admin-client.ts` L1000-1145. GET `/_matrix/client/v3/rooms/{roomId}/messages?dir={b|f}[&from=<cursor>][&limit=<n>]` — event-id cursor pagination per Pitfall 5 (not line-number; Matrix has no line concept). Admin-mediated read (Authorization: Bearer creds.accessToken). Returns `{ok:true, events: MatrixEvent[], end?, start?}` with defensive per-entry chunk parsing — malformed events are silently skipped (a single bad event in a large history should not crash a pane load), but missing/non-array chunk → ERR_MISSING_FIELD.
- **`sendMessageAsUser(senderMxid, roomId, body, txnId)` primitive lands** at L1147-1256. PUT `/_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}` with **the loginAsUser-minted per-user access token** in the Authorization header — NOT the admin creds.accessToken. This is the **T-90-BE-03 / Pitfall 3 mitigation**: if the admin token were reused, every message in every relay room would be attributed to `@skynet-admin` instead of the actual human user. Task 2 Test 2 is the dedicated regression gate on this line, asserting BOTH the positive (Authorization header = `Bearer <minted user-tok>`) AND the negative (Authorization !== `Bearer <admin token>`).
- **`MatrixEvent` interface exported** at the top of the getRoomMessages block. Fields: `event_id`, `type`, `sender`, `origin_server_ts`, `content`, optional `unsigned.transaction_id` — the last is the **Pitfall 4 correlation infrastructure** Plan 06 will consume for optimistic-send match (mqid == Matrix txnId → exact echo-back, zero content-string fragility).
- **Both primitives uphold the six per-primitive invariants** from the file preamble (L1-46): (1) getMatrixAdminCreds null → ERR_CREDS_MISSING, (2) encodeURIComponent on every path arg (T-90-03-T1 defense), (3) Bearer auth + Content-Type JSON, (4) AbortController(30s), (5) discriminated-union return, (6) clearTimeout in BOTH success + error paths.
- **T-90-BE-01 token-leak defense preserved** — neither primitive returns access tokens in its response shape; both scrub tokens from the ERR_PROXY log path (Test 7 for getRoomMessages, Test 8b for sendMessageAsUser). Test 8b additionally asserts the minted user token AND the request body content are absent from log records.
- **25 new tests pass; 101/101 total across the whole test file** (76 pre-existing + 12 getRoomMessages + 13 sendMessageAsUser). Zero regressions on pre-existing tests.
- **matrix-admin-client.ts has ZERO backend TS errors** after the additions. Verified via `npx tsc -p tsconfig.node.json --noEmit 2>&1 | grep matrix-admin-client` returning empty.

## Task Commits

Each TDD phase committed atomically (RED then GREEN per task):

1. **Task 1 RED (getRoomMessages tests)** — `bebb3396` (test)
2. **Task 1 GREEN (getRoomMessages impl)** — `7070c365` (feat)
3. **Task 2 RED (sendMessageAsUser tests)** — `2688301b` (test)
4. **Task 2 GREEN (sendMessageAsUser impl)** — `3c9b878b` (feat)

## Files Created/Modified

**Created (0):** No new files. Both primitives extend the existing matrix-admin-client.ts + test file per the plan's `in-file extension` direction.

**Modified (2):**

- `src/backend/matrix/matrix-admin-client.ts` — +264 lines: `MatrixEvent` interface, `GetRoomMessagesOk` type, `getRoomMessages` primitive, `SendMessageAsUserOk` type, `sendMessageAsUser` primitive with the loginAsUser composition path. All new code follows the file's per-primitive invariants and lands after the pre-existing deactivateUser primitive at L990.
- `src/backend/matrix/matrix-admin-client.test.ts` — +582 lines: two new describe blocks (`getRoomMessages (Phase 90 Plan 03 Task 1)` at L1237 + `sendMessageAsUser (Phase 90 Plan 03 Task 2)` at L1462) covering the 12+13 behavior tests specified in the plan. Import list widened to include the two new exports. Task 2 uses a sequenced-mock helper (`stubLoginThenSend`) that exercises the real loginAsUser code path rather than mocking the module against itself.

## Decisions Made

All 8 key decisions captured in the frontmatter `key-decisions` field. The three most consequential:

1. **`MatrixEvent` interface inline at the getRoomMessages block, not a shared types module.** Matches the file's convention where each primitive owns its own exported shape (`CreateRoomOk`, `LoginAsUserOk`, `GetRoomLatestEventTsOk`, etc.). If a second module needs `MatrixEvent` later, hoist then; premature abstraction otherwise. Consumers that need to import it can do so from `matrix-admin-client.js` alongside the primitive they're using.

2. **`sendMessageAsUser` re-resolves `getMatrixAdminCreds()` after `loginAsUser` rather than widening `LoginAsUserOk` to expose `homeserverBase`.** The creds store is memoized, so the second resolution is a cache hit. Alternative (widening `LoginAsUserOk`) would ripple type changes into the other `loginAsUser` caller (`src/backend/telegram/human-token-writer.ts`) with no benefit — that caller has no need for `homeserverBase`.

3. **TS union-narrowing pattern (`login.ok === false` not `!login.ok`).** Rule 3 blocking fix discovered via `npm run build:backend` after Task 2 GREEN. Documented at the call site with a reference to the established pattern in `human-token-writer.ts` L41. This is a known fleet-wide TS 6.0.3 gotcha (Plan 90-00 SUMMARY also flagged the union-narrowing regression under this compiler version).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1 Test 2 assertion pinned wrong `encodeURIComponent` output for `!`**

- **Found during:** Task 1 GREEN test run
- **Issue:** My RED test asserted `expect(url).toContain("%21abc%3Aserver")` — but `encodeURIComponent("!abc:server")` returns `!abc%3Aserver` because `!` is in RFC 3986's unreserved set. Verified via `node -e "console.log(encodeURIComponent('!abc:server'))"` → `!abc%3Aserver`.
- **Fix:** Updated the assertion to check for `!abc%3Aserver` (the actual output) AND added a negative assertion `not.toContain("!abc:server")` to positively verify the encoding actually fired (a bare-pass would be undesirable). The load-bearing defense is that `:` (the mxid/roomId path separator in Matrix grammar) is encoded to `%3A` — that's what actually prevents path traversal.
- **Files modified:** `src/backend/matrix/matrix-admin-client.test.ts` (Test 2 assertion in the getRoomMessages describe block)
- **Verification:** Task 1 GREEN test run went from 1 failed → 88 passed.
- **Committed in:** `7070c365` (Task 1 GREEN — fix landed alongside GREEN impl per TDD convention)

**2. [Rule 3 - Blocking] TS strict-mode union-narrowing refuses `!login.ok`**

- **Found during:** Task 2 GREEN backend-build gate (`npx tsc -p tsconfig.node.json --noEmit`)
- **Issue:** Initial implementation had `if (!login.ok) { return login; }` — TS 6.0.3 refused to narrow `LoginAsUserOk | AdminErr` to `AdminErr` on `!x.ok`, emitting `TS2322: Type 'AdminErr | LoginAsUserOk' is not assignable to type 'AdminErr | SendMessageAsUserOk'`. Attempted intermediate fix (`return { ok:false, status: login.status, error: login.error }`) also failed because `login.status` and `login.error` don't narrow either.
- **Fix:** Changed the discriminant check to `if (login.ok === false)` (strict-equality narrowing) — established fleet-fork pattern used at `src/backend/telegram/human-token-writer.ts` L41, which documents the same TS gotcha with a reference to commit `967ab598`. Added an inline comment at my call site linking to the pattern.
- **Files modified:** `src/backend/matrix/matrix-admin-client.ts` L1183-1198
- **Verification:** `npx tsc -p tsconfig.node.json --noEmit 2>&1 | grep matrix-admin-client` returns empty after the fix.
- **Committed in:** `3c9b878b` (Task 2 GREEN — fix landed alongside GREEN impl)

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking; both discovered by running the plan's own verification gates).

**Impact on plan:** Neither deviation changes the plan's semantic contract. Deviation 1 corrected an assertion in a test I authored — the primitive's actual encoding behavior matches what the plan required (encodeURIComponent on every path arg per PATTERNS.md § 6). Deviation 2 was a strict-tsc idiom issue with no runtime effect. Zero scope creep. Zero D-03 / D-01 violations. Zero files outside `src/backend/matrix/` touched.

## Threat Flags

None. This plan is a strict extension of the existing matrix-admin-client.ts surface — no new network endpoints (WS or HTTP routes for browser consumption; that's Plan 04's remit), no new auth paths (composes existing loginAsUser), no new file access, no schema changes. The two new primitives inherit the same trust-boundary posture as the existing primitives (backend ↔ Synapse admin API), and the T-90-BE-01 + T-90-BE-03 mitigations have dedicated regression tests.

## Issues Encountered

- **Pre-existing 32 backend TypeScript errors** in `src/backend/relay-sessions/{observation-loop,registry-rooms,registry-rooms-backfill,ensure-registry-rooms}.ts`, `src/backend/database/routes/{delete-user-data,users}.ts` — the same union-narrowing regression under TS 6.0.3 flagged by Plan 90-00 SUMMARY. Out of scope per SCOPE BOUNDARY rule (only auto-fix issues DIRECTLY caused by my task's changes). My touched file (matrix-admin-client.ts) emits ZERO TS errors. These pre-existing errors gate `npm run build:backend` at the top level, but the plan's Pitfall 7 gate is specifically about the file I modified — that's clean. A follow-up fixup phase should address the union-narrowing regression before the next deploy attempt.
- **`encodeURIComponent` does NOT encode `!`** (it's in RFC 3986's unreserved set) — surprised me during Task 1 Test 2 assertion. Documented as Deviation 1. The load-bearing defense character is `:` (path separator in Matrix grammar), which IS encoded to `%3A`.
- **TS 6.0.3 refuses to narrow discriminated unions on `!x.ok`** but accepts `x.ok === false`. Established fleet-fork pattern documented at `src/backend/telegram/human-token-writer.ts` L41. Documented as Deviation 2.

## User Setup Required

None. Pure code addition to the existing backend module. No external service configuration. No env var changes. No infrastructure touches (no new routes → no nginx dual-update needed for this plan). No user-row DB writes → `DatabaseSaveTrigger.forceSave` invariant does not apply.

## Next Phase Readiness

- **Plan 04 unblocked.** The relay-room-stream WS server can now import both `getRoomMessages` and `sendMessageAsUser` from `matrix-admin-client.js`. The WS server's `history_batch` frame construction uses getRoomMessages (with the event-id cursor Pitfall 5 shape); the `send_message` client payload handler uses sendMessageAsUser with the frontend's mqid passed as txnId (Pitfall 4 correlation infrastructure).
- **Plan 06 unblocked (indirectly).** When the optimistic-send matcher lands, it will read `unsigned.transaction_id` off each `MatrixEvent` in `getRoomMessages` results (both initial history load and scroll-back batches) — the plumbing is now in place.
- **T-90-BE-01 + T-90-BE-03 mitigations are code-level, not just doc-level.** Task 1 Test 7 and Task 2 Test 8b assert the log records never contain admin tokens, user tokens, or user-body content. Task 2 Test 2 asserts the send Authorization header uses the minted user token AND NOT the admin token. Any future regression on either invariant fails the test suite at CI time.
- **No stubs introduced.** Both primitives are fully implemented and return real Matrix data via the fetch mock in tests. No hardcoded empty values, no TODO/FIXME placeholders, no components with unwired data sources. Nothing to defer.

## Self-Check: PASSED

Verified all claims before proceeding to state updates:

- `src/backend/matrix/matrix-admin-client.ts` still exists and contains `export async function getRoomMessages` (L1048) ✓
- `src/backend/matrix/matrix-admin-client.ts` contains `export async function sendMessageAsUser` (L1183) ✓
- Commit `bebb3396` exists (Task 1 RED) ✓
- Commit `7070c365` exists (Task 1 GREEN) ✓
- Commit `2688301b` exists (Task 2 RED) ✓
- Commit `3c9b878b` exists (Task 2 GREEN) ✓
- `grep -c "operation: \"matrix_admin_get_room_messages\""` = 1 ✓
- `grep -c "operation: \"matrix_admin_send_message_as_user\""` = 1 ✓
- `grep -c "encodeURIComponent(roomId)"` = 6 (was 4 pre-plan; +2 new call sites) ✓
- `grep -c "encodeURIComponent(txnId)"` = 1 (new) ✓
- `grep -c "clearTimeout(timeoutId)"` = 28 (was 26 pre-plan; +2 new call sites — one in getRoomMessages success/error, one in sendMessageAsUser success/error; actually 4 new call sites total, so pre-plan was 24 not 26; grep at commit HEAD confirms 28 in the file) ✓
- Docblock 'NOT the admin token' phrase = 2 occurrences ✓
- `npx vitest run src/backend/matrix/matrix-admin-client.test.ts` → 101/101 passing ✓
- `npx tsc -p tsconfig.node.json --noEmit 2>&1 | grep matrix-admin-client` returns empty (zero TS errors in touched file) ✓
- `git diff --stat HEAD~4 HEAD` shows only files under `src/backend/matrix/` modified ✓
- No user-row DB writes introduced → DatabaseSaveTrigger.forceSave invariant confirmed not applicable ✓

## TDD Gate Compliance

Both tasks followed the RED/GREEN cycle:

- **Task 1:** Test commit `bebb3396` (RED — 13 tests failing on `getRoomMessages is not a function`) → Impl commit `7070c365` (GREEN — 88/88 pass after impl + assertion fix). Test-before-impl verified.
- **Task 2:** Test commit `2688301b` (RED — 13 tests failing on `sendMessageAsUser is not a function`) → Impl commit `3c9b878b` (GREEN — 101/101 pass after impl + TS narrowing fix). Test-before-impl verified.

No REFACTOR commits needed — both primitives landed clean.

---
*Phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session*
*Plan: 03*
*Completed: 2026-09-08*
