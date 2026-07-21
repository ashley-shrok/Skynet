---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: verifying
last_updated: "2026-07-21T06:25:33.113Z"
last_activity: 2026-07-21
progress:
  total_phases: 7
  completed_phases: 4
  total_plans: 28
  completed_plans: 24
  percent: 57
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-17)

**Core value:** Ashley never loses access to her fleet — every change preserves reliable browser SSH+RDP, features are added around that hard constraint
**Current focus:** Phase 05 — pretty-view-file-upload-support

## Current Position

Phase: 05 (pretty-view-file-upload-support) — EXECUTING
Plan: 4 of 4
Status: Phase complete — ready for verification
Last activity: 2026-07-21

Progress: [██████████] 96%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| Phase 02 Plan 01 | 1 | 250s | 250s |
| Phase 02 Plan 02 | 1 | 420s | 420s |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 6 P01 | 15min | 2 tasks | 5 files |
| Phase 6 P2 | 25min | 2 tasks | 5 files |
| Phase 06 P03 | 13min | 2 tasks | 7 files |
| Phase 6 P04 | 14min | - tasks | - files |
| Phase 06 P05 | 10min | 3 tasks | 4 files |
| Phase 07 P01 | 660 | 2 tasks | 5 files |
| Phase 07 P02 | 9min | 2 tasks | 5 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- 2026-07-17: Adopt GSD for the fork — patch #43 is large enough (~500+ lines, backend session-file tail + WS bridge + new pane component + compose box + layout refactor) to justify one-time GSD bootstrap
- 2026-07-17: Vertical-MVP phase mode (phase = user-visible slice) — matches how the fork has always worked
- 2026-07-17 (roadmap): Two-phase split — Phase 1 delivers the backend session-stream pipeline plus a minimal read-only view so the pipe is observable end-to-end before layering on toggle/compose/ergonomics ergonomic payoff in Phase 2
- 2026-07-17 (02-02): Newlines collapsed to spaces on send (D-50 Ink safety) — multi-line send-side preservation is a potential follow-up if Ashley requests it
- 2026-07-17 (02-02): ComposeBox independent of MessageQueueDrawer (D-73) — intentional duplication of split-send pattern; any future patch changing split-send timing must update both call sites
- 2026-07-17 (02-02): ComposeBox gated on status === streaming only — no compose box in connecting/inactive/error states
- [Phase ?]: conversation-store: allow-list of TabTypes (not deny-list) to prevent silent inclusion of future TabTypes
- [Phase ?]: ConversationsPanel header slot left empty for Plan 06-04 NewSessionButton insertion (NOTE-02)
- [Phase ?]: Reference-equality + shallow no-op guards in updateOpenTabs to prevent host-tree poll thrash (NOTE-05)
- [Phase ?]: Phase 6 Plan 02: TabBar.tsx DELETED (TG-11); conversation-store.selectedId drives visible pane via effectiveSelectedTabId in patch #35 DOM-move mechanism byte-for-byte preserved; T-06-02-01 mount-lifecycle contract proven by MountManager scaffold (Tests 1-3 programmatic, Tests 4-6 deferred to Plan 06-05 UAT per NOTE-08).
- [Phase ?]: Phase 6 Plan 02: SettingsRow at src/ui/sidebar/SettingsRow.tsx with renderSettingsMenuItems shared renderer — desktop gear + Plan 06-03 mobile row consume ONE canonical SETTINGS_MENU_ITEMS registry (NOTE-07 resolved).
- [Phase ?]: Plan 06-03: single-outer-div + CSS-hidden main content on mobile-list-screen chosen over TabPortalRoot extraction — preserves patch #35 createPortal + tabNodesRef DOM-move mechanism byte-for-byte.
- [Phase ?]: Plan 06-03: #mv=1 URL fragment key (short, no-collision) layered onto patch #25 fragment scheme via WorkspaceSpec.mobileView optional field. Same URLSearchParams encoding, same Chrome window-restore behavior.
- [Phase ?]: Plan 06-03: Test 6 popstate simulation via direct hashchange+popstate dispatch (jsdom back-stack leaks across cases within a file; no reset API). Real browser back fires same events on same listeners; contract equivalence preserved.
- [Phase ?]: Plan 06-03: SettingsRow mounted at BOTTOM of mobile ConversationsPanel scroller via settingsRowSlot: ReactNode prop (TG-10 compliance; leaves top slot for Plan 06-04 NewSessionButton).
- [Phase ?]: NOTE-03 resolved: landed re-decision (stale-guard first, pending-clear before no-change return) in selectConversation; NOT the first-draft (clear-at-top) variant
- [Phase ?]: T-06-04-04 race defense mitigated via selectConversationDeferred + module-scoped pendingSelectId + updateOpenTabs flush; 8 Vitest cases prove semantics
- [Phase ?]: T-06-04-01 defense-in-depth: SESSION_NAME_PATTERN client-side; empty name allowed (server auto-fills from tmux window title); backend tmux path UNCHANGED
- [Phase ?]: Task 4 (deploy) deferred to Ashley-gated main-orchestrator context per fork discipline (deploy-runbook.md)
- [Phase ?]: Build-verify grep gates use string literals (i18n + URL constants + empty-state copy) instead of user-defined identifier names — Vite minification mangles them (NOTE-04 fallback)
- [Phase ?]: Patches-md entry drafted as patch #105 with MULTI-COMMIT format (9 code commits under one pin, precedent from patch #104)
- [Phase ?]: Plan 07-01: fleet-native store extension shipped — FleetSession input + hostsFlat + union+dedup with openTabs-entry-wins collapse + fleetOnly INTERNAL routing marker + fleet::N::S ids + one-shot getSessionList fetch + hostsById memo + onDetachedRowClick handler with allowCreateTmux:false; 310/310 tests green
- [Phase ?]: Plan 07-02: RDP row placement via sentinel HostGroup (hostId=__rdp__); minimal ConversationList type diff, panel special-cases the sentinel to suppress the semibold header
- [Phase ?]: Plan 07-02: Pencil icon = lucide-react Pencil (Telegram-native); NewSessionButton function unchanged; NewSessionDialog untouched
- [Phase ?]: Plan 07-02: TG-18 mobile gear-dedup via shared useIsTouchDevice const in ConversationsPanel; showGear += !isTouchDevice; SettingsRow gate at AppShell:1348 unchanged
- [Phase ?]: Plan 07-02: RDP rendering via parallel RdpRow (inline in ConversationsPanel.tsx); ConversationRow.tsx UNTOUCHED preserving TG-13 shape lock

### Pending Todos

None yet.

### Blockers/Concerns

None yet. Every deploy behind mandatory 15-min deadman rollback per fork DEPLOY DISCIPLINE — not a blocker, a standing constraint.

### Roadmap Evolution

- 2026-07-21: Phase 6 added — Telegram-like interface. Shape agreed via `/open telegram-like-interface`; full shape file at `.planning/shapes/shape-telegram-like-interface.md`. Bounty tracker: `~/.claude/identities/tina/bounties/telegram-like-interface/`.
- 2026-07-21: Phase 7 added — Fleet-native conversation list. Follow-up to Phase 6 addressing UAT gaps (fleet-native data source, RDP row rendering, pencil re-style, mobile gear duplicate fix). Shape agreed via `/open fleet-native-conversation-list`; full shape file at `.planning/shapes/shape-fleet-native-conversation-list.md`. Bounty tracker: SAME as Phase 6 (`telegram-like-interface`) — one bounty spans both ship steps.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260717-vbw | Pretty-view WIP indicator (patch #51) — JSONL state-machine spinner bubble | 2026-07-17 | caafaa5 | [260717-vbw-work-in-progress-indicator-for-pretty-vi](./quick/260717-vbw-work-in-progress-indicator-for-pretty-vi/) |
| 260718-2dt | Message queue drawer auto-closes when send empties the queue | 2026-07-18 | 5f209ff | [260718-2dt-message-queue-drawer-auto-closes-when-se](./quick/260718-2dt-message-queue-drawer-auto-closes-when-se/) |
| 260718-340 | Fix message queue sync bugs (patch #55) — keepalive delete + full dirty flush on unload + 10s interval retry | 2026-07-18 | f4b845e | [260718-340-fix-message-queue-sync-bugs-patch-55-kee](./quick/260718-340-fix-message-queue-sync-bugs-patch-55-kee/) |
| 260718-43f | Fix pretty-view context% false-positive (patch #56) — bottom-8-lines slice + bar-glyph fallback | 2026-07-18 | 17c4079 | [260718-43f-fix-pretty-view-context-false-positive-m](./quick/260718-43f-fix-pretty-view-context-false-positive-m/) |
| 260718-4oi | Persist pretty-view ComposeBox draft body server-side per pane (patch #57) | 2026-07-18 | 4579ca7 | [260718-4oi-persist-pretty-view-composebox-draft-bod](./quick/260718-4oi-persist-pretty-view-composebox-draft-bod/) |
| 260718-87h | Backgrounded-agents panel in pretty view (patch #61) | 2026-07-18 | fe506e0 | [260718-87h-backgrounded-agents-panel-in-pretty-view](./quick/260718-87h-backgrounded-agents-panel-in-pretty-view/) |
| 260718-8tk | Plan-mode pending indicator in pretty view (patch #63) | 2026-07-18 | fb65084 | [260718-8tk-patch63-plan-mode-pending-indicator](./quick/260718-8tk-patch63-plan-mode-pending-indicator/) |
| 260718-s52 | Backgrounded-shells panel in pretty view (patch #68) | 2026-07-18 | 0a9d7a6 | [260718-s52-patch-68-add-backgrounded-shells-panel-t](./quick/260718-s52-patch-68-add-backgrounded-shells-panel-t/) |
| 260719-1mn | Prettify slash-command triplets in pretty-view chat bubbles | 2026-07-19 | b7ed756 | [260719-1mn-prettify-slash-command-triplets-in-prett](./quick/260719-1mn-prettify-slash-command-triplets-in-prett/) |
| 260719-4p8 | Identity-aware ComposeBox placeholder (patch #71) — "Message {displayName}…" | 2026-07-19 | 1a97a87 | [260719-4p8-replace-hard-coded-message-claude-placeh](./quick/260719-4p8-replace-hard-coded-message-claude-placeh/) |
| 260719-4yz | WIP indicator on BG agents/shells + strip bubble (patch #72) | 2026-07-19 | 9dfc406 | [260719-4yz-wip-indicator-on-bg-agents-shells-strip-](./quick/260719-4yz-wip-indicator-on-bg-agents-shells-strip-/) |
| 260719-5eh | Pretty-view auto-activate on identity resolution (patch #73) | 2026-07-19 | 21089f3 | [260719-5eh-pretty-view-auto-activate-on-identity-re](./quick/260719-5eh-pretty-view-auto-activate-on-identity-re/) |
| 260719-5ym | Centered blocking session-holding overlay (patch #74) — replaces top-bar banner with backdrop-blur scrim + glass card | 2026-07-19 | 72c4bd4 | [260719-5ym-patch-74-replace-pretty-view-top-bar-ses](./quick/260719-5ym-patch-74-replace-pretty-view-top-bar-ses/) |
| 260719-tjk | Cohesive-instrument compose meter (patch #83) — segmented meter well with integrated reset cell + top-to-bottom drain animation | 2026-07-19 | a4d38eb | [260719-tjk-patch-83-cohesive-instrument-compose-met](./quick/260719-tjk-patch-83-cohesive-instrument-compose-met/) |
| 260719-u29 | Queue button with isIdle watchdog + textarea pending overlay (patch #84) — Hourglass button between ThumbsUp and Send, fires message after 3s continuous idle | 2026-07-19 | 317ad17 | [260719-u29-patch-84-queue-button-hourglass-icon-in-](./quick/260719-u29-patch-84-queue-button-hourglass-icon-in-/) |
| 260719-uqx | Bump WipBubble spinner size (patch #85) — h-5 w-5 → h-7 w-7 (20px → 28px) | 2026-07-19 | d818d9c | [260719-uqx-patch-85-bump-wipbubble-spinner-size-fro](./quick/260719-uqx-patch-85-bump-wipbubble-spinner-size-fro/) |
| 260719-vil | Pretty-view image support (patch #86) — WS-inline b64 render of tool_result image blocks | 2026-07-19 | ab20b18 | [260719-vil-add-pretty-view-image-support-patch-86-w](./quick/260719-vil-add-pretty-view-image-support-patch-86-w/) |
| 260719-w8h | Pretty-view identity modal (v1 read-only bounties) — click badge → tabbed modal with current identity's bounties | 2026-07-19 | f17924f | [260719-w8h-pretty-view-identity-modal-v1-read-only-](./quick/260719-w8h-pretty-view-identity-modal-v1-read-only-/) |
| 260719-wyt | Pretty-view scroll new message to top of viewport when taller than viewport (patch #88) | 2026-07-19 | d6e40d1 | [260719-wyt-pretty-view-scroll-new-message-to-top-of](./quick/260719-wyt-pretty-view-scroll-new-message-to-top-of/) |
| 260720-17g | Identity modal — fill out Identity/History/Wakeups/Handoff tabs + rename Standing Directives → Identity + move to front | 2026-07-20 | 65d9577 | [260720-17g-identity-modal-tabs-identity-renamed-fro](./quick/260720-17g-identity-modal-tabs-identity-renamed-fro/) |
| 260720-3n2 | Identity modal cross-machine fetch (patch #92) — SSH to pane's host for identity artifacts | 2026-07-20 | 168b40d | [260720-3n2-identity-modal-cross-machine-fetch-ssh-t](./quick/260720-3n2-identity-modal-cross-machine-fetch-ssh-t/) |
| 260720-6rl | Pretty-view scroll model: clamp-anchor + Slack-follow (patch #96) — replaces broken patch-#88 scroll-to-top + broken GTG bottom-scroll with unified `scrollTop=min(followBottomTop, anchorPinTop)` state machine | 2026-07-20 | 3908b8b | [260720-6rl-pretty-view-scroll-model-clamp-anchor-sl](./quick/260720-6rl-pretty-view-scroll-model-clamp-anchor-sl/) |
| 260720-7m1 | Broaden pretty-view harness-wrapper filter (patch #97) — fixes #96 anchor-doesn't-hold bug caused by combined `<system-reminder>` + `<task-notification>` wakes slipping through strict startsWith/endsWith filter | 2026-07-20 | 0381b57 | [260720-7m1-broaden-pretty-view-harness-wrapper-filt](./quick/260720-7m1-broaden-pretty-view-harness-wrapper-filt/) |
| 260720-8nj | Gesture-based mode flip in useAutoScroll (patch #98) — replaces rAF-counter scroll-event heuristic with wheel/touchmove/keydown listeners; delayed programmatic scrolls no longer misfire as user gestures. Diagnosed via live console diagnostic. | 2026-07-20 | 7edd1d8 | [260720-8nj-replace-scroll-event-mode-flip-with-real](./quick/260720-8nj-replace-scroll-event-mode-flip-with-real/) |
| 260720-ama | 3D orb WIP indicator — canvas-rendered Fibonacci-lattice sphere (150 dots, dual-axis tumble, depth-modulated size/alpha) replaces Loader2 spinner in WipBubble. Ashley-approved winning variant after 4 rounds of tailnet-served prototyping. Awaiting deploy + pin. | 2026-07-20 | 54e06cd | [260720-ama-3d-orb-wip-indicator-canvas-based-fibona](./quick/260720-ama-3d-orb-wip-indicator-canvas-based-fibona/) |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-21T06:24:44.363Z
Stopped at: Phase 02 Plan 02 complete — ComposeBox created, PrettyView wired, Terminal.tsx split-send threaded. Ready for Wave 3 (Plan 03 deploy checkpoint).
Resume file: None
