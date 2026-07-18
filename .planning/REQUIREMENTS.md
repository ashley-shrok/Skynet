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

**Coverage:**
- v1 requirements: 34 total (19 shipped, 5 pending for Phase 3, 10 pending for Phase 4)
- Mapped to phases: 34 ✓
- Unmapped: 0

---
*Requirements defined: 2026-07-17*
*Last updated: 2026-07-18 — added VISUAL-01..10 for Phase 4 (Glass depth visual reskin, spec: bounties/pretty-view-visual-overhaul/mock/index.html)*
