---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
last_updated: "2026-07-23T01:52:00.000Z"
last_activity: 2026-07-23 - Completed quick task 260723-2cg: Add a subtle inside-textarea send button to the pretty-view ComposeBox (patch #129)
progress:
  total_phases: 10
  completed_phases: 6
  total_plans: 42
  completed_plans: 36
  percent: 60
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-17)

**Core value:** Ashley never loses access to her fleet — every change preserves reliable browser SSH+RDP, features are added around that hard constraint
**Current focus:** Phase 10 — pretty-conversations-visual-language-rework (COMPLETE-PENDING-DEPLOY)

## Current Position

Phase: 10 (pretty-conversations-visual-language-rework) — CODE-COMPLETE-PENDING-DEPLOY
Plan: 5 of 5 shipped
Status: Batched with #123-#127 pending Ashley's morning greenlight on visual behavior; deploy sequence documented in `.planning/phases/10-pretty-conversations-visual-language-rework/10-UAT-CHECKLIST.md` under "Post-UAT deploy runbook"
Last activity: 2026-07-23 - Completed quick task 260723-6xb: Patch #133 — shadcn strip + Skynet base color rebase to #0a0b12

Progress: [██████████] 100% (Phase 10 code-complete on feat/tab-title-from-tmux; deploy deferred to Ashley greenlight)

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
| Phase 09 P03 | 180 | 1 tasks | 1 files |
| Phase 10 P02 | 419 | 2 tasks | 2 files |
| Phase 10 P04 | 15min | 3 tasks | 4 files (3 deleted, 1 modified) |
| Phase 10 P05 | 5min | 3 tasks | 4 files (3 docs created + 1 SUMMARY + STATE.md updated) |

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
- [Phase ?]: Plan 09-03: closestFlexRowAncestor walker helper defined in describe block scope; compareDocumentPosition used for DOM order assertion in Test A

### Pending Todos

None yet.

### Blockers/Concerns

None yet. Every deploy behind mandatory 15-min deadman rollback per fork DEPLOY DISCIPLINE — not a blocker, a standing constraint.

### Roadmap Evolution

- 2026-07-21: Phase 6 added — Telegram-like interface. Shape agreed via `/open telegram-like-interface`; full shape file at `.planning/shapes/shape-telegram-like-interface.md`. Bounty tracker: `~/.claude/identities/tina/bounties/telegram-like-interface/`.
- 2026-07-21: Phase 7 added — Fleet-native conversation list. Follow-up to Phase 6 addressing UAT gaps (fleet-native data source, RDP row rendering, pencil re-style, mobile gear duplicate fix). Shape agreed via `/open fleet-native-conversation-list`; full shape file at `.planning/shapes/shape-fleet-native-conversation-list.md`. Bounty tracker: SAME as Phase 6 (`telegram-like-interface`) — one bounty spans both ship steps.
- 2026-07-21: Phase 8 added — Quality-of-life batch (thumbs-up rename to "works for me", identity modal chat-region overlay, bounty slugs + priority-primary sort, submit-bug fix). Bundled with Phase 7 into a single build/deploy behind one deadman. Ships as patches #107–#111 (or combined #107) on `feat/tab-title-from-tmux` branch. Master plan at `~/.claude/plans/twinkling-strolling-eclipse.md`. Closes bounties: `works-for-me`, `identity-modal-uncover-composebox`, `identity-modal-bounty-sorting` (which absorbed the "show slugs" ask), `messages-land-in-box-not-submitting`.

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
| 260722-ctq | Hybrid compose-submit path (patch #118) — replaces CR-in-PTY submit tail with `tmux send-keys Enter` via exec on same sshConn (body still PTY-written; falls back to CR-in-PTY when tmuxSessionName is null). Supersedes patches #100/#111a which tried paste-detection delay tuning. Empirically validated in session prototype (10/10 steady, multi-line preserved). Awaiting deploy. | 2026-07-22 | 7d6506f | [260722-ctq-fix-messages-land-in-box-not-submitting-](./quick/260722-ctq-fix-messages-land-in-box-not-submitting-/) |
| 260722-ddg | Drafts belt-and-suspenders localStorage mirror (patch #119) — client-side mirror for compose-box + message-queue drafts survives container-restart draft loss regardless of any server-side failure mode. Every keystroke + every successful debounced server save writes to `localStorage`; on mount if the server returns empty and ls has content, restore and schedule an autosave. Extracts `scheduleItemAutosave` from `handleBodyChange` so the hydrate loop can reuse the same 400ms PATCH machinery. Four diagnostic `console.warn` lines (2 per surface) log serverLen vs lsLen for the follow-up root-cause bounty. Deploy deferred to a batch after bounties #3-5. | 2026-07-22 | 58d3c83 | [260722-ddg-patch-119-drafts-belt-and-suspenders-loc](./quick/260722-ddg-patch-119-drafts-belt-and-suspenders-loc/) |
| 260722-dwe | Compose-box stop button (patch #120) — Ctrl-C safety valve for when Claude Code goes rogue mid-run from the pretty view. Square-icon `<Button>` in ComposeBox aux group (left of ThumbsUp, warm-neutral Glass; not `canSend`-gated). New WS `{ type: "interrupt" }` triggers backend `case "interrupt":` which fires `tmux send-keys -t <session> C-c` on the same multiplexed sshConn as patch #118, with raw `\x03`-byte PTY fallback for non-tmux panes / exec errors. No `setTimeout` wrapper (Ctrl-C interrupts Ink regardless of paste-detection framing). Two `sshLogger.info` events for diagnostic pinning. Deploy deferred: batched with #118-#122. | 2026-07-22 | 1bd0fd8 | [260722-dwe-patch-120-compose-box-stop-button-ctrl-c](./quick/260722-dwe-patch-120-compose-box-stop-button-ctrl-c/) |
| 260722-eea | Remove vestigial send button (patch #121) — pure trim of `<Button><Send/></Button>` block, `Send` lucide import, and dead `sendDisabled` derived state from ComposeBox. Bounty `send-button-bigger` re-scoped mid-session after Ashley confirmed Enter (patch #118) is her sole submit path; cleaner aux row: Paperclip / Square (stop) / ThumbsUp / Hourglass. Single file, +4/-28. tsc clean. Deploy deferred: batched with #118-#122. | 2026-07-22 | f452c2e | [260722-eea-patch-121-remove-vestigial-send-button-f](./quick/260722-eea-patch-121-remove-vestigial-send-button-f/) |
| 260722-eqv | Meter reset triggers session-holding overlay instant + zero-lock + red-bubble failure (patch #122). Three coordinated fork-side mechanics on the existing Phase-3 session-recycling state machine, backend untouched: (1) `onResetClicked?` callback threaded PrettyView→ComposeBox, fired synchronously at top of `handleResetSend` so patch #74's 350ms overlay delay-arm starts NOW instead of waiting for the backend `session_holding` WS frame; (2) `isHolding?` prop on ComposeBox adds `&& !isHolding` to the meter `isLit` conjunction so all 12 segments render unlit for the whole recycle window (well/border/glow/reset-cell unchanged, drain-sweep #83 unchanged); (3) `holdingTimeoutError` state → `error?` prop on SessionHoldingOverlay drives a warm-red variant (RefreshCcw `hsl(0,72%,60%)` matching meter red-band palette, subtle warm-red inset card glow, "Session recycle failed — refresh to check", aria-label swap, NO `animate-spin` — motion guardrail #72 preserved), triggered by either the backend `inactive { reason: 'holding_timeout' }` frame OR a client-side 120s belt-and-suspenders `useEffect` timer (survives WS drop). `case "inactive"` split by reason so holding_timeout doesn't unmount the compose box. tsc clean, +159/-8 across three files, no tests touched. Closes the fifth of five 2026-07-22 bounties. Deploy deferred: batched with #118-#121. | 2026-07-22 | 4bfa2e5 | [260722-eqv-patch-122-meter-reset-triggers-session-h](./quick/260722-eqv-patch-122-meter-reset-triggers-session-h/) |
| 260722-g2x | Decouple paperclip visibility from touch-target height (patch #123) — splits the overloaded `showPaperclip` prop into two independent gates on ComposeBox: `showPaperclip` still governs paperclip Button mount, new `isTouchDevice` prop now governs the Row 1 `min-h-[44px]` vs `min-h-8` decision. PrettyView mount site rewired to pass `showPaperclip={true}` unconditionally (post-#121 aux-row has room) and `isTouchDevice={isTouchDevice}` from the existing `useIsTouchDevice()` const (patch #102, unchanged). Two Phase 9 Layout row-height tests re-anchored to the new prop (titles + `baseProps` calls updated; assertions unchanged); Tests 3 & 4 (paperclip visibility) untouched — the prop's ONLY concern is still visibility there. Ashley now gets the paperclip on desktop pretty-view in the compact row. tsc clean, +45/-17 across 3 files. Vitest: all patch-#123-relevant tests green (Tests 3, 4, both updated Phase 9 layout tests, meter horizontal, textarea rows); 3 pre-existing failures from patch #121's stale Send-button test references logged as deferred follow-up (out of patch #123 scope per GSD SCOPE BOUNDARY rule). Deploy deferred: batched with #118-#122. | 2026-07-22 | c656254 | [260722-g2x-patch-123-decouple-paperclip-visibility-](./quick/260722-g2x-patch-123-decouple-paperclip-visibility-/) |
| 260722-mp6 | PWA safe-area polish (patch #126) — 3-file +2/-2 diff resolving Ashley's UAT feedback on the #125 iOS install. (1) `body { background-color: var(--background) }` in src/ui/index.css so top/bottom safe-area regions render Skynet-gray (cascades via `.dark` ancestor → `--background: oklch(0.155 0.004 128.73)`) instead of browser-default black. (2) Drop `paddingBottom: max(env(safe-area-inset-bottom), 0px)` from the AppShell outer div style (src/ui/AppShell.tsx:1738-1742) — shell bg now extends to viewport bottom edge; `paddingTop` preserved so status-bar clock/battery stay readable. (3) Append `pb-[env(safe-area-inset-bottom)]` to the ConversationsPanel scroll container className (src/ui/sidebar/ConversationsPanel.tsx:229) so the last item rests above the iOS home indicator; desktop no-op via env()=0. No scope creep: no root-cause chase for 100dvh-vs-flex, no preemptive padding on other scroll containers, manifest/index.html/icons/nginx untouched. tsc clean, git diff --stat shows exactly the 3 target files, all four plan `<verify>` assertions pass. No push, no build, no deploy — batched with #118-#125 behind Tina's 15-min deadman rollback pending Ashley greenlight on visual behavior. | 2026-07-22 | 0f87d02 | [260722-mp6-patch-126-pwa-safe-area-polish-blend-bod](./quick/260722-mp6-patch-126-pwa-safe-area-polish-blend-bod/) |
| 260722-i1r | Skynet rebrand + PWA install (iOS) + zoom lock (patch #125) — six-workstream PWA install polish for Ashley's iPhone. (1) index.html head rewrite: viewport zoom-lock (maximum-scale=1, user-scalable=no, viewport-fit=cover), theme-color #080808 (Skynet-locked), mobile-web-app-capable, apple-mobile-web-app-title "Skynet", 5 apple-touch-icon links (180/152/120/76/60), 2 favicon PNG links (32/16), manifest link → /manifest.webmanifest, <title> "Skynet"; scrollbar <style> and window.__TERMIX_BASE_PATH__ preserved. (2) New public/manifest.webmanifest — Skynet name/short_name, standalone, portrait-primary, #080808 colors, 192+512 icons. (3) 10 icon PNGs copied to public/ (1024 master intentionally NOT shipped). (4) Both nginx confs updated (CLAUDE.md symmetry) — symmetric `location = /manifest.webmanifest` block with `types { } + default_type application/manifest+json;` in HTTP and HTTPS confs. (5) Safe-area CSS: body { overscroll-behavior: none; } + .safe-top utility beside .safe-bottom; AppShell outer div extended with `paddingTop/paddingBottom: max(env(safe-area-inset-*), 0px)` inline (browser-tab mode unaffected). (6) 13 user-visible Termix → Skynet renames — 5 TSX/TS (AppShell document.title fallback, main-axios server-error toast, AdminIdentitiesSection maintainer placeholder, HostEditorGuacamoleTabs Drive + client-name placeholders) + 8 en.json string values (source locale only; translated/*.json crowdin-managed). Internal identifiers preserved for rebase-ability: clearTermixSessionStorage, termix:* event names, Termix-Mobile UA + regex matchers, TermixAlert type, resolveTermixThemeColors, "Termix Dark/Light/Default" theme registry keys, github.com/Termix-SSH URLs, fork-history code comments, package.json name, docker image name. Mid-execution SKIP list expansion: added terminal-themes.ts:32 "Termix Default" registry display-name (same rationale as HostEditorData Termix Dark/Light — paired with unrenamable `termix` config key). tsc clean at edited lines (pre-existing type-debt at nearby lines unrelated); vitest 473/477 passing, 4 pre-existing ComposeBox failures (patch #121 Send-button residual + patch #124 "yes"→"let's go" ThumbsUp aria-label residual; STATE.md's "3-failure baseline" one patch stale). No push, no build, no deploy — SHIPPED locally, batched with #118-#124 behind 15-min deadman. | 2026-07-22 | f5019ea | [260722-i1r-patch-125-skynet-rebrand-pwa-install-ios](./quick/260722-i1r-patch-125-skynet-rebrand-pwa-install-ios/) |
| 260723-6xb | Patch #133 — strip shadcn wrappers from PrettyConversationsPanel (DropdownMenu/Tooltip/renderSettingsMenuItems/Settings-icon gone, showGear JSX branch deleted, onRailClick+isAdmin props dropped from typedef + AppShell call-site), inline 4 shadcn text-color sites to prototype hex/rgba (`text-[rgba(240,234,224,0.9)]` desktop title / `text-[#f0eae0]` pencil / `text-[#5c6070]/50` RDP monitor + label), port header padding `px-3 py-2` → `px-4 py-3` (matches prototype `.top-strip` 12px/16px). Skynet base color rebase to `#0a0b12` (= `--color-pv-base-end`, darkest anchor iOS blends into safe-area) across 4 sites: `.dark { --background }` in src/ui/index.css (`oklch(0.155 0.004 128.73)` → `#0a0b12`, drops the green Termix tint), `theme_color` + `background_color` in `public/manifest.webmanifest`, same in `public/manifest.json`, `<meta name="theme-color">` in `index.html` (repo root, not `src/ui/`). Tests 9+10 rewritten (Test 9 flipped to invariant "gear NEVER renders on desktop"; Test 10 drops removed props); 27/27 pretty-conversations tests pass. `NewSessionDialog` + rows + PinAction untouched (already clean per prototype lock). Grep gates: no shadcn residuals in panel; `#0a0b12` present ≥7 times across the 4 target files; no `#080808`/`#09090b`/`#080808` residuals in manifests/index.html. tsc `--noEmit` clean; full-tree vitest 504/506 (2 pre-existing patch #124 ThumbsUp aria-label residuals unchanged); `npm run build` 7.87s. Bundles with #131b (558749a), #131c (68e4f62), #132A (b749bf1), #132B (536d224) for one grouped deploy pending Ashley greenlight. Post-deploy iOS PWA reinstall required (remove + re-add from home screen) for the `#0a0b12` safe-area seam disappearance to be visible — iOS caches manifest colors at install time; desktop browsers pick up the new background immediately. | 2026-07-23 | 3d28512 | [260723-6xb-patch-133-strip-shadcn-wrappers-from-pre](./quick/260723-6xb-patch-133-strip-shadcn-wrappers-from-pre/) |
| 260723-2cg | Subtle inside-textarea Send button (patch #129) — Ashley-locked via DevTools console iteration (ChatGPT/iMessage-quiet, not amber-pop): bare `<button type="button">` (sidesteps shadcn wrapper specificity trap that bit #81/#117), absolute right-3 bottom-2.5 inside the existing `<div className="relative flex-1 self-stretch">` textarea wrapper that already hosts the queueArmed overlay. 40×40 hit target via `p-2` around a 24×24 lucide `SendHorizontal` with `fill="currentColor"`. Colors verbatim per Ashley: rest `text-[rgba(240,235,224,0.3)]`, hover `text-[rgba(240,235,224,0.9)]`, disabled `text-[rgba(240,235,224,0.15)]` + `cursor-not-allowed`. `transition-[color,transform] duration-120`, `active:scale-95`. Textarea gets `pr-10` (40px right padding) so typed text doesn't slide under the icon. Local `sendDisabled` const: `queueArmed || (canSend === false && !hasAttachments) || (text.trim() === "" && !hasAttachments)` — executor caught planner's `!canSend` (would over-disable when undefined) and corrected to strict `canSend === false` matching every other button in the file. onClick routes entirely through the existing `handleSend()` at ~line 652 — no branching duplication (attachment path, D-50 newline collapse, COMPOSE-04 clear-on-success all preserved). aria-label="Send", title="Send". Tests: 3 new (renders as bare button inside textarea wrapper; click-with-text calls onSend with trimmed payload + clears textarea; disabled Case A empty text + no attachments, Case B canSend=false + empty text). Bundled selector-hygiene fix: 3 pre-existing failing tests (Test 7, Test 8, Phase 9 aux-row) with orphaned `getByLabelText(/send message/i)` selectors from patch #121's Send-button removal updated to `getByRole('button', { name: 'Send' })`. Bundled test-hygiene: `localStorage.clear()` in both `beforeEach` blocks — patch #119 draft-ls mirror was bleeding between tests silently over-disabling Send. tsc clean, vitest 16/18 (2 remaining pre-existing failures are patch #124 `/send 'yes'/i` ThumbsUp residual — both aux-row + desktop min-h-8 hit the same stale selector so they fail together, out of scope per plan), `npm run build` succeeds in 8.87s. Two files, +131/-6. Stacks on the six-patch stack #123-#128 pending Ashley UAT + explicit deploy greenlight. | 2026-07-23 | 37986b2 | [260723-2cg-add-a-subtle-inside-textarea-send-button](./quick/260723-2cg-add-a-subtle-inside-textarea-send-button/) |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-22T18:25:00.000Z
Stopped at: Phase 10 Wave 5 complete — Phase 10 (pretty-conversations visual-language rework) is now code-complete-pending-deploy on `feat/tab-title-from-tmux`, batched with #123-#127 stack pending Ashley's morning greenlight. Wave 5 shipped 3 docs deliverables + 1 SUMMARY + STATE.md update in one atomic commit: (1) `10-BUILD-VERIFY-LOG.md` — tsc-clean, vitest 499/503 (4 pre-existing ComposeBox failures unchanged from Wave 4, documented in deferred-items.md), `npm run build` succeeds in 13.60s, AppShell bundle delta vs Phase 7 baseline +5,288 bytes for the new pretty-conversations component tree; (2) `10-UAT-CHECKLIST.md` — 19 non-negotiable items across Desktop (7) + Mobile iPhone (8) + Cross-viewport regression (4) + 3 polish items + failure route-back table + post-UAT deploy runbook (updated for the post-2026-07-21 no-deadman regime per user directive); (3) `10-PATCHES-MD-ENTRY.md` — paste-ready patch #128 draft in Tina's multi-commit-under-one-pin format (patches #104/#105 precedent) covering all 16 Wave 1-4 commits + Wave 5 SHA fill-in placeholder. Phase 10 landed 15 waves-worth of code across 5 waves: Wave 1 (foundation — PrettyConversationRow + PinAction + tokens, 12/12 tests), Wave 2 (PrettyConversationsPanel, 15/15 tests), Wave 3 (AppShell cutover + persistent top-left chevron toggle + narrow-window thin-strip retired — fixes Ashley's small-window sidebar-affordance regression), Wave 4 (3 retired sidebar files deleted, F3-diag fully retired, Test 1 pruned), Wave 5 (this docs commit). Ready state: Ashley walks the UAT checklist post-deploy on desktop + iPhone; if PASS, paste the patches-md draft into ~/.claude/identities/tina/termix-patches.md at ordinal #128 (bump count from ONE HUNDRED TWENTY-SEVEN → ONE HUNDRED TWENTY-EIGHT), commit the pin, `/close pretty-conversations-panel-redesign`. Follow-up bookkeeping unchanged: 4 pre-existing ComposeBox test failures (patch #121 stale Send-button refs + patch #124 stale ThumbsUp aria-label refs) still awaiting a Phase 11 test-hygiene sweep OR companion quick task.
Resume file: .planning/phases/10-pretty-conversations-visual-language-rework/10-UAT-CHECKLIST.md (Ashley's post-deploy walkthrough)
