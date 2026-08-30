---
quick_id: 260730-jes
phase: quick
plan: 260730-jes
type: execute
subsystem: frontend/tab-management
tags: [startTransition, react-18, performance, deactivate, pretty-conversations]
key_files:
  created: []
  modified:
    - src/ui/AppShell.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
decisions:
  - "Used numeric host id '7' in Test 20H fixture so parseInt(host.id, 10) resolves cleanly, matching the real fleetRowId call shape (mirror of Test 20F pattern)"
  - "Placed startTransition block comment with 'Patch #TBD' as instructed — Tina assigns patch number at ingestion"
  - "Used invocationCallOrder for ordering assertion (no jest-extended in project; matches fallback pattern specified in plan)"
completed: 2026-07-30
duration_minutes: 10
commits:
  - hash: 8ceffca
    message: "feat(260730-jes): wrap doCloseTab state mutations in startTransition"
  - hash: 7ed9fe5
    message: "test(260730-jes): add ordering-contract test for handleRowDeactivate (bounty #5)"
---

# Quick 260730-jes: Make Deactivating an Active Conversation Feel Instant — Summary

**One-liner:** React 18 `startTransition` wraps four `doCloseTab` state mutations so the urgent Zustand `removeFromActiveSet` list paint commits first (~0 ms), then the heavy PrettyView mount commits deferred, eliminating the ~1s freeze on Deactivate tap.

## What Was Done

### Task 1 — Wrap doCloseTab state mutations in startTransition (`src/ui/AppShell.tsx`)

- **Line 7:** Extended the React named import to include `startTransition` (first use in codebase). Import line is now: `import { useState, useRef, useCallback, useEffect, useMemo, createRef, startTransition } from "react";`
- **`doCloseTab` body (~line 1144):** Reshaped so the synchronous prelude runs first (unchanged):
  - `tabs.find(...)` — reads render-time closure
  - `deleteOpenTab(...).catch(() => {})` — fire-and-forget backend cleanup
  - `terminalRefs.current.delete(id)` — Map mutation, not React state
- **Then** a single `startTransition(() => { ... })` callback wraps all four state mutations:
  - `remaining` / `nextId` computation + `setActiveTabId(nextId)`
  - `selectConversation(nextId === "dashboard" ? null : nextId)` (with patch #180 comment preserved)
  - `setPaneTabIds((prev) => prev.map(...))`
  - `setTabs((prev) => { ... })`
- **Block comment** (6 lines) above `startTransition(...)` documents: WHY (PrettyView mount was blocking paint), WHAT (transition lets urgent Zustand commit paint first), TRADE-OFF (right pane may briefly show just-deactivated view), and a hard DO-NOT-REVERT warning. References Patch #TBD / bounty #5.

**Diff size:** 42 lines added, 27 lines removed (net +15).

### Task 2 — Add ordering-contract test (`src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`)

- **Test 20H** added at the end of the existing `describe("PrettyConversationsPanel: deactivate action (quick-260727-gm3)", ...)` block (after Test 20G).
- Uses a fleet-derived fixture row (host id `"7"`, tmuxSession `"ordering-session"`) so both `removeFromActiveSet` calls fire — the row.id purge AND the fleet::7::ordering-session purge.
- Asserts:
  - `removeFromActiveSetSpy` called twice: `toHaveBeenNthCalledWith(1, "active-h")` and `toHaveBeenNthCalledWith(2, "fleet::7::ordering-session")`
  - `onDeactivateRow` called with the full row object
  - Ordering: `removeFromActiveSetSpy.mock.invocationCallOrder[0] < onDeactivateRow.mock.invocationCallOrder[0]`
- 3-line comment above the `it(...)` block references bounty #5 and explains why the order matters for the startTransition split.

**Diff size:** 55 lines added, 0 lines removed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed NaN in fleet id from non-numeric host id in Test 20H fixture**
- **Found during:** Task 2 verification (first vitest run)
- **Issue:** Initial fixture used `makeHost("h1", "hostA")` — `parseInt("h1", 10)` returns `NaN`, so `fleetRowId` produced `"fleet::NaN::ordering-session"`, failing the assertion
- **Fix:** Changed fixture host id to `"7"` (numeric string, same pattern as Test 20F which uses `"3"`), updated the expected fleet key to `"fleet::7::ordering-session"`
- **Files modified:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`
- **Commit:** 7ed9fe5 (fix applied before commit)

## Verification Output

```
npx tsc --noEmit
  → exit 0 (no output, no type regressions)

npx vitest run src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
  → 38 passed (38 tests — 37 pre-existing + 1 new Test 20H)

npx vitest run src/ui/state/conversation-store.test.ts src/ui/AppShell.persistence.test.tsx
  → 66 passed

npx vitest run (full suite)
  → 73 test files, 801 passed | 6 skipped — 0 failures
```

## Files Touched

| File | Lines Added | Lines Removed | Range Modified |
|------|-------------|---------------|----------------|
| `src/ui/AppShell.tsx` | 42 | 27 | Line 7 (import), ~1153–1194 (doCloseTab body) |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` | 55 | 0 | ~957–1011 (new Test 20H + comment) |

## Commits

- `8ceffca` — `feat(260730-jes): wrap doCloseTab state mutations in startTransition`
- `7ed9fe5` — `test(260730-jes): add ordering-contract test for handleRowDeactivate (bounty #5)`

## Constraints Honored

NO push, NO build (`npm run build`), NO `npm run build:backend`), NO deploy per quick-task constraints. Tina bundles this with the pinned-slate batch when Ashley greenlights ship.

Exactly 2 files modified. No identity-side files (~/.claude/identities/tina/**, skynet-patches.md, tina.md, bounties) touched. Remained on branch `feat/tab-title-from-tmux` — no new branch created.

## Self-Check

- [x] `src/ui/AppShell.tsx` exists and contains `startTransition`
- [x] `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` exists and contains `Test 20H`
- [x] Commit `8ceffca` exists in git log
- [x] Commit `7ed9fe5` exists in git log
- [x] Full vitest suite green (801 passed, 0 failed)
- [x] tsc exits 0

## Self-Check: PASSED
