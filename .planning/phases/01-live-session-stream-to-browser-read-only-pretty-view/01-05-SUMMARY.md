# Plan 01-05 — Nginx routes + deploy smoke checkpoint

**Completed:** 2026-07-17
**Executor:** tina (inline — nginx edits + deploy are operational, not code work, per fleet directive "GSD is CODE-ONLY")

## What shipped

Two matching `location ^~ /claude-session/websocket/` blocks (one in
`docker/nginx.conf`, one in `docker/nginx-https.conf`) that proxy to the
backend claude-session WS server. The fork's documented nginx double-config
trap is avoided.

**Port collision fix (bundled into the same commit).** Plan 01-02 bound the
claude-session server to port 30003, but the pre-existing
`src/backend/ssh/tunnel.ts` had ALREADY been listening on 30003 for
`/host/tunnel/` and `/ssh/tunnel/` — a hard conflict that would have
EADDRINUSE'd at startup or wedged the tunnel API. Moved the claude-session
server to port **30011** (next unused above the 30001-30009 range),
updated both nginx blocks + the frontend WS client wrapper's doc comment
to match. This is a defect the plan-checker missed — the port was declared
in CONTEXT.md without a grep of the existing codebase for collisions.

## Files touched
- `docker/nginx.conf` — 25-line block inserted between `/ssh/websocket/`
  and `/guacamole/websocket/`
- `docker/nginx-https.conf` — identical block at the same structural spot
- `src/backend/claude-session/claude-session-server.ts` — port 30003 → 30011
  (3 refs: doc comment, `WebSocketServer({port: ...})`, and the
  `CLAUDE_SESSION_WS_PORT` constant)
- `src/ui/api/claude-session-api.ts` — doc comment port ref updated

## Deploy record

Pushed feat/tab-title-from-tmux to GitHub (`68db714` — nginx + port fix),
built `skynet-patched:local` via `/opt/skynet/skynet-patches/build-skynet.sh`,
armed 15-min deadman, `docker compose up -d --force-recreate skynet`.

**Smoke sequence outcome:**
- Backend port 30011 listener: ✓ present after boot
- Nginx routes to backend cleanly: `curl -sI` to
  `https://term.gigaashley.click/claude-session/websocket/` returned
  `HTTP/2 426 Upgrade Required` with `content-type: text/plain` — backend
  rejecting an unauthenticated WS handshake. NOT the trap signature
  (`200 text/html` = SPA fallback ate it).
- First browser smoke by Ashley: reported "no active Claude session"
  overlay on a pane where Claude Code WAS running. Discovery bug — see
  next section.

## Discovery bug caught in the deploy smoke window + fixed inline

**Root cause.** Plan 01-01's `session-file-discovery.ts` walked
`/proc/<pid>/fd/*` for the pane's Claude process and its descendants
looking for an open `.jsonl` handle. Claude Code does NOT keep the JSONL
file open across the process lifetime — it opens, appends, closes per
event. So the fd walk found nothing on every pane, and discovery returned
`inactive` for every Claude session.

Manually confirmed on workstation (verified against poppy's pid 118308's
parent + child): all `/proc/*/fd/*` entries were ptys, sockets, event
fds, `pidfd`, `inotify` — zero JSONL matches. None of the 19 active
claude tmux sessions on that box had an open JSONL fd.

**Fix (committed as `128339a` on the same push cycle within the deadman
window).** Replace the fd walk with a CWD-driven approach:

1. Read `/proc/<pane pid>/cwd` (fall back to the first pgrep-child if the
   parent doesn't expose it — some launchers exec claude in a child that
   owns the cwd).
2. Slugify the CWD to project-dir form: replace every `/` and `.` with
   `-`. So `/home/ubuntu/.claude/identities/poppy/...` becomes
   `-home-ubuntu--claude-identities-poppy-...` (the `--` around `.claude`
   is correct output of the transform).
3. Pick the newest `.jsonl` in `~/.claude/projects/<slug>/`. For CWDs
   where multiple Claude sessions have run, mtime is the mental-model-
   correct pick (shape file v1: one file per pane, "current" one).

**Verified on 5 live workstation sessions before redeploying** — hilda
(Pantheon-Hecate), holly (Pantheon-Hermes), poppy (identity bounty dir),
moxie (Pantheon-Morpheus), molly (Pantheon-Metis) — all resolved to
their correct active session file.

Redeployed via same build+deadman flow. Ashley's second browser smoke
reported "worked!" — pretty view rendered the live conversation.

## Deadman flow record (for future reference)

- Initial arm: `/tmp/skynet-keep-patched` sentinel + `sleep 900` at 16:25
- First deploy live at 16:26
- Broken discovery reported 16:32
- Root-caused + fixed + committed + pushed 16:37
- Old deadman kept inert by touching sentinel; v2 deadman armed with
  distinct `/tmp/skynet-keep-patched-v2` sentinel to give Ashley a
  fresh 15-min window for the fix
- Second deploy live at 16:38
- "Worked!" confirmed 16:39
- Both deadmen disarmed via narrow pkill matching each specific sentinel
  path (not `pkill -f "sleep 900"` — that would kill the guacd-zombie
  sentinel's own poll loop too)

## Requirements satisfied

- **BACKEND-04** — WS bridge reachable from browsers via nginx routes
- Also validated end-to-end in production:
  - **BACKEND-01/02** — discovery now correctly locates the JSONL for
    live Claude sessions
  - **BACKEND-03** — tail streaming works (Ashley saw the conversation
    render)
  - **RENDER-01/02/03** — chat bubbles render user + Claude messages
    only, from the start of the file, with chat-app auto-scroll
  - **FALLBACK-01/02** — inactive state renders "no active Claude
    session" cleanly (validated by the first broken deploy as an
    accidental smoke test of the fallback path)

## Deviations from plan

- **Executor swap:** the plan block for Task 3 was written for a
  gsd-executor agent, but the standing fleet directive "GSD is CODE-ONLY"
  (identity file) mandates that operational tasks (nginx edits + deploy)
  bypass GSD. Ashley enforced this mid-run. Tasks 1 + 2 were also handled
  inline by tina rather than by a spawned executor — coherent with the
  "GSD is code, deploys are operational" split. All commit + verification
  criteria from the plan's Tasks 1 + 2 still met.
- **Port change 30003 → 30011:** the plan named 30003 as the WS port;
  operational reality (existing tunnel server on 30003) forced the move.
  Baked into the same commit as the nginx blocks so history stays atomic.
- **Discovery fix:** the plan-checker did not catch that Claude Code
  doesn't keep the JSONL fd open. Caught by the first live smoke test.
  Fixed in-window under the deadman, redeployed, verified. Lesson for
  future patches touching Claude Code internals: verify assumptions
  against a live claude process, not against a mental model of what a
  well-behaved app "should" do.

## Follow-ups noted (not blocking Phase 1 closure)

- **Rebase-ability check:** all Phase 1 commits landed on
  `feat/tab-title-from-tmux` as normal feature commits atop the last
  patch (#42 tmux scroll). Rebasable individually.
- **Documentation debt:** patch #43 and patch #42 both need entries in
  `/home/ubuntu/AGENTS.md` per the fork convention. Deferred to a
  standalone documentation pass; noted in the bounty.
