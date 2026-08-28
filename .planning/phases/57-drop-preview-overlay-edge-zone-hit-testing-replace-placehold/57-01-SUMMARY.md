---
phase: 57-drop-preview-overlay-edge-zone-hit-testing-replace-placehold
plan: 01
subsystem: pretty-view / split-tree
tags: [split-tree, edge-zone, drop-preview, phase-57, pure-function, tdd]
requires:
  - "src/ui/lib/split-tree.ts (Phase 56 Plan 01 tree types: DropEdge, SplitNode, insertAtEdge)"
  - "src/ui/shell/SplitView.tsx (Phase 56 Plan 03 sister function computeNearestEdge, signature reference)"
  - "~/.claude/roles/box-maintainer/bounties/bring-back-split-view/prototype.html (reference implementation, pickZone at :361-370)"
provides:
  - "src/ui/lib/split-tree.ts exports `DropZone` type alias (= DropEdge | 'center')"
  - "src/ui/lib/split-tree.ts exports `computeEdgeZone(rect, clientX, clientY): DropZone` pure function"
  - "13 new unit tests in src/ui/lib/split-tree.test.ts covering: 4 edge-midpoints, 4 corner-ties, dead center, both sides of the 0.28 threshold, non-square rect, off-origin rect, defensive out-of-rect cursor, Phase 56 regression guard"
affects:
  - "src/ui/lib/split-tree.ts (pure additions — 97 lines; existing exports untouched)"
  - "src/ui/lib/split-tree.test.ts (pure additions — 129 lines; existing tests untouched)"
tech_stack:
  added: []
  patterns:
    - "Pure-function port of the Ashley-validated reference prototype (verbatim math + verbatim tie-break priority)"
    - "TDD RED→GREEN: failing tests committed first (eb7e01f9), implementation second (399c9f55)"
    - "Module-local locked-constant (EDGE_ZONE_THRESHOLD deliberately not exported)"
key_files:
  created: []
  modified:
    - "src/ui/lib/split-tree.ts (+97 lines: DropZone type, EDGE_ZONE_THRESHOLD, computeEdgeZone)"
    - "src/ui/lib/split-tree.test.ts (+129 lines: 13 new tests in a new describe block)"
decisions:
  - "EDGE_ZONE_THRESHOLD = 0.28 (verbatim from prototype.html:362) — locked design decision, not exported"
  - "Tie-break priority top → bottom → left → right (verbatim from prototype.html:366-369) — deterministic corner-tie resolution"
  - "DropZone widens DropEdge instead of adding a fifth value to DropEdge — keeps Phase 56 consumers (insertAtEdge etc.) type-narrow; center is a Pane-level short-circuit, never flows to tree ops"
  - "computeEdgeZone lives in split-tree.ts (per plan spec), not in SplitView.tsx alongside computeNearestEdge — geometry helpers belong in the pure-function module"
  - "Signature deliberately mirrors computeNearestEdge exactly — drop-in interchangeable at the Pane callsite"
metrics:
  duration_iso: "PT8M"
  tasks_completed: 1
  files_modified: 2
  files_created: 0
  tests_added: 13
  tests_total: 67
  commits: 2
  completed_date: "2026-08-28"
requirements_completed:
  - PV57-EDGE-ZONE-GEOMETRY
  - PV57-CENTER-DEAD-ZONE
  - PV57-SNAP-TO-NEAREST-EDGE
---

# Phase 57 Plan 01: Edge-zone hit-testing geometry Summary

**One-liner:** Pure-function `computeEdgeZone(rect, x, y): DropZone` + `DropZone` type alias landed in `src/ui/lib/split-tree.ts`, ported verbatim from the Ashley-validated prototype (EDGE_ZONE_THRESHOLD=0.28, tie-break top → bottom → left → right), with 13 unit tests + zero Phase 56 regressions.

## What shipped

Phase 57's foundation. Plan 57-02's `Pane` component rewire can now import a tested, deterministic zone-picker for both the dragover-time overlay update and the drop-time center-dead-zone short-circuit. Zero UI changes, zero React imports, zero behaviour change on its own.

Two commits, TDD gate compliance:

| Commit    | Kind | Files                                 | Notes                                                                 |
| --------- | ---- | ------------------------------------- | --------------------------------------------------------------------- |
| `eb7e01f9` | test | `src/ui/lib/split-tree.test.ts` (+129) | RED — 12 new tests fail with `TypeError: computeEdgeZone is not a function`. Test 13 (regression guard) uses an already-shipped symbol so passes. |
| `399c9f55` | feat | `src/ui/lib/split-tree.ts` (+97)      | GREEN — `DropZone` alias + `computeEdgeZone` pure function + `EDGE_ZONE_THRESHOLD` const. All 13 new tests pass; 20 Phase 56 tests still pass. |

No REFACTOR commit — the implementation is a verbatim port of the reference prototype; further "cleanup" would risk drifting from the Ashley-validated math.

## Behaviour spec — verbatim port confirmation

Ported from `~/.claude/roles/box-maintainer/bounties/bring-back-split-view/prototype.html:361-370`:

```js
function pickZone(zx, zy) {
  const EDGE = 0.28;
  const distTop = zy, distBottom = 1 - zy, distLeft = zx, distRight = 1 - zx;
  const minDist = Math.min(distTop, distBottom, distLeft, distRight);
  if (minDist > EDGE) return 'center';
  if (minDist === distTop) return 'top';
  if (minDist === distBottom) return 'bottom';
  if (minDist === distLeft) return 'left';
  return 'right';
}
```

TS port at `src/ui/lib/split-tree.ts`:

```ts
export function computeEdgeZone(
  rect: DOMRect | { left: number; right: number; top: number; bottom: number },
  clientX: number,
  clientY: number,
): DropZone {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  const zx = (clientX - rect.left) / width;
  const zy = (clientY - rect.top) / height;
  const distTop = zy;
  const distBottom = 1 - zy;
  const distLeft = zx;
  const distRight = 1 - zx;
  const minDist = Math.min(distTop, distBottom, distLeft, distRight);
  if (minDist > EDGE_ZONE_THRESHOLD) return "center";
  if (minDist === distTop) return "top";
  if (minDist === distBottom) return "bottom";
  if (minDist === distLeft) return "left";
  return "right";
}
```

Confirmations required by `<output>`:

- **EDGE_ZONE_THRESHOLD = 0.28.** Matches prototype `EDGE = 0.28` at :362 verbatim. Grep evidence: `grep -c 'EDGE_ZONE_THRESHOLD.*=.*0.28' src/ui/lib/split-tree.ts` → **1**.
- **Tie-break priority `top → bottom → left → right`.** Matches prototype if-chain at :366-369 verbatim. Encoded as the four `if (minDist === distX) return "X"` statements in order.
- **`computeNearestEdge` unchanged.** Phase 56 shipped it in `src/ui/shell/SplitView.tsx:44-69`. This plan modified neither `SplitView.tsx` nor its tests. Grep evidence: `grep -c '^export function computeNearestEdge(' src/ui/shell/SplitView.tsx` → **1** (unchanged from Phase 56).
- **`DropEdge` unchanged.** Grep evidence: `grep -c '^export type DropEdge = "left" | "right" | "top" | "bottom"' src/ui/lib/split-tree.ts` → **1** (unchanged from Phase 56 Plan 01).
- **`DropZone` does not leak into Phase 56 consumer signatures.** `insertAtEdge` still takes `edge: DropEdge`. Grep evidence: `grep -c 'edge: DropEdge' src/ui/lib/split-tree.ts` → **2** (matches Phase 56 baseline: one on `insertAtEdge`, one on `buildSplitForEdge`).

## Acceptance criteria — all satisfied

| # | Criterion | Grep / verify command | Result |
|---|-----------|----------------------|--------|
| 1 | DropZone exports as `DropEdge \| "center"` | `grep -c '^export type DropZone = DropEdge \| "center"' src/ui/lib/split-tree.ts` | 1 ✓ |
| 2 | `computeEdgeZone` exports | `grep -c '^export function computeEdgeZone(' src/ui/lib/split-tree.ts` | 1 ✓ |
| 3 | `EDGE_ZONE_THRESHOLD = 0.28` present | `grep -c 'EDGE_ZONE_THRESHOLD.*=.*0.28' src/ui/lib/split-tree.ts` | 1 ✓ |
| 4 | `computeNearestEdge` unchanged (Phase 56 home) | `grep -c '^export function computeNearestEdge(' src/ui/shell/SplitView.tsx` | 1 ✓ |
| 5 | No React/DOM/backend imports in split-tree.ts | `grep -cE '^import.*(react\|React\|window\|document\|ssh2)' src/ui/lib/split-tree.ts` | 0 ✓ |
| 6 | `DropEdge` NOT widened | `grep -c '^export type DropEdge = "left" \| "right" \| "top" \| "bottom"' src/ui/lib/split-tree.ts` | 1 ✓ |
| 7 | `insertAtEdge` still accepts `DropEdge` | `grep -c 'edge: DropEdge' src/ui/lib/split-tree.ts` | 2 ✓ (≥1 required) |
| 8 | New describe block in test file | `grep -c '^describe("split-tree — Phase 57: edge-zone hit-testing"' src/ui/lib/split-tree.test.ts` | 1 ✓ |
| 9 | 14+ `computeEdgeZone` refs in test file | `grep -c 'computeEdgeZone' src/ui/lib/split-tree.test.ts` | 17 ✓ (import + 13 test bodies + 3 comment refs) |
| 10 | Split-tree tests green (Phase 56 + Phase 57) | `npx vitest run src/ui/lib/split-tree.test.ts` | **33/33 pass** ✓ (20 Phase 56 baseline + 13 Phase 57 new) |
| 11 | Scoped consumer sweep green | `npx vitest run split-tree.test.ts split-tree-url.test.ts SplitView.test.tsx AppShell.split-tree.test.tsx` | **67/67 pass** ✓ |
| 12 | TypeScript clean | `npx tsc --noEmit \| grep -c "error TS"` | **0** ✓ |

## Concrete test-run output

Scoped consumer sweep evidence (fleet-rule replacement for `--related` which isn't supported in vitest 4.1.8):

```
 RUN  v4.1.8 /home/ubuntu/skynet-tanya

 Test Files  4 passed (4)
      Tests  67 passed (67)
   Start at  18:41:59
   Duration  31.62s
```

Split-tree suite alone (proof of Phase 56 regression-cleanliness + Phase 57 additions):

```
 Test Files  1 passed (1)
      Tests  33 passed (33)
   Duration  4.91s
```

## Test coverage matrix (Tests 1-13)

| Test | Case                                                | Cursor                | Rect      | Expected  |
| ---- | --------------------------------------------------- | --------------------- | --------- | --------- |
| 1    | dead center                                         | (50, 50)              | 100×100 @0 | 'center' |
| 2    | left edge midpoint                                  | (5, 50)               | 100×100 @0 | 'left'   |
| 3    | right edge midpoint                                 | (95, 50)              | 100×100 @0 | 'right'  |
| 4    | top edge midpoint                                   | (50, 5)               | 100×100 @0 | 'top'    |
| 5    | bottom edge midpoint                                | (50, 95)              | 100×100 @0 | 'bottom' |
| 6    | just outside threshold (distLeft=0.30 > 0.28)       | (30, 50)              | 100×100 @0 | 'center' |
| 7    | exactly at threshold (distLeft=0.28, strict >)      | (28, 50)              | 100×100 @0 | 'left'   |
| 8    | corner tie top-left → tie-break priority picks top  | (14, 14)              | 100×100 @0 | 'top'    |
| 9    | corner tie bottom-right → tie-break picks bottom    | (86, 86)              | 100×100 @0 | 'bottom' |
| 10   | non-square rect (200×100), per-axis normalization   | (150, 50)             | 200×100 @0 | 'right'  |
| 11   | off-origin rect (left=100), rect.left subtracted    | (110, 50)             | 100×100 @100 | 'left' |
| 12   | defensive: cursor outside rect (x=-10), no throw    | (-10, 50)             | 100×100 @0 | 'left'   |
| 13   | regression guard: computeNearestEdge still callable | n/a                   | n/a       | function + 'left' |

## Deviations from Plan

### [Rule 1 — Fix] Test 13 imports `computeNearestEdge` from its real home, not from `./split-tree`

- **Found during:** Task 1 read-first pass
- **Issue:** PLAN.md `<behavior>` for Test 13 and the `read_first` block say `computeNearestEdge` lives in `src/ui/lib/split-tree.ts:44-69` and should be imported from `./split-tree`. This is factually wrong — Phase 56 Plan 03 shipped `computeNearestEdge` in `src/ui/shell/SplitView.tsx:44-69`, and split-tree.ts contains only data-model helpers (SplitNode types, findLeaf, getNodeAt, insertAtEdge, removeLeaf, collectTabIds). Following the plan literally (`import { computeNearestEdge } from "./split-tree"`) would produce a TypeScript error and the test would never run.
- **Fix:** Added `import { computeNearestEdge } from "@/shell/SplitView";` at the top of `split-tree.test.ts` (Phase 56's actual export path — used by `AppShell.tsx:79` too), with an inline comment citing this SUMMARY entry. The regression-guard intent ("assert Phase 56's function is untouched") is preserved perfectly — Test 13 still asserts `typeof computeNearestEdge === 'function'` and one smoke assertion `computeNearestEdge(rect, 10, 50) === 'left'`.
- **Files modified:** `src/ui/lib/split-tree.test.ts` (import statement + inline deviation comment)
- **Commit:** eb7e01f9 (RED gate) — the deviation is baked into the RED commit, not a follow-up patch.
- **Impact assessment:** Zero. The regression guard is stronger, not weaker — importing from the actual home means any future rename/move of `computeNearestEdge` breaks this test immediately, catching the very regression the guard exists to prevent.

### [Rule 3 — Blocker workaround] `--related` flag not supported in vitest 4.1.8

- **Found during:** Verification
- **Issue:** Both PLAN.md and orchestrator success criteria specify `npx vitest run --related src/ui/lib/split-tree.ts` as the scoped-test gate. Vitest 4.1.8 (the pinned version in this repo) does not implement `--related` — it errors with `CACError: Unknown option 'related'`.
- **Fix:** Substituted per fleet-rule guidance ("targeted paths only") — ran `npx vitest run` with the four explicit consumer paths I found via `grep -rln 'from "@/lib/split-tree"' src/`: `split-tree.test.ts`, `split-tree-url.test.ts`, `SplitView.test.tsx`, `AppShell.split-tree.test.tsx`. 67/67 pass. This is a stronger check than `--related` in practice because it deterministically covers every downstream test file rather than relying on vitest's import-graph heuristic.
- **Files modified:** none
- **Commit:** n/a (verification-only)
- **Impact assessment:** Zero on functionality. Flagged for the phase orchestrator so `--related` isn't relied on in Plan 57-02's verification.

### No architectural deviations (Rule 4)

Nothing surfaced that required a checkpoint. Plan was internally consistent aside from the two factual issues above (both resolved without changing scope, contract, or behaviour).

## Self-Check

**Files verified to exist:**

```
[ -f /home/ubuntu/skynet-tanya/src/ui/lib/split-tree.ts ] && echo FOUND
[ -f /home/ubuntu/skynet-tanya/src/ui/lib/split-tree.test.ts ] && echo FOUND
[ -f /home/ubuntu/skynet-tanya/.planning/phases/57-drop-preview-overlay-edge-zone-hit-testing-replace-placehold/57-01-SUMMARY.md ] && echo FOUND
```

All three FOUND.

**Commits verified to exist:**

- `eb7e01f9` — test(57-01): add failing tests for computeEdgeZone — FOUND (`git log --oneline | grep eb7e01f9`)
- `399c9f55` — feat(57-01): implement computeEdgeZone + DropZone in split-tree.ts — FOUND (`git log --oneline | grep 399c9f55`)

## Self-Check: PASSED

## Known Stubs

None. `computeEdgeZone` is a fully-wired pure function; every code path returns a defined `DropZone` value; no TODOs, no FIXMEs, no placeholder returns, no empty-array-that-flows-to-UI patterns.

## Threat Flags

None. Per the plan's `<threat_model>`, this is a pure-function UI geometry helper with no auth surface, no network surface, and no user-input parsing surface. Cursor coordinates come from the browser's `DragEvent`; rect coordinates come from the browser's `getBoundingClientRect()`. Nothing crosses a trust boundary.

## TDD Gate Compliance

- **RED gate:** `test(57-01)` commit `eb7e01f9` — 12 tests fail with `TypeError: computeEdgeZone is not a function` before implementation. ✓
- **GREEN gate:** `feat(57-01)` commit `399c9f55` — all 33 tests pass. ✓
- **REFACTOR gate:** Not needed. Implementation is a verbatim port of the Ashley-validated prototype math — any "cleanup" would risk drifting from validated behaviour. ✓ (documented rationale)

## Fleet-rule compliance

- ✓ No worktrees (`workflow.use_worktrees=false` honored; ran directly on `feat/tab-title-from-tmux`).
- ✓ No `git push`, no `docker build`, no `docker compose up`, no touches under `/opt/skynet/`.
- ✓ Scoped tests only — file-scoped + targeted-path sweep. Did NOT run full-suite `npx vitest run`.
- ✓ Normal `git commit` (hooks skipped only because husky hooks aren't executable on this box — git's own warning surfaced; not bypassed via `--no-verify`).
- ✓ SUMMARY.md written before any narration, immediately followed by commit.

## Next steps (Plan 57-02 preview — for orchestrator context, not this plan's scope)

Plan 57-02 will consume `computeEdgeZone` in `src/ui/shell/SplitView.tsx`'s `Pane` component:
- Replace `isDragOver: boolean` state with `dropPreview: { zone: DropZone; rect: DOMRect } | null` (or similar).
- Call `computeEdgeZone(rect, e.clientX, e.clientY)` on every `dragover`.
- Render coral overlay at half-pane dimensions along the picked edge (or hide overlay entirely when zone === 'center').
- On drop: if zone === 'center', short-circuit — do NOT call `onOpenSessionInTree` / `onDropRowInTree`. Otherwise call with the picked edge (which is guaranteed to be a `DropEdge` value, not 'center').
