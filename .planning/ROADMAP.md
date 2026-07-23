# Roadmap: Termix Fork — Pretty Session View (Patch #43)

## Overview

Patch #43 gives Termix terminal tabs holding a Claude Code tmux session a
second top-pane mode: a native web-chat rendering of the current session's
conversation, backed by tailing the JSONL session file the Claude process
writes on the remote host. A keyboard chord flips the top pane between the
existing tmux mode (default) and the new pretty mode. The queue drawer at
the bottom stays put. Sends go through the same split-send tmux input path
patch #40 established. No optimism on sends — messages appear when the
session file confirms them.

The work splits into two vertical slices. Phase 1 lands the backend
session-file discovery + tail + WebSocket bridge together with a minimal
read-only pretty view so the pipe is observable end-to-end in production
without any UI ergonomics yet. Phase 2 layers on the keyboard-chord toggle,
tmux/pretty layout coexistence, compose box, and native web selection /
click / paste behavior — the ergonomic payoff the shape file cares most
about. Both phases ship as fork commits behind the mandatory 15-minute
deadman rollback timer per the fork's DEPLOY DISCIPLINE.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Live session stream to browser + read-only pretty view** - Backend discovers the Claude process in the pane's tmux session, locates the JSONL session file, tails it, streams parsed conversational events over WebSocket, and renders them in a minimal read-only pretty view (with the no-active-session fallback) ✓ deployed to production 2026-07-17
- [x] **Phase 2: Toggle, compose, and native web ergonomics** - Keyboard chord flips the top pane between tmux and pretty modes with the queue drawer preserved, plus compose box with split-send and native browser text-selection / click-to-focus / readable-paste behavior ✓ deployed to production 2026-07-17 (Ctrl+Shift+O toggle + ComposeBox with inline send button + jump-to-latest pill)
- [ ] **Phase 3: Session changeover detection** - Pretty view detects when the current Claude session was recycled (via `/id reset`) or recovered (crash/reboot → `claude --resume`) and switches to tailing the new session's file without user intervention; edge-triggered on `/exit` marker with a discovery-repoll backstop on the existing 3s poller for SIGTERM-fallback and recover-in-different-cwd cases
- [ ] **Phase 4: Pretty view visual reskin — Glass depth aesthetic** - Reskin pretty view away from Termix's flat-brutalist styling to a warm dark Glass depth aesthetic with real physical dimensionality (multi-layer shadows, backdrop-filter blur, subtle rim highlights, atmospheric background gradient) and per-pane identity-hue carry-through (user bubble + context bar + send button + focus ring). CSS-only, no behavior changes; scope confined to `src/ui/features/pretty-view/` — terminal/RDP/dashboard/sidebar chrome untouched. Design spec: `/home/ubuntu/.claude/identities/tina/bounties/pretty-view-visual-overhaul/mock/index.html` (Glass tab).
- [x] **Phase 5: Pretty view file upload support** - Add a cognitively-free "attach a file" affordance to pretty view: drag-and-drop anywhere on the surface (primary), clipboard paste (first-class), mobile-only paperclip button (gated by useIsTouchDevice). Attachments stage as a chip strip; on send, files transfer atomically to the receiving box (landing at `~/pretty-view-uploads/<yyyy-mm-dd>/<hhmmss>-<original-filename>`) then an injected user turn carries path-only-with-metadata (never inlined bytes) so context cost is deferred to the moment the agent actually reads. Sender-side rendering as chip-bearing bubble; folder drops refused; one caption per batch; no auto-cleanup. Shape file: `.planning/shapes/shape-pretty-view-file-upload-support.md` (LOCKED, do NOT re-litigate). (completed 2026-07-20)
- [x] **Phase 6: Telegram-like interface** - Reshape Termix around a Telegram-style conversation-list interface. Sidebar becomes a flat single-select list of currently-active sessions grouped by host (existing tree order preserved); per-session pins float to the top. Only one conversation visible at a time; switching hides/shows without unmount, so sessions stay alive in-memory across switches within a page-load. Tab strip removed entirely. Mobile: list-vs-view flow with top-left back button; bottom navigation bar deleted; admin/settings destinations migrated to unobtrusive gear (desktop) or list row (mobile). Deferred to v2: activity/unread signals of any kind. Out entirely: cross-conversation search, folders, drag-to-reorder, ended-session history. Shape file: `.planning/shapes/shape-telegram-like-interface.md` (LOCKED, do NOT re-litigate). (completed 2026-07-21)
- [ ] **Phase 7: Fleet-native conversation list** - Follow-up to Phase 6. Reshape the list's data source from "browser-tab's open Termix tabs" to "fleet-discovered tmux sessions unioned with browser-tab's open tabs" so a fresh page-load shows the sessions running across the fleet (like the current sidebar host-tree + double-shift menu already do), not just what's open in this browser tab. Adds RDP host rows at the bottom (one per RDP-enabled host, monitor icon, no identity hue). Re-styles the existing New Session button as the Telegram-native pencil. Fixes the mobile gear/settings-row duplication from Phase 6 (gear desktop-only, settings-row mobile-only). Snapshot-on-page-load discovery, no polling — Ashley refreshes to update. Everything else from Phase 6 preserved verbatim (per-session pins, host grouping, mobile flow, tab-strip absence, session persistence, sidebar collapse). Shape file: `.planning/shapes/shape-fleet-native-conversation-list.md` (LOCKED, do NOT re-litigate).
- [x] **Phase 8: Quality-of-life batch** - Multiple small UX improvements shipped as one batch (completed 2026-07-21, retroactive roadmap entry).
- [ ] **Phase 9: ComposeBox redesign — 2-tall shell with horizontal ctx meter** - Restructure ComposeBox into a 2-tall shell with the horizontal ctx-meter running below the textarea, plus polish patches (completed 2026-07-22, shipped as patches #116-#122, retroactive roadmap entry).
- [ ] **Phase 10: Pretty-Conversations visual-language rework** - Replace the current shadcn-derived `ConversationsPanel` + `ConversationRow` with a clean-slate `src/ui/features/pretty-conversations/` component tree (mirrors the pretty-view precedent from Phase 4). Chunky Telegram-style row layout (~72px mobile / ~62px desktop, 48/40px identity-hue avatar disc with hue-ring, primary label + host-name secondary line), pretty-view visual language (glass gradients, identity-hue selected-row lift, Inter font, warm palette). Session-name IS identity-name convention baked in — no IdentityBadge chip on rows. Flat list, no section headers — pin glyph on row IS the pin marker. Mobile pin = swipe-left action; desktop pin = hover-reveal button. New session = compact pencil icon in the header (Telegram-native). Fix small-window desktop sidebar-affordance regression by adding a persistent top-left toggle in AppShell that survives at all window widths. Same component drives both viewports; AppShell swaps in place with no dual-mode ship (per shape-file rule). Delete old `ConversationsPanel` + `ConversationRow` after cutover. Design source-of-truth: `~/.claude/identities/tina/bounties/pretty-conversations-panel-redesign/{prototype.html,desktop.html}` (Ashley signed off 2026-07-22 v0.3 mobile + v0.1 desktop). Shape reference: `.planning/shapes/shape-telegram-like-interface.md` (LOCKED, model unchanged — this is presentation-only follow-up).
- [ ] **Phase 11: Skynet transformation — purge dead Termix surfaces (first slice)** - Ship-of-Theseus purge of Termix UI surfaces that Ashley does not see in Skynet. This-phase scope: (a) desktop landing surface becomes the pretty-conversations panel + PrettyView chat surface (NOT the Termix dashboard); (b) the left AppRail (icon buttons for dashboard, host manager, snippets, admin, settings) is deleted from `AppShell` and its file removed. Long-term goal (subsequent Phase 12+): rip host manager UI pages, snippets manager, admin console, ALL settings surfaces, Termix tab bar chrome, keyboard shortcut editor UI, and any backend routes that only served those deleted surfaces. Invisible-shell technical capability stays intact: tab plumbing (mount/unmount, WebSocket lifecycle, focus routing), terminal renderer (xterm.js), RDP/VNC/Guacamole panes, host CRUD BACKEND (data layer — the encrypted-SQLite host record store must NOT be touched; only its UI entry points via AppRail are removed). Palette authority for any surface color change stays `--color-pv-*` (theme-color, `--background` rebase all draw from the pretty-view token set, NOT Termix's dark-mode `--background`). Rebase risk HIGH — accept upstream divergence for deleted surfaces (Ashley 2026-07-23 verbatim: "we are not having settings at all" — this is total, not partial). Bounty tracker: `~/.claude/identities/tina/bounties/skynet-transformation-purge-dead-surfaces/`.
- [ ] **Phase 12: Skynet transformation — purge dead frontend surfaces (second slice)** - Second slice of the Ship-of-Theseus purge. Phase 11 stripped AppShell imports of ~13 dead panels + deleted AppRail + SettingsRow, but the panel FILES themselves stayed on disk. This phase deletes those orphan files + their transitive subtrees + dead locale strings. In scope: (a) `src/ui/sidebar/` panel files with zero remaining `src/` imports (HostsPanel, SessionsPanel, CredentialsPanel, QuickConnectPanel, SshToolsPanel, SnippetsPanel, HistoryPanel, SplitScreenPanel, ConnectionsPanel, UserProfilePanel, AdminSettingsPanel + AdminApiKeys/Identities/Management/Settings/Shared/UserDialogs sections + HostManager subtree + HostEditor* + HostCredentialList + HostShareModal + SidebarTree + CredentialEditorView); (b) `src/ui/dashboard/` subtree that Phase 11 orphaned (DashboardTab.tsx primary + Dashboard.tsx + SessionDashboard.tsx + NewSessionHostChips + RemoteHostChips + sshHostToHost.ts + cards/components/hooks/panels/ subdirs whose only consumers are dashboard files); (c) Termix tab bar chrome (top-level tab strip UI — invisible tab plumbing STAYS, only visible bar chrome dies); (d) keyboard shortcut editor UI; (e) dead locale strings across ~34 JSON files (pinAppRail, nav.dashboard, nav.hosts, nav.snippets, nav.admin, nav.credentials, nav.history, plus any transitively-dead key referencing the deleted surfaces). NOT in scope (deferred to Phase 13): backend routes serving now-dead UI — that has different blast radius (live API/WS testing) and gets its own phase after grep proves which routes are truly orphaned vs also serving the retained pretty-conversations panel. Verification per Plan 01 STRIP-LIST pattern from Phase 11: enumerate targets, prove each has zero surviving src/ imports, delete atomically with tsc-clean + tests-green per commit. KEEP: `sidebar/NewSessionDialog.tsx` (used by pretty-conversations pencil button), pretty-view/pretty-conversations/terminal/RDP/Guacamole/backend all untouched. Rebase risk HIGH — accept upstream divergence per Phase 11 pattern. Bounty tracker: `~/.claude/identities/tina/bounties/skynet-transformation-purge-dead-surfaces/`.

## Phase Details

### Phase 1: Live session stream to browser + read-only pretty view

**Goal**: A Claude Code tmux pane in Termix can display its live conversation as chat messages read from the remote session file, with a graceful no-active-session state
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: BACKEND-01, BACKEND-02, BACKEND-03, BACKEND-04, RENDER-01, RENDER-02, RENDER-03, FALLBACK-01, FALLBACK-02
**Success Criteria** (what must be TRUE):

  1. On a terminal tab whose tmux session is running Claude Code, the pretty view shows the full conversation from the start of the current session file, with user messages and Claude's text replies rendered as chat bubbles and nothing else (no tool calls, thinking, tokens, or metadata)
  2. New user messages and Claude replies appear in the pretty view within a second or two of landing in the session file on the remote host
  3. When the user is scrolled to the bottom, new messages keep the view pinned to the newest; when the user scrolls up, the view holds position and does not yank back
  4. On a tab with no Claude Code process currently running in its tmux session (shell prompt, exited Claude, or something else entirely), the pretty view shows only "no active Claude session" and does not reach back to any prior session file
  5. The behavior above works in production behind Termix's normal browser SSH plumbing without regressing any existing terminal, RDP, VNC, message-queue, identity, or session-list feature**Plans**: 5 plans

**Wave 1**

- [x] 01-01-PLAN.md — Discovery primitives: pane→process→session-file walker + JSONL conversational-message parser (BACKEND-01, BACKEND-02, FALLBACK-02)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Backend tail loop + WebSocket bridge on port 30003 (BACKEND-03, BACKEND-04, FALLBACK-01)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Frontend PrettyView + ChatMessage + auto-scroll hook + WS API (RENDER-01, RENDER-02, RENDER-03, FALLBACK-01)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-04-PLAN.md — Wire PrettyView into TerminalTabContent behind a URL-fragment gate (RENDER-01..03, FALLBACK-01..02)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01-05-PLAN.md — Nginx location blocks on both configs + end-to-end deploy smoke checkpoint (BACKEND-04)

**UI hint**: yes

### Phase 2: Toggle, compose, and native web ergonomics

**Goal**: The user can flip a Claude Code terminal tab into pretty mode and interact with it like a native web chat — compose and send messages, select and copy text with the normal cursor, paste and see what they pasted, click to focus without accidentally selecting
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: TOGGLE-01, TOGGLE-02, TOGGLE-03, RENDER-04, RENDER-05, COMPOSE-01, COMPOSE-02, COMPOSE-03, COMPOSE-04, COMPOSE-05
**Success Criteria** (what must be TRUE):

  1. On the active terminal tab, the user presses a dedicated keyboard chord and the top pane flips between the existing tmux mode and the pretty mode; every fresh terminal tab opens in tmux mode with no memory of the previous choice
  2. The message queue drawer stays at the bottom in the same position with the same behavior across mode flips
  3. In pretty mode, the user selects text with the native browser cursor and copies with the OS copy shortcut — no highlight-then-Enter dance — and clicking the pane focuses it without starting a selection
  4. The compose box below the conversation accepts typed and pasted text with full readable content (no "[pasted N lines]" collapse), Enter sends the message via the same split-send WebSocket input path the queue drawer uses (text and Enter as two events ~60ms apart), and Shift-Enter inserts a newline
  5. A sent message appears in the conversation only after the session file confirms it landed — never as an optimistic bubble that could lie about state

**Plans**: 3 (02-01 mode toggle, 02-02 compose box, 02-03 deploy checkpoint)
**UI hint**: yes

**Wave 1** *(complete)*

- [x] 02-01-PLAN.md — Mode toggle chord Ctrl+Shift+O + layout preservation (TOGGLE-01, TOGGLE-02, TOGGLE-03)

**Wave 2** *(blocked on Wave 1 completion, complete)*

- [x] 02-02-PLAN.md — Compose box + split-send through terminal WebSocket (COMPOSE-01..05)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 02-03-PLAN.md — Deploy checkpoint + UAT verification (RENDER-04, RENDER-05, COMPOSE-04, COMPOSE-05)

### Phase 3: Session changeover detection

**Goal**: When the current Claude session is recycled (`/id reset`) or recovered (`claude --resume`), pretty view detects the changeover within seconds and re-tails the new session without the user having to close and reopen the tab
**Depends on**: Phase 1, Phase 2
**Requirements**: CHANGEOVER-01, CHANGEOVER-02, CHANGEOVER-03, CHANGEOVER-04, CHANGEOVER-05
**Success Criteria** (what must be TRUE):

  1. When Ashley runs `/id reset` in a pane whose pretty view is open, the pretty view shows a "session recycling…" indication within ~1s of `/exit` landing in the current JSONL, then automatically switches to the new session and shows its conversation from the top — no manual tab close/reopen needed
  2. If the graceful `/exit` fails and the supervisor falls back to SIGTERM, the discovery-repoll on the existing 3s poller catches the changeover within ~5s and the same switch happens (no `/exit` seen, but same end state)
  3. If the pane's Claude process crashes and the supervisor recovers via `claude --resume <oldId>` — even to a different cwd → same session id but a different `projects/<slug>/` subdir — the pretty view detects the new file location and re-tails it
  4. During the ~5s bare-shell gap between old-session death and new-session launch, the pretty view holds the "recycling" indication instead of falling to the terminal "no active Claude session" fallback; the WebSocket connection is NOT torn down
  5. On the successful changeover, the messages / harness-tasks / context-% state resets to the new session; the identity badge and pane-tint (pane-scoped) remain unchanged
  6. If no new session appears within ~30-60s of the changeover trigger (rare — recycle failed to relaunch), the pretty view falls through to the terminal `no-active-session` state (existing FALLBACK-01 behavior)

**Plans**: 2 (03-01 backend state machine + two-layer detection, 03-02 frontend event handlers + holding banner)
**UI hint**: yes

**Wave 1**

- [ ] 03-01-PLAN.md — Backend state machine + Layer 1 raw-line /exit scan + Layer 2 discovery-repoll on the existing 3s ticker + new WS emits session_holding / session_changed / holding_timeout inactive (CHANGEOVER-01, CHANGEOVER-02, CHANGEOVER-05)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 03-02-PLAN.md — Frontend WS handlers for session_holding + session_changed + SessionHoldingBanner sibling component + client-side state reset (CHANGEOVER-01, CHANGEOVER-03, CHANGEOVER-04)

### Phase 4: Pretty view visual reskin — Glass depth aesthetic

**Goal**: Pretty view is reskinned from Termix's flat-brutalist styling to a warm dark Glass depth aesthetic with real physical dimensionality and per-pane identity-hue carry-through — CSS-only, all existing behavior preserved end-to-end, scope confined to `src/ui/features/pretty-view/` so terminal/RDP/dashboard/sidebar chrome is untouched
**Depends on**: Phase 1, Phase 2 (Phase 3 not a hard dependency — can ship independently, but SessionHoldingBanner from Phase 3 should adopt the same visual language when it lands)
**Requirements**: VISUAL-01, VISUAL-02, VISUAL-03, VISUAL-04, VISUAL-05, VISUAL-06, VISUAL-07, VISUAL-08, VISUAL-09, VISUAL-10
**Design spec**: `/home/ubuntu/.claude/identities/tina/bounties/pretty-view-visual-overhaul/mock/index.html` (Glass tab — the mock's CSS values are TARGETS, not exact copies; translate into Termix's Tailwind v4 idiom via `@theme inline {}` tokens where reused and scoped class-based styles per component elsewhere)

**Success Criteria** (what must be TRUE):

  1. Pretty view visually reads as a warm-neutral, physically-dimensional space with real depth cues — multi-layer shadow stacks on bubbles, subtle atmospheric background gradients, rim highlights on raised elements, backdrop-filter blur on translucent surfaces. No more flat-brutalist styling in this surface.
  2. Each pane's user bubble accent + border glow, context bar fill, send button glow, and textarea focus ring carry the identity's stored `colorHue` as a coherent color chain — one glance identifies which agent is talking. Falls back to a neutral accent when the identity has no `colorHue` set.
  3. Identity badge (top-right of pretty view) uses a ~56px avatar with name+title stacked to the right, plus a subtle slow breathing brightness animation (~5s cycle) as a grounding anchor. Preserves patch #38 hover-fade behavior wherever the badge is used, including its existing terminal-pane mount.
  4. The ambient panels shelf (HarnessTasksPanel + BackgroundedAgentsPanel + BackgroundedShellsPanel) reads as one quiet floating card treatment — findable but visually calm; compose surface reads as intentionally low-prominence (no card treatment); textarea has only a lightest-touch 1px warm-white outline; send button retains a saturated identity-hue glow as the ONE intentional attention-grab-point.
  5. All existing pretty-view functionality is preserved end-to-end — chat rendering, ComposeBox split-send/reset/go-ahead paths, all ambient panels, WipBubble, PlanPendingBubble, session-changeover holding/changed banners (when Phase 3 lands), empty state, error states, keyboard chords. Zero behavior changes, zero WebSocket protocol changes, zero prop/state/effect changes. CSS-only.
  6. Terminal / RDP / VNC / file manager / dashboard / sidebar / tab bar / AppRail chrome is visually unchanged — pretty view is a themed island in the current Termix visual system.

**Plans**: 3 (04-01 tokens + IdentityBadge size variant + PrettyView root hue plumbing; 04-02 per-component reskin of all 8 pretty-view components + IdentityBadge lg treatment consumption; 04-03 build verification + Nyquist UAT prep + AGENTS.md draft — no source diffs)
**UI hint**: yes (this whole phase IS visual)

**Wave 1**

- [ ] 04-01-PLAN.md — Phase 4 design tokens in @theme inline {} + IdentityBadge size prop (md default preserves patch #17/#38, lg = pretty-view treatment with 56px avatar + breathing brightness + hover-fade preserved) + PrettyView root wires --pv-id-hue CSS var via useSessionIdentity + mounts IdentityBadge size=lg (VISUAL-04, VISUAL-10 partial, VISUAL-01 partial, VISUAL-03 partial)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 04-02-PLAN.md — Reskin all 8 pretty-view components: bubbles (ChatMessage user+assistant, WipBubble, PlanPendingBubble) + banner (SessionHoldingBanner) + ambient panels shelf (HarnessTasksPanel, BackgroundedAgentsPanel, BackgroundedShellsPanel) + PrettyView root atmospheric depth + ComposeBox (quiet surround + lightest-touch textarea + identity-hue focus ring + saturated send-button glow + identity-hue context bar); Terminal.tsx UNTOUCHED (VISUAL-01, VISUAL-02, VISUAL-03, VISUAL-05, VISUAL-06, VISUAL-07, VISUAL-08, VISUAL-09)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 04-03-PLAN.md — Build verification (npm run build clean, Vite output contains Phase 4 tokens, Terminal.tsx untouched) + Nyquist UAT checklist generation (04-UAT-CHECKLIST.md walking VISUAL-01..10 for Ashley post-deploy) + AGENTS.md patch entry draft (04-AGENTS-MD-ENTRY.md ready to paste at PIN time). Zero source diffs. Deploy is Ashley's separate green-light per fleet rule.

### Phase 5: Pretty view file upload support

**Goal**: A user talking to an agent in pretty view can drop a file (or paste one, or on mobile tap a paperclip), write a caption, hit send — and the file(s) land at a predictable path on the receiving box while an injected user turn tells the agent where to find them, with zero surprise context cost, atomic transfer semantics, and the same action-shape as sending a plain message
**Depends on**: Phase 2 (compose box), patch #49 (draft persistence), patch #60 (atomic delete-on-send + messageQueueItemId), patch #100 (split-and-delay Enter path), patch #102 (useIsTouchDevice hook)
**Requirements**: UPLOAD-01, UPLOAD-02, UPLOAD-03, UPLOAD-04, UPLOAD-05, UPLOAD-06, UPLOAD-07, UPLOAD-08, UPLOAD-09, UPLOAD-10, UPLOAD-11, UPLOAD-12, UPLOAD-13, UPLOAD-14
**Shape spec**: `.planning/shapes/shape-pretty-view-file-upload-support.md` — LOCKED, do NOT re-litigate; the shape resolved every philosophical question (path-only injection, atomic transfer, `~/pretty-view-uploads/<date>/<time>-<name>` landing, mobile-only paperclip, chip strip, no auto cleanup, folder-drop refused, one caption per batch, works on any pane)

**Success Criteria** (what must be TRUE):

  1. On any pretty-view pane, the user can attach one or more files via drag-and-drop (desktop primary), clipboard paste, or (on touch devices only) a paperclip button, stage them as chips in a strip above the compose textarea, remove individual chips before send, then send with an optional caption — same action-shape as sending a plain message
  2. On send, all attachments transfer atomically to the receiving box: the injected user turn only appears once every file has landed successfully at `~/pretty-view-uploads/<yyyy-mm-dd>/<hhmmss>-<original-filename>`; if any file fails, the message stays in staging, chips turn red, retry is available
  3. The injected message contains the caption plus a compact metadata block per file (filename + size + mimetype + upload timestamp + landing path); file bytes are NEVER inlined into the message — attaching a 100MB file costs zero session context until the agent chooses to read it
  4. The paperclip button is invisible on desktop (any window width); dropping a folder is refused with a visible nudge; sender-side stream renders the sent message as a single bubble with inline chips (no thumbnails); caption drafts survive tab close but attachment bytes do not
  5. All existing pretty-view functionality is preserved end-to-end — plain-text send/receive, WipBubble, PlanPendingBubble, message queue drawer, identity badge, session changeover behavior, keyboard chords, split-and-delay Enter path (patch #100), atomic delete-on-send (patch #60). Zero regression to non-attach send flow.
  6. The feature works on both Claude Code panes AND plain-shell panes — the injected metadata block is meaningful to a human at a shell (they can `cat`/`less` the landing path) as much as to an agent (which can `@`-reference it)

**Plans**: 4 plans

Plans:
- [x] 05-01-PLAN.md — Backend upload orchestrator + shared wire-protocol types (upload_start/upload_chunk/upload_abort cases in terminal.ts, pretty-view-upload.ts module, formatInjectedUserTurn helper, sanitizeFilenameForUpload, all threat-model mitigations at ingress) (UPLOAD-06, UPLOAD-09, UPLOAD-10, UPLOAD-14)
- [x] 05-02-PLAN.md — Frontend chip strip + drop overlay + paste + mobile paperclip + usePrettyViewUploads orchestrator hook (chunk pump, batch atomicity, retry, per-chip progress, folder rejection, caption/attachment persistence asymmetry) (UPLOAD-01, UPLOAD-02, UPLOAD-03, UPLOAD-04, UPLOAD-05, UPLOAD-07, UPLOAD-08, UPLOAD-12, UPLOAD-13)
- [x] 05-03-PLAN.md — Terminal.tsx wiring (webSocketRef + handleInjectedTurnReady two-event split-send) + ChatMessage sender-side chip render + parseInjectedUserTurn round-trip parser (UPLOAD-06, UPLOAD-09, UPLOAD-11)
- [x] 05-04-PLAN.md — Deploy checkpoint: build verification, Nyquist UAT checklist for UPLOAD-01..14, termix-patches.md entry draft, mandatory 15-min deadman deploy under Ashley's separate green-light (all UPLOAD-01..14)

**UI hint**: yes

**Bounty of record**: `~/.claude/identities/tina/bounties/pretty-view-file-upload-support/` — in_progress + high priority; source of truth for progress across sessions.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Live session stream to browser + read-only pretty view | 5/5 | Complete | 2026-07-17 |
| 2. Toggle, compose, and native web ergonomics | 3/3 | Complete | 2026-07-17 |
| 3. Session changeover detection | 0/2 | Planning | — |
| 4. Pretty view visual reskin — Glass depth aesthetic | 0/3 | Planning | — |
| 5. Pretty view file upload support | 4/4 | Complete   | 2026-07-20 |
| 6. Telegram-like interface | 5/5 | Complete   | 2026-07-21 |
| 7. Fleet-native conversation list | 2/3 | In Progress|  |
| 9. ComposeBox redesign — 2-tall shell | 4/4 | Complete   | 2026-07-22 |
| 10. Pretty-Conversations visual-language rework | 5/5 | Complete-pending-deploy | 2026-07-22 |
| 11. Skynet transformation — purge dead Termix surfaces (first slice) | 0/4 | Planning | — |

### Phase 6: Telegram-like interface

**Goal:** Reshape Termix's navigation model around a Telegram-style conversation-list interface — sidebar as flat single-select list of active sessions (grouped by host, per-session pins floating on top), tab strip removed, mobile bottom-nav deleted in favor of list-vs-view flow with top-left back button, admin destinations relocated to an unobtrusive settings surface, and in-memory session persistence preserving live connections across switches within a page-load.

**Shape file (LOCKED, do NOT re-litigate):** `.planning/shapes/shape-telegram-like-interface.md`

**Requirements:** TG-01, TG-02, TG-03, TG-04, TG-05, TG-06, TG-07, TG-08, TG-09, TG-10, TG-11 (11 requirements, defined in `.planning/REQUIREMENTS.md` § Telegram-like Interface — Phase 6). Full scope edges — in / out / deferred-to-v2 / tempting-but-no — are enumerated in the shape file's Scope edges section.

**Depends on:** Phase 5

**Plans:** 5/5 plans complete

**Wave 1**

- [x] 06-01-PLAN.md — Foundation: conversation-store (pins + single-select + host-tree derivation), ConversationsPanel + ConversationRow with identity avatar + hue tint reused from TabBar idiom (TG-01, TG-02, TG-08)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06-02-PLAN.md — Tab-strip DELETION + persistence contract (mounted-but-hidden via patch #35 tabNodesRef mechanism) + settings-surface migration (desktop gear icon + SettingsRow for mobile mount) + AppRail default view swap to `conversations` (TG-03, TG-04, TG-05, TG-10, TG-11)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 06-03-PLAN.md — Mobile list-vs-view flow (mobile-flow module with `#mv=1` URL fragment surviving Chrome window-restore per patch #25 lesson) + top-left back button + MobileBottomBar DELETION + SettingsRow mounted at bottom of mobile ConversationsPanel (TG-06, TG-07)

**Wave 4** *(blocked on Wave 2 + Wave 3 completion — sequential due to AppShell.tsx + ConversationsPanel.tsx file overlap)*

- [x] 06-04-PLAN.md — New-session button + host picker modal + client-side name validation + selectConversationDeferred race defense + auto-navigate on create (mobile: also navigateToView) (TG-09)

**Wave 5** *(blocked on Waves 2-4 completion — deploy checkpoint)*

- [x] 06-05-PLAN.md — Build verification + UAT checklist walking TG-01..11 + patches-md entry draft + mandatory 15-min deadman deploy under Ashley's separate green-light (all TG-01..11)

**Bounty:** `telegram-like-interface` (tracker under Tina's identity — `~/.claude/identities/tina/bounties/telegram-like-interface/`). Moves to `in_progress` when the first plan enters execution.

### Phase 7: Fleet-native conversation list

**Goal:** Reshape the conversation list's data source from "browser-tab's open Termix tabs" to "fleet-discovered tmux sessions unioned with browser-tab's open tabs (deduplicated by session identity)" so a fresh page-load shows the sessions Ashley has running across her fleet. Add remote-desktop host rows at the bottom (one row per RDP-enabled host, monitor icon, no identity hue). Re-style the existing New Session button as the Telegram-native pencil. Fix the mobile gear/settings-row duplication carried over from Phase 6 (gear desktop-only, settings-row mobile-only). Snapshot-on-page-load discovery, no polling — Ashley refreshes to update. Everything else from Phase 6 preserved verbatim.

**Shape file (LOCKED, do NOT re-litigate):** `.planning/shapes/shape-fleet-native-conversation-list.md`

**Requirements:** TG-12, TG-13, TG-14, TG-15, TG-16, TG-17, TG-18 (7 requirements, defined in `.planning/REQUIREMENTS.md` § Fleet-native Conversation List — Phase 7 — continuation of the TG-XX numbering from Phase 6). Full scope edges enumerated in the shape file's Scope edges section.

**Depends on:** Phase 6

**Plans:** 2/3 plans executed

Plans:
- [x] 07-01-PLAN.md — Fleet-native store extension (FleetSession + updateFleetSessions + updateHostsFlat + union/dedup rows with fleetOnly marker) + AppShell one-shot getSessionList() fetch + detached-row-click transparent-attach handler (TG-12, TG-13, TG-14, TG-17)
- [x] 07-02-PLAN.md — RDP row rendering at bottom (monitor icon + no hue + rdpHostRow marker) + NewSessionButton pencil re-style + ConversationsPanel showGear mobile-fix via `!useIsTouchDevice()` gate + AppShell onRdpRowClick handler (TG-15, TG-16, TG-18)
- [ ] 07-03-PLAN.md — Deploy checkpoint: build verify + Nyquist UAT checklist for TG-12..18 + patches-md #106 draft + mandatory 15-min deadman deploy under Ashley's separate green-light (all TG-12..18)

**Bounty:** `telegram-like-interface` (SAME tracker as Phase 6 — one bounty spans both ship steps: patch #105 for Phase 6 + this phase's patch #106+). Bounty closes via `/close telegram-like-interface` after this phase ships + Ashley UAT.

### Phase 8: Quality-of-life batch: thumbs-up rename to "works for me", identity modal repositioned to chat-content region (composer stays uncovered), bounty rows show slugs, bounty sort becomes in_progress-fence-then-priority-flat, and submit bug fixed by collapsing pretty-view onSend to a single WS event carrying text+CR with messageQueueItemId attached. Bundled with Phase 7 into a single build/deploy. Master plan at ~/.claude/plans/twinkling-strolling-eclipse.md.

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 7
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 8 to break down)

### Phase 9: ComposeBox redesign — 2-tall shell with horizontal ctx meter

**Goal:** The ComposeBox at rest is ~2 button-heights tall (down from ~3), giving Ashley more vertical space to read the conversation and a natural real-estate seam for adding future top-row buttons without stretching height. Top row holds the context meter (turned horizontal, filling left→right) with the reset button as its leftmost cell, plus the non-send aux buttons (paperclip / thumbs-up / hourglass). Bottom row holds the textarea (mostly full width, min = 1 row, auto-grows on multi-line input) and the send button on the right. Attachment chips pop as an ephemeral third row when at least one chip is present. All pre-existing patch treatment survives: warm-glass compose surround (#79/#82), textarea recessed-well `!`-important treatment (#81), VISUAL-08 vibrant amber send, patch #84 queue armed-pulse, patch #57 draft persistence, Phase 05 upload flow, reset-send affordance integrated as meter's leftmost cell, and the COMPOSE-04 hard-lock (no local optimistic bubble on send).
**Requirements**: COMPOSE-01, COMPOSE-02, COMPOSE-03, COMPOSE-04, COMPOSE-05, VISUAL-06, VISUAL-07, VISUAL-08, VISUAL-09, UPLOAD-04 (all pre-existing; no new REQ-IDs introduced; Phase 9 rearranges the geometry without altering the requirement contracts)
**Depends on:** Phase 2 (COMPOSE base), Phase 4 (Glass reskin), Phase 5 (upload chip strip), patch #83 (vertical ctx meter — reoriented here), patch #84 (queue button — preserved)
**UI-SPEC (LOCKED via prototype review 2026-07-22):** `.planning/phases/09-compose-box-redesign-2-tall-shell/09-UI-SPEC.md`
**Plans:** 4/4 plans complete

**Wave 1**

- [x] 09-01-PLAN.md — Restructure ComposeBox JSX into 2-row shell (Row-3 chip strip, Row-1 instrument bar with meter+spacer+aux, Row-2 compose bar with textarea+send); preserve every existing class value verbatim; textarea rows floor 2→1; touch target min-h[44px] gated by showPaperclip (COMPOSE-01..05, VISUAL-06, VISUAL-07, VISUAL-08, VISUAL-09, UPLOAD-04)

**Wave 2** *(blocked on 09-01 — same-file overlap)*

- [x] 09-02-PLAN.md — Rotate meter 90° from vertical to horizontal (28px×w-7 → 28px×160px); flex-col→flex-row; segment iteration LTR; drain sweep reoriented right→left; SEG_COUNT 11→12 per prototype lock; expose `--seg-count` + `--meter-width` as CSS custom properties (COMPOSE-01, VISUAL-06, VISUAL-07, VISUAL-09)

**Wave 3** *(blocked on 09-01 + 09-02 — same-file overlap for tests, then human UAT)*

- [x] 09-03-PLAN.md — Add Phase 9 structural tests to ComposeBox.test.tsx (2-row shell DOM position, horizontal meter flex-row, mobile touch target min-h[44px], 1-row textarea floor); do not modify or delete any of the 10 pre-existing Phase 05 tests (COMPOSE-01..05, VISUAL-09)
- [x] 09-04-PLAN.md — Human UAT checkpoint (Ashley walks the 10-item checklist in a live Termix instance); approval routes to Ashley's separate build+deploy step, revision notes route back to 09-01 or 09-02 (COMPOSE-01..05, VISUAL-08, VISUAL-09, UPLOAD-04)

**Bounty:** `compose-box-redesign` (tracker under Tina's identity — `~/.claude/identities/tina/bounties/compose-box-redesign/`). Prototype-locked at 2026-07-22.

### Phase 10: Pretty-Conversations visual-language rework

**Goal:** Replace the shadcn-derived `ConversationsPanel` + `ConversationRow` with a clean-slate `src/ui/features/pretty-conversations/` component tree (mirrors Phase 4 pretty-view precedent) — chunky Telegram-style rows with 48/40px identity-hue avatar disc + hue-ring, primary label (= session name = identity name) + host secondary line, ChatMessage.tsx-verbatim selected-row hue treatment, flat list (no section headers), swipe-left pin on mobile / hover-reveal pin on desktop, compact pencil-icon new-session button in the header, persistent top-left sidebar-toggle that survives at all window widths (fixing the small-window sidebar-affordance regression), retirement of the old panel + row + labeled-CTA files after cutover. Presentation-only follow-up to Phase 6/7 — the LIST-NOT-TABS model + session-persistence contract + conversation-store data source all stay verbatim.

**Requirements:** No new REQ-IDs introduced. Presentation-only rework; existing PRETTY-VIEW-VISUAL-* / TG-* IDs owned by Phases 4/6/7 continue to hold.

**Depends on:** Phase 6, Phase 7, Phase 4 (Glass depth tokens + hue-vocabulary — reused verbatim for selected-row treatment)

**Design source-of-truth (LOCKED, Ashley signed off 2026-07-22):**
- Mobile: `~/.claude/identities/tina/bounties/pretty-conversations-panel-redesign/prototype.html` (v0.3)
- Desktop: `~/.claude/identities/tina/bounties/pretty-conversations-panel-redesign/desktop.html` (v0.1)

**Non-negotiables (baked into plans, not open to re-litigation):**
- Both viewports ship in the same phase (no dual-mode ship — shape file lock)
- No IdentityBadge chip on rows (Ashley: session name = identity name)
- Flat list — no "Pinned" or per-host section headers
- Compact pencil icon = new session (not a full-width labeled CTA)
- Persistent top-left sidebar-toggle at all widths (small-window fix)
- Delete `ConversationsPanel.tsx` + `ConversationRow.tsx` + `NewSessionButton.tsx` after cutover
- Selected-row treatment MIRRORS ChatMessage.tsx assistant-bubble class strings verbatim
- Patch #111e F3-diag console.log spew fully retired with the old panel

**Plans:** 5 plans

**Wave 1**

- [ ] 10-01-PLAN.md — Foundation: tokens.ts + PinAction.tsx + PrettyConversationRow.tsx with variant-based pin mechanism (mobile swipe-left / desktop hover-reveal) + PrettyConversationRow.test.tsx (11 cases: swipe state machine, RDP-no-swipe, selected-state hue interpolation, avatar fallback, e.stopPropagation on pin, no IdentityBadge in DOM)

**Wave 2** *(blocked on Wave 1 — imports PrettyConversationRow)*

- [ ] 10-02-PLAN.md — PrettyConversationsPanel.tsx (flat list, pinned-first, RDP-sentinel-at-bottom, empty-state glass card, variant-based header with pencil + optional gear, swipe coordination) + PrettyConversationsPanel.test.tsx (15 cases: empty state, ordering, no section headers, RDP-sentinel, variant header, gear desktop-only, settingsRowSlot mobile bottom, dispatcher routing, onConversationSelected coverage)

**Wave 3** *(blocked on Wave 2 — mounts PrettyConversationsPanel; contains human-verify checkpoint)*

- [ ] 10-03-PLAN.md — AppShell cutover (ConversationsPanel → PrettyConversationsPanel on both viewports, single commit — no dual-mode ship) + persistent top-left 32x32 chevron sidebar-toggle + resolution of narrow-window thin-strip at AppShell:1844-1852 (recommended: remove; single canonical toggle) + F3-diag console.warn at AppShell:1483 removed + NewSessionDialog.test.tsx Test 10 retargeted to PrettyConversationsPanel + Ashley 9-step human-verify checkpoint

**Wave 4** *(blocked on Wave 3 human-verify approval — safety net for rollback)*

- [ ] 10-04-PLAN.md — Delete src/ui/sidebar/ConversationsPanel.tsx + ConversationRow.tsx + NewSessionButton.tsx + prune NewSessionDialog.test.tsx Test 1 (NewSessionButton-in-isolation) + repo-wide grep verification (zero imports of deleted paths + zero F3-diag survivors) + tsc-clean + test suite green

**Wave 5** *(blocked on Wave 4 — final docs pass)*

- [ ] 10-05-PLAN.md — Build verification (npx tsc + npx vitest + npm run build all clean, output captured to 10-BUILD-VERIFY-LOG.md) + 10-UAT-CHECKLIST.md authoring (19 non-negotiable items + 3 polish, adapted for Ashley's post-deploy walkthrough) + 10-PATCHES-MD-ENTRY.md draft for patch #128 (batched onto pending #123-#127 stack behind Ashley's morning greenlight — 15-min deadman rollback). NO deploy in this phase.

**Bounty:** `pretty-conversations-panel-redesign` (tracker under Tina's identity — `~/.claude/identities/tina/bounties/pretty-conversations-panel-redesign/`). Prototype-locked at 2026-07-22 (v0.3 mobile + v0.1 desktop). Closes on Ashley UAT sign-off post-deploy.

**Deploy discipline:** Patch #128 stacks on the existing #123-#127 pending batch on `feat/tab-title-from-tmux`. No deploy inside this phase; deploy is Ashley's morning greenlight per fork DEPLOY DISCIPLINE (15-min deadman rollback mandatory).

### Phase 11: Skynet transformation — purge dead Termix surfaces (first slice)

**Goal:** Desktop's landing surface renders the pretty-conversations panel + PrettyView chat surface on session load (NOT the Termix dashboard), and the left AppRail — its file plus every reference — is deleted from `AppShell` so the Termix dashboard, host manager UI, snippets manager, admin console, and any settings surfaces reachable via the AppRail become unreachable from the UI. The invisible-shell technical capability (tab plumbing, terminal renderer, RDP/VNC panes, host CRUD BACKEND API + encrypted-SQLite data layer) is untouched. This is a delete-code Ship-of-Theseus pass, not a feature flag.

**Requirements:** PURGE-01, PURGE-02, PURGE-03, PURGE-04, PURGE-05

**Depends on:** Phase 10 (pretty-conversations panel + PrettyView are the destination landing surface; must be shipped and stable before AppShell cuts over to them as landing)

**Success Criteria** (what must be TRUE):

  1. On desktop, after fresh page-load without a hash-fragment, the visible top-level surface is the pretty-conversations panel (sidebar) + PrettyView chat surface (default main pane) — NOT the Termix dashboard, host manager, or any other historical Termix landing UI
  2. The left AppRail component file no longer exists in `src/ui/sidebar/` (or wherever it lived); zero imports of the deleted AppRail file remain anywhere in `src/`; `tsc` clean; test suite green
  3. No UI navigation path exists from a fresh Termix landing to the Termix dashboard, host manager pages, snippets manager, admin console, or any settings surface — the surfaces are unreachable through the visible UI, even if some backing route files linger for follow-up phase deletion
  4. Backend `/host/db/*` and `/identities/*` endpoints continue to serve their existing frontends (pretty-conversations panel reads the host list via the same API path it uses today); no backend route deletion in this phase
  5. RDP/VNC/Guacamole sessions launch and render exactly as they did before the purge (Phase 7's RDP-host-sentinel row in the conversation list still opens Guacamole panes)
  6. On mobile, page-load lands on the pretty-conversations panel (list view) with mobile back-button flow to PrettyView chat, unchanged from Phase 10's shipped behavior

**Design source-of-truth (LOCKED, Ashley 2026-07-23):**
- `~/.claude/identities/tina/bounties/skynet-transformation-purge-dead-surfaces/` (bounty premise + Ashley UAT quote)
- `~/.claude/identities/tina/tina.md` § Skynet direction — Ship of Theseus (dead-surfaces canonical list; palette authority `--color-pv-*`)

**Non-negotiables (baked into plans, not open to re-litigation):**
- Delete files rather than gate/hide them — this is a Ship-of-Theseus purge, not a feature-flag switch
- Keep the invisible-shell technical capability: tab plumbing, terminal renderer, RDP/VNC panes, host CRUD BACKEND (data layer). Untouched.
- No settings UI anywhere in this phase or any follow-up (Ashley 2026-07-23: "we are not having settings at all" — total, not partial)
- If a surface isn't the conversation list or the pretty view, don't defend it in scope decisions
- Palette authority for any surface color change stays `--color-pv-*` (theme-color, `--background` rebase, safe-area color — all draw from pretty-view tokens, NOT Termix's dark-mode `--background`)
- Same landing behavior ships to both viewports in this phase (no dual-mode ship — mirrors Phase 10 rule)

**Plans:** 4 plans

**Wave 1**

- [ ] 11-01-PLAN.md — Enumeration + strip-list authoring (locate AppRail + SettingsRow files, grep every import, identify every visible-UI entry point to dead surfaces, produce authoritative deletion-target document at 11-01-STRIP-LIST.md for Plans 02+03 consumption) (PURGE-01, PURGE-02, PURGE-03)

**Wave 2** *(blocked on Wave 1)*

- [ ] 11-02-PLAN.md — Landing-surface swap: create PrettyLandingCard.tsx warm-glass empty-landing card + swap renderTabContent's case "dashboard" from `<DashboardTab>` to `<PrettyLandingCard/>` + update AppShell initial-tab + closeTab-fallback labels to `t("nav.conversations.title", ...)` (the "dashboard" TabType is preserved as a load-bearing fallback identifier; DashboardTab.tsx becomes dead code for Phase 12+ deletion) (PURGE-01, PURGE-05)

**Wave 3** *(blocked on Wave 2 — AppShell.tsx file overlap)*

- [ ] 11-03-PLAN.md — AppRail + SettingsRow retirement: strip rail-view state machine from AppShell (railView state + handleRailClick + sidebarTitle + editHostInManager + openSingletonTab dead branches + 10 dead panel {railView === X} branches + AppRail mount + SettingsRow mount + 12 dead imports) + drop settingsRowSlot prop from PrettyConversationsPanel + prune Test 11 + delete SettingsRow.tsx + delete AppRail.tsx (5 atomic commits per Phase 10 Wave 4 precedent) (PURGE-02, PURGE-03, PURGE-04, PURGE-05)

**Wave 4** *(blocked on Wave 3 — final docs pass)*

- [ ] 11-04-PLAN.md — Build verification (npx tsc + npx vitest + npm run build all clean, output captured to 11-BUILD-VERIFY-LOG.md) + 11-UAT-CHECKLIST.md authoring (desktop + mobile + cross-viewport regression + failure route-back table for Ashley's post-deploy walkthrough) + 11-PATCHES-MD-ENTRY.md draft for patch #138 (batched with subsequent Phase 12+ purge patches per fleet-standing "batch patches into meaningful deploys" rule — no deploy inside this phase unless Ashley explicitly greenlights) (PURGE-01, PURGE-02, PURGE-03, PURGE-04, PURGE-05)

### Phase 12: Skynet transformation — purge dead frontend surfaces (second slice)

**Goal:** Every UI file that Phase 11's AppShell strip left orphaned is deleted from the source tree, along with its transitive-orphan subtrees, the Termix tab bar chrome, the keyboard shortcut editor UI, and all dead locale strings referencing the deleted surfaces. After this phase, `src/ui/sidebar/` contains only the pieces used by the retained pretty-conversations panel (`NewSessionDialog.tsx` + anything it imports), `src/ui/dashboard/` is deleted entirely (or reduced to nothing pretty-conversations imports), and grep for the retired identifiers (HostsPanel, SnippetsPanel, AdminSettingsPanel, HostManager, DashboardTab, etc.) returns 0 code hits across `src/`. The invisible-shell technical capability (tab plumbing, terminal renderer, RDP/VNC panes, host CRUD backend + encrypted-SQLite data layer, pretty-view internals) remains untouched.

**Requirements:** PURGE-06, PURGE-07, PURGE-08, PURGE-09, PURGE-10

**Depends on:** Phase 11 (AppShell imports must already be stripped before file deletion is safe — Phase 11 is what turned these files into orphans)

**Success Criteria** (what must be TRUE):

  1. All Phase-11-orphaned sidebar panel files are deleted from `src/ui/sidebar/`: HostsPanel, SessionsPanel, CredentialsPanel, QuickConnectPanel, SshToolsPanel, SnippetsPanel, HistoryPanel, SplitScreenPanel, ConnectionsPanel, UserProfilePanel, AdminSettingsPanel + AdminApiKeysSection/AdminIdentitiesSection/AdminManagementSections/AdminSettingsSections/AdminSettingsShared/AdminUserDialogs, HostManager + HostManagerData/HostManagerTabs/HostShareModal, HostEditor + HostEditorData/HostEditorFeatureTabs/HostEditorGeneralTab/HostEditorGuacamoleTabs/HostEditorStatsTab, HostCredentialList, CredentialEditorView, SidebarTree — all gone; grep for each identifier returns 0 code hits across `src/`
  2. `src/ui/dashboard/` subtree is deleted (DashboardTab.tsx, Dashboard.tsx, SessionDashboard.tsx, NewSessionHostChips.tsx, RemoteHostChips.tsx, sshHostToHost.ts, plus its cards/components/hooks/panels/ subdirs) — the "dashboard" TabType STAYS as a load-bearing fallback identifier in `src/types/ui-types.ts`, but no `dashboard/*.tsx` files remain
  3. Termix tab bar chrome (the top-level visible tab strip UI Ashley never sees in Skynet) is deleted; invisible tab plumbing (mount/unmount, WebSocket lifecycle, focus routing) stays intact
  4. Keyboard shortcut editor UI (`src/ui/features/keyboard/` visible editor surfaces) is deleted; underlying keyboard shortcut handling for retained UI (the Ctrl+Shift+O pretty-view toggle, ChordDropdown, etc.) stays intact
  5. Dead locale strings (`pinAppRail`, `nav.dashboard`, `nav.hosts`, `nav.snippets`, `nav.admin`, `nav.credentials`, `nav.history`, and any transitively-dead key referencing deleted surfaces) are removed from all ~34 `src/ui/locales/*.json` files
  6. `sidebar/NewSessionDialog.tsx` STAYS (used by pretty-conversations pencil); anything it imports STAYS
  7. Backend routes, encrypted-SQLite schema, docker/caddy/nginx config untouched (Phase 13 handles the backend route cleanup after this phase proves what's truly orphaned vs also serving pretty-conversations)
  8. `tsc --noEmit` exits 0; `npx vitest run` all green (or unchanged from Phase 11's 2-baseline ComposeBox drift); `npm run build` succeeds; AppShell + pretty-view chunks unchanged size (this phase only removes already-orphaned files, so bundle size drop should be modest — the big shrink was Phase 11 which stripped the imports; deleting the now-orphaned files should give a smaller incremental drop unless code-splitting was already keeping them out)

**Design source-of-truth (LOCKED, Ashley 2026-07-23):**
- `~/.claude/identities/tina/bounties/skynet-transformation-purge-dead-surfaces/` (bounty premise + Phase 12+ todo enumeration)
- `~/.claude/identities/tina/tina.md` § Skynet direction — Ship of Theseus (dead-surfaces canonical list; palette authority `--color-pv-*`; scope-decision heuristic)
- `.planning/phases/11-skynet-transformation-purge-dead-termix-surfaces-first-slice/11-01-STRIP-LIST.md` (Phase 11's enumeration pattern — Phase 12 mirrors this)

**Non-negotiables (baked into plans, not open to re-litigation):**
- Deletion, not gating — same as Phase 11
- Enumeration-first plan (mirror Phase 11 Plan 01 pattern) — produce authoritative `12-01-STRIP-LIST.md` BEFORE any deletion; prove each target has zero surviving `src/` imports via grep
- Atomic commits per file/subtree, tsc-clean per commit — same as Phase 11
- If a file's grep shows surviving imports (unexpectedly live consumer), DO NOT delete — flag and route back for investigation
- Delete the `src/ui/sidebar/HostManager*` subtree ONLY if no surviving import path exists to it from retained UI (pretty-conversations, pretty-view, etc.); grep-verify first
- Locale strings: batch by key removal across all ~34 JSON files as one commit per removed key set, tsc-clean (typed i18n keys will fail tsc if a consumer still uses the removed string)
- NO backend route deletion — Phase 13's problem
- Palette authority stays `--color-pv-*` for anything the deletion knock-on affects
- Rebase risk HIGH — accept upstream divergence

**Plans:** TBD — planner decomposes; expected ~4-6 plans (enumeration; sidebar panel deletion; dashboard subtree deletion; tab-bar chrome + shortcut editor deletion; locale strings; build verify + UAT).

**Bounty:** `skynet-transformation-purge-dead-surfaces` (Tina's identity). Same bounty as Phase 11; Phase 12 is the next slice of the same movement. Closes only after Phase 13 (backend routes) if that's the full purge; may be re-scoped if follow-up is more granular.

**Deploy discipline:** Batched with Phase 11's patch #138 per fleet-standing "batch patches into meaningful deploys" rule (Ashley 2026-07-23). No deploy inside this phase unless Ashley explicitly greenlights a mid-purge deploy.

**Bounty:** `skynet-transformation-purge-dead-surfaces` (tracker under Tina's identity — `~/.claude/identities/tina/bounties/skynet-transformation-purge-dead-surfaces/`). Reclassified low → HIGH on 2026-07-23 after Ashley's UAT quote ("I really feel like we need to get away from this termix front end stuff before any of this is worth quibbling over"). Closes only after subsequent phases finish the full purge; this phase closes on landing-surface-swap + AppRail retirement UAT sign-off.

**Deploy discipline:** Batched with subsequent purge phases per fleet-standing "batch patches into meaningful deploys" rule (Ashley 2026-07-23). No deploy inside this phase unless Ashley explicitly greenlights an early deploy of just the landing swap + AppRail removal. Rebase risk HIGH — accept upstream divergence for deleted surfaces.
