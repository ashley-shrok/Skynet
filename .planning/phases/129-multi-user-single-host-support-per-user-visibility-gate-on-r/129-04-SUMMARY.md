---
phase: 129-multi-user-single-host-support-per-user-visibility-gate-on-r
plan: 04
subsystem: backend
tags: [gate, deep-gate-seam, tdd, wave-2, search-surface, fail-closed-exception]
dependency_graph:
  requires:
    - "129-01 (isIdentityVisibleToUser + getUsernameForUserId + RawCosmetics.users? + extractCosmeticsFromFrontmatter narrower)"
  provides:
    - "POST /conversation-search is now per-user filtered — the last of the four D-7 deep-gate seams (Pitfall 4 closed)"
    - "Batched per-unique-identityKey frontmatter fetch — O(unique keys in the result page), bounded by DEFAULT_LIMIT (20). Test E lock."
    - "Fail-CLOSED read-error discipline for the search surface — Phase 129 exception documented in PATTERNS.md § Shared Patterns. Test F lock."
    - "Per-host roleReadCache memoization mirrors identities.ts L399-424 pattern for role-file reuse across identityKeys sharing the same role"
  affects:
    - "Frontend search UI (Phase 122 Plan 03) naturally receives a shorter result set for callers on multi-user hosts; zero frontend code change (D-6)"
    - "With 129-02 (identities) + 129-03 (sessions + roles picker) + this plan, three of the four D-7 read-path seams are closed; 129-05 (WS frames) closes the live-status heartbeat surface"
tech-stack:
  added: []
  patterns:
    - "Batched O(unique-keys) frontmatter fetch (Pitfall 4 discipline) — new Set(rows.map(...)) dedup + Promise.all per unique key + gateMap<identityKey, boolean>"
    - "Fail-CLOSED filter shape: `gateMap.get(r.identityKey) === true` (NOT `!== false`) — intentional inversion of the list-endpoint fail-open shape; documented in code + PATTERNS.md exception"
    - "Per-host roleReadCache memo mirrors identities.ts L399-424 (in-flight Promise storage collapses parallel duplicate role reads within the same wave)"
    - "vi.hoisted mock-counter for batched-lookup discipline assertions (Test E reads readIdentityFileMock.mock.calls.length)"
    - "REAL isIdentityVisibleToUser via vi.importActual cascade — integration tests exercise real D-2 semantics rather than re-testing what the pure-fn suite (Plan 129-01) already covers"
key-files:
  created: []
  modified:
    - src/backend/database/routes/conversation-search.ts
    - src/backend/database/routes/conversation-search.test.ts
decisions:
  - "Search surface is fail-CLOSED on per-hit frontmatter read error (opposite of identities.ts / sessions.ts / roles-list-for-host.ts which are fail-open). Rationale locked in code docblock: search returns hits DELIBERATELY targeted by a query, so leaking a hit for a hidden identity is more visible than dropping an inaccessible identity — the D-7 depth invariant wins over the D-8 fail-open default in the search context. Documented as PATTERNS.md § Shared Patterns 'Read-path fail-open, write-path fail-closed' explicit exception."
  - "Filter shape uses `=== true` (not `!== false`) to lock the fail-closed discipline. `!== false` would silently flip search's fail-closed to fail-open on any unresolved key. Test F is the regression lock; gateHostRows docblock explicitly forbids drift."
  - "PER-REQUEST side is fail-OPEN on null callerUsername (Test G). Distinct from per-HIT fail-closed. Rationale: a null callerUsername is an infra bug, not a gate signal; treating it as 'hide everything' would empty every user's search results on the affected code path. Documented in gateHostRows docblock + per-request warn log."
  - "Gate helper `gateHostRows` lives in-file (not extracted) — the batched fetch + memoization + fail-closed shape are tightly coupled to this endpoint's DEFAULT_LIMIT bound + O(unique keys) discipline. Extracting would need a generic shape that would either bury the fail-closed discipline or force every caller to re-declare it. Sessions.ts + identities.ts use their OWN per-file fanout patterns for the same reason (D-4 read-path patterns are intentionally per-endpoint)."
  - "Gate applied to BOTH live and archive hits via the SAME gateMap. runOneHost already returns rows from both branches with correctly-tagged identityKey values, so the gate's per-unique-key dedup naturally covers both. No per-branch plumbing needed. Test D locks archive coverage."
  - "REAL isIdentityVisibleToUser used via vi.importActual instead of mocking. Rationale: the pure D-2 intersection matrix is already exhaustively tested at the pure-fn level (Plan 129-01 identity-visibility-gate.test.ts, 10 tests). Tests here exercise the WIRING through actual gate semantics — mocking would silently allow wiring bugs (e.g. passing arguments in the wrong order) to pass."
metrics:
  duration_seconds: ~450
  duration_human: "~8 min executor time"
  completed_date: 2026-09-23
  new_tests: 7
  total_tests_run: 56
  test_files_touched: 1
  source_files_modified: 1
---

# Phase 129 Plan 129-04: Per-user visibility gate on POST /conversation-search Summary

**One-liner:** Closes the search-surface leak per D-7 by post-filtering
`POST /conversation-search` with a batched O(unique-identityKeys)
frontmatter fetch and a FAIL-CLOSED gate — the last of the four Wave-2
deep-gate seams, and the ONE endpoint that intentionally inverts the
list-endpoint fail-open discipline per PATTERNS.md § Shared Patterns.

## What Shipped

### 1. POST /conversation-search per-user gating (D-7 deep-gate seam #4 — Pitfall 4 closed)

Three coordinated edits in `conversation-search.ts`:

**A. Per-request callerUsername fetch (L686-696):** Runs EXACTLY ONCE
per request BEFORE the per-host fanout. Null result logs a warn with
`operation: "search_gate_username_missing"` and DISABLES the gate (D-8
fail-open on the per-REQUEST side — a null caller is an infra bug, not
a gate signal; per-request emptiness would be a worse UX than surfacing
everything with a warn crumb).

**B. Batched per-host gate helper `gateHostRows` (L432-548):**

- Dedups `rows.map((r) => r.identityKey)` via `new Set` → `uniqueKeys`.
  O(unique identityKeys in the result page), bounded by `DEFAULT_LIMIT`
  (20). Pitfall 4 O(unique) discipline; Test E lock.
- Per-host `roleReadCache = new Map<string, Promise<RawCosmetics | null>>()`
  mirrors identities.ts L399-424 memo pattern — role file read AT MOST
  ONCE per gate pass across all keys sharing that role. Storing the
  in-flight Promise collapses parallel duplicate role reads within the
  same wave.
- **FAIL-CLOSED** on per-key frontmatter read error (Phase 129 exception
  per PATTERNS.md). Warn log fires with `operation: "search_gate_read_error"`
  for the drop; the hit is dropped, not surfaced with unresolved gate
  state. Test F lock.
- Filter shape `gateMap.get(row.identityKey) === true` (NOT `!== false`)
  — the intentional inversion of the sessions.ts / identities.ts
  fail-open shape MUST NOT drift back. Docblock explicitly forbids the
  drift and Test F is the regression lock at the wire.
- Structured `systemLogger.debug` fires per dropped hit with
  `operation: "search_gate_hidden"` + hostId + identityKey +
  callerUsername (box-maintainer directive for gate-seam logs;
  T-129-04-05 mitigation).

**C. Gate call site inside per-host block (L749-762):** Gate applied
AFTER `runOneHost` returns hits and BEFORE they get accumulated into the
outer flat array. Both live and archive branches share the same gateMap
via runOneHost's unified return path — no per-branch plumbing (Test D
lock). Wraps the returned rows as a synchronous next step (no additional
Promise.race overhead; the race already bounded runOneHost).

## Final Signatures (call sites)

```typescript
// src/backend/database/routes/conversation-search.ts

// L689 — per-request lookup
const callerUsername = await getUsernameForUserId(userId);

// L432-548 — batched gate helper (in-file)
async function gateHostRows(
  conn: Parameters<typeof discoverIdentitySessionFile>[0],
  hostId: number,
  callerUsername: string | null,
  rows: ConversationSearchResult[],
): Promise<ConversationSearchResult[]>;

// L461 — batched-lookup dedup (Pitfall 4)
const uniqueKeys = Array.from(new Set(rows.map((r) => r.identityKey)));

// L506 — per-unique-key gate
gateMap.set(
  key,
  isIdentityVisibleToUser(identityCos, roleCos, callerUsername),
);

// L512 — fail-CLOSED on read error (Phase 129 exception)
gateMap.set(key, false);

// L530 — fail-CLOSED filter shape (=== true, NOT !== false)
if (gateMap.get(row.identityKey) === true) { ... }
```

New imports added:

```typescript
import { sshLogger, systemLogger } from "../../utils/logger.js";
import {
  extractCosmeticsFromFrontmatter,
  extractRoleFromMarkdown,
  listIdentityKeysOnHost,
  readIdentityFile,
  readRoleFileByName,
} from "../../claude-session/identity-artifact-reader.js";
import { isIdentityVisibleToUser } from "../../fleet-status/identity-visibility-gate.js";
import type { RawCosmetics } from "../../fleet-status/identity-appearance.js";
import { getUsernameForUserId } from "../../utils/host-user-counter.js";
```

## Tests

**7 net-new tests in a new `describe("Phase 129: search-surface
visibility gate", ...)` block. RED → GREEN cycle verified via commit
sequence.**

| Cycle | RED commit | GREEN commit | RED result | GREEN result |
|-------|-----------|--------------|-----------|--------------|
| Search gate | `eaeb44fa` | `63d1d68e` | 5 fail (B, C, D, F, G) | 18/18 pass (11 pre-existing + 7 new) |

Tests A and E pass on RED as regression locks — Test A is the "no-gate
regression preserved" lock (both users see all hits when no `users:`
frontmatter exists), and Test E's `≤ 3` batched-lookup assertion is
trivially satisfied on RED (readIdentityFile called 0 times pre-GREEN),
but becomes the real invariant lock on GREEN (readIdentityFile called
EXACTLY 3 times — one per unique key). This mirrors the "regression
locks pass on RED" pattern documented in Plan 129-03 SUMMARY § "Sessions
plan Test G was passing on RED 'by accident'".

### Test coverage matrix

| # | Test | Coverage | RED | GREEN |
|---|------|----------|-----|-------|
| A | Single-user host, no `users` key | Zero regression preserved | pass (regression lock) | pass |
| B | Identity `users:[ashley]` | D-7 no-leak: Zoe sees ZERO hits from muffin | fail | pass |
| C | Role `users:[ashley]` (identity untagged) | D-2 role-side gate closes for Zoe | fail | pass |
| D | Archived identity `users:[ashley]` | Archive branch honors the same gate | fail | pass |
| E | 20 hits × 3 unique keys | Batched O(unique) discipline: ≤ 3 readIdentityFile calls | pass (0 calls → trivially ≤ 3) | pass (exactly 3) |
| F | readIdentityFile throws mid-fetch | FAIL-CLOSED (Phase 129 exception): hit DROPPED + warn log | fail | pass |
| G | getUsernameForUserId returns null | FAIL-OPEN per-request (defensive): gate DISABLED + warn log | fail | pass |

**Verification commands:**

```bash
# Primary
npx vitest related --run \
  src/backend/database/routes/conversation-search.test.ts \
  src/backend/database/routes/conversation-search.ts

# Full plan-end verification (includes primitives regression)
npx vitest related --run \
  src/backend/database/routes/conversation-search.test.ts \
  src/backend/database/routes/conversation-search.ts \
  src/backend/fleet-status/identity-visibility-gate.test.ts \
  src/backend/utils/host-user-counter.test.ts
# Result: 4 files passed, 56/56 tests passed
```

## Acceptance Criteria — grep verification

### Task 1 (RED tests)

| Criterion | Command | Expected | Actual |
|-----------|---------|----------|--------|
| Phase 129 describe block exists | `grep -c "Phase 129: search-surface visibility gate" conversation-search.test.ts` | 1 hit | 1 hit |
| Fixture helpers present | `grep -c "mockSearchWithIdentityUsers\|mockSearchHits\|mockReadIdentityFileCounter" conversation-search.test.ts` | ≥3 hits | 12 hits (definitions + call sites) |
| Test F warn-log assertion | `grep -n "search_gate_read_error" conversation-search.test.ts` | ≥1 hit | 2 hits |

### Task 2 (GREEN source)

| Criterion | Command | Expected | Actual |
|-----------|---------|----------|--------|
| Per-request username fetch | `grep -n "getUsernameForUserId(userId)" conversation-search.ts` | 1 hit | 1 hit (L689) |
| Single gate call site (per-unique-key inside Promise.all) | `grep -n "isIdentityVisibleToUser(" conversation-search.ts` | 1 hit | 1 hit (L506) |
| Batched-lookup dedup | `grep -n "new Set(rows.map" conversation-search.ts` | ≥1 hit | 1 hit (L461) |
| Fail-CLOSED filter shape | `grep -n "gateMap.get(row.identityKey) === true\|gateMap.get(r.identityKey) === true" conversation-search.ts` | ≥1 hit | 2 hits (docblock L437 + call site L530) |
| Three structured log seams | `grep -n "search_gate_read_error\|search_gate_hidden\|search_gate_username_missing" conversation-search.ts` | ≥3 hits | 3 hits (L516, L534, L694) |
| Fail-CLOSED in catch branch | `grep -c "gateMap.set(key, false)" conversation-search.ts` | ≥1 | 1 hit (L512, inside catch) |

## Line-count Deltas

| File | Type | Lines |
|------|------|-------|
| src/backend/database/routes/conversation-search.ts | modified | +174 (imports + per-request lookup block + gateHostRows helper + per-host call-site wiring + comments/docblocks) |
| src/backend/database/routes/conversation-search.test.ts | modified | +478 (systemLogger mock + readIdentityFile/readRoleFileByName mocks + getUsernameForUserId mock + Phase 129 describe block + 3 fixture helpers + 7 tests) |

## Batched-lookup verification (Pitfall 4 O(unique-keys) discipline)

Test E's assertion locks the invariant at the wire:

```typescript
// 20 hits × 3 unique identityKeys
const readCount = mockReadIdentityFileCounter();
// ... fire request ...
expect(readCount()).toBeLessThanOrEqual(3);
```

On GREEN, `readIdentityFile` is called EXACTLY 3 times — one per unique
key in `uniqueKeys = Array.from(new Set(rows.map((r) => r.identityKey)))`.
This matches PATTERNS.md § "conversation-search.ts (MODIFY — POST L498-628)"
expectation ("O(unique identityKeys in the result page), bounded by
DEFAULT_LIMIT") and satisfies the RESEARCH § Pitfall 4 discipline that
motivated placing the gate at THIS seam rather than inside runOneHost's
per-hit loop.

## Fail-CLOSED exception rationale (Phase 129 exception per PATTERNS.md)

The fail-CLOSED read-error discipline in `gateHostRows` is INTENTIONAL
and locked in three places:

1. **File-scoped code docblock** (gateHostRows JSDoc L432-458) — cites
   PATTERNS.md § Shared Patterns "Read-path fail-open, write-path
   fail-closed" as the exception's canonical home; explains the D-7 vs
   D-8 trade-off in the search context.
2. **In-body inline comment** (`gateMap.set(key, false)` catch branch
   L509-517) — reiterates "search hit for an identity we could not verify
   visibility on MUST NOT be surfaced" so anyone touching the catch
   branch sees the discipline at the point of modification.
3. **Test F regression lock** — mocks `readIdentityFile` to throw for
   one identity and asserts (a) that identity's hit is dropped from the
   response, (b) `search_gate_read_error` warn fires. Any drift from
   fail-closed back to fail-open (e.g. changing `=== true` to `!== false`,
   or moving `gateMap.set(key, false)` out of the catch branch) will
   flip Test F to failing.

The PER-REQUEST side remains fail-OPEN on null callerUsername (Test G) —
a null caller is an infra bug (JWT userId with no `users` row), not a
gate signal. Treating it as "hide everything" would empty every user's
search results on the affected code path, a worse UX than surfacing
everything with a warn crumb. Test G locks this at the wire.

The two error-path halves have DIFFERENT disciplines because they
represent DIFFERENT signals: F is "we cannot resolve the gate for THIS
identity" (fail-closed per D-7); G is "we cannot resolve WHO is asking"
(fail-open per D-8).

## Deviations from Plan

None — the plan was executed exactly as written for both tasks. No Rule 1
(bug), Rule 2 (missing critical functionality), Rule 3 (blocking issue),
or Rule 4 (architectural change) deviations were needed.

### Minor implementation notes (NOT deviations from the plan's contract)

**1. Gate helper extracted as `gateHostRows` in-file rather than inlined
inside the per-host `try` block.** The plan's `<action>` bullets 1-3
described the wiring as inline steps inside the per-host block. Extracting
to a named function keeps the docblock and the fail-closed rationale
grouped in one place, gives the compiler a clean type surface for the
`rows` parameter, and lets the per-host block's caller stay compact (2
lines: `const gatedRows = await gateHostRows(...); return gatedRows;`).
No semantic difference from the inline shape.

**2. Test A / Test E pass on RED as regression locks.** Same pattern
documented in Plan 129-02 SUMMARY § "Test A / Test B strengthening for
RED discrimination" and Plan 129-03 SUMMARY § "Sessions plan Test G was
passing on RED 'by accident'". Test A is the "no-gate zero-regression"
lock (both users see all hits when no `users:` frontmatter exists —
guarantees the D-3 fallback rule stays intact across GREEN). Test E's
≤ 3 assertion is trivially satisfied on RED (readIdentityFile called 0
times), but becomes the real Pitfall-4 invariant lock on GREEN (called
EXACTLY 3 times). Both would fail if a future edit regressed either
invariant, which is the regression-lock role documented in the plan.

**3. REAL isIdentityVisibleToUser via vi.importActual (rather than mocked).**
The plan's `<action>` for Task 1 said "Reuse existing vi.mock stack" but
did not specify whether the gate module should be mocked or real. Chose
REAL via `vi.importActual` cascade because:
- The D-2 intersection matrix is already exhaustively tested at the
  pure-fn level (Plan 129-01 identity-visibility-gate.test.ts — 10 tests).
- Mocking would silently allow wiring bugs to pass (e.g. passing
  arguments in the wrong order — `isIdentityVisibleToUser(roleCos,
  identityCos, callerUsername)` would be a functional bug but a mocked
  gate wouldn't catch it).
- Test setup burden is zero — vi.importActual with a spread is one line.

**4. vi.hoisted usage for mock references.** Standard vitest scaffolding
pattern (mirrors Plans 129-02 + 129-03). `readIdentityFileMock`,
`readRoleFileByNameMock`, `getUsernameForUserIdMock`, `systemLoggerWarnMock`,
and `systemLoggerDebugMock` are all co-hoisted alongside the vi.mock
factories. No functional impact.

**5. Batched roleReadCache added to gateHostRows.** The plan action
mentioned `roleReadCache` per host as a mirror of identities.ts's
pattern. Implementation adds it as documented (in-flight Promise storage
collapses parallel duplicate role reads). A cheap benefit even at
DEFAULT_LIMIT=20 rows if multiple identities share the same role on the
same host — no worse than sessions.ts's identical pattern.

## Assumption Changes vs RESEARCH

None. All RESEARCH assumptions (A1 hostAccess authoritative, A2
case-sensitive, A5 single-round-trip discipline preserved via the
per-host readIdentityFile + roleReadCache memoization, A6 RBAC-role
expansion already handled by Plan 129-01's isHostMultiUser — not
exercised here since search is a READ path with no auto-tag) carry
through unchanged.

Pitfall 4 (from 129-RESEARCH.md) is explicitly closed at the wire: the
gate fetches frontmatter per UNIQUE key, not per hit; DEFAULT_LIMIT
bounds the result page so total SSH cost stays predictable.

The fail-CLOSED exception is documented in the plan (must_haves.truths
bullet 4) and reiterated here — this plan is the definitive on-code
documentation of the exception. PATTERNS.md § Shared Patterns "Read-path
fail-open, write-path fail-closed" already lists conversation-search.ts
as an exception; this plan's docblocks + tests + this SUMMARY close the
audit trail.

## Deferred Issues

None from this plan.

**Wave 2 remaining deep-gate seam (not this plan's scope):**

- **129-05:** WS frame filtering (`app-frame-filter.ts`) — the live-status
  heartbeat surface. Once 129-05 lands, all four D-7 read-path seams are
  closed end-to-end.

## Threat Flags

None. Every threat in the plan's `<threat_model>` register is mitigated
in-code as specified:

- **T-129-04-01** (info disclosure via search leak of hidden identity) —
  mitigated by batched per-host gate lookup + fail-closed post-filter.
  Hidden hits are DROPPED before entering the aggregated response
  (Tests B, C).
- **T-129-04-02** (archive-branch bypass) — mitigated by shared gateMap
  across live and archive branches (Test D lock).
- **T-129-04-03** (perf: per-hit SSH read causes O(hits) reads) — mitigated
  by `new Set(rows.map(...))` dedup + O(unique keys) fetch (Test E lock;
  ≤ 3 calls for 20 hits × 3 unique keys).
- **T-129-04-04** (DoS: fail-closed empties legitimate results on
  transient SSH error) — accepted per PATTERNS.md exception; the search
  UX trade-off is deliberate. Per-hit warn log
  (`search_gate_read_error`) gives ops visibility.
- **T-129-04-05** (repudiation: silent per-hit drops during
  troubleshooting) — mitigated by warn `search_gate_read_error`
  (dropped-because-unresolvable) + debug `search_gate_hidden`
  (dropped-because-hidden); DISTINCT operations so ops can
  differentiate.
- **T-129-04-SC** (npm installs) — accepted; no new packages installed.

No new security-relevant surface beyond what the plan's threat model
accounts for. No new endpoints, no schema changes, no auth path changes.

## Self-Check: PASSED

Files modified (verified via `git log --stat`):

- `src/backend/database/routes/conversation-search.ts` — FOUND (commit `63d1d68e`)
- `src/backend/database/routes/conversation-search.test.ts` — FOUND (commit `eaeb44fa`)

Commits (verified via `git log --oneline`):

- `eaeb44fa` — Task 1 RED (7 tests + fixture helpers + Phase 129 mocks)
- `63d1d68e` — Task 2 GREEN (per-request lookup + gateHostRows helper + per-host wiring)

Verification test runs (all pass):

- `npx vitest related --run src/backend/database/routes/conversation-search.test.ts src/backend/database/routes/conversation-search.ts` → 2 files passed, 18/18 tests passed (11 pre-existing + 7 new)
- `npx vitest related --run src/backend/database/routes/conversation-search.test.ts src/backend/database/routes/conversation-search.ts src/backend/fleet-status/identity-visibility-gate.test.ts src/backend/utils/host-user-counter.test.ts` → 4 files passed, 56/56 tests passed

## Commits

| Task | Commit | Type | Files |
|------|--------|------|-------|
| 1 (RED) | eaeb44fa | test | conversation-search.test.ts (Phase 129 describe block + fixture helpers + 7 new tests + mock extensions) |
| 2 (GREEN) | 63d1d68e | feat | conversation-search.ts (per-request lookup + gateHostRows helper + per-host wiring + 5 structured log seams) |
