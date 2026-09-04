---
status: not_started
quick_id: 260820-tm0
slug: poll-backpressure-and-pruning
phase: quick-260820-tm0
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/fleet-status/ssh-poll-orchestrator.ts
  - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
  - src/backend/starter.ts
autonomous: true
requirements: [tm0-01, tm0-02]

must_haves:
  truths:
    - "When a prior pollOneHost(host) has not resolved, the next 2s poll tick MUST skip that host and MUST NOT re-invoke pollOneHost for it. When the prior call finally resolves, the NEXT tick MUST re-fire pollOneHost for that host."
    - "Skipping one slow host MUST NOT block polls for other hosts on the same tick — the in-flight guard is per-host, never global."
    - "On identity-host list refresh, hostIds present in perHostState but absent from the fresh list MUST be evicted: perHostState.delete(hostId) AND deps.releaseSshChannel(host, channel) called once for that host."
    - "After eviction, subsequent poll ticks MUST NOT include the evicted host — pollOneHost is never called for it and no SSH exec is issued against its channel."
    - "In production wiring (starter.ts), the release path invoked by the orchestrator on eviction MUST actually tear down the underlying ssh2 Client (client.end() + hostClients.delete(hostId)) — a no-op release would leak the connection the incident was about."
    - "The full backend + frontend test suite runs green after both fixes; type-check for both backend and frontend passes; the existing 12+ orchestrator tests continue to pass unmodified."
  artifacts:
    - path: "src/backend/fleet-status/ssh-poll-orchestrator.ts"
      provides: "Per-host in-flight guard on pollOneHost + perHostState pruning on refresh"
      contains: "inFlight"
    - path: "src/backend/fleet-status/ssh-poll-orchestrator.test.ts"
      provides: "Coverage for the in-flight guard (per-host isolation + release-on-completion) and for perHostState pruning (evict + channel-release + skip on subsequent tick)"
      contains: "quick-260820-tm0"
    - path: "src/backend/starter.ts"
      provides: "releaseSshChannel actually closes the ssh2 Client and removes it from hostClients, so eviction reclaims the connection instead of leaking it"
      contains: "hostClients.delete"
  key_links:
    - from: "orchestrator pollAllHosts()"
      to: "per-host in-flight Set/Map"
      via: "membership check before pollOneHost + add-on-schedule / delete-on-settle"
      pattern: "inFlight"
    - from: "orchestrator refresh block"
      to: "perHostState eviction path"
      via: "diff freshHosts vs perHostState keys, delete entries not in freshHosts, call deps.releaseSshChannel"
      pattern: "releaseSshChannel"
    - from: "starter.ts releaseSshChannel"
      to: "hostClients ssh2 Client teardown"
      via: "client.end() + hostClients.delete(host.id)"
      pattern: "hostClients.delete"
---

<objective>
Fix two related backpressure/lifecycle bugs in the fleet-status SSH poll orchestrator that caused the 2026-08-20 wilma incident (392 concurrent tailscale-ssh be-child sessions accumulated on the remote target).

1. **Per-host in-flight guard on `pollOneHost`** — when the previous `pollOneHost(host)` has not yet returned, the next 2s `pollAllHosts` tick must SKIP that host (not stack a second concurrent iteration on top). Log the skip with `fleetHostId` + a per-host skip counter. This is the load-bearing fix that stops be-child sessions from accumulating on slow-responding targets.

2. **perHostState pruning on refresh** — the existing refresh block only ADDS hosts from `listIdentityHostingHosts`; it never REMOVES hosts that disappeared from the fresh list (e.g., admin-disabled `enable_ssh=false`). Also compute the set of hostIds in `perHostState` but NOT in `freshHosts` and evict them: close the SSH channel/client cleanly via `deps.releaseSshChannel(host, channel)`, remove the `perHostState` entry, and log the eviction with `fleetHostId` + `hostName` + reason.

Production wiring correction: `starter.ts` currently defines `releaseSshChannel` as a no-op. For eviction to actually reclaim the connection (rather than leak the underlying ssh2 Client indefinitely in `hostClients`), update the production `releaseSshChannel` to `client.end()` + `hostClients.delete(hostId)`. Test-side `releaseSshChannel` is already `vi.fn()` and only needs to be asserted-on.

Purpose: stop unbounded per-host poll stacking on slow targets (the primary incident), and stop stale hosts from lingering in the poll rotation until container restart.

Output:
- `ssh-poll-orchestrator.ts` gains a module-scoped `inFlight = new Set<string>()` (hostId set), a per-host skip counter `Map<string, number>`, an in-flight membership check in `pollAllHosts` before `pollOneHost` runs (add-before / delete-in-`finally`), and an eviction diff in the refresh block that calls `deps.releaseSshChannel(host, channel)` + `perHostState.delete(hostId)` for hosts no longer in `freshHosts`.
- `ssh-poll-orchestrator.test.ts` gains two new describe blocks: (1) in-flight guard (slow-host isolation + release-on-completion + other-hosts-not-blocked), (2) perHostState pruning (evict on refresh + releaseSshChannel called + subsequent ticks skip the evicted host).
- `starter.ts` `releaseSshChannel` becomes a real teardown (`client.end()` + `hostClients.delete(host.id)`) so eviction actually reclaims the connection.
- `npx vitest run` exit 0 with zero failures; `npm run build:backend` and `npm run build` both exit 0.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@src/backend/fleet-status/ssh-poll-orchestrator.ts
@src/backend/fleet-status/ssh-poll-orchestrator.test.ts
@src/backend/starter.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Per-host in-flight guard on pollOneHost (code + tests, single commit)</name>
  <files>src/backend/fleet-status/ssh-poll-orchestrator.ts, src/backend/fleet-status/ssh-poll-orchestrator.test.ts</files>

  <behavior>
    In `ssh-poll-orchestrator.ts`:
    - Add two closure-scoped structures alongside `perHostState` inside `createSshPollOrchestrator`: `const inFlight = new Set<string>()` (hostIds whose `pollOneHost` is currently running) and `const skipCount = new Map<string, number>()` (per-host counter of consecutive skips — reset to 0 on a successful schedule).
    - In `pollAllHosts`, wrap the existing `for (const hostState of perHostState.values())` loop so that BEFORE calling `pollOneHost(hostState)` for a given `hostState.host.id`:
      - If `inFlight.has(hostId)`, increment `skipCount.get(hostId) ?? 0` by 1, log `systemLogger.info("Fleet-status: poll skipped — prior tick still in flight", { operation: "fleet_status_poll_skipped_inflight", fleetHostId: hostId, hostName: hostState.host.name, skipCount: <new value>, tick: pollTickCount })`, and CONTINUE (do not call `pollOneHost` for this host on this tick).
      - Otherwise, `inFlight.add(hostId)`, reset `skipCount.set(hostId, 0)`, and schedule `pollOneHost(hostState)`. The existing `try { await pollOneHost(hostState) } catch (err) { … }` block MUST get a `finally { inFlight.delete(hostId) }` so the guard clears on both success AND thrown errors (never leaks a stuck "in-flight" flag).
    - The guard MUST be per-host, not global. Other hosts on the same tick must proceed independently — the loop keeps its serial `for … of` shape (the existing code awaits each `pollOneHost` in order; that ordering is preserved). What changes is that a host currently marked in-flight from a PRIOR tick is skipped on THIS tick, while any host NOT in-flight runs normally.
    - Log level for the skip: INFO (per the incident brief — the wilma-scale accumulation was invisible for hours, so this needs to show up in the standard log stream, not DEBUG). Do NOT rate-limit — the skipCount field on the log payload gives Grafana/tail-consumers the escalation signal directly, and a skipped-poll is the whole point of what we want visible.
    - On eviction (Task 2), `inFlight` and `skipCount` entries for the evicted hostId MUST be cleaned up too — declare that requirement here in this task's constant docblock, implemented in Task 2's eviction block. Add a `// See Task 2 (quick-260820-tm0)` breadcrumb comment near the eviction cleanup site so the code cross-references cleanly.
    - Do NOT change `pollOneHost`'s signature or body. Do NOT touch `sweepAllHostsForStalePids` (the 30s stale sweep has its own cadence and is NOT covered by this guard — the incident was about pollAllHosts, and sweepOneHost's iteration is bounded by cached liveness map size, not by remote target latency in the same way).
    - Do NOT change `staleSweepIntervalMs` / `pollIntervalMs` defaults.
    - Add a header comment above the in-flight structures citing `quick-260820-tm0` and pointing at the 2026-08-20 wilma incident (392 be-child sessions) so a future reader hitting these two variables understands why they exist. The comment must explicitly note: "per-host, not global — a slow host must not block polls for other hosts."

    In `ssh-poll-orchestrator.test.ts`:
    - Add a new describe block titled `"quick-260820-tm0 — per-host in-flight guard on pollOneHost"` near the bottom of the file (after the Phase 47 Plan 02 aiTitle block). Do NOT modify Tests 1-12 or any Phase 41/44/47 tests — they exist to lock behavior that this change must preserve.
    - Test IF1 — "slow-host isolation: prior tick in-flight → next tick skips that host, does NOT stack a second pollOneHost". Setup: build a MockSshChannel whose `ls -1` response is served through a manually-controlled Promise (a `deferred` pattern — `{ promise, resolve }` — captured in the test scope) so the FIRST poll tick "hangs" until the test resolves it. Start the orchestrator (which fires the immediate initial poll — that immediate poll enters `inFlight`, hits `await channel.exec("ls -1 …")`, and blocks on the deferred promise). Assert `inFlight` has the host (via a spy on `systemLogger.info` for the `fleet_status_poll_start` log — the test can count how many times poll-start was logged for this host). Trigger the next tick by invoking the captured 2s `pollFn` from `setIntervalFns`. Assert that `fleet_status_poll_skipped_inflight` was logged EXACTLY once with `fleetHostId: "host-1"` and `skipCount: 1`. Assert that `pollOneHost` did NOT fire a second `ls -1` — count via `channel.countCallsMatching("ls -1")` (baseline is the ONE call from the still-hanging initial poll). Trigger the next tick again (still in flight). Assert a SECOND `fleet_status_poll_skipped_inflight` log with `skipCount: 2`. Now `resolve()` the deferred promise for `ls -1` (returning valid empty listing `""`), await one microtask, then trigger the next tick. Assert THIS tick fires a fresh `ls -1` (call count increases by 1) — the guard released and re-armed on the settle.
    - Test IF2 — "per-host, not global: one hung host does NOT block polls for another host". Setup: two hosts (`host-1` deferred/hung on `ls -1`, `host-2` responsive with a normal happy-path channel). Two separate MockSshChannel instances, one per host, with `deps.acquireSshChannel` returning the correct channel per host argument. Start the orchestrator (initial poll: host-1 hangs, host-2 completes). Trigger the next 2s tick. Assert: `host-1` gets a `fleet_status_poll_skipped_inflight` log (skipCount:1) AND `host-2` fires a fresh poll cycle (assert `channel2.countCallsMatching("ls -1")` incremented). Resolve host-1's deferred promise, trigger one more tick — both hosts fire this tick.
    - Test IF3 — "in-flight flag clears even when pollOneHost throws". Setup: single host, mock `channel.exec` for `ls -1` to REJECT (not return null — actually throw) on the first call. Start orchestrator (initial poll enters try, catches the throw, logs the existing `fleet_status_poll_error` warn). Assert `inFlight` is empty after the settle (the guard must be released via `finally`, not just on the happy-path return). Trigger the next tick — the poll fires again cleanly (assert `channel.countCallsMatching("ls -1")` == 2). This test guards against the "finally forgotten" regression.

    Use the existing `MockSshChannel`, `MockRegistry`, `buildDeps`, and `setIntervalFns` pattern verbatim — do NOT introduce new test helpers. If a `deferred()` helper is needed, add a small local factory inside the new describe block:
    ```
    function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } { … }
    ```
    (this is not a plan-inline code block placed inside <action> — it lives inside the test file). Use `vi.mocked(systemLogger.info).mock.calls` and `.filter(c => …operation === "fleet_status_poll_skipped_inflight")` in the same style Tests 5/F1-F5 use to count `fleet_status_hook_payload_missing` warns.

    Existing tests must remain green — extend, do not rewrite. Do not touch the top-of-file mocks or `buildDeps` defaults.
  </behavior>

  <action>
Add the per-host in-flight guard to `src/backend/fleet-status/ssh-poll-orchestrator.ts` inside `createSshPollOrchestrator`: introduce `inFlight = new Set<string>()` and `skipCount = new Map<string, number>()` alongside `perHostState`, with a header comment citing `quick-260820-tm0` and the 2026-08-20 wilma incident. In `pollAllHosts`, before the existing try/catch around `pollOneHost(hostState)`, gate on `inFlight.has(hostState.host.id)`: if present, increment `skipCount`, log INFO `fleet_status_poll_skipped_inflight` with `fleetHostId`, `hostName`, `skipCount`, and `tick`, and `continue`. Otherwise `inFlight.add(hostId)` + `skipCount.set(hostId, 0)`, then wrap the existing `await pollOneHost(hostState)` in a `try/catch/finally` where `finally` calls `inFlight.delete(hostId)` (the flag must clear on thrown errors, not just on happy-path returns). Leave `pollOneHost`, `sweepAllHostsForStalePids`, and both interval cadences untouched. Add a `// See Task 2 (quick-260820-tm0)` breadcrumb near the future eviction cleanup site — Task 2 will implement the corresponding `inFlight.delete` + `skipCount.delete` for evicted hostIds.

Add three tests to `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` in a new describe block `"quick-260820-tm0 — per-host in-flight guard on pollOneHost"`. IF1 uses a `deferred()` promise wired into `MockSshChannel`'s `ls -1` response to hang the initial poll, then drives two subsequent 2s ticks and asserts `fleet_status_poll_skipped_inflight` fires with `skipCount:1` and `skipCount:2` while `ls -1` call count on the channel stays at 1, then resolves the deferred and asserts the NEXT tick fires a fresh `ls -1`. IF2 exercises two hosts with two channels — one hung, one responsive — and asserts skip fires for the hung host while a fresh poll cycle runs for the responsive host on the same tick. IF3 rejects the first `ls -1` exec, asserts the existing `fleet_status_poll_error` warn fires, and confirms the NEXT tick fires a fresh `ls -1` (proving `finally` released the guard on throw). Use the existing `buildDeps`, `MockSshChannel`, `MockRegistry`, and `setIntervalFns` patterns — do not modify or fork them.

Commit as a single atomic commit: `feat(fleet-status): per-host in-flight guard on pollOneHost (quick-260820-tm0 fix 1/2)`.
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet-tiffany &amp;&amp; npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts -t "in-flight guard"</automated>
  </verify>

  <done>
    - `inFlight = new Set<string>()` and `skipCount = new Map<string, number>()` declared inside `createSshPollOrchestrator` in `ssh-poll-orchestrator.ts` with a header comment citing quick-260820-tm0 and the 2026-08-20 wilma incident.
    - `pollAllHosts` gates on `inFlight.has(hostId)` BEFORE calling `pollOneHost`; skipped hosts log `fleet_status_poll_skipped_inflight` at INFO with `fleetHostId`, `hostName`, `skipCount`, `tick`.
    - The `pollOneHost` invocation is wrapped in `try/catch/finally` such that `inFlight.delete(hostId)` runs on both success and thrown errors.
    - Three new tests (IF1, IF2, IF3) in the `quick-260820-tm0` in-flight guard describe block all pass.
    - All existing tests in `ssh-poll-orchestrator.test.ts` (Tests 1-12, F1-F6, Phase 41 D-F, Phase 44 G-K, Phase 47 1-6) still pass unmodified.
    - `grep -n "inFlight" src/backend/fleet-status/ssh-poll-orchestrator.ts` returns matches (structure declared + gated + finally-released).
    - Single atomic commit landed.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: perHostState pruning on refresh + starter.ts release actually closes the client (code + tests, single commit)</name>
  <files>src/backend/fleet-status/ssh-poll-orchestrator.ts, src/backend/fleet-status/ssh-poll-orchestrator.test.ts, src/backend/starter.ts</files>

  <behavior>
    In `ssh-poll-orchestrator.ts`:
    - In the existing refresh block inside `pollAllHosts` (currently: iterates `freshHosts` and adds hosts not in `perHostState`), after the existing add-loop, compute the eviction set: `const freshIds = new Set(freshHosts.map(h => h.id));` then iterate `perHostState` and collect any `[hostId, hostState]` where `!freshIds.has(hostId)`. For each such entry:
      - Log INFO `systemLogger.info("Fleet-status: evicting host no longer in identity-host list", { operation: "fleet_status_host_evicted", fleetHostId: hostState.host.id, hostName: hostState.host.name, reason: "no longer in identity-host list" })`.
      - Call `deps.releaseSshChannel(hostState.host, hostState.channel)` inside a `try { … } catch { /* best-effort release, do not throw */ }` block — same defensive shape as `stop()` uses when clearing channels on shutdown (see the existing `for (const hostState of perHostState.values()) { try { deps.releaseSshChannel(…) } catch {} }` at the bottom of `stop()`).
      - `perHostState.delete(hostId)`.
      - `inFlight.delete(hostId)` and `skipCount.delete(hostId)` (paired cleanup from Task 1 — the breadcrumb comment placed in Task 1 lives immediately above this cleanup site).
    - The eviction runs INSIDE the same `try { … } catch (err) { … }` block that already wraps `deps.listIdentityHostingHosts()` — if the DB query fails, we currently keep the existing `perHostState` intact (no eviction on refresh failure). This is intentional: eviction MUST be tied to a successful fresh listing, otherwise a transient DB blip would evict every host. The eviction diff runs only when `freshHosts` was successfully returned.
    - Do NOT touch the add-branch (`if (!perHostState.has(host.id)) await tryAcquireHostChannel(host);`) — its behavior is unchanged.
    - Do NOT change the refresh cadence (`hostRefreshEveryNTicks`) or the timers.

    In `starter.ts`:
    - Replace the current no-op `releaseSshChannel(host, _channel)` implementation (currently at lines ~436-444) with a real teardown: look up `hostClients.get(host.id)`; if present, call `client.end()` inside `try { … } catch { /* best-effort */ }`, then `hostClients.delete(host.id)`. Keep the `_channel` parameter (still unused — the orchestrator's SshChannel abstraction is a thin exec wrapper with no independent lifecycle; the real handle lives in `hostClients`). Update the header comment: replace the "long-lived channels are NOT released after each use" language with a "eviction path (Task 2, quick-260820-tm0): closes and removes the underlying ssh2 Client from hostClients so an admin-disabled host reclaims its connection instead of leaking" note. Also clear the corresponding `hookInstallAttempted.delete(host.id)` entry — so if the same host is re-enabled later, `installStopHook` is re-attempted on the fresh acquire (matches the existing `hookInstallAttempted.clear()` on `onLastUnsubscriber`).
    - The auto-remove handlers already registered on the client (`.on("end")`, `.on("close")`, `.on("error")`) will fire on `client.end()` and remove the entry themselves — the explicit `hostClients.delete(host.id)` after `client.end()` is belt-and-suspenders in case a synchronous eviction diff races the event-loop-async 'end' event. Idempotent double-delete is safe (Map.delete on a missing key is a no-op).

    In `ssh-poll-orchestrator.test.ts`:
    - Add a new describe block titled `"quick-260820-tm0 — perHostState pruning on refresh"` near the bottom of the file (immediately after the in-flight guard block from Task 1).
    - Test PR1 — "host absent from fresh list → evict: perHostState.delete + releaseSshChannel called + eviction log". Setup: two hosts `host-A` and `host-B` seeded via `deps.listIdentityHostingHosts` returning both on start. Start the orchestrator (both hosts acquired). Advance the tick count so `pollTickCount % hostRefreshEveryNTicks === 0` triggers the refresh block on the next `pollFn()` call — the default `hostRefreshEveryNTicks` at 2s poll / 30s sweep is 15, so drive 15 ticks by invoking `pollFn` 14 more times after start (start fires 1, plus 14 = 15). Between tick 14 and tick 15, swap `deps.listIdentityHostingHosts` (via `vi.mocked(deps.listIdentityHostingHosts).mockResolvedValue([host-A only])`). Invoke `pollFn` for tick 15 (the refresh runs). Assert: `deps.releaseSshChannel` was called EXACTLY ONCE with `host-B`'s host record and `host-B`'s channel; `perHostState` no longer contains host-B (indirect assertion: the next `pollFn` tick issues zero SSH exec calls against `channel-B`); a `fleet_status_host_evicted` INFO log fired with `fleetHostId: "host-B"`, `hostName: "host-B-name"`, `reason: "no longer in identity-host list"`.
    - Test PR2 — "after eviction, host-B's channel receives zero further SSH commands". Continuation of PR1's setup (or a fresh identical setup — whichever is cleaner). After the refresh tick that evicts host-B, invoke `pollFn` two more times and assert `channel-B.countCallsMatching("ls -1")` did NOT increment beyond its pre-eviction baseline. Assert `channel-A.countCallsMatching("ls -1")` DID increment on each of those two ticks (host-A poll continues normally).
    - Test PR3 — "DB refresh throws → NO eviction happens (defensive: transient DB blip must not wipe the poll rotation)". Setup: two hosts `host-A` and `host-B`; start; drive 14 ticks; on tick 15, `vi.mocked(deps.listIdentityHostingHosts).mockRejectedValueOnce(new Error("db blip"))`. Invoke `pollFn` for tick 15. Assert: `deps.releaseSshChannel` was NOT called (zero times since start); `perHostState` still contains BOTH hosts (indirect: the next `pollFn` polls both). Assert `fleet_status_host_list_refresh_failed` warn fired (existing log, unchanged).
    - Test PR4 — "eviction cleans up inFlight and skipCount too". Setup: single host `host-C`; seed a hung `ls -1` on channel-C (deferred pattern from Task 1) so `host-C` is in-flight when the refresh tick runs. Drive ticks to refresh threshold. Between ticks, swap `listIdentityHostingHosts` to return `[]` (empty — host-C removed). Trigger the refresh tick. Assert: `host-C` is evicted (releaseSshChannel called, perHostState empty). Now resolve the deferred promise (the still-outstanding pollOneHost completes). Trigger one more tick. Assert: no `fleet_status_poll_skipped_inflight` log fires (skipCount was cleaned on eviction — not carried forward with a stale count if host-C were to be re-added later). Assert: no `pollOneHost` fires for host-C on this or subsequent ticks (host is gone from `perHostState`).

    A separate mini-test for `starter.ts`'s `releaseSshChannel` is NOT required — the file is not currently unit-tested, and the behavior surface (`client.end()` + `hostClients.delete`) is exercised end-to-end at container start/stop already. The orchestrator-side tests spy on `deps.releaseSshChannel` (which IS mocked via `vi.fn()` in `buildDeps`), which is the correct isolation point.

    Existing tests must remain green. The new describe blocks live at the bottom of the test file; do not reorder or edit the existing test blocks.
  </behavior>

  <action>
Extend the refresh block in `pollAllHosts` inside `src/backend/fleet-status/ssh-poll-orchestrator.ts`: after the existing add-loop, compute `freshIds = new Set(freshHosts.map(h => h.id))`, iterate `perHostState` entries, and for each hostId not in `freshIds` — log INFO `fleet_status_host_evicted` with `fleetHostId`, `hostName`, and `reason: "no longer in identity-host list"`; call `deps.releaseSshChannel(hostState.host, hostState.channel)` inside a defensive try/catch (mirroring the pattern in `stop()`); `perHostState.delete(hostId)`; `inFlight.delete(hostId)` and `skipCount.delete(hostId)` (the paired cleanup Task 1 flagged with a breadcrumb comment). Eviction runs INSIDE the existing try that wraps `listIdentityHostingHosts()` so a DB-refresh failure preserves the current `perHostState` (no eviction on transient failure). Do not modify the add-branch or the refresh cadence.

Update `src/backend/starter.ts` `releaseSshChannel` (currently at ~L436-444) to be a real teardown: `const client = hostClients.get(host.id); if (client) { try { client.end(); } catch { /* best-effort */ } hostClients.delete(host.id); hookInstallAttempted.delete(host.id); }`. Keep the `_channel` parameter (still unused by design — orchestrator's SshChannel is a thin exec wrapper; the real handle is in `hostClients`). Replace the header comment referencing "not released after each use" with a note explaining the eviction path added by quick-260820-tm0.

Add four tests (PR1, PR2, PR3, PR4) to `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` in a new describe block `"quick-260820-tm0 — perHostState pruning on refresh"` immediately after the in-flight guard block. Use the existing `MockSshChannel` / `MockRegistry` / `buildDeps` / `setIntervalFns` pattern; drive the refresh by invoking `pollFn` `hostRefreshEveryNTicks` times so the refresh block's `pollTickCount % hostRefreshEveryNTicks === 0` gate fires. Assert on `deps.releaseSshChannel` (a `vi.fn()` in `buildDeps`), on `fleet_status_host_evicted` INFO logs, on the absence of further SSH commands against the evicted channel, and (PR3) on the no-op behavior when `listIdentityHostingHosts` rejects.

Commit as a single atomic commit: `feat(fleet-status): perHostState pruning on refresh + starter release actually closes ssh2 Client (quick-260820-tm0 fix 2/2)`.
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet-tiffany &amp;&amp; npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts -t "perHostState pruning"</automated>
  </verify>

  <done>
    - Refresh block in `pollAllHosts` evicts hosts absent from `freshHosts`: `deps.releaseSshChannel` called, `perHostState.delete(hostId)`, `inFlight.delete(hostId)`, `skipCount.delete(hostId)`, `fleet_status_host_evicted` INFO log fired.
    - Eviction runs only on successful DB refresh (inside the same try block that wraps `listIdentityHostingHosts()`) — a rejected refresh preserves `perHostState`.
    - `starter.ts` `releaseSshChannel` now performs a real teardown: `client.end()` + `hostClients.delete(host.id)` + `hookInstallAttempted.delete(host.id)`. Comment updated to reference quick-260820-tm0.
    - Four new tests (PR1, PR2, PR3, PR4) in the `quick-260820-tm0` pruning describe block all pass.
    - All existing tests in `ssh-poll-orchestrator.test.ts` still pass unmodified.
    - `grep -n "fleet_status_host_evicted\|freshIds" src/backend/fleet-status/ssh-poll-orchestrator.ts` returns matches.
    - `grep -n "hostClients.delete(host.id)" src/backend/starter.ts` returns matches in the `releaseSshChannel` body (in addition to the pre-existing occurrences in the `.on("end")` / `.on("close")` / `.on("error")` handlers).
    - Single atomic commit landed.
  </done>
</task>

<task type="auto">
  <name>Task 3: Full-suite green gate — vitest + backend build + frontend build</name>
  <files>(no code changes — gate task only)</files>

  <action>
Run the three gates in order. Each MUST exit 0. If any fails, DIAGNOSE and FIX before proceeding (do NOT rebase, do NOT ship — the orchestrator handles that after this plan is code-complete + tests-green). Any fix goes in a separate atomic commit; note the commit in this task's done log so the SUMMARY can reference it.

1. `cd /home/ubuntu/skynet-tiffany && npx vitest run` — zero failures across the entire backend + frontend suite. The orchestrator's 12 baseline tests + F1-F6 + Phase 41 D-F + Phase 44 G-K + Phase 47 1-6 + the seven new tests added by Tasks 1-2 (IF1-IF3 + PR1-PR4) must all pass.
2. `cd /home/ubuntu/skynet-tiffany && npm run build:backend` — exit 0. This is the load-bearing check for backend TypeScript errors — `tsc --noEmit` from the frontend tsconfig does NOT cover backend code (documented gotcha in the incident brief; `.ts` and `.js` extension mismatches in backend imports will pass the frontend typecheck but fail this build).
3. `cd /home/ubuntu/skynet-tiffany && npm run build` — exit 0. Full-project build, covers any cross-cutting typecheck the backend build alone doesn't hit.

Do NOT run `docker build`, do NOT run any deploy step, do NOT push to origin, do NOT rebase onto main. Ship is Tiffany's job.
  </action>

  <verify>
    <automated>cd /home/ubuntu/skynet-tiffany &amp;&amp; npx vitest run &amp;&amp; npm run build:backend &amp;&amp; npm run build</automated>
  </verify>

  <done>
    - `npx vitest run` exit 0, zero failures.
    - `npm run build:backend` exit 0.
    - `npm run build` exit 0.
    - If any gate required a fix commit, the commit SHA is noted here for the SUMMARY.
  </done>
</task>

</tasks>

<verification>
  Final gates before considering the plan complete:

  1. `grep -n "inFlight\|skipCount" src/backend/fleet-status/ssh-poll-orchestrator.ts` returns matches (declaration + gate + `finally` release + eviction cleanup).
  2. `grep -n "fleet_status_poll_skipped_inflight\|fleet_status_host_evicted" src/backend/fleet-status/ssh-poll-orchestrator.ts` returns matches (both new INFO log lines present).
  3. `grep -n "hostClients.delete(host.id)" src/backend/starter.ts` returns matches inside the `releaseSshChannel` function body.
  4. `grep -n "quick-260820-tm0" src/backend/fleet-status/ssh-poll-orchestrator.ts src/backend/fleet-status/ssh-poll-orchestrator.test.ts src/backend/starter.ts` returns matches in all three files (traceability breadcrumbs).
  5. `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — green, and the file's test count increased by exactly 7 (IF1, IF2, IF3, PR1, PR2, PR3, PR4).
  6. `npx vitest run` — full-suite green, zero failures.
  7. `npm run build:backend` — exit 0.
  8. `npm run build` — exit 0.
  9. `git log --oneline feat/tab-title-from-tmux | head -5` — shows the two atomic feature commits from Tasks 1-2 (and optionally a fix commit from Task 3 if a gate needed patching).
  10. No new files created outside the three listed in `files_modified`. No frontend, no wire-protocol, no DB-schema changes.
  11. No deploy step ran. No `docker build`. No `git push`. No rebase onto main. (Orchestrator ships.)
</verification>

<success_criteria>
- **Backpressure fix (Task 1):** A slow-responding remote target CANNOT stack multiple concurrent `pollOneHost` iterations on the same hostId — the second-and-onward ticks are skipped and logged at INFO with a `skipCount` field. The guard is per-host: other hosts on the same tick proceed normally. The in-flight flag clears on both happy-path return AND thrown error (via `finally`). This is the load-bearing fix that closes the 2026-08-20 wilma incident (392 be-child sessions on the remote target).
- **Pruning fix (Task 2):** When `listIdentityHostingHosts` no longer returns a host (e.g., admin-disabled), that host is evicted from `perHostState` on the next refresh tick: the SSH channel/client is closed cleanly (via `deps.releaseSshChannel` → `starter.ts` `client.end()` + `hostClients.delete`), the entry is removed from `perHostState`, and the paired `inFlight`/`skipCount` state is cleaned up. Subsequent poll ticks issue zero SSH commands against the evicted host.
- **Defensive eviction:** A transient DB failure on `listIdentityHostingHosts()` does NOT trigger eviction — the existing `perHostState` is preserved intact until a successful refresh. (PR3 locks this.)
- **Production wiring:** `starter.ts`'s `releaseSshChannel` is no longer a no-op — eviction actually reclaims the underlying ssh2 Client connection instead of leaking it. `hookInstallAttempted` is also cleaned up so a re-enable of the same host re-attempts Stop-hook install on the fresh acquire.
- **Tests:** Seven new tests (IF1-IF3, PR1-PR4) added in two new describe blocks scoped `quick-260820-tm0`. All existing tests (12 baseline + F1-F6 + Phase 41 D-F + Phase 44 G-K + Phase 47 1-6) still pass unmodified — this change extends coverage, it does not rewrite it.
- **Green suite:** `npx vitest run` exit 0, zero failures. `npm run build:backend` exit 0. `npm run build` exit 0.
- **Out of scope (explicit):** No frontend, no wire-protocol, no DB schema. No `docker build`, no deploy, no push to origin, no rebase onto main. No changes to `~/.claude/roles/box-maintainer/skynet-patches.md` or the bounty file. Ship is Tiffany's job.
</success_criteria>

<output>
Create `.planning/quick/260820-tm0-poll-backpressure-and-pruning/260820-tm0-SUMMARY.md` when done, following the standard summary template. Include:
- The two feature commit SHAs from Tasks 1-2.
- Any fix-commit SHA from Task 3 (if a gate needed patching).
- A one-line note that ship/deploy/docker-build was explicitly OUT of this plan's scope — orchestrator handles deploy after code-complete + tests-green.
- A pointer back to the 2026-08-20 wilma incident (392 be-child sessions) as the WHY.
</output>
