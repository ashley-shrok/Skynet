# Shape: Pretty session view — a native web chat mode for Claude Code sessions in Skynet

**Opened:** 2026-07-17
**Vehicle:** GSD phase (`/gsd:plan-phase` → `/gsd:execute-phase`; requires a one-time GSD bootstrap in the fork worktree first)

## What this is

A second mode for the top pane of an existing Skynet terminal tab that holds a Claude Code session running under tmux. Today that pane is always the raw tmux terminal. This adds a "pretty view" mode: a chat-style rendering of the same session's conversation, backed by the session file Claude Code writes to disk on the remote host. The bottom of the tab keeps the existing message queue drawer, unchanged. A keyboard chord flips the top pane between the two modes. Pretty view has its own inline compose-and-send box for the "reply now" case, distinct from the queue drawer's prep-and-cherry-pick role.

## Shape

Three pieces coexist on the same terminal tab:

- **The queue drawer at the bottom.** Unchanged from what it does today: async prep of multiple messages, cherry-pick which to send. Persists across mode flips. Available regardless of what the top pane is showing.
- **The top pane in tmux mode.** Exactly what a Claude Code terminal tab shows today — the raw tmux pane rendered through the terminal client. This is the default. Every tab opens in this mode. There is no memory of "which mode you were in last"; every fresh open lands here.
- **The top pane in pretty mode.** Reached only by a keyboard chord flip. It has two parts:
  - A rendered conversation view of the current Claude Code session on this pane, read from the session file the Claude process is writing to disk. Renders only **conversational messages** — the user's typed messages and Claude's text replies. Nothing else in v1: no tool calls, no tool results, no thinking blocks, no tokens, no metadata. Each addition beyond this baseline is its own separate future decision.
  - A compose-and-send text box directly below the conversation. Standard chat conventions: Enter sends, Shift-Enter inserts a newline. When sent, the message travels to the underlying tmux via the same input channel the queue drawer already uses. The sent message appears in the conversation only when the session file confirms it landed — no optimistic display.

The pretty view's conversation scrolls back to the beginning of the current session file. It follows one session file's boundary (one session file per Claude Code invocation). Cross-session browsing across old sessions is not in v1.

When pretty mode is toggled on a pane that has **no Claude Code process running right now**, the view simply says "no active Claude session." It does not dig up the most recent past session file for that pane's shell. Same behavior whether the pane is at a plain shell prompt, was running Claude and exited, or is running something else entirely.

## Philosophy

The point isn't a nicer terminal wrapper. It's giving Claude Code a **real native web chat experience** so the user doesn't have to tiptoe around a hostile interface. The daily pain that motivates this:

- Copy requires a Skynet-specific keybind (highlight, then press Enter). Not what web users know.
- Pastes into Claude Code's input get compressed to "[pasted N lines]" so you can't verify what you actually sent.
- Click-to-focus a pane accidentally selects one character because the terminal treats every mouse-down as a text-selection start.
- Reading is cramped, cluttered by tool-call output, and nothing you can select with a normal cursor.

Pretty view is the answer to all of that at once: normal browser text selection, normal browser paste that stays readable, normal click-to-focus, normal chat-app scrollback ergonomics. Tool-call minimalism is a downstream consequence of "chat app, not terminal," not the primary goal.

What this deliberately is NOT:

- **Not a replacement for the tmux pane.** tmux mode stays the default and is one keystroke away for every case pretty view can't handle.
- **Not trying to solve every interactive case.** Approval prompts, arrow-key navigation, slash-commands like /agents and /monitor, escape sequences, ctrl-c on a runaway task — all of these happen in tmux mode. The user flips to tmux when they need them.
- **Not a "richer" viewer with expandable tool calls, token counts, MCP tool name humanization.** The whole point is escape from clutter. Each future add is its own separate conversation to have.
- **Not smart about detecting when to auto-show tmux.** No "Claude is waiting on your approval" pop-up. That's a future add if it earns its way in.
- **Not optimistic about sends.** If the send fails silently, no ghost bubble sits in the conversation. Truth wins over responsiveness.
- **Not persistent about mode choice.** Every tab opens in tmux; the flip is one keystroke and the user makes it fresh each time.
- **Not a session picker across old sessions on the host.** Scope is exactly "the current Claude session in this pane, right now."

Anything that dilutes "real native web chat experience" — rendering conversational text inside a fake-terminal font/color scheme, requiring keyboard chords for actions a web user would expect a click to do, forcing selection through a copy-mode dance — violates the spirit.

## Prior context

- The **queue drawer** is a shipped feature (Skynet patches 39–41). It handles async prep of multiple messages that the user cherry-picks to send. Its send mechanism (the message text followed by an Enter as two separate input events 60ms apart, to defeat bracketed-paste batching in Ink UIs) is proven — pretty view's compose box uses the exact same path.
- Skynet already renders Claude Code sessions in tmux panes inside terminal tabs on the browser. This has been the workflow for months. The user's daily Skynet use is dominated by these Claude Code tabs.
- The **claude-code-trace** project (github.com/delexw/claude-code-trace) is a read-only viewer for Claude Code's local session files. It has already worked out the file-format parsing, session-boundary logic, and tail-a-live-session mechanics. The user is **not committed** to using or depending on this project — she surfaced it because the legwork is done there and thought it might save us time. Pretty view may crib whatever parts of it are useful (parsing shape, boundary logic, tail approach) and reimplement anything that's simpler to write ourselves. No obligation to consume it as a library or match its interface.
- The existing "highlight and press Enter to copy" behavior is one of Skynet's own fork patches to tmux copy-mode bindings, not upstream Claude Code. It's an ergonomic wart in the tmux experience that pretty view sidesteps entirely by using native browser text selection.
- Multiple Claude Code sessions may run on the same host under different tmux sessions. Pretty view keys off the pane's own tmux session and finds the Claude process running in it, so tabs on the same host don't confuse each other.
- Skynet already has an established fork-patch → build → 15-minute deadman rollback → deploy flow. Every commit landed by this work will go through it.

## What would make it wrong

The user waved off enumerating failure modes and instead gave a stance — see philosophy. The spirit-of-the-thing failures that follow from that stance:

- **Ergonomic mines survive.** Pretty view renders the conversation but the user still has to tiptoe: weird copy behavior, un-selectable text, click-to-select instead of click-to-focus, pastes that hide themselves. This is the primary failure. If it happens, the point is missed.
- **Scope creep.** Any addition beyond "conversational messages only" — a small tool-call indicator, a collapsed tool-call widget, a status pip, a "thinking..." spinner — that lands without an explicit separate conversation about it. The clutter returns and the discipline is broken.
- **Non-native chat behavior.** Sends behave differently than a chat app: optimistic bubbles that lie about state, silent failure with no signal, wrong Enter/Shift-Enter semantics. Stops feeling native.
- **Heavy flip.** The tmux↔pretty toggle is slow, loses state the user cares about, or fights the user in some way. The escape hatch stops feeling free, which makes pretty view feel confining.
- **Cleverness that gets it wrong.** Pretty view tries to detect "Claude is waiting for your input in tmux" or "your last send might have failed" and gets false positives. Better to let the user notice on their own until any such signal earns its way in.

## Scope edges

**In (v1):**
- The mode toggle on the existing Claude Code terminal tab, keyed by a keyboard chord.
- Backend: find the Claude Code process running in the pane's tmux session on the remote host, locate the session file it is writing, read it from the beginning, tail it forward as new events land.
- Frontend: a chat-style conversation view rendering only user messages and Claude's text replies. Native web text selection, native paste behavior, click-to-focus that behaves like every other web app. Auto-scroll follows the bottom when the user is at the bottom; holds position when they've scrolled up (chat-app convention).
- A compose box directly below the conversation. Enter sends, Shift-Enter newlines. Sends go through the existing tmux input channel (same as the queue drawer). Sent messages appear only when the session file confirms.
- Fallback state for "no Claude process in the pane right now" — say so, do nothing else.

**Out (v1):**
- Tool call rendering, tool result rendering, thinking blocks, token counts, MCP tool name humanization, session metadata. All deferred; each earns its way in as a separate future conversation.
- Cross-session browsing / historical session picker across old sessions on the host.
- Persistence of mode choice across tab opens.
- Smart detection of "tmux wants your attention" prompts.
- Optimistic display of sent messages.
- Multi-user simultaneous view of the same session.
- Any richer treatment of pastes (e.g. rendering pasted attachments) — v1 is plain text conversational messages.

**Tempting but no:**
- Rendering tool calls with a compact "[tool: name]" pill. Feels harmless but breaks the aggressive-minimalism discipline. Each add is its own future conversation.
- Showing a session boundary marker so the user can step back one session. Adds a whole picker UI. Out.
- A "reveal tmux" hint when Claude Code appears to be waiting on user input the pretty view can't handle. Real value but not in v1.
- Remembering per-tab mode. Simpler to always default to tmux; the flip is cheap.

## Vehicle notes

Vehicle is a full GSD phase — `/gsd:plan-phase` → `/gsd:execute-phase` — chosen over plan mode because the patch is large (backend session-file discovery and live tail over the existing SSH exec channel, streaming bridge to the browser, a new pane component with native web semantics, compose box, layout refactor on the existing terminal tab, keyboard chord, likely 500+ lines across many files) and the atomic-commit safety net is worth the ceremony when mid-execute reshaping is likely.

GSD is **not yet bootstrapped** on the fork worktree. First operational step after this shape is to run the GSD bootstrap on `~/skynet`, then `/gsd:plan-phase` referencing this shape file. This is the specific-patch justification the identity's standing directive contemplates for the one-time bootstrap cost.

Maintainer of the Skynet fork is Tina (the current identity on this box). Execution happens on this box against the local fork worktree; commits push to the fork remote. Every deploy along the way is guarded by the mandatory 15-minute deadman rollback timer per Tina's standing DEPLOY DISCIPLINE rule — external to this shape but binding on every commit landed during execute-phase.

Close-out at the end via `/close pretty-session-view`.

---

## Close-Out

**Closed:** 2026-07-17
**Vehicle used:** Full GSD phase (one-time bootstrap on the fork worktree → `/gsd:plan-phase` + `/gsd:execute-phase` for Phase 1, same for Phase 2, with polish + a latent-bug fix landed ad-hoc between deploys). Every deploy behind the mandatory 15-min deadman rollback per fork discipline.
**Overall verdict:** closed-hit

### Per-facet

- **What this is** — hit · Second top-pane mode on the existing Skynet terminal tab holding a Claude Code session; chat-style rendering backed by the session file on the remote host; drawer preserved; own inline compose distinct from the drawer.
- **Shape (three pieces coexist)** — hit · Terminal is a flex-column with xterm hidden via `display:none` when pretty is on, PrettyView mounted alongside, drawer sibling below — drawer's presence orthogonal to mode.
- **Shape (tmux is default, no memory)** — hit · Plain useState default false; nothing persists it; every fresh mount lands on tmux.
- **Shape (keyboard chord flip)** — hit · Ctrl+Shift+O, document capture-phase intercept, layout-independent, matches the established sibling-hooks pattern exactly.
- **Shape (pretty view content = conversational only + compose below)** — hit · Parser drops everything that isn't a text block (tool_use / tool_result / thinking structurally never surfaced). Compose sits directly below the conversation.
- **Shape (Enter sends / Shift-Enter newlines / same input channel as drawer / no optimistic display)** — hit · Split-send text + `\r` with 60ms gap, exactly the drawer's proven path; textarea clears only on confirmed dispatch; no local echo.
- **Shape (scrolls from beginning of current session file, one file boundary)** — hit · Tail from line 1 for one file per WS connection.
- **Shape (no-Claude fallback says only "no active Claude session")** — hit · Backend sends exactly one `inactive` frame and stops; frontend renders exactly that string; inactiveReason state exists but is deliberately not rendered.
- **Philosophy — native web chat experience escaping the tmux ergonomic mines** — hit · Browser-default paste (no interception), no user-select restrictions, native cursor selection, native click-to-focus, chat-app auto-scroll with jump-to-latest pill.
- **Prior context: queue drawer send mechanism reused** — hit · Same split-send path.
- **Prior context: claude-code-trace as reference not dependency** — hit · Own implementation; no import.
- **Prior context: pane keys off own tmux session** — hit · Discovery walks the pane's own tmux session's Claude process, not the host's.
- **Prior context: fork build/deadman/deploy flow** — hit · Every deploy armed the 15-min deadman.
- **What would make it wrong: Ergonomic mines survive** — hit · All four named mines (copy dance, hidden paste, click-to-select, cramped un-selectable reading) verified addressed by native browser semantics.
- **What would make it wrong: Scope creep** — hit · No tool-call indicators, no status pips, no thinking spinners, no metadata; RENDER-01 lock enforced at the parser AND commented as "defense in depth" at the renderer.
- **What would make it wrong: Non-native chat behavior** — hit · No optimistic bubbles; Enter/Shift-Enter correct; failure surfaces inline and preserves typed text.
- **What would make it wrong: Heavy flip** — hit · Ashley confirmed the flip feels free — fast, no state loss, no fight. xterm stays alive via display:none so tmux session persists underneath and flip-back is instant.
- **What would make it wrong: Cleverness that gets it wrong** — hit · No "Claude is waiting" auto-detect, no "your last send might have failed" heuristic — no false-positive vectors added.
- **Scope edges (in)** — hit · Every in-scope item shipped and verified.
- **Scope edges (out)** — hit · Nothing rejected snuck in (no tool call/result/thinking/token rendering, no cross-session browsing, no persistence of mode choice, no smart tmux-attention detection, no optimistic display, no rich paste treatment).
- **Scope edges (tempting but no)** — hit · No compact tool-call pill, no session boundary marker/picker, no reveal-tmux hint, no per-tab mode memory.

### Follow-ups

- Remove the `console.debug` diagnostic left in the pretty view from the jump-to-latest debug session (filtered by default so invisible in normal use, but not shipping-clean) — bounty
- AGENTS.md write-ups for patches #42 (tmux 2-line wheel scroll), #43 (Phase 1 pretty pipe), #44 (Phase 2 toggle + compose + native ergonomics), #45 (polish: inline send button + jump-to-latest pill + useAutoScroll callback-ref fix) — bounty (already tracked as an existing todo on the `pretty-session-view` bounty)

### Notes

The latent `useAutoScroll` bug found during Phase 2 polish was silently hurting Phase 1 too — the scroll observer never attached in Phase 1 either, but `wasPinnedRef` defaulted to true so auto-scroll worked on the happy path (nothing in Phase 1 depended on the flag flipping false). The chat-app jump-to-latest pill from Phase 2 is what surfaced it: the pill's render gate needed the flag to flip, which forced the callback-ref refactor. Worth remembering: hooks that observe DOM state via `useRef` + `useEffect(deps=[refObj])` will silently no-op when the ref target is conditionally rendered. Prefer callback-ref for any DOM-observation hook.

The `#pretty=1` URL-fragment gate from Phase 1 was scaffolding only — worth calling out that Phase 2's plan explicitly named its removal as a task, and that removal was verified via `grep -n "pretty" src/ui/shell/tabUtils.tsx` returning zero. Mixed-mechanism state avoided by making the removal an explicit plan step, not an incidental cleanup.
