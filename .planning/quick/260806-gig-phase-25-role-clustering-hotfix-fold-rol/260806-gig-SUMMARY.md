---
phase: 260806-gig
plan: "01"
subsystem: fleet-session-role-clustering
tags: [hotfix, sessions, identities, conversation-store, role-clustering, tdd]
dependency_graph:
  requires: [phase-25-role-clustering]
  provides: [working-role-resolution-in-sessions-list]
  affects: [conversation-store, fleet-session-display]
tech_stack:
  added: []
  patterns:
    - "Per-identity Promise.race(PER_HOST_TIMEOUT_MS) + try/catch in per-host session enum loop"
    - "resolveRoleForIdentity on same already-open SSH conn (REMOTE branch)"
    - "sessionRoleByKey Map threaded through rowFromTab for openTab role resolution"
key_files:
  created:
    - src/backend/database/routes/sessions.test.ts
  modified:
    - src/backend/database/routes/sessions.ts
    - src/backend/database/routes/identities.ts
    - src/ui/api/sessions-api.ts
    - src/ui/state/conversation-store.ts
    - src/ui/state/conversation-store.cache.test.ts
decisions:
  - "Fold role resolution into per-host session enum path (same SSH conn) per LOCKED Ashley decision — not re-debated"
  - "Per-identity timeout uses same PER_HOST_TIMEOUT_MS=3000 constant as list-sessions timeout"
  - "isFleetSession guard requires role field — old cached items without role get filtered (cold start on first post-deploy load, acceptable)"
  - "rowFromTab gets sessionRoleByKey Map parameter to prefer fleet-authoritative role over identitiesByKey fallback"
metrics:
  duration: "~20 minutes"
  completed: "2026-08-06T12:20:04Z"
  tasks_completed: 2
  files_changed: 6
---

# Phase 260806-gig Plan 01: Phase 25 Role Clustering Hotfix — Fold Role Resolution into Session Enumeration

## One-Liner

Fold `resolveRoleForIdentity` into `/sessions/list` per-host SSH conn so every fleet session gets its real role (box-maintainer, chef, etc.) from the identity's home box — fixing Phase 25 role clustering that shipped visibly broken because identities.ts used LOCAL-only lookup that only worked for tina.

## What Was Built

### Task 1: Fold role resolution into per-host session enumeration + write real un-mocked test (commit d3ce455)

- Extended `TmuxSessionRow` with `role: string | null`.
- Inside the per-host `Promise.all` mapper in `sessions.ts`, after `tmux list-sessions` output is parsed into rows (and BEFORE `finally { conn.end() }`), added a parallel `Promise.all(rows.map(...))` pass that calls `resolveRoleForIdentity(conn, row.sessionName)` for each session using the SAME already-open SSH conn from `connectOneShot`.
- Each per-identity call wrapped in `Promise.race(PER_HOST_TIMEOUT_MS=3000ms)` + try/catch. Any throw (timeout, missing frontmatter, IDENTITY_KEY_RE gate failure, SSH exec error) → `role = null` for that single row. Other rows on the same host return normally.
- Per-identity failures logged at debug level with `operation: "sessions_list_role_resolve_skip"`.
- Created `src/backend/database/routes/sessions.test.ts` — first un-mocked test that exercises the REAL `resolveRoleForIdentity` + fake SSH conn stub (the Phase 25 mocked tests silently passed with the broken LOCAL-null-return behavior).
  - Test 1 (happy path): poppy → box-maintainer, patricia → chef, execCommand called on SAME conn, no second connectOneShot.
  - Test 2 (missing frontmatter): ephemeral-work gets role:null, poppy keeps role:box-maintainer.
  - Test 3 (per-identity timeout): hung cat → role:null, good row keeps role, response bounded within 8s.
  - Test 4 (host-level failure): connectOneShot throws → host silently dropped, no rows.

### Task 2: Retire identities.ts:82 call site + plumb role through frontend (commit 13f8e12)

**Backend — identities.ts:**
- Removed `resolveRoleForIdentity(null, row.identityKey)` call at line 82 and the surrounding async `Promise.all`/enrichment block.
- Replaced with synchronous `rows.map((row) => publicIdentity(row, null))` — wire shape preserved (role: null on wire).
- Dropped now-unused `resolveRoleForIdentity` import.

**Frontend — sessions-api.ts:**
- Added `role: string | null` to `RemoteTmuxSession` interface.

**Frontend — conversation-store.ts:**
- Added `role: string | null` to `FleetSession` type (mirrors RemoteTmuxSession).
- Updated `isFleetSession` type guard to require `(r.role === null || typeof r.role === "string")`.
- Updated `readFleetSessionsCache` canonical copy to include `role: item.role` (cache round-trips role).
- Updated `writeFleetSessionsCache` canonical map to include `role: s.role`.
- `fleetSyntheticRows`: switched role source from `state.identitiesByKey.get(matchKey)?.role ?? null` to `session.role` (fleet-authoritative).
- Built `sessionRoleByKey` Map at top of `computeSnapshot` keyed on `dedupKey(hostIdStr, sessionName)`.
- Refactored `rowFromTab(tab)` to `rowFromTab(tab, sessionRoleByKey)` — openTab rows now prefer fleet-authoritative role, fall back to identitiesByKey for tabs without a matching fleet session.
- Updated all 3 call sites of `rowFromTab` in `computeSnapshot` (activeSetRows, pinned, byHostId loops).

**Test fix:**
- Updated `conversation-store.cache.test.ts` fixture objects (`SAMPLE_A`, `SAMPLE_B`) to include `role` field (required by updated type guard).
- Updated `write-only-canonical-fields` test to expect 5 canonical fields (added `role`).

## Verification Results

- `npm run build:backend`: EXIT 0 (clean)
- `npm run build`: EXIT 0 (clean)
- `npx vitest run src/backend/database/routes/sessions.test.ts`: 4/4 tests pass
- `npx vitest run` (full suite): 122 test files, 1484 tests pass, 6 skipped, 0 failures

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] conversation-store.cache.test.ts fixtures missing role field**
- **Found during:** Task 2 verification (full vitest run)
- **Issue:** After updating `isFleetSession` to require `(r.role === null || typeof r.role === "string")`, existing test fixtures `SAMPLE_A` and `SAMPLE_B` in `conversation-store.cache.test.ts` lacked the `role` field and failed the guard, causing 4 test failures. The `write-only-4-fields` test also needed to expect 5 canonical fields.
- **Fix:** Added `role: "box-maintainer"` to `SAMPLE_A`, `role: null` to `SAMPLE_B`; updated test name to `write-only-canonical-fields` and expected 5 field keys.
- **Files modified:** `src/ui/state/conversation-store.cache.test.ts`
- **Commit:** 13f8e12

## Known Stubs

None — all data flows are wired. The `/identities` endpoint now returns `role: null` intentionally (wire contract preserved; role is authoritative from `/sessions/list` now).

## Threat Flags

No new security surface introduced. All changes are within the existing auth boundary (authenticated tina admin → `/sessions/list`). Role reads use the same SSH conn and same `IDENTITY_KEY_RE` gate as pre-existing fleet operations.

## Self-Check

- [x] `src/backend/database/routes/sessions.ts` — exists, has `resolveRoleForIdentity(conn, ...)` call
- [x] `src/backend/database/routes/sessions.test.ts` — exists, 4 tests pass
- [x] `src/backend/database/routes/identities.ts` — `resolveRoleForIdentity` import and call both removed
- [x] `src/ui/api/sessions-api.ts` — `role: string | null` added to RemoteTmuxSession
- [x] `src/ui/state/conversation-store.ts` — FleetSession.role added, isFleetSession updated, cache helpers updated, fleetSyntheticRows uses session.role, rowFromTab takes sessionRoleByKey Map
- [x] Commit d3ce455 exists (Task 1)
- [x] Commit 13f8e12 exists (Task 2)
- [x] `npm run build:backend` exit 0
- [x] `npm run build` exit 0
- [x] `npx vitest run` exit 0 (1484 pass, 0 fail)

## Self-Check: PASSED
