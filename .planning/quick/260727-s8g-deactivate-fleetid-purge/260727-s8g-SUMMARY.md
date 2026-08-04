---
phase: quick-260727-s8g
plan: 01
subsystem: pretty-conversations
status: complete
tags:
  - bugfix
  - frontend
  - activeSet
  - id-shape-mismatch
requirements:
  - QUICK-S8G-01
tech-stack:
  added: []
  patterns:
    - "parseInt(host.id, 10) bridge for string→number seam (matches store's own dedupKey call at L296)"
key-files:
  created: []
  modified:
    - src/ui/state/conversation-store.ts
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
    - /home/ubuntu/.claude/identities/tina/skynet-patches.md
commits:
  - cb9b5b1 fix(pretty-conversations): purge both id shapes on row deactivate
  - 84cfc06 test(pretty-conversations): assert deactivate purges both id shapes (20F/20G)
decisions:
  - "handleRowDeactivate purges BOTH id shapes (openTab id + fleet-synthetic id) so state.activeSet never re-promotes a deactivated fleet-derived row on the next computeSnapshot."
  - "fleetRowId exported as a single source of truth; Panel imports it rather than duplicating the fleet:: format string — matches store L275-278's already-present comment that anticipated external callers."
  - "parseInt(row.host.id, 10) at the call site (Host.id is string; fleetRowId takes number) — matches the store's own bridge at computeSnapshot L296."
  - "Task 3 (docs) not git-committed — file lives at ~/.claude/identities/tina/skynet-patches.md, outside the fork and NOT a git repo per hard-rule directive."
metrics:
  duration: 12min
  completed: 2026-07-27
  tasks_completed: 3
  files_modified: 4
---

# quick-260727-s8g Plan 01: activeSet id-shape purge on deactivate — Summary

Fix activeSet id-shape mismatch: ambient fleet-row tap + deactivate no longer re-promotes the row to Tier 1 with `.active-set` glow on the next computeSnapshot. Panel's `handleRowDeactivate` now purges both `row.id` (openTab id shape) AND `fleetRowId(hostId, sessionName)` (fleet-synthetic id shape) when the row carries host + targetTmuxSession.

## Tasks Completed

### Task 1: Export fleetRowId + double-purge in handleRowDeactivate — cb9b5b1

- **conversation-store.ts:279** — `function fleetRowId` → `export function fleetRowId` (zero behavior change; two existing computeSnapshot call sites at L318 and L542 continue to work verbatim).
- **PrettyConversationsPanel.tsx:46-59** — extended named-import block to also import `fleetRowId`.
- **PrettyConversationsPanel.tsx:302-330** — `handleRowDeactivate` now calls `removeFromActiveSet(row.id)`, THEN (if `row.host && row.targetTmuxSession`) `removeFromActiveSet(fleetRowId(parseInt(row.host.id, 10), row.targetTmuxSession))`, THEN `onDeactivateRow(row)`. Extended comment block documents the id-shape-mismatch class of bug, references the queued #149 followup-1 pin-nuke as the same class scoped to `pinnedIds`, and preserves the existing "Order matters" note.
- Verification: `npx tsc --noEmit` exit 0.

### Task 2: Test 20F (double-purge) + Test 20G (single-purge no-crash) — 84cfc06

- **Test 20F** — fixture: `host={id: "3", name: "thenasty"}, targetTmuxSession: "shrok", row.id: "active-1"`; asserts `removeFromActiveSetSpy` called TWICE, nth(1) with `"active-1"`, nth(2) with `"fleet::3::shrok"`, plus `onDeactivateRow` called once with the row.
- **Test 20G** — fixture uses `targetTmuxSession: null` (with a valid host — see Deviations below); asserts `removeFromActiveSetSpy` called EXACTLY ONCE with `"active-2"`, no call contains `"fleet::"`, no throw, `onDeactivateRow` called once.
- Additive-only inside the existing `describe("PrettyConversationsPanel: deactivate action (quick-260727-gm3)")` block; Test 20E untouched.
- Also added a `fleetRowId` entry to the `vi.mock("@/state/conversation-store")` map — without it the Panel's new named import would resolve to `undefined` at test-time and Test 20F would crash. This is a Rule 3 auto-fix (blocking issue) — tracked in Deviations below.
- Verification: `npm test -- src/ui/features/pretty-conversations/PrettyConversationsPanel.test` → **30 passed** (28 pre-existing + 2 new). Test 20E, 20F, 20G all green.

### Task 3: Document fix in skynet-patches.md — NOT git-committed (per hard rule)

- Header count bumped: L17 `ONE HUNDRED FIFTY-FOUR` → `ONE HUNDRED FIFTY-SEVEN` (true max was #156, new max is #157).
- New `### Patch #157 — activeSet id-shape purge on deactivate (quick-260727-s8g)` entry appended after Patch #156.
- Entry contains all required sections: Motivation, Root cause (5-step sequence), Fix (per-file), Files touched, Rebase risk (LOW), Verification.
- Patch drift caveat at ~L6652: PrettyConversationsPanel.tsx already listed in later patch entries (#133, #137, etc.) so no drift-list update needed.
- **No git operation performed** — file lives at `~/.claude/identities/tina/skynet-patches.md` (outside the fork; that directory is NOT a git repo per the hard-rule directive).

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `npx tsc --noEmit` | exit 0 (clean) |
| Test suite | `npm test -- src/ui/features/pretty-conversations/PrettyConversationsPanel.test` | 30 passed / 30 |
| Export present | `grep '^export function fleetRowId' src/ui/state/conversation-store.ts` | 1 match at L279 |
| Sibling purge present | `grep 'fleetRowId(parseInt(row.host.id' src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | 1 match at L321 |
| Docs entry present | `grep -c 'quick-260727-s8g\|activeSet id-shape purge' skynet-patches.md` | 3 matches |
| Docs header bumped | `grep -n 'ONE HUNDRED FIFTY-SEVEN' skynet-patches.md` | L17 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] parseInt bridge for string→number seam at call site**

- **Found during:** Task 1 (implementation)
- **Issue:** Plan template `fleetRowId(row.host.id, row.targetTmuxSession)` would fail typecheck: `Host.id: string` but `fleetRowId(hostId: number, ...)` — the two existing call sites in the store use `session.hostId` from `FleetSession.hostId: number`, which fits without conversion. The Panel doesn't have that type coming in.
- **Fix:** Wrote `fleetRowId(parseInt(row.host.id, 10), row.targetTmuxSession)` at the call site. Matches the store's own bridge at `computeSnapshot` L296 (`dedupKey(String(parseInt(tab.host.id)), tmux)`) — same string↔number seam, same handling. Test 20F's fixture is `host.id: "3"` and asserts on `"fleet::3::shrok"`; `parseInt("3", 10) === 3` produces exactly that.
- **Files modified:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
- **Commit:** cb9b5b1

**2. [Rule 3 - Blocking] Added `fleetRowId` to the conversation-store vi.mock map**

- **Found during:** Task 2 (test authoring)
- **Issue:** The test file mocks `@/state/conversation-store` (L138-165) and only exposes the specific symbols the Panel imports. The Panel's new `fleetRowId` import would resolve to `undefined` inside `handleRowDeactivate` at test-time → Test 20F would crash on `undefined is not a function`.
- **Fix:** Added `fleetRowId: (hostId, sessionName) => `fleet::${hostId}::${sessionName}`` to the mock map so the format matches the real helper verbatim. Test 20F's `toHaveBeenNthCalledWith(2, "fleet::3::shrok")` assertion now has a value to match against.
- **Files modified:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`
- **Commit:** 84cfc06

**3. [Plan-compliant fallback] Test 20G uses `targetTmuxSession: null` instead of `host: null`**

- **Found during:** Task 2 (test authoring)
- **Issue:** The plan's Test 20G template suggests `host: null` OR `targetTmuxSession: null` — pick whichever the type system accepts. `MockRow.host` is typed `Host | undefined` (not nullable), so `host: null` would fail typecheck. `ConversationRow.host` in the real store is also `Host | undefined`.
- **Fix:** Used a valid host (`makeHost("h1", "hostA")`) with `targetTmuxSession: null`. Same short-circuit branch of `if (row.host && row.targetTmuxSession)` — the guard's `&&` fails on the null tmux side, skipping the fleet-id purge. Assertion is unchanged: exactly one `removeFromActiveSet` call with `row.id`, no `"fleet::"` substring anywhere.
- **Files modified:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`
- **Commit:** 84cfc06

**4. [Hard-rule compliance] Task 3 docs commit skipped (file lives outside the fork)**

- **Found during:** Task 3
- **Issue:** Plan's action step included a `git add / git commit` for `skynet-patches.md`. Hard rule states that file lives at `~/.claude/identities/tina/skynet-patches.md`, that directory is NOT a git repo, and the Task 3 "commit" step is a no-op.
- **Action:** Wrote the file only. No git operation. Header count bumped and new entry appended.
- **Files modified:** `/home/ubuntu/.claude/identities/tina/skynet-patches.md` (outside fork)

## Ship Status

- **Branch:** `feat/tab-title-from-tmux` (not pushed).
- **Commits made:** 2 (code + test).
- **Docker:** not rebuilt.
- **Deploy:** not performed.
- Awaits Ashley's explicit ship signal per the quick-260727-s8g plan directive.

## Self-Check: PASSED

- Files verified present:
  - `src/ui/state/conversation-store.ts` (export at L279) — FOUND
  - `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (sibling purge at L321) — FOUND
  - `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` (Tests 20F+20G present) — FOUND
  - `/home/ubuntu/.claude/identities/tina/skynet-patches.md` (Patch #157 at L10747) — FOUND
- Commits verified in `git log --oneline -5`:
  - `cb9b5b1` — FOUND (Task 1 code)
  - `84cfc06` — FOUND (Task 2 tests)
