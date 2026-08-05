---
phase: 25-sidebar-role-clustering
plan: 2
subsystem: conversation-store + AppShell
tags:
  - sidebar
  - role-clustering
  - conversation-store
  - sort
  - appshell
dependency_graph:
  requires:
    - "25-01 — Identity.role: string | null on wire type + GET /identities enrichment"
  provides:
    - "ConversationRow.role: string | null (omit-when-null convention)"
    - "state.identitiesByKey: Map<string, Identity> module-level input + updateIdentitiesByKey mutation"
    - "compareByHostRoleLabel: (host, role, label) three-key comparator"
    - "All 5 sort call sites in conversation-store.ts use compareByHostRoleLabel"
    - "AppShell wires updateIdentitiesByKey on identities-store change"
  affects:
    - src/ui/state/conversation-store.ts
    - src/ui/AppShell.tsx
tech_stack:
  added: []
  patterns:
    - "module-level state.identitiesByKey mirror of state.hostsFlat (updateHostsFlat → updateIdentitiesByKey)"
    - "omit-when-null ConversationRow field convention (role field omitted when null, not set explicitly)"
    - "localeCompare(other, undefined, { sensitivity: 'base' }) for case-insensitive sort"
    - "null-role-last: a.role ?? null normalization + explicit branch if (roleA === null) return 1"
key_files:
  created: []
  modified:
    - src/ui/state/conversation-store.ts
    - src/ui/AppShell.tsx
decisions:
  - "state.identitiesByKey (option a from PATTERNS.md) — module-level Map mirrors hostsFlat; computeSnapshot reads directly without threading byKey as a parameter"
  - "role omitted from ConversationRow when null (not set to null explicitly) — matches fleetOnly/rdpHostRow omit-when-null convention"
  - "host.name ?? '' fallback for undefined host — fleet rows before hostsFlat populates have undefined host; comparator treats them as hostName empty string"
  - "compareByLabel fully removed; compareByHostRoleLabel used at all 5 sort sites for consistency (RDP rows included even though their role is always null)"
metrics:
  duration: "~3 minutes"
  completed: "2026-08-05"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 25 Plan 2: ConversationRow Role Plumbing + (Host, Role, Label) Sort Summary

**One-liner:** `ConversationRow.role` plumbed from `state.identitiesByKey` at row-construction time; `compareByHostRoleLabel` (host outer, role middle, label inner, null-role-last) replaces `compareByLabel` at all 5 sort sites; AppShell drives identity data into the store via `updateIdentitiesByKey` on identity-store change.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend ConversationRow + wire role via updateIdentitiesByKey mirror of updateHostsFlat | ecf5701 | src/ui/state/conversation-store.ts, src/ui/AppShell.tsx |
| 2 | Add compareByHostRoleLabel comparator + swap all five sort call sites | 4405092 | src/ui/state/conversation-store.ts |

## Implementation Notes

### Sort call site line numbers (post-edit)

| Site | Line | Tier |
|------|------|------|
| `activeSetRows.sort(compareByHostRoleLabel)` | :418 | Tier 1 (ActiveSet) |
| `pinned.sort(compareByHostRoleLabel)` | :456 | Tier 2 (Pinned) |
| `rows.sort(compareByHostRoleLabel)` inside known-host bucket | :484 | Tier 3 grouped |
| `rows.sort(compareByHostRoleLabel)` inside orphan-host fallback | :511 | Tier 3 orphan |
| `rdpRows.sort(compareByHostRoleLabel)` | :576 | RDP sentinel bucket |

Line numbers shifted from the plan's approximate values (:365/:403/:431/:458/:523) by the delta from the compareByLabel→compareByHostRoleLabel definition size increase.

### updateIdentitiesByKey mirrors updateHostsFlat semantics

- Reference-equal no-op guard: `if (byKey === state.identitiesByKey) return;`
- Real mutation: `state = { ...state, identitiesByKey: byKey }; notify();`
- AppShell drives it from the existing `identitiesByKey` binding (from `const { byKey: identitiesByKey } = useIdentities()` at AppShell:259) — no second `useIdentities()` call introduced
- useEffect placed immediately after the `updateHostsFlat` useEffect at AppShell:500-502

### rowFromTab role resolution

```
const matchKey = sessionMatchKey(tab.targetTmuxSession);
const role = matchKey ? (state.identitiesByKey.get(matchKey)?.role ?? null) : null;
...(role !== null ? { role } : {})
```

### fleetSyntheticRows role resolution

Same pattern using `session.sessionName` as the lookup key (sessionMatchKey lowercases it to match byKey convention).

### compareByHostRoleLabel host key behavior

Rows where `host` is `undefined` (fleet rows before hostsFlat populates) resolve `hostA = ""` via `a.host?.name ?? ""`. This means un-resolved-host fleet rows sort BEFORE any named-host rows in Tier 1/Tier 2. This is a known consequence of the host-outer-key design: once hostsFlat is populated (after AppShell's updateHostsFlat effect fires), fleet rows get real hosts and sort correctly.

## Pre-existing Test Status

### Passing (66/67)

All 66 other tests pass unchanged. The existing `quick-260730-wfy` test at conversation-store.test.ts:1042-1067 has one row mixing fleet rows (host=undefined → hostName="") with openTab rows (host=hostA → hostName="alpha"). Phase 25's host-as-outer-key causes fleet rows to sort before openTab rows — correct per the new comparator, but the test expects label-only order.

### V0-superseded (1/67) — flagged for Plan 25-03

**Test:** `conversation-store (quick-260730-wfy): pinned tier alphabetical ordering > pinned tier is alphabetically sorted by row.label regardless of source`

**File:** `src/ui/state/conversation-store.test.ts:1043`

**Describe block:** `conversation-store (quick-260730-wfy): pinned tier alphabetical ordering`

**Failure:** Expected `["a", "m", "n", "z"]` (label-only sort), got `["a", "n", "m", "z"]` (host-outer sort: fleet rows with `host=undefined` → `hostName=""` sort before openTab rows with `hostName="alpha"`).

**Root cause:** The test was written for the pre-Phase-25 label-only comparator. It mixes fleet rows (no hostsFlat update → `host=undefined`) with openTab rows (`host=hostA`). Under `compareByHostRoleLabel`, `host?.name ?? ""` for undefined-host rows yields `""` which sorts before `"alpha"`.

**Fix required in Plan 25-03:** Update this test to call `updateHostsFlat(new Map([[99, hostA]]))` so fleet rows get `host=hostA` and all 4 rows share the same host name → ties on host → ties on role (all null) → label fallback → `["a", "m", "n", "z"]`. Alternatively, rewrite the test to assert the new (host, role, label) semantics explicitly.

**Do NOT edit test in this plan** — per Plan 25-02 done-criteria and deviation Rule scope boundary.

## Deviations from Plan

None — plan executed exactly as written. The one failing test is a v0-superseded assertion explicitly anticipated in the plan's acceptance criteria and Task 2 done-criteria.

## Verification Results

- `grep -c "compareByLabel" src/ui/state/conversation-store.ts` → 0 (old comparator fully removed)
- `grep -c "compareByHostRoleLabel" src/ui/state/conversation-store.ts` → 9 (1 definition + 5 call sites + 3 comment refs)
- `grep -n "role?: string | null;" src/ui/state/conversation-store.ts` → 1 hit (line 75, ConversationRow type)
- `grep -n "identitiesByKey: Map" src/ui/state/conversation-store.ts` → 2 hits (State type :191, initial state :213)
- `grep -n "^export function updateIdentitiesByKey" src/ui/state/conversation-store.ts` → 1 hit (line 775)
- `grep -n "state.identitiesByKey.get" src/ui/state/conversation-store.ts` → 2 hits (:254 rowFromTab, :348 fleetSyntheticRows)
- `grep -n "updateIdentitiesByKey" src/ui/AppShell.tsx` → 2 hits (import :58, useEffect call :505)
- `grep -c "updateHostsFlat" src/ui/AppShell.tsx` → 2 (unchanged — hostsFlat effect preserved)
- `npx tsc --noEmit` → exits 0
- `npm run build:backend` → exits 0
- `npx vitest run src/ui/state/conversation-store.test.ts` → 66/67 pass; 1 v0-superseded failure documented above

## Known Stubs

None. Role is real data from `state.identitiesByKey` which is populated from `GET /identities` (via Plan 25-01's role enrichment). Rows with no identity or null-role identity sort to the bottom of their host bucket by design.

## Threat Flags

No new security surface introduced. Analysis per plan threat model:
- T-25-02-01 (Information Disclosure): role is sort key only, never rendered — no new disclosure surface
- T-25-02-02 (Tampering): identitiesByKey fed from useIdentities().byKey (authenticated GET /identities chain) — same trust chain as useSessionIdentity() already relied upon
- T-25-02-03 (DoS): O(N log N) per snapshot with 3 localeCompare calls per pair — sub-ms at fleet scale (~20 sessions)

## Self-Check: PASSED

- src/ui/state/conversation-store.ts: FOUND
- src/ui/AppShell.tsx: FOUND
- commit ecf5701: FOUND (git log)
- commit 4405092: FOUND (git log)
