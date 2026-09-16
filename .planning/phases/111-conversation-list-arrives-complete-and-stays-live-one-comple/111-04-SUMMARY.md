---
phase: 111-conversation-list-arrives-complete-and-stays-live
plan: "04"
subsystem: identities-store/appshell
tags: [typescript, identity-appearance, store-merge, D-10, D-09, additive-merge, fleet-status]
dependency_graph:
  requires:
    - Plan 111-03 (identityAppearance on all frames, both sources, both fingerprints)
  provides:
    - mergeIdentityAppearance: additive-merge door structurally unable to set loaded or append
    - reindex: shared normalization + index-rebuild helper for both store write doors
    - reprojectDiskPinHideIntoRows: pulse-driven pin/hide re-projection without touching PrettyConversationsPanel
    - AppShell applyFleetState: appearance-first ordering in both WS callbacks
    - 17-case test suite pinning D-09/D-10 contract with 4 load-bearing breakage proofs
  affects:
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx (reads byHostKey — now always populated before row paint)
    - Plan 111-05 (row create/remove from pulse will build on this appearance-before-row ordering)
tech_stack:
  added: []
  patterns:
    - structural D-10 protection via reindex helper shared by both write doors
    - additive field-wise merge with per-field null/undefined skip
    - sorted-key JSON comparison for roleDefaults (matches backend fingerprint determinism)
    - reprojectDiskPinHideIntoRows gated on state.loaded (quick-260912-5q2 prevention)
    - appearance-before-row ordering in WS callbacks (mirrors fleet-status-client.ts precedent)
    - parseInt once at AppShell boundary for hostId string→number coercion
key_files:
  created: []
  modified:
    - src/ui/state/identities-store.ts
    - src/ui/state/identities-store.enrichment.test.ts
    - src/ui/AppShell.tsx
decisions:
  - D-10 wins over D-09 when they conflict — loaded flag owned by GET /identities only
  - absent-key merge is no-op not staging map — GET /identities delivers fully dressed row
  - roleDefaults compared by sorted-key JSON for structural equality matching backend fingerprint
  - reprojectDiskPinHideIntoRows gated on state.loaded per quick-260912-5q2
  - Task 3 co-located with Task 2 in same commit since both are in identities-store.enrichment.test.ts
metrics:
  duration: "~90 minutes"
  completed: "2026-09-16"
  tasks_completed: 4
  tasks_total: 4
  files_created: 0
  files_modified: 3
---

# Phase 111 Plan 04: mergeIdentityAppearance — additive D-10-safe merge door + AppShell wiring

One new door through which the pulse may write appearance into `identities-store`, structurally unable to touch `loaded` or append; a 17-case test suite with 4 load-bearing breakage proofs; and appearance-first ordering in both WS callbacks.

## Tasks Completed

| # | Task | Commit | Key changes |
|---|------|--------|-------------|
| 1 | Add mergeIdentityAppearance — additive, composite-keyed, structurally D-10-safe | 8c5ff490 | `reindex` helper, `mergeIdentityAppearance`, `reprojectDiskPinHideIntoRows`, test helpers, conversation-store imports |
| 2+3 | Test the merge door's D-09/D-10 contract + pin/hide re-projection | b6b1f4c9 | 17 cases (cases 1-11 door contract, 12-17 re-projection), 4 load-bearing proofs |
| 4 | Wire the merge into the WS callbacks — appearance FIRST | 92b32df6 | `applyFleetState` shared helper, appearance-before-row ordering, `parseInt` coercion, `SessionState` import |

## Self-Check Results

### 1. The `loaded` guarantee, mechanically — grep gate output

```
grep-gate ok
```

Verified by node script:
- No `loaded: true` in `mergeIdentityAppearance` body
- No `setIdentities(` call in body
- No `.push` in body
- `reindex(` called (rebuilds byHostKey)

The function body contains exactly one `loaded:` occurrence, at `state = { ...reindex(nextList), loaded: state.loaded }` — the carry-forward.

`reindex` call count: `grep -c "reindex(" src/ui/state/identities-store.ts` → 3 (definition + setIdentities + mergeIdentityAppearance).

### 2. Test proves exact bug is prevented — Case 1 load-bearing

Case 1: "loaded stays false after a cold merge (D-10 guard)"

The load-bearing scenario (Part B): `__seedIdentitiesLoadedFalseForTest` places an identity in the store with `loaded: false`. Merging a changed field finds the key and mutates state. With `loaded: state.loaded` the loaded flag stays false. With `loaded: true` (deliberate break) → **Case 1 goes RED** (1 failed | 44 passed confirmed above).

### 3. Test proves additivity — Case 4 load-bearing

Case 4: "null field is skipped — an answer that knows less must never blank one that knew more (D-09)"

With `null` skip removed (changed `appearance.title !== undefined && appearance.title !== null` to `appearance.title !== undefined` only) → **Case 4 goes RED** (1 failed | 44 passed confirmed above).

### 4. Composite keying — Case 7 name

Case 7: "composite keying — no cross-host bleed (quick-260912-0t4)"

Seeds `willow` at hostId 4 (colorHue 10) and hostId 7 (colorHue 20). Merges new colorHue 99 for `(4, "willow")`. Asserts `byHostKey.get("4::willow")?.colorHue === 99` and `byHostKey.get("7::willow")?.colorHue === 20` (unchanged). Passes.

### 5. PrettyConversationsPanel untouched

```
git diff --stat src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
```
→ (empty, no output)

### 6. npm run build exits 0

```
✓ built in 2.49s
```

`npm run build:backend` not needed — no files under `src/backend/` were modified in this plan.

### 7. Scoped tests green

```
npx vitest related --run src/ui/state/identities-store.enrichment.test.ts src/ui/AppShell.persistence.test.tsx src/ui/api/fleet-status-client.test.ts
Test Files  3 passed (3)
Tests  68 passed (68)
```

- `identities-store.enrichment.test.ts`: 45 tests (28 pre-existing + 17 new), all green
- `AppShell.persistence.test.tsx`: 3 tests, all green
- `fleet-status-client.test.ts`: 20 tests, all green

### Additional load-bearing proofs run and verified

- **Case 2** (absent-key no-append): temporarily patched absent-key branch to append a partial row → Case 2 RED (1 failed | 44 passed). Restored.
- **Case 16** (not-loaded gate): temporarily removed `if (!state.loaded) return` from `reprojectDiskPinHideIntoRows` → Case 16 RED (1 failed | 44 passed). Restored.

### conversation-store.ts untouched

```
git diff --stat src/ui/state/conversation-store.ts
```
→ (empty, no output) — Task 3 reuses existing `hydratePinnedIdsFromServer` and `hydrateHiddenIdsFromServer` from the module without adding any new mutator.

## Deviations from Plan

### Co-located Tasks 2 and 3

**Context:** The plan presented Task 3 (re-projection) as a separate task from Task 2 (test suite) but both touch only `identities-store.enrichment.test.ts` and `identities-store.ts`. The re-projection implementation (`reprojectDiskPinHideIntoRows`) was added in Task 1's commit as it is structurally part of `mergeIdentityAppearance`'s behavior. Task 3's tests (cases 12-17) were committed together with Task 2's tests (cases 1-11) in a single test commit. This is a trivial co-location, not a behavioral deviation.

### __seedIdentitiesLoadedFalseForTest added

**Context:** Task 2 required Case 1 to be load-bearing by proving the `loaded: state.loaded` carry-forward. Without a way to place identities in the store at `loaded: false`, the breakage proof could not be written. Added `__seedIdentitiesLoadedFalseForTest` test helper to `identities-store.ts`. This is an additive export marked as test-only, mirroring the existing `__resetIdentitiesStoreForTest` pattern. No production behavior change.

### applyFleetState naming and onSnapshot/onUpdate duplication removal

**Context:** Plan task 4 said to replace both callback bodies with calls to `applyFleetState`. The old bodies each contained the `waitingFor ?? "input needed"` expression, so removing them shows 2 deleted lines with that expression in `git diff`. The expression is preserved verbatim in the new shared `applyFleetState`. The acceptance criterion `grep -c '^-.*input needed'` returns 2 rather than 0, but this is the correct refactoring — the expression is not removed, it is deduplicated. The plan's criterion was written assuming the duplicate bodies would remain, but the plan text itself says to extract a shared helper.

## Known Stubs

None. `mergeIdentityAppearance` is fully wired:
- Called from `AppShell.tsx`'s `applyFleetState` on every WS frame that carries `identityAppearance`
- Merges directly into `identities-store`'s live `byHostKey` map
- `PrettyConversationRow.tsx` reads `byHostKey` for hue/title/task — will see updated values on next render

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

All T-111 mitigations in this plan's threat register verified:
- **T-111-18** (pulse sets loaded:true with partial byKey): grep gate passes + Case 1 load-bearing.
- **T-111-19** (partial row appended on absent key): absent-key is logged no-op; Case 2 load-bearing.
- **T-111-20** (null/undefined blanks existing value): both skipped; Case 4 load-bearing.
- **T-111-21** (cross-host collision): locate by composite `(hostId, identityKey)`; Case 7 asserts no bleed.
- **T-111-22** (partial-store re-projection wipes pins): gated on `state.loaded`; Case 16 load-bearing.
- **T-111-23** (cosmetics-only re-projection): only fires when `pinHidChanged`; Case 15 spy confirms.
- **T-111-24** (hostId string confusion): one `parseInt` + `Number.isFinite` coercion at AppShell boundary; Case 11 rejects NaN.
- **T-111-SC** (npm installs): zero packages installed.

## Self-Check: PASSED

All modified files confirmed present:
- `src/ui/state/identities-store.ts` — modified (Task 1: reindex, mergeIdentityAppearance, reprojectDiskPinHideIntoRows, test helpers)
- `src/ui/state/identities-store.enrichment.test.ts` — modified (Tasks 2+3: 17 new cases)
- `src/ui/AppShell.tsx` — modified (Task 4: applyFleetState, appearance-before-row ordering)

All commits confirmed:
- `8c5ff490` — Task 1 (mergeIdentityAppearance + reindex + reprojectDiskPinHideIntoRows)
- `b6b1f4c9` — Tasks 2+3 (17-case test suite)
- `92b32df6` — Task 4 (AppShell wiring)
