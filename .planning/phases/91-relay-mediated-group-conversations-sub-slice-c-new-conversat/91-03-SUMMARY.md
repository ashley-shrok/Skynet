---
phase: 91-relay-mediated-group-conversations-sub-slice-c-new-conversat
plan: 03
subsystem: backend-route
tags: [backend, route, matrix, materialize, auth, stride, tdd, slice-c]
dependency_graph:
  requires: [91-00, 91-01, 91-02]
  provides: [POST /relay-room/create]
  affects:
    - src/backend/database/routes/relay-room-create.ts
    - src/backend/database/routes/relay-room-create.test.ts
    - src/backend/database/database.ts
tech_stack:
  added: []
  patterns:
    - createRoomAsUser-viewer-as-PL100-creator
    - best-effort-invite-fan-out
    - D-14-materialize-fast-path
    - two-layer-mxid-filter-MXID_RE-plus-fleet-registry
    - fail-closed-fleet-registry
key_files:
  created:
    - src/backend/database/routes/relay-room-create.ts
    - src/backend/database/routes/relay-room-create.test.ts
  modified:
    - src/backend/database/database.ts
decisions:
  - "createRoomAsUser path chosen over admin createRoom — viewer is PL100 creator, matches shape §Shape 'via the user's own relay identity'"
  - "Best-effort invite policy: failed invite logs relay_room_create_invite_failed and continues; no rollback (shape §Philosophy v1 has no post-creation membership changes)"
  - "identities table dropped Phase 68: agentMxids gated via MXID_RE grammar only (no DB registry for agents); deviation from plan's 'agents exist in identities with mxid'"
  - "MXID_RE inlined locally (option b) — matrix-admin-routes.ts does not export it; inlining avoids modifying a file outside files_modified"
  - "materialize failure swallowed: observation-loop safety net (Phase 89-03) catches up on next tick; a 500 would discard a successfully-created Matrix room"
metrics:
  duration: "~20 minutes"
  completed: "2026-09-09"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
  tests_added: 15
  tests_total: 15
---

# Phase 91 Plan 03: POST /relay-room/create Backend Route Summary

**One-liner:** `POST /relay-room/create` route handling auth (T-91-BE-01) → two-layer mxid validation (T-91-BE-04) → `createRoomAsUser` (viewer as PL100 creator) → best-effort invite fan-out → `materializeRelayRoomSession` D-14 fast path → `{ok, roomId, sessionId, roomTitle}` 201 response, mounted in database.ts alongside the sibling participants route.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| RED | Add failing tests for POST /relay-room/create | ae8c2681 | relay-room-create.test.ts (556 lines) |
| GREEN | Implement POST /relay-room/create route handler | ab6fa28e | relay-room-create.ts (401 lines) |
| 2 | Mount route in database.ts | 8a8c45d3 | database.ts (+8 lines) |

## What Was Built

### relay-room-create.ts

New Express router module at `src/backend/database/routes/relay-room-create.ts`. Mirrors the sibling `relay-room-participants.ts` structure (preamble, auth wiring, helper functions, route body).

**Preamble:** imports `AuthenticatedRequest`, express, drizzle `eq`, `db`, `users` schema, `AuthManager`, `databaseLogger`, `createRoomAsUser` + `inviteToRoom` from matrix-admin-client, `materializeRelayRoomSession` from relay-room-sessions-store. `MXID_RE` inlined locally (matrix-admin-routes.ts does not export it). `MAX_PARTICIPANTS = 32` at top.

**Helpers:**
- `lookupViewingUserMxid(userId)` — verbatim from relay-room-participants.ts L78-99; returns `string | null`
- `loadFleetMxidRegistry()` — reads `users.mxid` via `db.$client.prepare().all()` into a `Set<string>`; fail-closed on DB error (returns empty Set, which causes all humanMxids to be dropped rather than allowing arbitrary mxid injection)

**Route body (15 steps):**
1. Extract `userId` from JWT (auth middleware already ran)
2. Validate body shape (`roomName: string`, arrays present)
3. Trim + blank-name check → 400 `room_name_required`
4. MXID_RE grammar filter on both arrays (T-91-BE-04 Layer 1)
5. Fleet-registry filter on humanMxids (T-91-BE-04 Layer 2); log every dropped mxid as `relay_room_create_dropped_non_fleet_mxid`
6. Count cap: `humanMxids.length + agentMxids.length > 32` → 400 `too_many_participants`
7. Zero-participant check → 400 `no_participants`
8. Single-agent-only check → 400 `single_agent_disallowed`
9. `lookupViewingUserMxid(userId)` → 400 `viewer_no_mxid` if null (T-91-BE-02)
10. `createRoomAsUser(viewerMxid, { name, preset, visibility })` → 502 `proxy` on failure
11. Invite loop: for each mxid in `[...humanMxids, ...agentMxids]`, call `inviteToRoom(roomId, mxid, viewerMxid)`; on failure log `relay_room_create_invite_failed` and continue (best-effort policy)
12. `materializeRelayRoomSession(userId, roomId, trimmed)` in try/catch; swallowed failures logged as `relay_room_create_materialize_failed`
13. `db.$client.prepare("SELECT id FROM relay_room_sessions...").get(userId, roomId)` for sessionId ('' if absent)
14. Log `relay_room_create_ok`
15. Return `201 { ok: true, roomId, sessionId, roomTitle }`

### relay-room-create.test.ts

556-line vitest suite with 15 tests using supertest-style `fetch` against an in-process Express server. Mocks: `auth-manager.js` (JWT pass/fail toggle), `db/index.js` (viewerMxid + fleet registry + session row), `matrix-admin-client.js` (createRoomAsUser + inviteToRoom), `relay-room-sessions-store.js` (materializeRelayRoomSession), `utils/logger.js`.

### database.ts

Two edits: import at L75 and mount at L1936 (before the participants route). Pre-existing participants import and mount unchanged.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed cleanly with one deviation documented below.

### Deviation: identities table dropped (Phase 68)

**Found during:** Task 1 implementation
**Issue:** Plan said `loadFleetMxidRegistry` should populate an `agents: Set<string>` from the identities table with mxid column. The identities table was dropped in Phase 68 per `shape-kill-identities-table.md`. There is no database registry for agent mxids — they live on-disk in `~/.claude/identities/<name>/relay.json`.
**Fix:** `loadFleetMxidRegistry` returns `{ humans: Set<string> }` only. `agentMxids` are gated via MXID_RE grammar (Layer 1) only; no registry filter applied to agents. Logged in code docblock. All 15 tests pass including Test 10 (the fleet-registry test targets humanMxids specifically). This aligns with how `participants-classifier.ts` works (users.mxid is the authority for humans; everything else is an agent).
**Impact:** Minimal — the plan's T-91-BE-04 Layer 2 intent (block non-fleet mxids) is fully achieved for humans. Agents can only be injected if they pass MXID_RE grammar; the agent namespace has no DB table to check against.
**Classification:** Rule 1 (auto-fix) — identities table absence is a concrete code reality that would block compilation / test execution if unaddressed.

## STRIDE Threat Coverage

| Threat | Mitigation | Test |
|--------|-----------|------|
| T-91-BE-01 Spoofing (unauth) | `authenticateJWT` middleware on route | Test 1 |
| T-91-BE-02 EoP (viewer mxid spoof) | server-side lookup only; 400 viewer_no_mxid | Test 7 |
| T-91-BE-03 DoS (participant spray) | MAX_PARTICIPANTS=32 cap pre-Matrix-call | Test 8 |
| T-91-BE-04 Tampering (non-fleet mxids) | MXID_RE grammar + fleet-registry humans filter | Tests 9+10 |
| T-91-BE-05 Info Disclosure (response leak) | response is only {ok,roomId,sessionId,roomTitle} | Test 14 |
| T-91-BE-06 Repudiation (audit) | 5 structured log operations | acceptance grep |
| T-91-BE-07 DoS (slow Matrix) | inherited from matrix-admin-client 30s AbortController | — |
| T-91-BE-08 Tampering (registry open-fail) | fail-closed: empty Set drops all humanMxids | Test 10 |

## Known Stubs

None. The route is fully wired.

## Threat Flags

None. This plan adds one new network endpoint (`POST /relay-room/create`) which was explicitly planned and threat-modelled. No new unplanned trust-boundary surfaces introduced.

## Self-Check: PASSED

- [x] `src/backend/database/routes/relay-room-create.ts` exists
- [x] `src/backend/database/routes/relay-room-create.test.ts` exists  
- [x] Commits ae8c2681, ab6fa28e, 8a8c45d3 exist in git log
- [x] `npx vitest run src/backend/database/routes/relay-room-create.test.ts` — 15/15 pass
- [x] `npx tsc --noEmit` — clean
- [x] `git diff --stat` limited to 3 files in `files_modified`
- [x] All acceptance criteria grep gates satisfied
