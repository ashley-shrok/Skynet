---
phase: 260728-m5h-skynet-schema-catchup-for-nellys-pinned-
plan: 01
subsystem: backend-schema + frontend-ui + mobile-css
tags: [schema-migration, bounty, pinned, mobile-css, fleet-alignment]
decisions:
  - "Flipped backend counter predicate from parsed.status==='pinned' to parsed.pinned===true (both local fs and remote python3 branches)"
  - "Dropped 'pinned' from BOUNTY_STATUS_VALUES on both backend (identity-artifact-reader.ts) and frontend (claude-session-api.ts); enum is now 4 values"
  - "Mobile .pv-bounty-badge scaled to ~1.6x via @media (max-width:767.98px) — no !important (fork-owned CSS, no shadcn ancestor competing)"
  - "CLAUDE.md had no stale .status==='pinned' prose; left untouched"
  - "PrettyConversationsPanel.tsx and its test had no .status==='pinned' reads to update"
tech-stack:
  added: []
  patterns:
    - "pinned as independent boolean field orthogonal to lifecycle status"
    - "Mobile-scoped @media block for badge scaling rather than em-unit approach"
key-files:
  created: []
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/backend/claude-session/identity-artifact-reader.count-bounties.test.ts
    - src/backend/claude-session/identity-artifact-reader.write-bounty-status.test.ts
    - src/ui/api/claude-session-api.ts
    - src/ui/features/pretty-view/BountyCard.tsx
    - src/ui/features/pretty-conversations/pretty-conversations.css
metrics:
  duration: ~18min
  completed: "2026-07-28"
  tasks: 2
  files: 7
---

# Quick Task 260728-m5h: Skynet Schema Catchup for Nelly's Pinned Migration

**One-liner:** Backend counter predicate flipped to `parsed.pinned===true`, status enum pruned from 5 to 4 values (dropping `pinned`), mobile `.pv-bounty-badge` bumped ~1.6x, and patch #168 documented inline.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Backend schema catchup + tests | 2b67908 | identity-artifact-reader.ts, claude-session-server.ts, 2 test files |
| 2 | Frontend pill row + mobile badge + inline docs | 2250e3d | claude-session-api.ts, BountyCard.tsx, pretty-conversations.css |

## What Was Done

### Task 1 — Backend schema catchup

- `identity-artifact-reader.ts` line ~1041: predicate changed from `parsed.status === "pinned"` to `parsed.pinned === true` (local fs branch)
- Python3 remote branch: `j.get("status")=="pinned"` → `j.get("pinned") is True`
- Comments at ~L987–L1004 reworded to describe `pinned` as an independent boolean field orthogonal to the lifecycle `status` field
- `BOUNTY_STATUS_VALUES` in `identity-artifact-reader.ts`: removed `"pinned"` (5 → 4 values: `in_progress`, `waiting_on_someone_else`, `done`, `dropped`). Writes with `status:"pinned"` now rejected.
- `claude-session-server.ts` JSDoc at ~L50: updated to list 4 allowed values, reference patch #168
- `count-bounties.test.ts`: fixtures rewritten to `{status, pinned:boolean}` shape; orthogonality test added (`done+pinned:true` counts); absent-field test added; malformed test preserved
- `write-bounty-status.test.ts`: rejection test for `status:"pinned"` added; acceptance loop for all 4 valid statuses added

### Task 2 — Frontend + mobile badge + inline docs

- `claude-session-api.ts`: `BOUNTY_STATUS_VALUES` dropped from 5 to 4 (removed `"pinned"`)
- `BountyCard.tsx`: `STATUS_CLASSES` and `STATUS_LABELS` pruned of `pinned` key; `StatusRow` and inline comments updated to reflect 4-option pill row
- `pretty-conversations.css`: new `@media (max-width: 767.98px)` block for `.pv-bounty-badge` — `font-size: 16px`, `height: 26px`, `padding: 0 8px` (~1.6x desktop); CSS comment documents cascade check result (no `!important` needed — fork-owned CSS, no shadcn ancestor)
- `~/.claude/identities/tina/skynet-patches.md`: header bumped to ONE HUNDRED SIXTY-EIGHT; patch #168 entry added (not committed — identity file outside git)
- `CLAUDE.md`: no stale `.status === "pinned"` prose found; left untouched

## Verification

- `npm run build:backend && npm run build` — PASS
- `npx vitest run count-bounties.test.ts write-bounty-status.test.ts` — 12/12 PASS
- `npx vitest run PrettyConversationsPanel.test.tsx` — 35/35 PASS
- Combined: 47/47 tests pass
- `grep -RIn '\.status\s*===\s*"pinned"' src/backend/claude-session/ src/ui/features/pretty-conversations/` — returns nothing (clean)
- `grep "#168" ~/.claude/identities/tina/skynet-patches.md` — found

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing coverage] `PrettyConversationsPanel.tsx` had no `.status === "pinned"` reads to update**
- Found during: Task 2
- Issue: The plan asked to update `.status === "pinned"` in `PrettyConversationsPanel.tsx` but the file has no such reads — the panel does not access bounty status directly, only the `pinnedCount` from the store (which is correct). The `hasPinnedForRow` helper correctly uses `bountyCounts.get(key) > 0` — no change needed.
- Action: Verified grep confirmed no such reads; left file unchanged.

**2. [Rule 2 - Scope expansion] `BountyCard.tsx` and `claude-session-api.ts` required updates**
- Found during: Task 2
- Issue: `claude-session-api.ts` `BOUNTY_STATUS_VALUES` (frontend) still had `"pinned"` — this is the source the `StatusRow` iterates via `BOUNTY_STATUS_VALUES.map()`. Also `BountyCard.tsx` `STATUS_CLASSES`/`STATUS_LABELS` had the `pinned` key. Both needed to be pruned.
- Fix: Added `claude-session-api.ts` and `BountyCard.tsx` to the commit.

## Known Stubs

None — all bounty count and badge rendering is wired to real data from the backend poller.

## Threat Flags

None — changes are purely subtractive (removing a stale enum value) plus a CSS media query. No new endpoints, auth paths, or trust boundaries introduced.

## Self-Check

Files exist:
- `src/backend/claude-session/identity-artifact-reader.ts` — FOUND (modified)
- `src/ui/features/pretty-conversations/pretty-conversations.css` — FOUND (modified, contains `max-width: 767.98px`)
- `~/.claude/identities/tina/skynet-patches.md` — FOUND (contains `#168`)

Commits:
- 2b67908 — FOUND (task-1 backend schema catchup + tests)
- 2250e3d — FOUND (task-2 frontend + mobile badge + inline docs)

## Self-Check: PASSED
