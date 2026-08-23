# Phase 55: tap-to-load-discovery-reuse — Context

**Gathered:** 2026-08-23
**Status:** Ready for planning
**Source:** Direct-seeded from `.planning/shapes/shape-tap-to-load-discovery-reuse.md` (produced by `/build` feature-mode `/open` beat). Discuss-phase skipped per `/build` convention when the shape file already captures scope + philosophy + failure modes.

## What this is

When Ashley taps a conversation that isn't already loaded, the pane sits with a loading overlay for about five seconds before her message bubbles appear. Under the hood, most of that wait is the Claude-session backend asking the target host a long series of small SSH questions — one at a time, over the network — in order to figure out which JSONL conversation file to start tailing from. Only after that whole investigation completes does the pane's file-following actually start streaming her bubbles.

The change: make that jump-in feel effectively instant when the answer is already known, and much faster than today when it isn't.

## Evidence from live UAT (2026-08-23)

Ashley hotkey-instrumented a real cold-mount of the `aqua` identity's PrettyView (evicted from her `activeSet`; browser had no prior mount). Console-forward log timeline (t=0 at first hotkey press before click):

| offset (s) | event | source |
|---|---|---|
| **0.000** | z-press marker | frontend `[ashley-marker]` |
| 0.740 | frontend `[render] pane-mount pretty-view:7:aqua` | click → PrettyView mount |
| 0.782 | backend `ws-server accept` + `Claude session WebSocket connection established` | claude-session-server.ts |
| 0.846 | backend `[session-server] attach hostId=7 tmuxSession=aqua` | |
| 0.855 | frontend `[ctx-pct-diag] WS open sessionId=aqua paneKey=7::aqua` | PrettyView.tsx |
| 1.150 | backend `tmux display-message -p -t 'aqua' '#{pane_pid}'` — **discovery starts** | |
| **1.15 → 5.18** | **~4 seconds of serial SSH round-trips: `display-message`, `cat /proc/<pid>/stat`, `cat ~/.claude/sessions/<pid>.json`, `find ~/.claude/projects/`, `tail -c 262144` for probe** | |
| 5.184 | backend `Claude session discovery result status=active` | |
| 5.763 | backend `Starting Claude session tail` — pid + sessionFile resolved | |
| 5.845 | frontend `[pane-state] received phase=active` — **overlay unmounts, "loaded"** | |
| 6.382 | z-press marker (end) | ~537ms user reaction |
| 6.860 | first bubble renders (messageCount=1) | tail replay |

**Perceived load time: ~5.1s.** ~80% of it is the serial-SSH discovery loop between t=1.15 and t=5.18.

Meanwhile, the Phase 34 fleet-status backend has been polling every identity in her fleet every ~2 seconds since long before this click — running the same underlying `stat ~/.claude/identities/<name>/.dormant`, `find ~/.claude/projects/`, `tail -c 262144` probes to compute the ready-dot signal. It already has a very recent answer for `aqua`'s current sessionFile at t=0. Nothing consults it.

## Shape (from `shape-tap-to-load-discovery-reuse.md`)

Three moves:

1. **A shared, always-current answer.** The fleet-status poller (Phase 34 machinery) is taught to leave its most recent finding — the resolved conversation file for each (host, identity) pair — in a spot on the box where the Claude-session-attach path can read it. That spot has no lifecycle of its own; it's just wherever the freshest answer lives.

2. **Claude-session attach reads the shared answer first.** In `startActiveSessionFlow` (`src/backend/claude-session/claude-session-server.ts`), before running the current serial discovery, check the shared spot. If there's a fresh answer for `(hostId, tmuxSession)`, use it immediately — skip the investigation, jump straight to `readSessionFileRange` probe + tail-start.

3. **The fallback is fast too.** When the shared answer isn't there — first attach after a fresh backend, a conversation the fleet-status poller doesn't cover, whatever — the Claude-session-attach path falls through to a fresh investigation. That fresh investigation gets its own upgrade: all the small SSH questions that today happen one-at-a-time get rolled into a single remote script (one round-trip). Same information, one round-trip instead of ten-plus. Fresh investigation goes from ~4s to ~400ms.

Every attach also leaves one log line naming which path it took (shared-answer hit, fresh-batched, or full-fallback) and how long the load-in actually took, so if it ever stops feeling fast the log answers "which part is slow" without any new instrumentation.

## Philosophy

- **Two systems, one direction of coupling, opportunistic reuse.** Fleet-status machinery is unchanged. It doesn't know or care that Claude-session-attach is reading its output. Attach reads if there's something to read, and does its own thing if not. If fleet-status ever stalled entirely, attach would silently degrade to fresh (still-batched) investigation — no user-facing failure.
- **Speed over correctness-in-the-worst-case, because correctness recovers itself.** The shared answer can occasionally be stale (target's sessionFile rotated in the last couple of seconds and the poller hasn't caught up). Downstream recovery already handles this on both sides: (a) the discovery-repoll ticker in `claude-session-server.ts:4229` notices the mismatch on the next tick and calls `transitionToActiveNew` to swap tails, and (b) the frontend rotation-reset committed today as `3e0f7c54` catches it on the next `session` metadata frame. Unlucky-timed tap sees a brief flicker on the order of a couple seconds, then it's right. Fair trade for making the common case instant.
- **No new "cache lifecycle" concept.** The shared answer is just whatever the fleet-status poller most recently wrote. No TTL, no eviction, no invalidation protocol. If it's there, use it; if not, fall through.
- **The polling side stays exactly as it is today.** Same rate, same coverage, same shape. No changes to how often it runs or what it looks at. Only its output gets a new consumer.

## What would make it wrong

- **If Claude-session-attach ever waits on the fleet-status machinery to do work.** The whole shape is opportunistic read. If any code path ever blocks pending a fleet-status tick, or actively pokes the poller to hurry up, we've missed the point. Attach either finds an answer already there and uses it, or does its own thing.
- **If tearing down or restarting the fleet-status polling breaks attach.** Attach must survive the shared answer being missing, empty, ancient, or unresponsive. If disabling fleet-status for any reason (debugging, backend restart) causes attach to slow down catastrophically or fail, the two systems are coupled tighter than the shape allows.
- **If it's fast for identity conversations but slower for anything else.** Bare host terminals never went through this discovery path and never will — but any change to shared plumbing that accidentally regresses their attach cost is a violation. Bar: "same or faster than today for every pane type."
- **If the log doesn't tell us why a slow tap was slow.** The observability line must distinguish the three paths (shared-hit / batched-fresh / fallback) and include total time. If it lands but is ambiguous, it's not doing its job.
- **If the frontend needs to change to get the benefit.** The whole change is server-side. Frontend jump-in behavior is unchanged; the `session` metadata frame arrives faster, tail starts sooner, resolving overlay comes down sooner. No new frontend states, no new frames, no new configuration.

## Prior context

- **Claude-session discovery path today:** `startActiveSessionFlow` in `src/backend/claude-session/claude-session-server.ts:6002-6100` calls into `connectToPane` (`src/backend/claude-session/session-discovery.ts` or similar — planner to confirm) which walks the SSH queries described in the trace above. Each is a serial `ssh2` `exec` round-trip.
- **Fleet-status machinery today:** `src/backend/fleet-status/ssh-poll-orchestrator.ts` and the "source A" per-PID scan referenced in bounty `~/.claude/roles/box-maintainer/bounties/recycling-axis-layer1-source/`. Polls every identity, every host, every ~2s. Publishes to `session-working-store` (frontend consumer). Already resolves the `sessionFile` per identity as part of the recycling detection (Layer 1 `detectIdReset` predicate).
- **Downstream recovery already in place:**
  - `transitionToActiveNew` (`claude-session-server.ts:4021-4139`) — discovery-repoll ticker path for detecting mid-flight sessionFile rotation on an already-open connection.
  - Frontend `lastKnownSessionFileRef` + rotation-reset in `PrettyView.tsx` `session` frame handler (committed 2026-08-23 as `3e0f7c54`) — client-side reset when a fresh WS attach carries a rotated sessionFile.
- **Related deferred work (out of scope):** bare-host-terminal SSH attach cost; dormant-identity wake latency; client-side persistent message-bubble cache.

## Scope

**In:**
- Extend fleet-status poller (or its store) to expose the resolved `sessionFile` per `(hostId, tmuxSession)` to the Claude-session-attach path.
- `startActiveSessionFlow` reads the shared answer before discovery. Cache-hit path: skip directly to `readSessionFileRange` probe + tail-start.
- Cache-miss path: batch all serial SSH questions into a single remote script. One round-trip.
- Per-attach observability log line: path taken (shared-hit / batched-fresh / fallback) + total duration ms.
- Test coverage: shared-hit path uses cache and skips discovery; miss path runs batched fallback; stale-cache read still triggers downstream recovery correctly.

**Out (deferred to separate work):**
- Any change to fleet-status polling rate, coverage, or output shape.
- Any frontend change (behavior, wire schema, overlays).
- Client-side persistent message-bubble cache.
- Dormant-identity wake path optimization.
- Bare-host-terminal SSH attach path.

**Tempting-but-no:**
- Merging fleet-status and Claude-session-attach subsystems.
- Adding a max-age / TTL / freshness threshold on the shared answer (bounded staleness is a hedge; downstream recovery already handles it).

## Success criterion

Cold-mount tap-to-load (never-been-visible-this-session identity pane) goes from ~5s to:
- **~50ms perceived** when fleet-status has a fresh answer (dominant case)
- **~500ms perceived** when fleet-status has no answer (rare — first attach after backend restart, or identity that fleet-status doesn't cover)

Ship-gate: full `npx vitest run` green; existing `startActiveSessionFlow` tests + new shared-cache + batched-fallback tests all pass; docker build + force-recreate; HTTPS 200; Ashley UAT confirms perceived-instant on subsequent taps.

## Fleet-directive reminders for the planner

- **Frontend `tsc --noEmit` does NOT catch backend TS errors.** This is a backend-only phase — any file under `src/backend/` requires `npm run build:backend && npm run build` as the pre-push typecheck, NOT just `npx tsc --noEmit`.
- **Executor's remit stops at code + commit + tests green.** Any "ship" motion (git push, docker build, docker compose up --force-recreate) is orchestrator-only. Plans MUST NOT include a ship task at executor scope.
- **Scoped tests during dev, full suite at ship-gate.** Executor prompts should say "run scoped tests for the touched files" as the green-gate — not `npx vitest run` full suite. Full suite runs at orchestrator ship-gate before `docker build`.
- **Log at interaction/lifecycle/effect boundaries.** The observability line is one such point; the planner should also identify any other cache-hit / cache-miss / fallback transitions worth instrumenting.
- **NEVER use git worktrees.** All work on the main working tree, current branch `feat/tab-title-from-tmux`.
