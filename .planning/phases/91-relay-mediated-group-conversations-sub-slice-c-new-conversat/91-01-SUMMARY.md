---
phase: 91-relay-mediated-group-conversations-sub-slice-c-new-conversat
plan: "01"
subsystem: pretty-conversations / form-state / types
tags:
  - foundation
  - types
  - form-hook
  - interface-first
  - tdd
  - slice-c
dependency_graph:
  requires:
    - Phase 91 Plan 00 (BasicUser.mxid: string | null — consumed indirectly via Plan 05)
  provides:
    - participant-types.ts (PickedParticipant + GateState + CreateRelayRoomRequest + CreateRelayRoomResponse)
    - useNewConversationForm hook (form state machine for NewConversationModal)
  affects:
    - Phase 91 Plan 03 (sub-components — ParticipantChip, ParticipantChipStrip, ParticipantSearchInput, ParticipantList — all import PickedParticipant)
    - Phase 91 Plan 04 (relay-room-create-api frontend client — imports CreateRelayRoomRequest + CreateRelayRoomResponse)
    - Phase 91 Plan 05 (NewConversationModal — consumes useNewConversationForm + GateState)
    - Phase 91 Plan 02 (backend route — imports CreateRelayRoomRequest + CreateRelayRoomResponse wire types)
tech_stack:
  added: []
  patterns:
    - "Types-only module: zero runtime code, zero backend imports, JSDoc every exported symbol"
    - "useMemo + useCallback for all derived state and callbacks"
    - "Set<string> for O(1) toggle/remove on picked participants"
    - "TDD RED/GREEN cycle: test file committed before implementation"
key_files:
  created:
    - src/ui/features/pretty-conversations/participant-types.ts
    - src/ui/features/pretty-conversations/useNewConversationForm.ts
    - src/ui/features/pretty-conversations/useNewConversationForm.test.ts
  modified: []
decisions:
  - "PickedParticipant.mxid is required non-null — Plan 05 (modal) is the enforcement site; this file documents the invariant in JSDoc"
  - "GateState reasons use single-quoted string literals to match acceptance criteria grep checks"
  - "availableHumans self-exclusion: viewingUserMxid=null disables exclusion entirely (Test 8 behavior)"
  - "picked order: humans-first then agents mirrors chips-strip visual expectation from PATTERNS.md"
  - "gate priority: submitting → no-room-name → no-participants → single-agent-only → ok (strict per D-decision)"
metrics:
  duration: "~4 minutes"
  completed: "2026-09-09"
  tasks_completed: 2
  files_changed: 3
---

# Phase 91 Plan 01: Participant Types + Form Hook — Summary

**One-liner:** PickedParticipant/GateState/wire-types surface plus useNewConversationForm hook (8/8 tests green) — the interface-first foundation all Wave 3+ slice C artifacts import from.

## What Was Built

**Task 1: `participant-types.ts` (types-only module)**

Exports four type surfaces:

1. `PickedParticipant` — the unified row-shape (mxid, displayName, colorHue, avatarUrl, role, optional userId/identityKey/subtitle). mxid is required non-null; JSDoc documents Plan 05 as the enforcement site. Covers both human (`role: "human"`) and agent (`role: "agent"`) participants.

2. `GateState` — discriminated union: `{ ok: true } | { ok: false; reason: 'no-participants' | 'single-agent-only' | 'no-room-name' | 'submitting' }`. Four negative reasons match shape §Shape conditions plus the submitting debounce lock.

3. `CreateRelayRoomRequest` — wire type for `POST /relay-room/create` body: `{ roomName: string; humanMxids: string[]; agentMxids: string[] }`.

4. `CreateRelayRoomResponse` — wire type for the success response: `{ ok: true; roomId: string; sessionId: string; roomTitle: string }`.

Zero runtime code. Zero backend imports. All symbols JSDoc'd with D-decision / shape rule references.

**Task 2: `useNewConversationForm.ts` + `useNewConversationForm.test.ts`**

Hook signature:
```ts
useNewConversationForm(opts: {
  humans: PickedParticipant[];
  agents: PickedParticipant[];
  viewingUserMxid: string | null;
}): { roomName, setRoomName, searchQuery, setSearchQuery, picked, availableHumans,
      availableAgents, toggle, remove, gate, submitting, setSubmitting, error, setError }
```

Internal state: `useState` for roomName, pickedMxids (Set), searchQuery, submitting, error.

Derived state via `useMemo`:
- `availableHumans`: self-exclude (skip when viewingUserMxid=null) + case-insensitive substring filter + `localeCompare` sort
- `availableAgents`: same filter + sort, no self-exclusion
- `picked`: humans-first then agents, filtered by pickedMxids Set
- `gate`: strict priority order per D-decision

Callbacks via `useCallback`: `toggle` (add/delete from Set), `remove` (delete, idempotent).

## Files Touched

| File | Change |
|------|--------|
| `src/ui/features/pretty-conversations/participant-types.ts` | Created — 150 lines, types-only |
| `src/ui/features/pretty-conversations/useNewConversationForm.ts` | Created — 170 lines, hook implementation |
| `src/ui/features/pretty-conversations/useNewConversationForm.test.ts` | Created — 213 lines, 8 tests |

## Tests Written + Green Gate Output

**RED commit:** `29282b93` — test file importing from non-existent modules; import fails at resolve time (RED gate confirmed).

**GREEN commit:** `2b2ddbc5` — both implementation files created; all 8 tests pass.

```
 RUN  v4.1.8 /home/ubuntu/skynet-taylor

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  11:15:21
   Duration  1.44s (transform 112ms, setup 47ms, import 223ms, tests 74ms, environment 912ms)
```

**Tests covering:**
1. Initial state (roomName='', picks=empty, gate=no-room-name, submitting=false, error=null)
2. Self-exclusion (viewingUserMxid omitted from availableHumans)
3. Alphabetical sort (scrambled input → sorted output for both sections)
4. Case-insensitive filter ('AL' → only "Alice" passes; empty query restores full list)
5. Gate transitions (blank name → set name → pick agent → pick human → submitting)
6. Toggle idempotence (toggle in, toggle out → back to empty)
7. remove() (removes only the targeted mxid; unknown mxid is no-op)
8. viewingUserMxid=null (no exclusion; all humans visible)

## Acceptance Criteria Verification

**Task 1:**
- `grep -c "export type PickedParticipant" participant-types.ts` → 1 ✓
- `grep -c "export type GateState" participant-types.ts` → 1 ✓
- `grep -c "export interface CreateRelayRoomRequest" participant-types.ts` → 1 ✓
- `grep -c "export interface CreateRelayRoomResponse" participant-types.ts` → 1 ✓
- No backend imports → 0 ✓
- `npx tsc --noEmit` → clean ✓

**Task 2:**
- `grep -c "export function useNewConversationForm"` → 1 ✓
- `grep -c "PickedParticipant"` → 11 (>= 3) ✓
- `grep -c "'submitting'"` → 1 ✓
- `grep -c "'single-agent-only'"` → 1 ✓
- `grep -c "viewingUserMxid"` → 5 (>= 2) ✓
- `grep -c "localeCompare"` → 6 (>= 2) ✓
- No backend imports → 0 ✓
- No api client imports → 0 ✓
- `npx vitest run ...useNewConversationForm.test.ts` → 8/8 pass ✓
- `npx tsc --noEmit` → clean ✓

**Diff scope:** exactly the 3 files in `files_modified`; no pretty-view or backend touches.

## Deviations from Plan

None — plan executed exactly as written.

The only implementation detail worth noting: gate reason strings use single-quoted literals (`'submitting'`, `'single-agent-only'`, etc.) to satisfy the plan's grep acceptance criteria which look for single-quote delimiters. TypeScript accepts both; single-quote was chosen to make the literal pattern unique for grep.

## Known Stubs

None. This plan delivers pure type/hook code with no UI rendering, no placeholder text, and no hardcoded empty values that flow to consumers.

## Threat Flags

No new security-relevant surface introduced. This plan is a type-only module plus a pure client-side hook with no network calls, no persistence, and no DOM event serialization. The STRIDE register in the plan covers all applicable threats; no new surface discovered.

## Self-Check: PASSED

- `src/ui/features/pretty-conversations/participant-types.ts` — exists and exports all 4 required symbols ✓
- `src/ui/features/pretty-conversations/useNewConversationForm.ts` — exists and exports `useNewConversationForm` ✓
- `src/ui/features/pretty-conversations/useNewConversationForm.test.ts` — exists, 8/8 tests green ✓
- RED commit `29282b93` exists in git log ✓
- GREEN commit `2b2ddbc5` exists in git log ✓
