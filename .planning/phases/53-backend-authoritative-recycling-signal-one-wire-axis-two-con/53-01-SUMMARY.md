---
phase: 53-backend-authoritative-recycling-signal-one-wire-axis-two-con
plan: "01"
subsystem: fleet-status/wire-protocol + ssh-poll-orchestrator
tags:
  - fleet-status
  - wire-protocol
  - ssh-poll-orchestrator
  - recycling
  - backend
dependency_graph:
  requires:
    - "Phase 52 Plan 01 (dormant stat + PidCacheEntry.dormant pattern)"
    - "Phase 44 Plan 02 (discoverIdentityJsonlPathViaChannel + shellSingleQuote)"
    - "Phase 41 Plan 03 (additive-optional wire extension T-41-03-05 pattern)"
  provides:
    - "SessionState.recycling wire field (optional boolean | null)"
    - "PidCacheEntry.recycling cached field"
    - ".recycled-at stat in processPid pipeline (source A)"
    - "computeFingerprint recycling axis"
  affects:
    - "Plan 53-02 (browser store axis reads SessionState.recycling from wire)"
    - "Plan 53-03 (consumer swaps read the store axis)"
tech_stack:
  added: []
  patterns:
    - "Additive-optional zod schema extension (T-41-03-05 pattern — FRAME_SCHEMA_VERSION held at 1)"
    - "Source A stat + shellSingleQuote shell-injection mitigation (T-52-01-02 clone)"
    - "Fail-open cached value on SSH hiccup (T-52-01-01 clone for .recycled-at)"
    - "Tri-valued fingerprint segment ('1'/'0'/'') for boolean-with-undefined axis"
key_files:
  created: []
  modified:
    - src/backend/fleet-status/wire-protocol.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
    - src/backend/fleet-status/wire-protocol.test.ts
decisions:
  - "Recycling is source-A-only (no source B enumeration) — the caretaker holds the .recycled-at sentinel while the outgoing PID is still alive and for 8s after fresh PID is up, guaranteeing 2s poll cadence sees it multiple times (RESEARCH § Assumption A1)"
  - "FRAME_SCHEMA_VERSION held at 1 per T-41-03-05 additive-optional convention"
  - "Recycling scope is EXCLUSIVELY the /id-reset routine — NOT memory-cap restarts, dormancy-wake, or other harness-down states"
  - "shellSingleQuote applied to tmuxSession before interpolation into stat command (T-53-01-02 mitigation, clone of T-52-01-02)"
metrics:
  duration: "~15 minutes"
  completed: "2026-08-21"
  tasks_completed: 2
  files_modified: 4
---

# Phase 53 Plan 01: Backend-Authoritative Recycling Signal — Wire Field + Source A Stat Summary

**One-liner:** Added `recycling?: boolean | null` to SessionState wire schema and per-PID `.recycled-at` sentinel stat in the ssh-poll orchestrator pipeline, with fingerprint axis and PidCacheEntry cache, mirroring the Phase 52 dormant pattern exactly.

## What Was Built

### Task 1: SessionStateSchema.recycling field (wire-protocol.ts)

**Lines touched:** Lines 127–175 (new block comment block 128–190, schema field at line ~193 after dormant)

**Exact new field position:**
```typescript
// Phase 52 Plan 01 — inline supervisor-dormancy signal (see block comment above).
dormant: z.boolean().nullable().optional(),
// Phase 53 Plan 01 — inline backend-authoritative recycling signal (see block comment above).
recycling: z.boolean().nullable().optional(),   // ← NEW (immediately after dormant)
```

**Block comment location:** Inserted between the Phase 52 block comment ending and `export const SessionStateSchema = z.object({`. Documents caretaker source, scope-lock (reset-routine only), source-A-only rationale, and additive-optional invariant.

**FRAME_SCHEMA_VERSION:** Unchanged at `1 as const` (line 14). Additive-optional extension per T-41-03-05.

**Tests added (wire-protocol.test.ts):** 6 new tests — P53-01 A (true), B (false), C (null), D (omit back-compat), E (string rejection), F (version-guard). All 27 wire-protocol tests pass (21 pre-existing + 6 new).

### Task 2: .recycled-at stat + fingerprint + cache (ssh-poll-orchestrator.ts)

**PidCacheEntry extension (lines 161–187 approx):**
```typescript
dormant: boolean;
// Phase 53 Plan 01 — cached derived boolean result of the source A recycling
// sentinel stat (`stat ~/.claude/identities/'<tmuxSession>'/.recycled-at
// 2>/dev/null >/dev/null && echo yes || echo no`). [...]
recycling: boolean;
```

**Source A stat block (inserted after dormant stat block, before Phase 44 JSONL discovery block):**
```typescript
let derivedRecycling: boolean = cached?.recycling ?? false;
if (tmuxSession !== null) {
  const quotedTmuxSession = shellSingleQuote(tmuxSession);
  const recyclingRaw = await channel.exec(
    `stat ~/.claude/identities/${quotedTmuxSession}/.recycled-at 2>/dev/null >/dev/null && echo yes || echo no`,
  );
  if (recyclingRaw !== null) {
    const trimmed = recyclingRaw.trim();
    if (trimmed === "yes") { derivedRecycling = true; }
    else if (trimmed === "no") { derivedRecycling = false; }
    // Anything else → fail-open, keep cached value (T-53-01-01 mitigation).
  }
  // recyclingRaw === null → SSH hiccup → keep cached value (fail-open).
}
```

**computeFingerprint return literal (sample with concrete state values):**
```
"idle||task1:done|1755000000000|1755000000000|Working on auth|0|0"
 ^     ^  ^                    ^             ^               ^  ^
 status  bgKey             lastMessageAt  aiTitle         dormant recycling
```

Full literal:
```typescript
return `${state.status}|${state.waitingFor ?? ""}|${bgKey}|${state.updatedAt}|${state.lastMessageAt ?? ""}|${state.aiTitle ?? ""}|${state.dormant === true ? "1" : state.dormant === false ? "0" : ""}|${state.recycling === true ? "1" : state.recycling === false ? "0" : ""}`;
```

**SessionState compose:** `recycling: derivedRecycling` stamped immediately after `dormant: derivedDormant`.

**Both livenessMap.set sites:** Both the fresh-fingerprint publish branch and the same-fingerprint update branch carry `recycling: derivedRecycling`.

**No source B added:** `grep -c "pollRecyclingOnlyIdentities\|recyclingOnlyIdentities"` returns 0. Recycling is source-A-only per RESEARCH § Assumption A1 and CONTEXT § Recycling scope.

**Tests added (ssh-poll-orchestrator.test.ts):** 5 new test cases in a new `describe("Phase 53 Plan 01 — source A recycling stat + fingerprint")` block:
- T1-i: stat "yes\n" → recycling:true
- T1-ii: stat "no\n" → recycling:false
- T1-iii: stat null (SSH hiccup) → fail-open cached false
- T1-iv: same recycling across ticks → fingerprint-suppressed (no second publish)
- T1-v: recycling flips false→true → fingerprint delta detected → second publish

## Deviations from Plan

None — plan executed exactly as written. All five orchestrator changes (A1-A5) implemented verbatim per the plan's action spec. The Phase 52 dormant pattern was cloned exactly.

## Known Stubs

None — recycling field is fully wired end-to-end in the backend (stat → cache → SessionState → fingerprint → wire). Browser side (Plan 53-02) runs in parallel and reads from the wire field. Consumer swap (Plan 53-03) is deferred per the phase design.

## Threat Flags

No new surfaces beyond what the plan's `<threat_model>` documents. T-53-01-01 (stdout parsing), T-53-01-02 (shell-quoting), T-53-01-03 (wire disclosure), T-53-01-04 (extra SSH exec) — all documented, all mitigated per plan spec.

## Test Green Confirmation

```
Test Files  2 passed (2)
     Tests  83 passed (83)    [wire-protocol: 27, ssh-poll-orchestrator: 56]

Full fleet-status suite:
Test Files  10 passed (10)
     Tests  177 passed (177)

TypeScript: npx tsc --noEmit → 0 errors
Backend build: npm run build:backend → exit 0
```

Existing Phase 52 tests (P52-01-T2-i..v dormant stat, P52-01-T3-i..vii source B) all remain green. No Phase 52 test was modified.

## Self-Check: PASSED

- `src/backend/fleet-status/wire-protocol.ts` — exists, contains `recycling: z.boolean().nullable().optional()` ✓
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — exists, contains `.recycled-at` (4 occurrences) ✓
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — exists, contains `P53-01-T1-` (10 references for 5 tests) ✓
- Commit `6a2204ec` (RED wire-protocol tests) ✓
- Commit `8cc3db56` (GREEN wire-protocol impl) ✓
- Commit `ae645edd` (RED orchestrator tests) ✓
- Commit `afa11685` (GREEN orchestrator impl) ✓
