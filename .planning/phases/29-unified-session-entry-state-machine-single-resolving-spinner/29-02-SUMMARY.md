---
phase: 29-unified-session-entry-state-machine-single-resolving-spinner
plan: 02
subsystem: pretty-view-overlays
tags:
  - phase-29
  - error-overlay
  - warm-red-variant
  - terminal-state
requires: []
provides:
  - "PrettyViewErrorOverlay component — warm-red terminal-state overlay for phase === 'error'"
  - "PrettyViewErrorOverlayProps interface — { onRetry: () => void }"
affects:
  - "Plan 29-04 (PrettyView rewire) can import and mount at {phase === 'error' && <PrettyViewErrorOverlay onRetry={handleRetry} />}"
tech-stack:
  added: []
  patterns:
    - "Warm-red glass-card variant copied verbatim from SessionHoldingOverlay error=true branch (D-07 non-negotiable)"
    - "Wake-button UX shape copied verbatim from DormancyOverlay (shadcn Button size=sm variant=secondary) for the D-09 Retry action"
    - "iOS Safari backdrop-filter hardening tokens (isolate, [transform:translateZ(0)], [-webkit-backdrop-filter:blur(12px)]) — patch #333 lesson"
    - "Motion-channel guardrail: STATIC RefreshCcw — patch #72 lineage + D-07"
    - "ARIA role='alert' (NOT 'status') — terminal urgent failure semantics distinct from in-progress sibling overlays"
key-files:
  created:
    - "src/ui/features/pretty-view/PrettyViewErrorOverlay.tsx"
    - "src/ui/features/pretty-view/PrettyViewErrorOverlay.test.tsx"
  modified: []
decisions:
  - "role='alert' chosen over role='status' — terminal urgent failure requires ARIA-correct assertion; distinct from SessionHoldingOverlay / DormancyOverlay / PrettyViewLoadingOverlay all of which carry role='status' for in-progress states"
  - "flex-col container (mirroring DormancyOverlay.tsx:127) chosen over SessionHoldingOverlay's single-row flex because the card has TWO children: glyph+copy row AND Retry button"
  - "Header-comment prose reworded to say 'the spin-animation class' rather than the literal token, so a source-file grep for the exact class name returns zero — satisfies the plan's <verification> block requirement while preserving human-readable rationale"
metrics:
  duration_minutes: 12
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  completed_date: "2026-08-10"
---

# Phase 29 Plan 02: PrettyViewErrorOverlay Summary

**One-liner:** Warm-red terminal-state overlay for `phase === "error"` — mechanical composition of SessionHoldingOverlay's error-variant geometry and DormancyOverlay's Wake-button UX shape, with static RefreshCcw glyph, iOS Safari backdrop-filter hardening, and a Retry button that fires the `onRetry` prop.

## What Shipped

Two new files added — component + test suite. Zero modifications to existing files. Purely additive; safe to land alongside Plan 29-01 (both are Wave 1 with disjoint file scope).

### `src/ui/features/pretty-view/PrettyViewErrorOverlay.tsx` (164 lines)

Presentational component with a single callback prop:

```typescript
export interface PrettyViewErrorOverlayProps {
  onRetry: () => void;
}
export function PrettyViewErrorOverlay({ onRetry }: PrettyViewErrorOverlayProps): JSX.Element
```

**Structure** (composite of two existing overlay patterns per PATTERNS.md § 5):

- **Outer scrim** — `role="alert"`, `aria-label="Connection failed"`, full-surface `absolute inset-0 z-[99]` with backdrop-blur + iOS Safari hardening tokens verbatim from SessionHoldingOverlay's scrim (patch #333 lesson).
- **Inner warm-red card** — `flex-col items-center gap-3 text-sm` (mirroring DormancyOverlay.tsx:127; NOT SessionHoldingOverlay's single-row), with the warm-red gradient `bg-[linear-gradient(160deg,rgba(85,30,35,0.55),rgba(55,20,25,0.6))]`, warm-red text `text-[#f5d0d4]`, warm-red inset glow shadow — all verbatim from SessionHoldingOverlay patch #122 error=true branch (D-07 non-negotiable). Contains two children:
  1. Inner glyph+copy row: `<RefreshCcw className="h-4 w-4 shrink-0 text-[hsl(0,72%,60%)]" aria-hidden="true" />` + `<span>Connection failed — retry</span>`. Em-dash is U+2014, matching sibling overlays' copy style.
  2. Retry button: shadcn `<Button size="sm" variant="secondary" className="cursor-pointer" onClick={onRetry} aria-label="Retry connection">Retry</Button>` — verbatim shape from DormancyOverlay.tsx:175-187 Wake button (D-09).

**Invariants enforced by the source file:**

- Zero `setTimeout` — no wall-clock deadline, no self-dismissing effect. Pure prop-driven presentational component. SPEC req 5 lineage.
- Zero `animate-spin` token in the source file (grep returns 0). Motion-channel guardrail per D-07 + patch #72 — this overlay is STATE not WORK; motion channel across pretty-view is owned by WipBubble + PrettyViewLoadingOverlay.
- Exactly one `role="alert"` occurrence (the JSX attribute). Header comment prose reworded to reference "the alert role" rather than the literal token so source-file grep returns exactly 1.

### `src/ui/features/pretty-view/PrettyViewErrorOverlay.test.tsx` (128 lines)

Four `describe` blocks, five `it` blocks:

1. `PrettyViewErrorOverlay — render`
   - Test 1: renders "Connection failed — retry" copy + enabled Retry button (D-08 + D-09 shape).
   - Test 2: renders with `role="alert"` (NOT `role="status"`) — ARIA-correct terminal-error semantic.
2. `PrettyViewErrorOverlay — Retry button click`
   - Test 3: Retry click invokes `onRetry` exactly once (D-09 contract, mirrors DormancyOverlay Wake test).
3. `PrettyViewErrorOverlay — motion-channel guardrail (static RefreshCcw)`
   - Test 4: RefreshCcw svg does NOT carry the spin-animation class. Regression guard — inverts PrettyViewLoadingOverlay's positive assertion; mirrors SessionHoldingOverlay A3 + DormancyOverlay Test 7 negative assertions. Patch #72 lineage.
4. `PrettyViewErrorOverlay — iOS Safari backdrop-filter hardening (patch #333)`
   - Test 5: scrim className carries all three load-bearing tokens (`isolate`, `[transform:translateZ(0)]`, `[-webkit-backdrop-filter:blur(12px)]`). Non-negotiable per patch #333 — Ashley uses this fork primarily on her iPhone PWA.

**Test count: 5/5 passed. Zero skipped, zero failed.**

## Verification Results

| Gate                                                                            | Result                              |
| ------------------------------------------------------------------------------- | ----------------------------------- |
| `npx vitest run src/ui/features/pretty-view/PrettyViewErrorOverlay.test.tsx`    | 5/5 passed                          |
| `npx vitest run` (full frontend suite)                                          | 137 files, 1730 passed, 7 skipped   |
| `npx tsc --noEmit`                                                              | clean (exit 0)                      |
| `grep -c "animate-spin" PrettyViewErrorOverlay.tsx`                             | 0                                   |
| `grep -c "setTimeout" PrettyViewErrorOverlay.tsx`                               | 0                                   |
| `grep -c 'role="alert"' PrettyViewErrorOverlay.tsx`                             | 1                                   |
| Anchor comment `phase-29: PrettyViewErrorOverlay — terminal UI for phase === "error"` | present                       |
| Anchor comment `phase-29: PrettyViewErrorOverlay component tests`               | present                             |
| Motion-channel guardrail comment mentions STATIC + `animate-spin` in "do NOT" phrasing | present (rephrased to avoid literal `animate-spin` token per grep gate) |
| iOS hardening tokens `isolate`, `[transform:translateZ(0)]`, `[-webkit-backdrop-filter:blur(12px)]` all present in source | present |
| Warm-red D-07 tokens (`bg-[linear-gradient(...)]` + `text-[#f5d0d4]`) present   | present                             |
| Exactly 1 `export function PrettyViewErrorOverlay(`                             | 1                                   |
| Exactly 1 `export interface PrettyViewErrorOverlayProps`                        | 1                                   |

## Copy Shipped

**"Connection failed — retry"** — D-08 default. Em-dash is U+2014. Final copy remains open to UAT tweak with Ashley, per D-08 note.

## Deviations from Plan

**None mechanical.** Two nuance-level deviations documented for traceability:

1. **[Rule 2 — Grep-gate reconciliation]** The plan's `<verification>` block requires `grep -c "animate-spin" src/ui/features/pretty-view/PrettyViewErrorOverlay.tsx` to return 0, while the `<acceptance_criteria>` requires "an explicit motion-channel guardrail comment mentioning 'STATIC' and 'animate-spin' (in a 'do NOT' phrasing)". These are literally in tension — a comment that spells out the exact class name would satisfy the acceptance-criteria wording but fail the grep gate. Resolution: the header comment says "do NOT add `the spin-animation class`" (paraphrase), preserving the human-readable rationale + guardrail intent while keeping the grep gate at zero. The test file's Test 4 comment applies the same paraphrase for the same reason.

2. **[Rule 2 — role="alert" grep-gate reconciliation]** The plan's `<verification>` block requires `grep -c 'role="alert"'` to return exactly 1 (the JSX attribute). The header-comment SEMANTICS block originally referenced the literal `role="alert"` string twice (in the "NOT status" contrast), which would have pushed the count to 3. Reworded the header comment to say "the alert role" (paraphrase) so the grep gate lands exactly on the JSX attribute. Semantics + rationale preserved.

Both are Rule 2 mechanical reconciliations of literally-contradictory acceptance criteria; the plan's intent (guardrail comment present + grep gates pass) is honored by both.

## Composite Analog Fidelity

| Source overlay        | What was copied                                                | Faithfulness    |
| --------------------- | -------------------------------------------------------------- | --------------- |
| SessionHoldingOverlay error=true branch | Scrim classes; warm-red gradient; warm-red text; warm-red inset-glow shadow; glass-card padding/radius/blur; RefreshCcw glyph choice + `text-[hsl(0,72%,60%)]` tint | verbatim (dropped ternaries) |
| DormancyOverlay       | `flex-col items-center gap-3 text-sm` container; inner `<div className="flex items-center gap-3">` glyph+copy row; shadcn Button props (size=sm variant=secondary className=cursor-pointer aria-label onClick label text) | verbatim (swapped labels: Moon→RefreshCcw, "Wake identity"→"Retry connection", onWake→onRetry, "Wake"→"Retry") |
| PrettyViewLoadingOverlay | iOS Safari hardening class-list (isolate + [transform:translateZ(0)] + [-webkit-backdrop-filter:blur(12px)]) | verbatim         |

## Wire-Up Contract for Plan 29-04

Plan 29-04 (PrettyView rewire) imports and mounts this component at the pane's overlay-mount site:

```tsx
{phase === "error" && <PrettyViewErrorOverlay onRetry={handleRetry} />}
```

Where `handleRetry` is Plan 29-04's user-gesture WS reconnect entry-point (D-09 — the retry re-enters the resolving phase via a synthetic entry-trigger edge and the WS reconnect happens underneath, or the button surfaces a "manual retry" event from the WS layer; Plan 29-04's call).

## Commits

| Task | Type | Commit  | Description                                             |
| ---- | ---- | ------- | ------------------------------------------------------- |
| 1    | feat | c22b2e4 | add PrettyViewErrorOverlay terminal-state component     |
| 2    | test | 74ca23c | add PrettyViewErrorOverlay component tests              |

## Self-Check: PASSED

- File `src/ui/features/pretty-view/PrettyViewErrorOverlay.tsx` — FOUND
- File `src/ui/features/pretty-view/PrettyViewErrorOverlay.test.tsx` — FOUND
- Commit c22b2e4 — FOUND in git log
- Commit 74ca23c — FOUND in git log
- Full frontend vitest suite: 137 files, 1730 passed, 7 skipped, 0 failed — PASS
- `npx tsc --noEmit` exit 0 — PASS
- All eleven acceptance-criteria grep gates for Task 1 — PASS (11/11)
- All eight acceptance-criteria checks for Task 2 (anchor comment + describe count + it count + vitest exit code + all-tests-passed + static-glyph regression + iOS hardening test present + iOS hardening test asserts all three tokens) — PASS (8/8)
