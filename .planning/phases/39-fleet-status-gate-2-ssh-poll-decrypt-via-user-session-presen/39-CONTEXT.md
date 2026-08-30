# Phase 39: Fleet-status Gate 2 — Context

**Gathered:** 2026-08-13
**Status:** Ready for planning
**Source:** Pre-authored from Gate 2 diagnosis bounty (`fleet-status-ssh-poll-decrypt-and-lazy-lifecycle`) + Ashley design decision LOCKED in-session 2026-08-13. Not run through `/gsd-discuss-phase` — design decisions already captured verbatim below.

<domain>
## Phase Boundary

Phase 39 fixes the second failure gate in Phase 34's fleet-status pipeline. Gate 1 (nginx routing) was fixed by patch #439. Gate 2 is the SSH-poll orchestrator failing on every enrolled host with `fleet_status_host_ssh_unreachable`, so the backend snapshot is empty and `useSessionIsWorking()` returns false for every session — no conversation-list ready-dots, no `<WipBubble />` in PrettyView, no `<WaitingBubble />`.

**In scope:**
- Rewire the SSH-poll orchestrator in `src/backend/starter.ts` and `src/backend/fleet-status/ssh-poll-orchestrator.ts` so it starts on first fleet-status WS subscriber and stops on last unsubscriber (Path C, presence-driven lifecycle).
- Route per-host decryption through Skynet's standard `resolveHostById(hostId, userId)` path (`src/backend/ssh/host-resolver.ts`), using the *subscribing* user's authenticated session for the userId context.
- Fix the fleet-status structured logger so `err.message` and other structured fields flow through to `console-forward-logs/console-forward.log` and `docker logs skynet`, not just the operation tag.
- Verify Plan 04's Stop hook (`stop-hook.sh` via `remote-hook-install`) install status per enrolled host + install where missing.

**Out of scope:**
- Any change to the fleet-status wire protocol, `SessionState` shape, or subscription registry semantics beyond wiring lifecycle hooks.
- Any change to `session-working-store.ts` / `session-waiting-store.ts` client-side stores.
- Any change to how `PrettyConversationsPanel`, `<WipBubble />`, or `<WaitingBubble />` consume the store (they're correct; they just have no data).
- Multi-user / per-user isolation beyond the natural single-user reality on this box.
- Nginx routing (patch #439 fixed that layer).
- Any change to the composite `isWorking` formula (`main = status === "busy" || status === "shell"; bg = backgroundTasks.length > 0; isWorking = main || bg;` — locked per D-CTX).

</domain>

<decisions>
## Implementation Decisions

### Root cause (empirical)

- SSH-poll's `listIdentityHostingHosts()` in `src/backend/starter.ts` (~line 232) reads `hostsTable.key`/`.password`/`.keyPassword` fields via raw `db.select({...}).from(hostsTable)`. This returns Skynet's *app-level* per-record ciphertext, not plaintext. Passes ciphertext to `connectOneShot` (`src/backend/ssh/ssh-one-shot.ts:76`), which wraps it as `Buffer.from(cleanKey, "utf8")` and hands to ssh2 → invalid-key rejection.
- Every other SSH consumer in Skynet reads hosts via `resolveHostById(hostId, userId)` (`src/backend/ssh/host-resolver.ts`), which uses `SimpleDBOps.select(..., "ssh_data", userId)` — that wrapper unconditionally runs `DataCrypto.decryptRecords` before returning. Callers include: `sessions.ts`, `identity-birth.ts`, `roles-create.ts`, `relay-pointer.ts`, `guacamole/routes.ts`.
- Empirical confirmations (documented in bounty timeline):
  - In-container ssh2 handshake with the DECRYPTED key (fetched via `/host/db/host/:id/export`) → connects 128ms + executes `echo alive` successfully.
  - Raw `db.sqlite.encrypted` probe returns "file is not a database" — SQLCipher-locked; all app-level ciphertext lives inside.
  - 10 enrolled hosts × 2 warnings/tick matches log pattern.
  - All 10 SSH-enabled hosts store inline PEM (no `credentialId` indirection — no complicating factor).
  - TCP-to-:22 reachability: 9/10 hosts connect fine.

### Path C — presence-driven lifecycle (LOCKED by Ashley 2026-08-13)

Ashley verbatim on the design rationale: *"nobody needs to know if something is idle or not, or anything else that's going on here, if no user is present to want to know the information."*

- SSH-poll runs **only while at least one browser is connected to the fleet-status WS** (via `/fleet-status/ws`).
- First subscriber → start the poller.
- Last unsubscriber → stop the poller.
- The poller uses the *subscribing user's* authenticated session as the `userId` context for `resolveHostById(hostId, userId)`. Standard request-driven decrypt path — no new "background decrypt" or system-key plumbing.

### On the SSH-poll's data-source assumption (informational, not blocking)

The poller reads `~/.claude/fleet-status/last-stop-payload.json` on each target host. That file is written by a Stop hook (`stop-hook.sh`) installed via Phase 34 Plan 04's `remote-hook-install`. Without the hook installed on a host, the poll succeeds at SSH but returns an empty payload. Verify install status per enrolled host + install where missing as part of this phase.

### Logger fix

`systemLogger.warn("Fleet-status: SSH channel acquire failed", { operation: "fleet_status_host_ssh_unreachable", fleetHostId, error: err.message })` — the structured `error` field is passed but does NOT surface in `console-forward.log` (only the human-readable msg with the op tag surfaces). This is why the Gate 2 diagnosis took as long as it did. Fix the logger config or the specific fleet-status log calls so `error` (and other structured payload fields) flow through to both console-forward and `docker logs skynet`.

### Ashley's principle worth surfacing to the planner

Bank this as a project-wide principle for consideration in future phases (not just this one): *"Boot-time / always-on background work is presence-driven, not eager. If no user is watching, don't compute. Applies to observability, polling, indicators — anything whose only consumer is a user's live view."* Phase 34 assumed the opposite ("server-authoritative state, ready the instant anyone opens a browser") and that assumption is what invented the whole background-decrypt problem being fixed here.

### Multi-user / per-user semantics

Skynet on this box is single-tenant (only Ashley), but the fleet-status pipeline is user-scoped by design (per-connection auth, per-user host ownership). Consider forward-compat:
- If multiple different users are subscribed to fleet-status at the same time, does one poller run using the first-connected user's session, or one poller per user? Recommendation (planner should confirm shape): one *unified* poller keyed by the union of hosts across all subscribed users, with per-host decrypt using the host's own owner userId (each `hosts` row has a `userId` column). Simpler than per-user poller instances; still correct for the multi-user forward-compat case; matches Skynet's per-user host ownership model.
- Alternative if the above adds complexity: per-user poller instance, deduplicated only if it becomes a measured hot spot.
- Ashley has not spoken to this specifically; planner picks the cleanest shape.

### Executor scope (fleet rule reminder)

Per box-maintainer standing directive: *"subagents (executors) don't do deploys — the orchestrator does."* The plan MUST NOT include a "ship" task at executor scope. Executor's remit stops at code + commit + tests green. Orchestrator (tanya) picks up rebase / build / deploy / verify / coord / patches entry.

### No worktrees

Per fleet rule: NO `isolation: "worktree"` on any Agent spawn. All work happens in the main tree at `~/skynet-tanya` on `feat/tab-title-from-tmux`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Backend — fleet-status pipeline
- `src/backend/starter.ts` — where the SSH-poll is wired at server boot (~line 155-360); `listIdentityHostingHosts`, `acquireSshChannel`, `releaseSshChannel`, `createSshPollOrchestrator` call site. This is the primary rewire target.
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — the orchestrator itself. `SshChannel` interface, `createSshPollOrchestrator`, `start()`, per-host poll loop, hook-payload read. May need lifecycle-control API additions (start-on-demand, stop-on-idle).
- `src/backend/fleet-status/fleet-status-server.ts` — WS server on port 30012 with path dispatch (`/fleet-status/ws` for browser, `/fleet-status/watcher` for backend). Frontend-connection handler is where subscription events originate — the lifecycle hook needs to fire here.
- `src/backend/fleet-status/subscription-registry.ts` — the shared registry passed between WS server + orchestrator. First-subscriber and last-unsubscriber signals may already be present, may need adding.
- `src/backend/fleet-status/host-id-resolver.ts` — for context; unlikely to need changes.

### Backend — SSH auth + decrypt (reference, do NOT modify)
- `src/backend/ssh/host-resolver.ts` — `resolveHostById(hostId, userId)` (line 14). The standard pattern to follow; DO NOT rewrite this, USE it.
- `src/backend/ssh/ssh-one-shot.ts` — `connectOneShot()`. Correct as-is; DO NOT rewrite.
- `src/backend/utils/simple-db-ops.ts` — `SimpleDBOps.select` (line 67). Reference for the decrypt wrapper.
- `src/backend/database/routes/sessions.ts:60-90` — canonical example of the "read host via resolveHostById, connect via connectOneShot, exec tmux commands" pattern that fleet-status SSH-poll should mirror.

### Backend — Plan 04 hook install (may need re-run per host)
- `src/backend/fleet-status/remote-hook-install.ts` — the install helper for `stop-hook.sh` on remote hosts.
- `src/backend/fleet-status/stop-hook.sh` — the script that gets installed and writes `~/.claude/fleet-status/last-stop-payload.json` on each host.
- `scripts/verify-monitor-payload.sh` — Phase 34 Plan 04 verify script.

### Logging
- `src/backend/utils/logger.ts` (or wherever `systemLogger` is defined) — how structured payload fields are formatted for console-forward. The `error` field passthrough gap lives here or in the console-forward pipeline.
- `/opt/skynet/console-forward-logs/console-forward.log` — where the diagnosis lives; use for regression sniff-tests during verify.

### Bounty tracker
- `~/.claude/roles/box-maintainer/bounties/fleet-status-ssh-poll-decrypt-and-lazy-lifecycle/bounty.json` — full diagnosis + design lockdown + verification plan.

### Prior context
- Phase 34 CONTEXT.md + Plan files (`.planning/phases/34-*/`) — the phase this fixes on top of.
- Patch #434 catalog entry in `~/.claude/roles/box-maintainer/skynet-patches.md` — Phase 34 ship notes (context on what SSH-poll was designed to do originally).
- Patch #439 catalog entry — Gate 1 fix (nginx `/fleet-status/` block); context on what's already working.

</canonical_refs>

<specifics>
## Specific Ideas

### Success shape from a real browser session
- Open a browser tab to `https://term.gigaashley.click/`
- fleet-status WS connects → backend logs `fleet_status_connect` + `fleet_status_frontend_subscribed`
- Within ~2 seconds, SSH-poll starts → per-host `fleet_status_host_poll_started` events fire (new op — currently silent) → SSH handshake succeeds via `resolveHostById` decrypt path → per-host `fleet_status_host_poll_success` events fire
- `SessionState` frames flow to the browser → `session-working-store` populates → convlist rows show ready-dots for idle sessions AND `<WipBubble />` renders in PrettyView for the working session
- Close all browser tabs → fleet-status WS server logs `fleet_status_frontend_disconnected` for the last one → within ~2 seconds, poller stops → per-host `fleet_status_host_poll_stopped` events fire
- No `fleet_status_host_ssh_unreachable` events during the poll-active window (the primary regression signal)

### Log-visible failure signatures the fix should ELIMINATE
- `fleet_status_host_ssh_unreachable` firing every 60s while browsers are closed (currently: yes, should be: no — orchestrator not running)
- Same op firing every 60s during a browser session (currently: yes, should be: no — decrypt path fixed)
- Structured `error` field swallowed in the logger (currently: yes, should be: no — `err.message` visible in `console-forward.log`)

### Test shape (per the plan's discretion)
- Unit test: mock `resolveHostById` to return a decrypted host record; assert `connectOneShot` is called with a plaintext PEM key.
- Unit test: mock the subscription registry; assert poller.start() fires on first-subscriber event; poller.stop() fires on last-unsubscriber event.
- Integration test (if plan opts in): stub the fleet-status WS server with a mock subscription; wire the orchestrator; assert start/stop lifecycle observed.
- No hard-fail-if-hook-missing test — the fail-open contract for missing `last-stop-payload.json` per host stays (locked by Ashley in Phase 34).

</specifics>

<deferred>
## Deferred Ideas

- Per-user poller instances (vs. one unified poller keyed by union of hosts across subscribed users). Not needed on this single-user box; may be revisited if multi-user semantics ever get exercised.
- TTL cache on decrypted host records to avoid re-decrypting on every poll tick. Not needed at v1 — poll interval is 60s, decrypt is cheap. Follow-up if measured hot.
- Any change to `PrettyConversationsPanel` / `WipBubble` / `WaitingBubble` / the store consumers. They're correct; they just have no data. This phase is entirely backend.
- The Phase 34 design-verification miss that shipped both Gates ("adding an nginx routing block for a new in-container service is part of the phase deliverable, not a follow-up") — banked as a lesson in patch #439's Follow-ups section; not this phase's scope to formalize into a project rule.

</deferred>

---

*Phase: 39-fleet-status-gate-2-ssh-poll-decrypt-via-user-session-presen*
*Context authored 2026-08-13 from Gate 2 diagnosis bounty + Ashley Path C decision in-session*
