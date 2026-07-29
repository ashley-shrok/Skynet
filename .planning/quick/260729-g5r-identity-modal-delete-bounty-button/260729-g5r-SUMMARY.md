---
phase: 260729-g5r
plan: 01
subsystem: identity-artifacts
one_liner: "Permanent-delete button on identity-modal bounty cards — rm -rf writer + WS handler pair + destructive UI (patch #183)"
tags: [identity-modal, bounties, delete, patch-183]
dependency_graph:
  requires:
    - archiveIdentityBounty (byte-shape template from quick 260727-wd0 / patch #175)
    - readIdentityBounties + normalizeBounty (fresh-list refresh contract)
    - sendIdentityMutation + invalidateBountyCount (existing WS mutation plumbing)
    - IDENTITY_KEY_RE + IDENTITY_SLUG_RE (existing validation regexes)
  provides:
    - deleteIdentityBounty(conn, identityKey, bountySlug): Promise<void>
    - IdentityDeleteBountyPayload + IdentityBountyDeletedEvent types
    - identity:delete-bounty WS request / identity:bounty-deleted WS response
    - BountyCard onDelete prop + destructive Delete button + window.confirm gate
  affects:
    - IdentityModal.tsx Bounties tab (Delete button now visible on all bounty cards)
tech_stack:
  added: []
  patterns: [byte-shape-mirror, tmp-and-rename-N/A-plain-rm, slug-regex-top-guard]
key_files:
  created:
    - src/backend/claude-session/identity-artifact-reader.delete-bounty.test.ts
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/api/claude-session-api.ts
    - src/ui/features/pretty-view/IdentityModal.tsx
    - src/ui/features/pretty-view/BountyCard.tsx
decisions:
  - "D-1 (locked in plan): single fs.rm-both-paths code path rather than lookup-then-rm — force:true makes the non-matching call a no-op, so open+archived delete collapse to one branch."
  - "D-2 (locked in plan): onDelete threaded to BOTH open and archived render sites (unlike onArchive which is withheld from archived). Permanent delete applies regardless of location."
  - "D-3 (locked in plan): window.confirm() Cancel is a strict no-op — no state touch, no WS call. Gate lives at the click surface inside BountyCard, not at the API-call layer."
  - "Pattern fix: IDENTITY_SLUG_RE guard placed at the TOP of deleteIdentityBounty (before local/remote branch split) — fixes the drift in archiveIdentityBounty where the guard only runs on the remote branch. Per strict scope we did NOT retrofit that fix into archiveIdentityBounty itself; the new function just does it right."
metrics:
  duration_minutes: 8
  completed_date: "2026-07-29"
  tasks_completed: 3
  files_changed: 5 (4 modified + 1 created)
  test_cases_added: 3
---

# Quick 260729-g5r: Identity-Modal Delete-Bounty Button Summary

## One-liner

Adds a permanent-delete button (rm -rf, no undo) to bounty cards in the identity modal's Bounties tab, threaded to BOTH open and archived cards — sibling of the archive button on the destructive axis. Landed as patch #183.

## What Shipped

### Backend

- **`deleteIdentityBounty(conn, identityKey, bountySlug): Promise<void>`** in `src/backend/claude-session/identity-artifact-reader.ts`, immediately below `archiveIdentityBounty`. Two-branch structure:
  - **Local** (`conn === null`): resolves both candidate paths (`bounties/<slug>/` and `bounties/archive/<slug>/`) and calls `fs.rm(dir, {recursive:true, force:true})` on each in sequence. `force:true` makes the non-matching path a no-op, so a single code path handles both open and archived deletes.
  - **Remote** (`conn !== null`): python3 script using `shutil.rmtree(..., ignore_errors=True)` on both candidate paths. Direct interpolation of `identityKey` (validated by `IDENTITY_KEY_RE` at handler layer) + `bountySlug` (guarded at top of this function) — same convention as the rest of the file.
- **`IDENTITY_SLUG_RE.test(bountySlug)` guard at the TOP of the function** (before local/remote branch split) — fires regardless of branch. Pattern fix vs. `archiveIdentityBounty` where the guard only runs on the remote branch. Per strict scope the archive function was NOT retrofitted.

### WS handler

- **`identity:delete-bounty` → `identity:bounty-deleted`** WS handler pair in `src/backend/claude-session/claude-session-server.ts`, immediately below the archive-bounty handler. Byte-shape mirror: same `IDENTITY_KEY_RE`/`IDENTITY_SLUG_RE` guards, same `hostId` → local-vs-remote routing, same `readIdentityBounties` refresh + `{bounties, archivedBounties}` payload, same `try/catch/finally` for connection cleanup. Log ops: `identity_delete_bounty` / `identity_delete_bounty_error`.
- **JSDoc entries** for both the request and response added alongside the existing archive-bounty pair at the top of `claude-session-server.ts`.

### Frontend types

- **`IdentityDeleteBountyPayload`** + **`IdentityBountyDeletedEvent`** in `src/ui/api/claude-session-api.ts`, immediately below the archive pair. Same field shapes. `IdentityBountyDeletedEvent` added to the exported WS-event union.

### IdentityModal.tsx

- **`deleteBounty(bountySlug)`** handler immediately below `archiveBounty` (byte-shape mirror). Uses `sendIdentityMutation<IdentityDeleteBountyPayload, IdentityBountyDeletedEvent>`, throws on `res.error`, calls `setBounties` + `setArchivedBounties` + `void invalidateBountyCount`.
- **`onDelete={() => deleteBounty(b.slug)}` threaded at BOTH BountyCard render sites**:
  - Open partitions loop (right after the existing `onArchive` prop).
  - Archived accordion (contrast with `onArchive` which is withheld). Comment on that site expanded to document the intentional archive-vs-delete asymmetry.

### BountyCard.tsx

- **`onDelete?: () => Promise<void>`** optional prop (JSDoc explains the "both open AND archived" contrast with `onArchive`).
- **`savingDelete`** + **`deleteError`** state (mirror of `savingArchive`/`archiveError`).
- **`handleDelete()`** handler: `window.confirm(\`Delete bounty "${bounty.title}"? This cannot be undone.\`)` gates at the top — Cancel returns immediately with no state touch, no `onDelete` call. On OK, byte-shape mirror of `handleArchive`'s try/catch/finally.
- **Delete Button JSX** immediately below the Archive button block (still gated on `{onDelete && (...)}`). Style: `Button variant="outline" size="sm"` with `text-rose-400 hover:text-rose-300 border-rose-400/40 hover:border-rose-400/60` — destructive rose palette per the locked design. Text: "Delete" (or "Deleting…" while pending). `aria-label={\`Delete bounty: ${bounty.title}\`}`.

## Verification

- **Backend unit tests** (`npx vitest run src/backend/claude-session/identity-artifact-reader.delete-bounty.test.ts`): **3/3 pass** — open delete, archived delete, invalid-slug reject-without-touching-disk.
- **Adjacent reader regression sweep** (`npx vitest run src/backend/claude-session/identity-artifact-reader`): **5 files / 23/23 tests pass** — archive/status/priority/pin tests all still green.
- **Full-repo typecheck** (`npm run build:backend && npm run build`): both **green**.

## Deviations from Plan

None — plan executed exactly as written. The three atomic commits map 1:1 to the three tasks. Strict scope respected:
- Did NOT retrofit the `IDENTITY_SLUG_RE`-top-guard fix into `archiveIdentityBounty` (per instruction: "just do it right in the new function").
- No new dependencies.
- No nginx changes (WS handler piggybacks on existing `/ws/claude-session` endpoint).
- No changes to `sortedArchive`, accordion collapse behavior, priority/status/pin editors, or expanded-body ordering.
- Auto-mode was NOT active for this task, but no checkpoints were reached either — the plan is fully autonomous.

## Auth Gates

None encountered.

## Manual Smoke Plan (post-deploy — NOT part of this quick's verify)

1. Open identity modal → Bounties tab.
2. Expand any open bounty card. Confirm: Archive button is visible AND a rose-tinted "Delete" button sits below it.
3. Click Delete → browser-native confirm dialog appears with the bounty's title. Click Cancel → nothing happens (no WS activity, no state change). Click Delete → confirm → click OK → card unmounts. Close modal, reopen, confirm the bounty is not in either list.
4. Expand the Archive accordion at the bottom of the Bounties tab. Confirm: archived bounty cards have a standalone Delete button (no Archive button). Repeat step 3 for an archived card.

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | `cd1a27f` | patch: identity:delete-bounty backend — rm -rf writer + WS handler (#183) |
| 2 | `f238217` | patch: identity:delete-bounty frontend types + IdentityModal wiring (#183) |
| 3 | `01996ab` | patch: BountyCard destructive Delete button with confirm gate (#183) |

Branch: `feat/tab-title-from-tmux`. No push, no deploy (per constraints).

## Self-Check: PASSED

- src/backend/claude-session/identity-artifact-reader.ts — FOUND (modified)
- src/backend/claude-session/identity-artifact-reader.delete-bounty.test.ts — FOUND (created, 3/3 tests pass)
- src/backend/claude-session/claude-session-server.ts — FOUND (modified)
- src/ui/api/claude-session-api.ts — FOUND (modified)
- src/ui/features/pretty-view/IdentityModal.tsx — FOUND (modified)
- src/ui/features/pretty-view/BountyCard.tsx — FOUND (modified)
- Commit cd1a27f — FOUND on feat/tab-title-from-tmux
- Commit f238217 — FOUND on feat/tab-title-from-tmux
- Commit 01996ab — FOUND on feat/tab-title-from-tmux
