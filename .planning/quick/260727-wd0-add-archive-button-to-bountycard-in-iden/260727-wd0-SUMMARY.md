---
phase: quick-260727-wd0
plan: 01
subsystem: identity-modal
tags: [ui, backend, ws-mutation, bounty-archive, mirror-v0b]
dependency-graph:
  requires:
    - quick 260727-v0b (writeIdentityBountyStatus — shape mirrored + coverage extended with mv semantics)
    - patch #154 (writeIdentityBountyPriority — tmp+rename pattern reused)
    - patch #87 (BountyCard + IdentityModal Bounties tab)
    - quick 260727-tb1 (invalidateBountyCount piggyback path)
    - Nelly's fleet-archived-bounty-storage-audit (locks hardcode `bounties/archive/`, mkdir -p semantics, atomic status-flip AND mv, fail-loud on corrupt bounty.json)
  provides:
    - identity:archive-bounty WS wire pair
    - archiveIdentityBounty (local + SSH branches)
    - TERMINAL_BOUNTY_STATUSES local const
    - Archive button on OPEN BountyCard render sites
  affects:
    - IdentityModal Bounties tab expanded body ordering (Status → Priority → Archive button → Premise → Todos → Latest → footer)
    - bounties/<slug>/ folder location on live archive (moved under bounties/archive/<slug>/)
    - archived-count on IdentityModal (bounty moves from `bounties` list to `archivedBounties` list on successful archive)
tech-stack:
  added: []
  patterns:
    - "byte-shape mirror of v0b (inline status editor), extended with mkdir -p archive/ + folder mv semantics after the in-place tmp+rename JSON patch"
    - "load-bearing sequencing per Nelly's fleet audit: JSON patch FIRST at current path, mkdir -p archive/ NEXT (idempotent), fs.rename of folder LAST (POSIX-atomic on same filesystem)"
    - "fail-loud on unparseable bounty.json: parse errors throw `please repair before archiving: bounty.json at <path> is unparseable` BEFORE any mutation is attempted; disk state is byte-for-byte identical after a failed attempt"
    - "server-decided next status (client payload has NO status field) — flip live→done, preserve done/dropped; prevents `dropped` from being clobbered to `done` on archive"
key-files:
  created:
    - src/backend/claude-session/identity-artifact-reader.archive-bounty.test.ts
  modified:
    - src/ui/api/claude-session-api.ts
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/features/pretty-view/BountyCard.tsx
    - src/ui/features/pretty-view/IdentityModal.tsx
decisions:
  - "TERMINAL_BOUNTY_STATUSES defined LOCALLY in identity-artifact-reader.ts (adjacent to BOUNTY_STATUS_VALUES) rather than imported from ui/api — deliberate asymmetry from v0b's BOUNTY_STATUS_VALUES pattern, keeps backend writer self-contained. Any future addition to the status enum should prompt an explicit decision about terminal membership here."
  - "Sequencing (JSON patch → mkdir -p → mv) is load-bearing per Nelly's fleet audit — a mid-crash between patch and mv leaves durable JSON at the OLD path (retry re-patches idempotently; timeline gains a duplicate entry — acceptable, better than half-moved). tmp+rename at the CURRENT (open) path only; archive/ never sees a .tmp file."
  - "Archive button threaded to OPEN BountyCard render sites only (the single OPEN_STATUS_ORDER map covers in_progress + rest + other with one addition). Deliberately NOT threaded to sortedArchive.map — cards already under archive/ don't get the button; unarchive is a separate follow-up quick per Ashley's UX call."
  - "Client payload has NO status field. Server decides next status internally (flip live→done, preserve done/dropped). One less validation surface than v0b's status handler; also prevents the `dropped→done` clobber bug that would have surfaced if the client naively sent `status: done` for every archive click."
metrics:
  duration: ~15min
  completed_date: 2026-07-27
---

# Quick 260727-wd0: Add Archive Button to BountyCard in the Identity Modal Summary

Adds an Archive button to the expanded body of BountyCard (below Status + Priority rows) for cards in the three OPEN partitions (in_progress / rest / other) inside the identity modal Bounties tab. Ashley can now archive a live-status or terminal-status bounty with one click from the modal — the server atomically patches bounty.json (flipping live→done, preserving done/dropped), then moves `bounties/<slug>/` under `bounties/archive/<slug>/` (mkdir -p archive/ if absent). First WRITE surface on bounty archival — sibling of v0b on the archive axis.

## What Was Built

- **`src/ui/api/claude-session-api.ts`** — Added `IdentityArchiveBountyPayload` (4-field: type, identityKey, hostId, bountySlug — no client-supplied status) + `IdentityBountyArchivedEvent` wire types, plus `IdentityBountyArchivedEvent` appended to the `ClaudeSessionServerEvent` union.
- **`src/backend/claude-session/identity-artifact-reader.ts`** — Added `TERMINAL_BOUNTY_STATUSES = ["done", "dropped"] as const` local const adjacent to `BOUNTY_STATUS_VALUES`. Added `archiveIdentityBounty` as section 9 (bumped `readIdentityPinnedBountyCount` from section 9 → 10). Local branch: reads bounty.json, throws `please repair before archiving` on parse failure, decides `nextStatus = isTerminal ? prevStatus : "done"` + timeline line ("preserved" vs "flipped from"), mutates + tmp+rename writes at CURRENT path, `fs.mkdir(archiveParent, { recursive: true })`, `fs.rename(bountyDir, archiveDest)`. Remote branch: python3 one-liner mirroring the byte shape (`sys.exit("please repair...")` on parse failure, `is_terminal=prev in ("done","dropped")`, `os.makedirs(archive_parent, exist_ok=True)`, `os.rename(bounty_dir, archive_dest)`).
- **`src/backend/claude-session/claude-session-server.ts`** — Added `archiveIdentityBounty` to the import from `./identity-artifact-reader.js`. Added two wire-protocol doc-comment lines for the request/response pair. Added the `identity:archive-bounty` WS handler directly ABOVE the v0b status handler — IDENTITY_KEY_RE + IDENTITY_SLUG_RE validation, `isLocalHostId` routing, local vs `connectOneShot(...5000)` remote with try/finally { conn.end() }, `readIdentityBounties` after the write to return fresh lists, `sshLogger.info("identity:archive-bounty", { operation: "identity_archive_bounty", ... })` on success, `sshLogger.error("identity:archive-bounty unexpected error", ..., { operation: "identity_archive_bounty_error", ... })` on failure. Response shape: `{ type: "identity:bounty-archived", bounties, archivedBounties, error? }`.
- **`src/ui/features/pretty-view/BountyCard.tsx`** — Extended props destructure with `onArchive?: () => Promise<void>` + doc comment. Added `savingArchive` + `archiveError` local state alongside the v0b status state. Added `handleArchive` async wrapper (mirrors `handleStatusChange` shape with no argument). Inserted Archive button block BELOW the Priority editor and BEFORE the Premise block: gated on `{onArchive && (...)}`, shadcn `Button` with `variant="outline"` + `size="sm"`, muted archive-ish styling, `aria-label={\`Archive bounty: ${bounty.title}\`}`, `disabled={savingArchive}`, `onClick={() => void handleArchive()}`, `{savingArchive ? "Archiving…" : "Archive"}` label. `archiveError` surface below in `text-rose-300`.
- **`src/ui/features/pretty-view/IdentityModal.tsx`** — Added type imports (`IdentityArchiveBountyPayload`, `IdentityBountyArchivedEvent`). Added `archiveBounty(bountySlug)` async function directly below `updateBountyStatus` — mirrors byte-shape line-for-line, INCLUDES the `void invalidateBountyCount(identity.identityKey, hostId)` piggyback (archiving a pinned live bounty deterministically drops the count by 1). Threaded `onArchive={() => archiveBounty(b.slug)}` to the SINGLE `<BountyCard>` render inside the OPEN_STATUS_ORDER map — that one addition covers ALL THREE open partitions (in_progress + rest + other) because they share the same render. Added deliberate-omission comment inside sortedArchive.map block (NO `onArchive` there — cards under archive/ do not get the Archive button).
- **`src/backend/claude-session/identity-artifact-reader.archive-bounty.test.ts`** — NEW Vitest suite for the local branch. Three cases: (1) LIVE-status flip — `in_progress` → flips to `done`, bumps `updated_at`, appends `/flipped from in_progress to done/` timeline entry, folder moves to `bounties/archive/<SLUG>/`, `bounties/archive/` created on demand (fresh-mkdir case per Nelly's audit), no leftover `.tmp` files. (2) TERMINAL-status preserve — `dropped` stays `dropped` (NOT clobbered to `done`), appends `/status dropped preserved/` timeline entry, folder moved. (3) Unparseable bounty.json — rejects with `/please repair before archiving/`, bounty.json bytes remain identical, `bounties/archive/` NOT created (failure is pre-mkdir per writer sequencing), no `.tmp` files leaked.

## Verification

| Gate | Command | Result |
|------|---------|--------|
| Backend TS build | `npm run build:backend` | exit 0 |
| Frontend + full build | `npm run build` | exit 0, built in 4.67s |
| New writer test | `npx vitest run src/backend/claude-session/identity-artifact-reader.archive-bounty.test.ts` | 3 passed (1 file) |
| Full test suite | `npx vitest run` | 62 files / 715 passed / 6 skipped (baseline was 712/6 — the +3 is the new archive-bounty writer suite, zero regressions) |
| Grep — `identity:archive-bounty` | in src/ | 9 hits (2× wire-doc + backend `if` block + payload type + UI payload literal + 2× sshLogger + backend section-header comment + error log) — structurally mirrors v0b's `identity:update-bounty-status` distribution |
| Grep — `archiveIdentityBounty` | in src/ | 8 hits (section header + `export async function` in reader, 5 in test file, import + 2 call sites in handler) |
| Grep — `TERMINAL_BOUNTY_STATUSES` | in src/ | 2 hits — both in `identity-artifact-reader.ts` (definition + guard in archiveIdentityBounty). Backend-local, per deliberate asymmetry (matches how v0b handled BOUNTY_STATUS_VALUES). |
| Grep — `onArchive` | in src/ui/features/pretty-view/ | 8 hits: BountyCard.tsx has 6 (prop destructure + type + gate check + await + doc-comment mention + JSX gate); IdentityModal.tsx has 2 (1 at OPEN render sites line 760, 1 deliberate-omission comment at sortedArchive.map line 790). ZERO `onArchive={...}` inside the archive block — confirmed by grep. |

## Commit

- SHA (short): **3362d6f**
- Branch: **feat/tab-title-from-tmux**
- Files: exactly the 6 in `files_modified` (5 modified + 1 new test file)
- Diff: 6 files changed, 541 insertions(+), 2 deletions(-)

**Post-commit report: committed on branch feat/tab-title-from-tmux at 3362d6f; NOT pushed, NOT built (image), NOT deployed. Awaiting Ashley's ship signal.**

## Deviations from Plan

None. Task 1 executed exactly as the PLAN.md action steps prescribed — the v0b canonical mirror was intact, all 6 files landed as specified, the archive-mv semantics + mkdir -p + fail-loud pattern implemented per Nelly's fleet audit rules, and the test suite covered the three locked semantic paths. No auto-fixes required (Rule 1/2/3 all no-ops; Rule 4 unused).

## Auth Gates

None.

## Deferred Issues

None. Full vitest run reached 715 passing with zero regressions, both build gates exit 0.

## Threat Flags

None. All new surface (WS handler, writer local+remote branches, folder mv) is covered by the plan's threat model (T-wd0-01 through T-wd0-SC). No new trust boundaries introduced beyond those the priority + status writers already crossed — the folder mv is bounded by the same regex validation (IDENTITY_KEY_RE + IDENTITY_SLUG_RE) and path.join/expansion patterns the JSON writers use.

## Known Stubs

None. Archive button is fully wired to a real writer (local + SSH branches), the writer is fully validated end-to-end, and every OPEN BountyCard render site in IdentityModal supplies `onArchive`. sortedArchive.map deliberately omits `onArchive` per locked semantics rule #3 — that's a specification, not a stub (unarchive is a separate follow-up quick, called out inline via a deliberate-omission comment).

## Self-Check: PASSED

- File exists: `src/backend/claude-session/identity-artifact-reader.archive-bounty.test.ts` — FOUND
- File modified: `src/ui/api/claude-session-api.ts` — FOUND (IdentityArchiveBountyPayload + IdentityBountyArchivedEvent + union entry)
- File modified: `src/backend/claude-session/identity-artifact-reader.ts` — FOUND (archiveIdentityBounty + TERMINAL_BOUNTY_STATUSES)
- File modified: `src/backend/claude-session/claude-session-server.ts` — FOUND (identity:archive-bounty WS handler + wire-doc + import)
- File modified: `src/ui/features/pretty-view/BountyCard.tsx` — FOUND (Archive button + onArchive prop + savingArchive/archiveError state + handleArchive)
- File modified: `src/ui/features/pretty-view/IdentityModal.tsx` — FOUND (archiveBounty function + onArchive threading + deliberate-omission comment)
- Commit 3362d6f exists in `git log` — FOUND
