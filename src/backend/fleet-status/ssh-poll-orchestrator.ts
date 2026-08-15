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
}

interface PerHostState {
  host: HostRecord;
  channel: SshChannel;
  livenessMap: Map<number, PidCacheEntry>;
  lastHookWarnAt: number;
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
 * Construct the JSONL file path for a session on the remote box, following
 * Claude Code's `~/.claude/projects/<cwd-with-slashes-as-dashes>/<sessionId>.jsonl`
 * convention. See src/backend/claude-session/layer1-detect.ts:76-78 for the
 * canonical shape (`/home/ubuntu/skynet/tiffany` cwd → `-home-ubuntu-skynet-tiffany`
 * project slug directory). Uses single-quote shell escaping via the fact that
 * cwd is always an absolute Unix path — never contains a single quote in
 * practice — and sessionId is a UUID.
 *
 * Defense-in-depth: if the constructed path contains a single quote (unheard
 * of on any Unix box the fleet runs on), returns null and the orchestrator
 * treats the session as "no JSONL tail available" — lastMessageAt stays
 * whatever the cache last saw (or null).
 */
function jsonlPathForSession(cwd: string, sessionId: string): string | null {
  const projectSlug = cwd.replace(/\//g, "-");
  const path = `~/.claude/projects/${projectSlug}/${sessionId}.jsonl`;
  // Reject any quote character to keep the single-quote-wrapped shell literal
  // safe. If we ever see this fire in production, we'll switch to a proper
  // escaping helper.
  if (path.includes("'") || path.includes("\n")) return null;
  return path;
}

/**
 * Parse a JSONL blob (the raw stdout of a `tail -n N <jsonl-path>` exec)
 * and return the newest message-bearing `ts` (unix millis) found across all
 * lines, or null if no line qualified. Empty lines and malformed lines are
 * skipped silently — this is a best-effort sample, not a validation pass.
 *
 * This runs on EVERY poll tick per PID; the cost is bounded by `tail -n 200`
 * (~200 lines × O(1) parse each = well under 5ms on typical hardware).
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
  return `${state.status}|${state.waitingFor ?? ""}|${bgKey}|${state.updatedAt}|${state.lastMessageAt ?? ""}`;
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

    systemLogger.info("Fleet-status poll end", {
      operation: "fleet_status_poll_end",
      fleetHostId: host.id,
      tick: pollTickCount,
      pidCount: pidNumbers.length,
    });
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

    // Parse session JSON — the sessionId + cwd from this file drive the
    // Phase 41 Plan 03 JSONL-tail derivation below.
    if (sessionJsonRaw === null || sessionJsonRaw.trim() === "") {
      // File may be in mid-write; skip this PID for this tick
      return;
    }

    const sessionJson = parseSessionJson(sessionJsonRaw);
    if (sessionJson === null) {
      return;
    }

    // Phase 41 Plan 03 — derive lastMessageAt from a bounded JSONL tail.
    //
    // Fires on EVERY poll tick per PID (kept in-band with the existing
    // Promise.all pattern above; the plan's optimization to piggyback on
    // the same round-trip when a lastOffset is cached is deferred — bounded
    // `tail -n 200` per tick is < 5ms of parse work and one extra SSH exec
    // per session per 2s tick). Fail-open: if the JSONL exec returns null
    // or the tail is empty, keep whatever value the cache last saw
    // (defaulting to null on cold-start) so a transient SSH hiccup does
    // NOT wipe a valid recency signal.
    //
    // Path derivation lives in jsonlPathForSession — sessionJson.cwd +
    // sessionJson.sessionId → the Claude Code convention path. If the
    // path fails validation (unheard-of quote character), skip derivation
    // for this tick — cached value stays.
    const jsonlPath = jsonlPathForSession(
      sessionJson.cwd,
      sessionJson.sessionId,
    );
    let derivedLastMessageAt: number | null = cached?.lastMessageAt ?? null;
    if (jsonlPath !== null) {
      // `2>/dev/null || true` mirrors the hook-payload pattern: if the file
      // does not exist yet (fresh session with no JSONL writes), the shell
      // suppresses the ENOENT stderr and returns exit 0 with empty stdout —
      // scanTailForNewestMessageAt returns null (no history), we keep the
      // cached value (also null in this case).
      const tailRaw = await channel.exec(
        `tail -n 200 ${jsonlPath} 2>/dev/null || true`,
      );
      if (tailRaw !== null && tailRaw.trim() !== "") {
        const scanned = scanTailForNewestMessageAt(tailRaw);
        if (scanned !== null) {
          // Advance the signal only when we see a NEWER message-bearing frame
          // than the cache. A tail that returns the same 200 recent lines
          // with no fresh message-bearing turn leaves the cache alone
          // (edge-triggered contract).
          if (
            derivedLastMessageAt === null ||
            scanned > derivedLastMessageAt
          ) {
            derivedLastMessageAt = scanned;
          }
        }
      }
    }

    // Liveness check
    const stale = isStaleFromStat(sessionJson.procStart, statContents);
    if (stale) {
      // Reap: publish session_gone and drop from liveness map
      const entry = livenessMap.get(pid);
      const tmuxSession = entry?.tmuxSession ?? null;
      const sessionId = entry?.sessionId ?? sessionJson.sessionId;

      systemLogger.info("Fleet-status: session stale — publishing gone", {
        operation: "fleet_status_stale_reap",
        fleetHostId: host.id,
        pid,
        sessionId,
      });

      deps.registry.publishSessionGone(host.id, tmuxSession, sessionId);
      livenessMap.delete(pid);
      return;
    }

    // Resolve tmux session for new PIDs
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
    // known for this session).
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
      });
    } else {
      // Update procStart + tmux in case they changed without a state-change
      livenessMap.set(pid, {
        ...(livenessMap.get(pid) as PidCacheEntry),
        procStart: sessionJson.procStart,
        tmuxSession,
        lastPublishedFingerprint: newFingerprint,
        lastMessageAt: derivedLastMessageAt,
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
        for (const host of freshHosts) {
          if (!perHostState.has(host.id)) {
            await tryAcquireHostChannel(host);
          }
        }
      } catch (err) {
        systemLogger.warn("Fleet-status: identity-host list refresh failed", {
          operation: "fleet_status_host_list_refresh_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }

    // Poll each known host
    for (const hostState of perHostState.values()) {
      try {
        await pollOneHost(hostState);
      } catch (err) {
        systemLogger.warn("Fleet-status: poll error for host", {
          operation: "fleet_status_poll_error",
          fleetHostId: hostState.host.id,
          error: err instanceof Error ? err.message : "unknown",
        });
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
