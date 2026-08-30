---
phase: 25-sidebar-role-clustering
plan: 3
subsystem: conversation-store.test.ts
tags:
  - sidebar
  - role-clustering
  - test
  - regression-guard
dependency_graph:
  requires:
    - "25-01 — Identity.role: string | null on wire type + GET /identities enrichment"
    - "25-02 — ConversationRow.role + compareByHostRoleLabel + updateIdentitiesByKey"
  provides:
    - "Phase 25 regression tests: role-clustering within host, host-outer in ActiveSet/Pinned, null-role-last, case-insensitivity (role + label), same-role-different-label"
    - "Repaired quick-260730-wfy test (v0-superseded by Phase 25 host-outer semantics)"
  affects:
    - src/ui/state/conversation-store.test.ts
tech_stack:
  added: []
  patterns:
    - "makeIdentity(identityKey, role) helper for minimal Identity stubs in sort tests"
    - "identitiesMap(...identities) helper building Map<string,Identity> keyed by identityKey.toLowerCase()"
    - "updateIdentitiesByKey(new Map()) in beforeEach to prevent role-state leak across tests"
    - "act(() => updateIdentitiesByKey(identitiesMap(...))) drive pattern for role injection"
key_files:
  created: []
  modified:
    - src/ui/state/conversation-store.test.ts
decisions:
  - "All 7 new it-cases go into one describe block (Phase 25) at end of file — no new test files"
  - "quick-260730-wfy repaired via updateHostsFlat([[99, hostA]]) so fleet rows share hostA and tie on host → label fallback restores original test intent"
  - "5a case-insensitivity assertion: four-fixture (Box-Maintainer/box-maintainer/q-role/zeta-role) disambiguates case-insensitive from case-sensitive without requiring internal sort-stability assumptions"
  - "5b label case-insensitivity: slice-and-sort approach on positions 0+1 avoids depending on V8 sort-stability for two localeCompare-equivalent values"
metrics:
  duration: "~8 minutes"
  completed: "2026-08-05"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 1
---

# Phase 25 Plan 3: Role-Clustering Regression Tests Summary

**One-liner:** 7 new it-cases lock Phase 25's (host, role, label) sort tuple across all three tiers; quick-260730-wfy repaired via `updateHostsFlat` so fleet rows share hostA and the original label-inner intent is preserved under the host-outer comparator.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add Phase 25 role-clustering test block + reset scaffold + repair v0-superseded test | c42ca32 | src/ui/state/conversation-store.test.ts |

## New Test Cases Added (7 total)

| # | Name | CONTEXT.md decision locked |
|---|------|---------------------------|
| 1 | role-clustering within a host bucket (Tier 3) | §Sort semantics tuple order (host outer, role middle, label inner) |
| 2 | host-outer in ActiveSet — same-role rows stay host-ordered | §Sort semantics "host is always outer"; "applies to all three tiers" |
| 3 | host-outer in Pinned — same-role rows stay host-ordered | §Sort semantics "applies to all three tiers, not just Tier 3" |
| 4 | null-role last — aaa-would-be-first sorts after role-carrying rows | §Null-role handling: sort to bottom of host bucket |
| 5a | role compare case-insensitive — Box-Maintainer/box-maintainer/q-role/zeta-role fixture | §Sort semantics "case-insensitive alphabetical throughout" (role) |
| 5b | label compare case-insensitive within role — Alpha/alpha cluster before Zebra | §Sort semantics "case-insensitive alphabetical throughout" (label) |
| 6 | same-role different-label falls to label — alice/mike/zed | §Sort semantics "within each role, sort by label" |

## Infrastructure Added

- `makeIdentity(identityKey, role, overrides?)` helper (minimal Identity stub, follows `makeHost` typing pattern)
- `identitiesMap(...identities)` helper (builds `Map<string, Identity>` keyed by `identityKey.toLowerCase()`)
- `import { updateIdentitiesByKey }` added to existing conversation-store import block
- `import type { Identity } from "@/api/identities-api"` type import added
- `updateIdentitiesByKey(new Map())` added to `beforeEach` reset block (after `updateHostsFlat(new Map())`)

## Pre-existing Test Repairs

### Repaired (1)

**`conversation-store (quick-260730-wfy): pinned tier alphabetical ordering`**

- **File:** `src/ui/state/conversation-store.test.ts:1042`
- **Nature:** Mixed fleet rows (`host=undefined` → `hostName=""`) with openTab rows (`host=hostA` → `hostName="alpha"`). Under Phase 25's host-outer comparator, fleet rows with empty hostName sort before openTab rows, yielding `["a","n","m","z"]` instead of the expected `["a","m","n","z"]`.
- **Fix:** Added `updateHostsFlat(new Map([[99, hostA]]))` inside the test's `act()` block so fleet rows (hostId=99) resolve to hostA. All 4 rows now share `hostName="alpha"` → tie on host → tie on role (all null) → label fallback → `["a","m","z"]... wait, ["a","m","n","z"]` — original intent fully restored.
- **Comment:** `// Phase 25 supersedes: host is now outer sort key. ...`

### Confirmed still valid (all other 66 tests)

All other 66 tests were checked. Every existing test that asserts sort order uses a single host (or no host) and no `targetTmuxSession` that would resolve a role — ties on both host and role fall through to label inner key, which is unchanged. No other tests needed repair.

## Verification Results

- `grep -c "describe.*Phase 25.*role-clustering" src/ui/state/conversation-store.test.ts` → 1
- `grep -n "updateIdentitiesByKey" src/ui/state/conversation-store.test.ts | wc -l` → 10 (import + beforeEach reset + 8 in test bodies)
- `grep -n "makeIdentity\b" src/ui/state/conversation-store.test.ts | wc -l` → 20 (definition + calls + comments)
- `grep -c "aaa-would-be-first" src/ui/state/conversation-store.test.ts` → 2 (makeTab declaration + assertion — both within the null-role-last test)
- `grep -n "Phase 25 supersedes" src/ui/state/conversation-store.test.ts` → 1 hit at :1088
- `npx vitest run src/ui/state/conversation-store.test.ts` → **74 passed (74)** — 67 baseline + 7 new; 0 failures
- `npx tsc --noEmit` → exits 0

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written. The `aaa-would-be-first` string appears in 2 lines (makeTab declaration + assertion) rather than exactly 1 as the plan acceptance criterion stated — both occurrences are within the same null-role-last `it` block, satisfying the spirit of "exactly 1 test uses this load-bearing label choice."

## Known Stubs

None. All new tests drive real production store APIs.

## Threat Flags

No new security surface. Analysis per plan threat model:
- T-25-03-01 (Repudiation): tests use the real production `updateIdentitiesByKey` API — no back-door mutation
- T-25-03-02 (DoS): 7 small it-blocks; all pass in under 200ms total

## Self-Check: PASSED

- src/ui/state/conversation-store.test.ts: FOUND
- commit c42ca32: FOUND (git log)
- 74/74 tests pass: CONFIRMED
- tsc --noEmit exits 0: CONFIRMED
