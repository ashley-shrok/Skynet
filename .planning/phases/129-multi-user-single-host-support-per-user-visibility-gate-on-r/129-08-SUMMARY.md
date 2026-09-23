---
phase: 129-multi-user-single-host-support-per-user-visibility-gate-on-r
plan: 08
subsystem: verification-gate
tags: [verification, phase-gate, typecheck, vitest-sweep, no-leak-audit, BLOCKING]
dependency_graph:
  requires:
    - "129-01, 129-02, 129-03, 129-04, 129-05, 129-06, 129-07 (every wave of the phase)"
  provides:
    - "Phase-wide typecheck gate result (build:backend)"
    - "Phase-wide vitest sweep result (union of files_modified across Plans 01-07)"
    - "No-leak audit coverage matrix — every 'YES' row in RESEARCH § no-leak audit is grep-verified"
  affects:
    - "BLOCKS Phase 129 ship until Plan 129-05 is revised to fix 5 TypeScript errors in app-frame-filter.ts"
tech-stack:
  added: []
  patterns:
    - "Verification-only plan discipline: NO source edits, block the phase on failure, route back to responsible earlier plan"
key-files:
  created:
    - .planning/phases/129-multi-user-single-host-support-per-user-visibility-gate-on-r/129-08-SUMMARY.md
  modified: []
decisions:
  - "Task 1 FAILED with 5 TypeScript errors — all in Plan 129-05's src/backend/fleet-status/app-frame-filter.ts. Verification gate blocks the phase per plan spec. NO source patch applied from this plan — routed back to Plan 129-05 for fix."
  - "Task 2 (vitest sweep across all touched files) still executed and captured (1781/1781 pass) — gives the fix agent full context that the runtime tests were not affected by the type-system regression (mocked systemLogger doesn't type-check LogContext at runtime)."
  - "Task 3 (grep coverage matrix) executed and every 'YES' row confirmed; identity-clone.ts confirmed byte-untouched (0 hits — v1 scope lock preserved)."
  - "Ship remains orchestrator-owned per box-maintainer standing directive — no docker build / no docker compose up / no HTTPS verify performed. All 3 remain future-orchestrator work, gated on Plan 129-05 fix landing."
metrics:
  duration_seconds: ~180
  duration_human: "~3 min executor time (npm run build:backend + vitest sweep + grep matrix)"
  completed_date: 2026-09-23
  status: BLOCKING
---

# Phase 129 Plan 08: Phase-wide verification gate Summary — **BLOCKING**

**One-liner:** Verification-only phase-wide gate FAILED at Task 1 — 5 TypeScript
errors in `src/backend/fleet-status/app-frame-filter.ts` (all introduced by Plan
129-05's new debug log seams). Tests still pass (1781/1781) and the no-leak
audit coverage matrix is fully green, but the phase MUST NOT ship until Plan
129-05 is revised to fix the LogContext.hostId type mismatch. No source patch
applied from this plan.

## Status: BLOCKING

**Root cause:** Plan 129-05 (commit `879b84e4`) introduced 5 new
`systemLogger.debug` calls whose context objects pass `hostId` as a `string`
(matching the frame's wire-shape) but `LogContext.hostId` is typed as
`number | undefined` in `src/backend/utils/logger.ts` L38. Frontend `tsc --noEmit`
does NOT catch backend TS errors (that's the exact reason this Plan 129-08 gate
exists per box-maintainer directive). The Wave-2 vitest suites do not catch
this because `vi.mock`ed `systemLogger` bypasses LogContext type-checking at
runtime.

**Owning plan:** Plan 129-05 (WS surface identity gate — `app-frame-filter.ts`).

**Fix path:** Rerun `/gsd:execute-plan` or a targeted executor against
`129-05-PLAN.md` with a corrective task that either (a) coerces the string
`hostId` to number at each of the 5 log-context call sites (e.g.
`hostId: Number(frame.hostId)` — safe because the frame `hostId` is a numeric
string per the WS wire-shape), or (b) renames the field on the log context
(e.g. `hostIdStr: frame.hostId`) so it does not collide with the
`LogContext.hostId?: number` slot. Option (a) is simplest and preserves ops
grep-ability of the `hostId` context field.

---

## Task 1: `npm run build:backend` — **FAILED (blocking)**

### Exact stdout capture

```
> skynet@2.3.2 build:backend
> tsc -p tsconfig.node.json && node -e "require('fs').copyFileSync('src/backend/package.json','dist/backend/package.json')"

src/backend/fleet-status/app-frame-filter.ts(286,11): error TS2322: Type 'string' is not assignable to type 'number'.
src/backend/fleet-status/app-frame-filter.ts(306,11): error TS2322: Type 'string' is not assignable to type 'number'.
src/backend/fleet-status/app-frame-filter.ts(333,11): error TS2322: Type 'string' is not assignable to type 'number'.
src/backend/fleet-status/app-frame-filter.ts(368,15): error TS2322: Type 'string' is not assignable to type 'number'.
src/backend/fleet-status/app-frame-filter.ts(421,11): error TS2322: Type 'string' is not assignable to type 'number'.
```

Exit code: **non-zero** (tsc emitted 5 diagnostics).

### Diagnosis (for Plan 129-05 fix agent)

`src/backend/utils/logger.ts` L34-46 declares:

```typescript
export interface LogContext {
  hostId?: number;
  // ...other fields
}
```

Plan 129-05 introduced 5 new `systemLogger.debug` seams in
`src/backend/fleet-status/app-frame-filter.ts`, each passing `hostId` as a
string value (matching the wire-shape of the WS frame it's gating on). The 5
sites are:

| L    | Branch                         | Assignment source              | Wire shape |
| ---- | ------------------------------ | ------------------------------ | ---------- |
| 286  | `gone`                         | `hostId: frame.hostId`         | string     |
| 306  | `identity-archived`            | `hostId: frame.hostId`         | string     |
| 333  | `update`                       | `hostId: frame.state.hostId`   | string     |
| 368  | `snapshot` (per-state)         | `hostId: s.hostId`             | string     |
| 421  | `session-project-changed`      | `hostId: hostIdStr` (String()) | string     |

Every one of these is a NEW seam added by Plan 129-05's Task 2 GREEN commit
(`879b84e4`) — no pre-129 diagnostics exist. Wave-2 tests mock `systemLogger`
via `vi.mock` so the runtime call succeeds and the type mismatch was invisible
to `npx vitest related --run` on `app-frame-filter.test.ts` alone.

### Recommended fix (for Plan 129-05, not this plan)

At each of the 5 sites, coerce the string hostId to number before passing to
LogContext:

```typescript
// Example L286 (gone branch)
hostId: Number(frame.hostId),
```

Same shape for the other 4 sites. `Number()` on a numeric-string frame hostId
produces a valid integer; the WS wire-shape guarantees the string is a valid
number (validated by the frame's Zod schema at the subscription-registry
boundary). If a future concern is a NaN slipping through, wrap in a defensive
`Number.isFinite(...)` guard, but at the LogContext level a NaN would just log
as "NaN" which is not a security concern — this is a debug log, not a control
path.

### Task 1 verdict

- **Exit code:** non-zero (5 TS2322 diagnostics)
- **`npm run build:backend`:** FAILED
- **`npm run build`:** NOT RUN per plan spec ("If exit code != 0, STOP and record the exact error output in the SUMMARY.md — DO NOT proceed to `npm run build`")
- **Source patch from this plan:** NONE (this plan is a gate, not an editor)
- **Route to:** Plan 129-05

---

## Task 2: Phase-scoped vitest sweep — **PASSED (informational; not the gate's block)**

Even though Task 1 blocked the phase, Task 2 was still executed to give the
fix agent full context on the runtime behavior of the phase's changes.

### Command run (verbatim, for ops re-run)

```bash
npx vitest related --run \
  src/backend/fleet-status/identity-appearance.ts \
  src/backend/fleet-status/identity-visibility-gate.ts \
  src/backend/claude-session/identity-artifact-reader.ts \
  src/backend/utils/host-user-counter.ts \
  src/backend/database/routes/identities.ts \
  src/backend/database/routes/sessions.ts \
  src/backend/database/routes/roles-list-for-host.ts \
  src/backend/database/routes/conversation-search.ts \
  src/backend/fleet-status/app-frame-filter.ts \
  src/backend/fleet-status/fleet-status-server.ts \
  src/backend/database/routes/roles-create.ts \
  src/backend/database/routes/identity-birth-orchestrator.ts \
  src/backend/database/routes/identity-birth.ts
```

### Result

```
Test Files  92 passed (92)
     Tests  1781 passed | 1 skipped (1782)
  Duration  106.23s
```

**All tests green.** The type-system regression from Plan 129-05 is invisible
to vitest because:

1. Test files `vi.mock` `systemLogger` — the mock is `Object` (or `any`
   equivalent) at runtime; it does not type-check the LogContext argument
   against the real interface.
2. The debug-log seam is called with a string `hostId` value at runtime; the
   string is just accepted by the mock's `vi.fn()` and captured. The tests
   assert on the log message + operation code, not on the type-shape of the
   `hostId` field.

This is exactly why Plan 129-08's `npm run build:backend` gate exists per
box-maintainer directive — the full backend project must be typechecked in
addition to per-file vitest coverage.

### Test count sanity check against per-plan reports

| Plan   | Files                                                                                | Reported tests |
| ------ | ------------------------------------------------------------------------------------ | -------------- |
| 129-01 | identity-visibility-gate + host-user-counter + identity-artifact-reader.users        | 28 new / 61    |
| 129-02 | identities.get-disk + 3 sibling suites                                               | 7 new / 83     |
| 129-03 | sessions + roles-list-for-host                                                       | 14 new / 111   |
| 129-04 | conversation-search                                                                  | 7 new / 56     |
| 129-05 | app-frame-filter                                                                     | 11 new / 72    |
| 129-06 | roles-create                                                                         | 7 new / 45     |
| 129-07 | identity-birth-orchestrator + identity-birth                                         | 14 new / 1504  |
| **Sum ceiling** | (union with dedup — many sibling test files overlap across plans)         | **1781 in this sweep** |

The union of per-plan sweeps (which each pull in their own transitive test
files via `vitest related --run`) is 1781 tests across 92 test files in this
combined run. This is consistent with the per-plan reports: the earlier plans'
individual sweeps loaded smaller subsets of these 92 files. No plan's tests
went missing from the sweep — the sweep found `identity-birth` bringing in the
large orchestrator suite (~1500 tests) alongside every other file.

### Task 2 verdict

- **Exit code:** 0
- **Test count:** 1781 passed, 1 skipped, 0 failed
- **Test files:** 92 passed
- **Sweep command:** recorded verbatim above
- **Sanity check vs per-plan reports:** consistent (no missing tests)

---

## Task 3: No-leak audit coverage matrix — **PASSED (informational; not the gate's block)**

### Coverage matrix — every "YES" row from RESEARCH § "Complete no-leak audit"

| Surface | File | Audit Disposition | Grep Result | Plan | Notes |
|---------|------|-------------------|-------------|------|-------|
| `GET /identities` | `src/backend/database/routes/identities.ts` | YES | **3 hits** for `isIdentityVisibleToUser` | 129-02 | Per-request lookup + per-identity gate + comment; primary gate seam wired correctly |
| `GET /sessions/list` | `src/backend/database/routes/sessions.ts` | YES | **3 hits** for `isIdentityVisibleToUser` | 129-03 | Fused single-SSH-read + gate + comment; Pitfall 3 closed |
| `GET /roles?hostId=<n>` | `src/backend/database/routes/roles-list-for-host.ts` | YES | **4 hits** for `isIdentityVisibleToUser` | 129-03 | Role-side only (`isIdentityVisibleToUser(null, raw, ...)`) + supporting comments |
| `POST /conversation-search` | `src/backend/database/routes/conversation-search.ts` | YES | **2 hits** for `isIdentityVisibleToUser` | 129-04 | Batched O(unique-keys) gate helper + docblock; PATTERNS.md fail-CLOSED exception documented |
| `WS fleet-status frames` (composed closure) | `src/backend/starter.ts` | YES | **3 hits** for `isIdentityVisibleToUser` | 129-05 | Production closure composes `readIdentityFile` + `readRoleFileByName` + `extractCosmeticsFromFrontmatter` + `extractRoleFromMarkdown` + `isIdentityVisibleToUser` + `getUsernameForUserId`; wired into `resolveIdentityGate` |
| `WS fleet-status frames` (filter wiring) | `src/backend/fleet-status/fleet-status-server.ts` | YES (proxy) | **1 hit** for `isIdentityVisibleToUser` (JSDoc reference — closure is passed in via opts.resolveIdentityGate; symbol imported at composition site in starter.ts) | 129-05 | fleet-status-server threads the closure through as `FleetStatusServerOptions.resolveIdentityGate?`; stubs to `async () => true` with warn log when absent |
| `WS fleet-status frames` (filter branches) | `src/backend/fleet-status/app-frame-filter.ts` | YES (proxy) | **1 hit** for `isIdentityVisibleToUser` (JSDoc reference — `canUserSeeIdentity` shim delegates to `ctx.resolveIdentityGate`, which points to the composed closure in starter.ts) | 129-05 | 5 identity-carrying frames gated (`update`, `snapshot`, `gone`, `identity-archived`, `session-project-changed`); Rule-2 host-gate added to `session-project-changed` |

### Auto-tag write sites (`isHostMultiUser` must appear ≥1 in each)

| Endpoint | File | Grep Result | Plan | Notes |
|----------|------|-------------|------|-------|
| `POST /roles` | `src/backend/database/routes/roles-create.ts` | **3 hits** for `isHostMultiUser` | 129-06 | Auto-tag block + import + comment |
| `POST /identities/birth` | `src/backend/database/routes/identity-birth.ts` | **5 hits** for `isHostMultiUser` | 129-07 | Auto-tag block + defensive try/catch (probe fail-open) + import + comments |

### "NO — deferred / not-applicable" rows (documented per RESEARCH audit)

| Surface | File | Disposition | Rationale |
|---------|------|-------------|-----------|
| `GET /identities/:identityKey/avatar` | `identities.ts` | NO | Visibility gate only, direct-URL avatar fetch stays open per shape §Security Domain |
| `PUT /identities/:identityKey` | `identities.ts` | NO | Edit path; if caller can see it, caller can edit it (shape §Philosophy) |
| `POST /identities/clone` | `identity-clone.ts` | **DEFERRED (v1 scope lock)** | Flagged as follow-up per RESEARCH § no-leak audit; Plan 129-07 explicit exclusion. Not a leak in the current sidebar composition, but a shared-host clone would land un-tagged — user will manually tag or a follow-up phase can add auto-tag symmetry with birth |
| `POST /identities/:key/archive` | `identity-archive.ts` | NO | User-initiated on an identity they can see |
| `GET /roles/:name/avatar?hostId=<n>` | `roles.ts` | NO | Direct-URL avatar fetch |
| `POST /roles/:name/avatar?hostId=<n>` | `roles.ts` | NO (flagged) | Considered but out-of-scope for v1: a caller who knows the role name + hits the endpoint can already write |
| `POST /agent-reset` | `agent-reset.ts` | **DEFERRED** | Flagged as follow-up: a hidden identity's `/id reset` dispatch could be reachable via known-URL from a user who shouldn't see it; not blocking the phase but worth a follow-up |
| WS `app-snapshot` / `app-update` / `app-gone` | subscription-registry | NO | Apps don't carry identity info |
| WS `pong` | subscription-registry | NO | Pass-through (no payload) |
| WS `project-list-changed` | subscription-registry | NO | Verified at Plan 129-05 plan-time: `FrontendProjectListChangedFrameSchema` payload carries only `slug/displayName/hostId/hostname/archived` — no identityKey; host gate already applies via the pre-existing filter branch |

### identity-clone.ts v1 exclusion — **PASSED**

Command:

```bash
grep -c "isHostMultiUser\|getUsernameForUserId\|isIdentityVisibleToUser" \
  src/backend/database/routes/identity-clone.ts
```

Result: **0 hits** (v1 scope lock preserved as designed).

Confirmed via `git log --oneline -20 src/backend/database/routes/identity-clone.ts`
that no Phase 129 commit touched the file. The file remains at its last
pre-Phase-129 state.

### Automated bash verify one-liner (from plan spec)

```
OK: all no-leak audit YES rows covered; clone.ts confirmed excluded
```

### Task 3 verdict

- Every "YES" row in the RESEARCH no-leak audit has ≥1 grep hit in its target file (or its wired-composition target for the WS proxy rows).
- Every "NO" / "DEFERRED" row documented with rationale.
- Auto-tag write sites verified (both endpoints ≥1 hit).
- `identity-clone.ts` explicit exclusion verified (0 hits).
- Coverage matrix written above.

---

## Phase 129 CODE-COMPLETE status

**NOT YET.** Plan 129-05 must be revised to fix the 5 TypeScript errors in
`app-frame-filter.ts` before this phase can be considered code-complete. The
runtime behavior (per Task 2 vitest sweep) is correct — the gate wiring works
end-to-end and every downstream test passes. The blocker is a type-system
regression that would prevent the container from building.

Once Plan 129-05 is fixed (5-line coercion — see "Recommended fix" above):

1. Re-run `/gsd:execute-plan` on `129-08-PLAN.md` to re-verify the gate.
2. On green, phase is CODE-COMPLETE.
3. Ship remains orchestrator-owned per box-maintainer standing directive — no
   `docker build` / no `docker compose up` / no HTTPS 200 verify / no
   `docker logs` performed from any executor plan, including this one.

---

## Deviations from Plan

None. This plan behaved exactly as designed:

- Task 1 detected a cross-plan integration failure (5 TS errors from Plan 129-05's new log seams).
- Per plan spec, stopped short of `npm run build` (since `build:backend` failed) and did NOT patch source from this plan.
- Tasks 2 and 3 still executed to give the fix agent full context (both green — but they were never the block; Task 1 is the block).
- SUMMARY.md produced with verbatim error output and routing back to Plan 129-05.

## Deferred Issues

Two "DEFERRED" rows in the no-leak audit table were noted by RESEARCH and
remain unimplemented in this phase (both intentional per RESEARCH scope):

1. **identity-clone.ts auto-tag** — v1 scope lock per Plan 129-07 decision. `POST /identities/clone` on shared hosts currently produces un-tagged identities. Ashley may hand-tag or a follow-up phase can add auto-tag symmetry.

2. **`POST /agent-reset` visibility gate** — flagged for consideration but not implemented. A hidden identity's `/id reset` dispatch is theoretically reachable via known-URL from a user who shouldn't see it. Not a sidebar leak, but a defensive gap.

Neither blocks this phase per RESEARCH scope — they are documented follow-ups.

## Assumption Changes vs RESEARCH

None. Every RESEARCH assumption (A1 hostAccess authoritative, A2 case-sensitive,
A3 no cache in v1, A5 single-round-trip, A6 RBAC-role expansion) held across
all 7 wave plans. This verification gate confirmed via grep coverage matrix
that the assumed wiring exists at every "YES" surface.

## Threat Flags

None. This plan is a verification-only gate with no new source or wire surface.
Every threat in the plan's `<threat_model>` register (T-129-08-01 through
T-129-08-SC) is mitigated in-code as specified:

- **T-129-08-01** (silent typecheck failure ships broken phase) — MITIGATION EXERCISED. This plan CAUGHT the failure and blocks the phase. Working as designed.
- **T-129-08-02** (no-leak audit gap silently ships) — mitigated by the Task 3 grep matrix + bash-verify one-liner. No gaps found.
- **T-129-08-03** (ship-side action leaks into this plan) — mitigated by explicit box-maintainer directive citation + zero docker/git-push/HTTPS-verify commands in this plan's execution. No ship command executed.
- **T-129-08-SC** (npm installs) — accepted; no new packages installed.

## Self-Check: PASSED

Files created (verified):

- `.planning/phases/129-multi-user-single-host-support-per-user-visibility-gate-on-r/129-08-SUMMARY.md` — this file, FOUND

Commits (none from this plan yet — verification-only; commit will be created by executor for the SUMMARY + STATE + ROADMAP after this file is written).

Verification commands re-runnable by ops:

- `npm run build:backend` — reproduces the 5 TS errors above
- `npx vitest related --run <13 source files>` — reproduces 1781/1781 pass
- Grep matrix commands per Task 3 rows — reproduce the 0/1/2/3/4/5 hit counts

## Commits

| Task | Commit | Type | Files |
|------|--------|------|-------|
| Docs | (pending) | docs | 129-08-SUMMARY.md + STATE.md + ROADMAP.md |

The verification-only nature of this plan means the executor produces exactly
ONE docs commit (this SUMMARY + STATE + ROADMAP updates) — no per-task commits
because no source was edited. Task 1's blocking status is the outcome, not a
commit target.
