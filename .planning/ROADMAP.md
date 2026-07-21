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
- [ ] **Phase 6: Telegram-like interface** - Reshape Termix around a Telegram-style conversation-list interface. Sidebar becomes a flat single-select list of currently-active sessions grouped by host (existing tree order preserved); per-session pins float to the top. Only one conversation visible at a time; switching hides/shows without unmount, so sessions stay alive in-memory across switches within a page-load. Tab strip removed entirely. Mobile: list-vs-view flow with top-left back button; bottom navigation bar deleted; admin/settings destinations migrated to unobtrusive gear (desktop) or list row (mobile). Deferred to v2: activity/unread signals of any kind. Out entirely: cross-conversation search, folders, drag-to-reorder, ended-session history. Shape file: `.planning/shapes/shape-telegram-like-interface.md` (LOCKED, do NOT re-litigate).

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
| 6. Telegram-like interface | 3/5 | In Progress|  |

### Phase 6: Telegram-like interface

**Goal:** Reshape Termix's navigation model around a Telegram-style conversation-list interface — sidebar as flat single-select list of active sessions (grouped by host, per-session pins floating on top), tab strip removed, mobile bottom-nav deleted in favor of list-vs-view flow with top-left back button, admin destinations relocated to an unobtrusive settings surface, and in-memory session persistence preserving live connections across switches within a page-load.

**Shape file (LOCKED, do NOT re-litigate):** `.planning/shapes/shape-telegram-like-interface.md`

**Requirements:** TG-01, TG-02, TG-03, TG-04, TG-05, TG-06, TG-07, TG-08, TG-09, TG-10, TG-11 (11 requirements, defined in `.planning/REQUIREMENTS.md` § Telegram-like Interface — Phase 6). Full scope edges — in / out / deferred-to-v2 / tempting-but-no — are enumerated in the shape file's Scope edges section.

**Depends on:** Phase 5

**Plans:** 3/5 plans executed

**Wave 1**

- [x] 06-01-PLAN.md — Foundation: conversation-store (pins + single-select + host-tree derivation), ConversationsPanel + ConversationRow with identity avatar + hue tint reused from TabBar idiom (TG-01, TG-02, TG-08)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06-02-PLAN.md — Tab-strip DELETION + persistence contract (mounted-but-hidden via patch #35 tabNodesRef mechanism) + settings-surface migration (desktop gear icon + SettingsRow for mobile mount) + AppRail default view swap to `conversations` (TG-03, TG-04, TG-05, TG-10, TG-11)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 06-03-PLAN.md — Mobile list-vs-view flow (mobile-flow module with `#mv=1` URL fragment surviving Chrome window-restore per patch #25 lesson) + top-left back button + MobileBottomBar DELETION + SettingsRow mounted at bottom of mobile ConversationsPanel (TG-06, TG-07)

**Wave 4** *(blocked on Wave 2 + Wave 3 completion — sequential due to AppShell.tsx + ConversationsPanel.tsx file overlap)*

- [ ] 06-04-PLAN.md — New-session button + host picker modal + client-side name validation + selectConversationDeferred race defense + auto-navigate on create (mobile: also navigateToView) (TG-09)

**Wave 5** *(blocked on Waves 2-4 completion — deploy checkpoint)*

- [ ] 06-05-PLAN.md — Build verification + UAT checklist walking TG-01..11 + patches-md entry draft + mandatory 15-min deadman deploy under Ashley's separate green-light (all TG-01..11)

**Bounty:** `telegram-like-interface` (tracker under Tina's identity — `~/.claude/identities/tina/bounties/telegram-like-interface/`). Moves to `in_progress` when the first plan enters execution.
