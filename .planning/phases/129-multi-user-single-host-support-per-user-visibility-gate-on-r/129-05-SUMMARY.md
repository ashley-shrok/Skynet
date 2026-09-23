---
phase: 129-multi-user-single-host-support-per-user-visibility-gate-on-r
plan: 05
subsystem: backend
tags: [gate, ws-surface, deep-gate-seam, tdd, wave-2, fail-closed-exception]
dependency_graph:
  requires:
    - "129-01 (isIdentityVisibleToUser + getUsernameForUserId + RawCosmetics.users? + extractCosmeticsFromFrontmatter narrower)"
  provides:
    - "Per-frame identity-name visibility gate at the WS surface — filterAppFrame extended across 5 frame types (update, snapshot, gone, identity-archived, session-project-changed)"
    - "AppFrameFilterCtx.resolveIdentityGate — required injected closure so app-frame-filter.ts stays free of DB / SSH / artifact-reader imports (L66-68 file-header discipline preserved)"
    - "Production resolveIdentityGate closure in starter.ts composing readIdentityFile + readRoleFileByName + extractCosmeticsFromFrontmatter + extractRoleFromMarkdown + isIdentityVisibleToUser + getUsernameForUserId (5s SSH connect budget matches identities.ts L363)"
    - "Rule-2 correctness fix — session-project-changed frame gained host gate too (previously fell through to L287 verbatim pass-through with no host gate at all)"
  affects:
    - "Closes the last of the four Wave-2 D-7 deep-gate seams — the WS live-status heartbeat surface. Combined with 129-02 (identities), 129-03 (sessions + roles picker), and 129-04 (conversation-search), every 'YES' row in RESEARCH's no-leak audit table is now closed end-to-end."
    - "Frontend receives shorter live-update streams for callers on multi-user hosts; zero frontend code change (D-6)"
    - "Every subscription-registry.publish* path that fans out through appFrameFilter (publishSessionState / publishSessionGone / publishIdentityArchived / publishSessionProjectChanged) now applies the identity gate at the wire"
tech-stack:
  added: []
  patterns:
    - "Injected-closure dependency pattern extended (mirrors resolveHostOwnerById at L69-74) — app-frame-filter.ts owns no DB / SSH / artifact-reader imports; the closure is composed at the production wiring site (starter.ts)"
    - "Host-gate-short-circuits-identity-gate at every branch (Test J lock) — canUserSeeIdentity NEVER runs when canUserSee already returned false (efficiency + defense-in-depth)"
    - "Fail-CLOSED on resolver throw (Test I lock) — mirrors the checkHostAccess catch-and-return-false shape at L185-198; WS frames are less recoverable than REST lists because a leaked frame updates a live sidebar in real time"
    - "No cache in v1 (Assumption A3 lock) — the 30s AccessCache TTL would regress the shape's 'picked up on next read' promise for the users: field; grep-verified absence of Map<string, {...gate...}> in the filter file"
    - "vi.hoisted logger mock in app-frame-filter.test.ts (mirrors conversation-search.test.ts pattern) — spy-observable warn/debug for Test I fail-closed assertion + regression-catchable at every debug seam"
    - "Empty-projection = valid emit (Test E lock) — snapshot with all identities hidden returns a snapshot frame with states: [], mirroring L228-232 pre-129 empty-snapshot discipline; the frontend renders empty state gracefully"
key-files:
  created: []
  modified:
    - src/backend/fleet-status/app-frame-filter.ts
    - src/backend/fleet-status/app-frame-filter.test.ts
    - src/backend/fleet-status/fleet-status-server.ts
    - src/backend/starter.ts
decisions:
  - "AppFrameFilterCtx.resolveIdentityGate is a REQUIRED field, not optional. Adding it as required (Task 1 Action Step 1 pick a) matches the existing shape of resolveHostOwnerById and gives TypeScript authority to catch any pre-129 fixture that failed to update. All 23 pre-existing test constructions + the createAppFrameFilter factory call updated to include `resolveIdentityGate: async () => true`."
  - "fleet-status-server.ts's FleetStatusServerOptions.resolveIdentityGate is OPTIONAL, not required. When absent, the server emits a loud warn (`operation: fleet_status_identity_gate_missing`) and stubs the resolver to `async () => true` (identity gate skipped; host gate still applies). Rationale: preserves backward-compat for pre-129 callers (test harnesses + intentional bypass shapes) while making regression grep-able. Production wiring in starter.ts always passes the real closure — the option's absence is a test/backward-compat safety valve, not a production shape."
  - "session-project-changed gained BOTH host gate AND identity gate as a Rule-2 correctness addition. Pre-129 it fell through to the L287 verbatim pass-through with NO host gate at all — an orthogonal T-118-05-shaped host-visibility gap that the plan's explicit scope for THIS frame naturally uncovers. Fixed in-place because the plan already targets this branch for identity-gate addition; skipping the host gate would leave a smaller-but-real leak (a frame carrying hostId + identityKey visible to a user with no host access)."
  - "No cache in v1 per Assumption A3. The 30s AccessCache TTL on the existing host gate is acceptable for hostAccess-shaped decisions (the user grants access rarely), but a `users:` frontmatter edit is an on-disk operator gesture that must propagate on next read — a stale cache would visibly regress the shape file's 'picked up on next read' promise. If SSH profiling under load shows the per-call cost is prohibitive, revisit with a 2-5s TTL cache in a follow-up phase — not this one."
  - "session-project-changed's frame.hostId is a NUMBER (per FrontendSessionProjectChangedFrameSchema L659 — `z.number()`), NOT a string like every other frame kind. String() coercion inside the branch (`const hostIdStr = String(frame.hostId)`) normalizes it for the host/identity gate lookups. Documented in-code with the wire-shape citation so anyone touching the branch sees the discrepancy at the point of modification."
  - "Fresh connectOneShot per call in the production closure (no reuse of the ssh-poll-orchestrator's hostClients Map). Rationale: hostClients is scoped to the onFirstSubscriber closure lifecycle, but resolveIdentityGate can be called by ANY subscriber's filter chain. 5s connect budget matches identities.ts L363's pattern for per-request identity reads — a WS frame that takes longer than 5s to gate is already a stale signal, and the fail-closed catch in the app-frame-filter shim drops the frame if the connect times out."
metrics:
  duration_seconds: ~1000
  duration_human: "~17 min executor time"
  completed_date: 2026-09-23
  new_tests: 11
  total_tests_run: 72
  test_files_touched: 1
  source_files_modified: 3
---

# Phase 129 Plan 129-05: Per-user identity-name visibility gate at the WS surface Summary

**One-liner:** Closes the WS-surface leak per D-7 by extending
`filterAppFrame` with an injected `resolveIdentityGate` closure that
gates 5 identity-carrying frame types (`update`, `snapshot`, `gone`,
`identity-archived`, `session-project-changed`) alongside the pre-
existing host gate — the last of the four Wave-2 deep-gate seams, and
the ONLY plan in the phase that also plugs an orthogonal Rule-2 host-
gate hole (session-project-changed was pre-129 unfiltered) as a scope-
adjacent fix.

## Frame Types Enumerated (plan-time verification per RESEARCH Open Q 3)

Grep-verified against `wire-protocol.ts` (`grep -n "make.*Frame\|
identityKey\|tmuxSession"`):

| Frame | Identity field | Gated? | Rationale |
|-------|----------------|--------|-----------|
| `update` | `state.tmuxSession` (nullable) | YES | Live status heartbeat — hidden identity's activity leaks otherwise |
| `snapshot` | per-state `tmuxSession` (nullable) | YES (per-state projection) | Bulk state — empty projection is a valid emit (Test E) |
| `gone` | `tmuxSession` (nullable) | YES | Session termination event for a hidden identity leaks its existence |
| `identity-archived` | `name` (identity name) | YES | Archive event for a hidden identity leaks its existence + hostname |
| `session-project-changed` | `identityKey` | YES + host gate added as Rule-2 | Project change for a hidden identity leaks its membership |
| `app-snapshot` | (apps carry no identity name) | NO | D-05 apps map is host-scoped, not identity-scoped |
| `app-update` | (apps carry no identity name) | NO | Same as app-snapshot |
| `app-gone` | (apps carry no identity name) | NO | Same as app-snapshot |
| `pong` | (no payload) | NO | Pass-through defense-in-depth |
| `project-list-changed` | (only slug/displayName/hostId/hostname per L625-637) | NO | Payload carries no identity keys; host gate already applies via L245-261 |

Plan-time verification of `project-list-changed` (RESEARCH flagged as
"depends"): `FrontendProjectListChangedFrameSchema` at wire-protocol.ts
L625-637 confirms the projects[] payload contains only `slug`,
`displayName`, `hostId`, `hostname`, `archived` — no identityKey or
tmuxSession field. NOT gated on identity as a result. The pre-existing
host-gate branch at app-frame-filter.ts L245-261 covers it.

## What Shipped

### 1. `AppFrameFilterCtx.resolveIdentityGate` — required injected closure

- Added as a REQUIRED field on the ctx interface (Task 1 pick a per plan
  Action Step 1). Signature: `(identityName: string, hostIdStr: string,
  userId: string) => Promise<boolean>`.
- JSDoc cites D-2 (intersection semantics), D-7 (deep gate at WS surface),
  and the L66-68 discipline (this file owns no DB / SSH / artifact-reader
  imports — the closure is injected from the production wiring site).
- All 23 pre-existing `AppFrameFilterCtx` constructions in
  `app-frame-filter.test.ts` + the `createAppFrameFilter` factory call
  updated to include `resolveIdentityGate: async () => true` as a stub
  (Test K regression lock — backward-compat via test-fixture updates,
  not via optional-field looseness).

### 2. `canUserSeeIdentity` shim inside `filterAppFrame`

- Adjacent to `canUserSee` (L162-202); wraps `ctx.resolveIdentityGate`
  with a try/catch that fail-CLOSES on throw and emits a warn log with
  `operation: "app_frame_filter_identity_gate_error"` carrying
  `userId + hostIdStr + identityName + error.message`.
- Mirrors the checkHostAccess catch-and-return-false discipline at
  L185-198 — WS frames are less recoverable than REST lists because a
  leaked frame updates a live sidebar in real time.

### 3. Per-branch identity-gate wiring in `filterAppFrame` (5 frame branches)

Each branch follows the same shape: host gate first (`canUserSee`
short-circuits — Test J lock); identity gate iff the frame carries an
identity name; structured `systemLogger.debug` on gate-drop with a
distinct `operation` code per branch:

- `update` — `app_frame_filter_update_hidden`
- `snapshot` — per-state `app_frame_filter_snapshot_hidden` (Promise.all
  over states.map; empty projection = valid emit per Test E)
- `gone` — `app_frame_filter_gone_hidden`
- `identity-archived` — `app_frame_filter_identity_archived_hidden`
- `session-project-changed` — `app_frame_filter_session_project_changed_hidden`
  (new branch — pre-129 fell through to pass-through with no gate at all)

Defensive skip when the identity field is null on nullable-tmuxSession
frames (`update`, `gone`, `snapshot` per-state) — source-B dormant rows
publish `pid: null` and no `tmuxSession` per Phase 52 Plan 01; there is
nothing to gate on. Documented in-code with the phase citation.

### 4. Production `resolveIdentityGate` closure in `starter.ts`

Composes:
1. `Number(hostIdStr)` parse (invalid → deny with debug log
   `fleet_status_identity_gate_bad_host`)
2. `getUsernameForUserId(userId)` — null → fail-OPEN with warn log
   `fleet_status_identity_gate_username_missing` (mirrors Wave-2
   conversation-search Test G — null caller is an infra bug, not a gate
   signal)
3. `isLocalHostId(hostIdNum)` branch — local hosts bypass SSH entirely
   via the `conn = null` path (matches identities.ts L357-364)
4. `resolveHostById(hostIdNum, userId)` — SSH-credential-decrypted host
   record (null → deny with debug log `fleet_status_identity_gate_host_missing`)
5. `connectOneShot(host, 5_000)` — 5s connect budget matches
   identities.ts L363; slower gates are stale signals
6. `readIdentityFile(conn, identityName)` — missing markdown → deny
   with debug log `fleet_status_identity_gate_no_file`
7. `extractCosmeticsFromFrontmatter(markdown)` + `extractRoleFromMarkdown(markdown)`
8. `readRoleFileByName(conn, role)` — silent-swallow on read error
   (matches identities.ts L414-419 discipline for role reads that fail
   behind an identity read that succeeded); roleCos treated as null
9. `isIdentityVisibleToUser(identityCos, roleCos, callerUsername)` →
   boolean
10. `try/finally` releases the ssh2 Client (`.end()`) — local branch has
    no conn to close

No cache (Assumption A3 lock — grep-verified: 0 hits for
`Map<string.*identity|gate>` in app-frame-filter.ts). Fresh per-call
resolution ensures a `users:` frontmatter edit propagates on next read.

### 5. `fleet-status-server.ts` — resolveIdentityGate threaded through options

- Added OPTIONAL `resolveIdentityGate` on `FleetStatusServerOptions`
  (see Decision above for the required-vs-optional rationale).
- Wired into `createAppFrameFilter` in the branch that constructs the
  internal registry (L187-201 pre-edit). When absent, a loud warn fires
  with `operation: "fleet_status_identity_gate_missing"` and the
  resolver is stubbed to `async () => true` (identity gate skipped;
  host gate still applies).
- Info log at attachment updated to include `identityGate: "wired" |
  "stubbed"` for grep-able ops observability.

## Final Signatures

```typescript
// src/backend/fleet-status/app-frame-filter.ts
export interface AppFrameFilterCtx {
  userId?: string;
  resolveHostOwnerById: (hostIdStr: string) => Promise<{ hostIdNum: number; hostUserId: string } | null>;
  // NEW Phase 129 Plan 129-05 — REQUIRED
  resolveIdentityGate: (identityName: string, hostIdStr: string, userId: string) => Promise<boolean>;
}

export interface CreateAppFrameFilterDeps {
  resolveHostOwnerById: AppFrameFilterCtx["resolveHostOwnerById"];
  resolveIdentityGate: AppFrameFilterCtx["resolveIdentityGate"];   // NEW
  ttlMs?: number;
  _checkHostAccess?: CheckHostAccessFn;
}

// src/backend/fleet-status/fleet-status-server.ts — FleetStatusServerOptions
resolveIdentityGate?: (
  identityName: string,
  hostIdStr: string,
  userId: string,
) => Promise<boolean>;                                              // NEW (optional)
```

## Tests

**11 net-new tests A-K in a `describe("Phase 129: identity-name gate",
...)` block.** RED → GREEN cycle verified via commit sequence.

| Cycle | RED commit | GREEN commit | RED result | GREEN result |
|-------|-----------|--------------|-----------|--------------|
| Identity-gate WS surface | `8f7239a0` | `879b84e4` | 8 fail (A, B, D, E, F, G, H, I) | 35/35 pass (24 pre-129 + 11 new) |

Tests C, J, K pass on RED as regression locks:
- **Test C** (null tmuxSession → gate skipped): passes on RED because
  the pre-129 branch already returned the frame unchanged when the
  host gate passed; adding the identity gate as a defensive skip
  preserves the behavior.
- **Test J** (host gate closes first → identity gate not consulted):
  passes on RED because the identity-gate branches didn't exist yet,
  so canUserSeeIdentity wasn't called (trivially satisfied). On GREEN
  it becomes the real invariant lock (canUserSeeIdentity now exists
  and is called from 5 branches, but MUST NOT run when canUserSee
  already returned false).
- **Test K** (fixture-update regression lock): documentation lock that
  always passes; the real coverage is the compiler rejecting any
  future ctx-shape edit that drops the resolveIdentityGate field from
  a pre-129 fixture.

### Test coverage matrix

| # | Test | Coverage | RED | GREEN |
|---|------|----------|-----|-------|
| A | update frame, identity visible | Frame passes + resolver called with (tmuxSession, hostId, userId) | fail (resolver never called) | pass |
| B | update frame, identity hidden | Frame dropped | fail (frame passes) | pass |
| C | update frame, null tmuxSession | Identity gate skipped, host gate only | pass (regression lock) | pass |
| D | snapshot mixed visibility | Filtered per-state | fail (all 3 states present) | pass |
| E | snapshot all hidden | Empty snapshot frame (not null) | fail (all 2 states present) | pass |
| F | gone frame, identity hidden | Frame dropped | fail (frame passes) | pass |
| G | identity-archived, identity hidden | Frame dropped | fail (frame passes) | pass |
| H | session-project-changed, identity hidden | Frame dropped + hostId String-coerced | fail (frame passes; branch didn't exist) | pass |
| I | resolver throws | Fail-CLOSED + warn log with operation code | fail (frame passes; no warn) | pass |
| J | host gate closes first | Identity gate NOT consulted | pass (trivially — branch didn't exist) | pass (real invariant lock) |
| K | fixture-update backward-compat | Compile-time regression lock | pass | pass |

## Verification Commands

```bash
# Primary
npx vitest related --run src/backend/fleet-status/app-frame-filter.test.ts

# Combined verification (Task 2 GREEN verify)
npx vitest related --run \
  src/backend/fleet-status/app-frame-filter.test.ts \
  src/backend/fleet-status/app-frame-filter.ts \
  src/backend/fleet-status/fleet-status-server.ts

# Full typecheck (starter.ts is not vitest-related but is load-bearing)
npx tsc --noEmit -p tsconfig.json
# Result: 0 errors
```

## Acceptance Criteria — grep verification

### Task 1 (RED — source + tests)

| Criterion | Command | Expected | Actual |
|-----------|---------|----------|--------|
| resolveIdentityGate on ctx type + shim | `grep -c "resolveIdentityGate" src/backend/fleet-status/app-frame-filter.ts` | ≥2 hits | 7 hits |
| canUserSeeIdentity shim present | `grep -c "canUserSeeIdentity" src/backend/fleet-status/app-frame-filter.ts` | ≥1 hit | 8 hits |
| Phase 129 describe block exists | `grep -c "Phase 129: identity-name gate" src/backend/fleet-status/app-frame-filter.test.ts` | exactly 1 | 1 hit |
| Test fixtures updated with stub | `grep -c "resolveIdentityGate: async" src/backend/fleet-status/app-frame-filter.test.ts` | ≥1 per updated ctx | 25 hits (matches ctx + factory count) |
| Warn log for Test I fail-closed | `grep -c "app_frame_filter_identity_gate_error" src/backend/fleet-status/app-frame-filter.ts` | exactly 1 | 1 hit |

### Task 2 (GREEN — production wiring)

| Criterion | Command | Expected | Actual |
|-----------|---------|----------|--------|
| Identity gate call sites (5 frames + shim) | `grep -c "canUserSeeIdentity(" src/backend/fleet-status/app-frame-filter.ts` | ≥5 hits | 6 hits (5 branches + shim call to ctx.resolveIdentityGate) |
| Debug log per gate-drop (5 branches) | `grep -c "app_frame_filter_.*_hidden" src/backend/fleet-status/app-frame-filter.ts` | ≥5 hits | 5 hits (update, snapshot, gone, identity_archived, session_project_changed) |
| Production closure wired in server opts | `grep -c "resolveIdentityGate" src/backend/fleet-status/fleet-status-server.ts` | ≥1 hit | 7 hits |
| Production closure imports in starter.ts | `grep -cE "isIdentityVisibleToUser\|readIdentityFileForGate\|readRoleFileByNameForGate\|extractCosmeticsForGate\|extractRoleForGate\|getUsernameForUserIdForGate" src/backend/starter.ts` | ≥3 hits | 15 hits |
| **File-header discipline preserved** (no DB / SSH imports in filter file) | `grep -c "import.*database\|import.*claude-session" src/backend/fleet-status/app-frame-filter.ts` | 0 hits | 0 hits |
| **No cache added** (Assumption A3 lock) | `grep -n "Map<string" src/backend/fleet-status/app-frame-filter.ts \| grep -i "identity\|gate" \| wc -l` | 0 hits | 0 hits |

## Line-count Deltas

| File | Type | Lines |
|------|------|-------|
| src/backend/fleet-status/app-frame-filter.ts | modified | +112 (ctx-type extension + JSDoc + canUserSeeIdentity shim + 5 gate branches + session-project-changed new branch + snapshot Promise.all restructure + 5 debug log seams + createAppFrameFilter thread-through) |
| src/backend/fleet-status/app-frame-filter.test.ts | modified | +454 (vi.hoisted logger mock + vi.mock factory + 23 fixture updates + createAppFrameFilter factory update + 11 Phase 129 tests A-K + describe block scaffolding + beforeEach reset + makeSessionState helper duplication) |
| src/backend/fleet-status/fleet-status-server.ts | modified | +42 (FleetStatusServerOptions.resolveIdentityGate JSDoc + optional field + wiring branch stub-with-warn + info log identityGate metadata) |
| src/backend/starter.ts | modified | +176 (imports for the 5 closure primitives + docblock + resolveIdentityGate closure body + resolveIdentityGate wired into startFleetStatusServer opts) |

## Wave-2 completion — all four D-7 seams closed

With this plan, every Wave-2 read-path seam identified in RESEARCH's
no-leak audit table is closed end-to-end:

| Seam | Plan | Status | Discipline |
|------|------|--------|-----------|
| GET /identities | 129-02 | Closed | fail-open on read error (D-8 default) |
| GET /sessions/list | 129-03 | Closed | fail-open (matches identities.ts) |
| GET /roles?hostId=n | 129-03 | Closed | role-side gate only (identity irrelevant at picker time) |
| POST /conversation-search | 129-04 | Closed | fail-CLOSED (PATTERNS.md exception; D-7 wins over D-8 in search context) |
| **WS live-status frames** | **129-05 (this plan)** | **Closed** | **fail-CLOSED on resolver throw (mirrors search + checkHostAccess); no cache** |

Together with Plans 06-08 (write-path auto-tag on multi-user hosts),
the shape file's D-7 depth invariant is met at every read AND write
surface a Skynet sidebar can compose against.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added host gate to
session-project-changed branch alongside the primary identity-gate
addition.**
- **Found during:** Task 2 (GREEN) source edit — enumerating the 5
  frame branches per the plan's Action Step 1 list.
- **Issue:** The pre-129 filterAppFrame had NO branch for
  `session-project-changed`; the frame fell through to the L287
  verbatim pass-through and was fanned out UNFILTERED. This is an
  orthogonal T-118-05-shaped host-visibility gap (the frame carries a
  hostId + identityKey but was never checked against the subscriber's
  host access) that surfaces naturally when the plan adds the
  identity-gate branch for this frame type.
- **Fix:** New `if (frame.type === "session-project-changed")` branch
  runs `canUserSee(String(frame.hostId))` FIRST (Test J short-circuit
  discipline), THEN `canUserSeeIdentity(frame.identityKey, hostIdStr)`.
  Both gates fail-closed. String() coercion handles the hostId-is-
  number wire-shape quirk (see Decision above).
- **Files modified:** `src/backend/fleet-status/app-frame-filter.ts`
- **Commit:** `879b84e4`
- **Rationale for auto-fix:** Rule 2 (missing critical functionality —
  a WS frame carrying an identityKey and hostId being fanned out
  unfiltered to any subscriber is a security-relevant gap). Plan
  already targeted this branch for identity-gate addition; skipping
  the host gate would have left a smaller-but-real leak (host-
  visibility gap on the frame). Documented in-code with a citation
  to Rule-2 and the pre-129 pass-through state so anyone touching
  the branch sees the context at the point of modification.

### Minor implementation notes (NOT deviations from the plan's contract)

**1. Production wiring lives in `starter.ts`, not `fleet-status-server.ts`.**
The plan's Action Step 3 said "at the createAppFrameFilter call site
(L188)" of fleet-status-server.ts, but that call site LIVES IN
starter.ts today (fleet-status-server.ts only threads the closure
through as a FleetStatusServerOptions field — the production
composition of readIdentityFile + isIdentityVisibleToUser + etc.
belongs adjacent to the resolveHostOwnerById closure at
starter.ts L567-603). This matches the pre-existing Phase 118 Plan
118-05 shape (HIGH-1a fix pass documented at starter.ts L553-566).
No deviation from the plan's contract — the plan clearly names the
composition primitives and the fail-closed discipline; the file-
level home is dictated by the pre-existing wiring shape.

**2. fleet-status-server.ts opts.resolveIdentityGate is OPTIONAL, not
required.** The plan's decision matrix in Task 1 (pick (a) required
vs (b) optional) applies to the FILTER's ctx type where compile-time
enforcement is load-bearing. The server-options type serves a
different purpose (backward-compat + test-harness safety valve), so
the field is optional there with a loud warn on absence. Documented
in the field's JSDoc + in a Decision above.

**3. Test I asserts on the systemLogger.warn mock via vi.hoisted +
vi.mock.** The plan's Task 1 Action Step 3 said "Write all 11 tests
A-K"; the pattern for spy-observable log assertions is conversation-
search.test.ts (see Plan 129-04 SUMMARY). Introducing the mock in
this file is transparent to pre-existing tests (pre-129 tests never
asserted on the logger; the existing `canUserSee` warn at L188-196
continues to fire against the mock as a no-op). Confirmed via GREEN
run: 35/35 pass, including all 24 pre-existing tests.

**4. Fresh `connectOneShot` per gate call — no reuse of the
orchestrator's `hostClients` Map.** The plan's Action Step 3 said
"opens an SSH connection (or reuses a pooled one)"; the pooled-conn
option was explicitly evaluated and rejected because the
`hostClients` map is scoped to the `onFirstSubscriber` callback's
closure lifecycle, and `resolveIdentityGate` can be called by ANY
subscriber's filter chain (not just the poll orchestrator's). Fresh
per-call `connectOneShot(host, 5_000)` matches identities.ts L363's
pattern for per-request identity reads. Documented in a Decision
above; if profiling under load justifies a pool, revisit as a
follow-up.

**5. Snapshot branch restructured from unique-hostId Promise.all to
per-state Promise.all.** Pre-129 the snapshot branch computed a
`visible: Set<hostId>` via `Promise.all(uniqueHostIds.map(canUserSee))`
and then `states.filter(s => visible.has(s.hostId))`. With per-state
identity gating that shape breaks (identity gate is per-state, not
per-host). Rewrote as `Promise.all(states.map(async s => host? && id?
? s : null))` + `.filter(s => s !== null)`. Preserves the Test E
empty-projection invariant (mirrors L228-232 pre-129 empty-snapshot
discipline). Performance impact: negligible at typical snapshot
sizes (< 50 states); the per-host cache still deduplicates the host
gate calls internally.

## Assumption Changes vs RESEARCH

None. Every RESEARCH assumption load-bearing for this plan carried
through unchanged:
- **Assumption A3 (no cache in v1)** — validated by grep-check: 0
  hits for `Map<string.*identity|gate>` in app-frame-filter.ts.
- **Assumption A5 (single-round-trip discipline)** — the closure
  makes one identity-file read + one role-file read per gate call;
  reuses the same conn across both.
- **Assumption A6 (RBAC-role expansion)** — not exercised here; this
  is a READ path with no auto-tag. The primitive `isHostMultiUser`
  from Plan 129-01 already handles it for the Wave-3 write-path
  plans.
- **Pitfall 4 (O(unique keys) batched fetch discipline)** — the
  snapshot branch's `Promise.all(states.map(...))` is O(states)
  because each state has a distinct identity. Bounded by the size of
  the snapshot (typically < 50 states); no batched-lookup
  optimization needed here (contrast with conversation-search which
  had `hits.length` in the tens with duplicate identityKeys).

## Deferred Issues

None from this plan.

**Wave-3 write-path (not this plan's scope):**
- **129-06 / 129-07 / 129-08:** Auto-tag creator's Skynet username on
  new roles + new identities at multi-user hosts (write-path
  complement to the Wave-2 read-path gates closed by 129-02 through
  129-05).

**Potential follow-up (out of scope for Phase 129):**
- 2-5s TTL cache for the `resolveIdentityGate` closure if SSH
  profiling under load shows the per-call cost is prohibitive.
  Deliberately NOT implemented here per Assumption A3.

## Threat Flags

None. Every threat in the plan's `<threat_model>` register is
mitigated in-code as specified:

- **T-129-05-01** (info disclosure via hidden identity's live update
  frame) — mitigated by `update` branch identity gate; Tests A + B
  lock.
- **T-129-05-02** (snapshot leaks hidden identity as one of many
  states) — mitigated by per-state gate inside the snapshot
  Promise.all; Tests D + E lock.
- **T-129-05-03** (identity-archived leaks hidden identity's archive
  event) — mitigated by `identity-archived` branch identity gate;
  Test G lock.
- **T-129-05-04** (session-project-changed leaks hidden identity's
  project change) — mitigated by NEW `session-project-changed`
  branch (host gate + identity gate); Test H lock.
- **T-129-05-05** (fail-closed on SSH read error empties the sidebar)
  — accepted per the plan's `<threat_model>` register; trade-off is
  deliberate (WS frames leaked into a live sidebar are more visible
  than dropped ones). Per-frame warn log
  (`app_frame_filter_identity_gate_error`) gives ops visibility.
- **T-129-05-06** (silent per-frame drop decisions in prod) —
  mitigated by 5 debug log seams (one per gated branch) + 1 warn log
  at resolver-throw; Test I lock.
- **T-129-05-07** (DB / SSH imports leak into app-frame-filter.ts) —
  mitigated by injected-closure pattern + grep assertion: 0 hits for
  DB/claude-session imports in the filter file.
- **T-129-05-SC** (npm installs) — accepted; no new packages
  installed.

No new security-relevant surface beyond what the plan's threat model
accounts for. No new endpoints, no schema changes, no auth path
changes. The Rule-2 host-gate addition to session-project-changed
CLOSES a pre-existing security gap rather than opening one.

## Self-Check: PASSED

Files modified (verified via `git log --stat HEAD~2..HEAD` and
`git rev-parse --verify`):
- `src/backend/fleet-status/app-frame-filter.ts` — FOUND (commits `8f7239a0` + `879b84e4`)
- `src/backend/fleet-status/app-frame-filter.test.ts` — FOUND (commit `8f7239a0`)
- `src/backend/fleet-status/fleet-status-server.ts` — FOUND (commit `879b84e4`)
- `src/backend/starter.ts` — FOUND (commit `879b84e4`)

Commits (verified via `git log --oneline HEAD~2..HEAD`):
- `8f7239a0` — Task 1 (RED: AppFrameFilterCtx extension + canUserSeeIdentity shim + 11 tests A-K + logger mock + 23 fixture updates)
- `879b84e4` — Task 2 (GREEN: 5 frame-branch identity-gate wiring + Rule-2 host-gate on session-project-changed + production closure in starter.ts + fleet-status-server.ts opts extension)

Verification test runs (all pass):
- `npx vitest related --run src/backend/fleet-status/app-frame-filter.test.ts` → 35/35 pass (11 Phase 129 A-K + 24 pre-129 regression)
- `npx vitest related --run src/backend/fleet-status/app-frame-filter.test.ts src/backend/fleet-status/app-frame-filter.ts src/backend/fleet-status/fleet-status-server.ts` → 72/72 pass across 4 test files
- `npx tsc --noEmit -p tsconfig.json` → 0 errors (starter.ts + all other production files typecheck clean)

Grep-verified invariants:
- `grep -c "import.*database\|import.*claude-session" src/backend/fleet-status/app-frame-filter.ts` → **0 hits** (file-header discipline preserved)
- `grep -n "Map<string" src/backend/fleet-status/app-frame-filter.ts | grep -i "identity\|gate" | wc -l` → **0 hits** (no cache in v1)
- `grep -c "canUserSeeIdentity(" src/backend/fleet-status/app-frame-filter.ts` → **6 hits** (5 frame branches + shim call to ctx.resolveIdentityGate)
- `grep -c "app_frame_filter_.*_hidden" src/backend/fleet-status/app-frame-filter.ts` → **5 hits** (one debug log seam per gated branch)

## Commits

| Task | Commit | Type | Files |
|------|--------|------|-------|
| 1 (RED) | 8f7239a0 | test | app-frame-filter.ts (ctx + shim), app-frame-filter.test.ts (logger mock + fixture updates + 11 tests A-K) |
| 2 (GREEN) | 879b84e4 | feat | app-frame-filter.ts (5 branch wirings + Rule-2 host gate on session-project-changed), fleet-status-server.ts (opts extension + stub-with-warn wiring), starter.ts (imports + production closure + wired into startFleetStatusServer) |
