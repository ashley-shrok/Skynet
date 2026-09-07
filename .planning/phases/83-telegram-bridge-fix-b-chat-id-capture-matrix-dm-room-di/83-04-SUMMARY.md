---
phase: 83-telegram-bridge-fix-b
plan: 04
subsystem: telegram-bridge
tags:
  - registry-writer
  - bridge-config-writer
  - getSharedDMRoom
  - matrix-dm-room-discovery
  - MX-to-TG-routing
requires:
  - 83-02 # getSharedDMRoom export in matrix-admin-client
provides:
  - buildRegistryFromRows-with-room-map
  - rewriteRegistryFromCurrentState-populates-humans-room
affects:
  - "src/backend/telegram/registry-writer.ts"
  - "src/backend/telegram/registry-writer.test.ts"
  - "src/backend/telegram/bridge-config-writer.ts"
  - "src/backend/telegram/bridge-config-writer.test.ts"
tech-stack:
  added: []
  patterns:
    - "Optional-4th-arg for backward-compatible signature extension"
    - "Per-pair Promise.all with defensive try/catch (belt-and-suspenders — getSharedDMRoom itself never throws per its Plan 83-02 contract, but caller wraps anyway per CONTEXT § 4)"
    - "Tab-character key (`\\t`) as pair separator — never valid inside a Matrix mxid domain grammar, so collision-free"
key-files:
  created: []
  modified:
    - "src/backend/telegram/registry-writer.ts"
    - "src/backend/telegram/registry-writer.test.ts"
    - "src/backend/telegram/bridge-config-writer.ts"
    - "src/backend/telegram/bridge-config-writer.test.ts"
decisions:
  - "Optional 4th param (not required) — pre-existing callers + tests unchanged"
  - "Tab as pair-key separator — mxid grammar excludes control chars"
  - "Per-pair Promise.all rather than sequential — parallelism gives up to 2× speedup on typical Ashley-fleet size (1-3 pairs) with zero downside; getSharedDMRoom already has 30s AbortController from Plan 83-02"
  - "No caching (CONTEXT § 4 explicit) — rewrites fire on activate/disconnect/reconcile, never per-message"
  - "Per-pair failure collapses to null in map — bridge falls back to not routing MX→TG for that pair until next reconcile"
metrics:
  duration_minutes: 8
  tasks_completed: 2
  files_modified: 4
  files_created: 0
  tests_added: 7 # 3 registry-writer (RW-M2/M3/M4) + 4 bridge-config-writer (BCW-M1/M2/M3/M4)
  test_count_before: 19 # 5 registry-writer + 14 bridge-config-writer (est. pre-existing count minus new)
  test_count_after: 26 # 9 registry-writer + 17 bridge-config-writer
  completed_date: "2026-09-07"
commits:
  - 96142f8d # test(83-04): registry-writer roomByAgentHumanMxidPair (RED)
  - 782280e7 # feat(83-04): registry-writer supports room-lookup map (GREEN)
  - 6135e0b5 # test(83-04): bridge-config-writer getSharedDMRoom pair map (RED)
  - 15a01516 # feat(83-04): bridge-config-writer thread getSharedDMRoom results (GREEN)
---

# Phase 83 Plan 04: buildRegistryFromRows + bridge-config-writer thread getSharedDMRoom Summary

**One-liner:** `humans[].room` in `registry.json` is now populated from Plan 83-02's `getSharedDMRoom` via a per-pair lookup Map that `rewriteRegistryFromCurrentState` builds and threads into an extended-signature `buildRegistryFromRows`.

## What Shipped

### Task 1 — `buildRegistryFromRows` accepts optional `roomByAgentHumanMxidPair` map

**Function signature after the change:**

```typescript
export function buildRegistryFromRows(
  rows: Array<{
    identityKey: string;
    botUsername: string;
    humanUserId: string;
    telegramChatId: string | null;
  }>,
  humansByUserId: Map<string, { name: string; mxid: string }>,
  agentsByIdentityKey: Map<string, { name: string; mxid: string }>,
  roomByAgentHumanMxidPair?: Map<string, string | null>,
): RegistryFile
```

- Fourth parameter is **optional** — pre-Plan-80 callers (including the tests
  at `registry-writer.test.ts:33-155`) call with 3 args and get `room: null`
  for every human, unchanged behavior.
- When provided, the humans-emit path becomes:
  ```typescript
  room:
    roomByAgentHumanMxidPair?.get(`${agentMeta.mxid}\t${human.mxid}`) ??
    null,
  ```
  `?.get(...) ?? null` collapses absent map / missing key / explicit `undefined` /
  explicit `null` all to `null`. Explicit non-null `string` values pass through.
- L28 comment `// Phase B always null — room-mgmt out of scope.` was replaced
  by the new behavior comment; stale docstring superseded by the new bullet
  in the JSDoc block.

### Task 2 — `rewriteRegistryFromCurrentState` computes pairs, calls `getSharedDMRoom`, threads map

Inserted a new **Step 6.5** between the mint loop (Step 6, ends at the prior
L267) and the `buildRegistryFromRows` call (Step 7):

1. Iterate `rows`, resolve each `identityKey → agent` and `humanUserId → human`.
   Skip rows whose lookups fail (matches the same defensive skip in the mint
   loop and in `buildRegistryFromRows` itself).
2. Collect resolved `[agentMxid, humanMxid]` pairs into `Array<[string, string]>`.
3. `await Promise.all(pairs.map(async ([a, h]) => …))` — per-pair `try/catch`
   collapses any throw to `null` for that pair. Structured warn logged with
   `operation: "bridge_registry_room_lookup_failed"` + agent + human + error.
4. Aggregate into `Map<string, string | null>` keyed by `` `${agentMxid}\t${humanMxid}` ``.
5. Pass the map as the 4th arg to `buildRegistryFromRows`.

### Why tab as the separator

Chosen because a Matrix mxid is `@localpart:server_name`, where `server_name`
follows the DNS grammar (RFC 1035 letters+digits+hyphen+dot) and `localpart`
excludes ASCII control characters per Matrix client-server spec. Tab (`\t`,
`	`) is **provably never** present inside either half — zero collision
risk, plain-string key, no encoding/escaping overhead. Considered but rejected:
`|` (valid in localparts historically), `:` (already the mxid inner separator
— visual ambiguity in logs), tuple/object keys (Map identity semantics break
across Promise boundaries).

### Why per-pair `Promise.all` (not sequential)

Ashley's fleet is small (typical: 1–3 (agent, human) pairs at any moment), so
sequential vs. parallel is an insignificant absolute speedup — but parallel is
still preferable because:

1. **Boot-critical path** — `ensureBridgeConfigWritten` is fire-and-forget at
   startup, but the registry-rewrite still gates when the bridge sees updated
   rooms. Faster is straightforwardly better.
2. **Per-pair 30s AbortController** — Plan 83-02 already installs a 30s timeout
   on each `getSharedDMRoom` internal fetch. Parallel Promise.all means the
   worst-case rewrite latency is `~30s` (one pair timing out), not
   `pairs.length × 30s` (all sequential timeouts).
3. **Zero downside** — the Synapse admin API can handle 2-3 concurrent
   `/joined_rooms` calls; no thundering-herd concern at this fleet size.
4. **Per-pair `.catch`** — one pair's failure never poisons the Promise.all;
   other pairs' resolutions land in the map unaffected.

### Observed test-count delta

| File | Before | After | Delta |
|------|--------|-------|-------|
| `registry-writer.test.ts` | 6 | 9 | +3 (RW-M2, RW-M3, RW-M4) |
| `bridge-config-writer.test.ts` | 13 | 17 | +4 (BCW-M1, BCW-M2, BCW-M3, BCW-M4) |
| **Total** | **19** | **26** | **+7** |

All 26 tests green after the GREEN commits. RW-M4 (explicit-null passthrough)
was accidentally green in the RED phase because the pre-existing hardcoded
`room: null` matched the expectation — the RED bar was raised by RW-M2 (map
fully populated → non-null room) and RW-M3 (partial map → mixed populated/null).

## Verification

- `npx vitest run src/backend/telegram/registry-writer.test.ts src/backend/telegram/bridge-config-writer.test.ts` → **2 files, 26 tests, all pass** (exit 0).
- `npx tsc --noEmit -p tsconfig.json` → **exit 0**, no errors.
- `grep -c 'room: null,' src/backend/telegram/registry-writer.ts` → **0** (hardcoded null literal gone; replaced with the map-lookup expression).
- `grep -c 'roomByAgentHumanMxidPair' src/backend/telegram/registry-writer.ts` → **3** (signature + docstring bullet + call site). Plan predicted 2; the extra occurrence is the docstring bullet the plan itself instructed to add — expected drift, not a deviation.
- `grep -c 'getSharedDMRoom' src/backend/telegram/bridge-config-writer.ts` → **3** (import + comment reference + call site). Plan predicted 2; the extra occurrence is the descriptive comment inside the Step 6.5 header block ("Phase 83 Plan 04 — getSharedDMRoom returns …") — informative documentation, not a functional drift.
- `grep -c 'bridge_registry_room_lookup_failed' src/backend/telegram/bridge-config-writer.ts` → **1** (single log-operation string).
- `grep -c 'buildRegistryFromRows(' src/backend/telegram/bridge-config-writer.ts` → **1** (single call site).

## Commits (this plan only)

| Order | Hash | Type | Message |
|-------|------|------|---------|
| 1 | `96142f8d` | test | test(83-04): registry-writer roomByAgentHumanMxidPair |
| 2 | `782280e7` | feat | feat(83-04): registry-writer supports room-lookup map |
| 3 | `6135e0b5` | test | test(83-04): bridge-config-writer getSharedDMRoom pair map |
| 4 | `15a01516` | feat | feat(83-04): bridge-config-writer thread getSharedDMRoom results |

TDD gate compliance: RED → GREEN sequence verified for both tasks (`test(83-04)` followed by `feat(83-04)`).

## Deviations from Plan

None — plan executed exactly as written. Two minor grep-count over-shoots vs. plan predictions (both explained above under Verification) were **required by the plan's own instructions** (docstring bullet, header comment) and are not scope drift.

## Known Stubs

None.

## Threat Flags

None. No new attack surface introduced beyond what the plan's `<threat_model>` already dispositioned:

- T-83-04-01 (map-key tampering) — tab-separator invariant holds; mxid grammar excludes tab.
- T-83-04-02 (room_id in log) — accepted; room IDs are not secrets in the Skynet threat model.
- T-83-04-03 (getSharedDMRoom slow → boot delay) — mitigated by 30s per-pair AbortController (from Plan 83-02) + Promise.all parallelism + starter.ts fire-and-forget.
- T-83-04-04 (getSharedDMRoom throws propagates) — mitigated by per-pair `.catch` + outer `rewriteRegistryFromCurrentState` try/catch barrier.

## Self-Check: PASSED

- FOUND: `src/backend/telegram/registry-writer.ts` (modified — signature extended, comment + docstring updated, map lookup at emit)
- FOUND: `src/backend/telegram/registry-writer.test.ts` (modified — +126 lines, 3 new tests)
- FOUND: `src/backend/telegram/bridge-config-writer.ts` (modified — +45 lines: import + Step 6.5 block + 4th arg thread)
- FOUND: `src/backend/telegram/bridge-config-writer.test.ts` (modified — +377 lines: new mock + 4 new tests)
- FOUND commit `96142f8d` in git log
- FOUND commit `782280e7` in git log
- FOUND commit `6135e0b5` in git log
- FOUND commit `15a01516` in git log
