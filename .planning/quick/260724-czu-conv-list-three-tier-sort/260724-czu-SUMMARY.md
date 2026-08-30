---
phase: quick-260724-czu
plan: 01
subsystem: conversation-store + pretty-conversations-panel
tags: [patch-149, three-tier-sort, active-set, fleet-pinned, dedup]
dependency_graph:
  requires: [cf624a4]  # Slice A — fleet-row pin guard removal
  provides: [ConversationList.activeSet, data-active-set-group]
  affects: [PrettyConversationsPanel, conversation-store]
tech_stack:
  added: []
  patterns: [strict-dedup-via-emittedIds-Set, three-tier-derived-list, TDD-RED-GREEN]
key_files:
  created: []
  modified:
    - src/ui/state/conversation-store.ts
    - src/ui/state/conversation-store.test.ts
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
decisions:
  - "Test 30 (Slice A regression) reconciled to Slice B semantics: fleet row now correctly in pinned[], not grouped[], after pinConversation; the load-bearing Slice A assertion (pinnedIds.has(id)) is preserved"
  - "fleetSyntheticRows built as {hostIdStr, row} tuples in one pass over fleetSessions, avoiding id re-parsing in the Tier 3 bucketing loop"
  - "activeSetRows renamed to avoid collision with the existing activeSet ReadonlySet from useActiveSet() in PrettyConversationsPanel"
metrics:
  duration: ~5min
  completed: "2026-07-24"
  tasks: 3
  files: 4
---

# Phase quick-260724-czu Plan 01: Patch #149 B+C — Three-Tier Sort for Pretty-Conversations Panel Summary

**One-liner:** Three-tier derived conversation list (activeSet → pinned → grouped) with strict dedup via emittedIds Set; fleet-pinned rows now surface at the top; PrettyConversationsPanel renders the new active-set tier above pinned via `data-active-set-group=true`.

## What Was Built

### Task 1 — Reshape ConversationList + computeSnapshot (TDD)

**Store type change:** `ConversationList` extended with `activeSet: ConversationRow[]` as the first field (field order: `activeSet, pinned, grouped`).

**computeSnapshot rewrite:** Three-tier derivation with strict dedup:
- Built `openTabsSessionKeys` in a separate first pass (no longer mixed into the grouped loop).
- Built `fleetSyntheticRows` as `{ hostIdStr, row }[]` tuples in one clean pass over `fleetSessions`.
- **Tier 1 (activeSet):** conversationTabs in order → fleetSyntheticRows in order; emitted ids tracked in `emittedIds Set`.
- **Tier 2 (pinned, not activeSet):** now iterates BOTH conversationTabs AND fleetSyntheticRows (Patch #149 B: fleet-derived pinned rows now surface at the top).
- **Tier 3 (grouped):** everything not in emittedIds, bucketed by host — logic unchanged.
- **RDP sentinel:** unchanged, synthesized separately, never touches Tier 1 or Tier 2.
- Returns `{ activeSet: activeSetRows, pinned, grouped }`.

**Test additions:**
- Empty-state shape-guard: `convs.current.activeSet` equals `[]`.
- Test 30b: pinned fleet row appears in `snap.pinned` and not in `grouped`.
- Test 30c: `addToActiveSet` on a pinned fleet id promotes to `activeSet`, empties `pinned`.
- Test 30d: activeSet-only (not pinned) fleet row goes to Tier 1 only.
- Test 30e: openTab row in both `pinnedIds` and `activeSet` goes to Tier 1 only (dedup covers openTab path too).
- Test 30 (Slice A regression): reconciled to Slice B semantics — the fleet row is now correctly in `pinned[]`, not `grouped[]`.
- **41 conversation-store tests green.**

**Commit:** `21ec1a7`

### Task 2 — Panel render + mock reconcile (TDD)

**PrettyConversationsPanel.tsx:**
- Destructures `activeSet: activeSetRows` from `useConversations()`.
- `isEmpty` updated: `activeSetRows.length === 0 && pinned.length === 0 && grouped.length === 0`.
- New `.pv-panel-group[data-active-set-group=true]` block rendered ABOVE `.pv-panel-group[data-pinned-group=true]`; row props mirror the pinned block with `pinned={pinnedIds.has(row.id)}` (dynamic per row, so a row that is both pinned and active shows the pin glyph).

**PrettyConversationsPanel.test.tsx:**
- `MockSnapshot`, `snapshot` seed, `setSnapshot`, `useConversations` mock, and `beforeEach` reset all extended with `activeSet: []`.
- Tests 18/18b: active-set group DOM-order invariant (`compareDocumentPosition`); isEmpty accounting when activeSet has rows.
- **38 pretty-conversations tests green.**

**Commit:** `5454fef`

### Task 3 — End-to-end type-check + full targeted test run (verification only)

- `npx tsc --noEmit` exits 0, no errors.
- `npx vitest run src/ui/state/conversation-store.test.ts src/ui/features/pretty-conversations/` — **79 tests across 3 files, all green.**
- `git diff --stat HEAD~2 HEAD` shows exactly 4 files modified (+303/-57), zero new files, zero deletions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test 30 (Slice A regression) had a stale assertion**
- **Found during:** Task 1 GREEN phase
- **Issue:** Test 30 asserted that after `pinConversation("fleet::1::work")`, the row still appears in `snap2.grouped[0].rows[0]` (the pre-Slice-B "rows stay in grouped" comment). Once Slice B's tier logic was live, the fleet row correctly promoted to `snap2.pinned`, making `grouped[0]` undefined and the test crash.
- **Fix:** Reconciled assertion to reflect Slice B semantics — the load-bearing Slice A invariant (`pinnedIds.has("fleet::1::work")`) is preserved; the stale `grouped[0]` check replaced with `snap2.pinned.length === 1` + `snap2.pinned[0].id === "fleet::1::work"`.
- **Files modified:** `src/ui/state/conversation-store.test.ts`
- **Commit:** `21ec1a7`

## Self-Check: PASSED

Files created/modified all confirmed via `git diff --stat`:
- `src/ui/state/conversation-store.ts` — modified
- `src/ui/state/conversation-store.test.ts` — modified
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — modified
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — modified

Commits verified:
- `21ec1a7` — Task 1
- `5454fef` — Task 2

## Final Verification Output

```
 RUN  v4.1.8 /home/ubuntu/skynet

 Test Files  3 passed (3)
      Tests  79 passed (79)
   Start at  09:32:24
   Duration  9.16s

npx tsc --noEmit: exit 0, no output
```

## Known Stubs

None. All wiring is live.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced.
