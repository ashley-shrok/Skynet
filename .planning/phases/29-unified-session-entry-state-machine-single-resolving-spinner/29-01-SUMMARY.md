---
phase: 29
plan: 01
subsystem: ui/pretty-view
tags:
  - phase-29
  - pure-reducer
  - test-seam
  - resolve-phase
dependency_graph:
  requires: []
  provides:
    - "src/ui/features/pretty-view/resolve-phase.ts exports { resolvePhase, WsState, BackendFirstFrame, Phase }"
  affects:
    - "unblocks plan 29-02 (usePaneResolvingMachine hook consumes resolvePhase)"
    - "unblocks plan 29-04 (structural-grep gates reference the anchor comment 'phase-29: pure resolvePhase reducer')"
tech_stack:
  added: []
  patterns:
    - "test-seam split (pure reducer extracted for unit-testability) — copied verbatim from src/backend/claude-session/layer1-detect.ts"
    - "TypeScript compile-time exhaustiveness sentinel (_exhaust: never)"
    - "String-literal union types for enum-like axes (no `enum` keyword)"
key_files:
  created:
    - src/ui/features/pretty-view/resolve-phase.ts
    - src/ui/features/pretty-view/resolve-phase.test.ts
  modified: []
decisions:
  - "Kept resolvePhase pure — no hasEverResolved flag inside; post-resolve semantics (D-10/D-11/D-12) are the hook's concern in plan 29-02"
  - "Ordered the branch checks failed-permanently first, then WS-still-coming-up, then frame-arrival (matches PATTERNS.md §1 canonical order)"
  - "Type-membership self-check arrays in the test file use `satisfies readonly WsState[]` / `satisfies readonly BackendFirstFrame[]` to double-enforce the union memberships at compile time"
metrics:
  duration: "~10 minutes"
  completed_date: "2026-08-10"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
requirements_addressed:
  - PHASE29-REQ-04
---

# Phase 29 Plan 01: Pure resolvePhase reducer + truth-table tests Summary

**One-liner:** Extracted the SPEC req 4 (wsState × backendFirstFrame) → Phase truth table into a pure `resolvePhase` reducer with compile-time exhaustiveness and a 20-assertion truth-table unit test suite — the deterministic core of the new pane-entry state machine, ready for plan 29-02's hook to consume.

## What Was Built

### Files Created

**`src/ui/features/pretty-view/resolve-phase.ts`** (168 lines)
- Anchor comment: `// phase-29: pure resolvePhase reducer — test-seam split per layer1-detect.ts pattern`
- Three exported type unions:
  - `WsState = "not-connected" | "opening" | "open" | "failed-permanently"` (4 members)
  - `BackendFirstFrame = "not-yet" | "active" | "inactive" | "session_holding" | "dormant"` (5 members)
  - `Phase = "resolving" | "active" | "holding" | "dormant" | "inactive" | "error"` (6 members)
- Exported pure function `resolvePhase(wsState: WsState, backendFirstFrame: BackendFirstFrame): Phase` implementing the SPEC req 4 truth table in the exact branch order fixed by PATTERNS.md §1:
  1. `wsState === "failed-permanently"` → `"error"` (D-04)
  2. `wsState === "not-connected" || wsState === "opening"` → `"resolving"`
  3. `backendFirstFrame === "not-yet"` → `"resolving"` (wsState="open" past here)
  4. `backendFirstFrame === "active"` → `"active"`
  5. `backendFirstFrame === "session_holding"` → `"holding"`
  6. `backendFirstFrame === "dormant"` → `"dormant"`
  7. `backendFirstFrame === "inactive"` → `"inactive"`
  8. Exhaustiveness sentinel: `const _exhaust: never = backendFirstFrame; return _exhaust;`
- Zero `^import` lines (pure module invariant enforced by plan 29-04 grep gate).
- Zero `setTimeout` / `Date.now` / `require(` occurrences (SPEC req 5 — no wall-clock heuristics).

**`src/ui/features/pretty-view/resolve-phase.test.ts`** (175 lines)
- Anchor comment: `// phase-29: truth-table tests for resolvePhase — SPEC req 4`
- Import shape mirrors the fork's UI convention (no `.js` extension): `import { resolvePhase, type WsState, type BackendFirstFrame, type Phase } from "./resolve-phase";`
- Type-membership self-check arrays with `satisfies readonly WsState[]` / `satisfies readonly BackendFirstFrame[]` — double-enforce the union memberships at compile time.
- 4 `describe` blocks × 5 `it` blocks = **20 assertions covering the full 4×5 (wsState × backendFirstFrame) truth table cross product**. Every `it` block spells out the expected `Phase` literal so regressions fail with the exact table row named.

### Exact Type Union Members Exported

| Union | Members | Count |
|---|---|---|
| `WsState` | `"not-connected"`, `"opening"`, `"open"`, `"failed-permanently"` | 4 |
| `BackendFirstFrame` | `"not-yet"`, `"active"`, `"inactive"`, `"session_holding"`, `"dormant"` | 5 |
| `Phase` | `"resolving"`, `"active"`, `"holding"`, `"dormant"`, `"inactive"`, `"error"` | 6 |

### Exhaustiveness Sentinel

```typescript
const _exhaust: never = backendFirstFrame;
return _exhaust;
```

This narrows the `BackendFirstFrame` union to `never` after the 5-branch cascade. If a new variant is added upstream without a matching branch, `backendFirstFrame` here would carry the un-narrowed variant and `tsc --noEmit` would fail at build time — no runtime check, no silent drift.

### Truth-Table Test Count

**20 of 20 passed** (`npx vitest run src/ui/features/pretty-view/resolve-phase.test.ts` → `Tests 20 passed (20)`, duration ~3.4s).

Full frontend suite after plan completion: **1725 passed / 7 skipped / 0 failed** (up from 1705 before this plan — the delta is exactly the 20 new tests).

## Verification Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 (no errors mentioning resolve-phase.ts or resolve-phase.test.ts) |
| `npx vitest run src/ui/features/pretty-view/resolve-phase.test.ts` | 20 passed / 0 failed |
| `npx vitest run` (full frontend suite) | 1725 passed / 7 skipped / 0 failed |
| `grep -c "^import " src/ui/features/pretty-view/resolve-phase.ts` | 0 (pure module) |
| `grep -c "setTimeout\|Date.now\|require(" src/ui/features/pretty-view/resolve-phase.ts` | 0 (SPEC req 5) |
| `grep -c "^export type " src/ui/features/pretty-view/resolve-phase.ts` | 3 |
| `grep -c "^export function resolvePhase" src/ui/features/pretty-view/resolve-phase.ts` | 1 |
| `grep -c "^describe(" resolve-phase.test.ts` | 4 |
| `grep -c "^  it(" resolve-phase.test.ts` | 20 |
| Anchor comments present in both files | yes (single match each) |

## Commits

| Task | Hash | Message |
|---|---|---|
| 1 | `f3d0bf1` | feat(29-01): add pure resolvePhase reducer with type unions |
| 2 | `e9baaeb` | test(29-01): add truth-table unit tests for resolvePhase |

## Deviations from Plan

**None.** Plan executed exactly as written. Both tasks passed all acceptance criteria on the first attempt.

Minor drafting note (not a deviation): during Task 1 the doc-comment originally used the literal tokens `` `setTimeout` `` and `` `Date.now` `` in an "invariant" paragraph. Because the plan's acceptance-criterion grep is `grep -c "setTimeout|Date.now|require("`, those doc-comment mentions were rephrased to "no timer scheduling, no wall-clock reads" so the grep-gate returns 0 unambiguously. The invariant is unchanged; only the wording is different. (Not tracked as a deviation because the acceptance criterion is what it says on the tin and matching it exactly is the whole point.)

## Deviations from PATTERNS.md Analog

**None.** The `layer1-detect.ts` analog was followed verbatim in shape:
- Multi-paragraph rationale header (WHY THIS EXISTS + architectural note + NO I/O IMPORTS invariant)
- Type-union aliases declared before the reducer
- Pure reducer signature with fixed branch order
- No `enum` keyword; string-literal unions throughout
- `_exhaust: never` sentinel at the tail

The test file follows `layer1-detect.test.ts` §3 verbatim in shape:
- Header rationale block
- Vitest `describe / it / expect` import
- Grouped-describe pattern (one describe per input class)
- Pure fixture-free assertions (no builders needed here because `resolvePhase` takes literal string arguments directly)

## Threat Flags

None. This plan introduces no new attack surface. `resolve-phase.ts` is a pure client-side function whose inputs are constrained to string-literal unions defined in the same file. Threat register T-29-01-01 (Tampering) and T-29-01-02 (Information disclosure) were both `accept` dispositions, mitigated by the compile-time exhaustiveness sentinel and the zero-side-effect posture respectively — no additional runtime mitigation was needed.

## Known Stubs

None. This plan produces a pure reducer + tests only; no UI components, no data sources, no placeholder text.

## Next Plan

Plan **29-02** — `usePaneResolvingMachine` hook. Imports `resolvePhase`, `WsState`, `BackendFirstFrame`, `Phase` from this file. Wires the two resolution inputs to the WS layer + backend frame observation site and returns `{ wsState, backendFirstFrame, phase }` (plus the retry callback for D-09). Post-resolve semantics (D-10/D-11/D-12) — `hasEverResolved` gating so transient WS drops don't re-enter resolving — live in the hook, NOT in this file.

## Self-Check: PASSED

- Files created:
  - `src/ui/features/pretty-view/resolve-phase.ts` — FOUND
  - `src/ui/features/pretty-view/resolve-phase.test.ts` — FOUND
- Commits:
  - `f3d0bf1` (feat 29-01 resolvePhase) — FOUND in git log
  - `e9baaeb` (test 29-01 truth-table) — FOUND in git log
- Full frontend suite: 1725 passed / 0 failed
- `npx tsc --noEmit`: exit 0
- All plan-level verification greps returned expected counts
