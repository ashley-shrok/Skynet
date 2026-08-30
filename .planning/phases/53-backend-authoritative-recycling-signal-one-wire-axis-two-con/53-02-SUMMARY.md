---
phase: 53-backend-authoritative-recycling-signal-one-wire-axis-two-con
plan: "02"
subsystem: browser-state
tags: [fleet-status, working-store, recycling, axis-e, hooks, wire-mirror]
dependency_graph:
  requires: []
  provides: [useSessionIsRecycling, SessionState.recycling, WorkingRecord.recycling]
  affects: [session-working-store.ts, fleet-status-types.ts, session-working-store.test.ts]
tech_stack:
  added: []
  patterns: [axis-swap-and-notify, useSyncExternalStore, additive-optional-wire-field]
key_files:
  created: []
  modified:
    - src/ui/api/fleet-status-types.ts
    - src/ui/state/session-working-store.ts
    - src/ui/state/session-working-store.test.ts
decisions:
  - "Axis D (dormant) nextMap.set extended to carry recycling: existingAfterAxes.recycling (cross-axis integrity — the two boolean gates must always travel together)"
  - "Axis E block placed after Axis D, structurally identical, substituting recycling for dormant throughout"
  - "Pitfall-3 defense confirmed: Axis A nextMap.set writes existing?.recycling ?? false so an isWorking flip cannot wipe a recycling:true from a prior frame"
metrics:
  duration_seconds: 176
  completed: "2026-08-21"
  tasks_completed: 2
  files_modified: 3
---

# Phase 53 Plan 02: Browser-side recycling axis (Axis E) + useSessionIsRecycling hook — Summary

Browser half of the backend-authoritative recycling signal: mirrored `recycling?: boolean | null` on `SessionState`, added fifth axis `recycling: boolean` to `WorkingRecord` with direct-swap-and-notify Axis E block, exported `useSessionIsRecycling` hook, closed Phase 52 dormant mirror gap, 7 new tests all green.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Mirror recycling + dormant fields on frontend SessionState | a59d2281 | src/ui/api/fleet-status-types.ts |
| 2 | Add Axis E (recycling) + useSessionIsRecycling + 7 tests | 05ff5e3f | src/ui/state/session-working-store.ts, src/ui/state/session-working-store.test.ts |

## Key Artifacts

### fleet-status-types.ts SessionState interface (final shape)

Lines 88–149 after changes. The two new fields appear after `aiTitle`:

```typescript
export interface SessionState {
  hostId: string;
  tmuxSession: string | null;
  sessionId: string;
  pid: number;
  status: "busy" | "shell" | "idle" | "waiting";
  waitingFor?: string;
  backgroundTasks: BackgroundTask[];
  updatedAt: number;
  lastMessageAt?: number | null;   // Phase 41 Plan 03
  aiTitle?: string | null;          // Phase 47 Plan 01
  dormant?: boolean | null;         // Phase 52 (mirror gap-closure per Phase 53 Plan 02 Task 1)
  recycling?: boolean | null;       // Phase 53 Plan 02 (2026-08-21)
}
```

### WorkingRecord type (extended)

Lines 65–120 in `session-working-store.ts`. Fields in order:

```typescript
type WorkingRecord = {
  isWorking: boolean;
  lastMessageAt: number | null;       // Phase 41 Plan 03
  aiTitle: string | null;             // Phase 47
  dormant: boolean;                   // Phase 52 Plan 01
  recycling: boolean;                 // Phase 53 Plan 02
};
```

### useSessionIsRecycling hook signature

Exported at approximately line 583 in `session-working-store.ts`:

```typescript
export function useSessionIsRecycling(key: string | null): boolean
```

Returns strict boolean:
- `null` key → `false`
- unknown key → `false`
- `record.recycling === false` → `false`
- `record.recycling === true` → `true`

For Plan 53-03 to consume (PrettyView holding overlay + PrettyConversationRow row-spinner).

### Axis E block location

Axis E swap-and-notify block is at approximately lines 298–326 in `session-working-store.ts`, immediately after the Axis D block which ends at line 296. Structure is structurally identical to Axis D with `recycling` substituted for `dormant`.

### Pitfall-3 defense (Axis A preservation) — exact line reference

The Axis A `nextMap.set(key, { ... })` at approximately line 237 in `session-working-store.ts` now includes:

```typescript
recycling: existing?.recycling ?? false,
```

This ensures that when an isWorking flip fires (Axis A), any `recycling:true` value set by a prior frame is NOT wiped. This is the Pitfall-3 defense documented in RESEARCH.md.

### Axis A log record

The `console.info` at the top of Axis A now carries both new fields for observability:

```typescript
recycling: existing?.recycling ?? false,
...
previousRecycling: existing?.recycling ?? false,
```

## Test Coverage

7 new tests P53-02-i…vii added to `session-working-store.test.ts` at end of file, mirroring P52-01-i…vii:

| Test ID | What it verifies |
|---------|-----------------|
| P53-02-i | publish recycling:true → useSessionIsRecycling returns true |
| P53-02-ii | publish recycling:false → returns false |
| P53-02-iii | publish without recycling field (omitted/undefined) → returns false |
| P53-02-iv | re-publish same recycling value → no additional Axis E notify |
| P53-02-v | toggle recycling while isWorking unchanged → Axis E notify fires |
| P53-02-vi | null key → false; unknown key → false |
| P53-02-vii | recycling persists across Axis A (isWorking) republish — Pitfall-3 defense |

Total: 60 tests (53 pre-existing + 7 new), 0 failures.

## Deviations from Plan

### Auto-fixed during implementation

**1. [Rule 2 - Minor cross-axis integrity] Axis D nextMap.set extended to carry recycling field**

- **Found during:** Task 2, implementing Axis D block update
- **Issue:** When WorkingRecord gained the mandatory `recycling: boolean` field, the existing Axis D block's `nextMap.set(key, { isWorking, lastMessageAt, aiTitle, dormant })` would have violated the WorkingRecord type (missing required field). TypeScript would only catch this under strict mode; with strict:false the missing field silently resolves to `undefined` at runtime.
- **Fix:** Extended Axis D's `nextMap.set` to include `recycling: existingAfterAxes.recycling` — preserving the existing cached recycling value across dormant-axis swaps (same principle as Axis A preservation).
- **Files modified:** src/ui/state/session-working-store.ts (Axis D block, ~line 286-292)
- **Commit:** 05ff5e3f

None — plan executed exactly as specified. The Axis D extension is strictly required because `recycling: boolean` is non-optional on the WorkingRecord type; this is the type-system consequence of A1 and counts as the mandatory correctness fix, not a deviation beyond the plan.

## Known Stubs

None. All new fields are fully wired from wire type → WorkingRecord → hook return value. No placeholder values or hardcoded returns.

## Threat Flags

No new trust boundaries introduced beyond those catalogued in the plan's `<threat_model>`. The Axis E block's `state_arg.recycling === true` check treats every non-`true` value (including malformed strings, numbers, undefined, null) as `false` — per T-53-02-01 mitigation.

## Self-Check: PASSED

Files exist:
- FOUND: src/ui/api/fleet-status-types.ts
- FOUND: src/ui/state/session-working-store.ts
- FOUND: src/ui/state/session-working-store.test.ts

Commits exist:
- FOUND: a59d2281 (Task 1)
- FOUND: 05ff5e3f (Task 2)

Test result: 60 passed, 0 failed.
TypeScript: 0 errors.
