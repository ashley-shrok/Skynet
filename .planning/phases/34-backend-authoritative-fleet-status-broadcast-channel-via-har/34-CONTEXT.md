# Phase 34: Backend-authoritative fleet-status broadcast channel — Context

**Gathered:** 2026-08-13
**Status:** Ready for planning
**Source:** Live design conversation with Ashley 2026-08-12/13 (captured verbatim in STATE.md § Roadmap Evolution 2026-08-13 entry + bounty `fleet-status-backend-signal/bounty.json` — treat both as source-of-truth alongside this file).

<domain>
## Phase Boundary

Rebuild the working-signal delivery pipe for Skynet's conversation-list dot + PrettyView WipBubble. Retire `src/ui/state/session-working-store.ts`'s two feeders (`ttyBusy` from Terminal.tsx PTY-output + `hasBgWork` from PrettyView.tsx `backgrounded_agents`/`backgrounded_shells` WS frames). Replace with a single fleet-status control WebSocket that the app opens once at boot and consumes from Claude-Code-native signals: primary is `~/.claude/sessions/<pid>.json` (harness-authored per-PID status file, `status ∈ {busy, shell, idle, waiting}` + `waitingFor` + `updatedAt`; stable since v2.1.119; box on 2.1.150), complementary are Claude Code hooks (`Stop.background_tasks[]`, `SubagentStart/Stop`, `PermissionRequest`, `PreToolUse/PostToolUse`).

Bundle a new `waiting`-state PrettyView bubble (PlanPendingBubble template) that surfaces when the harness needs a user decision PrettyView cannot render interactively (e.g. file-deletion permission prompt that slips past dangerously-skip-permissions), displaying the `waitingFor` reason string.

Motivating regressions this phase fixes:
1. **Dot regression**: quick-260808-b74 iter-2 closes per-pane WSes on `isVisible=false` → both feeders die → signal freezes for hidden panes → dot never appears or clears correctly. Patch #433 debounced the close to 60s but only unblocks the voice-send-then-nav-away path; the underlying "signal delivery dies when pane hidden" problem stays and the dot still freezes on longer nav-aways.
2. **Signal-quality noise (months of accumulated user pain)**: (a) harness bottom-bar redraws (context %, usage warnings) polluting PTY-idle signal with false-positive busy; (b) sibling-tmux-session access flapping other panes' WIP via status-line refresh escape sequences. Both eliminated by construction when PTY-scraping is retired.

Ashley 2026-08-12 verbatim: *"they're decent, but you know, all it takes is like a single flashing thing at the bottom of the harness … or this weird thing … whenever i have a session open and then i open or like access a different tmux session on the same box it causes some kind of movement on the other tmux panes that exist on that box and i see the work in progress indicator show up."* And: *"I'm just wondering if they can be better because, you know, I've been on this signal for months now."*
</domain>

<decisions>
## Implementation Decisions (LOCKED — do not re-litigate)

### PIVOT 2026-08-13 (LOCKED) — no per-box daemon; watcher runs inside Skynet backend over existing SSH pool

Ashley 2026-08-13, on the original plan's assumption that the watcher would run as a persistent systemd user unit on every identity-hosting box: verbatim *"we shouldn't need that, considering all boxes that Skynet has as hosts can already be SSH into."* All Wave 1 watcher subpackage code (Plan 01 as first-shipped in commits `6003221` / `62a4898` / `cb2938a`) was reverted; Plan 01 replanned to fit this new shape. Plan 04 was replanned; Plans 02, 03, 05, 06 unaffected.

**Locked constraints under this pivot:**

- **Watcher lives in `src/backend/fleet-status/*`** — ordinary Skynet backend TypeScript modules, alongside the Plan 02 modules already shipped in commits `7f85f2f`→`a60d30c`. No standalone subpackage. No separate `package.json` / `tsconfig.json` / `vitest.config.ts`. Builds and tests with the rest of the Skynet backend.
- **No per-box daemon.** No systemd user unit. No install script for a persistent process. No dynamic host-discovery daemon. Skynet backend already knows the identity-host list from its own DB.
- **Delivery mechanism: 2s polling over the existing SSH pool** (poll over event-driven `inotifywait`; Ashley 2026-08-13 chose the polling path for zero-dep operation on any host with a shell). Uses whatever SSH primitives the backend already exposes for its tmux/pane plumbing. One channel per identity-hosting host, multiplexed.
- **Stop hook install is a one-time remote file drop + settings-file edit over SSH**, NOT a persistent process. Drop the hook script into a well-known location on each identity-hosting box; append one entry to that box's `~/.claude/settings.json` `hooks.Stop[0]` array. Hook writes payloads to a well-known local file on the box; Skynet polls that file over the same SSH channel it polls the session-JSON files.
- **Scope of hook install: identity-hosting boxes only.** NOT every managed host — RDP-only endpoints (ashley-beelink, GIGAASHLEYPC, aither Windows RDP boxes) don't run Claude Code so they need nothing.
- **Fail-open on missing hook payload file** (Ashley 2026-08-13 verbatim: *"just make sure that it fails open if the file that the hook is supposed to generate isn't found"*). If the well-known Stop-hook payload file doesn't exist on a given host (hook never installed, freshly deleted, crashed before writing anything, or transient FS glitch), the watcher MUST NOT crash, log-spam, or mark the session as broken. Treat that host's background-task view as empty/unknown and continue relying on the session-JSON file for the main working signal. The dot may under-report background work on that host until the hook is (re-)installed, but the app stays functional. This applies to any host at any time — first-time provisioning is just the most common trigger, but the same code path also handles "hook file existed then vanished" and "hook file exists but is empty/corrupt."

**What stays from the pre-pivot design (unchanged):**

- Session-JSON file (`~/.claude/sessions/<pid>.json`) remains the primary signal (busy/shell/idle/waiting).
- Stop hook remains the complementary signal for `background_tasks[]` (bg work running while main is idle).
- Ambient-Monitor tagging via `[ambient]` description prefix stays (per RESEARCH § 1 — env-var marker mechanism is BLOCKED because env vars don't appear in the Stop payload).
- Wire protocol + backend broadcast WS (Plan 02) UNAFFECTED — the backend broadcasts the same shape regardless of where the watching happens.
- Frontend cutover (Plan 06) UNAFFECTED — the app opens the fleet-status control WS and consumes the same wire-protocol frames.
- Ambient tagging in id-skill (Plan 05) UNAFFECTED — orthogonal to the delivery mechanism.

**Plans affected by the pivot:**

- **Plan 01**: REVERTED (single revert commit removes `src/fleet-status-watcher/` entirely) + REPLANNED. New shape = backend modules in `src/backend/fleet-status/*`. The pure-library concepts (types, logger, liveness check, PID→tmux resolver via SSH-exec, `filterAmbientTasks`) transfer conceptually but get rewritten to Skynet backend conventions (no standalone subpackage stack).
- **Plan 04**: REPLANNED. New shape = (a) SSH-driven pull orchestrator inside the Skynet backend that opens one multiplexed SSH channel per identity-hosting host and polls session-JSON + Stop-hook payload files every 2s; (b) remote Stop-hook install helper (file drop + settings-file edit over the same SSH pool) with fail-open behavior when the hook-payload file is missing; (c) live Monitor-payload verify against a scratch identity to close RESEARCH OQ-2 before we ship the ambient filter in Plan 06.
- **Plans 02, 03, 05, 06**: UNAFFECTED. Wave dependency ordering (Plan 06 depends_on Plan 05, etc.) stands.

### Signal source
- **Primary**: consume `~/.claude/sessions/<pid>.json` (harness-authored). Inotify-watch OR poll — planner's call, informed by research subtask #4.
- **Complementary**: Claude Code hooks (`Stop.background_tasks[]`, `SubagentStart/Stop`, `PermissionRequest`, `PreToolUse/PostToolUse`). Registration mechanism informed by research subtask #2.
- **Do NOT** scrape PTY output for the primary signal. Do NOT enumerate process trees for the primary signal.

### Delivery topology
- Single always-on **fleet-status control WebSocket** opened once by the app at boot (not per-pane). Reconnects on drop with the existing patch #148 reconnect scheduler pattern (or equivalent).
- Frontend `session-working-store.ts` consumes from this channel. Same `(host, tmuxSession)` key convention preserved.
- Per-pane WebSockets stay per-pane for content only — this phase does NOT touch Terminal.tsx or PrettyView.tsx per-pane WS lifecycle beyond removing the feeder call sites.

### Composite state (target)
```
main    = status === "busy" || status === "shell"
waiting = status === "waiting"        // rendered as PrettyView bubble, NOT the dot
bg      = any non-ambient entry in Stop.background_tasks[] || active subagents
isWorking = main || bg
```
The `waiting` state is a separate axis from `isWorking` — a session in `waiting` should NOT count as working for dot purposes; the bubble surfaces the ask instead.

### Dot semantics (UNCHANGED — LOCKED by Ashley 2026-07-23; do NOT re-litigate)
- Dot visible ⇔ `inActiveSet(row) === true && isWorking(row) === false` (ready-for-attention).
- Dot absent covers everything else (working, or not-in-active-set, or both).
- ONE dot per row, ONE meaning. No separate "WIP dot", no "recessed WIP dot".
- Full lock text: role file `~/.claude/roles/box-maintainer/box-maintainer.md` § "Skynet conversation-list dot semantics".

### Waiting bubble (UX — bundled in phase, not deferred)
- New PrettyView bubble modeled on `src/ui/features/pretty-view/PlanPendingBubble.tsx`.
- Mount site: same slot pattern as PlanPendingBubble (in-flow assistant-aligned bubble at bottom of message list).
- Shows `waitingFor` reason string: "approve Bash" / "sandbox request" / "worker request" / "dialog open" (whatever the harness reports).
- Semantics: "harness needs a user decision PrettyView can't render interactively" — visual affordance only, no interactive controls (Ashley must switch to a terminal pane to answer; the bubble tells her that).

### Existing plumbing to REUSE (do not rebuild)
- **PID→sessionId→cwd correlation**: `src/backend/claude-session/session-file-discovery.ts` `discoverClaudeSession()` already parses `~/.claude/sessions/<claudePid>.json` at pane connect. The fleet-status watcher needs the same primitive; refactor to a reusable helper if it isn't already exported cleanly.
- **SSH plumbing to managed hosts**: existing SSH pooling / connection management stays. Fleet-status watcher wants a DIFFERENT topology (one connection per box reporting for ALL that box's sessions, not per-pane) — new server-side abstraction, but SSH transport reuses existing primitives.
- **Store pattern**: `session-working-store.ts`'s `useSyncExternalStore` + module-scoped Map + listener registry is a fine template — keep the same shape when rewiring the consumer side.

### Hard dependency (sequencing)
- Bounty `ambient-monitor-tagging-in-id-skill` MUST resolve BEFORE the frontend cutover step in this phase. Every identity holds 4+ persistent Monitors (recv, wakeup-scheduler, ctxwatch, per-identity extras like tina's skynet-recv) — all Claude Code `Monitor` tool calls that appear in `Stop.background_tasks[]` from wake onward. Without a marker to filter them, `isWorking` is permanently true for every identity in the fleet.
- Marker mechanism (env var like `AGENT_AMBIENT=1` vs Monitor-description prefix like `[ambient]` vs another vector) is picked by the plan-phase research subtask based on what `Stop.background_tasks[]` payload actually carries. Id-skill on-wake block is where the marker gets set; Nellie coordinates any parallel launch path in fleet-agent-supervisor if that exists.
- Plans MUST NOT cut over the frontend consumer before ambient tagging is confirmed shipped. Either: (a) sequence the cutover plan after ambient tagging is done as a separate quick task, or (b) build a temporary "everything is ambient" filter that's flipped once tagging ships.

### Per-managed-box deployment
- Deploy scope: all managed boxes (list in `~/.claude/roles/box-maintainer/box-map.md` — currently ~8 hosts). Tailscale reaches all of them.
- Watcher runtime language/binary: **Claude's discretion**, informed by research subtask #4. Constraints: minimal deps (don't want to install a Node stack on every box just for this), survives box restart (systemd unit or equivalent), logs to a place we can grep later.
- Watcher update mechanism: needs to be defined in the plan — how do we iterate on the watcher itself when we find bugs? Not a per-Skynet-deploy motion because managed boxes aren't Skynet.

### Structured logging (standing directive, Ashley 2026-08-11)
- Every code path this phase adds MUST log at interaction/lifecycle/effect boundaries with actionable context: `hostId`, `sessionId`, `pid`, session-JSON path, hook event type, WS lifecycle transitions. Explicitly extracted fields — NEVER `JSON.stringify(event)` on DOM Event objects.
- Log destination: `/opt/skynet/console-forward-logs/console-forward.log` for anything that runs in the Skynet container; per-box watcher logs to a discoverable location on each box.

### Fleet rules (non-negotiable)
- **NEVER use worktrees** (Ashley 2026-07-31). `workflow.use_worktrees=false` set on this project.
- **Sub-agents don't do deploys**. Plans MUST NOT include ship/deploy tasks at executor scope; orchestrator (tina) picks up deploy motion after each plan's executor returns "code done, tests green".
- **`/gsd:phase` + `/gsd:plan-phase` + `/gsd:execute-phase` is the vehicle** — not extra ceremony.
- **Never leave tests failing**. Full-suite green (`npx vitest run` exit 0) is a precondition for any commit.

### Claude's Discretion
- Watcher runtime language + install/update mechanism (informed by research)
- Fleet-status WS wire protocol (JSON schema, message types, subscription semantics) — pattern-match against existing Skynet WS conventions
- Hook subscription registration site (per-identity vs per-project `.claude/settings.json` vs fleet-wide) — informed by research
- Watcher-to-Skynet transport (probably WS for symmetry, but HTTP-poll acceptable if simpler)
- Test harness shape — end-to-end tests may need a mock harness process that writes fake session JSONs and fires fake hook events
- How to test the per-box watcher without deploying it — probably a Docker-based CI harness with a mock filesystem
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design authority
- `~/.claude/roles/box-maintainer/bounties/fleet-status-backend-signal/bounty.json` — source-of-truth architecture (premise field)
- `~/.claude/roles/box-maintainer/bounties/ambient-monitor-tagging-in-id-skill/bounty.json` — companion bounty for the hard dependency
- `.planning/STATE.md` § Roadmap Evolution 2026-08-13 entry — verbatim Ashley quotes from the design conversation + full architecture recap

### Current signal (to be retired)
- `src/ui/state/session-working-store.ts` — the store, will be re-wired to consume from fleet-status channel (feeders retire; store shape may stay)
- `src/ui/features/terminal/Terminal.tsx` — search for `publishSessionTtyBusy` call sites (removed)
- `src/ui/features/pretty-view/PrettyView.tsx` — search for `publishSessionHasBackgroundedWork` call sites (removed) + `backgrounded_agents` / `backgrounded_shells` WS-frame handlers (feeders retire; may or may not remove the frames themselves depending on other consumers — CHECK)

### Correlation primitive (to be reused)
- `src/backend/claude-session/session-file-discovery.ts` — `discoverClaudeSession()` reads `~/.claude/sessions/<claudePid>.json` (parses `sessionId`, `cwd`, `startedAt`, `procStart`). Fleet-status watcher wants the same primitive.

### UI template (to be copied for the waiting bubble)
- `src/ui/features/pretty-view/PlanPendingBubble.tsx` — the waiting bubble follows this shape (in-flow assistant-aligned, glass treatment)

### Dot semantics (LOCKED — do not touch)
- `~/.claude/roles/box-maintainer/box-maintainer.md` § "Skynet conversation-list dot semantics — one meaning: 'ready for your attention'" (Ashley 2026-07-23 lock)

### Fleet-wide primitives verification (already done this session)
- Live on this box RIGHT NOW: `/home/ubuntu/.claude/sessions/*.json` — verified during design conversation, files present + updating in real time for both tina and Tiffany PIDs.
- Claude Code version: 2.1.150 (per session-JSON files). Session-JSON schema stable since v2.1.119.

### Managed-hosts topology (deploy target)
- `~/.claude/roles/box-maintainer/box-map.md` — inventory of managed boxes. Currently ~8: thenasty, workstation, ZoeyBattlestation, GIGAASHLEYPC, ashley-beelink, skynet-ec2, aither-cloud/cloud2/sftp. Fleet-status watcher deploys to each Claude-Code-hosting box (i.e. every box that hosts an identity — NOT every managed box; the beelink and Windows RDP-only boxes are not identity hosts).

### Prior WS-drop iterations (context — DO NOT touch)
- Patch #344 (iter 1 of hidden-pane-cost-mitigation, quick-260808-b74)
- quick-260809-eqk (patch #368) — visible-gate on WS-setup effect
- quick-260809-ih9 (prev-visible-ref edge detector)
- Patch #433 (this session's debounced 60s WS close — orthogonal, stays)

### Research-agent findings (already done, prior to plan-phase spawn)
See STATE.md § Roadmap Evolution 2026-08-13 entry for the summary. Key finds:
- `~/.claude/sessions/<pid>.json` schema + verification live on this box
- Claude Code hooks doc: https://code.claude.com/docs/en/hooks
- claude-busy-monitor reference impl: https://github.com/pbauermeister/claude-busy-monitor
- tmux-agent-status (hook-based reference impl): https://github.com/samleeney/tmux-agent-status
- OSC 133 semantic prompts (broader prior art context)
- sd_notify pattern (validates ambient-tagging instinct — Systemd/Airflow/K8s all tag-at-spawn)

The plan-phase research subtask goes DEEPER (tactical vs strategic) — verifies exact payload shapes we're building against.
</canonical_refs>

<specifics>
## Specific Ideas

- **`~/.claude/sessions/<pid>.json` schema** (verified live on this box, 2026-08-12):
  ```json
  {
    "pid": 3941934,
    "sessionId": "c7274f12-0dbf-4fa7-9a89-9c35b6b5b39a",
    "cwd": "/home/ubuntu",
    "startedAt": 1786576479287,
    "procStart": "53836667",
    "version": "2.1.150",
    "peerProtocol": 1,
    "kind": "interactive",
    "entrypoint": "cli",
    "status": "busy",
    "updatedAt": 1786577996976
  }
  ```
  When status is `waiting`, there is also a `waitingFor` field per pbauermeister's docs — verify shape in research.

- **`Stop` hook payload includes `background_tasks[]`** per samleeney/tmux-agent-status docs — verify exact shape per task in research (does it carry description / command / tool_name / id / anything env-inheritable?). This is load-bearing for the ambient-Monitor filter.

- **PermissionRequest hook** (also `Notification` per pbauermeister — but `Notification` `idle_prompt` matcher is documented as broken in issue #12048; use `PermissionRequest` instead).

- **Concrete waiting-bubble copy** (Ashley 2026-08-13 verbatim): *"I think we could show that the same way that we do the plan mode bubble, like message bubble … some signal that the harness is waiting on the user in a way that PrettyView can't fully make interactable, because there are times where the agent tries to execute some file deletion command and the harness brings up a permission confirm prompt even though we run in dangerously skip permissions mode. So that would be great to put in there as at least a signal that the harness is waiting on something that we don't support officially."*

- **False-positive concrete example (Ashley 2026-08-13 verbatim)**: *"all it takes is like, you know, a single flashing thing at the bottom of the harness, like a warning that your usage is getting high, which is something that it does pretty often. Or, you know, I even have this weird thing that i don't understand where whenever i have a session open and then i open or like access a different tmux session on the same box it causes some kind of movement on the other tmux panes that exist on that box and i see the work in progress indicator show up."* — Both of these die when we retire ttyBusy.
</specifics>

<deferred>
## Deferred Ideas (OUT of scope for this phase)

- **Semantics change to the dot** — Ashley 2026-07-23 lock stands. We're rebuilding the delivery pipe, not the semantics.
- **LLM classifier for hard-to-classify cases** — kept as future escape hatch only. Research already validated we don't need one; deterministic signals + tagging cover the space.
- **Live-path migration of `session-file-discovery`'s pane-based lookup** — Phase 32 explicitly deferred this (§ "Bigger picture"). Stays deferred. This phase reuses `discoverClaudeSession()` as-is for the correlation primitive but does not migrate the live path.
- **Migration of any per-pane WS content signals to the fleet-status channel** — this phase is scoped to the working-signal (dot + WipBubble + waiting-bubble) only. Message frames, pane_state, tail-message-history, etc. all stay on per-pane WSes.
- **Retiring `backgrounded_agents` / `backgrounded_shells` WS frames themselves** — decide during planning based on whether anything else consumes them. If only the retired feeder consumed them, they can retire too; if any other UI surface uses them, they stay.
- **The debounced-WS-drop from patch #433** — orthogonal (voice-send-then-nav-away fix, not idle-signal fix). Stays as-is. This phase does NOT remove or alter the debounce.
- **Any changes to the per-pane WS lifecycle** — untouched. Feeders removed, per-pane WSes otherwise unchanged.
- **Container mutations to the managed boxes beyond what the watcher install requires** — this phase only installs/updates the per-box watcher; no other box-side changes.
</deferred>

<scope_fence>
## Scope Fence

**IN scope:**
- Per-box fleet-status watcher (new)
- Skynet backend fleet-status broadcast WS server endpoint (new)
- Backend correlation layer (new — but built on session-file-discovery primitive)
- Ambient-Monitor tag filter (new — depends on companion bounty picking marker mechanism)
- Frontend fleet-status control WS client (new)
- Rewire `session-working-store.ts` to consume from fleet-status channel
- Retire `publishSessionTtyBusy` + `publishSessionHasBackgroundedWork` feeders at both call sites
- New `waiting`-state PrettyView bubble (PlanPendingBubble template)
- Test coverage: unit for parse/filter/wire-protocol; end-to-end for watcher→broadcast→store→dot; new bubble render tests

**OUT of scope (see § Deferred above for the full list):**
- Dot semantics changes
- Live-path migration in session-file-discovery
- Fleet-status channel carrying non-working-signal content
- Retiring the patch #433 WS-close debounce
- Migration of any other per-pane WS signals
</scope_fence>

---

*Phase: 34-backend-authoritative-fleet-status-broadcast-channel-via-har*
*Context gathered: 2026-08-13 via live design conversation (STATE.md § Roadmap Evolution 2026-08-13 has the verbatim quotes)*
