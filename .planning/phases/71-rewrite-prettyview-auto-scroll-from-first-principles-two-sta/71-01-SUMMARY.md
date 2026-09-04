---
phase: 70-rewrite-prettyview-auto-scroll-from-first-principles-two-sta
plan: "01"
subsystem: pretty-view/auto-scroll
tags:
  - pure-reducer
  - state-machine
  - auto-scroll
  - phase-71

dependency_graph:
  requires: []
  provides:
    - src/ui/features/pretty-view/auto-scroll-machine.ts (AutoScrollEvent, Mode, AutoScrollEffect, AutoScrollState, BOTTOM_TOLERANCE_PX, BOTTOM_TOLERANCE_TOUCH_EXTRA_PX, createInitialState, reduce)
  affects:
    - src/ui/features/pretty-view/use-auto-scroll.ts (Plan 70-02 will import reduce() from this module)

tech_stack:
  added:
    - auto-scroll-machine.ts: pure TypeScript reducer, zero dependencies, no I/O
  patterns:
    - Phase-30 pure-reducer-extraction pattern (resolve-phase.ts analog)
    - Exhaustiveness sentinel (_exhaust: never) on every discriminated-union switch
    - Type-membership self-check arrays with `as const satisfies` in tests

key_files:
  created:
    - src/ui/features/pretty-view/auto-scroll-machine.ts
    - src/ui/features/pretty-view/auto-scroll-machine.test.ts
  modified: []

decisions:
  - "BOTTOM_TOLERANCE_PX=28: center of shape-file range 24-32px; shape file § Shape para 1 locks this"
  - "BOTTOM_TOLERANCE_TOUCH_EXTRA_PX=32: absorbs iOS touch-momentum overshoot; shape file § Prior context + § Shape para 1 locks this"
  - "mount-landing gate: contentHeight>0 (not distanceFromBottom=0) — waits for content to settle, not for measured position to be exact zero"
  - "measured events in at-bottom+hasLandedOnce=false+contentHeight=0 fall through to normal chase (not reveal) — gate is strictly non-zero height"
  - "three _exhaust: never sentinels: one for event.kind in at-bottom branch, one for event.kind in not-at-bottom branch, one for state.mode outer switch"
  - "reduce() always returns a NEW next object via spread — never returns state unchanged, even when no fields change"

metrics:
  duration_seconds: 587
  completed_date: "2026-09-04"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
---

# Phase 71 Plan 01: Pure auto-scroll-machine.ts reducer — Summary

**One-liner:** Two-state (at-bottom/not-at-bottom) position-derived auto-scroll reducer with LOCKED truth table, zero I/O imports, and 45-test truth-table coverage (pure import+call, no mocks, no DOM, no timers).

## What Was Built

### `src/ui/features/pretty-view/auto-scroll-machine.ts` (387 lines)

The pure reducer that is the core artifact of Phase 71. Implements the LOCKED two-state auto-scroll state machine from `shape-pv-autoscroll-rewrite.md`.

**Exact AutoScrollEvent variant shapes** (for Plan 70-02 wrapper hook):

```typescript
export type AutoScrollEvent =
  | { kind: "measured"; distanceFromBottom: number; contentHeight: number }
  | { kind: "content-changed" }
  | { kind: "container-resized" }
  | { kind: "user-input"; distanceFromBottom: number; isTouch: boolean }
  | { kind: "jump-clicked" }
  | { kind: "send-fired" };
```

**Reducer signature** (for Plan 70-02 wrapper hook):

```typescript
export function reduce(
  state: AutoScrollState,
  event: AutoScrollEvent,
): { next: AutoScrollState; effect: AutoScrollEffect }
```

**AutoScrollState shape** (for Plan 70-02):

```typescript
export type AutoScrollState = {
  mode: Mode;
  hasLandedOnce: boolean;
  lastMeasuredDistance: number;
};
```

**Constants** (for Plan 70-02):

```typescript
export const BOTTOM_TOLERANCE_PX = 28;
export const BOTTOM_TOLERANCE_TOUCH_EXTRA_PX = 32;
```

**All exports**:

- `reduce` — the pure reducer function
- `createInitialState` — factory returning `{ mode: "at-bottom", hasLandedOnce: false, lastMeasuredDistance: 0 }`
- `Mode` — `"at-bottom" | "not-at-bottom"`
- `AutoScrollEvent` — six-variant discriminated union
- `AutoScrollEffect` — `"chase" | "reveal" | "none"`
- `AutoScrollState` — state record type
- `BOTTOM_TOLERANCE_PX` — 28
- `BOTTOM_TOLERANCE_TOUCH_EXTRA_PX` — 32

**Zero I/O imports** — structural-grep gate confirmed (`grep -v '^#' ... | grep -c '^import '` = 0).

### `src/ui/features/pretty-view/auto-scroll-machine.test.ts` (607 lines)

45 tests across 11 describe groups. All pass under `npx vitest run`. Zero mocks, zero DOM, zero timers.

**Groups:**

| Group | Description | Tests |
|-------|-------------|-------|
| 1 | at-bottom + symmetric events → chase | 3 |
| 2 | at-bottom + user-input inside tolerance → none | 2 |
| 3 | at-bottom → not-at-bottom (OUT, only user-input outside tolerance) | 4 |
| 4 | at-bottom contamination guard: non-user-input NEVER triggers OUT | 3 |
| 5 | not-at-bottom + symmetric events → none (LOAD-BEARING no-yank) | 3 |
| 6 | not-at-bottom → at-bottom (IN: jump-clicked, send-fired, user-input inside tolerance) | 3 |
| 7 | send-fired flips at-bottom regardless of prior mode | 2 |
| 8 | Mount-landing (hide-pin-reveal): reveal on first measured(contentHeight>0) | 4 |
| 9 | Chase-write structural impossibility documented | 1 |
| 10 | Full 2×(6+variants) describe.each matrix (16 cells + cardinality) | 17 |
| 11 | Compile-time exhaustiveness sentinel documented | 1 |
| iOS | Touch slack boundary tests | 2 |

## Structural-Grep Gates (All Passing)

| Gate | Expected | Actual | Status |
|------|----------|--------|--------|
| `grep -c '^import '` (no I/O imports) | 0 | 0 | PASS |
| `grep -Ec "document\|window\.\|requestAnimationFrame\|..."` | 0 | 0 | PASS |
| `grep -c '^export function reduce'` | 1 | 1 | PASS |
| `grep -c '_exhaust: never'` | ≥1 | 5 | PASS |
| `grep -c 'export type Mode\b'` | 1 | 1 | PASS |
| `grep -c 'BOTTOM_TOLERANCE_PX'` | ≥2 | 6 | PASS |
| `grep -Ec '"at-bottom"\|"not-at-bottom"'` | ≥4 | 12 | PASS |
| `grep -c 'programmatic-write'` | 0 | 0 | PASS |
| `grep -c '@testing-library'` (test file) | 0 | 0 | PASS |
| `grep -Ec "vi\.fn\|vi\.mock\|..."` (test file) | 0 | 0 | PASS |
| `grep -c "describe\.each\|it\.each"` (test file) | ≥1 | 3 | PASS |
| Vitest test count | ≥20 | 45 | PASS |

## Deviations from Plan

None — plan executed exactly as written.

The one near-deviation: the `<action>` section of Task 1 quoted the shape-file invariant about "never having a `programmatic-write` variant" using that exact string in proposed comment text. The acceptance-criteria grep gate (`grep -c programmatic-write ... returns 0`) required removing those comment references. The comments were rewritten to describe the same invariant without using that specific string. This is a trivial textual adjustment that preserves full semantic intent.

## Known Stubs

None. This plan creates two additive files (pure reducer + tests); no stubs, no placeholder data flows.

## Threat Flags

None. This plan creates a pure function module with zero I/O. No network endpoints, no auth paths, no file access, no schema changes.

## Self-Check: PASSED

- FOUND: `src/ui/features/pretty-view/auto-scroll-machine.ts`
- FOUND: `src/ui/features/pretty-view/auto-scroll-machine.test.ts`
- FOUND: `.planning/phases/70-.../71-01-SUMMARY.md`
- FOUND commit `8f6dbe27` (feat: reducer)
- FOUND commit `104a9820` (test: truth-table tests)
- TypeScript: `npx tsc --noEmit` — zero errors referencing either new file
- Vitest: 45/45 tests passing
