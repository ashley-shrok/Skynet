---
phase: quick-260727-v0b
plan: 01
subsystem: identity-modal
tags: [ui, backend, ws-mutation, bounty-status, mirror-patch-154]
dependency-graph:
  requires:
    - patch #154 (writeIdentityBountyPriority — shape mirrored)
    - patch #87 (BountyCard + IdentityModal Bounties tab)
    - quick 260727-tb1 (invalidateBountyCount piggyback path)
  provides:
    - identity:update-bounty-status WS wire pair
    - writeIdentityBountyStatus (local + SSH branches)
    - StatusRow inline editor component
  affects:
    - IdentityModal Bounties tab expanded body ordering (Status → Priority → Premise → Todos → Latest → footer)
    - Bounty resurrect flow (pinned/in_progress on done/dropped/archived cards)
tech-stack:
  added: []
  patterns:
    - "byte-shape mirror of patch #154 priority writer, with the field-name delta (`status` for `priority`) and coverage delta (editable on ALL bounties including archived)"
    - "identityKey/bountySlug regex validation at handler + belt-and-braces re-validation in writer"
    - "atomic-ish tmp+rename write to bounty.json"
key-files:
  created:
    - src/backend/claude-session/identity-artifact-reader.write-bounty-status.test.ts
  modified:
    - src/ui/api/claude-session-api.ts
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/features/pretty-view/BountyCard.tsx
    - src/ui/features/pretty-view/IdentityModal.tsx
decisions:
  - "BOUNTY_STATUS_VALUES defined LOCALLY in identity-artifact-reader.ts (mirrors how BOUNTY_PRIORITY_VALUES is defined locally there) rather than imported from ui/api — keeps backend writer self-contained. UI-side has its own parallel BOUNTY_STATUS_VALUES const in claude-session-api.ts. Both must stay in sync (no compile-time cross-check because the module boundary crosses bundling contexts)."
  - "Threaded onStatusChange to all 4 BountyCard render sites INCLUDING the Archive Accordion — deliberate divergence from patch #154 (which skipped `other` + archive for priority). Status IS meaningful on closed bounties per the resurrect flow."
  - "Writer patches bounty.json IN PLACE regardless of new status — folder-move between bounties/<slug>/ and bounties/archive/<slug>/ is DELIBERATELY out of scope (id skill handles archive population on its own cadence)."
  - "Status pills use their STATUS_CLASSES color for the INACTIVE state (per Ashley's ask: 'no glyph — just label + color'); ACTIVE pill still gets the pressed white-ring treatment so it reads as selected against the colored row."
metrics:
  duration: ~10min
  completed_date: 2026-07-27
---

# Quick 260727-v0b: Add Inline Status Editor to BountyCard Summary

Adds a StatusRow inline editor to BountyCard's expanded body — the parallel of patch #154's PriorityRow, applied to `bounty.status`. Ashley can now click a pill in the identity modal to flip a bounty between the 5 status values (pinned / in_progress / waiting_on_someone_else / done / dropped) without hand-editing bounty.json, and can resurrect a done/dropped/archived bounty by clicking `pinned` or `in_progress` on it. Server patches bounty.json in place — folder is NOT moved.

## What Was Built

- **`src/ui/api/claude-session-api.ts`** — `BOUNTY_STATUS_VALUES` const tuple + `BountyStatus` union + `IdentityUpdateBountyStatusPayload` + `IdentityBountyStatusUpdatedEvent`. New event type added to the `ClaudeSessionServerEvent` union.
- **`src/backend/claude-session/identity-artifact-reader.ts`** — Added local `BOUNTY_STATUS_VALUES` / `BountyStatus` (mirrors the local priority def), plus `writeIdentityBountyStatus` (section 8) with both local and SSH branches. Renumbered `readIdentityPinnedBountyCount` from section 8 → 9. Local branch: tmp+rename atomic-ish write. Remote branch: python3 one-liner byte-for-byte parallel to the priority writer's script.
- **`src/backend/claude-session/claude-session-server.ts`** — Added imports for `BOUNTY_STATUS_VALUES`, `writeIdentityBountyStatus`, and `type BountyStatus`. Added the `identity:update-bounty-status` WS handler directly above the priority handler (byte-shape mirror: IDENTITY_KEY_RE + IDENTITY_SLUG_RE + status membership validation, local vs SSH routing via `isLocalHostId` + `connectOneShot`, try/finally { conn.end() } around remote writes, fresh-list response). Updated the wire-protocol doc comment block with the new request/response pair.
- **`src/ui/features/pretty-view/BountyCard.tsx`** — New `StatusRow` component (5 buttons, colored per STATUS_CLASSES when inactive, pressed-white-ring when active, disabled while saving). New `onStatusChange?` prop + `savingStatus` / `statusError` state + `handleStatusChange` wrapper. Status editor block rendered ABOVE the Priority editor in the expanded body.
- **`src/ui/features/pretty-view/IdentityModal.tsx`** — New type imports (`BountyStatus`, `IdentityUpdateBountyStatusPayload`, `IdentityBountyStatusUpdatedEvent`). New `updateBountyStatus` async function mirroring `updateBountyPriority` line-for-line, INCLUDING the `void invalidateBountyCount(...)` piggyback call. Threaded `onStatusChange` to BountyCard at ALL FOUR render sites (in_progress + rest + other + archive accordion).
- **`src/backend/claude-session/identity-artifact-reader.write-bounty-status.test.ts`** — NEW Vitest suite for the local branch: (1) round-trip status + updated_at + timeline append, (2) rejects unknown status with "invalid status", (3) folder listing byte-identical before and after a status change to `done` (writer does NOT create archive/ or move the slug dir).

## Verification

| Gate | Command | Result |
|------|---------|--------|
| Backend TS build | `npm run build:backend` | exit 0 |
| Frontend + full build | `npm run build` | exit 0, built in 4.41s |
| New writer test | `npx vitest run src/backend/claude-session/identity-artifact-reader.write-bounty-status.test.ts` | 3 passed |
| Full test suite | `npx vitest run` | 61 files / 712 passed / 6 skipped (baseline was 709/6 — the +3 is the new writer suite, zero regressions) |
| Grep — `identity:update-bounty-status` | in src/ | 9 hits (payload + handler `if` + 2× sshLogger + error log + wire-doc × 2 + UI payload + backend module comment); structurally mirrors patch #154's `identity:update-bounty-priority` (10 hits — 1 diff is a comment in the priority code that this quick did not need to duplicate) |
| Grep — `writeIdentityBountyStatus` | in src/ | 11 hits (definition + section header + test file × 5 + import + 2 call sites in handler) |
| Grep — `BOUNTY_STATUS_VALUES` | in src/ | 10 hits (local def in reader + UI def + backend import + handler validation + writer validation + BountyCard import + BountyCard `.map` + 2 doc comments) |

Note on the plan's expected 3-hit distribution for `identity:update-bounty-status`: the plan estimate was low. The actual distribution structurally mirrors the priority handler (which itself has 10 hits, not 3). The mirror is intact — the plan estimate was the outlier, not the code.

## Commit

- SHA (short): **4de8f14**
- Branch: **feat/tab-title-from-tmux**
- Files: exactly the 6 in `files_modified` (5 modified + 1 new test file)

**Post-commit report: committed on branch feat/tab-title-from-tmux at 4de8f14; NOT pushed, NOT built (image), NOT deployed. Awaiting Ashley's ship signal.**

## Deviations from Plan

### 1. [Deviation — plan clarification, not a rule-N auto-fix] BOUNTY_STATUS_VALUES defined locally in backend reader (not imported from UI api)

- **Found during:** Task 1 — file 2 edit (identity-artifact-reader.ts)
- **Plan said:** "Import `BOUNTY_STATUS_VALUES, type BountyStatus` from `../../ui/api/claude-session-api.js` (grep for how `BOUNTY_PRIORITY_VALUES` / `BountyPriority` are currently imported at the top of this file and mirror the exact import site)"
- **What I found:** `BOUNTY_PRIORITY_VALUES` is NOT imported in `identity-artifact-reader.ts` — it's DEFINED locally there (line 303 in the original). The plan's "mirror the exact import site" instruction was based on an incorrect premise about the priority code.
- **What I did:** Followed the actual pattern — defined `BOUNTY_STATUS_VALUES` locally in the backend reader, alongside `BOUNTY_PRIORITY_VALUES`. Added a doc comment noting that both this and the UI-side const in `claude-session-api.ts` must stay in sync (there's no compile-time cross-check since the module boundary crosses bundling contexts). This is a true byte-shape mirror of how the priority const is handled, which the plan explicitly asked for.
- **Files affected:** src/backend/claude-session/identity-artifact-reader.ts (local const), src/ui/api/claude-session-api.ts (parallel UI-side const, unchanged from plan)
- **Commit:** 4de8f14

## Auth Gates

None.

## Deferred Issues

None.

## Threat Flags

None. All new surface (WS handler, writer local+remote branches) is covered by the plan's threat model (T-v0b-01 through T-v0b-SC). No new trust boundaries introduced beyond those the priority writer already crosses.

## Known Stubs

None. StatusRow is fully wired to a real writer, the writer is fully validated end-to-end, and every BountyCard render site in IdentityModal supplies `onStatusChange`.

## Self-Check: PASSED

- File exists: `src/backend/claude-session/identity-artifact-reader.write-bounty-status.test.ts` — FOUND
- File modified: `src/ui/api/claude-session-api.ts` — FOUND (BOUNTY_STATUS_VALUES + wire types)
- File modified: `src/backend/claude-session/identity-artifact-reader.ts` — FOUND (writeIdentityBountyStatus)
- File modified: `src/backend/claude-session/claude-session-server.ts` — FOUND (handler)
- File modified: `src/ui/features/pretty-view/BountyCard.tsx` — FOUND (StatusRow)
- File modified: `src/ui/features/pretty-view/IdentityModal.tsx` — FOUND (updateBountyStatus)
- Commit 4de8f14 exists in `git log` — FOUND
