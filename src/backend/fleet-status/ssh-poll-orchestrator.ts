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
 * ## Fail-open on missing hook payload file (Ashley 2026-08-13 LOCKED)
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
import { parseSessionLine } from "../claude-session/session-file-parser.js";
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

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/**
 * Thin SSH exec wrapper — one per identity-hosting host for the life of
 * the orchestrator. Returns null on any SSH-side error (never throws).
 */
export interface SshChannel {
  exec(command: string): Promise<string | null>;
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
}

export interface SshPollOrchestrator {
  start(): Promise<void>;
  stop(): void;
  getPollTickCount(): number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

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
  // dormant sentinel stat (`stat ~/.claude/identities/'<tmuxSession>'/.dormant
  // 2>/dev/null >/dev/null && echo yes || echo no`). Trimmed stdout "yes" →
  // true; "no" → false; anything else (null, throw, unexpected output) →
  // fail-open using this cached value (defaults to `false` on cold-start).
  // The dormant axis participates in computeFingerprint so a dormant-only
  // flip publishes a new frame (delta detection is per-axis). Fail-open
  // preservation matches lastMessageAt / aiTitle patterns — transient SSH
  // hiccups do NOT flip a valid dormant reading.
  dormant: boolean;
  // Phase 53 Plan 01 — cached derived boolean result of the source A recycling
  // sentinel stat (`stat ~/.claude/identities/'<tmuxSession>'/.recycled-at
  // 2>/dev/null >/dev/null && echo yes || echo no`). Same semantics as the
  // dormant field above: trimmed stdout "yes" → true; "no" → false; anything
  // else → fail-open to this cached value (default `false` on cold start).
  // Participates in computeFingerprint as its own axis so a recycling-only flip
  // publishes a new frame. No source B needed — the caretaker's sentinel is held
  // for the full recycle window while a live claude PID exists, so per-PID
  // source A coverage is sufficient (see Phase 53 RESEARCH § Assumption A1).
  recycling: boolean;
}

interface PerHostState {
  host: HostRecord;
  channel: SshChannel;
  livenessMap: Map<number, PidCacheEntry>;
  lastHookWarnAt: number;
  // Phase 52 Plan 01 Task 3 — source B fingerprint-suppression cache.
  // Phase 53 code-review C2/C3 (2026-08-21): widened from Map<name, dormant>
  // to Map<name, {dormant, recycling}> so source B covers BOTH axes for
  // identities with no live PID. This closes the gap where the outgoing
  // claude PID exits during a recycle: source A stops publishing for that
  // key, and until Phase 53 CR the registry blanked the recycling axis on
  // subsequent source-B dormant frames (C3) AND fresh browser snapshots
  // during the PID-vanish window saw the identity as not-recycling (C2).
  // Now source B stats `.recycled-at` alongside `.dormant` on every tick.
  // Publish/suppress fires when EITHER axis changes vs cache. Cache is
  // cleared when the identity acquires a live PID (source A takes over).
  dormantOnlyIdentities: Map<string, { dormant: boolean; recycling: boolean }>;
}

// ---------------------------------------------------------------------------
// Phase 41 Plan 03 — JSONL path + message-bearing kind set
// ---------------------------------------------------------------------------

/**
 * Message-bearing JSONL kinds per session-file-parser.ts. These are the ONLY
 * kinds that advance `lastMessageAt` (Ashley 2026-08-14 lock: "activity =
 * message either direction, and only that"). tool_use, thinking, streaming
 * ticks, lifecycle events, and background-task starts/stops all parse to
 * `kind: "skip"` or `kind: "malformed"` and are excluded.
 *
 * The four kinds map to:
 *   - "message":         real user OR assistant textual turn (either direction)
 *   - "image":           an image-bearing turn (either direction; role includes tool_result)
 *   - "relay_outbound":  an assistant Matrix relay send (Phase 17 shape)
 *   - "relay_inbound":   a user task-notification carrying a Matrix relay message body
 *
 * "image" with role "tool_result" is INCLUDED — a tool result that returns
 * an image constitutes a message-bearing frame in the pretty-view sense (the
 * user sees an image bubble). This is the conservative choice; if it proves
 * noisy in practice the filter can tighten to role in {"user","assistant"} only.
 */
const MESSAGE_BEARING_KINDS = new Set([
  "message",
  "image",
  "relay_outbound",
  "relay_inbound",
]);

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
 * Parse a JSONL blob (the raw stdout of a `tail -n N <jsonl-path>` exec)
 * and return the newest message-bearing `ts` (unix millis) found across all
 * lines, or null if no line qualified. Empty lines and malformed lines are
 * skipped silently — this is a best-effort sample, not a validation pass.
 *
 * This runs on EVERY poll tick per PID; the cost is bounded by the tail
 * width (Phase 47 Plan 02: `tail -c 262144` — 256KB; per Phase 47 CONTEXT.md
 * § Backend scraper mechanics — bounded parse well under 5ms on typical
 * hardware).
 * Session-file-parser's parseSessionLine already handles the harness quirks
 * (queued_command attachments, wrapper-only turns, tool_result vs. bare
 * image role derivation, etc.) — this function stays agnostic to those
 * details and just filters on the returned kind.
 */
function scanTailForNewestMessageAt(tailContents: string): number | null {
  let newest: number | null = null;
  const lines = tailContents.split("\n");
  for (const line of lines) {
    if (line.trim() === "") continue;
    const parsed = parseSessionLine(line);
    if (!MESSAGE_BEARING_KINDS.has(parsed.kind)) continue;
    // At this point parsed.kind ∈ MESSAGE_BEARING_KINDS which all carry a `ts`
    // numeric field (see session-file-parser.ts types).
    const ts = (parsed as { ts: number }).ts;
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
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
  return `${state.status}|${state.waitingFor ?? ""}|${bgKey}|${state.updatedAt}|${state.lastMessageAt ?? ""}|${state.aiTitle ?? ""}|${state.dormant === true ? "1" : state.dormant === false ? "0" : ""}|${state.recycling === true ? "1" : state.recycling === false ? "0" : ""}`;
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
  // Poll one host
  // ---------------------------------------------------------------------------

  async function pollOneHost(hostState: PerHostState): Promise<void> {
    const { host, channel } = hostState;

    systemLogger.info("Fleet-status poll start", {
      operation: "fleet_status_poll_start",
      fleetHostId: host.id,
      tick: pollTickCount,
    });

    // (a) Enumerate session-JSON files
    const listing = await channel.exec(
      "ls -1 ~/.claude/sessions/*.json 2>/dev/null || true",
    );

    if (listing === null) {
      systemLogger.warn("Fleet-status: ls of sessions dir returned null (SSH error)", {
        operation: "fleet_status_host_ssh_unreachable",
        fleetHostId: host.id,
      });
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

    // (c) Phase 52 Plan 01 Task 3 — source B: enumerate ~/.claude/identities/
    //     for dormant-only identities that have NO live claude PID this tick
    //     and publish SessionState frames for them. Built from the current
    //     livenessMap AFTER source A's Promise.all completes so that identities
    //     with live PIDs are properly excluded.
    //
    //     liveTmuxSet reflects genuinely-live-this-tick tmuxSessions because
    //     source A's stale-reap path (isStaleFromStat) deletes reaped PID
    //     entries from livenessMap before this point. Any lingering entry has
    //     a live PID in the current tick.
    const liveTmuxSet = new Set<string>();
    for (const entry of hostState.livenessMap.values()) {
      if (entry.tmuxSession !== null) {
        liveTmuxSet.add(entry.tmuxSession);
      }
    }
    await pollDormantOnlyIdentities(hostState, liveTmuxSet);

    systemLogger.info("Fleet-status poll end", {
      operation: "fleet_status_poll_end",
      fleetHostId: host.id,
      tick: pollTickCount,
      pidCount: pidNumbers.length,
    });
  }

  // ---------------------------------------------------------------------------
  // Phase 52 Plan 01 Task 3 — source B: dormant-only identity enumeration
  //
  // For each host per tick, list ~/.claude/identities/ and stat each identity's
  // .dormant sentinel. For any identity whose folder has the sentinel present
  // AND does NOT have a live claude PID (not in liveTmuxSet), publish a
  // SessionState frame keyed by the identity name as tmuxSession, with:
  //   - sessionId: "__dormant__" (synthetic sentinel — frontend treats opaque)
  //   - pid: null (source A publishes numeric PIDs)
  //   - status: "idle" (dormant identities have no live claude process)
  //   - dormant: true (per stat result)
  //
  // Fingerprint-suppress via dormantOnlyIdentities per-host cache. Cache
  // eviction on live-set membership: if an identity gains a live PID between
  // ticks, source A takes over publishing for it and source B clears the cache
  // entry so a future transition back to no-live-PID re-publishes cleanly.
  //
  // Fail-open: if `ls` returns null (SSH error) or empty (no identities dir),
  // log a debug and skip source B for this tick. Source A still fires normally.
  //
  // Parallelism: per-identity stats run via Promise.all (T-52-01-05 accept:
  // bounded by identity count in the low tens per host on Ashley's fleet).
  //
  // Shell-quoting via shellSingleQuote (T-52-01-02 mitigation): identity names
  // from `ls` output are attacker-controlled (a compromised host could name
  // an identity `; rm -rf $HOME`), so each stat command interpolates the
  // FULL quoted argument returned by shellSingleQuote — cannot escape.
  // ---------------------------------------------------------------------------

  async function pollDormantOnlyIdentities(
    hostState: PerHostState,
    liveTmuxSet: Set<string>,
  ): Promise<void> {
    const { host, channel, dormantOnlyIdentities } = hostState;

    // Enumerate identity folders
    const listing = await channel.exec(
      "ls -1 ~/.claude/identities/ 2>/dev/null || true",
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

    // Phase 53 CR C2/C3 (2026-08-21): parallel-stat BOTH sentinels for each
    // identity — `.dormant` (Phase 52) and `.recycled-at` (Phase 53).
    // Bounded by identity count per host (typically <20); 2x stat calls per
    // identity is still trivial vs the 30s SSH channel keepalive budget.
    const statResults = await Promise.all(
      identityNames.map(async (name) => {
        const quotedName = shellSingleQuote(name);
        const [dormantOut, recyclingOut] = await Promise.all([
          channel.exec(
            `stat ~/.claude/identities/${quotedName}/.dormant 2>/dev/null >/dev/null && echo yes || echo no`,
          ),
          channel.exec(
            `stat ~/.claude/identities/${quotedName}/.recycled-at 2>/dev/null >/dev/null && echo yes || echo no`,
          ),
        ]);
        // T-52-01-01 mitigation (applies to both axes): only "yes" or "no"
        // are meaningful. Anything else (null, unexpected output) → treat as
        // false since source B has no prior cache to fall back to for this
        // specific identity — it's cache-populated per-tick.
        const isDormant = dormantOut !== null && dormantOut.trim() === "yes";
        const isRecycling =
          recyclingOut !== null && recyclingOut.trim() === "yes";
        return { name, isDormant, isRecycling };
      }),
    );

    // For each identity: publish/suppress based on cache + live-set membership.
    for (const { name, isDormant, isRecycling } of statResults) {
      // Skip identities that had a live PID this tick — source A already
      // published for them (with source A's own dormant + recycling stats).
      // Also clear the source-B cache for this name so a future transition
      // back to no-live-PID re-publishes cleanly (Test P52-01-T3-vii).
      if (liveTmuxSet.has(name)) {
        dormantOnlyIdentities.delete(name);
        continue;
      }

      const previous = dormantOnlyIdentities.get(name);
      if (
        previous !== undefined &&
        previous.dormant === isDormant &&
        previous.recycling === isRecycling
      ) {
        // Cache hit — BOTH axes match → fingerprint-suppress (no publish).
        continue;
      }

      dormantOnlyIdentities.set(name, {
        dormant: isDormant,
        recycling: isRecycling,
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

      systemLogger.info(
        "Fleet-status: source B dormant-only frame published",
        {
          operation: "fleet_status_source_b_publish",
          fleetHostId: host.id,
          identityName: name,
          dormant: isDormant,
          recycling: isRecycling,
          previousDormant: previous?.dormant ?? null,
          previousRecycling: previous?.recycling ?? null,
        },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Process one PID within a poll cycle
  // ---------------------------------------------------------------------------

  async function processPid(
    hostState: PerHostState,
    pid: number,
  ): Promise<void> {
    const { host, channel, livenessMap } = hostState;
    const isNew = !livenessMap.has(pid);

    // Kick off all parallel execs
    const sessionJsonPromise = channel.exec(
      `cat ~/.claude/sessions/${pid}.json`,
    );
    const statPromise = channel.exec(`cat /proc/${pid}/stat`);
    const hookPayloadPromise = channel.exec(`cat ${hookPayloadPath} 2>/dev/null || true`);

    // environ + tmux only for new PIDs (or PIDs with no cached tmuxSession)
    const cached = livenessMap.get(pid);
    const needsTmuxResolution = isNew || cached?.tmuxSession === null;

    const [sessionJsonRaw, statContents, hookPayloadRaw] = await Promise.all([
      sessionJsonPromise,
      statPromise,
      hookPayloadPromise,
    ]);

    // Parse session JSON — the sessionId + procStart drive downstream state
    // composition below. Phase 44 Plan 02: `cwd + sessionId` no longer drive
    // the JSONL path derivation (see discovery block further down).
    if (sessionJsonRaw === null || sessionJsonRaw.trim() === "") {
      // File may be in mid-write; skip this PID for this tick
      return;
    }

    const sessionJson = parseSessionJson(sessionJsonRaw);
    if (sessionJson === null) {
      return;
    }

    // Phase 44 Plan 02 — resolve tmuxSession EARLIER in the pipeline so it
    // is available for the discovery call below. Discovery needs the
    // identity name (== tmux session name on this fleet) to grep for the
    // /id-first-turn record; the previous ordering (tmux resolution AFTER
    // the tail-scan) can't feed that dependency without an extra tick of
    // latency on cold-cache. The `needsTmuxResolution` gate is unchanged
    // — cached-non-null tmuxSession skips the environ + tmux round-trips.
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

    // Phase 52 Plan 01 Task 2 — source A dormant sentinel stat.
    // Per PID-tick, when tmuxSession is non-null, stat the
    // `~/.claude/identities/<tmuxSession>/.dormant` sentinel file. Trimmed
    // stdout "yes" → dormant true; "no" → dormant false; anything else
    // (null from SSH error, throw, unexpected output) → fail-open using
    // cached value (defaulting to `false` on cold start).
    //
    // Shell-quoting via shellSingleQuote (T-52-01-02 mitigation): the helper
    // returns the FULL quoted argument (e.g. `shellSingleQuote("tina")` →
    // `'tina'`) so it is interpolated WITHOUT surrounding template quotes.
    // Attacker-controlled tmuxSession values containing quotes/backticks
    // cannot escape the single-quoted argument (shellSingleQuote replaces
    // `'` → `'\''` inside the quoted region).
    //
    // Skipped when tmuxSession is null (identity name unknown) — use cache
    // (default false on cold start).
    //
    // The dormant axis is DISTINCT from the JSONL tail-scan below: source A
    // stats the identity folder directly, not the session JSONL. Cached in
    // PidCacheEntry.dormant and participates in computeFingerprint so a
    // dormant-only flip publishes a new frame (delta detection is per-axis).
    let derivedDormant: boolean = cached?.dormant ?? false;
    if (tmuxSession !== null) {
      const quotedTmuxSession = shellSingleQuote(tmuxSession);
      const dormantRaw = await channel.exec(
        `stat ~/.claude/identities/${quotedTmuxSession}/.dormant 2>/dev/null >/dev/null && echo yes || echo no`,
      );
      if (dormantRaw !== null) {
        const trimmed = dormantRaw.trim();
        if (trimmed === "yes") {
          derivedDormant = true;
        } else if (trimmed === "no") {
          derivedDormant = false;
        }
        // Anything else → fail-open, keep cached value (T-52-01-01 mitigation).
      }
      // dormantRaw === null → SSH hiccup → keep cached value (fail-open).
    }

    // Phase 53 Plan 01 — source A recycling sentinel stat.
    // Per PID-tick, when tmuxSession is non-null, stat the
    // `~/.claude/identities/<tmuxSession>/.recycled-at` sentinel file. Trimmed
    // stdout "yes" → recycling true; "no" → recycling false; anything else
    // (null from SSH error, throw, unexpected output) → fail-open using
    // cached value (defaulting to `false` on cold start). Same T-52-01-02
    // shell-quoting mitigation via shellSingleQuote as the dormant stat above.
    // Same T-53-01-01 fail-open mitigation on stdout parsing. No source B —
    // the caretaker's sentinel is placed while the outgoing PID is still alive
    // and held for 8s past the fresh PID being up, so the 2s poll cadence
    // guarantees source A visibility across the entire recycle window
    // (see Phase 53 RESEARCH § Assumption A1).
    let derivedRecycling: boolean = cached?.recycling ?? false;
    if (tmuxSession !== null) {
      const quotedTmuxSession = shellSingleQuote(tmuxSession);
      const recyclingRaw = await channel.exec(
        `stat ~/.claude/identities/${quotedTmuxSession}/.recycled-at 2>/dev/null >/dev/null && echo yes || echo no`,
      );
      if (recyclingRaw !== null) {
        const trimmed = recyclingRaw.trim();
        if (trimmed === "yes") {
          derivedRecycling = true;
        } else if (trimmed === "no") {
          derivedRecycling = false;
        }
        // Anything else → fail-open, keep cached value (T-53-01-01 mitigation).
      }
      // recyclingRaw === null → SSH hiccup → keep cached value (fail-open).
    }

    // Phase 44 Plan 02 — replace jsonlPathForSession derivation with
    // discoverIdentityJsonlPathViaChannel (Phase 32 mechanism + SshChannel
    // adapter). The Phase 41 Plan 03 `cwd + sessionId` construction was
    // fragile against cwd drift and Claude Code sessionId rotation on
    // compaction/resume — a live session could silently point at a stale
    // JSONL that had stopped growing. The Phase 32 byte-pattern discovery
    // walks `~/.claude/projects/*​/` mtime-descending and returns the newest
    // JSONL whose first user-role line matches `/id <tmuxSession>`, which
    // is stable across compaction + resume events.
    //
    // Cache the resolved path in PidCacheEntry.jsonlPath so subsequent ticks
    // skip discovery entirely — discovery fires ONCE per PID in the happy
    // path. Rediscover on stale-tail threshold (against a NON-NULL cached
    // lastMessageAt only — see 44-CONTEXT.md § ssh-poll-orchestrator.ts
    // swap for the tightened stale-tick condition rationale). If
    // tmuxSession is null (identity name unknown), skip discovery this
    // tick and keep the cached-or-null path.
    let jsonlPath: string | null = cached?.jsonlPath ?? null;
    if (tmuxSession !== null && jsonlPath === null) {
      jsonlPath = await discoverIdentityJsonlPathViaChannel(channel, tmuxSession);
    }

    // Fail-open on the tail-scan: if the JSONL exec returns null or the
    // tail is empty, keep whatever value the cache last saw (defaulting to
    // null on cold-start) so a transient SSH hiccup does NOT wipe a valid
    // recency signal. `2>/dev/null || true` mirrors the hook-payload
    // pattern: if the file does not exist yet (fresh session with no JSONL
    // writes), the shell suppresses the ENOENT stderr and returns exit 0
    // with empty stdout — scanTailForNewestMessageAt returns null (no
    // history), we keep the cached value (also null in this case).
    let derivedLastMessageAt: number | null = cached?.lastMessageAt ?? null;
    let derivedAiTitle: string | null = cached?.aiTitle ?? null;
    let nextStaleTailTickCount = cached?.staleTailTickCount ?? 0;
    if (jsonlPath !== null) {
      // Phase 47 Plan 02 — tail width bumped from a line-count-bounded
      // read to `tail -c 262144` (256KB byte-count) so an ai-title line
      // older than the last handful of message-bearing lines is still
      // captured. The sessions.ts /sessions/list route uses the same tail
      // shape; both backend read paths stay aligned.
      // scanTailForNewestMessageAt iterates lines regardless of
      // byte-vs-line-bound source, so the switch is semantically invisible
      // to the lastMessageAt derivation.
      const tailRaw = await channel.exec(
        `tail -c 262144 ${jsonlPath} 2>/dev/null || true`,
      );
      let scanned: number | null = null;
      let scannedAiTitle: string | null = null;
      if (tailRaw !== null && tailRaw.trim() !== "") {
        // ONE buffer, TWO scans — no duplicate exec, no duplicate discovery.
        scanned = scanTailForNewestMessageAt(tailRaw);
        scannedAiTitle = scanTailForLatestAiTitle(tailRaw);
      }
      // Phase 47 Plan 02 — last-wins reconciliation for aiTitle. If the
      // fresh tail-scan returned a non-null string, use it; otherwise
      // preserve the cache (fail-open on transient SSH hiccup or a tick
      // where the tail is empty — matches lastMessageAt's semantics). A
      // truly-no-ai-title session's cache starts at null and stays null.
      if (scannedAiTitle !== null) {
        derivedAiTitle = scannedAiTitle;
      }
      // Phase 44 Plan 02 — TIGHTENED stale-tick condition. Three mutually-
      // exclusive branches, evaluated in order:
      //   1. Advance branch (fresher signal): reset counter to 0.
      //   2. No-history branch (derivedLastMessageAt === null): leave
      //      counter at whatever cache had (0 in practice) — do NOT tick.
      //      Rationale: the stale threshold defends against JSONL rotation
      //      mid-session, not against sessions that never emitted a
      //      message-bearing frame. See 44-CONTEXT.md and the
      //      PidCacheEntry.staleTailTickCount docblock above.
      //   3. Stale branch (HAD a signal, tail failed to advance): the ONLY
      //      increment path. Fires when there WAS a cached lastMessageAt
      //      AND the fresh tail failed to advance it — the exact condition
      //      the rotation-defense rationale targets.
      if (
        scanned !== null &&
        (derivedLastMessageAt === null || scanned > derivedLastMessageAt)
      ) {
        derivedLastMessageAt = scanned;
        nextStaleTailTickCount = 0;
      } else if (derivedLastMessageAt === null) {
        // No-history session — do NOT tick, do NOT reset.
        nextStaleTailTickCount = cached?.staleTailTickCount ?? 0;
      } else {
        // derivedLastMessageAt !== null AND
        // (scanned === null || scanned <= derivedLastMessageAt) —
        // HAD a signal, tail failed to advance.
        nextStaleTailTickCount = (cached?.staleTailTickCount ?? 0) + 1;
      }
      // Threshold check (invalidate on trip): null the cached path so the
      // next tick re-fires discovery. Do NOT wipe derivedLastMessageAt —
      // the fingerprint gate still owns publish semantics; a re-discovery
      // that lands on the same path (no rotation happened) leaves the
      // cached signal intact.
      if (nextStaleTailTickCount >= STALE_TAIL_REDISCOVERY_THRESHOLD) {
        jsonlPath = null;
        nextStaleTailTickCount = 0;
      }
    }

    // Liveness check
    const stale = isStaleFromStat(sessionJson.procStart, statContents);
    if (stale) {
      // Reap: publish session_gone and drop from liveness map
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

    // Parse hook payload — fail-open if absent/malformed/error
    let backgroundTasks: SessionState["backgroundTasks"] = [];
    const isHookPayloadMissing =
      hookPayloadRaw === null || hookPayloadRaw.trim() === "";

    if (!isHookPayloadMissing) {
      const payload = parseStopHookPayload(hookPayloadRaw!);
      if (payload !== null) {
        backgroundTasks = filterAmbientTasks(payload.background_tasks);
      } else {
        // parseStopHookPayload returned null: malformed/schema-invalid — fail-open
        emitHookPayloadWarn(hostState, host.id);
      }
    } else {
      // null or empty — fail-open
      emitHookPayloadWarn(hostState, host.id);
    }

    // Compose SessionState — Phase 41 Plan 03 stamps lastMessageAt from the
    // JSONL-tail derivation above (null when no message-bearing history is
    // known for this session). Phase 47 Plan 02 stamps aiTitle from the
    // SAME tail-read (shared buffer, one exec) — last-wins across
    // multiple ai-title lines in the tail. Phase 52 Plan 01 Task 2 stamps
    // dormant from the identity-folder .dormant sentinel stat above
    // (fail-open to cached value on SSH hiccup). Phase 53 Plan 01 stamps
    // recycling from the identity-folder .recycled-at sentinel stat above
    // (fail-open to cached value on SSH hiccup — same semantics as dormant).
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
      recycling: derivedRecycling,
    };

    // Delta semantics — only publish if fingerprint changed
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
        recycling: derivedRecycling,
      });
    } else {
      // Update procStart + tmux in case they changed without a state-change
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
        recycling: derivedRecycling,
      });
    }
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
        // Phase 52 Plan 01 Task 3 — initialize source B fingerprint-suppression
        // cache empty; populated by pollDormantOnlyIdentities on each tick.
        dormantOnlyIdentities: new Map(),
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
        const statContents = await channel.exec(`cat /proc/${pid}/stat`);
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
