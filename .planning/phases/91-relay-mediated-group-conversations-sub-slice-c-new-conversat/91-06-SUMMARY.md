---
phase: 91-relay-mediated-group-conversations-sub-slice-c-new-conversat
plan: "06"
subsystem: pretty-conversations / new-conversation-modal-flow
tags:
  - integration-test
  - user-flow
  - regression-coverage
  - tdd
  - slice-c
dependency_graph:
  requires:
    - 91-00 (participant-types.ts)
    - 91-01 (useNewConversationForm)
    - 91-02 (ParticipantList, ParticipantChipStrip, ParticipantSearchInput)
    - 91-03 (relay-room-create route)
    - 91-04 (relay-room-create-api.ts frontend client)
    - 91-05 (NewConversationModal, PrettyConversationsPanel wiring)
  provides:
    - shape-91-in-process-flow-coverage
    - shape-91-materialization-integration
  affects: []
tech_stack:
  added: []
  patterns:
    - vitest + @testing-library/react flow-level test (renders full panel, drives user interactions)
    - vi.mock at module boundary for all seams (relay-room-create-api, user-management-api, identities-store, viewing-user-store)
    - beforeEach vi.clearAllMocks + mock re-arm pattern (T-91-06-D1 state-leak mitigation)
key_files:
  created:
    - src/ui/features/pretty-conversations/NewConversationModal.flow.test.tsx
  modified: []
decisions:
  - Used `vi.fn()` mockReturnValue pattern for viewing-user-store instead of module-level factory to support per-test override in Test 6 and error scenarios
  - Rendered PrettyConversationsPanel (not NewConversationModal directly) so Test 1 covers the full chain including menu-click → modal-open → form → API → callback
  - Used `within(dialog)` for picker interactions to scope clicks to the modal content, avoiding false positives from other panel elements
  - Test 8 search filter: used `role="searchbox"` (matches `<input type="search">` in ParticipantSearchInput) rather than placeholder text for resilience
metrics:
  duration: "3 minutes"
  completed: "2026-09-09T12:07:00Z"
  tasks_completed: 1
  files_created: 1
---

# Phase 91 Plan 06: NewConversationModal Flow Test Summary

## One-liner

8-scenario flow-level integration test driving complete Slice C user flow through mocked API + store seams: menu click → modal → pick + name → Create → callback, plus debounce, gate, self-exclude, error-surface, and search-filter coverage.

## What Was Built

A single new test file: `src/ui/features/pretty-conversations/NewConversationModal.flow.test.tsx`

The file renders `PrettyConversationsPanel` with `onCreateSession` and `onCreateRelayRoom` wired, then drives interactions through the full UI chain. All 8 test scenarios pass in ~1.35s under vitest + jsdom.

### Test Scenarios Covered

| Test | Scenario | Key Assertion |
|------|----------|---------------|
| 1 | Happy path full flow | `createRelayRoom` called once with `{ roomName, humanMxids: ['@bob:s'], agentMxids: ['@nelly:s'] }`; `onCreateRelayRoom` receives response; modal closes |
| 2 | Double-click debounce (T-91-FE-01) | Two rapid clicks → `createRelayRoom` called EXACTLY ONCE |
| 3 | Single-agent-only disable | Create button disabled; hint matches `/agent|single/` |
| 4 | Zero-participant disable | Create button disabled; hint mentions "participant" |
| 5 | Blank-name disable | Create button disabled; hint mentions "name" |
| 6 | Self-exclude | `@alice:s` (viewing user) absent from Humans picker; only Bob visible |
| 7 | Backend-error surface | Modal stays open; error `[role="alert"]` shows "room_name_required"; button re-enabled; retry (re-primed mock) closes modal |
| 8 | Search filter narrows | Typing "B" → Bob visible; Humans section header shows N-of-M count format |

### Mock Seams Established

| Mock | Purpose |
|------|---------|
| `vi.mock('@/api/relay-room-create-api')` | Acceptance criterion + spy for call-count/args assertions |
| `vi.mock('@/api/user-management-api')` | Alice + Bob as BasicUser fixtures; per-test `mockResolvedValue` override |
| `vi.mock('@/state/identities-store')` | Nelly as agent fixture via mutable `mockIdentities` array |
| `vi.mock('@/state/viewing-user-store')` | `@alice:s` as viewer; drives self-exclude + serverName extraction |

## Acceptance Criteria Verification

- `grep -c 'describe("NewConversationModal'` == **1** ✓
- `grep -c "vi.mock.*relay-room-create-api"` == **1** ✓
- `grep -c "vi.mock.*user-management-api"` == **1** ✓
- `grep -c "vi.mock.*identities-store"` == **1** ✓
- `grep -c "onCreateRelayRoom"` >= **2** (actual: 12) ✓
- `grep -c "createRelayRoom"` >= **2** (actual: 14) ✓
- All 8 tests pass under `npx vitest run NewConversationModal.flow.test.tsx` ✓
- Test execution time: **1.35s** (under 5s) ✓
- Zero source-code changes: `git diff --name-only HEAD~1 HEAD -- src/ | grep -v NewConversationModal.flow.test.tsx | wc -l` == **0** ✓
- `npx tsc --noEmit` clean ✓

## Deviations from Plan

None — plan executed exactly as written.

The test file follows the PATTERNS.md § User-Flow Test Pattern and § Test-file structure. Mocks were declared before component imports per vitest hoisting requirements. `beforeEach` clears all mocks and re-arms defaults (T-91-06-D1 state-leak mitigation). `afterEach` calls `cleanup()` per testing-library discipline.

## Threat Surface Scan

No new production code was added. This plan is test-code-only. No new network endpoints, auth paths, file access patterns, or schema changes were introduced. No threat flags.

## Known Stubs

None. The test file is pure assertion code with no stubs that block the plan's goal.

## Self-Check: PASSED

- File exists: `src/ui/features/pretty-conversations/NewConversationModal.flow.test.tsx` ✓
- Commit exists: `a638e1ea` ✓
- All 8 tests pass ✓
- Zero source changes ✓
- TypeScript clean ✓
