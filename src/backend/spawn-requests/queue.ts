/**
 * spawn-requests/queue.ts
 *
 * In-memory serialized spawn-request queue (D-06, D-07).
 *
 * Uses a Promise-chain for serialization — the second birth does not start
 * until the first Promise resolves (RESEARCH Pattern 3).
 *
 * No import of worker.ts here — circular-import avoidance. The processBirth
 * function is injected via setProcessBirth() called once at startup by
 * starter.ts (Plan 99-02), or by tests directly.
 */

import { systemLogger } from "../utils/logger.js";
import type { PendingBirth } from "./types.js";

// ---------------------------------------------------------------------------
// Module state (NOT exported — internal queue mechanics)
// ---------------------------------------------------------------------------

let workerPromise: Promise<void> = Promise.resolve();
const pending: PendingBirth[] = [];
let processBirthFn: ((item: PendingBirth) => Promise<void>) | null = null;

// ---------------------------------------------------------------------------
// Internal drain worker
// ---------------------------------------------------------------------------

async function drainOne(): Promise<void> {
  // Silence the drain-start log when there is nothing to drain — every
  // successive enqueue chains an idempotent drainOne, so in a burst of N
  // enqueues, N-1 calls arrive with pending already empty. Logging each of
  // those creates noise without value. (Post-code-review L3.)
  if (pending.length === 0 || !processBirthFn) return;

  systemLogger.info("spawn-request queue: drain start", {
    operation: "spawn_request_drain_start",
    pending: pending.length,
  });
  while (pending.length > 0 && processBirthFn) {
    const item = pending.shift();
    if (!item) continue;
    try {
      await processBirthFn(item);
    } catch (err) {
      // Do NOT let error escape — matches server-stats-state.ts:42-54 pattern.
      // The queue must not stall on one bad item (D-15 no-retry applies to the
      // birth; the queue itself continues draining).
      systemLogger.error("spawn-request queue: drain error", {
        operation: "spawn_request_drain_error",
        uuid: item.uuid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Wire the processBirth function into the queue.
 * Called once at startup by starter.ts (Plan 99-02).
 * Tests call it directly to inject a mock.
 * This inversion avoids a circular queue↔worker import.
 */
export function setProcessBirth(fn: (item: PendingBirth) => Promise<void>): void {
  processBirthFn = fn;
}

/**
 * Enqueue a pending birth item and chain a drain step onto the worker Promise.
 * Returns synchronously — does not await the birth.
 */
export function enqueue(item: PendingBirth): void {
  pending.push(item);
  systemLogger.info("spawn-request queue: enqueued", {
    operation: "spawn_request_enqueued",
    uuid: item.uuid,
    hostId: item.hostIdNum,  // LogContext.hostId is number; PendingBirth carries both string+num forms
    role: item.role,
  });
  workerPromise = workerPromise.then(() => drainOne());
}

/**
 * Returns true when the pending queue is empty.
 */
export function isEmpty(): boolean {
  return pending.length === 0;
}

/**
 * Test-only reset — do not call from production code.
 * Clears the pending queue, resets the worker Promise chain, and clears the
 * processBirth injection so tests start from a clean state.
 */
export function __resetForTests(): void {
  pending.length = 0;
  workerPromise = Promise.resolve();
  processBirthFn = null;
}
