---
phase: 11-skynet-transformation-purge-dead-skynet-surfaces-first-slice
plan: 01
subsystem: ui/enumeration
tags: [ui, app-shell, enumeration, prove-dead, skynet-purge, strip-list, docs]

# Dependency graph
requires:
  - phase: 10-pretty-conversations-visual-language-rework
    provides: PrettyConversationsPanel + PrettyConversationRow + retirement of the old ConversationsPanel/ConversationRow/NewSessionButton — the landing surface + the `settingsRowSlot` prop this strip-list retires
  - phase: 11-CONTEXT
    provides: locked scope (landing-swap + AppRail + SettingsRow retirement; no settings UI anywhere; palette authority; Phase 12+ scope-fence)
provides:
  - Authoritative strip-list at .planning/phases/11-.../11-01-STRIP-LIST.md — enumerates every file, import, mount, and state-machine field slated for deletion in Plans 02 + 03
  - Grep-verified consumer analysis for profileDropdownOpen (6 hits, all AppRail-only)
  - Disposition protocol + safety-gate greps for openSingletonTab (Plan 03 Task 1b executor decision tree)
  - Panel-branch table (12 railView conditionals in sidebarPanelContent — 11 to delete, 1 to keep)
  - 11-import table for the sidebar-panel imports Plan 03 strips from AppShell.tsx
  - Section G scope-fence enumerating Phase 12+ deferred files (dashboard/, sidebar/ panels, admin console)
affects:
  - Plan 02 (landing-surface swap) — consumes Section A
  - Plan 03 (AppRail + SettingsRow retirement) — consumes Sections B, C, D, E
  - Plan 04 (verification + close-out) — consumes Section F verification gates

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Grep-verified enumeration: every deletion claim cites the exact grep command + observed line count/hit list, so downstream executors do not re-litigate discovery
    - Consumer-analysis-with-safety-gate: profileDropdownOpen (a state field with 6 grep hits) gets a POST-strip re-grep command in the strip-list so the deletion executor validates zero survivors before removing the declaration line
    - Disposition-decision-tree pattern: openSingletonTab (unresolved-in-context ambiguity) gets a re-grep + decision-tree instead of a fait-accompli deletion — "do NOT strip on suspicion" is the load-bearing invariant
    - Scope-fence mirror: every Phase 12+ file is enumerated here explicitly so Plans 02/03 executors have a bright line if they encounter a stray reference to a deferred target

key-files:
  created:
    - .planning/phases/11-skynet-transformation-purge-dead-skynet-surfaces-first-slice/11-01-STRIP-LIST.md
    - .planning/phases/11-skynet-transformation-purge-dead-skynet-surfaces-first-slice/11-01-SUMMARY.md
  modified: []

key-decisions:
  - "Cited actual verified line numbers even where they drift from the plan text: e.g., sidebarHeader opens at AppShell.tsx:1691 (plan text said 1697); sidebarPanelContent has 12 railView conditionals, not 11 (the conversations branch that survives is one of them). The strip-list is the authoritative citation source."
  - "Dashboard TabType safety recommendation (Section A): preserve the `dashboard` TabType in ui-types.ts:150 as a load-bearing fallback for effectiveSelectedTabId + closeTab logic. Replace the RENDER path (tabUtils.tsx case) with a new PrettyLandingCard component rather than stripping the TabType entirely. This is the minimal-blast-radius option per CONTEXT.md § Deletion, not gating."
  - "34 locale files carry pinAppRail translation strings with zero production-code consumers. Explicitly enumerated as OUT-OF-SCOPE for Phase 11 in Section G — a follow-up dead-string sweep is a hygiene task, not part of Plans 02/03."
  - "openSingletonTab disposition punted to Plan 03 Task 1b executor via a decision-tree in Section E.6 rather than pre-decided here. The current caller set (1658 ConnectionsPanel + 1844 AppRail + 2037 tabUtils pass-through) all die naturally when Plan 02 replaces the dashboard render case with a prop-less PrettyLandingCard AND Plan 03 strips the AppRail mount + ConnectionsPanel branch. But the executor must confirm via post-strip re-grep — a new consumer surfacing mid-revision means KEEP with a load-bearing comment, not delete on suspicion."
  - "Comment-only historical references (AppShell.tsx:1432,1832,1895,2056 SettingsRow annotations; PrettyConversationsPanel.tsx:24 AppRail annotation) left to Plan 03 executor discretion per Phase 10 Wave 4 precedent (10-04-SUMMARY.md decision: 'Comment-only reference preservation policy')."

patterns-established:
  - "Strip-list-as-contract: every deletion plan enumerates its targets in a discovery-pass STRIP-LIST document before any source-tree modification. Downstream deletion plans consume the strip-list as their input contract and do NOT re-derive targets from source."
  - "Grep-with-count evidence: every non-trivial claim (e.g., 'X is AppRail-only') is backed by the exact grep command + the observed line count OR the exact hit list."

requirements-completed: [PURGE-01, PURGE-02, PURGE-03]

# Metrics
duration: 20min
completed: 2026-07-23
---

# Phase 11 Plan 01: Enumerate deletion targets for landing-swap + AppRail retirement — Summary

**Produced the authoritative 11-01-STRIP-LIST.md enumerating every landing-surface swap target, AppRail file/import/mount, SettingsRow cascade, orphan-prop chain, and rail-view state-machine field slated for deletion in Plans 02 + 03 — with grep-verified consumer analysis for profileDropdownOpen and a disposition-decision-tree for openSingletonTab.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-23T09:36:00Z (approx — plan spawn)
- **Completed:** 2026-07-23T09:56:43Z
- **Tasks:** 2 (enumeration + commit)
- **Files modified:** 0 source files (doc-only phase)
- **Files created:** 2 (STRIP-LIST.md + this SUMMARY.md)

## Accomplishments

- **Section A (8 landing-surface swap targets):** cited AppShell.tsx:180-188 initial tab seed, :189 activeTabId default, :1175 closeTab fallback, :1181-1190 synthetic-dashboard tab creation, :830 URL-restore hostlessTypes, ui-types.ts:150 TabType union entry, tabUtils.tsx:187-193 render case, :26 DashboardTab import, :89-90 tabIcon case. Recommended new PrettyLandingCard component in src/ui/features/pretty-view/ so the "dashboard" TabType stays as a load-bearing fallback while the RENDER path swaps to warm-glass idle card per `--color-pv-*` palette authority.
- **Section B (AppRail deletion set):** file (283 lines) + 2 imports at AppShell.tsx:20-21 + mount at :1834-1847 + one import in SettingsRow.tsx:42 + post-deletion grep verification command. Verified no test file exists.
- **Section C (SettingsRow cascade):** file (198 lines) + 1 import at AppShell.tsx:83 + prop-passing mount at :1437-1441 + 4 comment-only history annotations. Verified no test file exists.
- **Section D (settingsRowSlot orphan chain):** PrettyConversationsPanel.tsx:121 type field, :105 destructure, :418 JSX render site, test file :520-548 Test 11 prune, :43 ReactNode import strip (verified ReactNode used ONLY for settingsRowSlot — 2 hits total).
- **Section E (rail-view state machine):** railView declaration at :233, profileDropdownOpen at :234 with FULL 6-hit consumer grep + POST-strip safety-gate command (Plan 03 executor MUST run before deleting line 234), sidebarTitle Record at :333-346, handleRailClick at :1264-1272, editHostInManager at :1274-1282, openSingletonTab disposition-tree at :1095, sidebarHeader consumer at :1691-1725 (line-number drift vs plan text flagged), sidebarPanelContent 12-conditional table (1 keep + 11 delete), 11-panel-import table (imports at :22-31 + :59).
- **Section F verification gates:** 7 grep commands + 3 toolchain gates with expected exit values.
- **Section G scope-fence:** Every Phase 12+ deferred file enumerated (dashboard/ tree, ~20 sidebar/ panel files, admin console suite, backend routes, terminal/protocol panes, 34 locale JSON pinAppRail carve-out).

## Task Commits

Each task committed atomically:

1. **Task 1 + 2: Enumerate strip-list + commit** — one commit covers both (doc-only, single file authoring + commit as directed by the orchestrator prompt).

**Plan metadata:** committed alongside the strip-list in the same commit — the SUMMARY.md was created as part of the same doc-only commit per the orchestrator's `docs(11-01):` message format.

## Files Created/Modified

- `.planning/phases/11-skynet-transformation-purge-dead-skynet-surfaces-first-slice/11-01-STRIP-LIST.md` — authoritative deletion-target enumeration (7 sections A-G, ~330 lines).
- `.planning/phases/11-skynet-transformation-purge-dead-skynet-surfaces-first-slice/11-01-SUMMARY.md` — this file.

## Decisions Made

See frontmatter `key-decisions`. Summary:
1. Cite verified line numbers even where they drift from the plan text (sidebarHeader is at 1691 not 1697; sidebarPanelContent has 12 railView conditionals, not 11).
2. Preserve the `dashboard` TabType in ui-types.ts as a load-bearing fallback; swap the RENDER path only via a new PrettyLandingCard component (minimal-blast-radius per CONTEXT.md § Deletion, not gating).
3. 34 locale files with `pinAppRail` are enumerated as OUT-OF-SCOPE for Phase 11 (already-dead upstream carryover; dead-string sweep is a follow-up hygiene task).
4. `openSingletonTab` disposition punted to a decision-tree consumed by Plan 03 Task 1b executor rather than pre-decided here — the executor confirms via POST-strip re-grep and applies "do NOT strip on suspicion" invariant.
5. Comment-only historical references left to Plan 03 executor discretion per Phase 10 Wave 4 precedent.

## Deviations from Plan

None — plan executed exactly as written. All 7 required sections (A-G) produced with grep-verified evidence. Zero source-tree modifications. `git status src/` returned clean.

The strip-list DID cite verified line numbers that differ slightly from a couple of numbers in the plan's `<action>` text (e.g., sidebarHeader is at 1691 not 1697); this is not a deviation from the plan's INSTRUCTIONS — the plan explicitly told the executor to "cross-check each cited line number against the actual file content" (see `<threat_model>` T-11-01-02 mitigation). The plan-text numbers were best-known-at-planning-time; the strip-list is the authoritative citation source per the plan's own contract.

## Issues Encountered

None. The Read tool truncated AppShell.tsx (2073 lines) at the 25K-token cap on the first read; recovered by running the plan's suggested targeted `grep -n` commands + a second Read call for the 1384-2073 range. Standard pagination workflow; not a plan issue.

## User Setup Required

None — no external service configuration required. This was a discovery + documentation pass with zero infrastructure implications.

## Next Phase Readiness

- **Plan 02 (landing-surface swap):** ready to consume Section A. Recommendation: create `src/ui/features/pretty-view/PrettyLandingCard.tsx` and swap the `case "dashboard"` render in `tabUtils.tsx`. Do NOT touch `src/ui/dashboard/` file tree (Phase 12+).
- **Plan 03 (AppRail + SettingsRow + rail-view state retirement):** ready to consume Sections B + C + D + E. **Critical:** run Section E.2's safety-gate grep AFTER AppRail mount removal but BEFORE `profileDropdownOpen` line-234 deletion. Run Section E.6's disposition-tree grep AFTER AppRail mount + ConnectionsPanel branch strip but BEFORE stripping `openSingletonTab`. If any new consumer surfaces mid-revision, KEEP with a load-bearing comment; do NOT delete on suspicion.
- **Plan 04 (verification + close-out):** Section F provides the exact toolchain + grep gates.

## Self-Check

- [x] STRIP-LIST.md exists at expected path
- [x] Contains 7 sections A-G (verified via `grep -c "^## Section" 11-01-STRIP-LIST.md` → 7)
- [x] Section E enumerates `profileDropdownOpen` with grep-verified consumer analysis (18 mentions in the file — verified via `grep -c "profileDropdownOpen"` → 18)
- [x] Section E enumerates 11 panel imports (HostsPanel, SessionsPanel, QuickConnectPanel, SshToolsPanel, SnippetsPanel, HistoryPanel, SplitScreenPanel, UserProfilePanel, AdminSettingsPanel, CredentialsPanel, ConnectionsPanel) with line numbers
- [x] Section E provides `openSingletonTab` disposition-decision-tree
- [x] Section F contains the exact `grep -rn "AppRail" src/` verification command Plan 03 will run
- [x] Section G explicitly lists dashboard/ + sidebar/ panel files as OUT-OF-SCOPE-FOR-PHASE-11
- [x] Zero source files modified (`git status --short` shows only untracked .planning/ additions)

## Self-Check: PASSED

---
*Phase: 11-skynet-transformation-purge-dead-skynet-surfaces-first-slice*
*Completed: 2026-07-23*
