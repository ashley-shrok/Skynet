---
phase: quick-260727-f9v
plan: 01
type: execute
wave: 1
depends_on: []
completed: 2026-07-27
tasks_completed: 3
tasks_total: 3
files_modified:
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
  - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
commits:
  - hash: 07a9364
    message: "feat(pretty-conversations): add subtitleMode prop to PrettyConversationRow"
    files: 2
  - hash: 2048823
    message: "feat(pretty-conversations): per-host divider chips + identity-title sublabels + RDP chip brightness bump"
    files: 2
requirements_completed:
  - ASHLEY-HOST-HEADERS
  - ASHLEY-IDENTITY-TITLE-SUBLABEL
  - ASHLEY-DIVIDER-CHIP-BRIGHTNESS
status: complete
deploy_status: PENDING (Ashley greenlit "ship it" — deploy immediately after this summary+STATE commit)
tags: [conversation-list, skynet-transformation, pretty-conversations, identity-title, divider-chip, ashley-uat]
---

# Quick 260727-f9v: Per-host divider chips + identity-title sublabels

Slice of the `skynet-transformation` master bounty. Two coupled UI changes to the
Skynet conversation list, Ashley-greenlit via a live console-injection preview:

1. **Per-host divider chip** above each non-`__rdp__` host group in the
   `grouped.map` render site — mirrors the existing "Remote desktop" chip
   pattern (small icon + uppercase muted label + gradient rule filler) but with
   the `Server` glyph and `group.hostName` as the label.
2. **Sublabel swap** inside those same host-grouped sections only:
   `row.host.name` → `identity.title ?? identity.displayName`, and the `Server`
   icon on the sublabel line is dropped (it reads as "host-y," doesn't fit a
   title). Active-set, pinned, and RDP rows keep the current hostname + Server
   icon behavior verbatim per Ashley's design lock.
3. **Brightness bump** on both chip families (new per-host + existing RDP):
   `text-[#5c6070]/50 → /85` on both text and icon (Option 1 from PLAN — surgical
   alpha raise, no hue shift).

## Design locks (Ashley, greenlit today)

- Per-host chips render ONLY inside `grouped.map` for non-`__rdp__` groups.
  Active-set (`data-active-set-group="true"`) and pinned
  (`data-pinned-group="true"`) groups do NOT get chips — they're cross-host by
  design and a per-host chip above them would be a lie.
- Sublabel swap applies ONLY at the non-RDP grouped render site. Every other
  render site (active-set, pinned, RDP) omits the new prop → row defaults to
  `subtitleMode="hostname"` behavior verbatim.
- Fallback chain in the row: `identity.title` → `identity.displayName` → keep
  hostname + Server icon. Path 3 is the terminal safety net that guards against
  the "known limitation, inert ≠ inert" trap (Tina's patch #149 lesson) — if an
  identity fails to resolve for any reason, the sublabel silently reverts to
  today's shipped behavior instead of rendering `""` or `undefined`.
- The `Server` icon is dropped on rows whose sublabel got swapped to a title.
  In the fallback path the icon is kept (part of the reverted-to-shipped shape).

## Task execution

### Task 1: subtitleMode prop on PrettyConversationRow — commit 07a9364

Files: `PrettyConversationRow.tsx` (+49/-1) + `PrettyConversationRow.test.tsx`
(+98/0). New optional prop `subtitleMode?: "hostname" | "identityTitle"`,
defaulting to `"hostname"` for backward compatibility so no other consumer
needed touching. Three new test cases (19A/B/C) pin the three-branch fallback:
title present → renders title, no icon; title null but displayName present →
renders displayName, no icon; no identity resolved → falls back to hostname +
Server icon verbatim.

### Task 2: Panel wiring + chip render + RDP brightness bump — commit 2048823

Files: `PrettyConversationsPanel.tsx` (+44/-6) + `PrettyConversationsPanel.test.tsx`
(+201/-32). Added `Server` to the lucide-react imports alongside `Monitor`.
Extended `PrettyConversationRowLive` to pass through the new prop via the
existing `...rowProps` spread. Non-RDP grouped branch now renders a divider
chip (`data-testid="host-divider"` + `data-host-id={group.hostId}`) above each
group's rows, and every row in that branch receives
`subtitleMode="identityTitle"`. The existing RDP chip's text+icon color bumped
`/50 → /85` in-place. Test 3 (the intentionally-reversed "no per-host semibold
header" lock) rewritten to assert the chip DOES render with correct
host-id + hostName. Three new tests (19A/B/C) cover: two non-RDP groups → two
chips; active-set + pinned + one grouped host → exactly ONE chip only above the
grouped host; grouped host + `__rdp__` sentinel → BOTH chips coexist without
duplication.

### Task 3: Full regression + typecheck

`npx vitest run` → **610/610 passed across 49 files** (baseline 604, +6 new:
3 row + 3 panel; Test 3 rewritten in-place, no net add). `npx tsc --noEmit` →
0 errors. No tests outside `src/ui/features/pretty-conversations/` touched or
regressed. Task 3 committed no code — verification only.

## Deviations from PLAN.md

None. Every task step, file, and assertion followed the plan verbatim.

## Diffstat

4 files, +339/-53:

| File | Insertions | Deletions |
|------|-----------:|----------:|
| `PrettyConversationRow.tsx` | 48 | 1 |
| `PrettyConversationRow.test.tsx` | 98 | 0 |
| `PrettyConversationsPanel.tsx` | 38 | 6 |
| `PrettyConversationsPanel.test.tsx` | 155 | 46 |

## Scope-creep held

Zero forbidden surfaces touched. No CSS file changes (chip is inline Tailwind
mirroring the existing RDP chip; row keeps the `.pv-host` class). No
`conversation-store.ts` changes. No `AppShell.tsx` changes. No settings modal,
AppRail, dashboard, snippets manager, host manager UI, admin console, file
manager UI, top-level chrome, keyboard shortcut editor — all still dead per
Tina's identity file.

## Ready for deploy

**Yes** — clean tree (after this summary+STATE commit), full suite 610/610
green, typecheck clean, both commits individually PR-able on
`feat/tab-title-from-tmux`. Ashley greenlit "ship it" — deploy immediately
after the docs commit lands. Pre-warn her about the first-hard-refresh
`HTTP2_PROTOCOL_ERROR` on chunk loads per Tina's learned deploy discipline
(close+reopen the tab spawns a fresh H2 connection).

## Related

- **Master bounty**: `~/.claude/identities/tina/bounties/skynet-transformation/`
  — this is a slice of the Ship-of-Theseus movement; timeline entry added
  separately from this commit.
- **skynet-patches.md write-up**: deferred per batch-writeups-until-deploy rule
  (catalog is already behind by ~10-12 patches; queued for the next dedicated
  flush pass).
- **Console-preview snippet**: lives at
  `~/.claude/identities/tina/bounties/skynet-transformation/host-headers-preview.js`
  — kept for reference (the idempotent DOM mutation script Ashley pasted into
  DevTools to greenlight the visual before the fork commit landed).
