---
phase: 111-conversation-list-arrives-complete-and-stays-live
plan: "03"
subsystem: fleet-status/ssh-poll-orchestrator
tags: [typescript, appearance, fingerprint, both-sources, publish-suppress, cache]
dependency_graph:
  requires:
    - Plan 111-01 (sweep emits role, identity_cosmetics, role_cosmetics, pinned, hidden)
    - Plan 111-02 (resolveIdentityAppearance authority, IdentityAppearance type, SweepIdentityLine widened)
  provides:
    - appearance on both fetched structs + both cache entries
    - appearanceFromIdentityLine shared helper (one call site for resolveIdentityAppearance)
    - appearanceFingerprintSegment with sorted-key roleDefaults serialization
    - computeFingerprint widened with appearance segment at END
    - source B inline fingerprint widened with appearance segment at END (first ever)
    - all 3 frame sites carry identityAppearance
    - all 4 cache branches stamp identityAppearance
    - 12 tests covering both sources, both fingerprints, pre-evict frame, mid-distribution host
  affects:
    - Plan 111-04 (frontend reads identityAppearance off frames)
tech_stack:
  added: []
  patterns:
    - fail-closed pinned/hidden sentinels (=== true, never ?? false) per Phase 107 discipline
    - sorted-key roleDefaults serialization for deterministic fingerprint (T-111-17)
    - append-at-END fingerprint rule obeyed at both sites
    - legacy path returns identityAppearance: null at all early-return branches
    - sessionIdRotated block explicitly does NOT reset appearance (identity-scoped)
key_files:
  created: []
  modified:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
decisions:
  - Source B's inline fingerprint extended for the first time in this codebase — the
    borrowed rulebook from Phase 62's computeFingerprint commits, not a prior diff
  - No source-B frame factory extracted (8,072-line test file blast radius; documented
    as follow-up candidate)
  - Legacy path explicitly returns identityAppearance: null with comment explaining why
    (D-01: adding an appearance source to legacy would mean new SSH channels)
  - PidCacheEntry.identityAppearance: the suppress-branch spread naturally carries
    the field forward, but the explicit stamp is still correct (overwrites with fresh value)
metrics:
  duration: "~55 minutes"
  completed: "2026-09-16"
  tasks_completed: 3
  tasks_total: 3
  files_created: 0
  files_modified: 2
---

# Phase 111 Plan 03: Thread appearance through the orchestrator at both publish sources

Appearance is now on the wire for every identity the sweep enumerates — busy agents via source A (live PID path, computeFingerprint), dormant agents via source B (identity-keyed path, inline fingerprint). Both fingerprints widened; all three frame-construction sites and all four cache-write branches stamped; 12 tests cover the full contract.

## Tasks Completed

| # | Task | Commit | Key changes |
|---|------|--------|-------------|
| 1 | One shared appearance resolver; carry it on both fetched structs and both cache entries | 0702cb7b | `appearanceFromIdentityLine` helper, 4 interface additions, both adapters, legacy path null |
| 2 | Stamp appearance at all three frame sites, all four cache branches, and both fingerprints | ad4d8ff4 | `appearanceFingerprintSegment`, `computeFingerprint` + source-B inline extended, 7 stamp sites, 3 logs |
| 3 | Test the appearance publish/suppress contract at both sources | d29a144c | 12 cases × 2 sources (parameterized), 788 insertions, 0 deletions from existing suite |

## Self-Check Results

### 1. Both sources proven, in one test

**Test name:** `"Case 8 — THE both-sources requirement: in a single tick, a BUSY identity (live PID → source A) AND a DORMANT identity (→ source B) BOTH receive populated identityAppearance"`

The test drives a single sweep with two identities: `alpha` (has a pid line → source A) and `beta` (identity line only → source B). Asserts both published frames have non-null `identityAppearance` with correct `displayName` and `colorHue`.

### 2. Both fingerprints widened

```
grep -n "appearanceFingerprintSegment" src/backend/fleet-status/ssh-poll-orchestrator.ts
```

- **Source A (`computeFingerprint`):** line 1033 — `...${state.stoppedMtime ?? ""}|${appearanceFingerprintSegment(state.identityAppearance ?? null)}`
- **Source B inline fingerprint:** line 2130 — `` `${isDormant ? "1" : "0"}|${isRecycling ? "1" : "0"}|${appearanceFingerprintSegment(fetched.identityAppearance)}` ``

Both verified to be the LAST segment in their respective literals (append-at-END rule obeyed). The preceding segment in source A is `stoppedMtime` (Phase 62); in source B it was `isRecycling` (quick-260823-73o).

### 3. All cache-write branches stamped

All 7 occurrences of `identityAppearance: fetched.identityAppearance`:

| Line | Site | Type |
|------|------|------|
| 2105 | source B pre-evict transition frame | frame |
| 2145 | source B SUPPRESS-branch cache write | cache |
| 2162 | source B PUBLISH-branch cache write | cache |
| 2181 | source B normal frame | frame |
| 2722 | source A frame | frame |
| 2760 | source A PUBLISH-branch cache write | cache |
| 2782 | source A SUPPRESS-branch cache write | cache |

None missed. All 4 cache branches and all 3 frame sites confirmed.

### 4. `subscription-registry.ts` untouched

```
git diff --stat src/backend/fleet-status/subscription-registry.ts
```

→ Empty. Appearance rides `SessionState` through the registry unmodified. `contextPct` re-stamps because its source is an out-of-band store; appearance arrives on the frame already resolved. Re-stamping would require a second server-side appearance store — a second authority (D-09 violation). Not done.

### 5. Versions

- `FRAME_SCHEMA_VERSION = 1 as const` — unchanged
- `SWEEP_SCHEMA_VERSION = 1 as const` — unchanged

Both confirmed by grep. The field is additive-optional; D-04 honored.

### 6. Both builds exit 0

```
npm run build:backend   → exit 0
npx tsc --noEmit -p tsconfig.json  → exit 0 (no new errors)
```

Backend tsc + frontend tsc both clean.

### 7. Load-bearing breakage proofs

**Case 2 source A:** Temporarily removed appearance segment from `computeFingerprint` → `Case 2 (source A)` went RED with "expected 0 to be greater than 0" (tick-2 publish count = 0). Restored.

**Case 2 source B:** Temporarily removed appearance segment from source B's inline fingerprint → `Case 2 (source B)` went RED. Restored.

**Case 7:** Temporarily removed `identityAppearance: fetched.identityAppearance` from the PRE-EVICT frame construction → `Case 7` went RED with "expected null not to be null". Restored.

**Note on Case 5 suppress-branch proofs:** Source A's suppress-branch uses `...livenessMap.get(pid)` spread which naturally carries the field forward (the old cache value), so removing the explicit stamp does not change the cached value. Source B's suppress-branch stores the cache fresh each time but the fingerprint comparison always uses `fetched.identityAppearance` directly (not from cache), so the cache's stored value doesn't affect whether tick-3 publishes. Cases 2 and 3 together provide the effective proof: Case 2 shows fingerprint changes detect appearance changes, Case 3 shows unchanged appearance suppresses.

## Deviations from Plan

### Auto-fixed Issues

None.

### Design Notes

**Source B frame factory not extracted.** The plan explicitly directs: "Do NOT extract a shared frame factory" and "Add a `// Phase 111: two construction sites, no factory — deliberate, see 111-03` comment at both sites." Both source B frame construction sites (lines 2092 and 2170) carry the comment. Follow-up candidate noted below.

**Source A suppress-branch spread behavior.** `livenessMap.set(pid, { ...(livenessMap.get(pid) as PidCacheEntry), ..., identityAppearance: fetched.identityAppearance })` — the spread would have preserved the previous tick's appearance value even without the explicit stamp. The explicit stamp is still correct: it overwrites the spread value with the THIS-TICK derivation rather than the previous-tick cached value. Both are the same when appearance hasn't changed, but the explicit stamp is the correct long-term contract.

## Known Stubs

None. All new fields are live-wired:
- `appearanceFromIdentityLine` calls `resolveIdentityAppearance` which calls the real cascade from Plan 111-02
- Both adapters call the helper on the real sweep line data
- Legacy path explicitly returns null with explanation (not a stub — intentional degradation per D-01)

## Follow-up Candidate

**Source B frame factory extraction.** Both `composeAndPublishPerIdentity` frame construction sites are literal object constructions with no shared factory. Extracting a factory would reduce duplication and eliminate the two-site maintenance burden for future new fields. Deferred here because the blast radius lands in an 8,072-line test file whose own docblock names the existing suite as the batch-vs-legacy parity guarantee. The two-site `// Phase 111: two construction sites, no factory — deliberate, see 111-03` comments mark the duplication as intentional.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond what the plan's `<threat_model>` already covers.

All T-111 mitigations in this plan's threat register verified:
- **T-111-11** (fingerprint not widened → appearance silently suppressed): both fingerprints widened; Cases 2 verified load-bearing at each source by deliberate breakage.
- **T-111-12** (cache branch not stamped → stale comparison): all 4 cache branches stamped; Cases 5 verifies the 3-tick suppress-then-change scenario at both sources.
- **T-111-13** (pre-evict transition frame blanks appearance): line 2105 stamps it; Case 7 verified load-bearing.
- **T-111-14** (cross-host name collision): resolved per `(hostId, identityName)` inside per-host `hostState`; `parseInt` coercion exactly once with finiteness guard.
- **T-111-15** (second appearance authority): `subscription-registry.ts` untouched (git diff empty); `resolveIdentityAppearance` called exactly once (1 call site + 1 import).
- **T-111-16** (unparseable hostId): degrades to plain-but-present frame with warn; Case 11 verifies.
- **T-111-17** (non-deterministic roleDefaults → spurious publish every tick): sorted-key serialization in `appearanceFingerprintSegment`; Case 3 goes flaky if violated.
- **T-111-SC** (npm/pip/cargo installs): zero packages installed.

## Self-Check: PASSED

All modified files confirmed present:
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — modified (3 tasks)
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — modified (788 insertions, 0 deletions)

All commits confirmed:
- `0702cb7b` — Task 1 (shared resolver + interfaces)
- `ad4d8ff4` — Task 2 (frame sites + fingerprints + cache branches)
- `d29a144c` — Task 3 (12-case test suite)
