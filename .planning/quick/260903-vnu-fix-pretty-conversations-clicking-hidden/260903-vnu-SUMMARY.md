---
phase: quick-260903-vnu
plan: "01"
subsystem: pretty-conversations
tags: [bug-fix, hidden-rows, click-race, semantic-invariant, inverts-quick-260731-tgg]
dependency_graph:
  requires: []
  provides: [correct-click-on-hidden-row-behavior]
  affects: [PrettyConversationsPanel]
tech_stack:
  added: []
  patterns: [store-mutation-removal, regression-test]
key_files:
  created: []
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
decisions:
  - "Inverted quick-260731-tgg: removed auto-unhide-on-click from handleRowSelect; hidden means hidden, only handleToggleHide (context menu) mutates hiddenIds on the click path."
  - "handleTogglePin (~line 1188) left untouched — unhide-before-pin is promotion semantics, not navigation."
metrics:
  duration: "~10 minutes"
  completed: "2026-09-03"
  tasks_completed: 1
  files_modified: 2
---

# Phase quick-260903-vnu Plan 01: Fix pretty-conversations clicking hidden row Summary

## One-liner

Removed the auto-unhide-on-click branch from `handleRowSelect` so clicking a hidden row opens the session without mutating `hiddenIds`, killing both the wrong semantic and the DOM-shift click race.

## What Was Built

Inverts `quick-260731-tgg` per Ashley 2026-09-03 directive. Two lines were deleted from `handleRowSelect` in `PrettyConversationsPanel.tsx`:

```
// quick-260731-tgg: opening a hidden row auto-unhides it before routing.
if (hiddenIds.has(row.id)) unhideConversation(row.id);
```

Replaced with a nine-line explanatory comment documenting the flip and both reasons (semantic + race). The `handleTogglePin` path (~line 1188) is untouched — pinning still unhides-before-pin as intentional promotion behavior.

Test (n) added to the `PrettyConversationsPanel: Hide/Show wiring (quick-260731-tgg)` describe block asserting:
- `unhideConversationSpy` NOT called on click (fleet-critical invariant)
- `selectConversationSpy` called with the hidden row id (session opens)
- `onConversationSelected` called with the hidden row id (mobile list-to-view transition fires)

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Remove auto-unhide from handleRowSelect + add regression test | d6282ceb | PrettyConversationsPanel.tsx, PrettyConversationsPanel.test.tsx |

## Verification

- `grep "opening a hidden row auto-unhides" PrettyConversationsPanel.tsx` → 0 matches
- `grep "Ashley 2026-09-03" PrettyConversationsPanel.tsx` → 1 match inside `handleRowSelect`
- `grep -c "if (hiddenIds.has(row.id)) unhideConversation(row.id);" PrettyConversationsPanel.tsx` → 1 (handleTogglePin only)
- `grep -c "Test (n)" PrettyConversationsPanel.test.tsx` → 2 (comment + it-block)
- Vitest: 110/110 tests passed; Test (n) green, Test (f) (unhide-on-pin) green and untouched
- Build: `npm run build` succeeded (36.28s)
- Deploy: `sudo docker compose up -d --force-recreate skynet` — container recreated
- Production: `curl -sSI https://term.gigaashley.click/ | head -1` → `HTTP/2 200`

## Deviations from Plan

None — plan executed exactly as written. All grep gates, test assertions, build, and deploy steps matched the plan spec verbatim.

## Known Stubs

None.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced. Edit is pure source + test in existing files with no new dependencies.

## Self-Check: PASSED

- `d6282ceb` present in `git log --oneline`
- Both modified files exist on disk
- 110 tests green
- HTTPS 200 on term.gigaashley.click
