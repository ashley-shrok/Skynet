---
phase: quick-260724-aiu
plan: "01"
subsystem: conversation-store / AppShell restore paths
tags: [active-glow, url-restore, persisted-tab-restore, selectConversationDeferred, patch-145]
dependency_graph:
  requires: [patch-144]
  provides: [active-glow-on-url-restore, active-glow-on-persisted-tab-restore]
  affects: [src/ui/AppShell.tsx]
tech_stack:
  added: []
  patterns: [selectConversationDeferred symmetric with click handlers]
key_files:
  created: []
  modified:
    - src/ui/AppShell.tsx
decisions:
  - "No new imports needed — selectConversationDeferred was already imported at AppShell.tsx:59 alongside the other conversation-store exports"
  - "No new tests — bug lived entirely outside test coverage (URL routing + persisted-tab restore paths, neither mocked in AppShell test harness); fix is symmetric with existing tested click-handler pattern"
  - "Deploy deferred: batched with patch #146 (log-forwarder prototype) per Ashley 2026-07-23 batching rule"
metrics:
  duration: "~5 min"
  completed: "2026-07-24"
  tasks: 1
  files: 1
---

# Quick Task 260724-aiu: Patch #145 — Active-Glow URL-Restore Fix Summary

**One-liner:** Added `selectConversationDeferred(id)` after each mount-time `setActiveTabId(id)` call in AppShell.tsx's two restore paths so `state.selectedId` is non-null on mount, unblocking the patch #144 `addToActiveSet` useEffect and lighting up the sidebar glow.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add selectConversationDeferred symmetric calls to both mount-time restore paths | efc8e87 | src/ui/AppShell.tsx (+2 lines) |

## What Was Built

Two surgical 1-line insertions in `src/ui/AppShell.tsx`, symmetric with the sidebar click handlers at lines 1295/1309/1317:

**Insertion #1 — persisted-tab-restore path (line 833):**
```
setActiveTabId(restoredTabs[0].id);
selectConversationDeferred(restoredTabs[0].id);   // NEW
```

**Insertion #2 — URL-driven initial open path (line 902):**
```
setActiveTabId(openedIds[idx]);
selectConversationDeferred(openedIds[idx]);   // NEW
```

These ensure `state.selectedId` is non-null at mount for both restore paths, which allows the patch #144 useEffect `if (selectedId) addToActiveSet(selectedId)` in `PrettyConversationsPanel.tsx:162-164` to fire on mount, populating `sessionStorage['pv-conv-active-set']` and making the targeted conversation row display the full pretty-view active-glow bubble treatment.

## Verification Results

- `npm run type-check`: clean (no new tsc errors)
- `npm test -- pretty-conversations --run`: 36/36 green (2 test files, no regressions)
- `npm run build`: clean (5.56s)
- `grep -n 'selectConversationDeferred(restoredTabs[0].id)' AppShell.tsx`: found at line 833
- `grep -n 'selectConversationDeferred(openedIds[idx])' AppShell.tsx`: found at line 902
- `git diff --stat src/ui/AppShell.tsx`: 1 file changed, 2 insertions(+), 0 deletions(-)

Note: `grep -c 'selectConversationDeferred' AppShell.tsx` returned 7 (not 5 as plan expected). Pre-patch the file had: import line (59), comment line (549), 3 click-handler calls (1295/1309/1317) = 5 total. Post-patch: +2 new calls = 7 total. The plan's "5" was counting only call sites (3→5), not the import and comment. All 5 call sites are correctly wired; the count discrepancy is a plan-counting artifact, not a regression.

## Deviations from Plan

None — plan executed exactly as written. The 2-line surgical diff lands in exactly one file, no new imports, no new tests, no deploy, no push, no `skynet-patches.md` write-up.

## Known Stubs

None.

## Threat Flags

None — this patch adds no new network endpoints, auth paths, file access patterns, or schema changes.

## Self-Check: PASSED

- src/ui/AppShell.tsx modified: FOUND
- Commit efc8e87 exists: FOUND
- Both insertion pattern greps returned expected lines: PASSED
- Build and type-check clean: PASSED
