---
phase: 129-multi-user-single-host-support-per-user-visibility-gate-on-r
verified: 2026-09-23T06:17:56Z
status: passed
score: 8/8 shape promises verified
verifier: gsd-verifier (goal-backward)
must_haves:
  truths:
    - "Empty/absent users list = visible to everyone (fallback preserves current behavior)"
    - "Intersection gate: BOTH role.users AND identity.users must pass; empty lists fall open"
    - "Multi-user hosts auto-tag creator on create; single-user hosts write no users: key (pre-129 byte-shape)"
    - "Role picker in new-agent UI filters by role gate via GET /roles?hostId=<n>"
    - "Hidden identities leak no evidence across 5 identity-carrying WS frames + GET /identities + GET /sessions/list + POST /conversation-search"
    - "No new UI affordance for viewing/editing users lists (backend-only feature)"
    - "Not a permission system — visibility filter only (no admin override, no bypass warning)"
    - "identity-clone.ts explicitly untouched (v1 deferral)"
  artifacts:
    - path: src/backend/fleet-status/identity-visibility-gate.ts
      provides: "Pure isIdentityVisibleToUser() intersection gate"
    - path: src/backend/utils/host-user-counter.ts
      provides: "isHostMultiUser + getUsernameForUserId DB helpers"
  key_links:
    - from: "GET /identities"
      to: "identity-visibility-gate.ts"
      via: "identities.ts L478 isIdentityVisibleToUser call, drops row to null"
    - from: "GET /sessions/list"
      to: "identity-visibility-gate.ts"
      via: "sessions.ts L549 isIdentityVisibleToUser call, visibleMap filter"
    - from: "GET /roles?hostId"
      to: "identity-visibility-gate.ts"
      via: "roles-list-for-host.ts L332 isIdentityVisibleToUser(null, raw, callerUsername) role-side"
    - from: "POST /conversation-search"
      to: "identity-visibility-gate.ts"
      via: "conversation-search.ts L504 batched gateMap fail-CLOSED filter"
    - from: "WS filterAppFrame"
      to: "identity-visibility-gate.ts (via injected resolveIdentityGate closure)"
      via: "app-frame-filter.ts 5 branches: update, snapshot, gone, identity-archived, session-project-changed"
    - from: "POST /roles"
      to: "host-user-counter.ts"
      via: "roles-create.ts L583 isHostMultiUser + L585 getUsernameForUserId + L587 cosmetics.users = [creator]"
    - from: "POST /identities/birth"
      to: "host-user-counter.ts + identity-birth-orchestrator.buildIdentityFileBody"
      via: "identity-birth.ts L514 isHostMultiUser + L527 getUsernameForUserId; orchestrator L625 pairs.push(['users', [creatorUsername]])"
---

# Phase 129: multi-user-single-host support — Verification Report

**Phase Goal:** Per-user visibility gate on roles and identities. A role or
identity can name the users it belongs to (via `users:` frontmatter list) and
becomes hidden to everyone else. Fallback preserves current behavior when the
list is empty/absent. Applied deeply enough to leave no evidence anywhere in
a user's view of a host from which they're gated out.

**Verified:** 2026-09-23T06:17:56Z
**Status:** PASSED
**Re-verification:** No — initial goal-backward verification (Plan 129-08 per-plan gate had already re-verified after 3f2af75a).

## Goal Achievement

### Observable Truths

| # | Shape Promise | Status | Evidence |
|---|---|---|---|
| 1 | Empty/absent `users` = visible to everyone (fallback) | VERIFIED | `identity-visibility-gate.ts:63-72` — `!Array.isArray(users) \|\| users.length === 0` short-circuits gate to open. Tests: `identity-visibility-gate.test.ts:36-40` (empty & absent lists fall open); `identity-artifact-reader.ts:3251-3258` — empty array normalized to absent (out.users stays absent). |
| 2 | Intersection gate: BOTH role AND identity gates must pass | VERIFIED | `identity-visibility-gate.ts:74-75` — `return identityGateOpen && roleGateOpen`. Tests: `identity-visibility-gate.test.ts:22-100` — full-matrix (10 cases) verifies AND semantics + narrowing scenarios. |
| 3 | Multi-user hosts auto-tag creator; single-user hosts stay silent | VERIFIED | `roles-create.ts:583-604` — `if (isMultiUser) { cosmetics.users = [creatorUsername] }`; `identity-birth.ts:511-549` + `identity-birth-orchestrator.ts:621-626` — same shape. Tests: `roles-create.test.ts:754` "Test A: single-user host → NO users: key"; `roles-create.test.ts:777` "Test B: multi-user (direct-user share) → auto-tag"; `identity-birth.test.ts:1304+` "Phase 129: auto-tag on multi-user hosts". |
| 4 | Role picker filters via GET /roles?hostId=<n> | VERIFIED | `roles-list-for-host.ts:332` — `isIdentityVisibleToUser(null, raw, callerUsername)` role-side gate; hidden roles dropped from response. Tests: `roles-list-for-host.test.ts:863` Test C: `users:[ashley]` → Ashley sees, Zoe doesn't; Test D: `users:[ashley,zoe]` → both see. Frontend naturally receives shorter list (zero UI change). |
| 5 | Deep gate — no leaks across 5 identity-carrying surfaces | VERIFIED | (a) `GET /identities`: `identities.ts:478` — hidden identity returns null before publicIdentity; (b) `GET /sessions/list`: `sessions.ts:549` — visibleMap filter with fused SSH read; (c) `POST /conversation-search`: `conversation-search.ts:504+530` — batched fail-CLOSED gateMap; (d) WS 5-frame gate in `app-frame-filter.ts`: `update` (L315-340), `snapshot` (L342-381), `gone` (L271-293), `identity-archived` (L295-313), `session-project-changed` (L401-427). All 5 branches call `canUserSeeIdentity` after host gate short-circuit. |
| 6 | No new UI affordance | VERIFIED | grep of `src/ui/**` for `Phase 129`/`isIdentityVisibleToUser`/`users:` returns zero hits related to this phase's semantic. All 129-* SUMMARY key-files are backend-only. Frontend just renders shorter API responses. |
| 7 | Not a permission system — visibility filter only | VERIFIED | `identity-visibility-gate.ts:17-20` file docblock explicitly states "hides rows from a user's sidebar; does NOT enforce SSH access, does NOT block direct-URL avatar reads, does NOT gate write endpoints". Null callerUsername (unknown JWT) falls OPEN (`identity-visibility-gate.ts:58`), not closed — visibility filter, not permission system. No admin-override code, no bypass warning UI. |
| 8 | identity-clone.ts explicitly untouched (v1 deferral) | VERIFIED | `grep "Phase 129\|isIdentityVisibleToUser\|isHostMultiUser\|getUsernameForUserId\|creatorUsername" src/backend/database/routes/identity-clone.ts` returns **zero hits**. 129-07 summary decision confirms git diff shows zero-byte-change. |

**Score:** 8/8 truths verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/backend/fleet-status/identity-visibility-gate.ts` | Pure intersection gate | VERIFIED | 76 lines. Pure function, zero external deps beyond RawCosmetics type. Full docblock covers D-2/D-3/D-8, case-sensitivity lock, null-caller bypass. |
| `src/backend/utils/host-user-counter.ts` | isHostMultiUser + getUsernameForUserId | VERIFIED | 155 lines. Implements 4-query pattern (owner + direct shares + role shares + role-member expansion) per Assumption A6 lock. Structured debug logs at entry+exit. |
| `src/backend/database/routes/identities.ts` | GET /identities gate | VERIFIED | Wired at L478 with fallback null-drop onto existing L450 filter. |
| `src/backend/database/routes/sessions.ts` | GET /sessions/list gate | VERIFIED | Wired at L549. Parallel visibleMap avoids TmuxSessionRow shape mutation. Fused readIdentityFile (Assumption A5). |
| `src/backend/database/routes/roles-list-for-host.ts` | Role picker gate | VERIFIED | Wired at L332. Option A raw-cosmetics preservation keeps wire-shape unchanged. |
| `src/backend/database/routes/conversation-search.ts` | Search gate (fail-CLOSED exception) | VERIFIED | `gateHostRows` L453-538. Batched O(unique keys). `=== true` filter locks fail-CLOSED discipline. |
| `src/backend/fleet-status/app-frame-filter.ts` | WS 5-frame gate | VERIFIED | 5 identity-carrying branches all gated: update, snapshot, gone, identity-archived, session-project-changed. Injected resolveIdentityGate closure (no DB/SSH imports leak into this file). |
| `src/backend/database/routes/roles-create.ts` | Auto-tag on multi-user | VERIFIED | L583-604 auto-tag branch. Case-preserved. Fail-open on lookup miss with warn log. Structured info log on auto-tag success. |
| `src/backend/database/routes/identity-birth.ts` | Auto-tag on multi-user (route handler DB lookup) | VERIFIED | L511-549 orchestrator-pure split: route owns DB lookup, threads `creatorUsername` through BirthOptions. Defensive fail-open on isHostMultiUser throw (T-129-07-04 mitigation). |
| `src/backend/database/routes/identity-birth-orchestrator.ts` | buildIdentityFileBody users: pair | VERIFIED | L621-626 `pairs.push(["users", [opts.creatorUsername]])` under absent-⇒-omit guard. Orchestrator stays pure (zero DB imports). |
| `src/backend/database/routes/identity-clone.ts` | UNTOUCHED (v1 exclusion) | VERIFIED | Zero Phase-129 hits. Byte-untouched per 129-07 decision + 129-08 re-verification (empty diff HEAD~10). |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| GET /identities | identity-visibility-gate | `identities.ts:24-25` import + L478 call | WIRED | Returns null before publicIdentity — hidden row never constructed. |
| GET /sessions/list | identity-visibility-gate | `sessions.ts:29-30` import + L549 call | WIRED | visibleMap<sessionName, boolean> parallel Map; `!== false` filter preserves D-8 fail-open contract. |
| GET /roles?hostId | identity-visibility-gate | `roles-list-for-host.ts:64-65` import + L332 call | WIRED | Role-side only (identityCos=null passed) — role picker is pre-identity-existence. |
| POST /conversation-search | identity-visibility-gate | `conversation-search.ts:108,110` import + `gateHostRows` L453 | WIRED | Fail-CLOSED (=== true filter). Covers both live + archive branches via shared gateMap. |
| WS filterAppFrame | identity-visibility-gate (via injected closure) | `app-frame-filter.ts:94-98` ctx.resolveIdentityGate + 5 frame branches | WIRED | Production closure composed in `starter.ts` (per 129-05 summary key-files). |
| POST /roles | host-user-counter | `roles-create.ts:119-120` import + L583/L585 calls | WIRED | Auto-tag mutation at L587 pre-yaml.dump; picked up naturally by existing dump at L619. |
| POST /identities/birth | host-user-counter + orchestrator pairs.push | `identity-birth.ts:38-39` import + L514/L527; orchestrator L625 | WIRED | Two-file split preserved — orchestrator has zero DB imports. |

All key links WIRED end-to-end.

### Data-Flow Trace (Level 4)

The `users:` field is a proper data source with real flow:
- **On disk**: role/identity markdown frontmatter (SSH-read per request or per 2s poll).
- **Parse**: `identity-artifact-reader.ts:3251-3258` narrows `src.users` array-of-strings → normalized non-empty list.
- **Gate**: `isIdentityVisibleToUser(identityCos, roleCos, callerUsername)` runs at every read seam.
- **Write**: `roles-create.ts:587` and `identity-birth-orchestrator.ts:625` push `["users", [creatorUsername]]` into fresh frontmatter on multi-user hosts only.

No hardcoded empty defaults leak to callers. Where the gate falls open (null caller, empty/absent list), the write path never emitted the field (absent-⇒-omit).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Backend typecheck | `npm run build:backend` | exit 0, no diagnostics | PASS |
| Phase-wide vitest sweep (recorded by 129-08 re-verification) | `npx vitest related --run <13 files>` | 1781/1 skipped (unchanged) | PASS (per 129-08 SUMMARY; not re-run since no source changes since) |

### Requirements Coverage

Phase 129 was seeded directly from `shape-multi-user-single-host-support.md` and does not use REQ-* IDs — the shape file's promises ARE the requirements. Each of the 8 shape promises in the Observable Truths table maps 1:1 to a "What would make it wrong" bullet or a "Scope edges → In" bullet in the shape file. All 8 satisfied.

### Anti-Patterns Found

None in scope.

- No debt markers (TBD/FIXME/XXX) in Phase 129 files (Plan 129-08 grep matrix).
- No hardcoded empty stubs — every `users?: string[]` type declaration is intentional absent-⇒-omit shape.
- No orphan artifacts — every artifact created in 129-01 has a consumer in Waves 2/3.
- No leaks across the 13-surface no-leak audit table (Plan 129-08 Task 3 grep matrix confirmed all "YES" rows closed and identity-clone.ts as "NO" byte-untouched).

### Gap Summary

Zero gaps. Every shape promise has file+line evidence in the codebase and a corresponding test locking it in. Plan 129-08's phase-wide typecheck + vitest sweep + no-leak audit + identity-clone byte-untouched check all pass. Backend typecheck re-run at verification time confirms no drift since 129-08.

### Human Verification

None required. Phase 129 is backend-only (per shape D-6 "no UI affordance"); every truth is grep-verifiable and unit-tested. UI observation of the shorter sidebar / role picker naturally falls out of the shorter API responses — no visual polish, no new element, no interaction change to verify.

The single downstream orchestrator step remaining is `docker build` + `docker compose up --force-recreate` per box-maintainer standing directive; this is deployment, not verification, and is intentionally out of scope for the executor gate.

---

## VERIFICATION PASSED

All 8 shape promises delivered end-to-end. Phase 129 code-complete.

- **Shape file:** `.planning/shapes/shape-multi-user-single-host-support.md`
- **Read-path gates:** 4 REST endpoints + 5 WS frames — every "YES" row in RESEARCH § no-leak audit closed
- **Write-path auto-tag:** Both create endpoints on multi-user hosts; silent on single-user hosts
- **v1 scope lock:** identity-clone.ts byte-untouched (deferred per RESEARCH § no-leak audit table)
- **Backend typecheck:** GREEN (re-verified at verification time)
- **Phase-wide vitest sweep:** 1781/1 skipped (per 129-08 re-verification)
- **UI change:** None (per shape D-6 — sidebar naturally shorter from smaller API responses)

_Verified: 2026-09-23T06:17:56Z_
_Verifier: gsd-verifier (goal-backward)_
