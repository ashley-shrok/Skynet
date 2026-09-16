---
phase: 111-conversation-list-arrives-complete-and-stays-live
plan: "02"
subsystem: fleet-status/wire-contracts
tags: [typescript, identity-appearance, sweep-schema, wire-protocol, fleet-status-types, refactor]
dependency_graph:
  requires:
    - Plan 111-01 (sweep emits role, identity_cosmetics, role_cosmetics, pinned, hidden)
  provides:
    - identity-appearance.ts: single merge authority (resolveIdentityAppearance)
    - SweepIdentityLine widened with five optional appearance fields
    - SessionStateSchema.identityAppearance (additive-optional at FRAME_SCHEMA_VERSION=1)
    - IdentityAppearance browser mirror in fleet-status-types.ts
    - SWEEP_FIELD_PARITY expanded to 23 keys (B6..B9)
    - 34 appearance-parity tests + 5 wire-protocol tests + 1 mid-distribution test
  affects:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts (Plan 111-03 threads appearance)
    - src/ui/api/fleet-status-client.ts (Plan 111-04 reads identityAppearance)
    - src/ui/state/identities-store.ts (Plan 111-04 mergeIdentityAppearance)
tech_stack:
  added: []
  patterns:
    - pure-function module (no express/zod/database imports) as shared authority
    - additive-optional fields at existing schema version (D-04, T-111-06 mitigation)
    - carve-out enforcement via dedicated failing tests (task not inherited, displayName not from role)
    - mid-distribution parse safety: ?:-optional fields, bare cast in parseSweepJsonl
    - four-part block comment template in wire-protocol.ts (lineage + semantics + source + invariant)
key_files:
  created:
    - src/backend/fleet-status/identity-appearance.ts
    - src/backend/fleet-status/identity-appearance.test.ts
  modified:
    - src/backend/database/routes/identities.ts
    - src/backend/fleet-status/sweep-schema.ts
    - src/backend/fleet-status/sweep-schema.test.ts
    - src/backend/fleet-status/wire-protocol.ts
    - src/backend/fleet-status/wire-protocol.test.ts
    - src/ui/api/fleet-status-types.ts
decisions:
  - Zod v4 requires z.record(z.string(), z.unknown()) not z.record(z.unknown()) — auto-fixed
  - B6 parity comment notes that `role` field arrives from the same read as identity_cosmetics
  - SWEEP_FIELD_PARITY entry type uses only `field` and `skipped_reason` properties (no extra fields)
metrics:
  duration: "~55 minutes"
  completed: "2026-09-16"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 6
---

# Phase 111 Plan 02: Single merge authority + widened contracts Summary

Identity-over-role cosmetics merge extracted from `publicIdentity()` into a shared `resolveIdentityAppearance` authority in `fleet-status/identity-appearance.ts`; `SweepIdentityLine` widened with five optional appearance fields; `SessionStateSchema` gains `identityAppearance`; browser mirror updated; all additive-optional at existing schema versions 1 and 1.

## Tasks Completed

| # | Task | Commit | Key changes |
|---|------|--------|-------------|
| 1 | Extract identity-over-role merge into single authority | 4c226379 | `identity-appearance.ts` created, `identities.ts` delegates via `resolveIdentityAppearance`, cascade in exactly 1 place |
| 2 | Add appearance parity tests pinning the two carve-outs | 42ae330c | 34 `it` blocks, both carve-outs verified by deliberate breakage |
| 3 | Widen SweepIdentityLine, SessionStateSchema, and browser mirror | a880b1b0 | 5 files, SWEEP_FIELD_PARITY 19→23, mid-distribution test, IdentityAppearanceSchema + browser mirror |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Zod v4 z.record() requires two arguments**
- **Found during:** Task 3 tsc check
- **Issue:** `z.record(z.unknown())` is Zod v3 API; Zod v4 (installed: ^4.4.3) requires `z.record(z.string(), z.unknown())`; tsc reported TS2554 (Expected 2-3 arguments, but got 1)
- **Fix:** Changed to `z.record(z.string(), z.unknown())` in `IdentityAppearanceSchema`
- **Files modified:** `src/backend/fleet-status/wire-protocol.ts`
- **Commit:** a880b1b0

## Self-Check Results

### 1. identities.get-disk.test.ts — unmodified and green

`git diff --stat src/backend/database/routes/identities.get-disk.test.ts` → empty (no changes)
`npx vitest related --run src/backend/database/routes/identities.get-disk.test.ts` → 31/31 pass

The refactor changed no observable behaviour: `publicIdentity()` delegates to `resolveIdentityAppearance` and spreads the result into the same return shape.

### 2. subscription-registry.ts — untouched

`git diff --stat src/backend/fleet-status/subscription-registry.ts` → empty (no changes)

`contextPct` re-stamps because its source is an out-of-band store. Appearance arrives ON the frame already resolved — re-stamping it would require a second server-side appearance store (second authority, D-09 violation). Default was no registry change, and that default was honoured.

### 3. Both schema version constants held at 1

`grep -c "SWEEP_SCHEMA_VERSION = 1 as const" src/backend/fleet-status/sweep-schema.ts` → 1
`grep -c "FRAME_SCHEMA_VERSION = 1 as const" src/backend/fleet-status/wire-protocol.ts` → 1

Neither version was bumped. New fields are additive-optional (D-04).

### 4. Cascade in exactly ONE place

```
grep -rn "roleCosmetics?.title" src/backend/
src/backend/fleet-status/identity-appearance.ts:146:      : typeof roleCosmetics?.title === "string"
```

Count: 1. The cascade was removed from `identities.ts` and lives only in `identity-appearance.ts`. `publicIdentity()` references `resolveIdentityAppearance` 3 times (import + import + call site).

### 5. Carve-out test names

- **task carve-out test:** `describe("task carve-out: NOT inherited from role (D-05 write-once at birth)")` — contains: `it("identity has no task, role has task → result task is null (not inherited)")`
- **displayName carve-out test:** `describe("displayName carve-out: falls back to capitalizeFirstIdentityKey, NOT role displayName")` — contains: `it("identity has no displayName, role has displayName → result is capitalized key (not role)")`

Both carve-outs were verified by temporary deliberate breakage:
- Adding role fall-through to `task` → red: `AssertionError: expected 'role task description' to be null`
- Adding role fall-through to `displayName` → red: `AssertionError: expected 'Role Name' to be 'Pixel'`

### 6. Both builds exit 0

`./node_modules/.bin/tsc -p tsconfig.node.json` → exit 0 (backend build; only pre-existing `nova-sonic-adapter` AWS SDK error unrelated to this plan)
`./node_modules/.bin/tsc --noEmit -p tsconfig.json` → exit 0 (frontend typecheck)

## Known Stubs

None. All new fields are fully wired:
- `identity-appearance.ts` exports `resolveIdentityAppearance` which is called by `publicIdentity()` in `identities.ts`
- `SweepIdentityLine`'s new optional fields are declared and will be populated by the Plan 111-01 sweep
- `SessionStateSchema.identityAppearance` is wired via `IdentityAppearanceSchema`; Plan 111-03 threads it through the orchestrator
- `fleet-status-types.ts` mirror is in lockstep with the backend schema

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond what the plan's `<threat_model>` already covers.

All T-111 mitigations implemented in this plan:
- **T-111-06** (version bump as side effect): both constants verified to be 1; existing `SWEEP_SCHEMA_VERSION === 1` test and equality-mismatch lock stay green.
- **T-111-07** (type-mirror drift): `IdentityAppearance` interface added to `fleet-status-types.ts` with "MUST stay in lockstep" sentence; `grep -c "identityAppearance" src/ui/api/fleet-status-types.ts` → 3 (interface + SessionState member + comment).
- **T-111-08** (second cascade): cascade exists in exactly 1 place (identity-appearance.ts); Task 2's carve-out tests fail on drift.

## Self-Check: PASSED

All created/modified files confirmed present:
- `src/backend/fleet-status/identity-appearance.ts` — created
- `src/backend/fleet-status/identity-appearance.test.ts` — created
- `src/backend/database/routes/identities.ts` — modified (imports + delegation)
- `src/backend/fleet-status/sweep-schema.ts` — modified (SweepRawCosmetics + 5 fields + B6..B9)
- `src/backend/fleet-status/sweep-schema.test.ts` — modified (EXPECTED_KEYS 19→23 + identityFields + mid-distribution test)
- `src/backend/fleet-status/wire-protocol.ts` — modified (IdentityAppearanceSchema + block comment + lineage + identityAppearance field)
- `src/backend/fleet-status/wire-protocol.test.ts` — modified (5 Phase 111 tests)
- `src/ui/api/fleet-status-types.ts` — modified (IdentityAppearance interface + identityAppearance field)

All commits confirmed:
- `4c226379` — Task 1 (merge authority)
- `42ae330c` — Task 2 (parity tests)
- `a880b1b0` — Task 3 (schema widening)
