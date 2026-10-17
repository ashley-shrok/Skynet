/**
 * host-semaphore-registry.ts — Shared per-host SSH semaphore registry.
 *
 * Bounty b31a5c8e-7f2d-4c91-a4b6-8e9f1c3b7d24 (Phase 101, D-01):
 *   Consolidates all outbound SSH exec work through a single shared slot pool
 *   per hostId. Today starter.ts has TWO independent makeSemaphore(8) instances
 *   per host (fleet-status at L618/L666, substrate at L911) plus at least 9
 *   other producer sites that acquire uncapped SSH channels. That means a single
 *   host with fleet-status + substrate + a route-driven exec + widgets can burn
 *   30+ concurrent ssh2 exec channels and blow past OpenSSH's default
 *   MaxSessions=10 — the wilma-incident failure mode.
 *
 *   This module-scope Map<hostId, HostSemaphore> registry gives us ONE shared
 *   slot pool per host across ALL producers — correct aggregate policy per D-04.
 *
 * SEMAPHORE CAP HISTORY (see box-maintainer role file for full context):
 *   Original cap = 8 (OpenSSH default MaxSessions=10 minus 2 headroom).
 *   Bumped to 48 on 2026-09-24 after a workstation-side wedge investigation
 *   (~27 active identities × one permanently-held slot per `tail -F` via
 *   acquireTailSlot exhausted the 8-slot pool → spawn-scan / image-gen /
 *   fleet-status legacy poll all starved on sem.run). Paired with a bump
 *   of the substrate's `/etc/ssh/sshd_config.d/60-skynet-maxsessions.conf`
 *   from MaxSessions=30 to MaxSessions=64 on OpenSSH-served hosts, sized
 *   for the 4GB Graviton floor (~10MB per sshd child × 64 ≈ 16% of RAM,
 *   leaves ample budget for the actual identity workload). Tailscale-SSH
 *   hosts (e.g. workstation) ignore MaxSessions entirely — the semaphore
 *   bump alone unblocks them.
 *
 * D-02 primary path: makeSemaphore is defined HERE and re-exported for starter.ts
 * to import (starter.ts's inline call sites are migrated in Plan 101-02).
 *
 * Contract inherited from starter.ts::makeSemaphore (bounty b31a5c8e):
 *   - run(fn) runs fn() when a slot is free; otherwise queues FIFO.
 *   - Slot decrement + queue drain happen in try/finally so a throwing fn()
 *     still releases its slot and wakes the next waiter.
 *   - Errors from fn() propagate unchanged — the semaphore does NOT catch or
 *     transform them.
 *   - No timing / no timeouts. Pure counting semaphore with a FIFO queue.
 */

import { sshLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Public type
// ---------------------------------------------------------------------------

/** The interface every SSH producer calls. */
export type HostSemaphore = {
  run<T>(fn: () => Promise<T>, opts?: SemaphoreRunOptions): Promise<T>;
};

export interface SemaphoreRunOptions {
  /**
   * Give up if no slot frees within this long: the call rejects with
   * SemaphoreAcquireTimeoutError and `fn` never runs. Opt-in — callers that
   * must not fail (e.g. long-lived tail slots) leave it unset. Fan-out
   * routes set it so a host whose slots are all held costs only its own
   * rows instead of hanging the whole request.
   */
  acquireTimeoutMs?: number;
}

export class SemaphoreAcquireTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`no SSH slot freed within ${timeoutMs}ms`);
    this.name = "SemaphoreAcquireTimeoutError";
  }
}

// ---------------------------------------------------------------------------
// Internal factory (verbatim lift from starter.ts L103-122, bounty b31a5c8e)
// ---------------------------------------------------------------------------

export function makeSemaphore(
  limit: number,
  /** Optional observer, called when a caller has to queue (after it is
   *  enqueued). Used for limit-decision logging; must not throw. */
  onQueued?: (waiting: number, active: number) => void,
): HostSemaphore {
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    async run<T>(fn: () => Promise<T>, opts: SemaphoreRunOptions = {}): Promise<T> {
      if (active >= limit) {
        let wake!: () => void;
        const queued = new Promise<void>((resolve) => {
          wake = resolve;
        });
        waiters.push(wake);
        try {
          onQueued?.(waiters.length, active);
        } catch {
          /* observer must never break the semaphore */
        }
        const timeoutMs = opts.acquireTimeoutMs;
        if (timeoutMs === undefined) {
          await queued;
        } else {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const gotSlot = await Promise.race([
            queued.then(() => true),
            new Promise<false>((resolve) => {
              timer = setTimeout(() => resolve(false), timeoutMs);
            }),
          ]);
          clearTimeout(timer);
          if (!gotSlot) {
            const i = waiters.indexOf(wake);
            if (i !== -1) {
              waiters.splice(i, 1);
              throw new SemaphoreAcquireTimeoutError(timeoutMs);
            }
            // A release already handed us the slot in the same instant —
            // take it, or the waiters behind us would never be woken.
          }
        }
      }
      active++;
      try {
        return await fn();
      } finally {
        active--;
        const next = waiters.shift();
        if (next) next();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Module-scope registry (D-01: one shared slot pool per hostId)
// ---------------------------------------------------------------------------

const registry = new Map<string, HostSemaphore>();

/**
 * Returns the shared HostSemaphore for the given hostId, creating it on first
 * call. Key normalization: String(hostId) so numeric 1 and string "1" map to
 * the same slot pool (D-01).
 *
 * @param hostId  Host identifier — string or number, both accepted (D-01).
 * @param limit   Semaphore cap. Defaults to 48 (2026-09-24 — see SEMAPHORE
 *                CAP HISTORY in the module docblock). Sized to cover the
 *                observed peak of ~27 long-lived `tail -F` slots per host
 *                plus ~20 slots of headroom for short-exec work
 *                (spawn-scan, image-gen, fleet-status polls) with 16 slots
 *                to spare under the substrate's MaxSessions=64.
 *                Only applied on first call for a given hostId; subsequent
 *                calls return the existing instance regardless of limit.
 */
export function getHostSemaphore(
  hostId: string | number,
  limit: number = 48,
): HostSemaphore {
  const key = String(hostId);
  let sem = registry.get(key);
  if (!sem) {
    sem = makeSemaphore(limit);
    registry.set(key, sem);
  }
  return sem;
}

// ---------------------------------------------------------------------------
// Per-host SSH CONNECT (handshake) limiter
// ---------------------------------------------------------------------------

/**
 * Max concurrent SSH handshakes Skynet opens to one host. The exec-slot
 * semaphore above bounds channels, not connections: a burst of one-shot
 * connects (e.g. the fleet-status WS identity gate on a cold subscribe — one
 * connectOneShot per identity, ~30 on t1000) races ~30 unauthenticated
 * handshakes at sshd at once. OpenSSH's default MaxStartups=10:30:100 starts
 * randomly dropping beyond 10 pending, so some connects fail. 8 stays under
 * the default with headroom for other producers.
 */
export const HOST_CONNECT_CONCURRENCY = 8;

const connectRegistry = new Map<string, HostSemaphore>();

/**
 * Returns the shared per-host handshake limiter (String(hostId) key, same
 * normalization as getHostSemaphore). Wrap ONLY the connect
 * (`connectOneShot`) in it — not the work done over the connection — so a
 * slot frees as soon as the handshake settles.
 */
export function getHostConnectLimiter(
  hostId: string | number,
  limit: number = HOST_CONNECT_CONCURRENCY,
): HostSemaphore {
  const key = String(hostId);
  let sem = connectRegistry.get(key);
  if (!sem) {
    sem = makeSemaphore(limit, (waiting, active) => {
      // Log once per burst (first waiter), not per queued connect.
      if (waiting !== 1) return;
      sshLogger.info("SSH connect limiter: per-host handshake cap reached — queuing connects", {
        operation: "ssh_host_connect_limit_queued",
        fleetHostId: key,
        limit,
        active,
      });
    });
    connectRegistry.set(key, sem);
  }
  return sem;
}

/**
 * __resetHostSemaphoreRegistryForTests — clears the module-scope registry Map.
 *
 * TEST-ONLY. Call in beforeEach to prevent state leak between test cases.
 * The __ prefix signals internal-only; do not call from production code.
 */
export function __resetHostSemaphoreRegistryForTests(): void {
  registry.clear();
  connectRegistry.clear();
}

/**
 * Take one of `hostId`'s slots and hand back its release, for work that
 * needs the slot only for part of its life — e.g. a file download holds it
 * for connect + SFTP setup and gives it back once bytes start streaming, so
 * a slow or paused viewer can't pin a slot for the whole transfer. Each
 * download is its own one-shot connection, so the stream itself never
 * competes for sshd's per-connection sessions.
 *
 * The release is idempotent; callers must still call it in a `finally`.
 * Rejects with SemaphoreAcquireTimeoutError when `acquireTimeoutMs` runs out.
 */
export async function acquireHostSlot(
  hostId: string | number,
  opts: SemaphoreRunOptions = {},
): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired!: () => void;
  const gotSlot = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const running = getHostSemaphore(hostId).run(() => {
    acquired();
    return held;
  }, opts);
  running.catch(() => {});
  await Promise.race([gotSlot, running]);
  return () => release();
}
