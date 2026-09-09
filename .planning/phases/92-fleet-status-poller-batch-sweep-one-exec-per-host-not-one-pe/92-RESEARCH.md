# Phase 92: Fleet-status poller batch sweep — Research

**Researched:** 2026-09-09
**Domain:** Skynet backend fleet-status poller + fleet-substrate distributor
**Confidence:** HIGH (all findings verified by reading source at HEAD `0a8b5a6f`)

---

## Executive summary

The enumeration confirms the bounty's headline number. `src/backend/fleet-status/ssh-poll-orchestrator.ts` fires **9–11 `channel.exec` calls per identity per poll tick**, plus **1 per-host** enumeration exec (`ls` sessions dir) and **1 per-host** enumeration exec (`find` identities dir). At ~15 identities (mixed source A + source B) that lands in the same neighborhood as the ~75–90 the bounty premise cites. The exec count is architecturally intrinsic: source A iterates `~/.claude/sessions/*.json` (one PID per exec-set), source B iterates `~/.claude/identities/*` (one identity per exec-set), and each iteration path independently issues its own stat/tail/cat batch.

The distributor pattern (Phase 72–75) already ships bash and python helpers to every managed box's `~/.local/bin/` via a hand-maintained catalog + `runSweepForHost` composer. Adding a new sweep script requires: (a) drop a file under `substrate/scripts/`, (b) add one row to `FLEET_SUBSTRATE_CATALOG` in `src/backend/distributor/catalog.ts`, (c) rebuild the Skynet container so `/app/fleet-substrate/scripts/<name>` is bundled. No new subsystem, no new SSH machinery — the container-restart sweep (Phase 75 `server-substrate-orchestrator.ts`) picks it up on the next boot.

The SSH connection pool (`src/backend/ssh/ssh-connection-pool.ts`) is NOT used by the fleet-status poller. The poller opens ONE dedicated long-lived `ssh2.Client` per identity-hosting host (see `starter.ts` `acquireSshChannel` at L560–L655) and wraps it in a `makeSemaphore(8)`-throttled `SshChannel.exec` adapter. This means: one host = one SSH connection = one 8-slot exec bucket. The bounty is correct that the semaphore serialises rather than reduces work — every fan-out `Promise.all` inside the orchestrator's per-PID/per-identity iteration queues implicitly through that 8-slot bucket.

The **caller change is contained**: the sweep script replaces two nested loops inside `pollOneHost` (`processPid` per session-PID + `pollDormantOnlyIdentities` per identity). Everything downstream of "compose SessionState, publish delta" stays intact — parsing helpers (`parseSessionJson`, `parseStopHookPayload`, `filterAmbientTasks`, `scanTailForLatestAiTitle`, `scanTailForLayer1RecyclingSignal`, `detectIdReset`), the fingerprint delta, the registry publish contract, and the `livenessMap`/`identityRecycleState` caches all continue to work. Only the wire between "get raw bytes from box" and "have parsed state" changes.

Backward-compat via `test -x` probe on the sweep script path, cached per-host per-poll-cycle (`Set<hostId>`), is straightforward. The distributor's `readInstalledBytes` in `ssh-push.ts` already uses the exact idiom (`base64 -w0 '<path>' && echo __READ_OK__ || echo __READ_ENOENT__`); a slimmer `test -x` variant lands in the caller side of fleet-status without opening a new dependency.

The primary gotcha: the current per-tick exec flood is not simply a raw count — it's a **mix** of source-A stat calls that depend on `sessionJson.sessionId` (Phase 62 activity/stopped mtimes, Phase 59 lastStopAt) and source-B stats that depend on identity-folder names. The v1 sweep script MUST handle BOTH keying axes in one JSONL emission per identity, and the caller MUST decompose that emission into (a) per-PID state (session-JSON-derived) and (b) per-identity state (recycle/dormant-derived). Getting the JSONL schema wrong here is the single highest-risk failure mode of the whole phase.

---

## Current per-identity / per-host exec inventory (the "before" picture)

**File:** `src/backend/fleet-status/ssh-poll-orchestrator.ts`
**Adapter:** `channel.exec()` from `SshChannel` interface (L71–L74), bound in `starter.ts` L621–L630 to `execCommand(client, cmd)` (from `src/backend/ssh/tmux-helper.ts` L21–L54) wrapped in `makeSemaphore(8).run(...)`. The `tmux-helper` prefix in the failing log lines (`[tmux-helper] exec-failed command="..."`) comes from `sshLogger.error` at `tmux-helper.ts` L26 and L39 — every `channel.exec` in fleet-status logs through this path on channel-open-failure.

### Per-poll-tick per-host (fires ONCE per host per poll, not per identity)

| # | File | Line | Command | Purpose | Fires |
|---|------|------|---------|---------|-------|
| A0 | ssh-poll-orchestrator.ts | 871 | `ls -1 ~/.claude/sessions/*.json 2>/dev/null \|\| true` | Enumerate live-PID session files (source A driver) | 1× per poll per host |
| B0 | ssh-poll-orchestrator.ts | 997 | `find ~/.claude/identities/ -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null \|\| true` | Enumerate identity folders (source B driver) | 1× per poll per host |

### Per-poll-tick per-PID (source A — `processPid` L1236)

Fires once for each PID enumerated by A0. Session with N running claude processes → N×.

| # | File | Line | Command | Reads | Downstream consumer needs |
|---|------|------|---------|-------|---------------------------|
| A1 | 1244 | `cat ~/.claude/sessions/${pid}.json` | session-JSON (status, sessionId, procStart, cwd, updatedAt, waitingFor) | `parseSessionJson()` returns typed `SessionJson` |
| A2 | 1252 (via `readStatWithSentinel` L157–L184) | `cat /proc/${pid}/stat 2>&1 && echo __STAT_OK__ \|\| echo __STAT_ENOENT__` | `/proc/<pid>/stat` field 22 (starttime) for staleness check | `isStaleFromStat(procStart, content)` → bool; sentinel distinguishes transport-vs-ENOENT (Bounty 9c8d4a72) |
| A3 | 1253 | `cat ~/.claude/fleet-status/last-stop-payload.json 2>/dev/null \|\| true` | Box-wide Stop-hook payload (`background_tasks[]`) — legacy Phase 59 shape | `parseStopHookPayload()` → `background_tasks[]`; consumed as fallback after per-session read below |
| A4 | 1289 | `cat /proc/${pid}/environ` | PID environment vars — `TMUX_PANE=%N` + `TMUX=/tmp/tmux-…` for PID→tmux session resolution | `resolvePidToTmuxSession()` — extracts pane, then A5 resolves session name |
| A5 | 1292 | `tmux display-message -p -t '${pane}' '#{session_name}'` | tmux session name for the pane | Cached in `PidCacheEntry.tmuxSession` (only fires on cold cache) |
| A6 | 1335 | `stat -c %Y ~/.claude/fleet-status/stop-${sessionId}.json 2>/dev/null \|\| true` | Phase 59 per-session Stop mtime (unix seconds) | `derivedLastStopAt = parsed * 1000` — WIP shell-idle gate axis |
| A7 | 1391 | `stat -c %Y ~/.claude/fleet-status/hooks/${sessionId}/activity 2>/dev/null \|\| true` | Phase 62 per-session ACTIVITY marker mtime | `derivedActivityMtime = parsed * 1000` — new direct-signal WIP predicate LHS |
| A8 | 1411 | `stat -c %Y ~/.claude/fleet-status/hooks/${sessionId}/stopped 2>/dev/null \|\| true` | Phase 62 per-session STOPPED marker mtime | `derivedStoppedMtime = parsed * 1000` — new direct-signal WIP predicate RHS |
| A9 | 1473 | `cat ~/.claude/fleet-status/stop-${sessionId}.json 2>/dev/null \|\| true` | Per-session Stop-hook payload (fix quick-260829-kmr — preferred over box-wide A3) | `parseStopHookPayload()` → `background_tasks[]`; per-session preferred, box-wide fallback |
| A10 | 1563 | `stat ~/.claude/identities/${tmuxSession}/.dormant 2>/dev/null >/dev/null && echo yes \|\| echo no` | Dormant sentinel — source A path (fires per-PID when tmuxSession known) | `derivedDormant` — participates in fingerprint |
| A11 | 727 (via `discoverIdentityJsonlPathViaChannel`) | The Phase 32 discovery script — walks `~/.claude/projects/*/` mtime-desc, greps first user-line for `<command-name>/id</command-name><command-args><identity>` | Discovers current JSONL path for identity | Fires ONCE per PID lifetime on cold cache; cached in `PidCacheEntry.jsonlPath` |
| A12 | 1689 | `tail -c 262144 ${jsonlPath} 2>/dev/null \|\| true` | 256 KB JSONL tail | `scanTailForLatestAiTitle()` — ai-title axis (was also lastMessageAt scan, retired Phase 85; is also Layer 1 recycling scan — now moved to source B) |

**Source A per-PID exec count: 9 in the steady state** (A1–A3 always; A4–A5 skipped on cache hit; A6–A10 always; A11 skipped on cache hit; A12 when `jsonlPath` known). On cold cache first tick: 12 exec calls per PID.

Note A4+A5 are wrapped by `resolvePidToTmuxSession` — that helper's `readEnviron` and `resolveTmuxName` closures each fire one `channel.exec`.

### Per-poll-tick per-identity (source B — `pollDormantOnlyIdentities` L980)

Fires once for each identity name emitted by B0. Skipped for identities with live PIDs unless recycling axis fires (see L1114). Identity with N=15 total → up to 15×.

| # | File | Line | Command | Reads | Downstream consumer needs |
|---|------|------|---------|-------|---------------------------|
| B1 | 1021 | `stat ~/.claude/identities/${name}/.dormant 2>/dev/null >/dev/null && echo yes \|\| echo no` | Dormant sentinel — source B path | `isDormant` — participates in composed SessionState + fingerprint |
| B2 | 1024 | `stat ~/.claude/identities/${name}/.recycled-at 2>/dev/null >/dev/null && echo yes \|\| echo no` | `.recycled-at` sentinel | `isRecycledAt` — third recycle axis |
| B3 | 1027 | `test -f ~/.claude/identities/${name}/.recycle-requested 2>/dev/null && echo yes \|\| echo no` | `.recycle-requested` sentinel | `isRecycleRequested` — third recycle axis |
| B4 | 727 (via `discoverIdentityJsonlPathViaChannel`) | Phase 32 discovery script | JSONL path per identity | Fires ONCE per identity lifetime on cold cache; cached in `IdentityRecycleCacheEntry.jsonlPath`; re-fires after `STALE_TAIL_REDISCOVERY_THRESHOLD` (5 ticks) |
| B5 | 1063 | `tail -c 262144 ${jsonlPath} 2>/dev/null \|\| true` | 256 KB JSONL tail | `scanTailForLayer1RecyclingSignal()` — detects `/id <name>` reset in most-recent real user turn |

**Source B per-identity exec count: 5 in the steady state** (B1–B3 always parallel via Promise.all; B4 skipped on cache hit; B5 when `jsonlPath` known). On cold cache first tick: 5.

**IMPORTANT — source B skip semantics (L1114):** `if (liveTmuxSet.has(name) && !isRecycling)` → source B evicts and continues. So the FULL 5 exec-per-identity fires for every identity every tick UNTIL we know whether it's recycling; then non-recycling identities with live PIDs get their source-B state fully torn down. Rebuilding on next tick fires the 5 exec fan-out again. This is the biggest win the batch script gets — source B's 5×N exec cost per tick collapses to 0 additional exec calls (all state comes from the one sweep-script exec).

### Total exec math for a t1000-like box (~15 identities, most with live PIDs)

Steady-state per poll cycle (2s cadence):

- **1 (A0)** + **1 (B0)** + **9 × 15 PIDs (A1–A12)** + **5 × 15 identities (B1–B5)** ≈ **1 + 1 + 135 + 75 = 212 exec calls**

Even at semaphore(8), that queues into ~27 serial waves. In practice fewer identities have live PIDs and source B evicts the non-recycling ones, but the arithmetic explains why the bounty premise's "~75-90 per cycle" is a floor rather than a ceiling. The container log evidence in `issue-log.md` (18:08:35 exec-failed for `taylor` + `tabitha` dormant/recycle checks) shows both source A and source B racing SFTP openSftp() through the 8-slot bucket.

### Semaphore adapter (out-of-scope to modify but caller must be aware)

**File:** `src/backend/starter.ts` — `makeSemaphore` at L102–L122; wrap sites at L573 (existing-connection reuse path) and L621 (fresh-connection path).

Contract:
- FIFO queue, no timeout, propagates errors from `fn()` unchanged.
- The adapter's outer `try/catch → null` (L580–L582, L626–L628) is the SOLE null-conversion point in the exec pipeline. This is why `channel.exec` returns `string | null` — every SSH-side throw becomes `null` at exactly one point.
- Cap at 8 hardcoded. Per bounty premise, this phase leaves the cap intact; a follow-up phase loosens to 4 after prod verification.

**Implication for the sweep-script caller:** ONE `channel.exec(sweep-script-invocation)` per host per poll cycle occupies exactly 1 of the 8 semaphore slots for the duration of the script's server-side wall-clock run + one SSH round-trip. Semaphore starvation of SFTP + guacd + server-stats disappears as a class.

---

## Distributor pattern reference — how a new sweep script lands in the catalog + gets shipped

### Physical layout

1. **Canonical source of truth:** `substrate/scripts/<name>` (git-tracked in this repo). Mix of bash (`.sh`) and python (`.py`) already exists — 7 rows in current catalog: `agent-supervisor.sh`, `wakeup-scheduler.py`, `context-watch.py`, `role-file-watch.py`, `usage-reporter.sh`, `install-usage-reporter.sh`, `claude-usage-collector.py`.
2. **Container-bundle path:** `/app/fleet-substrate/scripts/<name>` (Docker COPY inside the Skynet image build; the Dockerfile is presumed to `COPY substrate/ /app/fleet-substrate/`). The catalog references this absolute path via `bundledPath`.
3. **Install path on managed box:** `~/.local/bin/<name-without-extension>` (existing convention — see agent-supervisor entry: `bundledPath: "/app/fleet-substrate/scripts/agent-supervisor.sh"` → `installPath: "~/.local/bin/agent-supervisor"`). Extension is dropped in the install path by convention.

### Catalog entry shape

**File:** `src/backend/distributor/catalog.ts` — `FLEET_SUBSTRATE_CATALOG` is a `readonly CatalogEntry[]` (L94). Each entry:

```typescript
export interface CatalogEntry {
  slug: string;              // kebab-case, log-only identifier
  bundledPath: string;       // /app/fleet-substrate/scripts/<name>
  installPath: string;       // ~/.local/bin/<name>
  restartHook: string | null;  // systemd --user unit name, or null
}
```

**Mode is NOT declared** — the push helper reads bundled file's `fs.statSync().mode` and mirrors it (masked to `0o777`; see `computeInstallMode` in `sweep-logic.ts` L141). This means the sweep script MUST be committed to git with the execute bit set (`chmod +x substrate/scripts/fleet-status-sweep.sh && git update-index --chmod=+x` if git doesn't track it).

**Restart hook:** For a sweep script that's invoked on-demand by the fleet-status caller (not a long-lived daemon), `restartHook: null`. Only `agent-supervisor` has a non-null hook because it runs as a systemd service.

Adding one row appends to the end of `FLEET_SUBSTRATE_CATALOG` — the catalog test at `catalog.test.ts` will need a count bump (row count is asserted; currently 21).

### Push mechanism

**File:** `src/backend/distributor/ssh-push.ts` (never-throws, uses same `SshChannel` adapter as the poll orchestrator — one exec per push op).

The `runSweepForHost` composer in `src/backend/distributor/run-sweep.ts` iterates catalog sequentially per host and for each row:
1. `readInstalledBytes(channel, installPath)` — `base64 -w0 <path> && echo __READ_OK__ || echo __READ_ENOENT__` (L67–L109)
2. Local `readBundledBytes(bundledPath)` via `bundled-reader.ts` `bundledReaderFromDisk` (fs.readFile + fs.stat)
3. `decideItemAction()` — pure byte-compare (sweep-logic.ts L102–L125)
4. On mismatch: `writeInstalledBytesWithMode(channel, installPath, bytes, mode)` via a heredoc `base64 -d` (L150–L199)
5. On push if `restartHook !== null`: `restartUserUnit(channel, unitName)` (L219–L250)

Retry on `channel returned null` (transport-only): `retryOnTransport` at L72–L85 (up to 3 tries, 200ms backoff).

### When the sweep runs

**File:** `src/backend/distributor/server-substrate-orchestrator.ts` — Phase 75 D-01 startup pass runs a serial sweep of every `runsFleetSubstrate:true` host at container boot. D-03 30s retry cadence re-sweeps until each host is marked done (`sweepedThisInstance: Set<hostId>`). Once-per-host-per-Skynet-lifetime gate (D-05).

**Rollout implication:** After the sweep script lands in `catalog.ts` and the container is rebuilt + restarted on t1000, the startup pass distributes the script to every `runsFleetSubstrate:true` peer box within seconds (serially, one host at a time). Boxes without `runsFleetSubstrate=true` do NOT get the script — this is a design choice, and Phase 92's backward-compat fallback covers those hosts as well as boxes mid-distribution.

### The `runsFleetSubstrate` opt-in

Not every identity-hosting host has `runs_fleet_substrate=true` in the `hosts` table. Boxes that opt out get NO distributor sweep → NEVER get the fleet-status-sweep script → the caller MUST fall back to legacy plumbing on them permanently. This is not a bug; it's the opt-in model. The backward-compat probe covers both "mid-rollout" AND "permanently opted-out" cases identically.

### Sibling helper via a different path (clarification)

`substrate/skills/agent-relay/recv.sh` is NOT under `substrate/scripts/` — it lands as a **skill companion** at `~/.claude/skills/agent-relay/recv.sh`, not as a helper at `~/.local/bin/`. Same distributor mechanism (one catalog row, byte-compare, push), different destination namespace. The new sweep script belongs under `substrate/scripts/` + `~/.local/bin/` — the helper path — because it's a Skynet-invoked utility, not a Claude-invoked skill.

---

## SSH connection pool + ssh2 constraints (what the caller can/can't assume)

### The fleet-status poller does NOT use the connection pool

**File:** `src/backend/ssh/ssh-connection-pool.ts` — this is `withConnection(key, factory, fn)` for per-request lease/release semantics (SFTP file-fetch, guacd auth, terminal-session-manager). `maxConnectionsPerHost = 3` (L13). Pool lease-and-release model would fight a 2s poll cadence (see orchestrator docblock L14–L18 explicitly rejecting this).

**Fleet-status uses:** ONE long-lived `ssh2.Client` per identity-hosting host, kept in `hostClients: Map<hostId, Client>` (starter.ts L560). Lifecycle:
- Created on first `acquireSshChannel(host)` — `connectOneShot(connDetails, 10000)` at starter.ts L608.
- Reused across all poll ticks for the life of the fleet-status orchestrator.
- Deleted on `client.on("end"/"close"/"error")` handlers (L615–L617); recreated on the next `acquireSshChannel` call.
- Force-closed on `releaseSshChannel(host, _channel)` — starter.ts L657–L692 (called when a host is admin-disabled or when the orchestrator stops via `onLastUnsubscriber`).

### One host = one connection = one 8-slot semaphore bucket

Every `channel.exec` from the poller opens a **new ssh2 exec channel** on that single shared `Client`. sshd's `MaxSessions=10` (per OpenSSH default; no override in t1000's `/etc/ssh/sshd_config` per `issue-log.md`) applies per-connection. The semaphore caps concurrent open channels at 8, leaving 2 for other channel users (SFTP, guacd, ad-hoc terminal).

**Implication for the sweep-script caller:** All fleet-status data collection for one host in one poll cycle goes through the same 8-slot bucket. Today that's ~200+ exec calls queued into ~25 serial waves. After the batch sweep it's 1 exec call — leaves 7 slots continuously free for other consumers.

### ssh2 exec-channel semantics the sweep-script caller must respect

- **stdout captured fully in memory** via `stream.on("data")` in `execCommand` at `tmux-helper.ts` L32–L34. No streaming shape; whole JSONL blob returned as one string at command end. Fine for expected ~15 identities × ~500 bytes/line ≈ 8 KB per sweep — orders of magnitude under any relevant limit.
- **Command times out via `Promise.race` at call site** — `execCommand` itself has no timeout; the caller wraps with a race (see `discoverIdentityJsonlPathViaChannel` at ssh-poll-orchestrator.ts L726–L739). The v1 sweep-script caller should set a similar timeout — recommend ~5s (each of B0 through A12 today is bounded well under 1s per call, and one aggregate script call should be well under a few seconds).
- **Non-zero exit + empty stdout → `execCommand` rejects** with the stderr content (tmux-helper.ts L42–L47). The channel adapter's outer try/catch swallows this and returns `null`. So `channel.exec` returns `null` for both "SSH transport error" AND "command exited non-zero with empty stdout". The sweep script MUST either exit 0 always (with an empty-JSONL sentinel if nothing found) OR the caller MUST treat `null` return as "sweep unavailable, fall back to legacy plumbing".
- **`command -v` / `test -x` idiom** already used throughout the codebase for presence probes (e.g. `tmux-helper.ts` L61: `command -v tmux`).

---

## Existing test patterns (for the planner's regression-test task)

### Framework

- **vitest** (`^4.1.8`), `vitest run` is `npm test`. Config at `/home/ubuntu/skynet-tina/vitest.config.ts`.
- Test file naming: co-located `<module>.test.ts` next to `<module>.ts`. Every fleet-status module has one.

### The MockSshChannel pattern (canonical, reuse this)

**File:** `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` L84–L118 — `MockSshChannel implements SshChannel`. Register command → response pairs via `setResponse(pattern, response)`; matched via `includes`. Every exec logged to `callLog` (query via `getCalls()` or `countCallsMatching(pattern)`).

This is exactly what the Phase 92 regression test needs. To assert "one exec per host per poll":
```
const sweepCalls = channel.countCallsMatching("fleet-status-sweep");
const legacyCalls = channel.countCallsMatching("~/.claude/identities/") 
                  + channel.countCallsMatching("cat /proc/") 
                  + channel.countCallsMatching("stat -c %Y ~/.claude/fleet-status/");
expect(sweepCalls).toBe(1);       // one aggregate call
expect(legacyCalls).toBe(0);      // NO per-identity fallback
```

### The MockRegistry pattern

**File:** ssh-poll-orchestrator.test.ts L124–L165 — `MockRegistry` captures `publishedStates[]` and `publishedGone[]` arrays. Regression test can assert the composed `SessionState` shape is unchanged after the batch swap (parity-with-today check).

### buildDeps helper (fake timers + injected clock)

L217–L289 — `buildDeps(overrides)` returns a full `OrchestratorDeps` shape plus a `fakeTimers.tick(ms)` helper. The `setInterval` mock captures the poll function so tests can invoke it manually (`setIntervalFns.find(f => f.ms === 2000).fn()`). Critical: the orchestrator does NOT use real timers in tests; the test drives poll ticks by hand.

### Fixtures

- `makeSessionJson(overrides)` L171 — builds a valid session-JSON string with defaults + overrides.
- `makeStatContents(starttime)` L185 — builds `/proc/pid/stat` content with the `__STAT_OK__` sentinel appended (post-Bounty 9c8d4a72).
- `makeValidPayload(tasks)` L201 — builds a Stop-hook payload with `background_tasks[]`.

For the sweep-script regression test, the planner will need a `makeSweepJsonl(identities)` helper that builds the aggregated JSONL blob — matches the v1 schema locked in Task 1 of the plan.

### The distributor test pattern (for the catalog entry test)

**File:** `src/backend/distributor/catalog.test.ts` (197 lines) asserts row count, slug uniqueness, path shape. Adding a row requires an extra assertion; the pattern is well-established (see e.g. `run-sweep.test.ts` L18–L26 which mocks `log-tags.js` cleanly).

### What the regression test should NOT try to do

Do NOT try to test the sweep-script's own behavior via a shell subprocess in vitest — it's not what this test surface is for. The plan should include a smaller `substrate/scripts/fleet-status-sweep.sh` unit test (or `.test.bash`) as a separate task, or defer the script-body verification to manual UAT on t1000 (per CONTEXT.md verification decisions). The vitest regression is about the **caller shape**, not the script logic.

---

## Backward-compat mechanics recommendation

### Presence probe idiom

**Cache per-host per-connection** (not per-poll-cycle) — the sweep-script's presence on a box is a rare-flip state (only changes when the container distributor sweep completes, or if a human deletes it). A `Set<hostId>` at the orchestrator scope updated only when the script transitions absent→present is sufficient. Do not re-probe every 2s — that itself becomes an exec-per-tick overhead.

Recommended shape (mirrors existing patterns):
```
// Once per host after acquireSshChannel, before first pollOneHost
const probeRaw = await channel.exec("test -x ~/.local/bin/fleet-status-sweep 2>/dev/null && echo yes || echo no");
const scriptPresent = probeRaw !== null && probeRaw.trim() === "yes";
hostState.sweepScriptPresent = scriptPresent;
```

`test -x` (not `test -f`) so a mode-drift bug that strips the execute bit still triggers legacy fallback.

**Re-probe on fingerprint miss** — if the sweep script exec ever returns `null` after previously succeeding, treat it as "script disappeared" (or transport hiccup), re-probe on the next tick, fall back to legacy plumbing until re-probe succeeds. Do NOT permanently lock out the sweep after one hiccup.

### Schema-version detection

Per CONTEXT.md `## Decisions` "Schema is versioned": every JSONL line carries a `schema_version` field. The caller checks the FIRST line's schema_version against a hardcoded expected version constant. Mismatch → warn once + fall back to legacy plumbing for this poll cycle. Do NOT try to parse per-line — a schema drift is architectural, not per-record.

### Existing "prefer new helper, fall back to inline" pattern to mirror

`ssh-poll-orchestrator.ts` L1770–L1790 — the per-session vs box-wide hook payload path:
```
const perSessionUsable = perSessionHookPayloadRaw !== null && perSessionHookPayloadRaw.trim() !== "";
const selectedHookPayloadRaw = perSessionUsable ? perSessionHookPayloadRaw : hookPayloadRaw;
```

Exact same shape works here: try the sweep-script exec first; on `null` or schema-version-mismatch, fall through to the legacy per-identity fan-out. The legacy code stays intact under the same `pollOneHost` function — just wrapped in an `if (!sweepUsable)` branch.

### The fallback code path stays testable

The regression test asserts "sweep exec fires once, no per-identity fan-out". A SECOND regression test should assert the inverse — "when sweep script probe returns absent, legacy per-identity fan-out fires and produces identical SessionState frames". Both branches need coverage; both are simple with the existing MockSshChannel.

---

## Surprises / gotchas

### G1 — Source A and Source B are DIFFERENT keying axes, one sweep script must serve both

Source A is keyed by **PID** (iterates `~/.claude/sessions/*.json` filenames like `12345.json` → PID). Source B is keyed by **identity name** (iterates `~/.claude/identities/*` folders). These are joined via `tmuxSession = resolvePidToTmuxSession(pid)` which resolves the PID's tmux session name (which IS the identity name in this fleet).

The v1 JSONL emission MUST include both axes on each line:
- Identity name (source B primary key)
- PID (if a live claude process exists for this identity — source A primary key; null otherwise)
- All source-A fields (session-JSON status, procStart, per-session Stop mtime, activity/stopped mtimes, ai-title, JSONL path, dormant-A) — only present when PID is non-null
- All source-B fields (dormant-B, recycled-at, recycle-requested, Layer 1 recycling scan) — always present

**Alternative shape:** two-tier emission — one JSONL line per identity carrying source-B state, followed by one JSONL line per live PID carrying source-A state (each source-A line joins to source-B via identity name). This might be cleaner for the caller-side parse. Planner should decide during Task 2 (schema lock).

### G2 — The DISCOVERY step (A11 / B4 — `discoverIdentityJsonlPathViaChannel`) is complex

The discovery walks `~/.claude/projects/*/` mtime-desc, greps the FIRST user-line of each JSONL for `<command-name>/id</command-name><command-args><identity-name><...>` (Phase 32 byte-pattern classifier). The script (`buildDiscoveryScript` at `src/backend/claude-session/discover-identity-session-file.ts`) is non-trivial — dozens of lines of bash.

**Decision needed in Task 2:** Does the sweep script itself run this discovery, or does it emit the current JSONL path (from a stat/cache side-channel) and let the caller do the discovery once per identity as today (fires ONCE per identity lifetime on cold cache; cached across ticks)?

**Recommendation:** Sweep script runs the discovery each tick — it's the whole point of collapsing to O(hosts). Cold-cache latency spikes disappear if every tick emits fresh state. The discovery script's own logic is stable and well-tested; the sweep script can source-include or inline it. Preserving cache-across-ticks in the caller is fine but stops being necessary. Confirm with planner.

### G3 — The Layer 1 recycling scan reads a JSONL tail; that's the SLOWEST part of source B

`tail -c 262144` (256 KB) + `scanTailForLayer1RecyclingSignal` (client-side JS scan). Moving the scan server-side into bash/python for the sweep script needs care — the current predicate `isAshleyRealUserTurn` (ssh-poll-orchestrator.ts L432–L472) is JS-only and non-trivial (JSON parse per line, multi-step predicate on `type`, `message.content`, various string prefixes/suffixes, control-char stripping).

**Options:**
1. Sweep script emits the raw 256 KB tail; caller does the JS scan as today. **Cost:** wire size (256 KB × 15 identities = 3.75 MB per sweep, big). Rules this out.
2. Sweep script emits just `layer1RecyclingSignal: bool | null` and hides the tail entirely on the box. **Cost:** duplicating `isAshleyRealUserTurn` in bash/python. Non-trivial but bounded (~40 lines of Python).
3. Sweep script emits a MUCH smaller extract (e.g. last N `type:"user"` lines from the tail, filtered) that the caller can scan with the JS predicate. **Cost:** medium wire size, still requires the caller to hold the JS predicate.

**Recommendation:** Option 2 — a Python sweep script (justified per CONTEXT.md discretion: "python is acceptable if the sweep logic genuinely needs it"). Bash + `grep` + `jq` for the JSONL-scan is fragile; Python with `json` stdlib is clean and can port the predicate cleanly. This is the primary case for python-over-bash in this phase.

If bash is preferred, `layer1RecyclingSignal: null` on every line + caller falls back to a per-identity tail scan for the recycling axis only. That partially defeats the point but keeps the script tiny. **Flag for planner discussion.**

### G4 — The `[tmux-helper]` log line prefix is misleading

The container log error `[tmux-helper] exec-failed command="test -f ~/.claude/identities/..."` looks like it comes from `tmux-helper.ts`, but it's actually just `execCommand()` from that module wrapping every SSH exec across the codebase — including all fleet-status calls. The prefix confused early bounty triage. **After Phase 92 ships, the "test -f identity" exec-failed spam goes to zero, but any residual `[tmux-helper] exec-failed` for other command shapes (e.g. `cat /proc/…/stat`) still lives in that log op.** Grep discipline for the verification task should filter on the exact command substring, not the log-op prefix.

### G5 — `pollOneHost` has a per-host in-flight guard (quick-260820-tm0)

L2034–L2066 — `inFlight: Set<hostId>` prevents `setInterval` from stacking poll iterations on a slow host. If the sweep-script exec is unexpectedly slow on some box (network jitter, remote OS load), a subsequent tick can be SKIPPED — resulting in longer perceived latency until state updates. Not a bug (the guard is intentional) but the caller should log the sweep-script duration so operators can spot degradation. Current source-B pipeline was fast enough not to trip this; a one-shot sweep script SHOULD be well under 2s per host by design, but a mispredicted `sleep`, dead identity dir with huge JSONL files, or a stalled `tail` could surface here.

### G6 — Source A skips per-PID iteration entirely when `sessionJson.sessionId` fails the regex `/^[a-zA-Z0-9_-]+$/`

L1333, L1389, L1409, L1471 — any sessionId with non-safe characters causes the caller to skip A6, A7, A8, A9 and fail-open with cached values. Path-traversal defense (a `../` in sessionId can't stat/cat a foreign session's file). The sweep script needs the SAME character-class guard on the server-side per-PID iteration, OR must accept that the caller applies the guard after receiving the JSONL. **Recommendation:** sweep script applies the guard server-side (avoids emitting suspect entries); caller applies it AGAIN as belt-and-suspenders (matches defense-in-depth conventions elsewhere).

### G7 — There are TWO existing `.dormant` reads (A10 + B1)

Both fire the identical stat call on `~/.claude/identities/${name}/.dormant`. Source A uses the read to stamp `state.dormant` on live-PID frames; source B uses it on dormant-only frames. Different code paths, same file, same purpose. The sweep script emits ONE dormant read per identity — the caller consumes it once for both frame types. Saves ~1 exec-per-identity vs a naive port. Small win, but shows the design pattern of "collapse redundancies at the emit boundary" the sweep script should aim for.

### G8 — `session-file-cache.ts` writeback (L1804) matters for the Claude-session attach path (Plan 55-03)

`writeSessionFileCache(host.id, tmuxSession, { sessionFile: jsonlPath, pid })` — the poll cycle populates a shared cache that non-poll consumers read opportunistically. After the batch swap, this write MUST still happen — the sweep script's emission of `jsonlPath` per PID must feed back into `writeSessionFileCache` in the caller. Test: `readSessionFileCache` after a batch-mode poll returns the same shape as after a legacy-mode poll.

### G9 — The Phase 62 rollout keeps THREE hook read paths coexisting (A3, A6, A7, A8, A9)

Per the extensive code comment at L1428–L1458, the box-wide `last-stop-payload.json` (A3), the Phase 59 `stop-<sid>.json` mtime (A6), the Phase 62 `activity` mtime (A7), the Phase 62 `stopped` mtime (A8), and the per-session `stop-<sid>.json` payload cat (A9) all read every tick during the rollout window. A follow-up phase retires the older ones. **The v1 sweep script MUST emit all five fields** — collapsing them prematurely would break the frontend's per-session predicate-choice logic (see Plan 62-04). This is a straightforward "emit everything the caller currently reads" pattern; just don't optimize away any of the reads until the retirement phase does the collapse cleanly.

### G10 — The distributor sweep also uses the same SSH channel — brief semaphore contention window at container start

The `server-substrate-orchestrator.ts` startup pass runs `runSweepForHost` serially across all `runsFleetSubstrate:true` hosts BEFORE the fleet-status poller can fire its first sweep-script exec on those hosts. There's a small startup window where the distributor sweep's ~30 exec calls (21 catalog rows × maybe one probe + one write per changed row) run through the same 8-slot semaphore as the poll's fleet-status-sweep exec. Not a correctness problem (semaphore is FIFO) but worth mentioning: right after container restart, the poll's first tick might see 1-2s of extra latency waiting for the distributor sweep to complete. Steady-state (post-first-tick) this is zero.

---

## Recommended reading list (files the planner should re-read before plan writing)

Order matters — start with (1) to lock schema before deciding anything else.

1. `src/backend/fleet-status/ssh-poll-orchestrator.ts` L980–L1230 (`pollDormantOnlyIdentities`) AND L1236–L1951 (`processPid`) — the two functions being replaced. The plan's Task 1 (enumerate + lock schema) needs both open in a diff view.
2. `src/backend/fleet-status/ssh-poll-orchestrator.ts` L432–L472 (`isAshleyRealUserTurn`) — the Layer 1 recycling predicate that must port server-side (G3 above).
3. `src/backend/claude-session/discover-identity-session-file.ts` — the JSONL discovery script (referenced but not enumerated in this doc); the sweep script either inlines/adapts this or invokes it.
4. `src/backend/distributor/catalog.ts` — catalog shape + all 21 existing rows. Add-a-row is trivial; the planner needs to specify slug + install path.
5. `src/backend/distributor/run-sweep.ts` — the composer. Confirms new script gets shipped on next container restart with no additional wiring.
6. `substrate/scripts/context-watch.py` first 100 lines — best python-substrate template if Task 3 picks python.
7. `substrate/scripts/agent-supervisor.sh` first 50 lines — best bash-substrate template if Task 3 picks bash.
8. `src/backend/starter.ts` L560–L692 — `acquireSshChannel` + `releaseSshChannel` + `makeSemaphore(8)` wrap. No changes here in this phase, but the planner should confirm the caller shape matches what the sweep script assumes about channel semantics.
9. `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` L84–L289 — MockSshChannel + MockRegistry + buildDeps helper. Copy-paste-adapt for the regression test in Task 6.
10. `~/.claude/roles/box-maintainer/bounties/fleet-status-poller-batch-sweep-single-exec-per-host/issue-log.md` — container log evidence at moment of failure; useful as the verification anchor for Task 5 (SFTP file-fetch success).

---

## Summary of what the plan needs to specify

The planner should turn this research into a plan with tasks that:

1. **Enumerate fields + lock v1 JSONL schema** — using the inventory above. Include `schema_version: 1` on every line. Decide one-line-per-identity vs two-tier (per-identity + per-PID) shape.
2. **Write the sweep script** — probably python (G3), lands at `substrate/scripts/fleet-status-sweep.py`. Sink: aggregate all state per identity + emit JSONL to stdout. Handles identity enumeration, per-identity stat fan-out, per-PID stat fan-out, discovery, tail scan, Layer 1 recycling predicate. Exits 0 with empty output on empty box.
3. **Add catalog row** — one entry in `FLEET_SUBSTRATE_CATALOG` in `catalog.ts`. Update `catalog.test.ts` row-count assertion. `installPath: "~/.local/bin/fleet-status-sweep"`, `restartHook: null`.
4. **Rewrite caller** — `pollOneHost` in `ssh-poll-orchestrator.ts`: presence probe once per host (cached), on-present invoke sweep exec + parse JSONL + drive existing `livenessMap` / `identityRecycleState` / registry publish contract, on-absent-or-null fall through to existing legacy plumbing (extract A0/A1–A12 + B0/B1–B5 into a helper function so both branches share). Preserve `writeSessionFileCache` (G8), preserve the sessionId character-class regex (G6).
5. **Regression test** — vitest in `ssh-poll-orchestrator.test.ts`: two tests — (a) sweep-present → one exec per host, no per-identity fan-out, identical SessionState output; (b) sweep-absent → legacy per-identity fan-out fires, identical SessionState output.
6. **Manual verification on t1000** — container log free of `Channel open failure` under normal load; SFTP file-fetch (Tabitha's reproducer curl) succeeds 20/20; source-B publishes match pre-batch behavior for recycle events. Deferred to `/gsd-verify-work` per CONTEXT.md.

Everything else CONTEXT.md defers (semaphore removal, push-based state, SFTP directory listing) stays deferred.

---

## Confidence breakdown

| Area | Level | Reason |
|------|-------|--------|
| Per-identity exec inventory | HIGH | Every line grepped + read against ssh-poll-orchestrator.ts at HEAD 0a8b5a6f |
| Distributor pattern | HIGH | All four files (catalog, ssh-push, sweep-logic, run-sweep) read end-to-end; existing agent-supervisor + wakeup-scheduler follow the pattern exactly |
| SSH pool + semaphore | HIGH | Both files read in full; makeSemaphore + adapter binding verified in starter.ts |
| Existing test patterns | HIGH | MockSshChannel + MockRegistry + buildDeps helper read in full |
| Backward-compat mechanics | MEDIUM | Recommendation is sound and mirrors existing patterns; the specific probe-cache scope (per-host-per-conn vs per-tick) is a caller decision the plan must lock |
| Sweep script implementation (bash vs python) | MEDIUM | G3 recommendation for python is well-founded but planner should confirm on plan review — CONTEXT.md leaves it discretionary |
| G3 wire-size math | MEDIUM | Estimate based on assumed line size; real numbers should come from a first-cut prototype |

**Research date:** 2026-09-09
**Valid until:** ~30 days for the codebase inventory; indefinite for the pattern-reference material.
