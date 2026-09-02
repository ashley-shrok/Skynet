---
phase: 68-compose-send-funnel
plan: "01"
subsystem: pretty-view/compose
tags: [refactor, hook, send-funnel, optimistic-bubbles, phase-68]
dependency_graph:
  requires: []
  provides: [useComposeSend hook, main-textarea-funnel-path, send-funnel-test-scaffold]
  affects: [ComposeBox.tsx, ComposeBox.send-funnel.test.tsx]
tech_stack:
  added: []
  patterns: [co-located React hook, useCallback deps array, mqid threading]
key_files:
  created:
    - src/ui/features/pretty-view/ComposeBox.send-funnel.test.tsx
  modified:
    - src/ui/features/pretty-view/ComposeBox.tsx
decisions:
  - "Hook co-located above export function ComposeBox per D-01 — no new module"
  - "bubbleTextOverride flows only to onOptimisticSend, not to onSend (D-02)"
  - "mqid always generated regardless of caller intent (D-03)"
  - "sendWsFrame and countConfirmedBubbles included in scaffold for Plan 68-03 extension"
metrics:
  duration: ~10 min
  completed: "2026-09-02"
  tasks_completed: 2
  files_modified: 1
  files_created: 1
---

# Phase 68 Plan 01: Extract useComposeSend hook + main-textarea baseline lock Summary

Co-located `useComposeSend` hook extracted from `handleSend`'s text-only branch in `ComposeBox.tsx`; main-textarea rewired through the hook; new `ComposeBox.send-funnel.test.tsx` with one passing baseline test.

## What Shipped

### Hook signature (D-01, D-02, D-03)

```tsx
function useComposeSend(deps: {
  hostId: number;
  tmuxSession: string | null | undefined;
  onSend: ComposeBoxProps["onSend"];
  onOptimisticSend: ComposeBoxProps["onOptimisticSend"];
}): { send: (payload: string, options?: { bubbleTextOverride?: string; trigger?: string }) => boolean }
```

Defined at **ComposeBox.tsx L440–496** (above `export function ComposeBox` at L498).

### Exact line numbers touched in ComposeBox.tsx

| Site | Line (post-refactor) | Description |
|------|---------------------|-------------|
| `function useComposeSend` definition | L440 | Hook declaration (module-scope, co-located) |
| `const funnel = useComposeSend(...)` instantiation | L1399 | Hook call inside ComposeBox, before first handler |
| `function handleQueueSlotSend` | L1434 | Plan 68-02 target (unchanged this plan) |
| `function handleSend` | L1499 | Main-textarea handler — text-only branch rewired at L1585 |
| `const dispatched = funnel.send(payload, { trigger })` | L1585 | New call replacing L1493–1525 of the pre-refactor code |
| `function dispatchResetPayload` | L1807 | Plan 68-02 target (unchanged this plan) |
| `function handleQuickSend` | L1862 | Plan 68-02 target (unchanged this plan) |

### Test file

`ComposeBox.send-funnel.test.tsx` — **1 test**, modeled exactly on `PrettyView.optimistic-bubbles.test.tsx`:
- WS stub scaffold identical to the Phase 50 analog
- `mount()` renders `<PrettyView>` (end-to-end, not `<ComposeBox>` directly)
- Test 1: Enter → 1 pending bubble, `data-event-id` matches `^pending-pv-optim-`, `onSendMqidCapture` matches `/^pv-optim-\d+-[0-9a-z]{8}$/`, `onSendMock` called with `("hello", mqid)`
- `sendWsFrame` and `countConfirmedBubbles` helpers included in scaffold for Plan 68-03 extension

## Deviations from Plan

None — plan executed exactly as written.

- Hook declared module-scope above `export function ComposeBox` per D-01 (not inside the function body).
- `useCallback` deps array: `[hostId, tmuxSession, onSend, onOptimisticSend]` — matches plan spec.
- The three verbatim log format strings preserved byte-identical; all pre-existing submit-entry/success/failed test assertions remain green.
- `sendWsFrame` and `countConfirmedBubbles` are scaffolded but unused by the single Test 1. TypeScript void-cast applied to suppress unused-variable warnings without removing the scaffold (Plan 68-03 will add tests that use them). This is a minor cosmetic deviation from the plan's copy-paste instruction but does not affect correctness.

## Verification Results

- `npx tsc --noEmit` — 0 errors on both modified and new files.
- `npx vitest run ComposeBox.send-funnel.test.tsx` — 1/1 passed (5.3s test body).
- `npx vitest run ComposeBox.test.tsx` — exit code 0 (all pre-existing tests green).
- `npx vitest run PrettyView.optimistic-bubbles.test.tsx` — exit code 0 (all pre-existing tests green).
- `npx vitest run PrettyView.compose-send.test.tsx` — exit code 0 (all pre-existing tests green).

## Grep Audit (acceptance criteria)

- `grep -c "function useComposeSend" ComposeBox.tsx` → 1
- `grep -c "funnel\.send(" ComposeBox.tsx` → 1
- `grep -c 'pv-optim-\${Date.now()}' ComposeBox.tsx` → 1 (mqid generated once, inside hook)
- `grep -n "onOptimisticSend?\.(" ComposeBox.tsx` → lines 471, 487 only (both inside hook body, zero in handleSend)
- `grep -c "queue-slot|thumbs-up|thumbsUp|recap|/id reset" ComposeBox.send-funnel.test.tsx` → 0

## Known Stubs

None. This plan is a pure refactor + test scaffold. The hook exposes `bubbleTextOverride` but no call site in this plan passes it (Plan 68-02 does). The parameter is present and wired correctly; it is not a stub.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced. The refactor routes through the same `onSend` → `sendInput` → WS chain as before; T-68-SC (no new package installs) verified by inspection.

## Self-Check: PASSED

- `src/ui/features/pretty-view/ComposeBox.tsx` — exists and modified (hook at L440, funnel call at L1399, rewired branch at L1585).
- `src/ui/features/pretty-view/ComposeBox.send-funnel.test.tsx` — exists and created (208 lines, 1 test).
- Commit `4e166672` (refactor Task 1) — present in git log.
- Commit `b8583b86` (test Task 2) — present in git log.
