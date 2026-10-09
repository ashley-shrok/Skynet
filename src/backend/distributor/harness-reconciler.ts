/**
 * harness-reconciler.ts — Keeps every substrate host on the pinned Claude Code
 * harness version (harness-pin.ts).
 *
 * Runs ALONGSIDE the substrate sweep, never inside it: the orchestrator calls
 * `queue(host)` after each host's sweep and on every retry tick, and the
 * reconciler fires its own fire-and-forget attempt. A multi-minute install on
 * one host therefore never delays that host's substrate sweep, the serial
 * startup pass, or any other host.
 *
 * PER-HOST STATE (dies with the process, like the orchestrator's own):
 *   - converged: the host reported none / relinked / installed / skipped this
 *     uptime → never re-checked until Skynet restarts. Every pin change ships
 *     with a deploy, and a deploy restarts Skynet, so the whole fleet is
 *     re-checked exactly when the pin can have moved.
 *   - inFlight: one attempt at a time per host.
 *   - failures + nextAttemptAt: a FAILED attempt backs off exponentially
 *     (base 2 min, doubling, capped at 1 h) so a host stuck failing (e.g. low
 *     disk) doesn't re-download the installer every 30 s tick.
 *   - Unreachable host (channel acquire returns null) is NOT an attempt: no
 *     backoff bump, no failure count — it just retries on the next tick, same
 *     as the substrate sweep. The substrate sweep owns reachability alerts.
 *   - After `persistentFailureThreshold` consecutive failed attempts, one
 *     loud alert per uptime (reset on the next success).
 *
 * NEVER-THROW: queue() is synchronous and never throws; the attempt body
 * catches everything.
 *
 * LOG TAGS:
 *   fleet_substrate_harness_result            — one per attempt that produced a result
 *   fleet_substrate_harness_persistent_failure — once per host per uptime at threshold
 */
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
import { systemLogger } from "../utils/logger.js";
import { HARNESS_PIN, HARNESS_PIN_PATTERN } from "./harness-pin.js";
import {
  buildRemoteHarnessCommand,
  parseHarnessResult,
  type HarnessResult,
} from "./harness-script.js";

export interface HarnessHost {
  id: string;
  name: string;
}

export interface HarnessReconcilerDeps<H extends HarnessHost = HarnessHost> {
  /** Open the substrate SSH channel for a remote host; null when unreachable. */
  acquireChannel(host: H): Promise<SshChannel | null>;
  releaseChannel(host: H, channel: SshChannel): void;
  /** True for the co-located host (Skynet's own box) — no SSH-to-self. */
  isLocalHost(host: H): boolean;
  /** Run the reconcile on the co-located host; returns the script's output
   *  (or null when it could not be run at all). */
  runLocal(pin: string): Promise<string | null>;
  now(): number;
  /** Override the pin (tests). Defaults to HARNESS_PIN. */
  pin?: string;
  backoffBaseMs?: number;
  backoffCapMs?: number;
  persistentFailureThreshold?: number;
}

export interface HarnessReconciler<H extends HarnessHost = HarnessHost> {
  /** Fire an attempt for this host if it isn't converged, in flight, or
   *  backing off. Fire-and-forget; never throws. */
  queue(host: H): void;
  /** Drop all state; later queue() calls are no-ops. */
  stop(): void;
}

export const HARNESS_BACKOFF_BASE_MS = 2 * 60 * 1000;
export const HARNESS_BACKOFF_CAP_MS = 60 * 60 * 1000;

export function createHarnessReconciler<H extends HarnessHost>(
  deps: HarnessReconcilerDeps<H>,
): HarnessReconciler<H> {
  const pin = deps.pin ?? HARNESS_PIN;
  const backoffBaseMs = deps.backoffBaseMs ?? HARNESS_BACKOFF_BASE_MS;
  const backoffCapMs = deps.backoffCapMs ?? HARNESS_BACKOFF_CAP_MS;
  const threshold = deps.persistentFailureThreshold ?? 3;
  const pinValid = HARNESS_PIN_PATTERN.test(pin);

  const converged = new Set<string>();
  const inFlight = new Set<string>();
  const failures = new Map<string, number>();
  const nextAttemptAt = new Map<string, number>();
  const alertFired = new Set<string>();
  let stopped = false;
  let pinWarned = false;

  function recordResult(host: H, result: HarnessResult): void {
    const ok = result.action !== "failed";
    const payload = {
      operation: "fleet_substrate_harness_result",
      fleetHostId: host.id,
      hostName: host.name,
      action: result.action,
      wanted: result.wanted,
      found: result.found,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.pruned ? { pruned: result.pruned.join(",") } : {}),
      ...(result.detail ? { detail: result.detail } : {}),
    };

    if (ok) {
      converged.add(host.id);
      failures.delete(host.id);
      nextAttemptAt.delete(host.id);
      alertFired.delete(host.id);
      systemLogger.info(
        `Harness ${result.action} on ${host.name} (wanted ${result.wanted}, found ${result.found})`,
        payload,
      );
      return;
    }

    const n = (failures.get(host.id) ?? 0) + 1;
    failures.set(host.id, n);
    const delay = Math.min(backoffBaseMs * 2 ** (n - 1), backoffCapMs);
    nextAttemptAt.set(host.id, deps.now() + delay);
    systemLogger.warn(
      `Harness install failed on ${host.name}: ${result.reason ?? "unknown"} (attempt ${n}, retry in ${Math.round(delay / 1000)}s)`,
      { ...payload, consecutiveFailures: n, retryInMs: delay },
    );
    if (n >= threshold && !alertFired.has(host.id)) {
      alertFired.add(host.id);
      systemLogger.warn(
        `Harness persistent failure: ${host.name} has failed ${n} consecutive harness installs`,
        {
          operation: "fleet_substrate_harness_persistent_failure",
          fleetHostId: host.id,
          hostName: host.name,
          consecutiveFailures: n,
          wanted: pin,
          ...(result.reason ? { reason: result.reason } : {}),
        },
      );
    }
  }

  async function attempt(host: H): Promise<void> {
    let output: string | null = null;
    try {
      if (deps.isLocalHost(host)) {
        output = await deps.runLocal(pin);
      } else {
        const channel = await deps.acquireChannel(host);
        if (channel === null) return; // unreachable — not an attempt
        try {
          output = await channel.exec(buildRemoteHarnessCommand(pin));
        } finally {
          try {
            deps.releaseChannel(host, channel);
          } catch {
            /* release cannot throw into the reconciler */
          }
        }
      }
      if (stopped) return;
      const parsed = parseHarnessResult(output);
      recordResult(
        host,
        parsed ?? {
          action: "failed",
          wanted: pin,
          found: "unknown",
          reason: "no-result",
          detail: (output ?? "no output").slice(0, 300),
        },
      );
    } catch (err) {
      if (stopped) return;
      recordResult(host, {
        action: "failed",
        wanted: pin,
        found: "unknown",
        reason: "exception",
        detail: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      });
    } finally {
      inFlight.delete(host.id);
    }
  }

  return {
    queue(host: H): void {
      if (stopped) return;
      if (!pinValid) {
        if (!pinWarned) {
          pinWarned = true;
          systemLogger.warn(`Harness pin "${pin}" is not an exact version — harness reconcile disabled`, {
            operation: "fleet_substrate_harness_bad_pin",
            pin,
          });
        }
        return;
      }
      if (converged.has(host.id) || inFlight.has(host.id)) return;
      const next = nextAttemptAt.get(host.id);
      if (next !== undefined && deps.now() < next) return;

      inFlight.add(host.id);
      queueMicrotask(() => {
        void attempt(host);
      });
    },

    stop(): void {
      stopped = true;
      converged.clear();
      inFlight.clear();
      failures.clear();
      nextAttemptAt.clear();
      alertFired.clear();
    },
  };
}
