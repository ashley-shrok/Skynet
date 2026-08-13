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
}

interface PerHostState {
  host: HostRecord;
  channel: SshChannel;
  livenessMap: Map<number, PidCacheEntry>;
  lastHookWarnAt: number;
}

// ---------------------------------------------------------------------------
// Fingerprint helper
// ---------------------------------------------------------------------------

function computeFingerprint(state: SessionState): string {
  const bgKey = state.backgroundTasks
    .map((t) => `${t.id}:${t.status}`)
    .join(",");
  return `${state.status}|${state.waitingFor ?? ""}|${bgKey}|${state.updatedAt}`;
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
      hostId: host.id,
      tick: pollTickCount,
    });

    // (a) Enumerate session-JSON files
    const listing = await channel.exec(
      "ls -1 ~/.claude/sessions/*.json 2>/dev/null || true",
    );

    if (listing === null) {
      systemLogger.warn("Fleet-status: ls of sessions dir returned null (SSH error)", {
        operation: "fleet_status_host_ssh_unreachable",
        hostId: host.id,
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
      hostId: host.id,
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

    // Parse session JSON
    if (sessionJsonRaw === null || sessionJsonRaw.trim() === "") {
      // File may be in mid-write; skip this PID for this tick
      return;
    }

    const sessionJson = parseSessionJson(sessionJsonRaw);
    if (sessionJson === null) {
      return;
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
        hostId: host.id,
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

    // Compose SessionState
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
    };

    // Delta semantics — only publish if fingerprint changed
    const newFingerprint = computeFingerprint(state);
    const lastFingerprint = livenessMap.get(pid)?.lastPublishedFingerprint;

    if (newFingerprint !== lastFingerprint) {
      deps.registry.publishSessionState(host.id, state);

      systemLogger.info("Fleet-status: session state published", {
        operation: "fleet_status_session_state_published",
        hostId: host.id,
        pid,
        sessionId: sessionJson.sessionId,
        status: sessionJson.status,
      });

      livenessMap.set(pid, {
        sessionId: sessionJson.sessionId,
        tmuxSession,
        procStart: sessionJson.procStart,
        lastPublishedFingerprint: newFingerprint,
      });
    } else {
      // Update procStart + tmux in case they changed without a state-change
      livenessMap.set(pid, {
        ...(livenessMap.get(pid) as PidCacheEntry),
        procStart: sessionJson.procStart,
        tmuxSession,
        lastPublishedFingerprint: newFingerprint,
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
          hostId,
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
          hostId: hostState.host.id,
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
          hostId: host.id,
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
        hostId: host.id,
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
          hostId: hostState.host.id,
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
              hostId: host.id,
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
          hostId: host.id,
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
