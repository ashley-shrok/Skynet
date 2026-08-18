---
phase: quick-260818-l8n
plan: 01
subsystem: ui/state/conversation-store
tags: [pins, pruner, race-condition, deploy-race, fleet-sessions]
dependency_graph:
  requires: []
  provides:
    - "sticky-pinnedIds-invariant: state.pinnedIds is never mutated by updateOpenTabs"
    - "orphan-pinnedIds-render-side-skip test-locked (retire-pruner render contract)"
  affects:
    - "src/ui/state/conversation-store.ts::updateOpenTabs (pruner block removed)"
    - "src/ui/state/conversation-store.test.ts (three describes rewritten + one added)"
tech_stack:
  added: []
  patterns:
    - "Sticky-across-transient-inputs Set mutation (matches hiddenIds semantics)"
    - "Render-side orphan skip in place of store-side prune"
key_files:
  created: []
  modified:
    - src/ui/state/conversation-store.ts
    - src/ui/state/conversation-store.test.ts
decisions:
  - "Retire updateOpenTabs pin pruner rather than harden the fleet keep-set: render-side orphan skip in computeSnapshot Tier 2 already handles orphan pin ids gracefully, making the pruner both redundant and harmful on WS reconnect."
  - "Preserve fleetSessionsLoaded gate machinery: still needed for the initial hydratePinnedIdsFromServer fetch ordering (avoids re-hydration ordering fragility), unrelated to the retired pruner."
  - "Retain the quick-260727-kbw regression test as an invariant guard rather than delete it: the assertion is now trivially true, but a regression re-introducing pin scrubbing in any form would trip it."
metrics:
  duration: "~11 minutes (implementation + tests + full vitest run + commit)"
  completed: "2026-08-18"
requirements: [QUICK-260818-L8N-01]
---

# Quick Task 260818-l8n: Retire Pin Pruner from updateOpenTabs — Summary

One-liner: Deleted the pin pruner block from `updateOpenTabs` in `src/ui/state/conversation-store.ts` — pins are now sticky across openTabs / fleetSessions churn, fixing Ashley's deploy-race where WS-reconnect transients nuked legitimate pins that then got persisted server-side on her next pin/unpin.

## What Shipped

**Code change (single atomic commit `36a983cf`, net −14 lines on the store file):**

- `updateOpenTabs` in `src/ui/state/conversation-store.ts` no longer:
  - builds a `fleetPinKeepSet` from `state.fleetSessions`
  - clones `state.pinnedIds` into `nextPinnedIds`
  - iterates `state.pinnedIds` calling `nextPinnedIds.delete(id)`
  - tracks a `pinnedChanged` flag
  - includes `pinnedIds:` in the closing `state = { ...state, ... }` spread
- The no-op short-circuit at the end of `updateOpenTabs` collapsed from
  `!tabsChanged && !pinnedChanged && nextSelectedId === state.selectedId`
  to `!tabsChanged && nextSelectedId === state.selectedId`.
- Selection coercion (`nextSelectedId = null` when the selected tab leaves)
  and deferred-select promotion (`pendingSelectId` flush) preserved verbatim.
- Four dangling witness comments rewritten to reflect the retirement:
  fleetSessionsLoaded state field, Tier 2 pinned iteration in
  `computeSnapshot`, `hideConversation` contrast note, `useFleetSessionsLoaded`
  hook block.

**Test changes in `src/ui/state/conversation-store.test.ts`:**

- Test 5 ("session-end lifecycle") — pin assertions FLIPPED from
  `.toBe(false)` to `.toBe(true)`; describe renamed to
  `"conversation-store: session-end lifecycle (pins are sticky)"`.
  Selection-coercion assertion preserved unchanged.
- Test 5b/5c describe renamed from
  `"conversation-store: pruner fleet-aware (patch #150 A)"` to
  `"conversation-store: pins are sticky across updateOpenTabs (quick-260818-l8n)"`.
  First test (fleet pins survive) retained verbatim; second test
  (openTab pin scrubbing) REPLACED with a stickiness guard mirroring
  Ashley's deploy-race (openTab pin survives when its tab leaves the
  tabs list — both `t1` and `t2` pins remain `true` after
  `updateOpenTabs([tabT2])`).
- Patch #230 B block header comment updated to remove the pruner
  framing (retained the render-side-only test body unchanged).
- quick-260727-kbw regression test retained as an invariant guard —
  assertion is now trivially true; the comment was reframed to describe
  the retire-pruner regime instead of the fleet keep-set mechanism.
  Describe renamed from `"...survives updateOpenTabs pruner..."` to
  `"...survives updateOpenTabs when hydrated after fleet load..."`.
- NEW describe `"conversation-store: orphan pinnedIds render gracefully
  (retire-pruner quick-260818-l8n)"` — locks the render-side skip:
  `hydratePinnedIdsFromServer(["fleet::99::ghost"])` with empty
  fleetSessions + empty openTabs → assert `snap.pinnedIds.has(...)` is
  `true` AND `snap.pinned === []`.

## Byte-Verify + Gates

- `grep -c 'fleetPinKeepSet\|prune pinned ids' src/ui/state/conversation-store.ts` → **0**
- `grep -n 'fleetPinKeepSet\|prune pinned ids' src/ui/state/conversation-store.test.ts` → **0 matches** (all references retired)
- `npx tsc --noEmit` → **exit 0**
- `npx vitest run` → **exit 0**
  - Test Files: **191 passed** (191)
  - Tests: **2434 passed | 9 skipped | 1 todo** (2444 total)
  - Duration: 539.19s
  - Matches the STATE.md 2026-08-17 baseline (9 skip + 1 todo) exactly

## `git diff --stat`

```
 src/ui/state/conversation-store.test.ts | 132 ++++++++++++++++++++++----------
 src/ui/state/conversation-store.ts      | 108 ++++++++++++--------------
 2 files changed, 138 insertions(+), 102 deletions(-)
```

Per-file numstat:
- `src/ui/state/conversation-store.ts` — `+47 / -61` (net **−14** lines; pruner deletion outweighs the four witness-comment rewrites — matches the plan's net-negative-lines `done` criterion).
- `src/ui/state/conversation-store.test.ts` — `+91 / -41` (net **+50** lines; new orphan-render describe + reframed comments on the retained regression test).

## Commit

- Hash: **`36a983cf`** (`36a983cfce53213e3d17f7b9205387fdaf1dfe77`)
- Branch: `feat/tab-title-from-tmux` (as required — no worktree, no new branch)
- Subject: `refactor(quick-260818-l8n): retire pin pruner from updateOpenTabs — pins are sticky`
- Body: full deploy-race explanation, render-side-skip rationale, fleetSessionsLoaded preservation note, and enumerated test re-anchoring.

## Deviations from Plan

None. The plan's action steps 1a-d, 2a-e, and 3 (byte-verify + tsc + vitest) executed exactly as written. One micro-adjustment inside Step 1d: the initial rewrite of the `fleetSessionsLoaded` state-field comment and the `useFleetSessionsLoaded` hook comment left the string `fleetPinKeepSet` inside quoted retrospective phrases (documenting the retired mechanism). The plan's Step 3 grep gate treated this as a MUST-be-zero condition on the source file, so both comments were rewritten a second time to eliminate the identifier entirely while keeping the "flag retention rationale" intact. Same rewrite was applied to one leftover reference in the test file (Tests 5b/5c header) to hit the plan's SHOULD-be-zero grep on the test file.

## Preserved (Untouched)

- `updateFleetSessions` — flag flip false→true unchanged.
- `removeFleetSession`, `hydratePinnedIdsFromServer`, `hydrateHiddenIdsFromServer` — untouched.
- `pinConversation`, `unpinConversation`, `togglePinConversation` — untouched (explicit user-driven pin mutations preserved).
- `useFleetSessionsLoaded` hook — untouched code, comment reframed.
- `PrettyConversationsPanel.tsx` mount-effect gate — untouched (referenced for context only).
- computeSnapshot Tier 2 iteration code — untouched (only the witness comment was rewritten).
- Test 5b first case (four fleet pins survive an unrelated openTab arriving) — retained verbatim; only its pre-#150 A retrospective comment was updated.
- Patch #230 B pinned-tier fleet-shadow-id test body — retained verbatim; only its header comment was updated.
- Test G / Test L pinned-zone stability tests — untouched.
- Phase 15 pinnedIds ↔ server persistence tests (30j–30p) — untouched.

## Out of Scope (Fleet Rule)

- Deploy motion (docker build + coord announce + recreate + push + patch entry) is orchestrator scope. Executor stopped at code + commit + full-suite green as instructed.

## Self-Check: PASSED

- File exists: `/home/ubuntu/skynet-tanya/src/ui/state/conversation-store.ts` — FOUND.
- File exists: `/home/ubuntu/skynet-tanya/src/ui/state/conversation-store.test.ts` — FOUND.
- Commit exists: `36a983cf` — FOUND on `feat/tab-title-from-tmux`.
- Byte-verify grep (source file): 0 matches — PASSED.
- Byte-verify grep (test file): 0 matches — PASSED.
- `npx tsc --noEmit` exit 0 — PASSED.
- `npx vitest run` exit 0, baseline-matching skip/todo counts — PASSED.
- Net-negative-lines on source file (+47 / −61 = −14) — PASSED.
