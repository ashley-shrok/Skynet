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

- [ ] **TOGGLE-01**: User can flip the top pane between tmux mode and pretty mode via a dedicated keyboard chord on the active terminal tab
- [ ] **TOGGLE-02**: Every fresh terminal tab opens in tmux mode; the mode choice is not remembered across tab opens
- [ ] **TOGGLE-03**: The message queue drawer at the bottom of the terminal tab persists across mode flips, unchanged in position and behaviour

### Conversation Render

- [x] **RENDER-01**: Pretty view renders only conversational messages — the user's typed messages and Claude's text replies. Tool calls, tool results, thinking blocks, tokens, and metadata are excluded from v1
- [x] **RENDER-02**: The rendered conversation scrolls back to the start of the current session file (session boundary = one Claude Code invocation on this pane)
- [x] **RENDER-03**: Auto-scroll follows the newest message when the user is at the bottom; if the user scrolls up, the view holds position instead of yanking them back
- [ ] **RENDER-04**: Rendered text is selectable with native browser text selection — no copy-mode dance, no highlight-then-Enter contract
- [ ] **RENDER-05**: Click-to-focus behaves like a normal web app — clicking the pane focuses it without accidentally starting a text selection

### Compose & Send

- [ ] **COMPOSE-01**: The pretty view includes a compose text box directly below the conversation
- [ ] **COMPOSE-02**: Enter sends the composed message; Shift-Enter inserts a newline in the compose box
- [ ] **COMPOSE-03**: Sent messages travel through the same tmux WebSocket input path the message queue drawer uses (patch #40's split-send: text + Enter as two separate input events ~60ms apart, defeating Ink's bracketed-paste batching)
- [ ] **COMPOSE-04**: Sent messages appear in the conversation only when the session file confirms the send landed — no optimistic display
- [ ] **COMPOSE-05**: Pastes into the compose box remain fully readable — no "[pasted N lines]" collapse or hiding

### Backend Session-File Tail

- [x] **BACKEND-01**: The backend identifies the Claude Code process running in the pane's tmux session on the remote host (via existing SSH exec channel; no new subsystem)
- [x] **BACKEND-02**: The backend locates the JSONL session file that process is writing to disk (typically under `~/.claude/projects/*/`)
- [x] **BACKEND-03**: The backend reads the file from the beginning and tails it forward as new events land
- [x] **BACKEND-04**: The backend streams parsed conversational-message events to the frontend over a WebSocket bridge

### No-Active-Session Fallback

- [x] **FALLBACK-01**: When pretty mode is toggled on a pane that has no active Claude Code process, the view shows "no active Claude session" and does nothing else — no reaching back to prior session files
- [x] **FALLBACK-02**: The no-active-session state applies whether the pane is at a shell prompt, was running Claude and exited, or is running something else entirely

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
| TOGGLE-01 | Phase 2 | Pending |
| TOGGLE-02 | Phase 2 | Pending |
| TOGGLE-03 | Phase 2 | Pending |
| RENDER-01 | Phase 1 | Pending |
| RENDER-02 | Phase 1 | Pending |
| RENDER-03 | Phase 1 | Pending |
| RENDER-04 | Phase 2 | Pending |
| RENDER-05 | Phase 2 | Pending |
| COMPOSE-01 | Phase 2 | Pending |
| COMPOSE-02 | Phase 2 | Pending |
| COMPOSE-03 | Phase 2 | Pending |
| COMPOSE-04 | Phase 2 | Pending |
| COMPOSE-05 | Phase 2 | Pending |
| BACKEND-01 | Phase 1 | Pending |
| BACKEND-02 | Phase 1 | Pending |
| BACKEND-03 | Phase 1 | Pending |
| BACKEND-04 | Phase 1 | Pending |
| FALLBACK-01 | Phase 1 | Pending |
| FALLBACK-02 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 19 ✓
- Unmapped: 0

---
*Requirements defined: 2026-07-17*
*Last updated: 2026-07-17 after roadmap creation (traceability populated)*
