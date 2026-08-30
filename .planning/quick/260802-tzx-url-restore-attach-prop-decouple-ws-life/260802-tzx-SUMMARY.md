---
phase: quick-260802-tzx
plan: 01
subsystem: pretty-view / terminal
tags: [bounty, url-restore, websocket, active-set, prop-decouple]
requires: []
provides:
  - "SSHTerminalProps.attach prop (WS-lifecycle gate, orthogonal to isVisible)"
  - "TerminalTabContent.attach + renderTabContent(shouldAttach) prop drill"
  - "AppShell shouldAttach = inPane || activeInline || isInActiveSet"
affects:
  - "src/ui/features/terminal/Terminal.tsx (WS-open effect gate)"
  - "src/ui/shell/tabUtils.tsx (prop threading)"
  - "src/ui/AppShell.tsx (activeSet consumption + shouldAttach computation)"
tech_stack_added: []
tech_stack_patterns: ["prop-decouple", "activeSet-membership-gate"]
key_files_created: []
key_files_modified:
  - src/ui/features/terminal/Terminal.tsx
  - src/ui/shell/tabUtils.tsx
  - src/ui/AppShell.tsx
decisions:
  - "Split isVisible into two orthogonal props: isVisible (pane visibility) and attach (WS lifecycle). Preserves all 5 existing pane-visibility uses of isVisible (ref mirror, performFit, resize-observer, fit-on-visible, autocomplete pointer-events)."
  - "No WS-teardown-on-!attach — matches today's behavior when the user switches away from the selected tab (WS lives until unmount / SSH close / user-close). Not a regression, and simplifies the change surface."
  - "renderTabContent uses shouldAttach: boolean = false default — safe for future callers that haven't been updated (they get dormant Terminals, preserving pre-patch behavior). AppShell is the only real caller and was updated in the same commit."
metrics:
  duration_min: 12
  completed_utc: "2026-08-02T21:46:25Z"
  tasks_completed: 5
  files_touched: 3
requirements:
  - bounty:url-restore-loads-only-selected-session-not-full-active-set
---

# Quick 260802-tzx: url-restore attach-prop decouple WS lifecycle Summary

Decoupled Skynet Terminal's WebSocket lifecycle from pane visibility by introducing an
`attach: boolean` prop, so URL-restored active-set tabs open their WebSockets and
publish honest `isWorking` signals to `session-working-store` (making
PrettyConversationRow's ready-dot mean what Ashley locked it to mean: "idle AND
connected").

## Commit

- `714e238` — `feat(pretty-view): decouple Terminal WS lifecycle from pane visibility (attach prop)` on branch `feat/tab-title-from-tmux`.

## Done-Criteria Check (5/5)

1. **WS-open gate in Terminal.tsx now depends on `attach`, not `isVisible`.** L2817 predicate + L2847 dep array both swapped. All 5 pane-visibility uses of `isVisible` (L564-565 isVisibleRef mirror, L605 performFit gate, L2432 resize-observer skip, L2852-2868 fit-on-visible effect, L2943 pointer-events) are untouched.
2. **tabUtils.tsx `TerminalTabContent` and `renderTabContent` both accept and forward `attach` / `shouldAttach`.** RDP/VNC/Telnet/dashboard branches untouched.
3. **AppShell.tsx computes `shouldAttach = inPane || activeInline || isInActiveSet`** with `activeSet` sourced from `useActiveSet()` (added to existing conversation-store import block); passes it as the new 6th positional arg to `renderTabContent`.
4. **`npx tsc --noEmit` passes with zero errors. `npm test` passes: 88 test files, 1064 pass, 6 skipped, 0 fail.**
5. **Single atomic commit `714e238` on `feat/tab-title-from-tmux`.** No push, no docker, no worktree. `~/.claude/identities/tina/` untouched.

## Verification

- `git log -1 --format="%s"` → `feat(pretty-view): decouple Terminal WS lifecycle from pane visibility (attach prop)` ✓
- `git log -1 --stat` → 3 files: `AppShell.tsx` (+5), `Terminal.tsx` (+7/-2), `tabUtils.tsx` (+5). Total 15 insertions, 2 deletions.
- `git branch --show-current` → `feat/tab-title-from-tmux` ✓
- `git status` → clean (only the pre-existing untracked `.planning/quick/*` dirs, which Tina handles).

## Structural Grep Check (from plan verification section)

- `grep -n "attach" src/ui/features/terminal/Terminal.tsx` — WS-effect predicate + deps + interface + destructure + explanatory comment (plus pre-existing unrelated `attach*` tokens like `attachCustomKeyEventHandler`, `attachedClients`, `tmux_attach` — those are prior-art, not added here). ✓
- `grep -n "shouldAttach\|attach" src/ui/shell/tabUtils.tsx` — 5 lines: destructure (L95), type field (L104), JSX in TerminalTabContent (L126), param in renderTabContent (L156), JSX in terminal case (L186). ✓
- `grep -n "shouldAttach\|isInActiveSet" src/ui/AppShell.tsx` — 3 lines inside the tabs.map (L1787 `isInActiveSet` computation, L1788 `shouldAttach` computation, L1799 `shouldAttach,` arg). ✓
- `grep -n "useActiveSet" src/ui/AppShell.tsx` — exactly 2 matches: import (L62), hook call (L505). ✓

## Deviations from Plan

**None material.** Two minor cosmetic notes for the record:

- The plan's Task 1 done-criteria predicted `tsc` would report errors in `tabUtils.tsx` and `AppShell.tsx` after Task 1 in isolation (because `attach` is required on `SSHTerminalProps`). It didn't — `tsconfig.app.json` has `strict: false`, so missing-required-prop JSX errors aren't surfaced. This does not change the outcome (the wiring in Tasks 2–3 still happens by design), just the diagnostic signal. The plan's more important criterion — "NO errors originating inside `Terminal.tsx` itself" — was satisfied at every task boundary.
- Task 1 grep-count "decrease by exactly 2" was interpreted as "the two real WS-effect uses (predicate + dep) get swapped to `attach`" — which is what happened. The added explanatory comment (also required by the plan) contains the string `isVisible` as prose narrative, so the raw `grep -c "isVisible"` count went from 12 → 11 rather than 12 → 10. This is expected given the plan text and does not violate the invariant "the 5 pane-visibility isVisible uses stay intact" (they do).

## Auth Gates

None encountered.

## Known Stubs

None.

## Testing

- `npx tsc --noEmit` → exit 0.
- `npm test` → 88 files pass, 1064 tests pass, 6 skipped, 0 fail (150s wall).
- **TESTING-GAP** (recorded in commit body): Neither `src/ui/features/terminal/Terminal.test.tsx` nor `src/ui/AppShell.test.tsx` exists, and Task 4 explicitly forbade fabricating new test scaffolding. The behavioral guarantees (WS opens when `attach=true` even if `isVisible=false`; URL-restore active-set of N tabs opens N WebSockets) therefore have no automated coverage in this commit. Follow-up epic should stand up a Terminal.test.tsx with a WebSocket-constructor spy and an AppShell.test.tsx that mocks TerminalTabContent to record `attach` props per tab id.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes. This is a pure client-side prop-plumbing change that gates an already-existing WebSocket open path on a different boolean.

## Self-Check: PASSED

- Commit `714e238` present in `git log`: FOUND.
- `src/ui/features/terminal/Terminal.tsx` modified: FOUND.
- `src/ui/shell/tabUtils.tsx` modified: FOUND.
- `src/ui/AppShell.tsx` modified: FOUND.
- SUMMARY.md at `/home/ubuntu/skynet/.planning/quick/260802-tzx-url-restore-attach-prop-decouple-ws-life/260802-tzx-SUMMARY.md`: WRITTEN.
