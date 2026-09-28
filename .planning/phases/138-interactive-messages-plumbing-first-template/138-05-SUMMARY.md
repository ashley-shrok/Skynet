---
phase: 137-interactive-messages-plumbing-first-template
plan: "05"
subsystem: frontend
tags:
  - interactive-messages
  - widget-submit
  - render-blacklist
  - invisible-message
  - tdd
dependency_graph:
  requires:
    - 138-04 (ChatMessage onWidgetSubmit prop + WidgetBubble component)
  provides:
    - isWidgetSubmit predicate (PrettyView.tsx module scope)
    - handleWidgetSubmit dispatcher (PrettyView component body)
    - render-blacklist gate extension (handleOptimisticSend ~L1655)
    - ChatMessage.onWidgetSubmit wiring at primary mount site
  affects:
    - PrettyView.tsx (isWidgetSubmit + handleWidgetSubmit + gate + prop threading)
tech_stack:
  added: []
  patterns:
    - TDD RED/GREEN
    - Module-scope predicate (parallel to isIdCommand — Phase 14 no-shared-utils posture)
    - useCallback with sendInput + handleOptimisticSend deps
    - pv-optim-<ms>-<8hex> mqid generation (same pattern as ComposeBox)
key_files:
  created:
    - src/ui/features/pretty-view/PrettyView.widget-submit.test.tsx
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
decisions:
  - "isWidgetSubmit is a separate predicate (not merged with isIdCommand) — different attachment carve-out semantics; widget-submit unconditionally short-circuits, /id has attachment carve-out"
  - "isWidgetSubmit gate placed BEFORE isIdCommand gate (per plan-checker note: separate predicates, additive)"
  - "handleWidgetSubmit uses same pv-optim-<ms>-<8hex> mqid generation as ComposeBox (consistency, no new utility needed)"
  - "handleOptimisticSend signature verified: (args: { payload, mqid, immediateFailure, attachments? }) — single-object arg"
metrics:
  duration_seconds: 1055
  completed_date: "2026-09-27"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 1
---

# Phase 138 Plan 05: Widget Submit Routing Summary

`isWidgetSubmit` predicate + `handleWidgetSubmit` dispatcher + render-blacklist gate extension + `ChatMessage.onWidgetSubmit` prop wiring. One task shipped using TDD (RED/GREEN pattern).

## What Shipped

### isWidgetSubmit predicate

Added module-scope predicate immediately after `isIdCommand` in `PrettyView.tsx`:

```typescript
const isWidgetSubmit = (content: string): boolean =>
  content.trimStart().startsWith("/widget-submit ");
```

Docblocked with Phase 138 D-137 reference, same module-local discipline as `isIdCommand`.

### Render-blacklist gate extension (handleOptimisticSend ~line 1655)

Extended the `handleOptimisticSend` gate with `isWidgetSubmit` as a SEPARATE check BEFORE the existing `isIdCommand` check:

```typescript
if (isWidgetSubmit(payload)) { return; }
if (isIdCommand(payload) && !(attachments && attachments.length > 0)) { return; }
```

- `isWidgetSubmit` short-circuits unconditionally (no attachment carve-out — widget-submit is a synthetic backend signal, never paired with user attachments)
- `isIdCommand` gate is UNCHANGED (still has attachment carve-out)
- Two separate branches, different semantics, not merged

### handleWidgetSubmit dispatcher

Added `useCallback` inside PrettyView component body alongside `handleOpenEditor`:

- Synthesizes payload: `"/widget-submit " + widgetId + " " + value`
- Generates mqid: `pv-optim-${Date.now()}-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}` (same pattern as ComposeBox's Phase 50 D-01/D-18 generation)
- Calls `sendInput(payload, mqid)` — writes WS input frame to wake backend
- Calls `handleOptimisticSend({ payload, mqid, immediateFailure: !ok })` — goes through the gate which short-circuits immediately (no pending bubble)
- Deps: `[sendInput, handleOptimisticSend]`

### handleOptimisticSend signature (verified per plan-checker note MEDIUM-3)

Signature: `(args: { payload: string; mqid: string; immediateFailure: boolean; attachments?: Array<{ filename, size, mimetype }> }) => void`

Single-object argument (not positional). `handleWidgetSubmit` calls it correctly without the `attachments` field (widget-submit is text-only).

### ChatMessage.onWidgetSubmit prop wiring

Added `onWidgetSubmit={handleWidgetSubmit}` to the primary ChatMessage mount site (~line 4316), alongside the existing `onOpenEditor={handleOpenEditor}` wiring:

- Primary ChatMessage mount (confirmed messages): receives `onWidgetSubmit={handleWidgetSubmit}`
- Pending-sends ChatMessage mount (~line 4357): does NOT receive `onWidgetSubmit` (pending bubbles never contain widget URLs — Plan 04 discipline)

## Tests Added

| File | Tests |
|------|-------|
| `PrettyView.widget-submit.test.tsx` (new) | 11 |

Test breakdown:
- Behaviors 1/8: isWidgetSubmit gate suppresses `/widget-submit <id> <value>` bubbles
- Behaviors 2/3/4: negative cases (bare `/widget-submit`, mid-message, normal text)
- Behaviors 5/6/7: handleWidgetSubmit dispatcher via WidgetBubble stub — payload synthesis, WS send frame, gate short-circuit
- Behavior 9a/9b: primary ChatMessage receives `onSubmit` (non-null); pending-sends does NOT render WidgetBubble
- Behavior 10: WS-not-open path — no pending bubble even with `immediateFailure: true`

## TDD Gate Compliance

- RED: `test(138-05-1)` commit `efc05bde` — 7 of 11 tests failing (the 4 testing existing behavior passed)
- GREEN: `feat(138-05-1)` commit `efb9a914` — all 11 tests passing

## Deviations from Plan

None — plan executed exactly as written.

The test file was authored in a single round with two minor self-corrections:
1. WS message `type` field: initially sent `type: "line"` (wrong format) — corrected to `type: "message"` to match PrettyView's actual JSONL parser format. Not a plan deviation — the test itself was wrong, not the implementation.
2. `onSend` prop required for ComposeBox mount — added to `mountPrettyView()`. Not a plan deviation — standard PrettyView test scaffolding requirement.

Both corrections made before the GREEN commit.

## Stub Tracking

No stubs. The implementation is complete: `isWidgetSubmit` + `handleWidgetSubmit` + gate + prop threading are all wired end-to-end. The widget-submit flow from WidgetBubble.onSubmit → ChatMessage.onWidgetSubmit → PrettyView.handleWidgetSubmit → WS input frame is complete.

## Threat Surface Scan

No new network endpoints or auth paths introduced. The implementation is purely a client-side render suppressor + WS funnel reuse. All T-138-05-* threats from the plan's threat register:
- T-138-05-Flood: accepted (rate limiter applies if any; each submit produces zero bubbles)
- T-138-05-Collision: accepted (RESEARCH A3 verified: `/widget-submit` unused elsewhere)
- T-138-05-Bypass: accepted (blacklist is a render suppressor, not a security gate)
- T-138-05-SC: accepted (no new packages)

## Self-Check: PASSED

Files exist:
- `src/ui/features/pretty-view/PrettyView.widget-submit.test.tsx` — created ✓
- `src/ui/features/pretty-view/PrettyView.tsx` — modified (isWidgetSubmit, handleWidgetSubmit, gate, prop wiring) ✓

Commits exist:
- `efc05bde` test(138-05-1): add failing tests for isWidgetSubmit + handleWidgetSubmit + gate extension ✓
- `efb9a914` feat(138-05-1): add isWidgetSubmit + handleWidgetSubmit + extend render-blacklist gate; wire ChatMessage.onWidgetSubmit ✓

Verification counts:
- `grep -c "isWidgetSubmit" PrettyView.tsx` → 4 (≥ 3 ✓)
- `grep -c "handleWidgetSubmit" PrettyView.tsx` → 5 (≥ 3 ✓)
- `grep -c "/widget-submit " PrettyView.tsx` → 4 (≥ 2 ✓)
- `onWidgetSubmit=` appears ONCE (primary mount only, not pending-sends mount ✓)

Tests: 34 test files, 560 passing, 9 skipped, 1 todo — no regressions ✓
Build: `npm run build` passes ✓
