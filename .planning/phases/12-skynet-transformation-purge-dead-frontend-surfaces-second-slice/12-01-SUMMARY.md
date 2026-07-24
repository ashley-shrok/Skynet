---
phase: 12-skynet-transformation-purge-dead-frontend-surfaces-second-slice
plan: 01
subsystem: doc-only
tags: [enumeration, deletion-contract, purge, ship-of-theseus]
requires: [11-01-STRIP-LIST.md]
provides:
  - "authoritative deletion-target contract for Plans 02-06"
  - "Section G writer+reader retire discipline (PURGE-09 resolution)"
  - "Section K verification-gate contract for Plan 07"
affects:
  - .planning/phases/12-.../12-02-PLAN.md (Section I input)
  - .planning/phases/12-.../12-03-PLAN.md (Sections A/B/C/D/G/J input)
  - .planning/phases/12-.../12-04-PLAN.md (Section E input)
  - .planning/phases/12-.../12-05-PLAN.md (Section F input)
  - .planning/phases/12-.../12-06-PLAN.md (Section H input)
  - .planning/phases/12-.../12-07-PLAN.md (Section K input)
tech-stack:
  added: []
  patterns:
    - "writer + reader parity discipline for shared-state deletions"
key-files:
  created:
    - .planning/phases/12-.../12-01-STRIP-LIST.md
    - .planning/phases/12-.../12-01-SUMMARY.md
  modified: []
decisions:
  - "shell/Tab.tsx is the Skynet tab bar chrome (PURGE-08) — grep-verified 0 consumers, safe to delete without stripping"
  - "features/keyboard/ is the on-screen modifier bar for Terminal + Guacamole, NOT the PURGE-09 shortcut editor UI — RETAINED"
  - "PURGE-09 resolves to commandPaletteShortcutEnabled writer (UserProfilePanel) + reader (AppShell) pair — same atomic commit retire"
  - "dashboard/NewSessionDialog.tsx (dies in Plan 02 relocate) is a DIFFERENT file from sidebar/NewSessionDialog.tsx (PROTECTED, PrettyConversationsPanel pencil consumer)"
  - "FullScreenAppWrapper → Dashboard.tsx chain is a cross-cutting concern flagged to Plan 04 executor with 3 options"
  - "locale strip Batch-2 must land AFTER Sections D + F to avoid orphan-key state"
metrics:
  duration_minutes: 15
  completed_date: 2026-07-23
---

# Phase 12 Plan 01: Enumerate strip-list Summary

Authored `12-01-STRIP-LIST.md` (942 lines, 11 sections A-K) — the authoritative deletion-target contract consumed verbatim by Plans 02-06 and the verification-gate contract for Plan 07.

## What shipped

A read-only audit document with grep-verified evidence for every deletion target:

- **Section A** — 10 sidebar simple-leaf panels (HostsPanel, SessionsPanel, CredentialsPanel, QuickConnectPanel, SshToolsPanel, SnippetsPanel, HistoryPanel, SplitScreenPanel, ConnectionsPanel, UserProfilePanel), each grep-verified 0 non-comment code consumers post-Phase-11.
- **Section B** — 7 Admin subtree files with cross-import chain enumerated (AdminSettingsPanel + 4 sections + AdminSettingsShared + AdminUserDialogs → same-commit atomic deletion mandate).
- **Section C** — 12 HostManager subtree files with cross-import graph (HostManager → HostEditor → HostEditorData chain).
- **Section D** — SidebarTree.tsx exports enumerated (`isFolder`, `HostItem`, `FolderItem`, `SidebarTree`) with per-export consumer grep. `isFolder` in `sidebar/NewSessionDialog.tsx:38` is the PROTECTED consumer routed to Plan 02 §I.1 inline refactor.
- **Section E** — All 17 files under `src/ui/dashboard/` (Dashboard, DashboardTab, SessionDashboard, NewSessionDialog dashboard-version, NewSessionHostChips, RemoteHostChips, sshHostToHost, 5 cards, 2 panels, 2 alerts, DashboardSettingsDialog, useDashboardPreferences). Retained-UI consumer grep found 6 live consumers (4 in CommandPalette + 1 in tabUtils + 1 in SessionsPanel-dying-anyway) plus the FullScreenAppWrapper → Dashboard.tsx cross-cutting concern (3-option resolution).
- **Section F** — `src/ui/shell/Tab.tsx` (442 lines) grep-verified 0 code consumers — already orphaned by Phase 11's landing swap.
- **Section G** — PURGE-09 resolution with BOTH halves enumerated:
  - **Writer:** UserProfilePanel.tsx lines 489-492 (localStorage read) + 1025-1036 (FakeSwitch onChange writes + dispatches `commandPaletteShortcutEnabledChanged` event).
  - **Reader:** AppShell.tsx lines 282-286 (state seed), 343 (gate expression `&& commandPaletteShortcutEnabled`), 350 (effect dep), 352-363 (storage-event listener useEffect).
  - Atomic-commit discipline: both halves retire in the SAME commit; the double-shift CommandPalette open path stays UNCONDITIONAL (default was `true`).
  - Line-drift note for the executor: re-grep before editing since surrounding shell code may shift.
  - General pattern: established "orphan-reader-after-writer-death" discipline for future purge phases.
- **Section H** — Full nav.* key inventory with per-key consumer analysis. 15 keys have 0 code consumers (batch-1, safe now); 12 keys become dead only after Sections D + F land (batch-2). ~18 keys STAY as retained-UI consumers (nav.home, nav.terminal, nav.serverStats, nav.fileManager, nav.docker, nav.tunnels, nav.hostTabTitle in TabContext; nav.newSession* in NewSessionDialog + PrettyConversationsPanel; nav.close/cancel/confirmClose in AppShell). Locale file count corrected to **35** (34 translated + 1 en.json).
- **Section I** — 3 pre-flight refactors for Plan 02 with exact edits: (I.1) inline `isFolder` 3-line body into `sidebar/NewSessionDialog.tsx`; (I.2) relocate 4 dashboard files to new `src/ui/features/session-launcher/` with CommandPalette import update lines 9-19; (I.3) replace `tabUtils.tsx:278-279 case "network_graph"` with `<PrettyLandingCard/>` + strip `NetworkGraphCard` import at line 28.
- **Section J** — Retained-UI protection list: feature subtrees (pretty-conversations, pretty-view, terminal, guacamole, keyboard, session-launcher-post-Plan-02, file-manager, server-stats, docker, tunnel, sessions); shell files (CommandPalette, TabContext, SplitView, tabUtils); CRITICALLY PROTECTED sidebar/NewSessionDialog.tsx + test file; AppShell.tsx (surgical Section G touch only); types/ui-types.ts (dashboard + network_graph + host-manager + user-profile + admin-settings TabTypes STAY); FullScreenAppWrapper.tsx flagged for Plan 04 executor.
- **Section K** — Verification gates for Plan 07: file-existence gates, identifier grep gates (non-comment code hits), locale key gates (both JSON residence + code consumer), toolchain gates (tsc + vitest + build), bundle-size headline.

## Key findings (surprises from enumeration)

- **`src/ui/shell/Tab.tsx` is already fully orphan** — grep `from.*shell/Tab` returns 0 hits. Phase 11's landing swap implicitly retired the visible tab strip. Plan 05 is a single `git rm` (no import stripping needed) — smaller than anticipated. This is the "Skynet tab bar chrome" file confirmed.
- **`features/keyboard/` is the ON-SCREEN MODIFIER BAR, not the PURGE-09 target.** All 5 files (Toolbar.tsx, sshAdapter.ts, sshAdapter.test.ts, guacamoleAdapter.ts, inputAdapter.ts) are consumed by Terminal.tsx and GuacamoleApp.tsx — deleting them would break both retained-UI panes. Section G resolves PURGE-09 to the `commandPaletteShortcutEnabled` writer/reader pair instead. Documented as PROTECTED in Section J with the exact 5-file consumer grep.
- **The `dashboard/NewSessionDialog.tsx` vs `sidebar/NewSessionDialog.tsx` file collision requires explicit protection.** They're separate files with the same base name; the dashboard version dies in Plan 02's relocate to `features/session-launcher/`; the sidebar version is PROTECTED (PrettyConversationsPanel pencil consumer). Section I.2 + Section J call this out repeatedly with grep patterns that distinguish them.
- **`nav.copyPassword` + `nav.copySudoPassword` + `nav.passwordCopied` + `nav.failedToCopyPassword` have DOUBLE consumers.** They're referenced from both `shell/Tab.tsx` (dies Section F) AND `sidebar/SidebarTree.tsx` (dies Section D). Neither Section alone kills them; they only enter batch-2 after BOTH land. Plan 06 executor must sequence: 03/04/05 → then batch-2.
- **`nav.home` STAYS via TabContext.tsx.** CONTEXT.md item 5 listed `nav.dashboard`/`nav.hosts`/etc. as removal candidates but did not enumerate `nav.home` — the shell/TabContext.tsx uses it at lines 105 and 236 for the retained "home" tab type. Preserved in Section H's RETAINED column.
- **`SessionDashboard.tsx` in dashboard/ imports 4 of the same relocate donors** as CommandPalette does — but SessionDashboard dies with the subtree, so those internal imports are irrelevant to Plan 02's relocate (they simply disappear with their consumer). Documented in Section E to prevent Plan 04 executor confusion.
- **FullScreenAppWrapper → Dashboard chain is a genuine cross-cutting concern.** `FullScreenAppWrapper.tsx:7` imports `Dashboard` from `@/dashboard/Dashboard.tsx`, and FullScreenAppWrapper wraps 6 retained feature apps (Terminal, FileManager, Docker, Tunnel, ServerStats, Guacamole). Section E documents 3 resolution options with recommendation (b) — replace `<Dashboard/>` with `<PrettyLandingCard/>` mirror of Phase 11's swap. This decision is delegated to Plan 04's executor with the analysis pre-loaded.
- **`sshAdapter.test.ts` inside `features/keyboard/` STAYS.** Not obvious from CONTEXT.md — it's a test file for a retained (non-deleted) file. Documented as PROTECTED in Section J's per-file table.
- **Locale file count is 35, not 34.** CONTEXT.md said "~34"; precise count via `ls src/ui/locales/*.json + translated/*.json` is 35 (1 en + 34 translated). Plan 06 authors against 35.

## Deviations from Plan

None. Plan executed exactly as authored. Every claim in the plan's `<action>` block became grep-verified evidence in the strip-list. All 11 sections present with min-line target (300) exceeded (942 lines).

## Verification

- 11 sections A-K present with grep evidence per section
- All 12 required token gates PASS (sidebar/NewSessionDialog, features/keyboard, isFolder, CommandPalette, NetworkGraphCard, shell/Tab.tsx, PURGE-06 through PURGE-10, commandPaletteShortcutEnabled, AppShell)
- Section G names BOTH writer (UserProfilePanel lines 489-492 + 1025-1036) AND reader (AppShell lines 282-286 + 343 + 350 + 352-363) with same-commit atomic retire discipline
- Section J explicitly protects sidebar/NewSessionDialog.tsx with pretty-conversations pencil-button consumer named at PrettyConversationsPanel.tsx:56, 417
- Section E notes `src/types/ui-types.ts` `dashboard` TabType at line 150 + 234 STAYS per Phase 11 preservation
- Zero source-tree modifications: `git status --porcelain src/` returns empty
- File total: 942 lines (target: >=300)

## Self-Check: PASSED

- FOUND: `.planning/phases/12-skynet-transformation-purge-dead-frontend-surfaces-second-slice/12-01-STRIP-LIST.md` (942 lines)
- FOUND: `.planning/phases/12-skynet-transformation-purge-dead-frontend-surfaces-second-slice/12-01-SUMMARY.md`
- Section-count grep: 11 (expected 11)
- src/ diff-scope: 0 files (expected 0)
- Commit hash: recorded post-commit below.
