# Requirements: Termix Fork — Pretty Session View (Patch #43)

**Defined:** 2026-07-17
**Core Value:** Ashley never loses access to her fleet — every change preserves reliable browser SSH+RDP, features are added around that hard constraint

**Scope of this document:** The v1 requirements below cover **patch #43 (pretty
session view)** — the currently Active work per PROJECT.md. Prior shipped patches
(#1–#42) are Validated in PROJECT.md and have no REQ-IDs here. Future patches
will be added as new REQUIREMENTS.md milestones.

## v1 Requirements

Requirements for patch #43. Each maps to a roadmap phase.

### Toggle & Layout

- [x] **TOGGLE-01**: User can flip the top pane between tmux mode and pretty mode via a dedicated keyboard chord on the active terminal tab
- [x] **TOGGLE-02**: Every fresh terminal tab opens in tmux mode; the mode choice is not remembered across tab opens
- [x] **TOGGLE-03**: The message queue drawer at the bottom of the terminal tab persists across mode flips, unchanged in position and behaviour

### Conversation Render

- [x] **RENDER-01**: Pretty view renders only conversational messages — the user's typed messages and Claude's text replies. Tool calls, tool results, thinking blocks, tokens, and metadata are excluded from v1
- [x] **RENDER-02**: The rendered conversation scrolls back to the start of the current session file (session boundary = one Claude Code invocation on this pane)
- [x] **RENDER-03**: Auto-scroll follows the newest message when the user is at the bottom; if the user scrolls up, the view holds position instead of yanking them back
- [x] **RENDER-04**: Rendered text is selectable with native browser text selection — no copy-mode dance, no highlight-then-Enter contract
- [x] **RENDER-05**: Click-to-focus behaves like a normal web app — clicking the pane focuses it without accidentally starting a text selection

### Compose & Send

- [x] **COMPOSE-01**: The pretty view includes a compose text box directly below the conversation
- [x] **COMPOSE-02**: Enter sends the composed message; Shift-Enter inserts a newline in the compose box
- [x] **COMPOSE-03**: Sent messages travel through the same tmux WebSocket input path the message queue drawer uses (patch #40's split-send: text + Enter as two separate input events ~60ms apart, defeating Ink's bracketed-paste batching)
- [x] **COMPOSE-04**: Sent messages appear in the conversation only when the session file confirms the send landed — no optimistic display
- [x] **COMPOSE-05**: Pastes into the compose box remain fully readable — no "[pasted N lines]" collapse or hiding

### Backend Session-File Tail

- [x] **BACKEND-01**: The backend identifies the Claude Code process running in the pane's tmux session on the remote host (via existing SSH exec channel; no new subsystem)
- [x] **BACKEND-02**: The backend locates the JSONL session file that process is writing to disk (typically under `~/.claude/projects/*/`)
- [x] **BACKEND-03**: The backend reads the file from the beginning and tails it forward as new events land
- [x] **BACKEND-04**: The backend streams parsed conversational-message events to the frontend over a WebSocket bridge

### No-Active-Session Fallback

- [x] **FALLBACK-01**: When pretty mode is toggled on a pane that has no active Claude Code process, the view shows "no active Claude session" and does nothing else — no reaching back to prior session files
- [x] **FALLBACK-02**: The no-active-session state applies whether the pane is at a shell prompt, was running Claude and exited, or is running something else entirely

### Session Changeover Detection (Phase 3)

- [ ] **CHANGEOVER-01**: When the current Claude session is recycled (via `/id reset`) or recovered (crash/reboot → `claude --resume`), pretty view detects the changeover and switches to tailing the new session's file without any user intervention (no tab close/reopen)
- [ ] **CHANGEOVER-02**: Detection is edge-triggered on the `<command-name>/exit</command-name>` marker in the current session's JSONL for sub-second latency in the graceful-recycle case, with a discovery-repoll backstop on the existing 3s poller for the SIGTERM-fallback and recover-in-different-cwd cases
- [ ] **CHANGEOVER-03**: During the changeover gap (old session dead, new session not yet up), pretty view shows a "session recycling…" indication without tearing down its WebSocket connection or displaying the terminal no-active-session fallback
- [ ] **CHANGEOVER-04**: Once the new session is detected, pretty view resets its message list, harness-tasks list, and context-% state; the new session's conversation re-hydrates from the top via existing `tail -F -n +1` semantics; the identity badge and pane-tint (which follow the pane, not the session) are unaffected
- [ ] **CHANGEOVER-05**: Detection handles both recycle (new session id → new .jsonl filename) and recover (`claude --resume <oldId>` → same session id but potentially different `projects/<slug>/` subdir when the resume-workdir differs from the original)

### File Upload Support (Phase 5)

- [ ] **UPLOAD-01**: Drag-and-drop anywhere on the pretty-view surface stages files as attachments; while a drag is over the surface, a full-surface "drop files here" overlay is visible; dropping outside the surface has no effect
- [ ] **UPLOAD-02**: Clipboard paste into the compose area — screenshots, images, or any file-shaped clipboard payload — stages that payload as an attachment through the same landing path as drag-and-drop
- [ ] **UPLOAD-03**: On touch devices only (gated by the same `useIsTouchDevice` signal that gates the mobile bottom nav), a paperclip button appears in the compose area and opens the native file picker on tap; desktop never renders the paperclip
- [ ] **UPLOAD-04**: Staged attachments render as a chip strip above the compose textarea; each chip shows the original filename + human-readable size and has a × control to remove that attachment before send; the strip is only present when at least one attachment is staged (no empty-strip chrome)
- [ ] **UPLOAD-05**: During transfer, each chip shows its own progress indicator (per-chip progress preferred; a single aggregate indicator across the batch is an acceptable fallback if per-chip proves fiddly)
- [ ] **UPLOAD-06**: Send is atomic — the injected user turn does NOT go until every attachment has successfully landed on the receiving box; if any file fails mid-transfer, chips turn red, the message stays in staging, and the user can retry
- [ ] **UPLOAD-07**: When the pane's SSH channel is down at send time, attachments + caption queue locally alongside the draft and send when the connection returns; when transfer fails mid-flight, retry is available without re-attaching
- [ ] **UPLOAD-08**: Caption text inherits the existing message-queue-draft persistence model (patch #49) and survives tab close and reload; attachment bytes do NOT persist across tab close (user re-drags from the file still on their desktop) — no client-side blob storage
- [ ] **UPLOAD-09**: Once all files have landed, a message is injected into the tmux session containing the caption text plus a compact metadata block per file: original filename, size, mimetype, upload timestamp, and full landing path on the receiving box; file BYTES are never inlined into the injected message (path-only-with-metadata)
- [ ] **UPLOAD-10**: Files land at `~/pretty-view-uploads/<yyyy-mm-dd>/<hhmmss>-<original-filename>` under the receiving user's home directory; day-organized subfolders are created on demand; the receiving side does NOT auto-clean any uploads (agent or user deletes them when done)
- [ ] **UPLOAD-11**: In the sender's own pretty-view stream, the just-sent message renders as a single bubble containing the caption text and inline chips for each attachment (filename + size only); no inline previews or thumbnails, consistent across all mimetypes
- [ ] **UPLOAD-12**: Attempting to drop a folder is refused with an in-surface nudge ("please attach files or zip first") and no attachments are staged; recursive folder uploads never happen
- [ ] **UPLOAD-13**: Multiple attachments in one send share a single caption input (one caption per batch); there is no per-chip caption; empty caption is allowed (send with attachments only)
- [ ] **UPLOAD-14**: The feature works on any pretty-view pane whose receiving-box shell can write to the user's home — including plain-shell panes as well as Claude Code panes; the injected metadata block is human-readable so a shell user can `cat`/`less` the file at the given path just as readily as an agent can `@`-reference it

### Visual Reskin — Glass Depth Aesthetic (Phase 4)

- [ ] **VISUAL-01**: Pretty view's base surface reads as a warm-neutral dark atmosphere (not cool navy-black or pure black) with subtle radial-gradient depth cues implying an ambient light source — a physical space, not a flat fill
- [ ] **VISUAL-02**: Chat bubbles read as raised physical objects on that atmospheric background, with multi-layer shadow stacks (ambient + contact + inset rim highlight) creating perceived elevation, plus backdrop-filter blur so translucent surfaces read as layered glass planes over the depth
- [ ] **VISUAL-03**: The identity's stored `colorHue` (patch #17 identities registry) is dynamically carried through the user-bubble accent + border glow, the context-bar fill, the send-button glow, and the textarea focus ring — one coherent per-pane color chain that identifies which agent this pane is talking to; falls back to a neutral accent when the identity has no `colorHue`
- [ ] **VISUAL-04**: Identity badge in the top-right corner of pretty view uses a large avatar (~56px, up from patch #17/#38's smaller size), name + title stacked to the right of the avatar, with a subtle slow breathing brightness animation (~5s cycle) as an ambient grounding anchor
- [ ] **VISUAL-05**: The ambient panels shelf (HarnessTasksPanel + BackgroundedAgentsPanel + BackgroundedShellsPanel) reads as a single quiet floating card treatment — distinct enough from the message area above to know where it ends, but visually calm and not competing for attention
- [ ] **VISUAL-06**: The compose surface itself is intentionally low-prominence — no card treatment, no bright top rim, blends into the atmospheric depth. You go to it when you're ready to type; it does not demand attention
- [ ] **VISUAL-07**: The textarea within the compose has a lightest-touch 1px warm-white outline (~0.09 opacity) that makes it findable as a receptacle for typing, without becoming visually loud; focused textarea gets an identity-hue focus ring
- [ ] **VISUAL-08**: The send button retains a saturated identity-hue glow — the ONE intentional attention-grab-point in the compose area for "I am ready to fire this message"
- [ ] **VISUAL-09**: All existing pretty-view functionality (chat rendering, ComposeBox split-send + reset + go-ahead paths, HarnessTasksPanel, BackgroundedAgentsPanel, BackgroundedShellsPanel, WipBubble, PlanPendingBubble, session-changeover holding/changed banners, empty state, error states, keyboard chords) is preserved end-to-end — the reskin is CSS-only, no behavior changes to any component's props, state, effects, or WebSocket handling
- [ ] **VISUAL-10**: The reskin does NOT visually touch terminal / RDP / VNC / file manager / dashboard / sidebar / tab bar / AppRail chrome — pretty view remains a themed island in the current Termix visual system. Identity badge specifically preserves its existing patch #38 hover-fade behavior wherever it's used (including terminal panes, not just pretty view)

### Telegram-like Interface (Phase 6)

- [ ] **TG-01**: The sidebar becomes a single flat scrollable list of every currently-active session — no tab strip, no per-view chrome carrying "which tab am I on." Rows are grouped visually by host with separators, using the SAME host-tree order the current sidebar already presents (no new sort rule, no recency-shuffle). Sessions that end vanish from the list immediately — the list only ever shows what's live right now, same lifecycle as today's tabs
- [ ] **TG-02**: Sessions can be pinned individually. Pinned sessions float to the top of the list above all host-grouped rows; unpinning drops the session back into its host group. Pin state is per-session (not per-host) and persists for the life of the session (a session ending removes it from the list and clears any pin state along with it)
- [ ] **TG-03**: Only one conversation is visible at a time. The tab strip currently at the top of the main area is removed entirely — there is no per-tab chrome, no active-tab indicator on multiple entries, no ability to have two conversations side-by-side. The sidebar row's selected state IS the "which conversation am I viewing" indicator
- [ ] **TG-04**: The internal experience of a conversation is unchanged. Identity-attached Claude sessions still open into the pretty view; plain SSH sessions still open into a terminal; RDP hosts still open into a remote desktop. Nothing about the innards of a tab changes — only the tab strip and sidebar's selection semantics around it
- [ ] **TG-05**: Clicking a conversation for the first time in a page-load mounts its view and opens its underlying connection. Clicking a different conversation hides the previous one but does NOT tear it down — the connection stays alive and its state (terminal buffer, pretty-view scroll position, live WebSocket, ambient panel state) is preserved. Clicking back returns to the previous conversation instantly with no reconnect. Persistence is in-memory only; a full browser refresh resets everything from scratch
- [ ] **TG-06**: On mobile (any viewport where `useIsTouchDevice()` returns true), the list and the view are two distinct screens — never both visible at once. From the list, tapping a row navigates into that conversation, fully replacing the list view. A back button in the top-left of the view returns to the list, fully replacing the view. The back gesture also works via the browser's back button
- [ ] **TG-07**: The mobile-only bottom navigation bar (whose current entries — host manager, credentials editor, and adjacent admin surfaces — Ashley does not use) is deleted entirely as a surface. It does not appear on any mobile viewport in any state
- [ ] **TG-08**: On desktop, the sidebar holding the list preserves its existing collapsible behavior verbatim: a thin clickable strip when collapsed (no icons, no visible content — just enough to be clickable), expanding to show the list when clicked. The expanded/collapsed state is a persisted preference across page loads, not a per-session toggle
- [ ] **TG-09**: A visible new-session button lives on the list view (both mobile and desktop) at a position that does not compete with pinned or active rows for attention — top of the list on desktop, and a mobile-appropriate placement (top-of-list or bottom-of-screen FAB) on mobile. Pressing it brings up a host picker; Ashley picks a host, provides a session name, and the new session opens. The exact affordance shape (modal / slide-in / popover), the exact mobile position, and whether the name is mandatory-up-front vs. optional-with-tmux-title-auto-fallback are planning-phase decisions, not shape decisions
- [ ] **TG-10**: The admin/settings destinations previously reachable through the mobile bottom navigation bar (host manager, credentials editor, and adjacent admin surfaces) remain reachable in the product, but from an unobtrusive settings surface — a small gear icon in the sidebar header on desktop, and a settings row somewhere in the list view on mobile that does not sit at the top competing for attention with the pinned or active rows. Ashley never uses these; the constraint is "don't let them occupy real estate she cares about"
- [ ] **TG-11**: The product ships as a full replacement of the tab metaphor, NOT as an alternate mode alongside it. The tab strip is removed unconditionally. There is no user-facing toggle to bring tabs back. Currently-open tabs on the day this ships are free-fire (they may or may not carry into the new list; no migration story is required)

### Fleet-native Conversation List (Phase 7)

Continuation of the TG-XX numbering from Phase 6. Follow-up to address the Phase 6 UAT gap where the list's data source mirrored only the browser-tab's open Termix tabs (empty on fresh page-load) instead of the fleet's running tmux sessions.

- [ ] **TG-12**: The list's data source is fleet-native — every tmux session on every reachable host appears as a row, sourced from the same fleet-discovery signal the current sidebar host-tree and double-shift menu already use. The set of rows is the union of "fleet-discovered tmux sessions" and "browser-tab's open Termix tabs," deduplicated by session identity. On a fresh page-load with no browser-tab tabs open, the list shows every running tmux session across every reachable host.
- [ ] **TG-13**: Attached (clicked earlier this page-load, live connection open, pane warm) and detached (existing on the box but not yet clicked this page-load) rows are visually indistinguishable. No brightness difference, no italic, no dot, no per-row status indicator distinguishing the two states. Rows are rows.
- [ ] **TG-14**: Clicking a detached row transparently attaches, mounts, and shows the session — a single-click flow with no attach dialog, no confirmation modal, no separate "connect" step. The user experience of clicking a detached row and clicking an attached row is functionally identical; only the underlying latency differs, and that difference is not surfaced.
- [ ] **TG-15**: Remote-desktop host rows sit at the bottom of the list — one row per RDP-enabled host, rendered with a monitor icon in the avatar slot (no identity hue, no identity name, just the host name + monitor glyph). The row exists as long as the host is RDP-enabled, independent of whether an RDP tab is currently open for that host. Clicking the row opens the remote desktop (attach + mount + show) using the existing RDP tab lifecycle mechanism (unchanged from today).
- [ ] **TG-16**: The existing New Session button is re-styled as the Telegram-native pencil-analog. Function is unchanged — pick a host, name a session, open. Only the visual affordance changes. Placement is planner's discretion (Telegram-per-viewport default is FAB bottom-right on mobile + small pencil button on desktop, but consistent-both-viewports is also acceptable). This is the ONLY creation button — the plain-SSH scenario from Phase 6 is not addressed here because Ashley never creates plain-SSH sessions (the only reason she ever creates a new session is to start a new identity).
- [ ] **TG-17**: Fleet discovery is a one-shot snapshot on page-load — no polling, no real-time push, no live-update chrome anywhere on the list. Ashley's own actions in this browser tab (creating a session via the pencil, closing one) update the list live via the browser-tab's tab machinery (which is already reactive). Cross-device staleness — a session created on another device, or a session that dies on a box while Ashley is looking at other rows — requires a manual browser refresh to reflect.
- [ ] **TG-18**: The mobile gear/settings-row duplication carried over from Phase 6 is fixed. The gear icon in the ConversationsPanel header renders on desktop viewports ONLY (i.e. on viewports where `useIsTouchDevice()` returns false). The settings row inside the ConversationsPanel scroller renders on mobile viewports ONLY. Neither renders in both places. Both continue to route to the same admin/settings menu.

## v2 Requirements

Deferred to future patches. Each add earns its way in as its own separate design conversation.

### Richer Rendering

- **RENDER-V2-01**: Render tool calls as a compact indicator or expandable widget
- **RENDER-V2-02**: Render tool results with formatting
- **RENDER-V2-03**: Render Claude's thinking blocks (collapsible)
- **RENDER-V2-04**: Show token counts inline
- **RENDER-V2-05**: Humanize MCP tool names

### Session Navigation

- **NAV-V2-01**: Cross-session browser to step through the pane's prior session files
- **NAV-V2-02**: Session picker across all sessions on the host

### UX Assistance

- **UX-V2-01**: "tmux wants your attention" detection when Claude is waiting on an approval prompt the pretty view can't handle
- **UX-V2-02**: Persist per-tab mode choice across tab opens

## Out of Scope

Explicit exclusions. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Replacing the tmux pane | tmux mode stays the default; pretty view is an alternate top-pane mode, not a replacement |
| Interactive tmux features in pretty view (approval prompts, arrow-key nav, slash-commands, escape sequences, Ctrl-C on runaway task) | Users flip back to tmux mode for these — one keystroke away |
| Rendering conversational text inside a fake-terminal font/color scheme | Violates the "real native web chat experience" spirit; forces tiptoeing |
| Optimistic display of sent messages | Truth wins over responsiveness — a silent failure must never leave a ghost bubble |
| Cross-session browsing across old sessions on the host (v1) | Scope discipline; earns its way in as v2 if wanted |
| Multi-user simultaneous view of the same session | No shared-session use case today |
| Rich paste treatment (pasted attachments, image previews, etc.) | v1 is plain-text conversational messages |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TOGGLE-01 | Phase 2 | Complete |
| TOGGLE-02 | Phase 2 | Complete |
| TOGGLE-03 | Phase 2 | Complete |
| RENDER-01 | Phase 1 | Complete |
| RENDER-02 | Phase 1 | Complete |
| RENDER-03 | Phase 1 | Complete |
| RENDER-04 | Phase 2 | Complete |
| RENDER-05 | Phase 2 | Complete |
| COMPOSE-01 | Phase 2 | Complete |
| COMPOSE-02 | Phase 2 | Complete |
| COMPOSE-03 | Phase 2 | Complete |
| COMPOSE-04 | Phase 2 | Complete |
| COMPOSE-05 | Phase 2 | Complete |
| BACKEND-01 | Phase 1 | Complete |
| BACKEND-02 | Phase 1 | Complete |
| BACKEND-03 | Phase 1 | Complete |
| BACKEND-04 | Phase 1 | Complete |
| FALLBACK-01 | Phase 1 | Complete |
| FALLBACK-02 | Phase 1 | Complete |
| CHANGEOVER-01 | Phase 3 | Pending |
| CHANGEOVER-02 | Phase 3 | Pending |
| CHANGEOVER-03 | Phase 3 | Pending |
| CHANGEOVER-04 | Phase 3 | Pending |
| CHANGEOVER-05 | Phase 3 | Pending |
| VISUAL-01 | Phase 4 | Pending |
| VISUAL-02 | Phase 4 | Pending |
| VISUAL-03 | Phase 4 | Pending |
| VISUAL-04 | Phase 4 | Pending |
| VISUAL-05 | Phase 4 | Pending |
| VISUAL-06 | Phase 4 | Pending |
| VISUAL-07 | Phase 4 | Pending |
| VISUAL-08 | Phase 4 | Pending |
| VISUAL-09 | Phase 4 | Pending |
| VISUAL-10 | Phase 4 | Pending |
| UPLOAD-01 | Phase 5 | Pending |
| UPLOAD-02 | Phase 5 | Pending |
| UPLOAD-03 | Phase 5 | Pending |
| UPLOAD-04 | Phase 5 | Pending |
| UPLOAD-05 | Phase 5 | Pending |
| UPLOAD-06 | Phase 5 | Pending |
| UPLOAD-07 | Phase 5 | Pending |
| UPLOAD-08 | Phase 5 | Pending |
| UPLOAD-09 | Phase 5 | Pending |
| UPLOAD-10 | Phase 5 | Pending |
| UPLOAD-11 | Phase 5 | Pending |
| UPLOAD-12 | Phase 5 | Pending |
| UPLOAD-13 | Phase 5 | Pending |
| UPLOAD-14 | Phase 5 | Pending |
| TG-01 | Phase 6 | Pending |
| TG-02 | Phase 6 | Pending |
| TG-03 | Phase 6 | Pending |
| TG-04 | Phase 6 | Pending |
| TG-05 | Phase 6 | Pending |
| TG-06 | Phase 6 | Pending |
| TG-07 | Phase 6 | Pending |
| TG-08 | Phase 6 | Pending |
| TG-09 | Phase 6 | Pending |
| TG-10 | Phase 6 | Pending |
| TG-11 | Phase 6 | Pending |
| TG-12 | Phase 7 | Pending |
| TG-13 | Phase 7 | Pending |
| TG-14 | Phase 7 | Pending |
| TG-15 | Phase 7 | Pending |
| TG-16 | Phase 7 | Pending |
| TG-17 | Phase 7 | Pending |
| TG-18 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 66 total (19 shipped, 5 pending Phase 3, 10 pending Phase 4, 14 pending Phase 5, 11 pending Phase 6, 7 pending Phase 7)
- Mapped to phases: 66 ✓
- Unmapped: 0

---
*Requirements defined: 2026-07-17*
*Last updated: 2026-07-21 — added TG-12..18 for Phase 7 (Fleet-native conversation list, spec: shapes/shape-fleet-native-conversation-list.md) as continuation of Phase 6's TG-XX numbering*
