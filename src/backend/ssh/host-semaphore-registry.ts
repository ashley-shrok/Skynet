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

// ---------------------------------------------------------------------------
// Public type
// ---------------------------------------------------------------------------

/** The interface every SSH producer calls. */
export type HostSemaphore = {
  run<T>(fn: () => Promise<T>): Promise<T>;
};

// ---------------------------------------------------------------------------
// Internal factory (verbatim lift from starter.ts L103-122, bounty b31a5c8e)
// ---------------------------------------------------------------------------

export function makeSemaphore(limit: number): HostSemaphore {
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= limit) {
        await new Promise<void>((resolve) => waiters.push(resolve));
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

/**
 * __resetHostSemaphoreRegistryForTests — clears the module-scope registry Map.
 *
 * TEST-ONLY. Call in beforeEach to prevent state leak between test cases.
 * The __ prefix signals internal-only; do not call from production code.
 */
export function __resetHostSemaphoreRegistryForTests(): void {
  registry.clear();
}
