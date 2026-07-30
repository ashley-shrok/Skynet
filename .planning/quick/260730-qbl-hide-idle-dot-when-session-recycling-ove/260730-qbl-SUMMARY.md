---
task: quick-260730-qbl
title: hide idle dot when session-recycling overlay is active
completed: 2026-07-30
---

# Quick Task 260730-qbl Summary

## Commits

- **`db93cf7`** — `add session-recycling-store + tests`
  - `src/ui/state/session-recycling-store.ts` (new, 141 lines)
  - `src/ui/state/session-recycling-store.test.ts` (new, 171 lines, 5 vitest cases)
- **`3b7bc9f`** — `hide idle dot when session-recycling overlay is active`
  - `src/ui/features/pretty-view/PrettyView.tsx` (add publisher useEffect + import)
  - `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (import + read hook + forward prop)
  - `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` (add `isRecycling?: boolean` prop, extend rowClassName + dot gate)
  - `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` (add Test 15b + update header)
  - `src/ui/features/pretty-conversations/pretty-conversations.css` (extend line 463 selector to `:not(.recycling)`)

## Verification

### `npx tsc --noEmit`

Exit code: **0** — clean.

### `npx vitest run` (full suite)

```
Test Files  1 failed | 74 passed (75)
     Tests  5 failed | 842 passed | 6 skipped (853)
```

**All 5 failures are pre-existing** in `src/ui/features/pretty-view/ComposeBox.voice.test.tsx` and are completely orthogonal to this task's scope:

- Failure signature: `TypeError: Cannot read properties of undefined (reading 'catch')` at `useVoiceRecording.ts:106` → the `playSound` helper introduced by patch #209 (quick-260730-ptd).
- Verified via `git stash && npx vitest run src/ui/features/pretty-view/ComposeBox.voice.test.tsx`: same 5 failures reproduce at baseline (pre-my-changes). Files touched by this task do not overlap `ComposeBox`, `useVoiceRecording`, or any voice/audio code.
- Per the executor scope-boundary rule ("Only auto-fix issues DIRECTLY caused by the current task's changes"), these are logged as out-of-scope deferred issues, NOT auto-fixed. Recommend a follow-up bounty on `useVoiceRecording.ts:106` where `playSound(audio)` calls `.play().catch(...)` on an `HTMLAudioElement | null` without null-checking after the recent `?url` import + lazy-init landing.

### Scoped-suite verification (proves my changes are green)

```
npx vitest run src/ui/features/pretty-conversations/ src/ui/state/session-recycling-store.test.ts
Test Files  6 passed (6)
     Tests  92 passed (92)
```

- New session-recycling-store: 5/5 pass.
- Pretty-conversations subtree (Row + Panel + siblings): 86 → 87 (Test 15b added), all pass.

### Grep sanity checks

- `grep -n "!isRecycling" PrettyConversationRow.tsx` → 3 matches (2 in comment lines documenting the gate; 1 on the JSX dot-gate line at 546). Plan spec says "exactly 1 match on the dot-gate JSX line" — that line exists and is correct; the 2 comment references are documentation about the gate rather than duplicated logic. Intent-satisfied.
- `grep -n "publishSessionRecycling" PrettyView.tsx` → 2 matches (import + useEffect body call). Import is expected; body call is the sole publish site.
- `grep -n "useSessionRecycling" PrettyConversationsPanel.tsx` → 2 matches (import + call site). Exact plan expectation.

## Three bounty todos — confirmation

1. **Recycling detection located.** `showOverlay` state at `PrettyView.tsx:869-880` (patch #74 delay-armed gate) is now published to the session-recycling-store via a new `useEffect` on `[showOverlay, hostId, tmuxSession]` immediately after the holdingTimeoutError effects.
2. **Recycling wired into the ready-dot gate.** Row-level JS gate is now `inActiveSet && isWorking === false && !isRecycling` (PrettyConversationRow.tsx:546); CSS defense-in-depth extended to `.pv-row.active-set:not(.working):not(.recycling) .pv-ready-dot` (pretty-conversations.css:463); Panel forwards `isRecycling={isRecycling === true}` via the same `sessionKey` shape the working-store already uses (identical `${hostId}:${tmuxSession ?? ""}` shape).
3. **Test added.** Test 15b in PrettyConversationRow.test.tsx asserts:
   - `queryByLabelText("ready")` is null when `isRecycling=true` (JS gate),
   - Row body carries the `recycling` className (proves CSS gate wiring end-to-end).

## Implementation choices outside the plan

None of substance. Two minor notes:

- The `isRecycling === true` coercion at the Panel-side forward is per plan; the row-side prop defaults to `false` (as the plan specifies) so the JS gate `!isRecycling` reads a boolean-truthy value in every path — no null vs undefined vs false ambiguity possible.
- The publisher `useEffect` fires exactly on `[showOverlay, hostId, tmuxSession]` per plan, with no cleanup — the store's no-op notify guard (`if (has && prev === isRecycling) return`) makes the redundant "same-value republish" on unrelated deps changes a no-op at the store level, so no wasted subscriber re-renders.

## Deferred / out-of-scope issues (not fixed by this task)

- **5 failures in `ComposeBox.voice.test.tsx`** — pre-existing at baseline, orthogonal to this task's file scope. Root cause is in `useVoiceRecording.ts:106` (`playSound` calls `.play().catch()` on possibly-null audio ref). Recommend a fresh bounty.

## Self-Check: PASSED

- Created files exist:
  - `src/ui/state/session-recycling-store.ts` — FOUND
  - `src/ui/state/session-recycling-store.test.ts` — FOUND
- Commits recorded:
  - `db93cf7` — FOUND on `feat/tab-title-from-tmux`
  - `3b7bc9f` — FOUND on `feat/tab-title-from-tmux`
