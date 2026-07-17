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

- [ ] **Phase 1: Live session stream to browser + read-only pretty view** - Backend discovers the Claude process in the pane's tmux session, locates the JSONL session file, tails it, streams parsed conversational events over WebSocket, and renders them in a minimal read-only pretty view (with the no-active-session fallback)
- [ ] **Phase 2: Toggle, compose, and native web ergonomics** - Keyboard chord flips the top pane between tmux and pretty modes with the queue drawer preserved, plus compose box with split-send and native browser text-selection / click-to-focus / readable-paste behavior

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
  5. The behavior above works in production behind Termix's normal browser SSH plumbing without regressing any existing terminal, RDP, VNC, message-queue, identity, or session-list feature
**Plans**: TBD
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
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Live session stream to browser + read-only pretty view | 0/TBD | Not started | - |
| 2. Toggle, compose, and native web ergonomics | 0/TBD | Not started | - |
