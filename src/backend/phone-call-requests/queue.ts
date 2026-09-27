/**
 * phone-call-requests/queue.ts
 *
 * In-memory phone-call request queue backed by a single serial worker loop
 * per unique target user (to_user). Structurally simpler than image-gen's
 * queue: no token bucket, no fixed worker-pool concurrency, and the "one
 * call per target user at a time" invariant is the load-bearing constraint.
 *
 * Design (per shape doc "concurrency" grill answer):
 *   - Requests targeting DIFFERENT users can run concurrently.
 *   - Requests targeting the SAME user run serially — the second waits
 *     until the first's call has wrapped.
 *
 * Implementation:
 *   - pendingByUser: Map<to_user, PendingPhoneCall[]> — one FIFO per user.
 *   - runningByUser: Set<to_user> — invariant: at most one worker loop
 *     per user in the set at any time.
 *   - When enqueue() lands an item and no loop is running for that user,
 *     kick a per-user worker loop. That loop drains ALL of that user's
 *     pending items serially, then removes the user from runningByUser.
 *   - When enqueue() lands an item and a loop IS running for that user,
 *     append to that user's FIFO; the running loop will pick it up on
 *     its next drain iteration.
 *
 * Failure containment: every call to processPhoneCall is try/caught so
 * the per-user loop never dies on a bad item. The loop's `while` peeks
 * the user's FIFO — the loop exits only when the FIFO is empty AND
 * removes the user from runningByUser atomically so a subsequent
 * enqueue restarts the loop cleanly.
 */

import { systemLogger } from "../utils/logger.js";
import type { PendingPhoneCall } from "./types.js";
import type { WorkerDeps } from "./worker.js";
import { writePhoneCallResponseFile } from "./worker.js";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Global hard cap on total pending items across all users. A runaway scan
 * dumping thousands of phone requests would otherwise pin memory; this
 * cap kicks in far above any realistic legitimate load (agent volumes for
 * a phone service should never exceed a few per hour, let alone hundreds).
 */
export const MAX_QUEUE_DEPTH = 1_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProcessPhoneCallFn = (
  item: PendingPhoneCall,
  deps: WorkerDeps,
) => Promise<void>;

// ---------------------------------------------------------------------------
// Module state (NOT exported)
// ---------------------------------------------------------------------------

const pendingByUser = new Map<string, PendingPhoneCall[]>();
const runningByUser = new Set<string>();
let totalPending = 0;

let processPhoneCallFn: ProcessPhoneCallFn | null = null;
let workerDeps: WorkerDeps | null = null;
let stopped = false;

// ---------------------------------------------------------------------------
// Loop mechanics
// ---------------------------------------------------------------------------

/**
 * Drain all pending items for a single target user, sequentially. Exits
 * when the user's FIFO is empty. Never throws — per-item errors are
 * caught + logged so the loop keeps going.
 */
async function drainUser(toUser: string): Promise<void> {
  runningByUser.add(toUser);
  try {
    while (!stopped) {
      const list = pendingByUser.get(toUser);
      if (!list || list.length === 0) return;
      const item = list.shift();
      if (!item) return;
      if (list.length === 0) pendingByUser.delete(toUser);
      totalPending--;

      if (processPhoneCallFn === null || workerDeps === null) {
        systemLogger.error("phone queue: missing injection — draining without processor", {
          operation: "phone_worker_missing_injection",
          uuid: item.uuid,
        });
        return;
      }

      try {
        await processPhoneCallFn(item, workerDeps);
      } catch (err) {
        // Contain per-item failures — one bad item must not stall the
        // per-user loop or leak an unhandled rejection.
        systemLogger.error("phone queue: worker drain error", {
          operation: "phone_worker_drain_error",
          uuid: item.uuid,
          toUser,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    runningByUser.delete(toUser);
  }
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

export function setProcessPhoneCall(fn: ProcessPhoneCallFn): void {
  processPhoneCallFn = fn;
}

export function setWorkerDeps(deps: WorkerDeps): void {
  workerDeps = deps;
}

/**
 * Enqueue a pending phone-call item. Returns synchronously.
 *
 * If the item's target user has no currently-running loop, kick a fresh
 * loop for that user. Otherwise the item joins the user's FIFO and is
 * picked up by the running loop on its next iteration.
 *
 * MAX_QUEUE_DEPTH is checked BEFORE push — a rejected item gets a
 * `{outcome: "unknown", message: "queue full"}` response file so the
 * caller sees a distinct signal instead of a silent timeout. The drop
 * is fire-and-forget (writePhoneCallResponseFile owns its own try/catch).
 */
export function enqueue(item: PendingPhoneCall): void {
  systemLogger.info("phone queue: enqueued", {
    operation: "phone_enqueued",
    uuid: item.uuid,
    hostId: item.hostIdNum,
    toUser: item.body.to_user,
    malformed: item.malformedReason !== undefined,
    totalPending,
  });

  if (totalPending >= MAX_QUEUE_DEPTH) {
    systemLogger.warn("phone queue: MAX_QUEUE_DEPTH reached — rejecting new item", {
      operation: "phone_queue_full_reject",
      uuid: item.uuid,
      totalPending,
      cap: MAX_QUEUE_DEPTH,
    });
    if (workerDeps !== null) {
      void writePhoneCallResponseFile(item, workerDeps, {
        outcome: "unknown",
        message: "queue full — try again later",
      });
    }
    return;
  }

  const toUser = item.body.to_user;
  const list = pendingByUser.get(toUser) ?? [];
  list.push(item);
  pendingByUser.set(toUser, list);
  totalPending++;

  // If no loop is currently running for this user, kick one.
  if (!runningByUser.has(toUser) && !stopped) {
    // Fire-and-forget — drainUser owns per-item try/catch and
    // atomically clears runningByUser in its finally block.
    void drainUser(toUser);
  }
}

/**
 * Signal all per-user loops to stop after the current in-flight item.
 * Pending items remain in-memory (in-memory-only invariant, mirroring
 * image-gen: the queue dies on restart, and the scan orchestrator picks
 * request files back up on the next tick).
 */
export function stopPool(): void {
  stopped = true;
  systemLogger.info("phone queue: stopping (in-flight items will finish)", {
    operation: "phone_worker_pool_stopping",
    totalPending,
    runningUsers: runningByUser.size,
  });
}

/**
 * Snapshot the queue for observability / tests.
 */
export function getQueueSnapshot(): {
  totalPending: number;
  runningUsers: string[];
  pendingByUser: Record<string, number>;
} {
  const snapshot: Record<string, number> = {};
  for (const [user, list] of pendingByUser) {
    snapshot[user] = list.length;
  }
  return {
    totalPending,
    runningUsers: Array.from(runningByUser),
    pendingByUser: snapshot,
  };
}

/**
 * Test-only reset. Not exported to production.
 */
export function __resetForTests(): void {
  pendingByUser.clear();
  runningByUser.clear();
  totalPending = 0;
  stopped = false;
  processPhoneCallFn = null;
  workerDeps = null;
}
