---
phase: 68-compose-send-funnel
plan: "02"
subsystem: pretty-view/compose
tags: [refactor, send-funnel, optimistic-bubbles, render-blacklist, phase-68]
dependency_graph:
  requires: [68-01]
  provides: [all-5-triggers-funnel, reset-render-blacklist, thumbs-up-bubble-override, disable-predicate-relaxation]
  affects: [ComposeBox.tsx, PrettyView.tsx, ComposeBox.test.tsx]
tech_stack:
  added: []
  patterns: [funnel.send call site pattern, isIdCommand render-blacklist guard]
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/ComposeBox.test.tsx
decisions:
  - "bubbleTextOverride passed as literal string literal '👍' only at thumbs-up wire site — not user-controllable (T-68-06 mitigated)"
  - "isIdCommand guard placed as first statement in handleOptimisticSend body, covers both immediateFailure branches"
  - "QS 4/5/6b test assertions updated to toHaveBeenCalledWith(payload, expect.stringMatching(/^pv-optim-/)) per Rule 1 auto-fix"
  - "fireNextQueued cadence drainer + handleVoiceSend slot branch left on direct onSend() — out of scope per shape file deferred items"
metrics:
  duration: ~40 min
  completed: "2026-09-02"
  tasks_completed: 3
  files_modified: 3
  files_created: 0
---

# Phase 68 Plan 02: Rewire Remaining 4 Send-Triggers + Reset Render-Blacklist Summary

Rewired `handleQueueSlotSend`, `dispatchResetPayload`, and `handleQuickSend` through the `useComposeSend` funnel; added `bubbleTextOverride: "👍"` to the thumbs-up wire site; relaxed the thumbs-up and recap `disabled` predicates by removing `canSend === false ||`; and inserted an `isIdCommand` render-blacklist guard in `PrettyView.handleOptimisticSend` so reset never seeds a pending bubble while still threading `messageQueueItemId` through the WS frame.

## What Shipped

### Exact line numbers of rewired call sites (stable coordinates for Plan 68-03 tests)

| Site | File | Line | Funnel call |
|------|------|------|-------------|
| `handleQueueSlotSend` text-only dispatch | ComposeBox.tsx | L1483 | `funnel.send(payload, { trigger: "queue-item" })` |
| `dispatchResetPayload` dispatch | ComposeBox.tsx | L1820 | `funnel.send(payload, { trigger: "reset" })` |
| `handleQuickSend` dispatch | ComposeBox.tsx | L1886 | `funnel.send(quickText, { trigger: "quick-reply", bubbleTextOverride: options?.bubbleTextOverride })` |
| Thumbs-up `bubbleTextOverride` wire site | ComposeBox.tsx | L2467 | `handleQuickSend("thumbs up", { bubbleTextOverride: "👍" })` |
| Recap wire site (no override) | ComposeBox.tsx | L2490 | `handleQuickSend("/explain the current situation")` |
| `isIdCommand` render-blacklist guard | PrettyView.tsx | L1157 | `if (isIdCommand(payload)) { return; }` |

### bubbleTextOverride value (byte-for-byte, for Plan 68-03 assertion)

The exact string literal used at the thumbs-up wire site: `"👍"` (U+1F44D, encoded as UTF-8 bytes 0xF0 0x9F 0x91 0x8D). The `funnel.send` call passes this as `bubbleTextOverride` which flows to `onOptimisticSend({ payload: bubbleText, ... })` — so the pending bubble's `content` field is `"👍"`, not `"thumbs up"`. The first argument to `onSend` is still `"thumbs up"` (the backend receives the literal command).

### Disable predicate relaxation

Both thumbs-up (was L2379 pre-refactor, now L2468) and recap (was L2412, now L2484-ish) had `canSend === false ||` removed. Remaining predicates preserved verbatim:
```tsx
disabled={asideActive === true || recycleActive === true || planPendingActive === true || reconnectingActive === true}
```

The 4 other `canSend` sites in ComposeBox (L2247 Enter button, L2773, L3421, comment) were not touched.

### Reset render-blacklist mechanism

`handleOptimisticSend` in PrettyView.tsx now has this guard as its first statement after destructuring:
```tsx
if (isIdCommand(payload)) { return; }
```
`isIdCommand` is the existing module-scoped helper at L425-427 that recognizes both `/id ` prefix (raw) and `<command-name>/id</command-name>` (harness XML-wrapper). The early return applies to BOTH `immediateFailure=true` and `immediateFailure=false` branches — reset never appears in `pendingSends`, so nothing renders. The WS `input` frame still carries `messageQueueItemId` via the unchanged `sendInput` callback.

### All 5 triggers now route through useComposeSend

| Trigger | Handler | Since |
|---------|---------|-------|
| Main textarea Enter/Send | `handleSend` | Plan 68-01 (L1585) |
| Queue-slot Send button / Enter | `handleQueueSlotSend` | Plan 68-02 (L1483) |
| Reset button | `dispatchResetPayload` | Plan 68-02 (L1820) |
| Thumbs-up button | `handleQuickSend` (via wire site) | Plan 68-02 (L1886) |
| Recap button | `handleQuickSend` (via wire site) | Plan 68-02 (L1886) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] QS 4/5/6b test assertions broken by funnel's two-arg onSend**
- **Found during:** Task 1 verification — `npx vitest run ComposeBox.test.tsx` showed 3 failures
- **Issue:** Tests QS 4, QS 5, QS 6b asserted `expect(onSend).toHaveBeenCalledWith("payload")` (single arg). Post-refactor, the funnel calls `onSend(payload, mqid)` (two args). Vitest's `toHaveBeenCalledWith` performs exact argument matching — the extra `mqid` argument caused all three to fail.
- **Fix:** Updated the three assertions to `toHaveBeenCalledWith("payload", expect.stringMatching(/^pv-optim-\d+-[0-9a-z]{8}$/))` — matching the funnel's D-03 invariant (mqid always present).
- **Files modified:** `src/ui/features/pretty-view/ComposeBox.test.tsx` (L833, L867, L941)
- **Commit:** `25473d68`

### Count Deviation (non-blocking)

The plan's Task 1 acceptance criterion `grep -cE "^\s*const dispatched = onSend\(" == 1` returned 4 in practice:
- L474: `onSend(payload, mqid)` inside the hook's own implementation (always was there, created in 68-01)
- L1233: `onSend(payload)` in `fireNextQueued` cadence drainer (system-initiated, deferred per CONTEXT.md)
- L1712: `onSend(payload)` in `handleVoiceSend` slot branch (voice path, deferred per shape file)
- L1877: `onSend(quickText)` in `handleQuickSend` — Task 2 target, correctly rewired to 0

After Task 2, count is 3 (hook body + 2 out-of-scope deferred paths). The plan's count assumed the pre-68-01 baseline; the hook's own internal `onSend` call was not accounted for. Behavior is correct — all user-driven trigger call sites route through the funnel.

## Verification Results

- `npx tsc --noEmit` — 0 errors on both ComposeBox.tsx and PrettyView.tsx
- `npx vitest run ComposeBox.test.tsx` — 64/64 passed (after Rule 1 test fix)
- `npx vitest run ComposeBox.send-funnel.test.tsx` — 1/1 passed (Test 1 baseline preserved)
- `npx vitest run PrettyView.optimistic-bubbles.test.tsx` — passed (all tests green)
- `npx vitest run PrettyView.compose-send.test.tsx` — 26/26 passed
- `npx vitest run PrettyView.test.tsx` — 34/34 passed + 1 skipped + 1 todo
- Combined 4-file suite: 91/91 passed

## Grep Audit (final state)

- `grep -c "funnel\.send(" ComposeBox.tsx` → 4 (hook body + queue-slot + reset + quick-reply)
- `grep -c 'bubbleTextOverride: "👍"' ComposeBox.tsx` → 1 (thumbs-up wire site only)
- `grep -c "canSend === false ||" ComposeBox.tsx` → 3 (L2247 Enter btn, L2773, L3421 — none are thumbs-up or recap)
- `grep -nE "if \(isIdCommand\(payload\)\) \{ return" PrettyView.tsx` → L1157 (inside handleOptimisticSend L1146-1210)
- `grep -c "isIdCommand" PrettyView.tsx` → 5 (declaration 2 lines + 1 new call = 3 minimum satisfied)
- `grep -c 'handleQuickSend("thumbs up"' ComposeBox.tsx` → 1 (onSend receives literal "thumbs up")
- `grep -c 'handleQuickSend("/explain the current situation")' ComposeBox.tsx` → 1 (no override)

## Known Stubs

None. All 5 triggers are fully wired through the funnel. The `bubbleTextOverride` parameter is used at the thumbs-up wire site with a literal string value.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes. The refactor routes through the same `onSend` → `sendInput` → WS chain. T-68-SC verified: `git diff package.json package-lock.json` → zero lines.

## Commits

| Task | Hash | Message |
|------|------|---------|
| Task 1 | `3151ff1a` | refactor(68-02): rewire handleQueueSlotSend + dispatchResetPayload through funnel |
| Task 2 | `cc03e380` | refactor(68-02): rewire handleQuickSend through funnel + thumbs-up 👍 override + relax L2451/L2484 disable predicates |
| Task 3 | `4b138036` | refactor(68-02): add reset render-blacklist guard in handleOptimisticSend |
| Deviation fix | `25473d68` | fix(68-02): update QS 4/5/6b test assertions for funnel's two-arg onSend |

## Self-Check: PASSED

- `src/ui/features/pretty-view/ComposeBox.tsx` — modified (funnel calls at L1483, L1820, L1886; thumbs-up override at L2467; disable predicates relaxed at L2468, L2484)
- `src/ui/features/pretty-view/PrettyView.tsx` — modified (isIdCommand guard at L1157)
- `src/ui/features/pretty-view/ComposeBox.test.tsx` — modified (QS 4/5/6b assertions updated)
- Commit `3151ff1a` — present in git log
- Commit `cc03e380` — present in git log
- Commit `4b138036` — present in git log
- Commit `25473d68` — present in git log
