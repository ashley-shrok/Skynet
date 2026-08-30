---
phase: quick-260807-e4s
plan: 01
subsystem: pretty-conversations / conversation-store id-shape alignment
tags: [bugfix, ui, pinned-tier, id-shape-mismatch, patch-149-followup]
requires: []
provides: [E4S-01]
affects:
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
tech-stack:
  added: []
  patterns:
    - "Panel-side isRowPinned(row) mirrors the store's Tier 2 shadow-fleet-id pinned computation (conversation-store.ts:493-499)"
key-files:
  created:
    - path: .planning/quick/260807-e4s-fix-active-set-context-menu-shows-pin-in/260807-e4s-SUMMARY.md
      purpose: This summary
  modified:
    - path: src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
      change: "Added isRowPinned(row) helper (fleet-shadow-id fallback mirroring conversation-store.ts:493-499); rewired the two active-set-tier `pinned=` prop callsites to use it. Hardcoded `pinned={true}` (pinned tier) and `pinned={false}` (RDP sentinel + hidden section) untouched."
    - path: src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
      change: "Added Test E4S-01 regression under a new describe block. Pins a row under only the fleet-shadow id (`fleet::1::alpha`), NOT the openTab id (`active-alpha`); asserts the right-click context menu shows Unpin, not Pin."
decisions:
  - "Helper is a plain function closed over `pinnedIds` (not memoized). The panel already re-renders on `pinnedIds` change via `usePinnedIds`, and the helper is O(1) hash lookup — memoization would add complexity without behavior change."
  - "Anchored regexes (`/^unpin$/i`, `/^pin$/i`) chosen for the assertions so the Unpin match cannot be satisfied by the presence of Pin as a substring. The label toggle at PrettyConversationRow.tsx:587 emits exactly one of the two, so anchoring guarantees the test discriminates the states."
  - "Historical comment at PrettyConversationsPanel.tsx:657 (which references this exact followup) left in place — future readers should still see the original bug note as posted."
metrics:
  duration_min: ~35
  completed: 2026-08-07
---

# Quick Task 260807-e4s: Fix active-set context menu shows Pin when it should show Unpin (fleet-shadow-id) Summary

Panel-side follow-up to patch #149. Active-set + grouped-host rows whose pin was persisted under the fleet-synthetic id shape (`fleet::HOSTID::SESSIONNAME`) now correctly render "Unpin" instead of "Pin" in the right-click context menu — one shared `isRowPinned(row)` helper mirrors the store's Tier 2 shadow-fleet-id computation at both panel-side render sites.

## What Was Built

### `isRowPinned(row)` helper — PrettyConversationsPanel.tsx

- Location: inside `PrettyConversationsPanel`, immediately after `handleRowClone` (grouped with the other row-oriented helpers).
- Signature: `(row: ConversationRowShape) => boolean`.
- Body:
  1. Compute `shadowFleetId = fleetRowId(parseInt(row.host.id, 10), row.targetTmuxSession)` iff both `row.host` and `row.targetTmuxSession` are truthy; else `null`.
  2. Return `pinnedIds.has(row.id) || (shadowFleetId !== null && pinnedIds.has(shadowFleetId))`.
- Shape is byte-identical to `conversation-store.ts:493-499` (the Tier 2 pinned computation).
- Import of `fleetRowId` from `@/state/conversation-store` was ALREADY in the destructured import at line 66 — no import churn.

### Two rewired callsites

- `PrettyConversationsPanel.tsx` active-set map (was line ~901, now line 916): `pinned={pinnedIds.has(row.id)}` → `pinned={isRowPinned(row)}`.
- `PrettyConversationsPanel.tsx` grouped host bucket map (was line ~1057, now line 1072): `pinned={pinnedIds.has(row.id)}` → `pinned={isRowPinned(row)}`.

### Three hardcoded sites left untouched (invariant)

- Pinned tier `pinned={true}` (line ~956).
- RDP sentinel `pinned={false}` (line ~1010).
- Hidden section `pinned={false}` (line ~1116).

### Regression Test E4S-01 — PrettyConversationsPanel.test.tsx

- New `describe("PrettyConversationsPanel: active-set fleet-shadow-id pinned recognition (quick-260807-e4s)", ...)` block placed immediately after the `deactivate action (quick-260727-gm3)` describe (line 1100 close) and before the `RDP sentinel at bottom` describe.
- Fixture: `hostA = makeHost("1", "hostA")`; `activeRow = makeConversationRow({ id: "active-alpha", label: "alpha", host: hostA, targetTmuxSession: "alpha" })`; `pinnedIds: new Set(["fleet::1::alpha"])` (ONLY the fleet-shadow id, NOT the openTab id); `mockActiveSet = new Set(["active-alpha"])`.
- Assertion: right-clicking the row's `[role="button"]` opens the portal menu; `within(menu).getByRole("menuitem", { name: /^unpin$/i })` succeeds; `within(menu).queryByRole("menuitem", { name: /^pin$/i })` returns null.
- No new mocks introduced — reused `vi.mock("@/state/conversation-store", ...)`'s existing `usePinnedIds` (reads `snapshot.pinnedIds`) and `fleetRowId` (returns `` `fleet::${hostId}::${sessionName}` ``).

## Verification Results

**Backend build (`NODE_OPTIONS="--max-old-space-size=4096" npm run build:backend`):** EXIT 0.
**Frontend build (`NODE_OPTIONS="--max-old-space-size=4096" npm run build`):** EXIT 0 in 25.74s.
**Targeted test (`npx vitest run PrettyConversationsPanel.test.tsx -t "Test E4S-01"`):** 1 passed / 54 skipped in the file.
**Whole panel test file (`npx vitest run PrettyConversationsPanel.test.tsx`):** 55/55 passed.
**Full suite (`npx vitest run`):** **1520 passed / 6 skipped / 0 failed across 123 files** (+1 file was not added; +1 test net vs prior baseline 1519/6/123 — exact match to Test E4S-01, zero regressions). Duration 1205s (~20 min end-to-end).

Fleet rule "never leave tests failing" honored.

## Deviations from Plan

### Environmental Deviations

**1. [Rule 3 - Blocking Env] tsc heap OOM under default Node heap**
- **Found during:** Task 1 verify (`npm run build:backend`).
- **Issue:** `tsc -p tsconfig.node.json` OOMed at 253 MB heap on this box (`Ineffective mark-compacts near heap limit`).
- **Fix:** Retried with `NODE_OPTIONS="--max-old-space-size=4096"` — clean EXIT 0. Applied the same env override to `npm run build` and the full-suite `npx vitest run` (used 6144 for the suite) so all downstream gates could complete.
- **Files modified:** None (env-only, does not touch code / scripts / package.json).
- **Commit:** N/A (env-only workaround, not committed — this is a per-invocation `NODE_OPTIONS` prefix, not a config change).

No other deviations. Plan executed as written otherwise.

## Auth Gates

None encountered.

## Known Stubs

None. The fix is complete; both formerly-buggy callsites now flow through `isRowPinned(row)`.

## Commits

- `aadef05` — `fix(pretty-conversations): recognize fleet-shadow-id pins at active-set + grouped render sites (quick-260807-e4s)` — 2 files changed, 59 insertions(+), 2 deletions(-).

## Deploy Posture

NOT pushed / NOT built into a container / NOT deployed. Direct commit on `feat/tab-title-from-tmux` in the main working tree (no worktree, per fleet rule "NO git worktrees under any circumstance" — Ashley 2026-07-31, and per this quick task's constraints). Ship handshake and deploy authorization are the orchestrator's (tiffany's) call.

## Self-Check: PASSED

- Files exist:
  - `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — FOUND (isRowPinned at line 722; callsites at 916 and 1072).
  - `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — FOUND (describe block added with Test E4S-01).
- Commit exists:
  - `aadef05` — FOUND on `feat/tab-title-from-tmux` (verified via `git log -1 --pretty=%s`).
- Working tree: clean modulo `.planning/quick/260807-e4s-fix-active-set-context-menu-shows-pin-in/` (untracked docs dir — orchestrator's scope, explicitly excluded by task constraints).
