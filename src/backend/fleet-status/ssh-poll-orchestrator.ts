/**
 * ssh-poll-orchestrator.ts — 2s SSH-poll coordinator for the Skynet backend.
 *
 * ## D-CTX § PIVOT 2026-08-13 (LOCKED)
 * No per-box daemon. No systemd user unit. No standalone subpackage.
 * This module IS the fleet-status watcher — it runs inside the Skynet backend
 * process and uses the existing Skynet SSH primitives to poll identity-hosting
 * boxes every 2 seconds.
 *
 * ## Architecture
 * - Opens ONE long-lived SSH channel per identity-hosting host (via the
 *   `acquireSshChannel` injected dep — bound to `connectOneShot` in starter.ts).
 *   Using a dedicated per-host long-lived Client rather than the per-request
 *   `withConnection` pool: the 2s cadence would fight the pool's max-per-host
 *   limit (3) if we leased + released a connection every 2 seconds across N hosts.
 *   A long-lived Client keeps exactly one SSH control channel per host open
 *   for the life of the orchestrator, satisfying T-34-18 (pool exhaustion).
 * - On each 2s tick: lists `~/.claude/sessions/*.json`, reads session-JSON +
 *   /proc/<pid>/stat + hook payload for each PID (batched Promise.all), parses
 *   via Plan 01 pure-library helpers, computes SessionState, publishes state
 *   deltas to the Plan 02 SubscriptionRegistry.
 * - 30s stale sweep: re-probes each tracked PID's /proc/stat to catch PIDs that
 *   vanished between poll ticks (e.g. session-JSON deleted mid-tick).
 *
 * ## Fail-open on missing hook payload file (Alice 2026-08-13 LOCKED)
 * When the Stop-hook payload file is absent / empty / malformed / SSH-read-error:
 *   - Treat background_tasks[] as [] for that poll cycle.
 *   - Continue publishing SessionState (session-JSON status is authoritative).
 *   - Log ONE rate-limited WARN per host per hookPayloadWarnCooldownMs (default 60s).
 *   - Do NOT crash, do NOT stop polling, do NOT publish session_gone.
 *
 * ## Dependency injection
 * All SSH, all DB, all timers are injected. The module is unit-testable with
 * vi.useFakeTimers() + vi.fn() without any real SSH or database.
 */
import { systemLogger } from "../utils/logger.js";
import {
  parseSessionJson,
  parseStopHookPayload,
} from "./types.js";
import { isStaleFromStat } from "./liveness-check.js";
import { resolvePidToTmuxSession } from "./pid-to-tmux.js";
import { filterAmbientTasks } from "./ambient-filter.js";
import { detectIdReset } from "../claude-session/session-file-parser.js";
import {
  buildDiscoveryScript,
  shellSingleQuote,
  parseDiscoveryStdout,
  __matchesIdentityFirstTurnForTests,
  DISCOVERY_EXEC_TIMEOUT_MS,
} from "../claude-session/discover-identity-session-file.js";
import type { SubscriptionRegistry } from "./subscription-registry.js";
import type { SessionState } from "./wire-protocol.js";
import type { HostRecord } from "./host-id-resolver.js";
import { writeSessionFileCache } from "./session-file-cache.js";
// Phase 92 — v1 JSONL sweep wire contract (Plan 01). parseSweepJsonl is the
// lenient parser that never throws; SWEEP_SCHEMA_VERSION is compared per-line
// server-side, and any mismatch surfaces via parseSweepJsonl's schemaMismatch
// flag which drives the caller-side fallback branch in pollOneHostBatch below.
import {
  parseSweepJsonl,
  SWEEP_SCHEMA_VERSION,
  type SweepPidLine,
  type SweepIdentityLine,
} from "./sweep-schema.js";
// Phase 85 (D-07): per-tick `lastMessageAt` derivation reads Alice's newest
// send-time timestamp from the identity-name-keyed send-log store instead of
// scanning the JSONL tail. `scanTailForNewestMessageAt` stays defined + exported
// for byte-parallel consumers in `src/backend/database/routes/sessions.ts`
// (D-08); only the in-file `derivedLastMessageAt` derivation retires from it.
import { getIdentityLastSend } from "./identity-send-log-store.js";
import type { PendingBirth } from "../spawn-requests/types.js";
// Slim import — parse-request-body.ts is a dependency-free extraction that
// avoids pulling worker.ts's heavy transitive graph (birthIdentity, matrix
// admin, Skynet DB init, pool-loader) into the fleet-status test module
// surface. See parse-request-body.ts header for the full rationale.
import { parseRequestBody } from "../spawn-requests/parse-request-body.js";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/**
 * Thin SSH exec wrapper — one per identity-hosting host for the life of
 * the orchestrator. Returns null on any SSH-side error (never throws).
 *
 * The optional `stdinBody` param routes to a stdin-writing variant so
 * callers pushing payloads larger than Linux's MAX_ARG_STRLEN (128 KB
 * per argv element on x86_64) can stream the body via CHANNEL_DATA
 * rather than embedding it in the exec command string. See
 * writeInstalledBytesWithMode in ../distributor/ssh-push.ts for the
 * load-bearing consumer.
 */
export interface SshChannel {
  exec(command: string, stdinBody?: Buffer): Promise<string | null>;
}

export interface OrchestratorDeps {
  /** Async DB query — returns the list of identity-hosting host records */
  listIdentityHostingHosts(): Promise<HostRecord[]>;

  /** Open a dedicated SSH channel for a host; returns null on failure */
  acquireSshChannel(host: HostRecord): Promise<SshChannel | null>;

  /** Release a previously-acquired SSH channel */
  releaseSshChannel(host: HostRecord, channel: SshChannel): void;

  /** The subscription registry (Plan 02) — receives state deltas */
  registry: SubscriptionRegistry;

  /**
   * Timer factory (injectable for tests).
   * The fn may return a Promise — tests can capture fn from the mock and
   * await it directly to drive poll/sweep cycles synchronously.
   */
  setInterval(fn: () => Promise<void> | void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(h: ReturnType<typeof setInterval>): void;

  /** Clock (injectable for tests) */
  now(): number;

  /** Defaults below */
  pollIntervalMs?: number;
  staleSweepIntervalMs?: number;
  hookPayloadPath?: string;
  hookPayloadWarnCooldownMs?: number;

  /**
   * Phase 99: enqueue a claimed spawn-request for async birth-worker processing.
   * Optional — when absent, spawn-request scan results are discarded (backward-
   * compat for tests that don't exercise the spawn-request path). Wired in
   * starter.ts to the spawn-requests/queue.ts enqueue function.
   */
  enqueueSpawnRequest?: (item: PendingBirth) => void;
}

export interface SshPollOrchestrator {
  start(): Promise<void>;
  stop(): void;
  getPollTickCount(): number;
}

// ---------------------------------------------------------------------------
// readStatWithSentinel — transport-vs-dead distinguishing stat reader
// ---------------------------------------------------------------------------

/**
 * Tagged discriminated union returned by `readStatWithSentinel`. Distinguishes
 * three outcomes of a `/proc/<pid>/stat` read over the SSH channel:
 *
 *   - `{ok: true, content}`     — stat read succeeded, content is /proc/<pid>/stat.
 *   - `{ok: false, reason: 'enoent'}`    — real absence (PID dead).
 *   - `{ok: false, reason: 'transport'}` — SSH channel error / unknown shape.
 *
 * The whole point of this helper is bounty 9c8d4a72-1e5f-4b8a-9d3c-6f2b8e4a7c19:
 * SSH `Channel open failure` on the raw `cat /proc/<pid>/stat` exec was returning
 * `null` from the channel adapter, which `isStaleFromStat(_, null)` treats as
 * PID-dead. The reaper then published `session_gone` for actively-working sessions
 * whenever sshd MaxSessions saturated. See fix-wip-indicator-transport-vs-dead.md.
 */
export type StatReadResult =
  | { ok: true; content: string }
  | { ok: false; reason: 'enoent' | 'transport' };

/**
 * Read `/proc/<pid>/stat` via the SSH channel, distinguishing transport error
 * from real PID-dead ENOENT via an exit-code sentinel.
 *
 * Command shape: `cat /proc/${pid}/stat 2>&1 && echo __STAT_OK__ || echo __STAT_ENOENT__`
 *
 * The sentinel is what makes the null-return from the adapter unambiguous —
 * a genuine PID-dead read returns `<empty stdout>__STAT_ENOENT__` (adapter
 * captures string), whereas a transport failure returns `null` (adapter swallows
 * the SSH channel-open-failure).
 *
 * Dispatch rules (applied in order):
 *   1. `raw === null`                  → transport failure (adapter caught throw).
 *   2. Trimmed raw ends with `__STAT_OK__`     → strip sentinel + trailing whitespace → ok.
 *   3. Trimmed raw ends with `__STAT_ENOENT__` → real ENOENT (PID dead) → reap.
 *   4. Any other shape (empty, unknown sentinel, malformed) → transport (fail-OPEN).
 *
 * Fail-OPEN on unknown is deliberate per the fix agreement: an unrecognised shape
 * is more likely a truncated / mangled channel response than a real PID-dead
 * signal, so it must NOT cause a reap. The next tick will retry.
 *
 * Bounty: 9c8d4a72-1e5f-4b8a-9d3c-6f2b8e4a7c19
 */
export async function readStatWithSentinel(
  channel: SshChannel,
  pid: number,
): Promise<StatReadResult> {
  const cmd = `cat /proc/${pid}/stat 2>&1 && echo __STAT_OK__ || echo __STAT_ENOENT__`;
  const raw = await channel.exec(cmd);

  // Rule 1: adapter swallowed a throw (SSH channel-open-failure etc.)
  if (raw === null) {
    return { ok: false, reason: 'transport' };
  }

  const trimmed = raw.trimEnd();

  // Rule 2: OK sentinel present — strip it + any trailing whitespace, return content.
  if (trimmed.endsWith('__STAT_OK__')) {
    const content = trimmed.slice(0, -'__STAT_OK__'.length).trimEnd();
    return { ok: true, content };
  }

  // Rule 3: ENOENT sentinel present — real absence, PID dead.
  if (trimmed.endsWith('__STAT_ENOENT__')) {
    return { ok: false, reason: 'enoent' };
  }

  // Rule 4: unknown shape (empty, malformed, unrecognised sentinel) → fail-OPEN.
  return { ok: false, reason: 'transport' };
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Narrow extension of HostRecord that adds the runs_fleet_substrate opt-in
 * flag (Phase 72 Plan 02's Drizzle column). Exported so starter.ts's
 * listIdentityHostingHosts + starter.test.ts's compile-time shape check can
 * reference it directly. The projection helper `projectRunsFleetSubstrate`
 * (starter.ts) normalizes the Drizzle column value into the strict boolean
 * field this type declares, so consumers see fail-closed behavior on any
 * legacy NULL / undefined / non-1 row.
 *
 * `_connDetails` is the decrypted SSH host record packaged by
 * listIdentityHostingHosts for the acquireSshChannel path; it is opaque
 * to ssh-poll-orchestrator itself but part of the wire-through shape
 * between starter.ts and the OrchestratorDeps consumer.
 */
export interface IdentityHostingHostRecord extends HostRecord {
  runsFleetSubstrate: boolean;
  _connDetails: Record<string, unknown>;
}

interface PidCacheEntry {
  sessionId: string;
  tmuxSession: string | null;
  procStart: string;
  lastPublishedFingerprint: string;
  // Phase 41 Plan 03 — cached derived value of the "newest message-bearing
  // JSONL frame ts, either direction" recency signal. `null` when the JSONL
  // has zero message-bearing frames (session with no history). Sticky across
  // poll ticks: a poll that reads a tail that does NOT include a newer
  // message-bearing frame leaves the prior cached value alone; only a NEWER
  // frame overwrites it. This is what makes the signal edge-triggered on
  // messages (not on lifecycle events / tool_use / thinking blocks).
  lastMessageAt: number | null;
  // Phase 47 — cached derived latest ai-title from the same JSONL tail-read
  // that feeds lastMessageAt. Passenger on the same jsonlPath — no
  // independent stale-tick counter (aiTitle inherits invalidation via the
  // shared cached jsonlPath). Last-wins semantics: a fresher tail-scan
  // whose scanTailForLatestAiTitle returns a non-null string overwrites the
  // cached value; a scan returning null preserves the cache (fail-open on
  // transient SSH hiccups matches lastMessageAt's behavior). Publishes iff
  // computeFingerprint sees a change (aiTitle is a distinct fingerprint
  // axis so an ai-title-only drift still fires publishSessionState).
  aiTitle: string | null;
  // Phase 44 Plan 02 — cached JSONL path resolved via
  // discoverIdentityJsonlPathViaChannel (identity /id-first-turn discovery).
  // Populated on the first tick where tmuxSession resolves; reused across
  // every subsequent tick so discovery only fires ONCE per PID lifetime in
  // the happy path. Set back to null to trigger re-discovery on the next
  // tick (see staleTailTickCount below — the only path that invalidates
  // the cached path defensively). See 44-CONTEXT.md § ssh-poll-orchestrator.ts
  // swap for the timing + rationale.
  jsonlPath: string | null;
  // Phase 44 Plan 02 — count of consecutive ticks where the cached
  // `jsonlPath`'s tail-scan (Phase 47 Plan 02: `tail -c 262144`) failed to
  // advance a NON-NULL cached `lastMessageAt`. Reset to 0 on any tick that
  // advances lastMessageAt.
  // On reaching STALE_TAIL_REDISCOVERY_THRESHOLD, invalidate `jsonlPath`
  // so the next tick re-fires discovery — defense against Claude Code
  // JSONL rotation mid-session (a resume/compaction event can rotate the
  // active file, leaving the cached path pointing at a stale JSONL).
  //
  // IMPORTANT (tightened condition, revised from a prior draft):
  // sessions with a NULL cached `lastMessageAt` (genuinely no message-
  // bearing history yet) do NOT tick this counter — it stays at 0. The
  // threshold is a ROTATION-DEFENSE for sessions that once had a signal
  // and lost it, NOT a "kick discovery when we haven't seen a message
  // yet" mechanism. Incrementing here would create permanent-cycle
  // re-discovery churn for identities that legitimately have no message
  // history (fresh session pre-first-turn; identity that never invokes
  // /id; identity whose entire history is tool_use / thinking / lifecycle
  // events). See 44-CONTEXT.md § ssh-poll-orchestrator.ts swap.
  staleTailTickCount: number;
  // Phase 52 Plan 01 Task 2 — cached derived boolean result of the source A
  // dormant sentinel stat (`stat ~/fleet/identities/'<tmuxSession>'/.dormant
  // 2>/dev/null >/dev/null && echo yes || echo no`). Trimmed stdout "yes" →
  // true; "no" → false; anything else (null, throw, unexpected output) →
  // fail-open using this cached value (defaults to `false` on cold-start).
  // The dormant axis participates in computeFingerprint so a dormant-only
  // flip publishes a new frame (delta detection is per-axis). Fail-open
  // preservation matches lastMessageAt / aiTitle patterns — transient SSH
  // hiccups do NOT flip a valid dormant reading.
  dormant: boolean;
  // quick-260823-73o — the source-A recycling cache fields (`recycling`,
  // `layer1RecyclingCached`, `recycleRequestedCached`) are REMOVED here.
  // All three recycle axes now live in source B's `identityRecycleState`
  // per-identity cache map (see PerHostState below + pollDormantOnlyIdentities
  // per-identity iteration). Source A stamps `recycling: false` unconditionally
  // and no longer computes any of the three axes. See quick-260823-73o
  // objective for the full RCA (source A's per-PID lifecycle-gap window
  // during /id reset).
  // -------------------------------------------------------------------------
  // Phase 59 Plan 02 (WIP shell-idle gate — 2026-08-26): three new cache axes
  // for the WIP indicator's stop-gate derivation. Both new axes participate
  // in computeFingerprint so a value change on either publishes a new frame
  // even when status + backgroundTasks + lastMessageAt + aiTitle + dormant +
  // recycling are all unchanged.
  // -------------------------------------------------------------------------
  // Cached previous-tick `sessionJson.status` value, used exclusively to
  // derive `lastStatusChangeAt` via poll-to-poll status-value delta
  // comparison. `null` on cold-start (first tick sees a PID with no prior
  // comparison basis → seed lastStatusChangeAt to deps.now()). This is the
  // ONLY source-of-truth for the delta comparison; sessionJson.updatedAt is
  // NEVER read as the source (Pitfall 4: the harness bumps updatedAt on
  // compose-box typing without a real state transition).
  lastStatus: "busy" | "shell" | "idle" | "waiting" | null;
  // Unix millis of the poll tick where sessionJson.status most recently
  // transitioned to a different value. Seeded to `deps.now()` on first
  // appearance (isNew); updated to `deps.now()` when this-tick status
  // differs from cached lastStatus; preserved otherwise (same-status tick
  // does NOT bump). Frontend consumes together with lastStopAt in the
  // `main = busy || (shell && stopIsFresh)` predicate on session-working-store.
  lastStatusChangeAt: number;
  // Unix millis derived from `stat -c %Y ~/.claude/fleet-status/stop-<sessionId>.json * 1000`
  // (GNU stat seconds since epoch, converted to millis for wire consistency
  // with every other timestamp axis). `null` when the file does not exist
  // (session has never had a turn end since the Phase 59 Plan 01 stop hook
  // was installed). Cache-preserved on SSH hiccup (transient null returns
  // preserve prior value — fail-open matching lastMessageAt / aiTitle /
  // dormant patterns).
  lastStopAt: number | null;
  // -------------------------------------------------------------------------
  // Phase 62 Plan 03 (WIP hook-based rewrite — 2026-08-30): two new cache axes
  // for the direct-signal WIP predicate. Both participate in computeFingerprint
  // so a mtime-only change on either publishes a new frame even when every
  // other axis is unchanged.
  //
  // Sources: the two per-session marker files touched by the Plan 62-01 hook
  // scripts, installed onto managed boxes by Plan 62-02:
  //   - activityMtime: mtime × 1000 of
  //     `~/.claude/fleet-status/hooks/<sessionId>/activity` (touched on
  //     UserPromptSubmit + PreToolUse).
  //   - stoppedMtime:  mtime × 1000 of
  //     `~/.claude/fleet-status/hooks/<sessionId>/stopped`  (touched on
  //     Stop + StopFailure + PermissionRequest).
  //
  // Semantics (both fields): `null` on cold-start, missing file (empty
  // stdout), or SSH hiccup (null exec return). Cache-preserved on all three
  // — fail-open in the safe direction matches lastMessageAt / aiTitle /
  // dormant / lastStopAt patterns. Numeric value (unix millis) only when
  // the stat returned a non-null non-empty numeric-parseable stdout.
  //
  // Rollout note (CONTEXT.md § Rollout Option 1 — LOCKED for Phase 62):
  // These two axes ride alongside — NOT instead of — the Phase 59 lastStopAt
  // + lastStatusChangeAt axes for the duration of the rollout window. The
  // frontend (Plan 62-04) chooses which predicate applies per-session based
  // on marker presence:
  //   - activityMtime !== null || stoppedMtime !== null → new predicate
  //     (`activityMtime > stoppedMtime` → working).
  //   - both null → fall through to the retained Phase 59 shell-idle-gate
  //     predicate (box not yet upgraded to Plan 62-02 installer).
  // A follow-up phase retires the Phase 59 axes cleanly post-full-rollout.
  //
  // SessionId-rotation reset: on rotation (isNew-equivalent), both new axes
  // reset to null (the new sessionId's marker files may not exist yet).
  // Matches the Phase 59 lastStopAt rotation-reset at line ~1193 in processPid.
  // -------------------------------------------------------------------------
  activityMtime: number | null;
  stoppedMtime: number | null;
}

// quick-260823-73o — source B per-identity cache entry. Replaces the prior
// Phase 52 Task 3 Map<name, {dormant, recycling}> shape (which was widened
// in Phase 53 CR C2/C3) with a fuller record now that source B owns the
// full three-axis recycle pipeline (was source A's).
//
// Field semantics:
//   dormant                   — `.dormant` sentinel stat; participates in fingerprint.
//   recycling                 — OR-composed axis: layer1 || requested || sentinel;
//                                participates in fingerprint.
//   layer1RecyclingCached     — last non-null Layer 1 tail-scan result (bool);
//                                cache-preserved on SSH hiccup (null return).
//   jsonlPath                 — cached discovery result (path or null); nulled
//                                to force re-discovery on stale-tail threshold.
//   staleTailTickCount        — count of consecutive ticks where the tail-scan
//                                returned null while the cached Layer 1 was true;
//                                threshold trip nulls jsonlPath for re-discovery.
//   lastPublishedFingerprint  — the (dormant|recycling) tuple last published for
//                                this identity; fingerprint-suppression compares
//                                against this on every tick.
interface IdentityRecycleCacheEntry {
  dormant: boolean;
  recycling: boolean;
  layer1RecyclingCached: boolean;
  jsonlPath: string | null;
  staleTailTickCount: number;
  lastPublishedFingerprint: string;
}

interface PerHostState {
  host: HostRecord;
  channel: SshChannel;
  livenessMap: Map<number, PidCacheEntry>;
  lastHookWarnAt: number;
  // quick-260823-73o — source B per-identity cache. Replaces the prior
  // `dormantOnlyIdentities: Map<string, {dormant, recycling}>` (Phase 52 T3
  // widened by Phase 53 CR C2/C3). Now that source B owns the full three-axis
  // recycle pipeline (migrated out of source A's per-PID loop to close the
  // /id-reset lifecycle-gap window), the cache carries the internal
  // discovery/scan state alongside the two published axes. See
  // IdentityRecycleCacheEntry docblock above for field-level semantics and
  // pollDormantOnlyIdentities for the per-tick update contract.
  identityRecycleState: Map<string, IdentityRecycleCacheEntry>;
  // -------------------------------------------------------------------------
  // Phase 92: sweep-first / legacy-fallback dispatch state.
  //
  // The fleet-status poller dispatches one of two pipelines per tick per host:
  //   (batch)  — one `~/.local/bin/fleet-status-sweep` exec per host, parse
  //              JSONL, drive the same compose+publish machinery as legacy.
  //   (legacy) — the original ~9-11 exec/PID + ~5 exec/identity fan-out.
  //
  // Dispatch decision uses the `sweepScriptPresent` cache below. The probe
  // (`test -x ~/.local/bin/fleet-status-sweep`) fires ONCE per host per
  // SSH-channel lifetime — not per tick — so a slow-flip on the managed box
  // (distributor installs the script, or human deletes it) is detected on
  // the next SSH reconnect, not every 2s.
  //
  // Cache invalidation is signaled by `lastProbeChannelRef !== channel`
  // (object-identity check against the current SshChannel). On acquireSsh-
  // Channel reconnect, starter.ts hands us a fresh SshChannel wrapper, so
  // the object identity differs and the probe re-fires. Cheaper than
  // plumbing a callback through starter.ts's channel-teardown handlers.
  //
  // Transient recovery: on `sweep-exec null` in the batch path (SSH hiccup
  // that swallowed the script's stdout), pollOneHost sets sweepScriptPresent
  // back to null so the next tick re-probes. Permanent absence sets it to
  // `false` (probe returned "no" or null), which blocks the batch path
  // until the next channel reconnect.
  //
  // Schema drift: `sweepSchemaMismatchThisConnection` latches true on the
  // first parse whose `schema_version !== SWEEP_SCHEMA_VERSION` and stays
  // true for the rest of this SSH-channel lifetime. Blocks the batch path
  // (falls straight to legacy) without re-invoking the sweep-exec every
  // tick — a schema-version bump is a container-restart-scope event.
  // -------------------------------------------------------------------------
  sweepScriptPresent: boolean | null;
  sweepSchemaMismatchThisConnection: boolean;
  lastProbeChannelRef: SshChannel | null;
}

// ---------------------------------------------------------------------------
// Phase 92 — fetch/compose seam types
//
// processPid and the per-identity iteration of pollDormantOnlyIdentities are
// split into two coordinated pieces: (a) a FETCH step that runs the exec fan-
// out (legacy path) OR reads pre-fetched values from a SweepPidLine /
// SweepIdentityLine (batch path), and (b) a COMPOSE + PUBLISH step that runs
// the fingerprint, publish contract, cache write, and writeSessionFileCache
// (RESEARCH G8) — SHARED by both paths so parity is guaranteed by construction.
//
// The two fetched-state structs mirror the intermediate values today's
// processPid + pollDormantOnlyIdentities produce from their exec results. In
// the legacy path fetchPerPidState / fetchPerIdentityState issue the same
// per-PID / per-identity exec fan-out and populate these structs. In the batch
// path the SweepPidLine / SweepIdentityLine fields map DIRECTLY onto these
// struct fields (schema decision documented in sweep-schema.ts's
// SWEEP_FIELD_PARITY table).
//
// PARITY NON-NEGOTIABLE: the compose helpers accept only these struct shapes,
// so a SessionState frame published from the batch path is byte-identical to
// one published from the legacy path for every field the sweep emits. The one
// documented divergence — SWEEP_FIELD_PARITY.A3 (box-wide last-stop-payload
// fallback) is NOT emitted by the sweep, so the batch path passes
// hookPayloadRaw=null and background_tasks falls back to [] when
// per_session_stop_payload is also null. Legacy path preserves the A3
// fallback. This is a deliberate scope decision made in Plan 01.
// ---------------------------------------------------------------------------

/**
 * Snapshot of every value processPid fetches over SSH before entering the
 * compose+publish phase. Fields carry the RESEARCH.md exec-site letter (A1..
 * A12) they parity with — batch-path callers fill these directly from a
 * SweepPidLine; legacy-path fetchPerPidState fills them by running the
 * existing exec fan-out.
 *
 * The mtime fields (A6/A7/A8) carry the RAW server-side reading — either a
 * number × 1000 for a valid stat, or null for absent/SSH-hiccup/non-numeric.
 * The COMPOSE step applies the "fail-open preserve cached value" reconciliation
 * against PidCacheEntry (that logic depends on cache reads which are compose-
 * side responsibility — mirrors L1482-1503, L1388-1403, L1408-1423 of the
 * pre-refactor processPid).
 */
interface PerPidFetchedState {
  /** A1 — `cat ~/.claude/sessions/<pid>.json` raw contents; null = mid-write */
  sessionJsonRaw: string | null;
  /** A2 — `/proc/<pid>/stat` read with sentinel (bounty 9c8d4a72) */
  statResult: StatReadResult;
  /**
   * A3 — box-wide `~/.claude/fleet-status/last-stop-payload.json`. Legacy path
   * always fetches; BATCH PATH PASSES `null` (SWEEP_FIELD_PARITY.A3 skip:
   * sweep does NOT emit A3, per-session A9 supersedes; on both-null the
   * caller falls back to emitHookPayloadWarn + background_tasks=[]).
   */
  hookPayloadRaw: string | null;
  /** A4+A5 resolved — PID → tmux pane → tmux session name (identity name) */
  tmuxSession: string | null;
  /**
   * A6 — RAW per-session stop-<sid>.json mtime × 1000 for this tick's read.
   * null = SSH hiccup / file absent / non-numeric / sessionId failed the
   * safe-char regex guard. Compose applies fail-open cache preservation.
   */
  freshLastStopAt: number | null;
  /** A7 — RAW Phase 62 activity marker mtime × 1000 for this tick's read */
  freshActivityMtime: number | null;
  /** A8 — RAW Phase 62 stopped marker mtime × 1000 for this tick's read */
  freshStoppedMtime: number | null;
  /** A9 — per-session `stop-<sid>.json` payload; null when absent/SSH-hiccup */
  perSessionHookPayloadRaw: string | null;
  /**
   * A10 — RAW `.dormant` sentinel read via source-A path.
   * Discriminates on the stdout: "yes" → true, "no" → false, anything else
   * (including null from SSH hiccup) → null (compose falls back to cache).
   */
  freshDormant: boolean | null;
  /**
   * A11 — Phase 32 discovery result. Legacy path caches per PID lifetime;
   * batch path takes the SweepIdentityLine.jsonl_path for the joined
   * identity (schema fold — no separate per-PID discovery on the wire).
   */
  jsonlPath: string | null;
  /**
   * A12 — up to 256KB tail of the identity's active JSONL for the ai-title
   * scan. Null when jsonlPath is unknown/unreadable; caller runs
   * scanTailForLatestAiTitle unchanged.
   */
  jsonlTail: string | null;
}

/**
 * Snapshot of every value the per-identity iteration of
 * pollDormantOnlyIdentities fetches over SSH before the compose+publish
 * phase. Fields carry RESEARCH.md exec-site letters (B1..B5).
 */
interface PerIdentityFetchedState {
  name: string;
  /** B1 — `.dormant` sentinel */
  isDormant: boolean;
  /** B2 — `.recycled-at` sentinel */
  isRecycledAt: boolean;
  /** B3 — `.recycle-requested` sentinel */
  isRecycleRequested: boolean;
  /**
   * Resolved layer1 recycling value AFTER fail-open preservation against
   * the cached value (mirrors the L1060-1090 legacy scan-then-reconcile
   * logic). This is NOT raw B5 — it's the final value the compose helper
   * plugs into the OR-composition.
   */
  layer1RecyclingCached: boolean;
  /** B4 — Phase 32 discovery result (post-stale-check in the legacy path) */
  jsonlPath: string | null;
  /**
   * Next-tick stale-tail counter value. Legacy path increments/resets per
   * the L1060-1089 rotation-defense rules; batch path resets to 0 (Plan 02's
   * script does its own per-tick discovery, so cache-based staleness does
   * not apply). Consumed by compose for the cache write.
   */
  nextStaleTailTickCount: number;
}

// ---------------------------------------------------------------------------
// Phase 41 Plan 03 — JSONL path + message-bearing predicate
// ---------------------------------------------------------------------------

/**
 * Alice 2026-08-23 lock: "only my real messages going to them" —
 * INVERTS the 2026-08-14 lock. Assistant activity, incoming/outgoing
 * DMs, scheduled wakes, task notifications, skill-body injections all
 * excluded. See quick-260823-bap plan for the full predicate matrix.
 *
 * Predicate: a JSONL line counts iff top-level type==="user" AND
 * message.content is a plain string AND (starts with "<command-" OR
 * NOT (starts with "<" AND ends with ">") on trimmed content) AND
 * NOT a Ctrl-C kill signal (control-chars-only content) AND
 * NOT an agent-supervisor /exit slash-command AND
 * NOT an agent-supervisor resumed-injection sentinel.
 *
 * Independent JSON.parse (mirrors scanTailForLatestAiTitle pattern) —
 * do NOT extend parseSessionLine to expose raw content. Parallel-copy
 * discipline preserved per 43-CONTEXT.md scope decision (canonical
 * copy in sessions.ts must stay byte-parallel).
 *
 * Alice 2026-08-29 refinement: three additional harness-injected shapes
 * confirmed on Tabitha's session file now explicitly rejected:
 * - Ctrl-C kill signal: supervisor delivers "\x03\x03" as plain-string
 *   content; after trimming, stripping all ASCII control chars yields "".
 * - /exit slash-command: agent-supervisor fires `/exit` before recycle;
 *   content contains "<command-name>/exit</command-name>".
 * - Resumed-injection sentinel: supervisor injects "Your session was just
 *   resumed by the agent-supervisor…" as a type:"user" turn in some paths.
 *
 * Phase 85 (D-08): stays alive as a shared helper. Not called from this
 * file's own lastMessageAt path anymore (retired — the derivation now reads
 * from the identity-name-keyed send-log store via getIdentityLastSend), but
 * the src/backend/database/routes/sessions.ts byte-parallel copy of
 * scanTailForNewestMessageAt still depends on this predicate's contract, and
 * scanTailForLayer1RecyclingSignal below still calls this to pre-filter real
 * user turns from harness-synthetic noise.
 */
function isRealUserTurn(rawLine: string): { ok: true; ts: number } | { ok: false } {
  const trimmed = rawLine.trim();
  if (trimmed === "") return { ok: false };
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { ok: false };
  }
  if (obj === null || typeof obj !== "object") return { ok: false };
  const top = obj as Record<string, unknown>;
  // Step 2: top-level type must be "user" (excludes assistant, relay_outbound, etc.)
  if (top.type !== "user") return { ok: false };
  // Step 3: message.content must be a plain string (excludes list-content user turns:
  // tool_result arrays, skill-body [{type:"text",text:…}] injections, etc.)
  const msg = top.message;
  if (msg === null || typeof msg !== "object") return { ok: false };
  const content = (msg as Record<string, unknown>).content;
  if (typeof content !== "string") return { ok: false };
  // Step 4: apply the XML-wrapper exclusion.
  const t = content.trim();
  const isXmlWrapper = t.startsWith("<") && t.endsWith(">");
  const isCommand = t.startsWith("<command-");
  if (!isCommand && isXmlWrapper) return { ok: false };
  // Step 5 (2026-08-29 refinement): drop /exit slash-command injected by agent-supervisor
  // before recycle. Alice's own slash-commands (/id, /build, /gsd:*) are unaffected.
  if (content.includes("<command-name>/exit</command-name>")) return { ok: false };
  // Step 6 (2026-08-29 refinement): drop control-chars-only content (e.g. Ctrl-C kill
  // signal "\x03\x03"). t is already trimmed of regular whitespace; stripping ASCII
  // control chars from t and getting "" means the payload was pure control-char noise.
  if (t.replace(/[\x00-\x1F]/g, "") === "") return { ok: false };
  // Step 7 (2026-08-29 refinement): drop agent-supervisor resumed-injection sentinel.
  // Prefix-anchored to avoid matching quoted mentions in real Alice prose.
  if (content.startsWith("Your session was just resumed by the agent-supervisor")) return { ok: false };
  // Passed all gates — extract ts from the timestamp field.
  const rawTs = top.timestamp;
  if (typeof rawTs !== "string") return { ok: false };
  const ts = Date.parse(rawTs);
  if (!Number.isFinite(ts)) return { ok: false };
  return { ok: true, ts };
}

/**
 * Phase 44 Plan 02 — N consecutive ticks with a stale tail (against a
 * NON-NULL cached lastMessageAt) before re-running discovery. At the
 * default 2s poll cadence, this is ~10s of "cached path returned no
 * fresher message-bearing frame" before we invalidate the cached
 * discovery path and re-scan `~/.claude/projects/*​/`.
 *
 * This is a defense against Claude Code JSONL rotation mid-session (a
 * resume/compaction event can rotate the active file, leaving the cached
 * path pointing at a stale JSONL that has stopped growing). See
 * 44-CONTEXT.md § ssh-poll-orchestrator.ts swap.
 *
 * Sessions with NO cached lastMessageAt do NOT tick this counter — the
 * threshold is a rotation-defense, not a no-history-kick. See the
 * PidCacheEntry.staleTailTickCount docblock above for the full rationale.
 */
const STALE_TAIL_REDISCOVERY_THRESHOLD = 5;

// Phase 44 Plan 02 — the former jsonlPathForSession helper (cwd + sessionId
// → constructed path) has been removed. It built the JSONL path via
// `~/.claude/projects/<slug>/<sessionId>.jsonl` from sessionJson fields;
// that derivation was fragile against cwd drift and
// Claude Code sessionId rotation on compaction/resume (a live session
// could silently point at a stale JSONL that had stopped growing). The
// orchestrator now derives the JSONL path via
// `discoverIdentityJsonlPathViaChannel` (Phase 32 byte-pattern
// mechanism) — mtime-newest JSONL under `~/.claude/projects/*​/` whose
// first user-role line matches `/id <identityName>`. Stable across
// compaction + resume. See 44-CONTEXT.md § ssh-poll-orchestrator.ts swap.

/**
 * Parse a JSONL blob (the raw stdout of a `tail -c 262144 <jsonl-path>` exec)
 * and return the newest user-real-user-turn `ts` (unix millis) found across
 * all lines, or null if no line qualified. Empty lines and malformed lines are
 * skipped silently — this is a best-effort sample, not a validation pass.
 *
 * This runs on EVERY poll tick per PID; the cost is bounded by the tail
 * width (Phase 47 Plan 02: `tail -c 262144` — 256KB; per Phase 47 CONTEXT.md
 * § Backend scraper mechanics — bounded parse well under 5ms on typical
 * hardware).
 *
 * Predicate: isRealUserTurn (Alice 2026-08-23 lock). Each line is
 * independently JSON.parsed by the predicate helper — parseSessionLine is
 * NOT used for the recency filter (it is no longer the gating function;
 * it is still called for other purposes elsewhere if needed). The predicate
 * returns {ok, ts} so a single JSON.parse feeds both the gate and the ts
 * extraction, avoiding a second parse on the keep path.
 *
 * Phase 85 (D-08): retired from the in-file lastMessageAt derivation but
 * STAYS DEFINED — src/backend/database/routes/sessions.ts maintains a
 * byte-parallel copy and hand-mirrors this scanner for the /sessions/list
 * dormant-side derivation. If either copy changes, update BOTH. The
 * in-orchestrator lastMessageAt axis now reads from the identity-name-keyed
 * send-log store (Phase 85-02 identity-send-log-store) via
 * getIdentityLastSend, so the function is no longer called from
 * processPid's per-tick per-session block.
 */
// Phase 85 (D-08 export): test-only export of the retired scanner so the
// predicate-matrix suite in ssh-poll-orchestrator.test.ts can continue to
// probe isRealUserTurn's contract at the byte level. The function is
// no longer called from processPid but is still THE canonical predicate
// implementation that sessions.ts byte-parallel-copies; keeping tests on
// this observable preserves regression coverage of the predicate.
export function __scanTailForNewestMessageAtForTests(
  tailContents: string,
): number | null {
  return scanTailForNewestMessageAt(tailContents);
}

function scanTailForNewestMessageAt(tailContents: string): number | null {
  let newest: number | null = null;
  const lines = tailContents.split("\n");
  for (const line of lines) {
    if (line.trim() === "") continue;
    const result = isRealUserTurn(line);
    if (!result.ok) continue;
    const { ts } = result;
    if (newest === null || ts > newest) {
      newest = ts;
    }
  }
  return newest;
}

// ---------------------------------------------------------------------------
// Phase 47 Plan 02 — ai-title scanner
// ---------------------------------------------------------------------------

/**
 * Substring pre-filter for the harness-emitted `{"type":"ai-title","aiTitle":
 * "…","sessionId":"…"}` line (see Phase 47 CONTEXT.md § Backend scraper
 * mechanics + § Harness ai-title source). Used to avoid JSON.parse-ing every
 * message-bearing line just to check for ai-title lines.
 */
const AI_TITLE_LINE_PREFIX = '"type":"ai-title"';

/**
 * Scan the raw stdout of a `tail -c N <jsonl-path>` for the LAST ai-title
 * line's aiTitle string (last-wins per CONTEXT.md § working-store third axis
 * — topic drifts across a session, so the freshest line reflects the current
 * topic). Returns null if zero valid ai-title lines are found (empty tail,
 * missing field, malformed JSON, wrong-type value).
 *
 * Hand-mirrored from `sessions.ts scanTailForLatestAiTitle` per Phase 44
 * Plan 01 precedent — the two backend read paths keep local copies rather
 * than share a module (44-CONTEXT.md § "no new shared module" scope decision
 * inherited from Phase 43; 47-CONTEXT.md § domain inherits from Phase 43
 * scope decision). If either copy ever needs to change, update BOTH sites.
 *
 * In-process JSON.parse (not `jq` shell subprocess) matches the existing
 * `parseSessionLine` pattern the Phase 44 Plan 01 scanner uses — cheaper
 * (no exec) and consistent with the surrounding scanTailForNewestMessageAt.
 */
function scanTailForLatestAiTitle(tailContents: string): string | null {
  let latest: string | null = null;
  const lines = tailContents.split("\n");
  for (const line of lines) {
    // Cheap substring pre-filter — avoid JSON.parse on non-ai-title lines.
    if (!line.includes(AI_TITLE_LINE_PREFIX)) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        typeof (parsed as { aiTitle?: unknown }).aiTitle === "string"
      ) {
        latest = (parsed as { aiTitle: string }).aiTitle;
      }
    } catch {
      // Malformed line — skip silently (best-effort sampling).
      continue;
    }
  }
  return latest;
}

// ---------------------------------------------------------------------------
// quick-260822-0vw — Layer 1 /id reset scanner
// ---------------------------------------------------------------------------

/**
 * Scan a JSONL tail buffer and return the Layer 1 recycling signal for the
 * most-recent real user turn in the buffer.
 *
 * Returns:
 *   true  — the last parseable user turn (per detectIdReset semantics) was
 *            an /id reset turn
 *   false — the last parseable user turn was NOT an /id reset turn
 *   null  — the tail contained ZERO parseable user turns (no signal at all;
 *            the caller should preserve its cached value — same fail-open
 *            semantics as scanTailForNewestMessageAt returns null on no
 *            message-bearing lines)
 *
 * Implementation mirrors layer1-detect.applyLineToLayer1State's "last user
 * turn wins" reducer semantics: iterate lines in order, for each try to
 * JSON.parse (skip malformed silently — matches the module's existing
 * tolerance), skip non-user types, then call detectIdReset and remember the
 * result on each user-turn hit. The last-remembered value is returned (or null
 * if no user turn was found). ONE buffer, called as a THIRD scan on the same
 * `tailRaw` already read by scanTailForNewestMessageAt + scanTailForLatestAiTitle
 * — no new SSH round-trip.
 */
function scanTailForLayer1RecyclingSignal(tailContents: string): boolean | null {
  let lastResult: boolean | null = null;
  const lines = tailContents.split("\n");
  for (const line of lines) {
    if (line.trim() === "") continue;
    // inline-260830-layer1-skip-harness-synthetic-user-turns (Alice
    // 2026-08-30, taylor): pre-filter with isRealUserTurn so
    // harness-synthetic user turns do NOT flip lastResult back to false
    // after a real /id reset has been seen. Historical behavior: this
    // loop iterated ALL type:"user" lines and set lastResult =
    // detectIdReset(parsed) unconditionally. detectIdReset returns FALSE
    // (not null) for:
    //   - array-content user turns (tool_result — the /id skill's own
    //     bash/read tool_use → tool_result exchanges fill the JSONL
    //     during the ~30s recycle window; each one flipped lastResult
    //     false, drowning the /id reset signal),
    //   - the /exit user turn agent-supervisor injects right before
    //     recycle (content is a string but doesn't contain
    //     `<command-name>/id</command-name>`),
    //   - control-char kill signals + resumed-injection sentinels,
    //   - non-command XML-wrapped strings.
    // Alice report 2026-08-30 (chad 20:09:07):
    // [fleet_status_recycling_armed] showed layer1:false, requested:true
    // — the sentinel drop was the ONLY arm axis; Layer 1 never fired
    // during the 30s window while the /id skill was running. This filter
    // restores the intended semantic ("last REAL user turn wins" —
    // matches the lastMessageAt scan at scanTailForNewestMessageAt which
    // has always used isRealUserTurn). detectIdReset stays the
    // final classifier; the isRealUserTurn gate just makes sure
    // only real user speech reaches it.
    if (!isRealUserTurn(line).ok) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Malformed line — skip silently (matches existing parser tolerance).
      // Also isRealUserTurn's own JSON.parse would have returned
      // { ok: false } and we'd have already continued above; this catch is
      // structural belt-and-suspenders (a race where the same line parses
      // differently between the two calls is not possible).
      continue;
    }
    // The type check inside detectIdReset (parsed.type === "user") is
    // now redundant with isRealUserTurn's own type gate, but
    // detectIdReset is called by other consumers too (Plan 30-01
    // observation channel in claude-session-server.ts) so keeping its
    // internal check preserves defense-in-depth.
    lastResult = detectIdReset(parsed);
  }
  return lastResult;
}

// ---------------------------------------------------------------------------
// Phase 44 Plan 02 — SshChannel-adapter for discoverIdentitySessionFile
// ---------------------------------------------------------------------------

/**
 * Adapter that runs the Phase 32 identity-first-turn discovery script against
 * the orchestrator's `SshChannel.exec` abstraction. The primary Phase 32
 * function `discoverIdentitySessionFile(conn, identityName)` in
 * `../claude-session/discover-identity-session-file.ts` consumes an ssh2
 * `Client` via `execCommand(conn, script)`; the orchestrator only holds an
 * injected `SshChannel` (returns null on SSH error rather than throwing), so
 * we build a thin sibling here that reuses the SAME shell script
 * (`buildDiscoveryScript` + `shellSingleQuote`), the SAME stdout parser
 * (`parseDiscoveryStdout`), and the SAME first-turn predicate
 * (`__matchesIdentityFirstTurnForTests`) — no logic duplication of the
 * byte-pattern classifier, only a call-shape wrapper.
 *
 * Fail-safe contract (matches Phase 32 invariant 1 / D-05):
 *   - `channel.exec` returns null (SSH error) → return null.
 *   - `Promise.race` timeout exceeds DISCOVERY_EXEC_TIMEOUT_MS → return null.
 *   - `parseDiscoveryStdout` yields zero records → return null.
 *   - No record's first-user-line matches `<command-name>/id</command-name>
 *     <command-args><identityName><delim>` → return null.
 *
 * Zero log lines emitted from here (matches Phase 32 invariant 5 / T-32-02);
 * the CALLER (orchestrator processPid) owns structured logging on the
 * null-return path.
 *
 * See 44-CONTEXT.md § ssh-poll-orchestrator.ts swap for the caching + stale-
 * threshold contract that consumes this helper.
 */
async function discoverIdentityJsonlPathViaChannel(
  channel: SshChannel,
  identityName: string,
): Promise<string | null> {
  const script = buildDiscoveryScript(shellSingleQuote(identityName));
  let stdout: string | null;
  try {
    stdout = await Promise.race([
      channel.exec(script),
      new Promise<string | null>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `discoverIdentityJsonlPathViaChannel timeout after ${DISCOVERY_EXEC_TIMEOUT_MS}ms`,
              ),
            ),
          DISCOVERY_EXEC_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch {
    return null;
  }
  if (stdout === null || stdout.length === 0) return null;
  const records = parseDiscoveryStdout(stdout);
  // Records already mtime-desc from the shell's `sort -rn`; belt-and-suspenders
  // resort in case shell locale ever deviates from strict numeric-descending.
  records.sort((a, b) => b.mtime - a.mtime);
  for (const rec of records) {
    if (__matchesIdentityFirstTurnForTests(rec.firstUserLine, identityName)) {
      return rec.path;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fingerprint helper
// ---------------------------------------------------------------------------

function computeFingerprint(state: SessionState): string {
  const bgKey = state.backgroundTasks
    .map((t) => `${t.id}:${t.status}`)
    .join(",");
  // Phase 41 Plan 03: lastMessageAt is a distinct axis of the fingerprint —
  // a new message either direction (JSONL ts advances) is a state-change
  // publish trigger even when status + backgroundTasks are unchanged.
  // Null is normalized to "" so a first-time null publish still emits a
  // distinct fingerprint distinct from an unpopulated cache entry.
  // Phase 47 Plan 02: aiTitle is a distinct axis of the fingerprint — an
  // ai-title change (topic drift) is a state-change publish trigger even
  // when status + backgroundTasks + lastMessageAt are unchanged. Same
  // null-normalization pattern as lastMessageAt so a first-time null
  // publish is distinguishable from an unpopulated cache entry.
  // Phase 52 Plan 01: dormant is a distinct axis of the fingerprint — a
  // dormant-only flip publishes a new frame even when status +
  // backgroundTasks + lastMessageAt + aiTitle are unchanged. Boolean-with-
  // undefined collapses to "1"/"0"/"" so a first-time undefined publish is
  // distinguishable from cold cache. In practice source A always stamps a
  // strict boolean; the ?? branch handles the "field omitted" path from
  // source B's future explicit-null frames.
  // Phase 53 Plan 01: recycling is a distinct axis of the fingerprint — a
  // recycling-only flip publishes a new frame even when status +
  // backgroundTasks + lastMessageAt + aiTitle + dormant are all unchanged.
  // Same tri-valued pattern as dormant: "1"/"0"/"" so a recycling-only flip
  // is detectable vs cold cache. Source A always stamps a strict boolean.
  // Phase 59 Plan 02: lastStopAt + lastStatusChangeAt are two additional
  // distinct axes — a change to either (per-session Stop-hook file rewrote,
  // or server-derived status-value transitioned) publishes a new frame even
  // when every other axis is unchanged. Null-normalized to "" so a
  // first-time-null publish is distinguishable from cold cache (matches
  // lastMessageAt / aiTitle numeric-axis handling). Fingerprint segments
  // MUST live at the END of the template literal so any future axis is
  // appended after these two without disturbing the delta contract.
  // Phase 62 Plan 03: activityMtime + stoppedMtime are two additional
  // distinct axes — a per-session marker file touch (activity-hook.sh fired
  // on UserPromptSubmit / PreToolUse, or stopped-hook.sh fired on Stop /
  // StopFailure / PermissionRequest) bumps the mtime, which is the ONLY
  // way to observe the direct-signal WIP predicate. Same null-normalized
  // "" convention as the Phase 59 numeric axes — a marker-mtime-only change
  // publishes a new frame even when status + backgroundTasks + lastStopAt +
  // lastStatusChangeAt + every other axis is unchanged. Segments appended
  // at the END so any future axis is added after these without disturbing
  // the existing delta contract.
  return `${state.status}|${state.waitingFor ?? ""}|${bgKey}|${state.updatedAt}|${state.lastMessageAt ?? ""}|${state.aiTitle ?? ""}|${state.dormant === true ? "1" : state.dormant === false ? "0" : ""}|${state.recycling === true ? "1" : state.recycling === false ? "0" : ""}|${state.lastStopAt ?? ""}|${state.lastStatusChangeAt ?? ""}|${state.activityMtime ?? ""}|${state.stoppedMtime ?? ""}`;
}

// ---------------------------------------------------------------------------
// Phase 99 — spawn-request scan helpers (D-01, D-02, D-03, D-17)
//
// One atomic read-and-delete exec per tick per host: lists
// ~/fleet/spawn-requests/, reads + claims each *.json request file via `mv`
// (atomic claim — Pitfall 7, RESEARCH Security Note), filters to UUID-shaped
// basenames (36-char length guard prevents *.success.json / *.failure.json
// from being claimed), and returns the parsed batch to pollOneHost.
//
// Missing folder → empty batch (D-03, not an error).
// Null SSH return → empty batch, warn logged (fail-open, same as ls path).
// ---------------------------------------------------------------------------

/**
 * Atomic shell one-liner for the spawn-request scan (RESEARCH Pattern 2).
 *
 * - `cd ... || exit 0` — missing folder short-circuits cleanly (D-03).
 * - `[ -f "$f" ] || continue` — skip glob no-match (*.json expands to literal
 *   when folder is empty, which is guarded by the `[ -f ]` test).
 * - `base="${f%.json}"` then `[ ${#base} -eq 36 ] || continue` — UUID length
 *   guard: request filenames are <uuid>.json (36-char hex-and-dash). Response
 *   files are <uuid>.success.json / <uuid>.failure.json — stripped base is 43+
 *   chars, rejected here (RESEARCH Security Note + Pitfall 7).
 * - `mv "$f" "$tmp" 2>/dev/null || continue` — atomic claim. Only one
 *   concurrent tick can win the mv; the loser skips (double-observation
 *   defense per Pitfall 7).
 * - `printf '%s\t' "$f"; cat "$tmp"; printf '\n'; rm -f "$tmp"` — emit
 *   tab-separated `<filename><TAB><body><NEWLINE>` then delete the temp file.
 *   No shell quoting of the JSON body — the body goes to stdout as raw bytes.
 */
const SPAWN_REQUESTS_SCAN_CMD = [
  "cd ~/fleet/spawn-requests 2>/dev/null || exit 0;",
  "for f in *.json; do",
  "[ -f \"$f\" ] || continue;",
  "base=\"${f%.json}\";",
  "[ ${#base} -eq 36 ] || continue;",
  "tmp=\"$f.$$\";",
  "mv \"$f\" \"$tmp\" 2>/dev/null || continue;",
  "printf '%s\\t' \"$f\"; cat \"$tmp\"; printf '\\n'; rm -f \"$tmp\";",
  "done",
].join(" ");

/** UUID shape regex for defense-in-depth in the TS parser (RESEARCH Security Note). */
const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * Parse the batched stdout from the atomic spawn-request scan exec into an
 * array of PendingBirth items.
 *
 * stdout format: one line per claimed file, tab-separated:
 *   <uuid>.json<TAB><json-body><NEWLINE>
 *
 * Skips:
 * - Lines without a TAB separator.
 * - Filenames whose UUID portion fails UUID_RE (e.g. response files).
 * - Lines with malformed JSON (warns + continues).
 *
 * userId is left as "" — the worker refetches via getHostOwnerUserId(hostIdNum)
 * at drain time (Pitfall 3 + Plan 99-01 Task 2 contract).
 */
export function parseSpawnRequestBatch(stdout: string, hostId: string): PendingBirth[] {
  if (!stdout.trim()) return [];
  const results: PendingBirth[] = [];
  const hostIdNum = parseInt(hostId, 10);
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const filename = line.slice(0, tab).trim();
    const body = line.slice(tab + 1).trim();
    const uuid = filename.replace(/\.json$/, "");
    if (!UUID_RE.test(uuid)) continue;

    // Full request-body validation via the worker's parseRequestBody helper.
    // On failure, enqueue a PendingBirth with malformedReason so the worker
    // drops a proper {reason:"malformed", message} failure file back to coord.
    // (Post-code-review M2/M3: prior version silently dropped malformed
    // requests via `continue`, leaving coord to time out.)
    const parsed = parseRequestBody(uuid, body);
    // Explicit `=== false` narrowing: `!parsed.ok` fails to narrow the
    // discriminated union under tsconfig.node.json's strict setup (build tsc
    // sees the full union inside the guard instead of just the ok:false
    // variant). Same TS 6.0.3 workaround pattern used in identity-birth-
    // orchestrator.ts mintResult/loginResult call sites.
    if (parsed.ok === false) {
      systemLogger.warn("spawn-request-scan: request body malformed — enqueueing malformed failure", {
        operation: "spawn_request_scan_malformed",
        fleetHostId: hostId,
        uuid,
        reason: parsed.message,
      });
      results.push({
        hostId,
        hostIdNum,
        uuid,
        role: "",
        task: null,
        requested_at: "",
        userId: "",
        malformedReason: parsed.message,
      });
      continue;
    }

    results.push({
      hostId,
      hostIdNum,
      uuid,
      role: parsed.body.role,
      task: parsed.body.task,
      requested_at: parsed.body.requested_at,
      userId: "",
    });
  }
  return results;
}

/**
 * Issue the atomic scan exec on the per-host SSH channel and return parsed
 * PendingBirth items.
 *
 * Fails open on SSH error (null channel.exec return) — same pattern as the
 * ls listing inside pollOneHost. Missing folder returns empty batch (D-03).
 */
export async function scanSpawnRequests(host: HostRecord, channel: SshChannel): Promise<PendingBirth[]> {
  const stdout = await channel.exec(SPAWN_REQUESTS_SCAN_CMD);
  if (stdout === null) {
    systemLogger.warn("Fleet-status: spawn-request scan returned null (SSH error)", {
      operation: "fleet_status_spawn_scan_ssh_error",
      fleetHostId: host.id,
    });
    return [];
  }
  if (!stdout.trim()) {
    // Missing folder (cd ... || exit 0) OR empty folder — both non-errors per D-03.
    return [];
  }
  const results = parseSpawnRequestBatch(stdout, host.id);
  systemLogger.info("Fleet-status: spawn-request scan complete", {
    operation: "spawn_request_scan_complete",
    fleetHostId: host.id,
    claimed: results.length,
  });
  return results;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSshPollOrchestrator(
  deps: OrchestratorDeps,
): SshPollOrchestrator {
  const pollIntervalMs = deps.pollIntervalMs ?? 2000;
  const staleSweepIntervalMs = deps.staleSweepIntervalMs ?? 30000;
  const hookPayloadPath =
    deps.hookPayloadPath ?? "~/.claude/fleet-status/last-stop-payload.json";
  const hookPayloadWarnCooldownMs = deps.hookPayloadWarnCooldownMs ?? 60000;

  // Internal state
  const perHostState = new Map<string, PerHostState>();
  // -----------------------------------------------------------------------
  // quick-260820-tm0 — per-host in-flight guard (2026-08-20 wilma incident)
  //
  // The wilma incident (2026-08-20) accumulated 392 concurrent tailscale-ssh
  // be-child sessions on a single remote target because pollAllHosts kept
  // stacking new pollOneHost invocations on the same hostId while the prior
  // one was still awaiting a slow `ls -1`. Node's setInterval fires every
  // pollIntervalMs regardless of whether the previous async fn resolved, so
  // a target whose `ls -1` takes 30s under load can accumulate ~15
  // concurrent pollOneHost iterations before a single one completes.
  //
  // The guard is PER-HOST, NOT GLOBAL — a slow host must NOT block polls
  // for other hosts on the same tick. Membership check runs immediately
  // before the pollOneHost call inside the pollAllHosts loop; a match
  // increments skipCount, logs at INFO, and continues to the next host.
  // On successful schedule the flag is set, skipCount is reset to 0, and
  // pollOneHost is invoked inside try/catch/finally so `inFlight.delete`
  // runs on both happy-path return AND thrown errors (never leaks a
  // stuck flag). See Task 2 (quick-260820-tm0) for the paired eviction
  // cleanup that removes entries here when a host is pruned from the
  // identity-host list.
  // -----------------------------------------------------------------------
  const inFlight = new Set<string>();
  const skipCount = new Map<string, number>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  let pollTickCount = 0;
  let stopped = false;

  // How often to re-query the DB for identity hosts (every ~30s worth of polls)
  const hostRefreshEveryNTicks = Math.max(
    1,
    Math.floor(staleSweepIntervalMs / pollIntervalMs),
  );

  // ---------------------------------------------------------------------------
  // Phase 92 — sweep-first / legacy-fallback dispatch
  //
  // pollOneHost is now a THIN DISPATCHER. It:
  //   (1) Detects per-SSH-channel-lifetime cache invalidation (new channel
  //       object → reset the probe cache).
  //   (2) Probes for ~/.local/bin/fleet-status-sweep on first-tick-per-channel.
  //   (3) On sweep-present + no schema-drift-latch: try pollOneHostBatch.
  //       - On success: return.
  //       - On failure (null exec / schema mismatch / empty-on-nonempty-box):
  //         log the reason, force re-probe next tick if transient, fall
  //         through to legacy.
  //   (4) Otherwise: run pollOneHostLegacy (the pre-Phase-92 body verbatim).
  //
  // The `inFlight` guard at pollAllHosts wraps this whole function unchanged.
  // A slow sweep-exec does NOT stack ticks (RESEARCH.md G5 preserved).
  // ---------------------------------------------------------------------------

  /**
   * Phase 92 — sweep-exec timeout. Larger than DISCOVERY_EXEC_TIMEOUT_MS (5s)
   * because the sweep does per-identity fs walks that may hit cold disk cache
   * on managed boxes with many identities. Still safely under the 2s poll
   * interval's `inFlight` skip semantics on most boxes — a sweep that regularly
   * exceeds this bound is a symptom of managed-box overload and should surface
   * via `inFlight` skip logs (quick-260820-tm0), not a silent hang.
   */
  const SWEEP_EXEC_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// Phase 99 — spawn-request scan helpers (D-01, D-02, D-03, D-17)
//
// One atomic read-and-delete exec per tick per host: lists
// ~/fleet/spawn-requests/, reads + claims each *.json request file via `mv`
// (atomic claim — Pitfall 7, RESEARCH Security Note), filters to UUID-shaped
// basenames (36-char length guard prevents *.success.json / *.failure.json
// from being claimed), and returns the parsed batch to pollOneHost.
//
// Missing folder → empty batch (D-03, not an error).
// Null SSH return → empty batch, warn logged (fail-open, same as ls path).

  /**
   * pollOneHost — dispatcher. See docblock above.
   */
  async function pollOneHost(hostState: PerHostState): Promise<void> {
    const { host, channel } = hostState;

    systemLogger.info("Fleet-status poll start", {
      operation: "fleet_status_poll_start",
      fleetHostId: host.id,
      tick: pollTickCount,
    });

    // Reset per-connection presence cache if the SSH channel object changed.
    // The starter.ts channel-teardown handlers (`client.on("end"/"close"/
    // "error")`) drop the hostClients entry; the next acquireSshChannel
    // returns a fresh SshChannel wrapper. Comparing object identity here is
    // cheaper than plumbing a callback through starter.ts (open-question #4
    // resolution: per-host-per-connection-lifetime probe cache).
    if (hostState.channel !== hostState.lastProbeChannelRef) {
      hostState.sweepScriptPresent = null;
      hostState.sweepSchemaMismatchThisConnection = false;
      hostState.lastProbeChannelRef = hostState.channel;
    }

    // Presence probe on first tick per SSH-channel lifetime OR after a
    // sweep-exec null return (transient recovery — see below).
    if (hostState.sweepScriptPresent === null) {
      const probeRaw = await channel.exec(
        "test -x ~/.local/bin/fleet-status-sweep 2>/dev/null && echo yes || echo no",
      );
      hostState.sweepScriptPresent =
        probeRaw !== null && probeRaw.trim() === "yes";
      systemLogger.info("Fleet-status: sweep-script presence probed", {
        operation: "fleet_status_sweep_probe",
        fleetHostId: host.id,
        present: hostState.sweepScriptPresent,
      });
    }

    // Dispatch: batch first, legacy fallback on failure.
    if (
      hostState.sweepScriptPresent &&
      !hostState.sweepSchemaMismatchThisConnection
    ) {
      const result = await pollOneHostBatch(hostState);
      if (result.ok) {
        // Phase 99 — spawn-request scan (D-01+D-02). Runs on every completed poll
        // regardless of path so any claimed request files get enqueued.
        const spawnBatch = await scanSpawnRequests(host, channel);
        for (const item of spawnBatch) {
          deps.enqueueSpawnRequest?.(item);
        }
        systemLogger.info("Fleet-status poll end (batch)", {
          operation: "fleet_status_poll_end",
          fleetHostId: host.id,
          tick: pollTickCount,
          path: "batch",
          identityCount: result.identityCount,
          pidCount: result.pidCount,
          spawnClaimed: spawnBatch.length,
        });
        return;
      }
      // Failure — log why and fall through to legacy for this tick.
      // tsconfig.node.json has strict:false, so TS can't narrow the discriminated
      // union via `if (result.ok) return`; access .reason via a typed cast.
      const failed = result as {
        ok: false;
        reason: "null-exec" | "schema-mismatch" | "empty-output-on-nonempty-box";
      };
      systemLogger.warn(
        "Fleet-status: batch path failed, falling back to legacy this tick",
        {
          operation: "fleet_status_batch_fallback",
          fleetHostId: host.id,
          reason: failed.reason,
        },
      );
      // On null-exec, force re-probe next tick (may be transient — SSH hiccup
      // that swallowed stdout, or script really disappeared between probe
      // and exec). Schema-mismatch and empty-on-nonempty are architectural
      // drift symptoms — leave the cache and force fallback until reconnect.
      if (failed.reason === "null-exec") {
        hostState.sweepScriptPresent = null;
      }
      if (failed.reason === "schema-mismatch") {
        hostState.sweepSchemaMismatchThisConnection = true;
      }
    }

    await pollOneHostLegacy(hostState);

    // Phase 99 — spawn-request scan (D-01+D-02).
    const spawnBatch = await scanSpawnRequests(host, channel);
    for (const item of spawnBatch) {
      deps.enqueueSpawnRequest?.(item);
    }

    systemLogger.info("Fleet-status poll end (legacy)", {
      operation: "fleet_status_poll_end",
      fleetHostId: host.id,
      tick: pollTickCount,
      path: "legacy",
      spawnClaimed: spawnBatch.length,
    });
  }

  /**
   * pollOneHostLegacy — the pre-Phase-92 pollOneHost body extracted verbatim
   * (rename + move, no behavior change). Used as the fallback branch of the
   * new dispatcher when the sweep script is absent, returns null, or emits
   * a schema-mismatched payload.
   *
   * Preserved as the mandatory backward-compat path per CONTEXT.md § Backward
   * compat during rollout: "Do NOT hard-fail if the sweep script is absent."
   */
  async function pollOneHostLegacy(hostState: PerHostState): Promise<void> {
    const { host, channel } = hostState;

    // (a) Enumerate session-JSON files
    const listing = await channel.exec(
      "ls -1 ~/.claude/sessions/*.json 2>/dev/null || true",
    );

    if (listing === null) {
      systemLogger.warn(
        "Fleet-status: ls of sessions dir returned null (SSH error)",
        {
          operation: "fleet_status_host_ssh_unreachable",
          fleetHostId: host.id,
        },
      );
      return;
    }

    // Parse PID numbers from filenames like /home/user/.claude/sessions/12345.json
    const pidLines = listing
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const pidNumbers: number[] = [];
    for (const line of pidLines) {
      const match = /(\d+)\.json$/.exec(line);
      if (match) {
        pidNumbers.push(parseInt(match[1], 10));
      }
    }

    // (b) For each PID: parallel-fetch session-JSON + stat + hook payload
    await Promise.all(
      pidNumbers.map((pid) => processPid(hostState, pid)),
    );

    // (c) Phase 52 Plan 01 Task 3 — source B: enumerate ~/fleet/identities/
    //     for dormant-only identities that have NO live claude PID this tick
    //     and publish SessionState frames for them.
    const liveTmuxSet = new Set<string>();
    for (const entry of hostState.livenessMap.values()) {
      if (entry.tmuxSession !== null) {
        liveTmuxSet.add(entry.tmuxSession);
      }
    }
    await pollDormantOnlyIdentities(hostState, liveTmuxSet);
  }

  /**
   * pollOneHostBatch — Phase 92 batch path. Fires ONE `channel.exec` per host
   * per poll cycle for the sweep script. Parses the JSONL emission and drives
   * the SAME compose+publish machinery as the legacy path via the fetch/
   * compose helpers.
   *
   * Failure modes:
   *   - `null-exec`: sweep exec returned null (SSH transport hiccup, script
   *     vanished, timeout). Caller falls through to legacy and re-probes.
   *   - `schema-mismatch`: at least one parseable line carried a schema_version
   *     other than SWEEP_SCHEMA_VERSION. Caller latches the mismatch flag,
   *     blocking the batch path until channel reconnect.
   *   - `empty-output-on-nonempty-box`: sweep returned zero identity + zero
   *     pid lines, but we have prior-tick evidence the box has content
   *     (livenessMap or identityRecycleState non-empty). Caller falls through
   *     to legacy for this tick but does NOT latch — the next tick re-tries
   *     the batch (script might be back after a transient failure).
   *
   * Success return carries observability counts for the poll-end log.
   */
  async function pollOneHostBatch(
    hostState: PerHostState,
  ): Promise<
    | { ok: true; identityCount: number; pidCount: number }
    | { ok: false; reason: "null-exec" | "schema-mismatch" | "empty-output-on-nonempty-box" }
  > {
    const { host, channel } = hostState;

    // Sweep exec — ONE call per host per poll (the whole point of Phase 92).
    // Wrapped in Promise.race to bound wall time and prevent inFlight stacking
    // on a stalled managed box.
    let sweepRaw: string | null;
    try {
      sweepRaw = await Promise.race([
        channel.exec("~/.local/bin/fleet-status-sweep 2>/dev/null"),
        new Promise<string | null>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `pollOneHostBatch sweep-exec timeout after ${SWEEP_EXEC_TIMEOUT_MS}ms`,
                ),
              ),
            SWEEP_EXEC_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (err) {
      systemLogger.warn("Fleet-status: sweep-exec timeout or throw", {
        operation: "fleet_status_sweep_exec_null",
        fleetHostId: host.id,
        error: err instanceof Error ? err.message : "unknown",
      });
      return { ok: false, reason: "null-exec" };
    }

    if (sweepRaw === null) {
      systemLogger.warn("Fleet-status: sweep-exec returned null (SSH hiccup)", {
        operation: "fleet_status_sweep_exec_null",
        fleetHostId: host.id,
      });
      return { ok: false, reason: "null-exec" };
    }

    const parsed = parseSweepJsonl(sweepRaw);
    if (parsed.schemaMismatch) {
      systemLogger.warn(
        "Fleet-status: sweep-emit schema_version mismatch — latching fallback",
        {
          operation: "fleet_status_sweep_schema_mismatch",
          fleetHostId: host.id,
          expectedSchemaVersion: SWEEP_SCHEMA_VERSION,
          identityLineCount: parsed.identityLines.length,
          pidLineCount: parsed.pidLines.length,
          unknownLineCount: parsed.unknownLines,
        },
      );
      return { ok: false, reason: "schema-mismatch" };
    }

    // Empty output disambiguation: freshly-provisioned or empty box vs
    // broken script. Prior-tick evidence of content (livenessMap or
    // identityRecycleState non-empty) → treat empty as suspicious and fall
    // back to legacy for this tick. Otherwise accept as a genuine
    // empty-box emission.
    if (parsed.identityLines.length === 0 && parsed.pidLines.length === 0) {
      const hasPriorContent =
        hostState.livenessMap.size > 0 ||
        hostState.identityRecycleState.size > 0;
      if (hasPriorContent) {
        return { ok: false, reason: "empty-output-on-nonempty-box" };
      }
      // Genuinely-empty box — success with zero counts.
      return { ok: true, identityCount: 0, pidCount: 0 };
    }

    // Build a quick identity→SweepIdentityLine index for source-A PID lines
    // that need to reuse the identity's jsonl_path (SWEEP_FIELD_PARITY A11
    // fold — no separate per-PID discovery on the wire).
    const identityLineByName = new Map<string, SweepIdentityLine>();
    for (const line of parsed.identityLines) {
      identityLineByName.set(line.identity, line);
    }

    // Source A — dispatch each SweepPidLine into the SAME compose helper the
    // legacy path uses. writeSessionFileCache fires here (compose G8).
    for (const pidLine of parsed.pidLines) {
      const fetched = pidLineToPerPidFetched(pidLine, identityLineByName);
      await composeAndPublishPerPid(hostState, pidLine.pid, fetched);
    }

    // Source B — build liveTmuxSet AFTER source A completes (source A's
    // stale-reap may have deleted PIDs from livenessMap).
    const liveTmuxSet = new Set<string>();
    for (const entry of hostState.livenessMap.values()) {
      if (entry.tmuxSession !== null) {
        liveTmuxSet.add(entry.tmuxSession);
      }
    }

    // Source B — dispatch each SweepIdentityLine into the SAME compose helper.
    for (const identityLine of parsed.identityLines) {
      const fetched = identityLineToPerIdentityFetched(identityLine, hostState);
      const cached = hostState.identityRecycleState.get(identityLine.identity);
      composeAndPublishPerIdentity(hostState, liveTmuxSet, fetched, cached);
    }

    return {
      ok: true,
      identityCount: parsed.identityLines.length,
      pidCount: parsed.pidLines.length,
    };
  }

  /**
   * Adapter: SweepPidLine → PerPidFetchedState. Direct field-copy of the
   * schema fields onto the fetched struct.
   *
   * Two SWEEP_FIELD_PARITY-documented divergences from the legacy fetch:
   *   - `hookPayloadRaw = null` (A3 skip): sweep does NOT emit box-wide
   *     last-stop-payload.json. Compose handles the null → falls back to
   *     emitHookPayloadWarn + backgroundTasks=[] when per_session is also
   *     null. Documented in sweep-schema.ts SWEEP_FIELD_PARITY.A3.
   *   - `jsonlPath` sourced from the joined SweepIdentityLine (A11 fold):
   *     per-PID discovery folded into the per-identity discovery on the
   *     wire; PIDs on identities that have a SweepIdentityLine reuse that
   *     identity's jsonl_path.
   */
  function pidLineToPerPidFetched(
    pidLine: SweepPidLine,
    identityLineByName: Map<string, SweepIdentityLine>,
  ): PerPidFetchedState {
    const identityLine = identityLineByName.get(pidLine.identity);
    return {
      sessionJsonRaw: pidLine.session_json,
      statResult: pidLine.stat_result,
      hookPayloadRaw: null, // SWEEP_FIELD_PARITY.A3 skip
      tmuxSession: pidLine.identity,
      freshLastStopAt: pidLine.per_session_stop_mtime_ms,
      freshActivityMtime: pidLine.activity_mtime_ms,
      freshStoppedMtime: pidLine.stopped_mtime_ms,
      perSessionHookPayloadRaw: pidLine.per_session_stop_payload,
      freshDormant: pidLine.dormant_a,
      jsonlPath: pidLine.jsonl_tail !== null
        // If sweep emitted a tail, the identity is real; get the path from
        // the joined identity line. Sweep script guarantees a SweepIdentity-
        // Line for every SweepPidLine.identity (per Plan 02 contract).
        ? (identityLine?.jsonl_path ?? null)
        : (identityLine?.jsonl_path ?? null),
      jsonlTail: pidLine.jsonl_tail,
    };
  }

  /**
   * Adapter: SweepIdentityLine → PerIdentityFetchedState. Direct field-copy.
   *
   * B5 (layer1_recycling) fail-open reconciliation lives here so compose sees
   * the resolved value ready to plug into the OR-composition:
   *   - non-null value → use it directly (fresh scan verdict)
   *   - null (tail unreadable this tick) → preserve cached value
   *
   * Stale-tail rediscovery counter resets to 0 in the batch path. Plan 02's
   * script does its own discovery every tick, so the multi-tick rotation
   * defense doesn't apply the same way; the counter stays defined on the
   * cache for legacy-path continuity but batch-mode ticks never increment it.
   */
  function identityLineToPerIdentityFetched(
    identityLine: SweepIdentityLine,
    hostState: PerHostState,
  ): PerIdentityFetchedState {
    const cached = hostState.identityRecycleState.get(identityLine.identity);
    // B5 fail-open — null tail-scan preserves cached layer1RecyclingCached.
    const layer1RecyclingCached =
      identityLine.layer1_recycling !== null
        ? identityLine.layer1_recycling
        : (cached?.layer1RecyclingCached ?? false);
    return {
      name: identityLine.identity,
      isDormant: identityLine.dormant,
      isRecycledAt: identityLine.recycled_at,
      isRecycleRequested: identityLine.recycle_requested,
      layer1RecyclingCached,
      jsonlPath: identityLine.jsonl_path,
      // Batch-path scripts perform per-tick discovery server-side; the multi-
      // tick rotation defense does not apply here.
      nextStaleTailTickCount: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Source B — per-identity enumeration + full three-axis recycle pipeline
  //
  // History:
  //   - Phase 52 Plan 01 Task 3: introduced source B for the dormant axis only
  //     (identity-folder-keyed enumeration, PID-independent).
  //   - Phase 53 CR C2/C3: widened source B to also cover the recycling axis
  //     (`.recycled-at` sentinel) for identities with NO live PID (PID-vanish
  //     window during recycle).
  //   - quick-260823-73o: MIGRATED all three recycle axes (`.recycle-requested`,
  //     `.recycled-at`, Layer 1 /id reset scan) out of source A's per-PID loop
  //     and into source B here. Source A now stamps recycling:false
  //     unconditionally; source B is the SOLE publisher of the recycling axis.
  //     The unconditional `liveTmuxSet.has(name)` skip is CONDITIONALLY lifted:
  //     skip only when `!isRecycling`. When any of the three axes fires true,
  //     source B publishes regardless of whether source A also published for
  //     the same identity in the same tick (no conflict — source A no longer
  //     stamps the axis). RCA: source A iterates ~/.claude/tasks/*.json (PID
  //     files); during /id reset the outgoing PID is being torn down and
  //     source A's per-PID iteration hits a lifecycle-timing gap where none
  //     of the three axes ever evaluate true across the sentinel-present
  //     window. Source B is identity-folder-keyed and runs unconditionally
  //     per identity per tick — the correct architectural seam. See
  //     quick-260823-73o-PLAN.md for the full RCA + Alice's UAT narration.
  //
  // Per-tick pipeline (per identity):
  //   1. Parallel-stat all three sentinels (`.dormant`, `.recycled-at`,
  //      `.recycle-requested`) — 3 exec calls in parallel per identity.
  //   2. Discover jsonlPath if cache is null OR stale-tail threshold tripped;
  //      cached across ticks so discovery only fires once per identity.
  //   3. If jsonlPath known, `tail -c 262144 <path>` and scan for Layer 1
  //      /id reset signal (fail-open on null return → preserve cache).
  //   4. Compose isRecycling = layer1 || requested || sentinel.
  //   5. Skip-and-evict branch: if identity has live PID AND !isRecycling,
  //      delete cache entry and continue (source A owns publish; matches
  //      pre-migration skip semantics for non-recycling live-PID identities).
  //   6. Fingerprint = `${dormant?1:0}|${recycling?1:0}`. Compare against
  //      cached lastPublishedFingerprint; if identical, advance cache and skip
  //      publish. If different (or first appearance), publish source-B frame
  //      and update cache fingerprint.
  //   7. When isRecycling is true, emit `fleet_status_recycling_armed` log
  //      (moved from source A) with identityName + hasLivePid + per-axis
  //      breakdown + cached values.
  //
  // Fail-open: if `ls` returns null (SSH error) or empty (no identities dir),
  // log a debug and skip source B for this tick. Source A still fires normally.
  //
  // Shell-quoting via shellSingleQuote (T-52-01-02 mitigation): identity names
  // from `ls` output are attacker-controlled (a compromised host could name
  // an identity `; rm -rf $HOME`), so each stat + tail + discovery command
  // interpolates the FULL quoted argument — cannot escape.
  // ---------------------------------------------------------------------------

  async function pollDormantOnlyIdentities(
    hostState: PerHostState,
    liveTmuxSet: Set<string>,
  ): Promise<void> {
    const { host, channel, identityRecycleState } = hostState;

    // Enumerate identity folders. Use `find -type d` (not `ls -1`) so
    // leftover backup tarballs / notes / .DS_Store in ~/fleet/identities/
    // (e.g. `pixie.pre-role-migration.20260804T050759Z.tar.gz` from role
    // migrations) do NOT get enumerated as identity names — otherwise we
    // fire ghost SSH-exec stat/find calls per tick against nonexistent
    // identity dirs. `-mindepth 1 -maxdepth 1 -type d -printf '%f\n'`
    // emits ONLY directory basenames (one per line) — same shape as the
    // prior `ls -1` output. Managed hosts are all Linux (box-map.md
    // § Managed hosts) so GNU find + `-printf` is available. Guard
    // `2>/dev/null || true` mirrors the prior fail-open shape when the
    // ~/fleet/identities/ dir doesn't exist.
    const listing = await channel.exec(
      "find ~/fleet/identities/ -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' 2>/dev/null || true",
    );
    if (listing === null || listing.trim() === "") {
      systemLogger.debug(
        "Fleet-status: source B — no identities dir or SSH error",
        {
          operation: "fleet_status_source_b_skip",
          fleetHostId: host.id,
        },
      );
      return;
    }

    const identityNames = listing
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // Phase 1 — parallel-stat all three sentinels per identity.
    const statResults = await Promise.all(
      identityNames.map(async (name) => {
        const quotedName = shellSingleQuote(name);
        const [dormantOut, recyclingOut, requestedOut] = await Promise.all([
          channel.exec(
            `stat ~/fleet/identities/${quotedName}/.dormant 2>/dev/null >/dev/null && echo yes || echo no`,
          ),
          channel.exec(
            `stat ~/fleet/identities/${quotedName}/.recycled-at 2>/dev/null >/dev/null && echo yes || echo no`,
          ),
          channel.exec(
            `test -f ~/fleet/identities/${quotedName}/.recycle-requested 2>/dev/null && echo yes || echo no`,
          ),
        ]);
        // T-52-01-01 mitigation: only "yes" or "no" are meaningful. Anything
        // else (null, unexpected output) → treat as false. Source B's stat
        // axes are per-tick reads with no per-identity fail-open cache for
        // the raw stat outputs; the Layer 1 tail-scan below IS cache-preserved.
        const isDormant = dormantOut !== null && dormantOut.trim() === "yes";
        const isRecycledAt =
          recyclingOut !== null && recyclingOut.trim() === "yes";
        const isRecycleRequested =
          requestedOut !== null && requestedOut.trim() === "yes";
        return { name, isDormant, isRecycledAt, isRecycleRequested };
      }),
    );

    // Phase 2-7 — sequential per-identity iteration (discovery + tail scan +
    // OR compose + skip/publish). Sequential rather than parallel because
    // each identity's Layer 1 scan uses its own cached jsonlPath and we want
    // deterministic cache updates in the presence of test-time mocked SSH.
    for (const { name, isDormant, isRecycledAt, isRecycleRequested } of statResults) {
      const cached = identityRecycleState.get(name);
      const fetched = await fetchPerIdentityState(
        hostState,
        name,
        cached,
        isDormant,
        isRecycledAt,
        isRecycleRequested,
      );
      composeAndPublishPerIdentity(hostState, liveTmuxSet, fetched, cached);
    }
  }

  /**
   * fetchPerIdentityState — runs the pre-Phase-92 B1..B5 exec fan-out for one
   * identity IN THE LEGACY PATH. Zero cache mutation, zero publish, zero
   * logging.
   *
   * Discovery (B4) fires when the cache is empty; the fetched jsonlPath
   * reflects a fresh discovery result (or null when discovery couldn't
   * resolve). Layer 1 recycling scan (B5) runs against the tail read for the
   * resolved path — the same fail-open preservation + rotation-defense
   * stale-counter logic as pre-refactor. Returns a PerIdentityFetchedState
   * that composeAndPublishPerIdentity consumes to drive the same publish
   * contract as the pre-refactor per-identity iteration body.
   *
   * The three sentinel results (B1/B2/B3) are passed in from the caller's
   * outer Promise.all — they're computed identically for every identity so
   * batching them there stays in the legacy per-identity iteration wrapper.
   */
  async function fetchPerIdentityState(
    hostState: PerHostState,
    name: string,
    cached: IdentityRecycleCacheEntry | undefined,
    isDormant: boolean,
    isRecycledAt: boolean,
    isRecycleRequested: boolean,
  ): Promise<PerIdentityFetchedState> {
    const { channel } = hostState;

    // Phase 2 — discovery (fires when cache empty; rediscovers after
    // stale-tail threshold trip nulls the cached jsonlPath).
    let jsonlPath: string | null = cached?.jsonlPath ?? null;
    if (jsonlPath === null) {
      jsonlPath = await discoverIdentityJsonlPathViaChannel(channel, name);
    }

    // Phase 3 — Layer 1 tail scan.
    // Fail-open: null return → preserve cached value.
    let layer1RecyclingCached: boolean = cached?.layer1RecyclingCached ?? false;
    let nextStaleTailTickCount = cached?.staleTailTickCount ?? 0;
    if (jsonlPath !== null) {
      const tailRaw = await channel.exec(
        `tail -c 262144 ${jsonlPath} 2>/dev/null || true`,
      );
      if (tailRaw !== null && tailRaw.trim() !== "") {
        const scannedLayer1 = scanTailForLayer1RecyclingSignal(tailRaw);
        if (scannedLayer1 !== null) {
          layer1RecyclingCached = scannedLayer1;
          // Fresh non-null scan → reset stale counter.
          nextStaleTailTickCount = 0;
        } else if (layer1RecyclingCached) {
          // Tail had zero user turns AND we had a cached true value →
          // increment stale counter (defense against JSONL rotation
          // silently retiring the file we were watching).
          nextStaleTailTickCount++;
        } else {
          // Tail had zero user turns and cache was false — reset counter.
          nextStaleTailTickCount = 0;
        }
      } else if (layer1RecyclingCached) {
        // Empty tail / null exec AND cached true → tick stale counter.
        nextStaleTailTickCount++;
      }
      // else: empty tail + cached false → keep counter at 0 (no signal to defend).
      if (nextStaleTailTickCount >= STALE_TAIL_REDISCOVERY_THRESHOLD) {
        jsonlPath = null;
        nextStaleTailTickCount = 0;
      }
    }

    return {
      name,
      isDormant,
      isRecycledAt,
      isRecycleRequested,
      layer1RecyclingCached,
      jsonlPath,
      nextStaleTailTickCount,
    };
  }

  /**
   * composeAndPublishPerIdentity — full downstream of the per-identity
   * iteration: OR compose the three recycle axes, apply the skip-and-evict
   * transition-edge, fingerprint suppression, publish, cache write. Zero
   * SSH calls.
   *
   * Byte-identical observable behavior to the pre-refactor per-identity
   * iteration body. Batch-path callers synthesize the `fetched` struct from
   * a SweepIdentityLine and drive this same publish contract.
   */
  function composeAndPublishPerIdentity(
    hostState: PerHostState,
    liveTmuxSet: Set<string>,
    fetched: PerIdentityFetchedState,
    cached: IdentityRecycleCacheEntry | undefined,
  ): void {
    const { host, identityRecycleState } = hostState;
    const {
      name,
      isDormant,
      isRecycledAt,
      isRecycleRequested,
      layer1RecyclingCached,
      jsonlPath,
      nextStaleTailTickCount,
    } = fetched;

    // Phase 4 — OR compose. Three axes match source A's pre-migration
    // semantics.
    const isRecycling = layer1RecyclingCached || isRecycleRequested || isRecycledAt;

    // Phase 5 — conditional skip. When identity has a live PID AND is NOT
    // recycling, source A owns publish for the non-recycle axes — evict this
    // identity's source-B cache and continue.
    //
    // TRANSITION EDGE (quick-260823-73o T1-vi lock): if we're about to skip-
    // and-evict AND the cached source-B frame had recycling:true, publish a
    // final recycling:false source-B frame BEFORE evicting so consumers see
    // the transition.
    if (liveTmuxSet.has(name) && !isRecycling) {
      const cachedRecycling = cached?.recycling ?? false;
      if (cachedRecycling) {
        const state: SessionState = {
          hostId: host.id,
          tmuxSession: name,
          sessionId: "__dormant__",
          pid: null,
          status: "idle",
          waitingFor: undefined,
          backgroundTasks: [],
          updatedAt: deps.now(),
          lastMessageAt: null,
          aiTitle: null,
          dormant: isDormant,
          recycling: false,
        };
        deps.registry.publishSessionState(host.id, state);
        systemLogger.info(
          "Fleet-status: source B frame published (recycling-false transition, pre-evict)",
          {
            operation: "fleet_status_source_b_publish",
            fleetHostId: host.id,
            identityName: name,
            dormant: isDormant,
            recycling: false,
            previousDormant: cached?.dormant ?? null,
            previousRecycling: cached?.recycling ?? null,
          },
        );
      }
      identityRecycleState.delete(name);
      return;
    }

    // Phase 6 — fingerprint + publish/suppress.
    const fingerprint = `${isDormant ? "1" : "0"}|${isRecycling ? "1" : "0"}`;

    if (cached !== undefined && cached.lastPublishedFingerprint === fingerprint) {
      // Cache hit — fingerprint identical → advance internal state but skip
      // publish (source B fingerprint suppression contract).
      identityRecycleState.set(name, {
        dormant: isDormant,
        recycling: isRecycling,
        layer1RecyclingCached,
        jsonlPath,
        staleTailTickCount: nextStaleTailTickCount,
        lastPublishedFingerprint: fingerprint,
      });
      return;
    }

    // Fingerprint delta (or first appearance) → publish + update cache.
    const previousDormant = cached?.dormant ?? null;
    const previousRecycling = cached?.recycling ?? null;

    identityRecycleState.set(name, {
      dormant: isDormant,
      recycling: isRecycling,
      layer1RecyclingCached,
      jsonlPath,
      staleTailTickCount: nextStaleTailTickCount,
      lastPublishedFingerprint: fingerprint,
    });

    const state: SessionState = {
      hostId: host.id,
      tmuxSession: name,
      sessionId: "__dormant__",
      pid: null,
      status: "idle",
      waitingFor: undefined,
      backgroundTasks: [],
      updatedAt: deps.now(),
      lastMessageAt: null,
      aiTitle: null,
      dormant: isDormant,
      recycling: isRecycling,
    };
    deps.registry.publishSessionState(host.id, state);

    systemLogger.info("Fleet-status: source B frame published", {
      operation: "fleet_status_source_b_publish",
      fleetHostId: host.id,
      identityName: name,
      dormant: isDormant,
      recycling: isRecycling,
      previousDormant,
      previousRecycling,
    });

    // Phase 7 — arm log.
    if (isRecycling) {
      systemLogger.info("Fleet-status: recycling axis armed", {
        operation: "fleet_status_recycling_armed",
        fleetHostId: host.id,
        identityName: name,
        hasLivePid: liveTmuxSet.has(name),
        layer1: layer1RecyclingCached,
        requested: isRecycleRequested,
        sentinel: isRecycledAt,
        composed: isRecycling,
        cachedLayer1: cached?.layer1RecyclingCached ?? false,
        cachedRecycling: cached?.recycling ?? false,
        cachedDormant: cached?.dormant ?? false,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 92 — processPid split into fetch + compose helpers.
  //
  // The historical pre-Phase-92 processPid interleaved ~9-11 SSH exec calls
  // (RESEARCH.md A1..A12) with per-PID compose+publish+cache-write logic. That
  // interleaving prevented a batch-mode caller from reusing the compose stage
  // with pre-fetched values off the wire. Phase 92 splits the two phases at a
  // deliberate seam:
  //
  //   fetchPerPidState(hostState, pid, cached)
  //     → runs every SSH exec (A1-A12), no cache mutation, no publish.
  //     → returns a PerPidFetchedState struct of raw / minimally-processed
  //       values. Fail-open cache preservation happens in compose (see below).
  //
  //   composeAndPublishPerPid(hostState, pid, cached, isNew, fetched)
  //     → runs parseSessionJson, sessionIdRotation detection, all
  //       lastStopAt / activityMtime / stoppedMtime / lastMessageAt / aiTitle
  //       fail-open reconciliation, fingerprint delta, publish, cache-write,
  //       writeSessionFileCache. No SSH calls.
  //
  //   processPid(hostState, pid)
  //     → thin wrapper: fetch → compose. Byte-identical observable behavior
  //       to the pre-refactor function (verified by the existing 149-test
  //       vitest suite; new batch-vs-legacy parity coverage lands in Plan 05).
  //
  // The batch path (pollOneHostBatch) skips fetchPerPidState and constructs a
  // PerPidFetchedState directly from a SweepPidLine (schema alignment
  // documented in sweep-schema.ts SWEEP_FIELD_PARITY), then calls
  // composeAndPublishPerPid — driving byte-identical publish output as legacy.
  //
  // The single documented divergence: SWEEP_FIELD_PARITY.A3 skip. Sweep does
  // not emit the box-wide `last-stop-payload.json`; batch path passes
  // hookPayloadRaw=null, which flows through the existing perSessionUsable
  // fallback branch to trigger emitHookPayloadWarn if per-session A9 is also
  // absent. Legacy path preserves the A3 read + fallback verbatim.
  //
  // RESEARCH.md non-negotiables re-checked in this refactor:
  //   G5 (inFlight guard): unchanged — operates outside processPid.
  //   G6 (safe-char regex): applied caller-side in composeAndPublishPerPid
  //       through the derived-*/perSessionHookPayloadRaw guard checks; batch
  //       path additionally relies on Plan 02 server-side application. Belt-
  //       and-suspenders preserved.
  //   G7 (dual dormant reads): fetch produces freshDormant from A10; compose
  //       reads SweepPidLine.dormant_a in the batch path — both feed the same
  //       fail-open reconciliation and the same PidCacheEntry.dormant field.
  //   G8 (writeSessionFileCache): moved from mid-legacy to compose helper —
  //       fires in BOTH batch and legacy paths with the same shape.
  // ---------------------------------------------------------------------------

  /**
   * fetchPerPidState — runs the pre-Phase-92 A1..A12 exec fan-out for one PID.
   *
   * Zero cache mutation, zero publish, zero logging (except discovery logging
   * inherited from discoverIdentityJsonlPathViaChannel + getIdentityLastSend).
   * Returns a PerPidFetchedState struct that composeAndPublishPerPid consumes
   * to produce the identical observable behavior as the pre-refactor
   * processPid.
   *
   * Cache-awareness: fetch takes the `cached` entry so it can honour the same
   * per-PID cache-conditional exec skips the pre-refactor code used (tmux
   * resolution + jsonlPath discovery both skip when cached). This keeps the
   * exec count byte-identical to pre-Phase-92 on cache-hit ticks — a key
   * property the existing test suite asserts.
   */
  async function fetchPerPidState(
    hostState: PerHostState,
    pid: number,
    cached: PidCacheEntry | undefined,
  ): Promise<PerPidFetchedState> {
    const { channel } = hostState;

    // Kick off all parallel execs (A1 + A2 + A3)
    const sessionJsonPromise = channel.exec(
      `cat ~/.claude/sessions/${pid}.json`,
    );
    // Bounty 9c8d4a72 — readStatWithSentinel distinguishes SSH transport error
    // (fail-OPEN, keep session live this tick) from real /proc/<pid>/stat ENOENT
    // (reap). Prior code fed the null-on-transport-error return of channel.exec
    // directly to isStaleFromStat and reaped live sessions on sshd MaxSessions
    // saturation. See fix-wip-indicator-transport-vs-dead.md.
    const statPromise = readStatWithSentinel(channel, pid);
    const hookPayloadPromise = channel.exec(
      `cat ${hookPayloadPath} 2>/dev/null || true`,
    );

    // environ + tmux only for new PIDs (or PIDs with no cached tmuxSession)
    const isNew = cached === undefined;
    const needsTmuxResolution = isNew || cached?.tmuxSession === null;

    const [sessionJsonRaw, statResult, hookPayloadRaw] = await Promise.all([
      sessionJsonPromise,
      statPromise,
      hookPayloadPromise,
    ]);

    // If session JSON is missing/mid-write, short-circuit — compose will see
    // sessionJsonRaw === null and return early (no state to compute).
    if (sessionJsonRaw === null || sessionJsonRaw.trim() === "") {
      return {
        sessionJsonRaw,
        statResult,
        hookPayloadRaw,
        tmuxSession: cached?.tmuxSession ?? null,
        freshLastStopAt: null,
        freshActivityMtime: null,
        freshStoppedMtime: null,
        perSessionHookPayloadRaw: null,
        freshDormant: null,
        jsonlPath: cached?.jsonlPath ?? null,
        jsonlTail: null,
      };
    }

    // Parse just enough of session JSON to gate the per-session reads below.
    // The full parse happens again in compose (identical result) — this
    // matches the pre-refactor pattern where both the safe-char regex gate
    // AND the compose SessionState build read sessionJson.sessionId.
    const sessionJsonPreview = parseSessionJson(sessionJsonRaw);
    if (sessionJsonPreview === null) {
      return {
        sessionJsonRaw,
        statResult,
        hookPayloadRaw,
        tmuxSession: cached?.tmuxSession ?? null,
        freshLastStopAt: null,
        freshActivityMtime: null,
        freshStoppedMtime: null,
        perSessionHookPayloadRaw: null,
        freshDormant: null,
        jsonlPath: cached?.jsonlPath ?? null,
        jsonlTail: null,
      };
    }

    // A4 + A5 — resolve tmuxSession (PID → environ → pane → tmux session name)
    // Phase 44 Plan 02 — resolved EARLY so discovery (A11) below can key on
    // the identity name.
    let tmuxSession: string | null = cached?.tmuxSession ?? null;
    if (needsTmuxResolution) {
      tmuxSession = await resolvePidToTmuxSession(pid, {
        readEnviron: async (_pid) => {
          return channel.exec(`cat /proc/${pid}/environ`);
        },
        resolveTmuxName: async (pane) => {
          return channel.exec(
            `tmux display-message -p -t '${pane}' '#{session_name}'`,
          );
        },
      });
    }

    // A6 — Phase 59 per-session Stop file mtime.
    // Character-class discipline mirroring stop-hook.sh's write-side regex.
    // Any sessionId that would not have been accepted for a per-session write
    // must not be interpolated into a stat READ either — a `../` in sessionId
    // could otherwise stat a foreign file and publish its mtime as lastStopAt.
    // Shell-quoting alone is not enough — it prevents command injection but
    // still allows path traversal inside the argument.
    // (RESEARCH.md G6 belt-and-suspenders — same regex re-applied here.)
    let freshLastStopAt: number | null = null;
    if (/^[a-zA-Z0-9_-]+$/.test(sessionJsonPreview.sessionId)) {
      const quotedSessionId = shellSingleQuote(sessionJsonPreview.sessionId);
      const stopMtimeRaw = await channel.exec(
        `stat -c %Y ~/.claude/fleet-status/stop-${quotedSessionId}.json 2>/dev/null || true`,
      );
      if (stopMtimeRaw !== null && stopMtimeRaw.trim() !== "") {
        const parsed = parseInt(stopMtimeRaw.trim(), 10);
        if (Number.isFinite(parsed)) {
          freshLastStopAt = parsed * 1000;
        }
      }
    }

    // A7 — Phase 62 activity marker mtime.
    let freshActivityMtime: number | null = null;
    if (/^[a-zA-Z0-9_-]+$/.test(sessionJsonPreview.sessionId)) {
      const quotedSessionId = shellSingleQuote(sessionJsonPreview.sessionId);
      const activityMtimeRaw = await channel.exec(
        `stat -c %Y ~/.claude/fleet-status/hooks/${quotedSessionId}/activity 2>/dev/null || true`,
      );
      if (activityMtimeRaw !== null && activityMtimeRaw.trim() !== "") {
        const parsed = parseInt(activityMtimeRaw.trim(), 10);
        if (Number.isFinite(parsed)) {
          freshActivityMtime = parsed * 1000;
        }
      }
    }

    // A8 — Phase 62 stopped marker mtime.
    let freshStoppedMtime: number | null = null;
    if (/^[a-zA-Z0-9_-]+$/.test(sessionJsonPreview.sessionId)) {
      const quotedSessionId = shellSingleQuote(sessionJsonPreview.sessionId);
      const stoppedMtimeRaw = await channel.exec(
        `stat -c %Y ~/.claude/fleet-status/hooks/${quotedSessionId}/stopped 2>/dev/null || true`,
      );
      if (stoppedMtimeRaw !== null && stoppedMtimeRaw.trim() !== "") {
        const parsed = parseInt(stoppedMtimeRaw.trim(), 10);
        if (Number.isFinite(parsed)) {
          freshStoppedMtime = parsed * 1000;
        }
      }
    }

    // A9 — per-session Stop-hook payload.
    let perSessionHookPayloadRaw: string | null = null;
    if (/^[a-zA-Z0-9_-]+$/.test(sessionJsonPreview.sessionId)) {
      const quotedSessionId = shellSingleQuote(sessionJsonPreview.sessionId);
      perSessionHookPayloadRaw = await channel.exec(
        `cat ~/.claude/fleet-status/stop-${quotedSessionId}.json 2>/dev/null || true`,
      );
    }

    // A10 — source A dormant sentinel. Fail-open decoding: "yes" → true,
    // "no" → false, anything else (null / unexpected) → null and compose
    // preserves the cached value (T-52-01-01 mitigation).
    let freshDormant: boolean | null = null;
    if (tmuxSession !== null) {
      const quotedTmuxSession = shellSingleQuote(tmuxSession);
      const dormantRaw = await channel.exec(
        `stat ~/fleet/identities/${quotedTmuxSession}/.dormant 2>/dev/null >/dev/null && echo yes || echo no`,
      );
      if (dormantRaw !== null) {
        const trimmed = dormantRaw.trim();
        if (trimmed === "yes") freshDormant = true;
        else if (trimmed === "no") freshDormant = false;
      }
    }

    // A11 — Phase 32 discovery. Cached across ticks; discovery fires ONCE per
    // PID in the happy path.
    let jsonlPath: string | null = cached?.jsonlPath ?? null;
    if (tmuxSession !== null && jsonlPath === null) {
      jsonlPath = await discoverIdentityJsonlPathViaChannel(channel, tmuxSession);
    }

    // A12 — 256KB JSONL tail (for scanTailForLatestAiTitle in compose).
    let jsonlTail: string | null = null;
    if (jsonlPath !== null) {
      jsonlTail = await channel.exec(
        `tail -c 262144 ${jsonlPath} 2>/dev/null || true`,
      );
    }

    return {
      sessionJsonRaw,
      statResult,
      hookPayloadRaw,
      tmuxSession,
      freshLastStopAt,
      freshActivityMtime,
      freshStoppedMtime,
      perSessionHookPayloadRaw,
      freshDormant,
      jsonlPath,
      jsonlTail,
    };
  }

  /**
   * composeAndPublishPerPid — full downstream of processPid: parse, sessionId-
   * rotation detection, fail-open reconciliation, send-log lookup, fingerprint
   * delta, publish, cache write, writeSessionFileCache. Zero SSH calls (the
   * only await is a local send-log DB read).
   *
   * Byte-identical observable behavior to the pre-refactor processPid tail:
   * every branch, every mutation, every log op is preserved in order. Batch-
   * path callers synthesize the `fetched` struct from a SweepPidLine and drive
   * this same publish contract — parity guaranteed by shared code path.
   *
   * RESEARCH.md G8 — writeSessionFileCache fires HERE (compose layer, not
   * fetch) so both batch and legacy paths trigger it equally per tick.
   */
  async function composeAndPublishPerPid(
    hostState: PerHostState,
    pid: number,
    fetched: PerPidFetchedState,
  ): Promise<void> {
    const { host, livenessMap } = hostState;
    const cached = livenessMap.get(pid);
    const isNew = cached === undefined;

    // Parse session JSON — the sessionId + procStart drive downstream state
    // composition below. Phase 44 Plan 02: `cwd + sessionId` no longer drive
    // the JSONL path derivation.
    if (fetched.sessionJsonRaw === null || fetched.sessionJsonRaw.trim() === "") {
      // File may be in mid-write; skip this PID for this tick.
      return;
    }
    const sessionJson = parseSessionJson(fetched.sessionJsonRaw);
    if (sessionJson === null) {
      return;
    }

    const tmuxSession = fetched.tmuxSession;

    // A6 fail-open reconciliation — mirrors the pre-refactor
    // `let derivedLastStopAt = cached?.lastStopAt ?? null; if (…) …` shape.
    // Guard: fetch already gated the exec on the safe-char regex (G6); a
    // sessionId that failed the regex yields freshLastStopAt === null and
    // this branch preserves the cached value (fail-open in the safe
    // direction — indicator defaults to on when lastStopAt stays null).
    let derivedLastStopAt: number | null = cached?.lastStopAt ?? null;
    if (fetched.freshLastStopAt !== null) {
      derivedLastStopAt = fetched.freshLastStopAt;
    }

    // A7 fail-open reconciliation — Phase 62 activity mtime.
    let derivedActivityMtime: number | null = cached?.activityMtime ?? null;
    if (fetched.freshActivityMtime !== null) {
      derivedActivityMtime = fetched.freshActivityMtime;
    }

    // A8 fail-open reconciliation — Phase 62 stopped mtime.
    let derivedStoppedMtime: number | null = cached?.stoppedMtime ?? null;
    if (fetched.freshStoppedMtime !== null) {
      derivedStoppedMtime = fetched.freshStoppedMtime;
    }

    // -------------------------------------------------------------------------
    // Phase 59 Plan 02 — server-side status-delta tracking for the
    // lastStatusChangeAt axis. MUST NOT source from sessionJson.updatedAt
    // (Research § Common Pitfalls Pitfall 4).
    //
    // A PID whose sessionJson.sessionId has ROTATED since the previous poll
    // (Claude Code compaction/resume rotates sessionId in-place) is
    // effectively a fresh session for stop-gate purposes even though isNew is
    // false. Reset the three mtime axes back to null; the new sessionId's
    // per-session files may not exist yet.
    // -------------------------------------------------------------------------
    const sessionIdRotated =
      !isNew &&
      cached !== undefined &&
      cached.sessionId !== sessionJson.sessionId;
    if (sessionIdRotated) {
      derivedLastStopAt = null;
      derivedActivityMtime = null;
      derivedStoppedMtime = null;
    }

    let derivedLastStatusChangeAt: number;
    if (
      isNew ||
      sessionIdRotated ||
      cached?.lastStatus === null ||
      cached?.lastStatus === undefined
    ) {
      derivedLastStatusChangeAt = deps.now();
    } else if (cached.lastStatus !== sessionJson.status) {
      derivedLastStatusChangeAt = deps.now();
    } else {
      derivedLastStatusChangeAt = cached.lastStatusChangeAt;
    }

    // A10 fail-open reconciliation — dormant.
    let derivedDormant: boolean = cached?.dormant ?? false;
    if (fetched.freshDormant !== null) {
      derivedDormant = fetched.freshDormant;
    }

    // A11 — jsonlPath was resolved in fetch (either cache hit or fresh
    // discovery). Kept locally for the SessionState + cache-write below.
    const jsonlPath = fetched.jsonlPath;

    // Phase 85 (D-07) — lastMessageAt from identity-name-keyed send-log store.
    // Async local DB read (no SSH). Kept in compose so batch and legacy paths
    // hit the store identically per tick.
    let derivedLastMessageAt: number | null = cached?.lastMessageAt ?? null;
    let derivedAiTitle: string | null = cached?.aiTitle ?? null;
    const nextStaleTailTickCount = cached?.staleTailTickCount ?? 0;

    if (tmuxSession !== null) {
      try {
        const stored = await getIdentityLastSend(tmuxSession);
        systemLogger.debug(
          "Fleet-status: lastMessageAt derived from send-log store",
          {
            operation: "fleet_status_last_message_at_from_store",
            fleetHostId: host.id,
            identityName: tmuxSession,
            lookupResult: stored,
          },
        );
        if (stored !== null) {
          derivedLastMessageAt = stored;
        }
      } catch (err) {
        systemLogger.debug(
          "Fleet-status: getIdentityLastSend failed — keeping cached lastMessageAt",
          {
            operation: "fleet_status_send_log_lookup_failed",
            fleetHostId: host.id,
            identityName: tmuxSession,
            error: err instanceof Error ? err.message : "unknown",
          },
        );
      }
    }

    // A12 — scanTailForLatestAiTitle over the fetched jsonlTail (fail-open
    // preservation: null scan return preserves the cache).
    if (fetched.jsonlTail !== null && fetched.jsonlTail.trim() !== "") {
      const scannedAiTitle = scanTailForLatestAiTitle(fetched.jsonlTail);
      if (scannedAiTitle !== null) {
        derivedAiTitle = scannedAiTitle;
      }
    }

    // Liveness check — bounty 9c8d4a72: branch on the tagged statResult BEFORE
    // calling isStaleFromStat so SSH transport errors never trigger a reap.
    if (
      !fetched.statResult.ok &&
      (fetched.statResult as Extract<StatReadResult, { ok: false }>).reason === "transport"
    ) {
      systemLogger.debug(
        "Fleet-status: stat read transport error — skipping stale check this tick",
        {
          operation: "fleet_status_stat_transport_skip",
          fleetHostId: host.id,
          pid,
          sessionId: sessionJson.sessionId,
        },
      );
    } else {
      const statContents = fetched.statResult.ok ? fetched.statResult.content : null;
      const stale = isStaleFromStat(sessionJson.procStart, statContents);
      if (stale) {
        const entry = livenessMap.get(pid);
        const entryTmuxSession = entry?.tmuxSession ?? tmuxSession;
        const sessionId = entry?.sessionId ?? sessionJson.sessionId;
        systemLogger.info("Fleet-status: session stale — publishing gone", {
          operation: "fleet_status_stale_reap",
          fleetHostId: host.id,
          pid,
          sessionId,
        });
        deps.registry.publishSessionGone(host.id, entryTmuxSession, sessionId);
        livenessMap.delete(pid);
        return;
      }
    }

    // Fix (quick-260829-kmr): per-session preferred, box-wide fallback, both-
    // missing → warn once. Batch path passes hookPayloadRaw=null (SWEEP_FIELD_
    // PARITY.A3 skip), so the fallback is a no-op there — matches the schema-
    // designer intent. Legacy path preserves the A3 fallback verbatim.
    let backgroundTasks: SessionState["backgroundTasks"] = [];
    const perSessionUsable =
      fetched.perSessionHookPayloadRaw !== null &&
      fetched.perSessionHookPayloadRaw.trim() !== "";
    const selectedHookPayloadRaw: string | null = perSessionUsable
      ? fetched.perSessionHookPayloadRaw
      : fetched.hookPayloadRaw;
    const isHookPayloadMissing =
      selectedHookPayloadRaw === null || selectedHookPayloadRaw.trim() === "";

    if (!isHookPayloadMissing) {
      const payload = parseStopHookPayload(selectedHookPayloadRaw!);
      if (payload !== null) {
        backgroundTasks = filterAmbientTasks(payload.background_tasks);
      } else {
        emitHookPayloadWarn(hostState, host.id);
      }
    } else {
      emitHookPayloadWarn(hostState, host.id);
    }

    // Phase 55 Plan 02 (RESEARCH G8) — publish resolved sessionFile to the
    // shared session-file cache. Sits in COMPOSE (not fetch) so BOTH batch
    // and legacy paths trigger the write identically per tick — a non-
    // negotiable of Phase 92.
    if (jsonlPath !== null && tmuxSession !== null) {
      writeSessionFileCache(host.id, tmuxSession, { sessionFile: jsonlPath, pid });
    }

    // Compose SessionState — same shape as pre-refactor processPid.
    const state: SessionState = {
      hostId: host.id,
      tmuxSession,
      sessionId: sessionJson.sessionId,
      pid,
      status: sessionJson.status,
      waitingFor:
        sessionJson.status === "waiting" ? sessionJson.waitingFor : undefined,
      backgroundTasks,
      updatedAt: sessionJson.updatedAt,
      lastMessageAt: derivedLastMessageAt,
      aiTitle: derivedAiTitle,
      dormant: derivedDormant,
      // inline-260830-source-a-omit-recycling: recycling field OMITTED on
      // source A frames. Source B is the sole recycling authority.
      lastStopAt: derivedLastStopAt,
      lastStatusChangeAt: derivedLastStatusChangeAt,
      activityMtime: derivedActivityMtime,
      stoppedMtime: derivedStoppedMtime,
    };

    // Delta semantics — only publish if fingerprint changed.
    const newFingerprint = computeFingerprint(state);
    const lastFingerprint = livenessMap.get(pid)?.lastPublishedFingerprint;

    if (newFingerprint !== lastFingerprint) {
      deps.registry.publishSessionState(host.id, state);
      systemLogger.info("Fleet-status: session state published", {
        operation: "fleet_status_session_state_published",
        fleetHostId: host.id,
        pid,
        sessionId: sessionJson.sessionId,
        status: sessionJson.status,
        dormant: state.dormant,
        lastStopAt: state.lastStopAt,
        lastStatusChangeAt: state.lastStatusChangeAt,
        activityMtime: state.activityMtime,
        stoppedMtime: state.stoppedMtime,
      });
      livenessMap.set(pid, {
        sessionId: sessionJson.sessionId,
        tmuxSession,
        procStart: sessionJson.procStart,
        lastPublishedFingerprint: newFingerprint,
        lastMessageAt: derivedLastMessageAt,
        aiTitle: derivedAiTitle,
        jsonlPath,
        staleTailTickCount: nextStaleTailTickCount,
        dormant: derivedDormant,
        lastStatus: sessionJson.status,
        lastStatusChangeAt: derivedLastStatusChangeAt,
        lastStopAt: derivedLastStopAt,
        activityMtime: derivedActivityMtime,
        stoppedMtime: derivedStoppedMtime,
      });
    } else {
      // Update procStart + tmux + fresh derivations in case they changed
      // without a state-change (Research § Pitfall 3 — every axis MUST be
      // stamped on both branches so the cache stays lockstep with derivation).
      livenessMap.set(pid, {
        ...(livenessMap.get(pid) as PidCacheEntry),
        procStart: sessionJson.procStart,
        tmuxSession,
        lastPublishedFingerprint: newFingerprint,
        lastMessageAt: derivedLastMessageAt,
        aiTitle: derivedAiTitle,
        jsonlPath,
        staleTailTickCount: nextStaleTailTickCount,
        dormant: derivedDormant,
        lastStatus: sessionJson.status,
        lastStatusChangeAt: derivedLastStatusChangeAt,
        lastStopAt: derivedLastStopAt,
        activityMtime: derivedActivityMtime,
        stoppedMtime: derivedStoppedMtime,
      });
    }
  }

  /**
   * processPid — legacy path entry point. Thin wrapper: fetch → compose.
   *
   * Observable behavior is byte-identical to the pre-refactor processPid.
   * The existing 149-test vitest suite is the parity oracle — any behavioral
   * drift here surfaces as a test failure.
   */
  async function processPid(
    hostState: PerHostState,
    pid: number,
  ): Promise<void> {
    const cached = hostState.livenessMap.get(pid);
    const fetched = await fetchPerPidState(hostState, pid, cached);
    await composeAndPublishPerPid(hostState, pid, fetched);
  }

  // ---------------------------------------------------------------------------
  // Rate-limited hook-payload warn
  // ---------------------------------------------------------------------------

  function emitHookPayloadWarn(hostState: PerHostState, hostId: string): void {
    const now = deps.now();
    if (now - hostState.lastHookWarnAt >= hookPayloadWarnCooldownMs) {
      hostState.lastHookWarnAt = now;
      systemLogger.warn(
        "Fleet-status: Stop-hook payload file missing/empty/malformed — treating backgroundTasks as []",
        {
          operation: "fleet_status_hook_payload_missing",
          fleetHostId: hostId,
        },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Poll all hosts
  // ---------------------------------------------------------------------------

  async function pollAllHosts(): Promise<void> {
    if (stopped) return;

    pollTickCount++;

    // Periodically refresh the identity-host list
    if (pollTickCount % hostRefreshEveryNTicks === 0) {
      try {
        const freshHosts = await deps.listIdentityHostingHosts();
        // Add-branch: acquire channels for hosts that appeared in the fresh
        // list but aren't tracked yet.
        for (const host of freshHosts) {
          if (!perHostState.has(host.id)) {
            await tryAcquireHostChannel(host);
          }
        }
        // Evict-branch (quick-260820-tm0): hosts in perHostState but absent
        // from freshHosts (e.g. admin-disabled `enable_ssh=false`) must be
        // pruned — close the SSH channel via deps.releaseSshChannel, drop
        // the entry, and clean up the paired inFlight/skipCount entries
        // added by Task 1's per-host in-flight guard. Eviction runs INSIDE
        // the same try that wraps listIdentityHostingHosts() — a rejected
        // refresh preserves perHostState intact (a transient DB blip must
        // NOT wipe the poll rotation).
        const freshIds = new Set(freshHosts.map((h) => h.id));
        for (const [hostId, hostState] of perHostState.entries()) {
          if (freshIds.has(hostId)) continue;
          systemLogger.info(
            "Fleet-status: evicting host no longer in identity-host list",
            {
              operation: "fleet_status_host_evicted",
              fleetHostId: hostState.host.id,
              hostName: hostState.host.name,
              reason: "no longer in identity-host list",
            },
          );
          try {
            deps.releaseSshChannel(hostState.host, hostState.channel);
          } catch {
            // best-effort release, mirrors the stop() defensive pattern
          }
          perHostState.delete(hostId);
          // Paired cleanup for Task 1's in-flight guard structures. If this
          // host is re-added later, skipCount must not carry a stale count.
          inFlight.delete(hostId);
          skipCount.delete(hostId);
        }
      } catch (err) {
        systemLogger.warn("Fleet-status: identity-host list refresh failed", {
          operation: "fleet_status_host_list_refresh_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }

    // Poll each known host (quick-260820-tm0: per-host in-flight guard —
    // skip hosts whose prior tick's pollOneHost has not yet resolved).
    for (const hostState of perHostState.values()) {
      const hostId = hostState.host.id;
      if (inFlight.has(hostId)) {
        const nextSkip = (skipCount.get(hostId) ?? 0) + 1;
        skipCount.set(hostId, nextSkip);
        systemLogger.info(
          "Fleet-status: poll skipped — prior tick still in flight",
          {
            operation: "fleet_status_poll_skipped_inflight",
            fleetHostId: hostId,
            hostName: hostState.host.name,
            skipCount: nextSkip,
            tick: pollTickCount,
          },
        );
        continue;
      }
      inFlight.add(hostId);
      skipCount.set(hostId, 0);
      try {
        await pollOneHost(hostState);
      } catch (err) {
        systemLogger.warn("Fleet-status: poll error for host", {
          operation: "fleet_status_poll_error",
          fleetHostId: hostState.host.id,
          error: err instanceof Error ? err.message : "unknown",
        });
      } finally {
        // Release the guard on BOTH happy-path return and thrown errors.
        // Never leak a stuck in-flight flag (would silently freeze polls
        // for this hostId forever). See Task 2 (quick-260820-tm0) for the
        // paired eviction cleanup: inFlight.delete + skipCount.delete for
        // evicted hostIds happens in the refresh block below.
        inFlight.delete(hostId);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Try to acquire an SSH channel for a host (fail-open)
  // ---------------------------------------------------------------------------

  async function tryAcquireHostChannel(host: HostRecord): Promise<void> {
    try {
      const channel = await deps.acquireSshChannel(host);
      if (channel === null) {
        systemLogger.warn("Fleet-status: SSH channel unavailable for host", {
          operation: "fleet_status_host_ssh_unreachable",
          fleetHostId: host.id,
          hostName: host.name,
        });
        return;
      }

      perHostState.set(host.id, {
        host,
        channel,
        livenessMap: new Map(),
        lastHookWarnAt: -Infinity,
        // quick-260823-73o — source B per-identity cache (replaces the prior
        // Phase 52 T3 dormantOnlyIdentities map). Populated by
        // pollDormantOnlyIdentities on each tick with the full 3-axis pipeline
        // state per identity.
        identityRecycleState: new Map(),
        // Phase 92 — sweep-first / legacy-fallback dispatch cache. All three
        // fields are per-SSH-channel-lifetime: reset when pollOneHost sees a
        // fresh channel object reference (see PerHostState docblock above).
        sweepScriptPresent: null,
        sweepSchemaMismatchThisConnection: false,
        lastProbeChannelRef: null,
      });
    } catch (err) {
      systemLogger.warn("Fleet-status: SSH channel acquire threw for host", {
        operation: "fleet_status_host_ssh_unreachable",
        fleetHostId: host.id,
        hostName: host.name,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 30s stale sweep
  // ---------------------------------------------------------------------------

  async function sweepAllHostsForStalePids(): Promise<void> {
    if (stopped) return;

    systemLogger.info("Fleet-status: stale sweep running", {
      operation: "fleet_status_sweep_run",
      hostCount: perHostState.size,
    });

    for (const hostState of perHostState.values()) {
      try {
        await sweepOneHost(hostState);
      } catch (err) {
        systemLogger.warn("Fleet-status: sweep error for host", {
          operation: "fleet_status_sweep_error",
          fleetHostId: hostState.host.id,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }
  }

  async function sweepOneHost(hostState: PerHostState): Promise<void> {
    const { host, channel, livenessMap } = hostState;

    for (const [pid, entry] of livenessMap.entries()) {
      try {
        // Bounty 9c8d4a72 — see readStatWithSentinel docblock. Transport failure
        // on this stat read must NOT reap the entry (fail-OPEN, sweep the rest
        // of the PIDs); real ENOENT + field22 mismatch still reap as before.
        const statResult = await readStatWithSentinel(channel, pid);
        // Same Extract cast rationale as line 1645 — see the comment there.
        if (!statResult.ok && (statResult as Extract<StatReadResult, { ok: false }>).reason === 'transport') {
          systemLogger.debug(
            "Fleet-status: sweep stat read transport error — skipping reap this sweep",
            {
              operation: "fleet_status_sweep_stat_transport_skip",
              fleetHostId: host.id,
              pid,
              sessionId: entry.sessionId,
            },
          );
          continue;
        }
        const statContents = statResult.ok ? statResult.content : null;
        const stale = isStaleFromStat(entry.procStart, statContents);
        if (stale) {
          systemLogger.info(
            "Fleet-status: stale sweep reaped PID",
            {
              operation: "fleet_status_stale_reap",
              fleetHostId: host.id,
              pid,
              sessionId: entry.sessionId,
            },
          );
          deps.registry.publishSessionGone(
            host.id,
            entry.tmuxSession,
            entry.sessionId,
          );
          livenessMap.delete(pid);
        }
      } catch (err) {
        systemLogger.warn("Fleet-status: sweep stat read error", {
          operation: "fleet_status_sweep_stat_error",
          fleetHostId: host.id,
          pid,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    async start(): Promise<void> {
      stopped = false;

      // Query identity-hosting hosts from DB
      let initialHosts: HostRecord[] = [];
      try {
        initialHosts = await deps.listIdentityHostingHosts();
      } catch (err) {
        systemLogger.warn("Fleet-status: initial identity-host query failed", {
          operation: "fleet_status_host_list_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
      }

      // Acquire SSH channels for each host
      for (const host of initialHosts) {
        await tryAcquireHostChannel(host);
      }

      // Fire an immediate first poll (don't wait for the first interval tick)
      await pollAllHosts();

      // Set up 2s poll timer.
      // fn returns Promise so tests can capture and await it directly.
      pollTimer = deps.setInterval(pollAllHosts, pollIntervalMs);

      // Set up 30s stale sweep timer.
      sweepTimer = deps.setInterval(sweepAllHostsForStalePids, staleSweepIntervalMs);

      systemLogger.info("Fleet-status orchestrator started", {
        operation: "fleet_status_orchestrator_started",
        identityHostCount: initialHosts.length,
        channelCount: perHostState.size,
        pollIntervalMs,
        staleSweepIntervalMs,
      });
    },

    stop(): void {
      stopped = true;

      if (pollTimer !== null) {
        deps.clearInterval(pollTimer);
        pollTimer = null;
      }

      if (sweepTimer !== null) {
        deps.clearInterval(sweepTimer);
        sweepTimer = null;
      }

      // Release all SSH channels
      for (const hostState of perHostState.values()) {
        try {
          deps.releaseSshChannel(hostState.host, hostState.channel);
        } catch {
          // best-effort release
        }
      }
      perHostState.clear();

      systemLogger.info("Fleet-status orchestrator stopped", {
        operation: "fleet_status_orchestrator_stopped",
      });
    },

    getPollTickCount(): number {
      return pollTickCount;
    },
  };
}
