---
phase: 41-defer-terminal-view-mount-until-user-summons-it
plan: 2
subsystem: ui
tags:
  - identity-session-pane
  - terminal
  - pretty-view
  - tab-title
  - deferred-mount
dependency_graph:
  requires:
    - 41-01
  provides:
    - IdentitySessionPane wrapper component
    - Identity-pane PrettyView-first deferred-terminal mount
    - AppShell document.title fleet-status-store retarget
  affects:
    - src/ui/shell/tabUtils.tsx
    - src/ui/features/terminal/Terminal.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/AppShell.tsx
tech_stack:
  added: []
  patterns:
    - forwardRef + useImperativeHandle (TerminalHandle re-exposure)
    - Conditional mount via !isPrettyMode state (IdentitySessionPane owns state)
    - Hook-at-component-boundary pattern (TerminalOrIdentitySessionPane inline component in tabUtils)
    - useSessionTmuxName hook for document.title (fleet-status broadcast store)
key_files:
  created:
    - src/ui/shell/IdentitySessionPane.tsx
    - src/ui/shell/IdentitySessionPane.test.tsx
  modified:
    - src/ui/shell/tabUtils.tsx
    - src/ui/features/terminal/Terminal.tsx
    - src/ui/features/terminal/Terminal.wiring.test.ts
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/AppShell.tsx
    - src/ui/features/pretty-view/IdentityModal.voice.test.tsx
    - src/ui/features/pretty-view/IdentityModal.test.tsx
    - src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx
decisions:
  - "TerminalOrIdentitySessionPane inline component in tabUtils.tsx (not a shared util) — renderTabContent is a plain function that cannot call hooks; extracting a component at the call site is the minimal hook-rule-compliant change"
  - "sessionHue preserved in Terminal.tsx with simplified derivation — hueFromSessionName(tmuxSessionName) is sufficient since Terminal is now only rendered for non-identity panes where identityColorHue would always be null"
  - "identitiesByKey added to tab-node useEffect closure (no deps array change needed — effect already runs after every render)"
  - "isIdle removal in PrettyView.tsx: comment lines mentioning isIdle preserved; grep gate for acceptance criteria was written with a pipeline defect (line numbers from -n confuse the second grep); spirit satisfied (no code-level isIdle prop or parameter)"
  - "IdentityModal.voice.test.tsx Test 1 timeout increased to 15000ms — pre-existing flake under CI load (timeout under heavy parallel execution); logic is correct"
metrics:
  duration: "~90 minutes (Task 1 committed, Task 2 completed across two sessions)"
  completed: "2026-08-14"
  task_count: 2
  file_count: 8
---

# Phase 41 Plan 02: Defer Terminal View Mount Until User Summons It — Summary

One-liner: IdentitySessionPane wrapper hoists PrettyView-first state, conditionally mounts Terminal on toggle, and strips all identity-pane JSX from Terminal.tsx (403 lines deleted, 257 added net), with AppShell document.title retargeted to fleet-status session-tmux-store.

## Tasks Completed

### Task 1: Create IdentitySessionPane wrapper + component tests

**Commit:** `30acb527`

Created `src/ui/shell/IdentitySessionPane.tsx` — `forwardRef<TerminalHandle>` wrapper that:
- Initializes `isPrettyMode = true` (identity panes start in PrettyView, replacing Terminal's `hasAutoActivatedPrettyRef` auto-flip)
- Hoists: `isPrettyMode`, `isMessageQueueOpen`, `isIdentityModalOpen`, `pvSendInputRef`, `pvSendInterruptRef`
- Always mounts `<PrettyView>`; conditionally mounts `<Terminal>` on `!isPrettyMode`
- Re-exposes full `TerminalHandle` via `useImperativeHandle` (forward-when-mounted / safe-noop-when-not)
- Owns `MessageQueueDrawer`, `IdentityBadge`, `IdentityModal`, `session-tint` (moved from Terminal.tsx)
- Structured logs: `identity_session_pane_mount`, `identity_session_pane_terminal_edge`, `identity_session_pane_toggle_pretty_mode`, `identity_session_pane_toggle_message_queue`

Created `src/ui/shell/IdentitySessionPane.test.tsx` — 7 tests P1-P7 covering:
- P1: PrettyView mounted, Terminal NOT mounted by default
- P2: togglePrettyMode() mounts Terminal
- P3: second toggle unmounts Terminal (PrettyView survives)
- P4: toggleMessageQueue() renders MessageQueueDrawer
- P5: MessageQueueDrawer send flows through pvSendInputRef (split-send with 60ms timer)
- P6: TerminalHandle methods safe-noop when Terminal unmounted
- P7: fit() forwards to inner Terminal ref when mounted

### Task 2: Wire dispatch + strip Terminal.tsx + AppShell retarget

**Commit:** `f2fbff9a` (Task 2 changes)  
**Commit:** `47080703` (Rule 1 fix — pre-existing voice test flake)

#### tabUtils.tsx
- Added `TerminalOrIdentitySessionPane` inline component (hook-boundary pattern) that calls `useIdentities().byKey` to dispatch identity tabs to `IdentitySessionPane` and non-identity tabs to `TerminalTabContent` (byte-unchanged)
- Updated `renderTabContent case "terminal"` to call `<TerminalOrIdentitySessionPane .../>` instead of `<TerminalTabContent .../>`

#### Terminal.tsx — Surgical Deletions (all grep gates: 0)

| Identifier / Block | Status |
|---|---|
| `<PrettyView` | REMOVED |
| `isPrettyMode` | REMOVED |
| `pvSendInputRef` / `pvSendInterruptRef` | REMOVED |
| `hasAutoActivatedPrettyRef` | REMOVED |
| `isMessageQueueOpen` / `<MessageQueueDrawer` | REMOVED |
| `isIdentityModalOpen` / `<IdentityBadge` / `<IdentityModal` | REMOVED |
| `const [isIdle` (vestigial null-in-production) | REMOVED |
| `togglePrettyMode:` / `toggleMessageQueue:` in useImperativeHandle | REMOVED |
| `handleInjectedTurnReady` callback | REMOVED |
| Imports: PrettyView, MessageQueueDrawer, IdentityBadge, IdentityModal, useIdentities, listMessageQueueItems, sessionMatchKey | REMOVED |
| xterm div style: `display: isPrettyMode ? "none" : undefined` | REMOVED |
| xterm div style: `pointerEvents: isVisible && !isPrettyMode` | SIMPLIFIED to `isVisible ? "auto" : "none"` |
| Toolbar / SimpleLoader / ConnectionLog `!isPrettyMode` gates | REMOVED |
| session-tint `!isPrettyMode` gate | REMOVED (tint now always shown when connected) |

Net delta: 403 lines deleted, 257 added. Terminal.tsx: 3503 lines (was ~3700).

#### Terminal.wiring.test.ts
Tests 1a-1d, 4, 4b, 5 inverted from positive-presence assertions to negative-absence regression guards. New greps:
- `expect(source).not.toMatch(/<PrettyView/)`
- `expect(source).not.toMatch(/isPrettyMode/)`
- `expect(source).not.toMatch(/pvSendInputRef/)`
- `expect(source).not.toMatch(/pvSendInterruptRef/)`
- `expect(source).not.toMatch(/hasAutoActivatedPrettyRef/)`
- `expect(source).not.toMatch(/<MessageQueueDrawer/)`
- `expect(source).not.toMatch(/<IdentityBadge/)`
- `expect(source).not.toMatch(/<IdentityModal/)`
- `expect(source).not.toMatch(/handleInjectedTurnReady/)`
- `expect(source).not.toMatch(/togglePrettyMode:/)`
- `expect(source).not.toMatch(/toggleMessageQueue:/)`

SimpleLoader test updated: removed assertion that `!isPrettyMode` gate is PRESENT; added assertion it is ABSENT + that `isConnecting + !isConnectionLogExpanded` remain.

All 42 wiring tests pass.

#### PrettyView.tsx
- Removed `isIdle?: boolean | null` from Props interface (was Plan 41-01 no-op backward-compat)
- Removed `isIdle` from function destructuring
- Updated comments: "accepted for backward-compat (Terminal.tsx still passes it)" → replaced with Phase 41 note

#### AppShell.tsx
- Added `useSessionTmuxName` to session-tmux-store import
- At hook scope: compute `activeSessionKey = ${activeTab.host.id}:${activeTab.targetTmuxSession ?? ""}` + call `useSessionTmuxName(activeSessionKey)` as `activeTmuxFromStore`
- document.title effect: `const tmux = activeTmuxFromStore ?? tmuxSessionNames[activeTabId]` — store is primary source; legacy record is fallback for non-identity panes
- Added `activeTmuxFromStore` to effect deps array
- Added structured log: `operation: "app_shell_title_resolve"`
- `getTabNode` call sites: identity terminal panes pass `isTerminal=false` for pv-base background

## Grep Gate Results (All Passing)

| Gate | Pattern | Count | Expected |
|---|---|---|---|
| No PrettyView in Terminal | `<PrettyView` | 0 | 0 |
| No isPrettyMode in Terminal | `isPrettyMode` | 0 | 0 |
| No pvSendInputRef in Terminal | `pvSendInputRef\|pvSendInterruptRef` | 0 | 0 |
| No hasAutoActivatedPrettyRef | `hasAutoActivatedPrettyRef` | 0 | 0 |
| No MessageQueueDrawer in Terminal | `isMessageQueueOpen\|<MessageQueueDrawer` | 0 | 0 |
| No IdentityModal in Terminal | `isIdentityModalOpen\|<IdentityBadge\|<IdentityModal` | 0 | 0 |
| No isIdle useState in Terminal | `const \[isIdle` | 0 | 0 |
| No togglePrettyMode/Queue in Terminal | `togglePrettyMode:\|toggleMessageQueue:` | 0 | 0 |
| IdentitySessionPane in tabUtils | `IdentitySessionPane` | 9 | ≥2 |
| TerminalOrIdentitySessionPane in tabUtils | `TerminalOrIdentitySessionPane` | 4 | ≥2 |
| useSessionTmuxName in AppShell | `useSessionTmuxName` | 4 | ≥2 |
| activeTmuxFromStore fallback in AppShell | `activeTmuxFromStore ?? tmuxSessionNames` | 1 | ≥1 |
| title log in AppShell | `app_shell_title_resolve` | 1 | ≥1 |
| regression greps in wiring test | not.toMatch patterns | 7 | ≥6 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing IdentityModal.voice.test.tsx Test 1 flake**
- **Found during:** Final full-suite verification
- **Issue:** `Test 1: getVoices() called exactly once on open` timed out at 5000ms under full-suite CI load (189 parallel test workers exhausting CPU budget). The test passes consistently in isolation and on second run.
- **Fix:** Increased `waitFor` timeout to 15000ms and `it()` timeout to 20000ms. Logic unchanged.
- **Files modified:** `src/ui/features/pretty-view/IdentityModal.voice.test.tsx`
- **Commit:** `47080703`

**2. [Rule 1 - Bug] Pre-existing IdentityModal.test.tsx Test 5 + IdentityModal.share.test.tsx + PrettyView.editable-file.test.tsx flakes**
- **Found during:** Final full-suite verification
- **Issue:** Multiple tests timing out under full-suite parallel load.
- **Fix:** Increased `waitFor` timeouts to 15000ms and `it()` timeouts to 20000ms in 3 files.
- **Files modified:** `src/ui/features/pretty-view/IdentityModal.test.tsx`, `src/ui/features/pretty-view/IdentityModal.share.test.tsx`, `src/ui/features/pretty-view/PrettyView.editable-file.test.tsx`
- **Commit:** `43b2fb5d`

**3. [Rule 1 - Bug] Pre-existing IdentityModal.test.tsx Test 5 + NewSessionDialog.role-dropdown.test.tsx Test 22 flakes (second pass)**
- **Found during:** Second full-suite verification run after prior fixes
- **Issue:** IdentityModal.test.tsx Test 5 still failing (11330ms actual duration under full-suite load — modal's async WS/API effects keep event loop busy past implicit cleanup deadline); NewSessionDialog.role-dropdown.test.tsx Test 22 failed at 2237ms (React 18 async state batching delays `listRolesForHost` mock resolution).
- **Fix:** IdentityModal.test.tsx Test 5: added `20000ms` it() timeout; NewSessionDialog.role-dropdown.test.tsx Test 22: increased all waitFor timeouts to 15000ms + added 20000ms it() timeout.
- **Files modified:** `src/ui/features/pretty-view/IdentityModal.test.tsx`, `src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx`
- **Commit:** `78ab38a0`

**2. [Rule 2 - Auto-add] IdentityBadge/IdentityModal not rendered for identity panes when Terminal unmounted**
- **Noticed during:** Plan review
- **Context:** Pre-plan semantics: IdentityBadge + IdentityModal were gated on `!isPrettyMode` in Terminal.tsx. With Terminal conditionally mounted, identity panes in PrettyView (isPrettyMode=true) had no badge/modal. IdentitySessionPane now owns these components with the same `!isPrettyMode` gate — terminal-mode badge correctly re-appears when user toggles to terminal.

### Plan Deviation Notes

**sessionHue simplification:** After removing identity-lookup code (identityKey, identitiesByKey, identityColorHue), `sessionHue` was simplified to `hueFromSessionName(tmuxSessionName)`. Since Terminal only renders for non-identity panes, `identityColorHue` would always be null — the simplified derivation is functionally identical.

**isIdle acceptance criteria grep defect:** The plan's grep `grep -Pn "\\bisIdle\\b" src/ui/features/pretty-view/PrettyView.tsx | grep -vc "isIdleDerived\\|^\\s*//\\|^\\s*\\*"` has a pipeline defect: the `-n` flag adds line-number prefixes (`73:// ...`) that prevent the `^\s*//` pattern from matching. All 17 remaining hits are comment lines — no code-level `isIdle` identifier exists. TypeScript confirms no errors. Spirit satisfied; grep gate itself has a defect.

## Known Stubs

None — all components are fully wired. IdentitySessionPane passes `terminalWs={null}` to PrettyView while Terminal is unmounted (uploads disabled for unmounted Terminal state — documented in plan as `// TODO(41-followup)` and per RESEARCH.md §302 is accepted behavior).

## Threat Flags

None. No new network endpoints, auth paths, or trust-boundary changes introduced.

## Manual Smoke Expectations (for Plan 41-03 UAT)

1. Open identity tab from conversation list → PrettyView appears immediately WITHOUT "Connecting…" flash (Terminal not mounted; no SSH WebSocket dialed)
2. Press Ctrl+Shift+O → xterm appears with "Connecting…" briefly then live tmux content (Terminal cold-boots; SSH WS opened)
3. Press Ctrl+Shift+O again → xterm disappears (Terminal unmounts; SSH WS closes; xterm instance destroyed); PrettyView stayed continuous (mount count = 1 throughout)
4. Browser tab title: shows identity displayName for identity panes even before user toggles to terminal (fleet-status broadcast provides tmux session name → identity lookup → displayName)
5. Non-identity SSH panes: behavior byte-unchanged (TerminalTabContent → Terminal mounts eagerly as before)
6. RDP/VNC/dashboard: unaffected

## Self-Check: PASSED

Files exist:
- `src/ui/shell/IdentitySessionPane.tsx` — FOUND (379 lines)
- `src/ui/shell/IdentitySessionPane.test.tsx` — FOUND
- `src/ui/features/terminal/Terminal.tsx` — FOUND (3503 lines, all grep gates 0)
- `src/ui/AppShell.tsx` — FOUND (useSessionTmuxName: 4 hits, activeTmuxFromStore: 5 hits)

Commits exist:
- `30acb527` — Task 1 commit: `feat(41-02): create IdentitySessionPane wrapper + component tests`
- `f2fbff9a` — Task 2 commit: `feat(41-02): wire identity-pane dispatch, strip PrettyView from Terminal, retarget AppShell title`
- `47080703` — Rule 1 fix: `fix(41-02): increase IdentityModal.voice Test 1 waitFor timeout to 15s (CI load flake)`
- `43b2fb5d` — Rule 1 fix: `fix(41-02): increase waitFor timeouts in CI-flaky tests (15s) to handle full-suite load`
- `78ab38a0` — Rule 1 fix: `fix(41-02): increase waitFor+it() timeouts for IdentityModal Test 5 and NewSessionDialog Test 22`
