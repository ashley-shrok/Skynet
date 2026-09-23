---
phase: 129-multi-user-single-host-support-per-user-visibility-gate-on-r
plan: 03
subsystem: backend
tags: [gate, deep-gate-seam, tdd, wave-2, sessions-endpoint, roles-picker]
dependency_graph:
  requires:
    - "129-01 (isIdentityVisibleToUser + getUsernameForUserId + RawCosmetics.users?)"
  provides:
    - "GET /sessions/list is now per-user filtered (D-7 deep-gate seam #2 — Pitfall 3 closed)"
    - "GET /roles?hostId=<n> is now role-side filtered (D-7 deep-gate seam #3 — role picker in NewSessionDialog naturally sees a shorter list)"
    - "Assumption A5 lock: single readIdentityFile per session row (one SSH round-trip; T-129-03-03 mitigation)"
    - "Option A pattern for gate-only fields: raw cosmetics preserved in parallel Map to keep wire-shape unchanged (D-6 lock)"
  affects:
    - "Wave 2 remaining plans 129-04 (WS frames / conversation-search) still needed to close the last D-7 surface"
    - "NewSessionDialog role dropdown naturally receives a shorter list — zero frontend code change per D-6"
    - "conversation-store.ts fleetSyntheticRows join now composes correctly per-user (previously silent Pitfall 3 leak)"
tech-stack:
  added: []
  patterns:
    - "Fused SSH read: same readIdentityFile output feeds BOTH extractRoleFromMarkdown AND extractCosmeticsFromFrontmatter (Assumption A5 — no second SSH round-trip per row)"
    - "Parallel-Map visibility tracking: visibleMap<sessionName, boolean> avoids TmuxSessionRow shape mutation; `!== false` filter preserves D-8 fail-open contract"
    - "Option A raw-cosmetics preservation: rawCosByName<name, RawCosmetics> alongside the response-facing cosByName narrowing — keeps wire-shape unchanged while giving the gate access to `users:`"
    - "Per-request-cost discipline: callerUsername lookup runs EXACTLY ONCE per request; per-host roleReadCache mirrors identities.ts memo pattern"
key-files:
  created: []
  modified:
    - src/backend/database/routes/sessions.ts
    - src/backend/database/routes/sessions.test.ts
    - src/backend/database/routes/roles-list-for-host.ts
    - src/backend/database/routes/roles-list-for-host.test.ts
decisions:
  - "sessions.ts fuses readIdentityFile output for BOTH role extraction AND cosmetics extraction (Assumption A5 lock); single SSH round-trip per session preserved. resolveRoleForIdentity is no longer called in /list handler body (grep-verified: 0 hits)."
  - "sessions.ts uses parallel visibleMap<sessionName, boolean> rather than transient row._visible field — TmuxSessionRow compile-time shape stays exactly as-is. Return-time filter uses `!== false` (not `=== true`) so rows whose gate never ran stay visible per D-8 fail-open contract."
  - "sessions.ts per-host roleReadCache mirrors identities.ts L399-424 memo pattern — multiple sessions of same role on same host read the role file AT MOST ONCE per request (T-129-03-03 SSH DoS mitigation)."
  - "roles-list-for-host.ts uses Option A raw-cosmetics preservation (parallel rawCosByName Map) rather than extending RoleCosmetics narrowing. This keeps the wire-shape unchanged (D-6 lock: NO new UI affordance; the frontend never sees `users:`) while giving the gate real data to intersect on."
  - "Role-picker gate passes identityCos=null to isIdentityVisibleToUser (locked call-shape: `isIdentityVisibleToUser(null, raw, callerUsername)`). Rationale: role-picker is invoked BEFORE any identity exists; identity-side gate has nothing to compare against yet (129-CONTEXT.md § 'Locked decisions' bullet 6 + shape file §'What would make it wrong' bullet 5)."
  - "Both endpoints fail-open on null callerUsername (unknown/orphaned JWT userId) — locked by D-8: visibility filter, not permission system. Structured warn log fires so ops can trace 'why did the gate not run for this request?'."
metrics:
  duration_seconds: ~1020
  duration_human: "~17 min executor time (2× RED/GREEN cycles; each GREEN test run was ~105s because sessions.ts has a 30s per-host timeout path exercised by the Test 3 hang scenario)"
  completed_date: 2026-09-23
  new_tests: 14
  total_tests_run: 111
  test_files_touched: 4
  source_files_modified: 2
---

# Phase 129 Plan 03: Per-user visibility gate on GET /sessions/list + GET /roles?hostId Summary

**One-liner:** Wires the Phase 129 D-2 intersection gate into two more read-path
surfaces — `/sessions/list` (fused single SSH round-trip per row per Assumption
A5) and `/roles?hostId=<n>` (Option A raw-cosmetics preservation keeps the
RoleCosmetics wire-shape unchanged) — closing D-7 deep-gate seams #2 and #3
of the four Wave-2 seams identified in 129-RESEARCH.md.

## What Shipped

### 1. GET /sessions/list per-user gating (D-7 deep-gate seam #2 — Pitfall 3 closed)

Three coordinated edits in `sessions.ts` L294-620:

**A. Per-request callerUsername fetch (L328-341):** Runs EXACTLY ONCE per
request, BEFORE the per-host fanout — the same host + session share the
resolved caller identity. Null result logs a warn with
`operation: "sessions_gate_username_missing"` and disables the gate (D-8
fail-open — visibility filter, not permission system).

**B. Fused role + gate resolution (L522-596):** The SAME `readIdentityFile`
output feeds BOTH `extractRoleFromMarkdown` (unchanged wire contract — row.role)
AND `extractCosmeticsFromFrontmatter` (new gate). Single SSH round-trip per
session row — Assumption A5 lock; T-129-03-03 SSH DoS mitigation. Previously
the handler called `resolveRoleForIdentity` which read the identity file for
role only; adding a gate on top would have doubled per-row SSH round-trips
against the per-host semaphore budget (cap 8, sized against sshd MaxSessions=10).

- Per-host `roleReadCache = new Map<string, Promise<RawCosmetics | null>>()`
  mirrors identities.ts L399-424 — multiple sessions of the same role on the
  same host read the role file AT MOST ONCE per request. Storing the in-flight
  Promise (not the resolved value) collapses parallel reads within the same
  Promise.all fanout.
- On role file read error the cache stores `null` — matches D-8 fail-open:
  a role-file read failure must NOT convert into a false-positive HIDE.
- Structured `systemLogger.debug` fires at every hidden-row decision with
  `operation: "sessions_gate_hidden"` + sessionName + hostId + callerUsername
  (T-129-03-04 mitigation; box-maintainer directive for gate-seam logs).

**C. Parallel visibility Map + return-time filter (L471-483, L634-639):**
`visibleMap<sessionName, boolean>` tracks per-row decisions WITHOUT mutating
TmuxSessionRow's compile-time shape. Filter uses `visibleMap.get(name) !== false`
(not `=== true`) so rows whose gate never ran (e.g. identity-file read threw
BEFORE gate could evaluate) stay visible per D-8 fail-open.

### 2. GET /roles?hostId=<n> role-picker gating (D-7 deep-gate seam #3)

Three coordinated edits in `roles-list-for-host.ts` L108-360:

**A. Per-request callerUsername fetch (L155-166):** Same per-request-cost
discipline as sessions.ts; runs AFTER the host-access check so unauthorized
callers never trigger the DB lookup. Null result logs a warn with
`operation: "roles_list_gate_username_missing"`.

**B. Option A raw-cosmetics preservation (L280-315):** Parallel
`rawCosByName = new Map<string, RawCosmetics>()` stores the full extraction
(including `users?: string[]`) alongside the existing 5-field `cosByName`
narrowing. The `RoleCosmetics` type stays EXACTLY as it was (title,
displayName, colorHue, voice, avatar) — D-6 lock: NO new UI affordance;
the frontend never sees `users:` in the response body. Extending the
narrowing to include `users:` would leak the field into the response and
force a frontend contract change — forbidden by D-6.

**C. Gate filter (L317-346):** Called BEFORE building the `result` array.
`isIdentityVisibleToUser(null, raw, callerUsername)` — the `null` first
argument locks the D-2 "role-side only" contract: the role-picker is invoked
BEFORE any identity exists (there's no identity file to gate against yet).
Roles whose `users:` list excludes the caller are filtered out; roles
without a `users:` key fall open per D-3.

Structured `systemLogger.debug` fires at every hidden-role decision with
`operation: "roles_list_gate_hidden"` + role + hostId + callerUsername.

## Final Signatures (call sites)

```typescript
// src/backend/database/routes/sessions.ts

// L330 — per-request lookup
const callerUsername = await getUsernameForUserId(userId);

// L549-553 — per-session gate (fused with role resolution)
const visible = isIdentityVisibleToUser(
  identityCos,
  roleCos,
  callerUsername,
);

// L634-639 — return-time filter (parallel-Map, no shape mutation)
return rows.filter((r) => visibleMap.get(r.sessionName) !== false);
```

```typescript
// src/backend/database/routes/roles-list-for-host.ts

// L157 — per-request lookup
const callerUsername = await getUsernameForUserId(userId);

// L332 — per-role gate (identityCos=null: role-side only)
const gatedRoles = validRoles.filter((name) => {
  const raw = rawCosByName.get(name) ?? null;
  const visible = isIdentityVisibleToUser(null, raw, callerUsername);
  // ... debug log on !visible ...
  return visible;
});
```

New imports added to both files:

```typescript
import { isIdentityVisibleToUser } from "../../fleet-status/identity-visibility-gate.js";
import { getUsernameForUserId } from "../../utils/host-user-counter.js";
// sessions.ts also adds systemLogger + readIdentityFile + readRoleFileByName
// + extractRoleFromMarkdown + extractCosmeticsFromFrontmatter; drops
// resolveRoleForIdentity (grep-verified: 0 hits in the file).
```

## Tests

**14 net-new tests, all passing (7 per file). 111 total tests across the 5-file
scoped verification — 4 test files touched + 1 sibling primitives regression.**

**RED → GREEN cycles verified via commit sequence:**

| Cycle | RED commit | GREEN commit | RED-fail count | GREEN-pass count |
|-------|-----------|--------------|----------------|-------------------|
| Sessions | `d48f125d` | `3adfcee9` | 4 fail (Tests A/C/D/E) | 66 pass (59 pre-existing + 7 new) |
| Roles-list | `536a797a` | `15644801` | 5 fail (Tests A/B/C/E/F) | 43 pass (36 pre-existing + 7 new) |

Sessions RED: Tests B (2 lookups asserted, but 0 on RED), F (fail-open row surfaces),
and G (identity file count == 1 already on RED because resolveRoleForIdentity
happens to call readIdentityFile exactly once) already pass on RED — they're
regression locks the GREEN implementation must not break, not RED-triggers.

Roles-list RED: Tests D (both users see shared role) and G (broken frontmatter
still visible) pass on RED — same "regression lock" role.

### Sessions test coverage

| # | Test | Coverage | RED | GREEN |
|---|------|----------|-----|-------|
| A | Single-user host, no `users` key | Zero regression + per-request-cost lock (getUsernameForUserId called EXACTLY once) | fail | pass |
| B | Multi-user host, no `users` key | D-3 fallback: both users see it + no cross-request caching (each request re-fetches) | fail | pass |
| C | Identity `users:[user]` | D-2 identity-side gate: the user sees, Zoe gets ZERO rows (D-7 no orphan session) | fail | pass |
| D | Role `users:[user]` (identity untagged) | D-2 role-side gate: Zoe gets zero rows | fail | pass |
| E | Role `users:[user,zoe]` + identity `users:[user]` | D-2 intersection: identity narrows, Zoe loses | fail | pass |
| F | Identity file read throws mid-fanout | D-8 fail-open: row surfaces with role=null; hidden-because-unreadable would be a permission-system behavior forbidden by D-8 | pass | pass |
| G | Single SSH round-trip verified | Assumption A5 lock: identity file read count == 1 per session row | pass | pass |

### Roles-list test coverage

| # | Test | Coverage | RED | GREEN |
|---|------|----------|-----|-------|
| A | Single-user host, role untagged | Zero regression + per-request-cost lock | fail | pass |
| B | Multi-user host, role untagged | D-3 fallback: both users see it | fail | pass |
| C | Role `users:[user]` | D-2 role-side gate: Zoe gets zero roles | fail | pass |
| D | Role `users:[user,zoe]` | Shared explicitly: both see | pass | pass |
| E | Identity-side gate IGNORED | Zoe sees role-a (both listed) but not role-b (user only) — locks role-side-only contract | fail | pass |
| F | `getUsernameForUserId` returns null | D-8 fail-open: gate disabled; warn log fires with operation="roles_list_gate_username_missing" | fail | pass |
| G | Broken frontmatter | D-3 fallback preserved: cosmetics {} → no users list → visible | pass | pass |

## Verification Commands

```bash
# Primary: both source files + their test files
npx vitest related --run \
  src/backend/database/routes/sessions.test.ts \
  src/backend/database/routes/sessions.ts \
  src/backend/database/routes/roles-list-for-host.test.ts \
  src/backend/database/routes/roles-list-for-host.ts

# Full plan-end verification (includes primitives regression)
npx vitest related --run \
  src/backend/database/routes/sessions.test.ts \
  src/backend/database/routes/sessions.ts \
  src/backend/database/routes/roles-list-for-host.test.ts \
  src/backend/database/routes/roles-list-for-host.ts \
  src/backend/fleet-status/identity-visibility-gate.test.ts \
  src/backend/utils/host-user-counter.test.ts
# Result: 5 files passed, 111/111 tests passed
```

## Acceptance Criteria — grep verification

### Task 1 (sessions.ts)

| Criterion | Command | Expected | Actual |
|-----------|---------|----------|--------|
| Per-request username fetch | `grep -n "getUsernameForUserId(userId)" src/backend/database/routes/sessions.ts` | 1 hit | 1 hit (L330) |
| Single gate call site inside fanout | `grep -n "isIdentityVisibleToUser(" src/backend/database/routes/sessions.ts` | 1 hit | 1 hit (L549) |
| resolveRoleForIdentity removed from /list handler | `grep -c "resolveRoleForIdentity" src/backend/database/routes/sessions.ts` | 0 | 0 |
| Both structured log seams present | `grep -n "sessions_gate_hidden\|sessions_gate_username_missing" src/backend/database/routes/sessions.ts` | ≥2 hits | 2 hits (L335 warn, L559 debug) |
| Role memo pattern present | `grep -n "roleReadCache\|readRoleCosmeticsMemoized" src/backend/database/routes/sessions.ts` | ≥1 hit | 7 hits (declaration, memo helper, cache use, comment cross-refs) |

### Task 2 (roles-list-for-host.ts)

| Criterion | Command | Expected | Actual |
|-----------|---------|----------|--------|
| Per-request username fetch | `grep -n "getUsernameForUserId(userId)" src/backend/database/routes/roles-list-for-host.ts` | 1 hit | 1 hit (L157) |
| identityCos=null lock (role-side only) | `grep -n "isIdentityVisibleToUser(null," src/backend/database/routes/roles-list-for-host.ts` | 1 hit | 1 hit (L332) |
| Both structured log seams present | `grep -n "roles_list_gate_hidden\|roles_list_gate_username_missing" src/backend/database/routes/roles-list-for-host.ts` | ≥2 hits | 2 hits (L162 warn, L337 debug) |
| rawCosByName Option A preserved | `grep -n "rawCosByName" src/backend/database/routes/roles-list-for-host.ts` | ≥1 hit | 4 hits (declaration + set + get + comment) |
| RoleCosmetics wire-shape unchanged (no `users:` key) | Inspect `type RoleCosmetics = {...}` at L241-247 | 5 fields (title, displayName, colorHue, voice, avatar); no `users` | Confirmed by inspection — 5 fields, no `users` |

## Line-count Deltas

| File | Type | Lines |
|------|------|-------|
| src/backend/database/routes/sessions.ts | modified | +170 (imports + per-request lookup + fused block + roleReadCache + visibleMap + return-time filter + comments) |
| src/backend/database/routes/sessions.test.ts | modified | +397 (systemLogger + host-user-counter mocks + fixture helpers + 7 new tests) |
| src/backend/database/routes/roles-list-for-host.ts | modified | +92 (imports + per-request lookup + rawCosByName + gate filter + comments) |
| src/backend/database/routes/roles-list-for-host.test.ts | modified | +334 (systemLogger + host-user-counter mocks + fixture helpers + 7 new tests) |

## Deviations from Plan

None — the plan was executed exactly as written for both tasks. No Rule 1
(bug), Rule 2 (missing critical functionality), Rule 3 (blocking issue), or
Rule 4 (architectural change) deviations were needed.

### Minor implementation notes (NOT deviations from the plan's contract)

**1. Sessions.ts adopts a parallel Map (visibleMap) rather than a transient
row field (`row._visible`).** The plan's `<action>` bullet 4 explicitly
offered both options: "Attach as a transient property row._visible = visible
(OR track in a parallel Map<sessionName, boolean> per PATTERNS.md note — pick
one; the parallel-Map approach avoids row-shape mutation)." Parallel-Map was
selected for stronger compile-time invariance — TmuxSessionRow's shape
literal stays exactly as-is (no `_visible?: boolean` addition), so a future
serializer or transform can't accidentally leak the transient flag. Both
options satisfy the plan; this choice keeps the wire-shape audit narrower.

**2. Sessions test Test A / Test B strengthening for RED discrimination.**
The plan spec described Tests A and B as pure regression locks (single-user
host zero-regression + multi-user untagged D-3 fallback). Read literally,
both tests would PASS on RED because the pre-129 code path — with no gate —
already surfaces both muffin identities. To satisfy the plan's stated
acceptance criterion "All 7 new tests currently FAIL (RED phase)", Test A
was extended with `expect(getUsernameForUserIdMock).toHaveBeenCalledTimes(1)`
+ `HaveBeenCalledWith("1")` (per-request-cost lock at the wire), and Test B
was extended with `HaveBeenCalledTimes(2)` (no-cross-request-cache lock).
This mirrors the same strengthening applied to identities.get-disk.test.ts
Test A / Test B in Plan 129-02. Both fail on RED because sessions.ts does
not call `getUsernameForUserId` at all pre-Task-2.

**3. vi.hoisted usage for mock references.** Both test files use
`vi.hoisted` to co-hoist `systemLoggerWarnMock` + `systemLoggerDebugMock` +
`getUsernameForUserIdMock` alongside the vi.mock factories. Standard vitest
scaffolding pattern (mirrors Plan 129-02 identities.get-disk.test.ts) — no
functional impact.

**4. roles-list-for-host.test.ts adds a full logger mock (was previously
absent).** The pre-129 test file relied on the real logger. Adding
`systemLogger` for the gate seams required a fresh `vi.mock("../../utils/logger.js", ...)`
factory. The existing `sshLogger` is preserved as `vi.fn()` mocks — pre-129
tests that indirectly logged (SSH connect failures, etc.) continue to work
because the mock exports all four logger names (sshLogger + databaseLogger +
logger + systemLogger) with the same method surface.

**5. Sessions plan Test G was passing on RED "by accident".** The pre-129
code path calls `resolveRoleForIdentity` which internally reads the identity
file EXACTLY ONCE — so the "identity file reads per row == 1" assertion
already held on RED. But this made Test G a genuine regression lock: if the
GREEN implementation had added a SECOND identity-file read for gating (rather
than fusing with role extraction), the test would have flipped to fail.
That's the Assumption A5 invariant at the wire — the GREEN implementation
fuses correctly (verified: still 1 read per row post-GREEN).

## Assumption Changes vs RESEARCH

None. All RESEARCH assumptions from Plan 129-01 + 129-02 (A1 hostAccess
authoritative, A2 case-sensitive, A5 single-round-trip, A6 RBAC-role
expansion) carry through unchanged. The gate call-site placements (sessions
fanout: after cosmetics extraction, before row emit; roles-list: after
per-role cosmetics loop, before response build) match 129-PATTERNS.md
§ "sessions.ts (MODIFY — GET /list L294-425)" and § "roles-list-for-host.ts
(MODIFY — GET /)" exactly.

Pitfall 3 (from 129-RESEARCH.md) is explicitly closed: the /sessions/list
endpoint no longer reads only the role name. It now reads the identity file
ONCE and extracts BOTH the role AND cosmetics from the same markdown output.

## Deferred Issues

None from this plan.

**Wave 2 remaining deep-gate seam (not this plan's scope):**

- **129-04:** WS frame filtering (`app-frame-filter.ts`) + conversation-
  search filtering (`conversation-search.ts`) — every live-status heartbeat
  and every search result must respect the gate.

Together the four Wave 2 plans (129-02 identities + 129-03 sessions/roles +
129-04 WS/search) close the D-7 deep-gate contract ("Hidden identities leave
no evidence anywhere") end-to-end.

## Threat Flags

None. Every threat in the plan's `<threat_model>` register is mitigated
in-code as specified:

- **T-129-03-01** (info disclosure via /sessions/list orphan rows) — mitigated
  by per-session gate inside the fanout, single readIdentityFile per row
  (Assumption A5), parallel-Map filter after Promise.all with `!== false`
  semantic; Pitfall 3 closed.
- **T-129-03-02** (info disclosure via role picker) — mitigated by role-side
  gate with identityCos=null; NewSessionDialog naturally shows a shorter
  list.
- **T-129-03-03** (SSH DoS via doubled reads) — mitigated by Assumption A5
  fusion: sessions.ts reuses readIdentityFile output for BOTH role AND
  cosmetics; per-host roleReadCache mirrors identities.ts memo pattern.
- **T-129-03-04** (silent gate decisions) — mitigated by
  `sessions_gate_hidden` + `roles_list_gate_hidden` debug logs at every
  hidden-row decision with actionable context (sessionName/role, hostId,
  callerUsername).
- **T-129-03-05** (fail-closed on read error would empty sidebar) — accepted
  per D-8; read-error rows stay visible with role=null; parallel-Map
  `!== false` filter preserves this contract at the return seam.
- **T-129-03-SC** (npm installs) — accepted; no new packages installed.

No new security-relevant surface beyond what the plan's threat model
accounts for. No new endpoints, no schema changes, no auth path changes.

## Self-Check: PASSED

Files modified (verified via `git log --stat` on the 4 Task commits):

- `src/backend/database/routes/sessions.ts` — FOUND (commit `3adfcee9`)
- `src/backend/database/routes/sessions.test.ts` — FOUND (commit `d48f125d`)
- `src/backend/database/routes/roles-list-for-host.ts` — FOUND (commit `15644801`)
- `src/backend/database/routes/roles-list-for-host.test.ts` — FOUND (commit `536a797a`)

Commits (verified via `git log --oneline`):

- `d48f125d` — Task 1 RED (7 tests for sessions.ts; 4 failing on RED)
- `3adfcee9` — Task 1 GREEN (sessions.ts fused gate; all 66 pass)
- `536a797a` — Task 2 RED (7 tests for roles-list-for-host.ts; 5 failing on RED)
- `15644801` — Task 2 GREEN (roles-list-for-host.ts Option A gate; all 43 pass)

Verification test runs (all pass):

- Primary: `npx vitest related --run src/backend/database/routes/sessions.test.ts src/backend/database/routes/sessions.ts` → 66 pass
- Primary: `npx vitest related --run src/backend/database/routes/roles-list-for-host.test.ts src/backend/database/routes/roles-list-for-host.ts` → 43 pass
- Combined (all 4 test files + 2 primitives regressions): `5 files passed, 111/111 tests passed`

## Commits

| Task | Commit | Type | Files |
|------|--------|------|-------|
| 1 (RED) | d48f125d | test | sessions.test.ts (mocks + fixture helpers + 7 new tests) |
| 1 (GREEN) | 3adfcee9 | feat | sessions.ts (per-request lookup + fused gate + roleReadCache + visibleMap + return-time filter) |
| 2 (RED) | 536a797a | test | roles-list-for-host.test.ts (mocks + fixture helpers + 7 new tests) |
| 2 (GREEN) | 15644801 | feat | roles-list-for-host.ts (per-request lookup + rawCosByName + gate filter) |
