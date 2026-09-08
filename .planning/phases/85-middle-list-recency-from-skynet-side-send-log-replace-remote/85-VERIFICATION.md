---
phase: 79-middle-list-recency-from-skynet-side-send-log-replace-remote
verified: 2026-09-07T18:22:00Z
status: passed
score: 5/5 must-haves verified + 10/10 D-decisions traced
overrides_applied: 0
re_verification:
  previous_status: null
  previous_score: null
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 85: middle-list recency from Skynet-side send-log Verification Report

**Phase Goal:** Replace the SOURCE of the middle-zone recency signal in the conversation list — from remote SSH tail-scan of each identity's newest JSONL (subject to /id-reset rotation) to a per-identity send-time timestamp recorded in Skynet's own `skynet-data` SQLite. Wire shape, comparator, working-store, pinned + RDP zones all unchanged.

**Verified:** 2026-09-07T18:22:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After ship, sending to an identity from Skynet's compose surface stamps the store and the identity's row rises in the middle zone within one fleet-status tick (or instantly on the sending device). | VERIFIED | Frontend hook at ComposeBox.tsx:474-496 fires `stampIdentitySendLog(identityName, stampTs)` (backend POST) + `seedSessionLastMessageAt(hostId, tmuxSession, stampTs)` (optimistic client) on every send via useComposeSend.send funnel. Backend orchestrator at ssh-poll-orchestrator.ts:1648-1674 reads store via `getIdentityLastSend(tmuxSession)` on next per-tick per-session pass, publishing SessionState with fresh lastMessageAt. Fingerprint delta triggers publish. |
| 2 | After `/id reset` recycles an identity, the identity's row position does NOT drop — the store is unaffected by JSONL rotation. | VERIFIED | The store is keyed on identity name (schema.ts:748-754 `identity_send_log.identity_name TEXT PRIMARY KEY`) — decoupled from JSONL path. Orchestrator reads `getIdentityLastSend(tmuxSession)` (ssh-poll-orchestrator.ts:1650) regardless of `jsonlPath` state. Store is a durable single-row-per-identity table; /id reset does not touch it. |
| 3 | After container restart, the store's values survive (durable via forceSave contract). | VERIFIED | `DatabaseSaveTrigger.forceSave("phase-85-stamp-identity-send")` fires in try/catch after every successful write (identity-send-log-store.ts:167-180). Schema creation flush at boot: `DatabaseSaveTrigger.forceSave("phase-85-create-identity-send-log")` at db/index.ts:1735. Table itself defined via `CREATE TABLE IF NOT EXISTS` in initializeCompleteDatabase() at db/index.ts:532-536. |
| 4 | The old `scanTailForNewestMessageAt` still runs for its other consumers (ai-title, isWorking, dormant, etc.) — those axes are unaffected. | VERIFIED | `scanTailForNewestMessageAt` defined at ssh-poll-orchestrator.ts:543 + sessions.ts:168 (both byte-parallel copies per D-08). `isAshleyRealUserTurn` defined at ssh-poll-orchestrator.ts:432 + sessions.ts:103. `scanTailForLatestAiTitle` defined at ssh-poll-orchestrator.ts:587 + still called at ssh-poll-orchestrator.ts:1698 and sessions.ts:484. `isAshleyRealUserTurn` still called from `scanTailForLayer1RecyclingSignal` at ssh-poll-orchestrator.ts:666. `discoverIdentityJsonlPathViaChannel` defined at ssh-poll-orchestrator.ts:719 + called for aiTitle discovery at :1612. |
| 5 | Pinned + RDP zones remain alphabetically sorted; the new signal does not leak into their comparators. | VERIFIED | `pinned.sort(compareByHostRoleLabel)` at conversation-store.ts:712; `rdpRows.sort(compareByHostRoleLabel)` at conversation-store.ts:830. Middle zone uses `compareByRecencyDesc` at conversation-store.ts:749. Zero Phase 85 commits touched `conversation-store.ts` (verified via `git diff --name-only` sweep across all 22 Phase 85 commits). |

**Score:** 5/5 truths verified

### Locked-Decision Traceability (D-01 through D-10)

| D | Decision | Status | Codebase Evidence |
|---|----------|--------|-------------------|
| D-01 | New table in `skynet-data` SQLite via Drizzle schema; identity name primary key; no user column (single-tenant). | VERIFIED | schema.ts:748-754 declares `identitySendLog = sqliteTable("identity_send_log", { identityName: text("identity_name").primaryKey(), lastSendAt: integer("last_send_at").notNull(), updatedAt: text("updated_at")... })`. No user_id column. In-process migration at db/index.ts:532-536 (CREATE TABLE IF NOT EXISTS inside initializeCompleteDatabase's multi-table exec). forceSave at db/index.ts:1735. |
| D-02 | Store is keyed on identity name only — not (hostId, tmuxSession), not host id, not working-store session-key. | VERIFIED | schema.ts:749 `identityName: text("identity_name").primaryKey()`. Store functions accept `identityName: string` only (identity-send-log-store.ts:65, 194). Orchestrator passes `tmuxSession` (identity name per fleet convention) at ssh-poll-orchestrator.ts:1650. sessions.ts passes `row.sessionName` at :412. Frontend passes `identityName` prop at ComposeBox.tsx:476. |
| D-03 | Universal rule — anything that fires a message-shaped payload from compose surface counts. Hook is architectural, not an enumerated allowlist. | VERIFIED | Hook lives in `useComposeSend.send` at ComposeBox.tsx:474-496 — the Phase 68 universal send funnel every button routes through. No allowlist; the stamp fires unconditionally when `identityName != null && identityName !== "" && tmuxSession != null`. `[compose] submit-entry` log at :461 proves funnel is truly universal. Test coverage (ComposeBox.send-log-hook.test.tsx, 8 cases) verifies text submit + reset + thumbs-up + recap all fire the stamp+advance pair. |
| D-04 | Hook site is `useComposeSend.send` at ComposeBox.tsx:447-493 (Phase 68 universal send funnel). identityName available via prop at ComposeBox.tsx:509. | VERIFIED | Exactly one call to `stampIdentitySendLog` at ComposeBox.tsx:476 inside useComposeSend.send. `identityName?: string` added to hook deps signature at :445, extracted at :449, in useCallback deps array at :528. Caller at ComposeBox.tsx:1230 passes identityName from ComposeBox props (declared at :249). |
| D-05 | Attempts count. If the send fails because the target is unreachable, the stamp still fires. | VERIFIED | Frontend: `stampIdentitySendLog` is fire-and-forget void return (identity-send-log-api.ts:18), inner `.catch(() => warn log)` swallows all errors (:28-35), outer try/catch belt-and-suspenders (:27-42). Backend: `stampIdentityLastSend` `forceSave` failure logged non-propagating (identity-send-log-store.ts:170-180). Not awaited from useComposeSend.send. Backend route validates + dispatches without gating on delivery. |
| D-06 | Row moves the instant Ashley hits send — optimistic client-side stamp via `advanceSessionLastMessageAt` (or `seedSessionLastMessageAt` wrapper) on the same frame as send dispatches. | VERIFIED | `seedSessionLastMessageAt(hostId, tmuxSession, stampTs)` at ComposeBox.tsx:477 — SAME frame as `stampIdentitySendLog` call at :476, both fire BEFORE `onOptimisticSend` at :507 and BEFORE the `onSend` dispatch at :510. Single `stampTs = Date.now()` captured at :475 shared between both paths (ensures convergence). |
| D-07 | Backend derivation of `SessionState.lastMessageAt` swaps from `scanTailForNewestMessageAt` to send-log store lookup. Wire field + type + working-store max-wins + comparator + snapshot pipeline all untouched. | VERIFIED | ssh-poll-orchestrator.ts:1648-1674: `if (tmuxSession !== null) { const stored = await getIdentityLastSend(tmuxSession); ... }` — reads store, sets `derivedLastMessageAt`. `scanTailForNewestMessageAt(tailRaw)` call REMOVED from source A (grep-c returns 0 for that call). sessions.ts:410-437: `sendLogLookupBlock` parallel to `aiTitleBlock` — swap parallel to orchestrator. Wire shape `lastMessageAt` at wire-protocol.ts:325 unchanged. computeFingerprint at ssh-poll-orchestrator.ts:769 unchanged (fingerprint delta still triggers publish). |
| D-08 | Transcript-scan pipeline stays alive for other consumers (ai-title, isWorking, dormant, recycling, lastStopAt). Only the recency-derivation role retires. | VERIFIED | `isAshleyRealUserTurn` defined at ssh-poll-orchestrator.ts:432 + sessions.ts:103 (both byte-parallel copies preserved). `scanTailForNewestMessageAt` defined at ssh-poll-orchestrator.ts:543 + sessions.ts:168. `scanTailForLatestAiTitle` still called at ssh-poll-orchestrator.ts:1698 and sessions.ts:484. `isAshleyRealUserTurn` still called by `scanTailForLayer1RecyclingSignal` at ssh-poll-orchestrator.ts:666. `__scanTailForNewestMessageAtForTests` test-only exports added at both sites (ssh-poll-orchestrator.ts:537 + sessions.ts:197) to preserve byte-level regression coverage. `discoverIdentityJsonlPathViaChannel` defined at ssh-poll-orchestrator.ts:719, still called at :1612 for aiTitle discovery. |
| D-09 | No backfill. On ship day the store is empty; every identity starts at "never" and rises naturally as Ashley sends. | VERIFIED | Zero backfill logic for `identity_send_log` in db/index.ts, identity-send-log-store.ts, or identity-send-log-routes.ts. The only "backfill" mentions in the entire touched codebase are pre-existing `usernameDomainBackfills` in db/index.ts:1406 (Guac credentials — unrelated to Phase 85). Orchestrator + sessions.ts both fail-open to null on empty store (D-09 first-ship contract). |
| D-10 | Multi-device consistency via shared Skynet backend. Sending device sees optimistic stamp instantly; other device sees it on next status frame (~2s poll). | VERIFIED | Backend authority: `POST /identity-send-log/stamp` at identity-send-log-routes.ts:34-107 with `authenticateJWT` middleware. Route mounted at database.ts:1895 `app.use("/identity-send-log", identitySendLogRoutes)`. Both frontends POST to same backend (shared skynet-data SQLite). Sending device sees optimistic advance via `seedSessionLastMessageAt` at ComposeBox.tsx:477. Other device polls fleet-status → next tick's `getIdentityLastSend` at ssh-poll-orchestrator.ts:1650 returns fresh value → publishes SessionState with updated lastMessageAt. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/backend/database/db/schema.ts` | Drizzle `identitySendLog` table export | VERIFIED | 748-754 (7 lines net addition with 5-line header comment) |
| `src/backend/database/db/index.ts` | CREATE TABLE IF NOT EXISTS + forceSave | VERIFIED | 527-536 CREATE inside multi-table exec; 1727-1745 forceSave in try/catch |
| `src/backend/fleet-status/identity-send-log-store.ts` | Two exports: `stampIdentityLastSend` + `getIdentityLastSend` | VERIFIED | 231 lines. stampIdentityLastSend at :65-181 with validation, monotonic guard, upsert, forceSave. getIdentityLastSend at :194-230 fail-open reader. |
| `src/backend/fleet-status/identity-send-log-routes.ts` | POST /stamp auth-gated route | VERIFIED | 110 lines. authenticateJWT middleware, validation, dispatch to store, 204/400/500 status contract |
| `src/backend/database/database.ts` | Router mount at /identity-send-log | VERIFIED | Import at :54, mount at :1895 |
| `src/backend/fleet-status/ssh-poll-orchestrator.ts` | Swap lastMessageAt derivation source | VERIFIED | Import at :61, store lookup at :1648-1674, tail-scan call removed |
| `src/backend/database/routes/sessions.ts` | Swap /sessions/list lastMessageAt source | VERIFIED | Import at :24, sendLogLookupBlock at :410-437, tail-scan call removed |
| `src/ui/api/identity-send-log-api.ts` | Fire-and-forget POST client | VERIFIED | 45 lines. stampIdentitySendLog void return, error-swallow, empty-name guard |
| `src/ui/features/pretty-view/ComposeBox.tsx` | Hook useComposeSend with stamp + optimistic advance | VERIFIED | Imports at :12,14; hook deps at :442-449; guarded stamp block at :474-496; caller update at :1230 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| ComposeBox useComposeSend | stampIdentitySendLog | direct import + fire-and-forget call | WIRED | ComposeBox.tsx:12 import, :476 call |
| ComposeBox useComposeSend | seedSessionLastMessageAt | direct import + call | WIRED | ComposeBox.tsx:14 import, :477 call |
| identity-send-log-api | POST /identity-send-log/stamp | authApi.post fire-and-forget | WIRED | identity-send-log-api.ts:28 |
| identity-send-log-routes | stampIdentityLastSend | direct import + await | WIRED | identity-send-log-routes.ts:23 import, :83 await |
| ssh-poll-orchestrator | getIdentityLastSend | direct import + call inside per-tick loop | WIRED | ssh-poll-orchestrator.ts:61 import, :1650 await |
| sessions.ts | getIdentityLastSend | direct import + call inside per-row Promise.all | WIRED | sessions.ts:24 import, :412 await |
| identity-send-log-store | DatabaseSaveTrigger.forceSave | post-write awaited call in try/catch | WIRED | identity-send-log-store.ts:169 |
| identity-send-log-store | identitySendLog schema | drizzle insert/select | WIRED | identity-send-log-store.ts:44 import, :109-158 use |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| identity-send-log-store getIdentityLastSend | `rows[0].lastSendAt` | db.select from identitySendLog table (SQLite) | Yes — real drizzle query on populated table | FLOWING |
| identity-send-log-store stampIdentityLastSend | write path | db.insert onConflictDoUpdate | Yes — real drizzle upsert + forceSave | FLOWING |
| ssh-poll-orchestrator derivedLastMessageAt | `stored` from `getIdentityLastSend(tmuxSession)` | store module → SQLite table | Yes — real store lookup on every per-tick per-session pass | FLOWING |
| sessions.ts row.lastMessageAt | `stored` from `getIdentityLastSend(row.sessionName)` | store module → SQLite table | Yes — real per-row store lookup in Promise.all | FLOWING |
| ComposeBox useComposeSend | `stampTs = Date.now()` | Date.now() at call site | Yes — fresh millis timestamp captured per send | FLOWING |
| identity-send-log-api authApi.post | `{ identityName, ts }` body | ComposeBox call site (real identityName prop) | Yes — real network POST via authApi | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Migration test — new table shape + idempotence | `npx vitest run src/backend/database/db/index.migration.test.ts` | 15/15 pass (was 11 pre-79) | PASS |
| Store contract — insert/update/monotonic/forceSave | `npx vitest run src/backend/fleet-status/identity-send-log-store.test.ts` | 10/10 pass | PASS |
| Route contract — auth, validation, 204/400/500 | `npx vitest run src/backend/fleet-status/identity-send-log-routes.test.ts` | 9/9 pass | PASS |
| Orchestrator source swap + regression | `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` | 128/128 pass (was 122 pre-79) | PASS |
| /sessions/list source swap + regression | `npx vitest run src/backend/database/routes/sessions.test.ts` | 35/35 pass (was 30 pre-79) | PASS |
| API client fire-and-forget contract | `npx vitest run src/ui/api/identity-send-log-api.test.ts` | 5/5 pass | PASS |
| Universal-funnel hook coverage | `npx vitest run src/ui/features/pretty-view/ComposeBox.send-log-hook.test.tsx` | 8/8 pass | PASS |

**Total scoped-test coverage:** 210/210 Phase 85 scoped tests pass (17 net new Phase 85 test cases added across 4 files + 6 new integration cases in ssh-poll-orchestrator + 5 new in sessions.test.ts).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| D-01 | 85-01, 85-02, 85-03 | New table in skynet-data SQLite | SATISFIED | Truth #3 evidence + D-01 traceability |
| D-02 | 85-01, 85-02, 85-03 | Keyed on identity name only | SATISFIED | D-02 traceability |
| D-03 | 85-06 | Universal rule for send sources | SATISFIED | D-03 traceability |
| D-04 | 85-06 | Hook site = useComposeSend.send | SATISFIED | D-04 traceability |
| D-05 | 85-02, 85-03, 85-06 | Attempts count regardless of delivery | SATISFIED | D-05 traceability |
| D-06 | 85-06 | Client-side optimistic stamp on send frame | SATISFIED | D-06 traceability |
| D-07 | 85-04, 85-05 | Backend derivation source swap | SATISFIED | D-07 traceability |
| D-08 | 85-04, 85-05 | Old scan pipeline stays alive | SATISFIED | D-08 traceability |
| D-09 | (all) | No backfill first-ship | SATISFIED | D-09 traceability |
| D-10 | 85-03, 85-06 | Multi-device via shared backend | SATISFIED | D-10 traceability |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX/PLACEHOLDER markers introduced by Phase 85 | Info | Clean scan across all 11 touched files |
| — | — | No hardcoded empty data rendered to user | Info | All render paths trace to real store queries |
| — | — | No stub returns / empty implementations | Info | Every new function has real implementation with tests |

### Deferred / Out-of-Scope Items

Pre-existing backend tsc errors documented in `deferred-items.md`:
- `src/backend/database/routes/host.ts(473,15)` — TS2322 (predates Phase 85)
- `src/backend/database/routes/host.ts(1182,17)` — TS2322 (predates Phase 85)
- `src/backend/database/routes/pretty-view-fetch-host-file.ts(440,56)` — TS2345 (predates Phase 85)

None of these are in Phase 85 touched files. Left for a dedicated typecheck-cleanup pass per SCOPE BOUNDARY.

### Human Verification Required

None required from the automated verification pass. The following orchestrator-scope post-deploy manual sanity checks are noted in 85-06-SUMMARY for the ship-gate but do NOT block phase completion (they are ship-time validation, not verification of code intent):

1. Type text into a compose box for an identity not-recently-sent-to (e.g. "lulabelle"). Press Enter. Observe: lulabelle's row jumps instantly to top-of-middle-zone on sending device (D-06 optimistic).
2. Observe on other device: within one fleet-status frame (~2s), lulabelle is at top-of-middle-zone (D-10 multi-device).
3. Repeat with reset button, thumbs-up, recap — each produces the same jump (D-03 universal).
4. Verify Ashley's original 2026-09-06 bug: Ivy (which recycled overnight) rises above Lulabelle after Ashley sends to Ivy once, regardless of Ivy's transcript state.

These are ship-gate validation for the orchestrator, not verifier concerns — the code path evidence above proves the mechanism works; ship-time validation confirms the deploy landed cleanly.

### Gaps Summary

**No gaps.** All 5 must-haves verified with codebase evidence. All 10 D-decisions (D-01 through D-10) traced to specific line-referenced implementations. All key wiring links WIRED. All 210 scoped Phase 85 tests pass. Comparator, wire shape, working-store max-wins contract, pinned + RDP zone sort keys all confirmed untouched via git commit sweep across the 22 Phase 85 commits.

The phase goal — "Replace the SOURCE of the middle-zone recency signal in the conversation list, from remote SSH tail-scan of each identity's newest JSONL to a per-identity send timestamp recorded in Skynet's own skynet-data SQLite, keyed on identity name, stamped on every send from the compose surface's universal send funnel" — is achieved end-to-end:

1. **Storage exists** (D-01, D-02) — schema.ts + db/index.ts + forceSave contract, tested via 4 migration cases.
2. **Store seam is real** (D-05) — identity-send-log-store.ts with monotonic upsert + fail-open reads + forceSave in try/catch, tested via 10 unit cases.
3. **HTTP write surface exists** (D-10) — POST /identity-send-log/stamp auth-gated + validated + dispatched, tested via 9 route cases.
4. **Backend derivation swapped** (D-07) — ssh-poll-orchestrator + sessions.ts BOTH read from getIdentityLastSend instead of scanTailForNewestMessageAt, tested via 11 new integration cases.
5. **Old scan pipeline preserved** (D-08) — isAshleyRealUserTurn + scanTailForNewestMessageAt + scanTailForLatestAiTitle + discoverIdentityJsonlPathViaChannel all defined at both sites; scanTailForLayer1RecyclingSignal still uses isAshleyRealUserTurn; aiTitle scan still runs.
6. **Frontend write path exists** (D-03, D-04, D-05, D-06) — useComposeSend.send fires stampIdentitySendLog (backend POST) + seedSessionLastMessageAt (optimistic client) on every compose-surface send, tested via 13 frontend cases.
7. **Wire shape + comparator + working-store untouched** — zero Phase 85 commits modified conversation-store.ts, wire-protocol.ts, or session-working-store.ts.
8. **No backfill** (D-09) — zero backfill logic anywhere; store fills naturally as Ashley sends.

Phase 85 is ready for orchestrator ship-gate.

---

*Verified: 2026-09-07T18:22:00Z*
*Verifier: Claude (gsd-verifier)*
