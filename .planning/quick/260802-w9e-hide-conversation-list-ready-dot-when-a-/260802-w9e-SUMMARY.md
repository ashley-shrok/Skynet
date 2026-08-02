---
phase: 260802-w9e-hide-conversation-list-ready-dot-when-a-
plan: 01
subsystem: pretty-conversations / pretty-view
tags: [ready-dot, session-queue-pending-store, patch-137-extension, bounty-hide-idle-dot]
requires:
  - src/ui/state/session-working-store.ts (pattern parent)
  - src/ui/state/session-recycling-store.ts (pattern parent)
  - src/ui/features/pretty-view/ComposeBox.tsx (queue state at line 358)
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (sessionKey wiring)
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx (dot predicate)
provides:
  - session-queue-pending-store: publishSessionQueuePending / useSessionQueuePending / getSessionQueuePendingSnapshot / __resetForTest
  - PrettyConversationRow prop: hasQueuePending?: boolean
  - Fourth dot-suppression gate: !hasQueuePending
affects:
  - PrettyConversationRow ready-dot visibility (row-level)
  - PrettyConversationsPanel row subscription surface (third store per row)
  - ComposeBox mount / unmount / queue-mutation observers
tech-stack:
  added:
    - none (new file only reuses React's useSyncExternalStore + existing testing-library)
  patterns:
    - Module-scoped Map + Set<() => void> listeners + snapshotVersion notify (mirrors session-working-store)
key-files:
  created:
    - src/ui/state/session-queue-pending-store.ts (152 lines)
    - src/ui/state/session-queue-pending-store.test.ts (218 lines, 8 Vitest cases)
  modified:
    - src/ui/features/pretty-view/ComposeBox.tsx (import + sessionKey derivation + 2 useEffects)
    - src/ui/features/pretty-view/ComposeBox.test.tsx (5 new integration tests appended)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (import + hook in RowLive + prop threading)
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx (Props addition + destructuring + predicate + comment updates)
    - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx (2 new tests: 15c + 15c-guard)
decisions:
  - Store type is Map<string, boolean> (NOT Map<string, boolean | null>). ComposeBox is the sole publisher and always knows queue state; no "unknown" middle state is needed. `false` is the safe default so a hook read against an unpublished key does NOT suppress the dot.
  - Two separate ComposeBox useEffects — a publish effect on `[queue, sessionKey]` and a cleanup effect on `[sessionKey]` — so unmount cleanup fires exactly once with the final `false` state regardless of mutation cadence.
  - `.working` className rollup at PrettyConversationRow.tsx:342-343 DELIBERATELY UNTOUCHED — only the dot render is in scope.
  - Key shape `${hostId}:${tmuxSession ?? ""}` mirrors sessionWorkingKey() verbatim so consumers subscribe to all three stores with the same string.
metrics:
  duration: ~8 minutes
  tasks_completed: 2/2
  files_created: 2
  files_modified: 5
  test_files: 3 (session-queue-pending-store.test.ts new, ComposeBox.test.tsx modified, PrettyConversationRow.test.tsx modified)
  tests_added: 15 (8 store + 5 ComposeBox integration + 2 row predicate)
  tests_passing: 169/169 across 8 test files
  completed_date: 2026-08-02
---

# Quick 260802-w9e: Hide conversation-list ready-dot when a queued message is armed for idle-send — Summary

Extended the patch #137 conversation-list ready-dot predicate with a fourth gate `!hasQueuePending` so that a session whose ComposeBox has at least one message armed for send-when-idle no longer paints the "ready for next instruction" dot. Introduces a new `session-queue-pending-store` module (parallel to `session-working-store` and `session-recycling-store`), publishes to it exclusively from ComposeBox on every `queue` mutation, subscribes from `PrettyConversationRowLive`, and gates the dot render on the new signal at `PrettyConversationRow.tsx:507`. Closes pinned bounty `hide-idle-dot-when-queued-message-waiting-to-send`.

## What Changed

### Task 1 — `session-queue-pending-store` module + tests

Created `src/ui/state/session-queue-pending-store.ts` as a boolean-only sibling of `session-working-store.ts`:

- Type: `Map<string, boolean>` (no null). Rationale: ComposeBox is the SOLE publisher and always knows the state of its own queue; `false` is the safe default (unknown → let the dot render).
- Public API: `publishSessionQueuePending(key, hasPending)`, `useSessionQueuePending(key)`, `getSessionQueuePendingSnapshot()`, `__resetForTest()`.
- No-op notify guard: dedupes redundant publishes so React consumers only re-render on real state transitions.
- Key shape `${hostId}:${tmuxSession ?? ""}` is identical to `sessionWorkingKey()` verbatim.
- Publishing `false` OVERWRITES to `false` (does NOT delete the key) — matches the working-store rationale for null.
- 8 Vitest cases cover: unknown-key → false, publish(true) round-trip, publish(false) overwrite (not delete), null-key short-circuit, no-op notify dedupe, `__resetForTest` behavior, snapshot exposure, multi-key independence.

**Commit:** `63678f1`

### Task 2 — Producer (ComposeBox) + consumer (PrettyConversationsPanel) + predicate (PrettyConversationRow) + tests

**ComposeBox.tsx** — added the `publishSessionQueuePending` import, derived `sessionKey` alongside the existing `tmuxSessionKey` normalization, and appended two new `useEffect`s next to the queue watchdog:

1. Publish effect (deps `[queue, sessionKey]`) — early-return when `sessionKey === null`, otherwise `publishSessionQueuePending(sessionKey, queue.length > 0)`. Fires on every mutation of the Vehicle C v2 armed-for-idle FIFO at line 358.
2. Cleanup effect (deps `[sessionKey]`) — returns a cleanup that publishes `false`. Kept separate so unmount fires the reset exactly once with the final state, and so a host/tmux switch also resets the outgoing key.

Publishes are on the `queue` state (armed for idle-send), NOT `queueSlots` (visual textareas) — matches the bounty's exact ask.

**PrettyConversationsPanel.tsx** — added the `useSessionQueuePending` import; inside `PrettyConversationRowLive`, added `const hasQueuePending = useSessionQueuePending(sessionKey);` alongside the existing `isWorking` and `isRecycling` reads; passed the new value down as `hasQueuePending={hasQueuePending}` on the `<PrettyConversationRow>` render. Updated the block comment above the wrapper to note the third store subscription.

**PrettyConversationRow.tsx** — added the optional `hasQueuePending?: boolean` prop to the Props interface (default `false`), destructured with a default, and extended the ready-dot render gate at line 507:

```diff
- {inActiveSet && isWorking === false && !isRecycling && (
+ {inActiveSet && isWorking === false && !isRecycling && !hasQueuePending && (
```

Updated the header-of-file block comment AND the in-render block comment above the dot to document the fourth predicate and quote the bounty rationale verbatim: *"if a queued message is armed to auto-send the moment the agent goes idle, the agent is effectively already spoken-for and NOT ready for Ashley's next instruction (which IS the meaning of the dot)."*

**Deliberately untouched (per plan non-scope):**

- The `.working` className rollup at `PrettyConversationRow.tsx:342-343` — that is the "working" visual class, semantically different from the dot.
- The CSS defense-in-depth gate at `pretty-conversations.css` — the queue-pending gate lives ONLY in JS because it isn't surfaced as a row className.
- `queueSlots` state — publish is on the `queue` FIFO only.

**Tests added:**

- `PrettyConversationRow.test.tsx` Test 15c: `inActiveSet+isWorking===false+hasQueuePending===true` → no ready-dot in DOM (JS gate).
- `PrettyConversationRow.test.tsx` Test 15c-guard: omitting `hasQueuePending` preserves prior render (default-false regression guard for every pre-w9e call site).
- `ComposeBox.test.tsx` new describe block (5 tests): mount publishes false, arm publishes true, cancel publishes false, unmount publishes false, `${hostId}:` shape for `tmuxSession=null` locks the key-shape contract with `sessionWorkingKey`.

**Commit:** `e993677`

## Verification

- `npx tsc --noEmit` → clean (0 errors)
- `npm run build:backend` → PASS
- `npm run build` → PASS (frontend Vite build; iOS assets emit unchanged)
- `npm test -- session-queue-pending-store` → 8/8 pass
- `npm test -- session-queue-pending-store PrettyConversationRow ComposeBox` → 119/119 pass across 7 files
- `npm test -- PrettyConversationsPanel` → 50/50 pass (no regressions from the new subscription in `PrettyConversationRowLive`)

Total: 169/169 tests pass across 8 files.

## Bounty Behavior Now Verifiable

An armed idle-send queue in one conversation suppresses THAT row's ready-dot only (per-source `${hostId}:${tmuxSession ?? ""}` key). Other rows in the conversation list continue to render their dots based on their own working / recycling / queue-pending signals.

## Deviations from Plan

**None** — plan executed exactly as written. All four sub-parts of Task 2 (producer, consumer, predicate, tests) landed with the plan's specified predicates, deps, and comment wording. The bonus "Test 15c-guard" default-false regression guard is a defense-in-depth extension of the plan's Task 2d row-level test (plan asked for one case; I shipped one plus one guard). This is additive, not a deviation.

## Known Stubs

None. All wiring is live end-to-end: ComposeBox publishes → store notifies → `PrettyConversationRowLive` subscribes → `PrettyConversationRow` gates the DOM.

## Threat Flags

None. This change extends an existing UI predicate — no new network endpoints, no new auth paths, no schema mutations, no new file-system access. The new store lives entirely in memory (module-scoped Map, no persistence layer, no cross-tab bridge).

## Self-Check: PASSED

Verified files exist:
- `src/ui/state/session-queue-pending-store.ts` — FOUND
- `src/ui/state/session-queue-pending-store.test.ts` — FOUND
- Modified: `src/ui/features/pretty-view/ComposeBox.tsx` — FOUND
- Modified: `src/ui/features/pretty-view/ComposeBox.test.tsx` — FOUND
- Modified: `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — FOUND
- Modified: `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — FOUND
- Modified: `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` — FOUND

Verified commits exist:
- `63678f1` — FOUND (Task 1)
- `e993677` — FOUND (Task 2)
