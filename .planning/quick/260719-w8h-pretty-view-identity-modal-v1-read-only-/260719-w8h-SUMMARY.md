---
quick_id: 260719-w8h
phase: quick
plan: 260719-w8h
subsystem: pretty-view
tags: [modal, identity, bounties, websocket, glass-ui, patch-87]
completed_at: "2026-07-19T23:27:47Z"
commits:
  - hash: 0383a2f
    task: "Task 1: Backend WS handler for identity:list-bounties + shared types"
  - hash: 1510695
    task: "Task 2: IdentityModal + BountyCard components"
  - hash: f17924f
    task: "Task 3: Wire click affordance on lg IdentityBadge + mount IdentityModal in PrettyView"
---

# Quick Task 260719-w8h: Pretty-View Identity Modal v1 (Read-Only) Summary

**One-liner:** Clickable lg IdentityBadge in pretty-view opens a near-fullscreen tabbed glass modal displaying the identity's bounties (grouped by status, archived in collapsed accordion), fetched via a new one-shot identity:list-bounties WS message on the existing claude-session WebSocket.

## Files Touched

| File | Change | Lines After |
|------|--------|-------------|
| `src/backend/claude-session/claude-session-server.ts` | New `identity:list-bounties` WS handler + updated docstring + os/path/fs imports | 1508 |
| `src/ui/api/claude-session-api.ts` | New `Bounty`, `IdentityListBountiesPayload`, `IdentityBountiesEvent` types + added to union | 192 |
| `src/ui/features/pretty-view/IdentityModal.tsx` | CREATED — tabbed near-fullscreen glass modal | 393 |
| `src/ui/features/pretty-view/BountyCard.tsx` | CREATED — per-bounty card component | 213 |
| `src/ui/features/terminal/IdentityBadge.tsx` | Add `onClick` prop; lg branch: button wrapper, remove hover:opacity-0, add scale/glow | 155 |
| `src/ui/features/pretty-view/PrettyView.tsx` | Import IdentityModal; add isIdentityModalOpen state; wire onClick + mount modal | 629 |

## New WS Wire-Protocol Frames (patch #87)

For skynet-patches.md write-up at eventual pin (NOT now — code-only commit):

```
client -> server:
  { type: "identity:list-bounties", identityKey: string }
  // identityKey must match /^[a-z0-9_-]{1,64}$/ (path-safety guard)
  // independent of connectToPane — no active pane needed

server -> client:
  { type: "identity:bounties", bounties: Bounty[], archivedBounties: Bounty[], error?: string }
  // bounties   = open bounties from ~/.claude/identities/<key>/bounties/*/bounty.json
  //              (excludes the archive/ subdir)
  // archivedBounties = ~/.claude/identities/<key>/bounties/archive/*/bounty.json
  // error      = only set on identityKey validation failure or unexpected FS error;
  //              ENOENT on bounties dir is NOT an error — returns empty arrays silently
  // Client closes the WS after receipt (one-shot, no subscription)
```

## Decisions Honored

All D-01..D-15 from planner_notes honored exactly. Key ones:

- **D-01** Identity resolution via existing `useSessionIdentity(tmuxSession)` in PrettyView:185 — no new backend resolution path.
- **D-02** Piggybacked on existing claude-session WS (port 30011) — no new nginx route needed.
- **D-03** Archive section = collapsed Accordion below open groups in Bounties tab.
- **D-04** Modal: `w-[90vw]! max-w-[1200px]! h-[85vh]!` on DialogContent.
- **D-05** FLIP transform skipped — glass tokens shared for visual continuity only.
- **D-06** All shadcn DialogContent base overrides use `!` important suffix per patch #81 rule.
- **D-07** Todos rendered as `<Checkbox disabled>` — no onChange handler anywhere.
- **D-08/D-09** Sort/group done client-side: priority weight map + status group order.
- **D-13** One-shot fetch on open, WS closed after receipt, refetch on reopen.
- **D-14** lg badge: button wrapper when onClick provided, div aria-hidden when not (backward-compat).
- **D-15** 4 placeholder tabs each render "Coming soon — <blurb>".

## Grep Gates Run

### Patch #38 Preservation (MANDATORY)

```bash
grep -c "hover:opacity-0" src/ui/features/terminal/IdentityBadge.tsx
# Result: 1  (md branch only, line 129 — PASS)
```

### Patch #81 Override Discipline

```bash
grep -Eq 'w-\[90vw\]!|h-\[85vh\]!' src/ui/features/pretty-view/IdentityModal.tsx
# Result: match found (PASS)
```

## Acceptance Criteria Status

- [x] `npx tsc --noEmit` reports zero errors project-wide (grep -c "error TS" = 0)
- [x] `npm run build` clean (12.54s, "built in" — no errors)
- [x] IdentityBadge md branch byte-preserved: `hover:opacity-0` count = 1 (md only)
- [x] IdentityBadge lg: cursor-pointer (via button native), hover:scale-[1.015], active:scale-[0.995], NO hover:opacity-0
- [x] IdentityBadge accepts `onClick` prop (grep confirms interface)
- [x] When onClick provided, lg renders `<button>` with `aria-label="Open identity info"`
- [x] PrettyView imports IdentityModal, declares isIdentityModalOpen, passes onClick to badge, mounts modal guarded by pvIdentity non-null
- [x] Existing pvIdentity/pvHue/pvIdentityKey resolutions (~185-187) unchanged
- [x] Backend handles `msg.type === "identity:list-bounties"` with path-safety guard
- [x] Backend returns empty arrays + no error on ENOENT (valid empty state)
- [x] Backend rejects invalid identityKey with `{error: "invalid identityKey"}`
- [x] Existing connectToPane flow untouched
- [x] Wire-protocol docstring updated with new frames
- [x] IdentityModal >= 120 lines (393 lines), BountyCard >= 60 lines (213 lines)
- [x] 5 TabsTrigger elements in JSX (Bounties, History, Wakeups, Handoff, Standing Directives)
- [x] Size overrides on DialogContent use `!` suffix per D-06
- [x] BountyCard has Checkbox with disabled prop; zero onCheckedChange/onChange occurrences
- [x] Empty state references identity displayName
- [x] 4 "Coming soon" placeholder tab bodies

## Deviations from Plan

None — plan executed exactly as written. All D-01..D-15 honored without deviation.

## Reminders for Ashley

1. **Stack position:** This is patch #87, stacking on top of patches #82-#86 (all unbuilt).
   The whole stack (#82-#87) deploys together in the next batch deploy.

2. **skynet-patches.md entry:** Per Ashley 2026-07-17 rule — add the patch #87 entry to
   skynet-patches.md at PIN TIME (after deploy green-light), NOT now. This commit is code-only.

3. **Manual spot-check at deploy time:**
   - Click the lg badge in pretty-view → modal opens with backdrop blur (glass tokens match badge)
   - Modal shows identity's bounties grouped: In Progress → On Deck → Waiting → Other
   - Archive section collapses below open groups (Accordion)
   - Placeholder tabs (History/Wakeups/Handoff/Standing Directives) show "Coming soon" strings
   - Esc, backdrop click, and X button all close the modal
   - Terminal-pane badge (md) still fades on hover per patch #38

## Known Stubs

None. The Bounties tab is fully wired; placeholder tabs are explicitly marked "Coming soon"
which is the correct v1 behavior per D-15 (intentional, not a stub).

## Threat Surface Scan

New backend endpoint-equivalent: `identity:list-bounties` WS handler reads from
`~/.claude/identities/<identityKey>/bounties/**` on the server's local filesystem.

| Flag | File | Description |
|------|------|-------------|
| threat_flag: path-traversal-guard | `src/backend/claude-session/claude-session-server.ts` | identityKey validated against `/^[a-z0-9_-]{1,64}$/` before use in `path.join` — prevents `../`, null bytes, absolute paths |
| threat_flag: fs-read-server | `src/backend/claude-session/claude-session-server.ts` | Server reads `~/.claude/identities/` dir; auth is the existing JWT cookie model (same as all claude-session WS traffic) |

Both flags are mitigated inline: the path-safety guard (regex + `path.join`) was required by the plan and implemented. Auth is inherited from the existing WS connection auth model (JWT verify at connect time).

## Self-Check

- [x] `src/backend/claude-session/claude-session-server.ts` — exists, committed in 0383a2f
- [x] `src/ui/api/claude-session-api.ts` — exists, committed in 0383a2f
- [x] `src/ui/features/pretty-view/IdentityModal.tsx` — exists (393 lines), committed in 1510695
- [x] `src/ui/features/pretty-view/BountyCard.tsx` — exists (213 lines), committed in 1510695
- [x] `src/ui/features/terminal/IdentityBadge.tsx` — exists, committed in f17924f
- [x] `src/ui/features/pretty-view/PrettyView.tsx` — exists, committed in f17924f
- [x] All 3 commits exist in git log

## Self-Check: PASSED
