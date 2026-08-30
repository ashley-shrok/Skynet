# Phase 1: Live session stream to browser + read-only pretty view — Context

**Gathered:** 2026-07-17
**Status:** Ready for planning
**Source:** Synthesized from shape file `.planning/shapes/shape-pretty-session-view.md` (patch #43 /open artifact), equivalent to PRD Express Path

<domain>
## Phase Boundary

This phase delivers the **read-only** end of patch #43 pretty session view: the
backend session-file discovery + tail + WS bridge, and a minimal pretty view
that renders the live conversation from the current session file. No mode
toggle, no compose box, no ergonomic web-selection layer yet — Phase 2 layers
those on top. What Phase 1 must prove end-to-end: a Skynet terminal tab whose
tmux session is running Claude Code can display its live conversation as chat
messages read from the remote session file, and a tab without an active
Claude session says so cleanly.

The pipe is what matters here: session-file discovery, tail-forward reads,
WS event shape, minimal chat render. All the ergonomic wins in the shape
file — native selection, native paste, click-to-focus, compose — arrive in
Phase 2 and must not be blocked by Phase 1 architectural choices.

</domain>

<decisions>
## Implementation Decisions

### V1 Render Scope (from shape file — HARD LOCK)
- Pretty view renders **ONLY conversational messages**: user's typed messages
  and Claude's text replies. Nothing else in v1.
- Deferred to future separate conversations, one at a time: tool calls, tool
  results, thinking blocks, tokens, MCP tool-name humanization, session
  metadata. The scope-creep failure mode ("small tool-call indicator, then
  a status pip, then...") is called out explicitly in the shape's "What
  would make it wrong" — hold the line.

### Session-File Discovery + Tail
- The backend identifies the Claude Code process running in the pane's tmux
  session on the remote host and locates the JSONL session file it is
  writing (typically under `~/.claude/projects/*/`).
- Read from the beginning of the current session file (one Claude Code
  invocation = one session file boundary). No cross-session picker in v1.
- Reuse the existing SSH exec-channel plumbing already used elsewhere in the
  backend (patches #7 session-list, #13 idle-pulse pane-command query).
  Do NOT introduce a new subsystem for file discovery.
- The **claude-code-trace** project on GitHub (delexw/claude-code-trace) has
  already done the file-format parsing, session-boundary logic, and tail
  mechanics. Ashley is **NOT committed** to using it as a library. Read it
  for parsing shape and boundary logic if useful; reimplement anything
  simpler to write ourselves.

### No-Active-Session Fallback
- When the pane has no active Claude Code process, show ONLY the string
  "no active Claude session" and do nothing else.
- Do NOT reach back to the pane's most recent past session file. Same
  behavior whether the pane is at a plain shell prompt, was running Claude
  and exited, or is running something else entirely.

### Rendering — Chat App, Not Terminal Wrapper
- Render conversational text in a **normal web chat style**, not a fake-
  terminal font/color scheme. Rendering conversational text inside a
  terminal aesthetic is explicitly called out as violating the spirit of
  patch #43.
- Auto-scroll follows the newest message when the user is at the bottom;
  if the user has scrolled up, the view holds position (standard chat-app
  convention — do not yank them back).
- Even though Phase 2 delivers native-selection ergonomics, Phase 1's
  minimal renderer must NOT paint itself into a corner that blocks Phase 2.
  Avoid patterns that would require rewriting the render tree to enable
  selection (e.g., don't render into a canvas; use standard DOM text nodes).

### Backend → Frontend Transport
- Stream parsed conversational-message events to the frontend over a
  WebSocket bridge.
- **Nginx caveat**: if a new backend route/WS path is introduced, matching
  `location` blocks MUST be added to BOTH `docker/nginx.conf` AND
  `docker/nginx-https.conf`. Every prior backend-route patch on this fork
  (#7 sessions, #17 identities, #39 message-queue) hit this trap. Without
  both, the path 200s with `index.html` and crashes the frontend on `.map`.

### Claude's Discretion
- **Exact WS event shape** — the shape file leaves this open. Suggested
  shape: `{type: "message", role: "user"|"assistant", content: "...", event_id, ts}`,
  bumped for each new conversational message tail-parsed from the JSONL.
  Anything simpler that satisfies RENDER-01..03 is fine.
- **Backend module structure** — new `src/backend/claude-session/` dir vs.
  extending an existing module. Judgment call; note in PATTERNS.md if used.
- **Session-file location strategy** — the safe approach: `readlink -f
  /proc/<pid>/fd/*` on the Claude process to find open JSONL handles, or
  a `find ~/.claude/projects/ -newer` heuristic keyed off the process
  start time. Details in the planner's task breakdown.
- **Frontend pane component location** — new component under
  `src/ui/features/pretty-view/` sits parallel to `src/ui/features/terminal/`.
  Judgment call; reuse hue-tint + identity infra from patches #17/#26 for
  visual consistency where it fits, but do NOT copy pane styling that
  breaks the chat-app aesthetic.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The design contract
- `.planning/shapes/shape-pretty-session-view.md` — **authoritative** shape
  file written via `/open` with the user 2026-07-17. All scope, philosophy,
  and "what would make it wrong" language originates here.

### The project scope
- `.planning/PROJECT.md` — Skynet fork context, Core Value, Validated /
  Active / Out-of-Scope requirements, Constraints.
- `.planning/REQUIREMENTS.md` — the 19 v1 REQ-IDs; Phase 1 covers
  BACKEND-01..04, RENDER-01..03, FALLBACK-01..02.
- `.planning/ROADMAP.md` — this phase's Goal and Success Criteria.

### Prior-art code (Skynet fork) to reuse / avoid duplicating
- `src/backend/ssh/tmux-helper.ts` — `queryPaneCurrentCommand` was added
  in patch #13 for the idle-pulse ("Claude is waiting") detection. It runs
  `tmux display-message -p -t <session> '#{pane_current_command}'` over
  the SSH exec channel. The pane→process discovery in Phase 1 should
  ride on the same helper (extend it rather than duplicate).
- `src/backend/ssh/ssh-one-shot.ts` — added in patch #7 for the session-
  list dashboard's parallel `tmux list-sessions` fan-out. Minimal SSH
  exec wrapper (password/key auth only, no OPKSSH/jump/SOCKS5). If the
  Phase 1 backend needs additional one-shot exec commands (e.g., locate
  the session file), this is the right helper to extend.
- `src/backend/database/database.ts` — WebSocket route mounts live here.
  Extending any WS surface follows the pattern already used by
  `src/backend/ssh/terminal.ts` (per-connection WS handler with a keep-
  alive tick per patch #10's design).
- `src/backend/ssh/terminal.ts` — the busiest file on the branch (patches
  1/3/6/13/17/24/26/28/33/39/40 all touch it). Contains the `wss.on(
  "connection")` block with the 1 Hz idle-check tick. This is the
  reference implementation for a backend-tick-based streaming loop; the
  Phase 1 tail loop can follow the same shape.
- `src/backend/ssh/terminal-session-manager.ts` — session lifecycle. If
  Phase 1 introduces per-pane pretty-view session state, it should live
  here alongside the existing terminal-session fields (patch #13 added
  6 idle-tracking fields; the pattern is well-worn).
- `docker/nginx.conf` + `docker/nginx-https.conf` — the location-block
  trap. New backend routes MUST be added to BOTH.

### Docs / runbook
- `/home/ubuntu/AGENTS.md` — fork runbook. See especially the entry
  covering patches #39-41 (message queue drawer — the WS input path
  Phase 2's compose will reuse; patch #40's 60ms split-send).

### External (informational only, not a dependency)
- `github.com/delexw/claude-code-trace` — read for file-format parsing +
  session-boundary logic. Not committed to as a library. Anything simpler
  to reimplement ourselves, do it.

</canonical_refs>

<specifics>
## Specific Ideas

- Every deploy runs behind the fork's mandatory 15-min deadman rollback
  timer (`/opt/skynet/.tmp-revert.sh`). This is a STANDING CONSTRAINT, not
  a phase task — the planner does not need to plan the deadman, but it
  should assume all execution is bounded by it. Ashley's rule: NO
  EXCEPTIONS on any deploy, even when she's at the keyboard.
- Fork build vehicle: `sudo bash /opt/skynet/skynet-patches/build-skynet.sh`
  produces `skynet-patched:local`; deploy is
  `cd /opt/skynet && sudo docker compose up -d --force-recreate skynet`.
- Nginx location-block trap (see decisions) is a documented failure mode
  that has cost time on every prior backend-route patch. The planner
  should surface it as a task, not leave it as an assumed detail.
- The identity registry / hue-tint infrastructure (patches #17, #26, #30,
  #32) exists and could inform pretty-view visual identity (per-identity
  chat aesthetic), but this is out of scope for Phase 1 (RENDER-01..03
  only). Phase 2 or later can layer it if wanted.
- The message queue drawer (patches #39-41) sits at the bottom of the
  terminal tab and PERSISTS ACROSS Phase 1's minimal read-only render.
  Phase 1's layout must not break the drawer's flex-column mount that
  patch #39 established in `Terminal.tsx`. Phase 2 lands the actual
  toggle chord that swaps the top pane.

</specifics>

<deferred>
## Deferred Ideas

Explicitly OUT of Phase 1 (some are v2/out-of-scope entirely, some are Phase 2):

**Phase 2 scope, not Phase 1:**
- Keyboard-chord toggle between tmux and pretty modes (TOGGLE-01..03)
- Native browser text selection / click-to-focus fixes (RENDER-04..05)
- Compose box + Enter/Shift-Enter + split-send (COMPOSE-01..05)

**Deferred to future patches (v2 REQ-IDs, each its own separate conversation):**
- Tool calls, tool results, thinking blocks, tokens, MCP humanization
- Cross-session browser / historical session picker across old session files
- "tmux wants your attention" detection
- Persist per-tab mode choice across tab opens
- Rich paste treatment (rendering pasted attachments, image previews)
- Optimistic display of sent messages — explicitly forbidden by the shape

</deferred>

---

*Phase: 01-live-session-stream-to-browser-read-only-pretty-view*
*Context gathered: 2026-07-17 via shape-file synthesis (equivalent to PRD Express Path)*
