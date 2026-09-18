/**
 * image-gen-requests/queue.ts
 *
 * In-memory image-gen request queue backed by a fixed pool of 5 concurrent
 * worker loops (Phase 116 D-20). Structural clone of Phase 99's
 * spawn-requests/queue.ts with these deltas per RESEARCH.md Pattern 5 +
 * PATTERNS.md "What CHANGES for Phase 116":
 *
 *   - N=5 concurrent worker loops instead of a serialized Promise chain.
 *   - `waiters: Array<(item) => void>` FIFO list — an idle loop parks on a
 *     Promise that the next enqueue() resolves directly (no shift-and-reshift
 *     dance, no polling).
 *   - No TTL check here — TTL lives inside the worker at dequeue per
 *     Pitfall 5 (comparing Date.now() vs Date.parse(requested_at) + 5min).
 *   - workerDeps is injected via setWorkerDeps() at boot so the worker gets
 *     the boot-time-singleton tokenBucket instance without importing the
 *     concrete construction (avoids a starter.ts→queue.ts→worker.ts→adapter.ts
 *     transitive graph inside queue.ts's test surface).
 *
 * WorkerDeps is imported as a TYPE ONLY from worker.ts — the type import is
 * erased at runtime, so no transitive graph pollution occurs. The concrete
 * processImageGen fn is injected via setProcessImageGen() called once at
 * startup by starter.ts, or by tests directly.
 *
 * ONE runtime import from worker.ts: writeImageGenFailureFile — used by the
 * MAX_QUEUE_DEPTH overflow-drop path so a queue-full rejection lands as a
 * proper failure.json rather than a silent timeout. Worker.ts does NOT
 * import from queue.ts, so there is no import cycle.
 */

import { systemLogger } from "../utils/logger.js";
import type { PendingImageGen } from "./types.js";
import type { WorkerDeps } from "./worker.js";
import { writeImageGenFailureFile } from "./worker.js";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Worker concurrency — D-20 locked value. Exported as a named constant so
 * tests can pin the number and the D-20 discretion is grep-able rather than
 * a magic 5 scattered through the file.
 */
export const WORKER_COUNT = 5;

/**
 * Hard cap on the in-memory pending queue depth. A runaway scan (e.g. every
 * fleet host suddenly dropping thousands of request files) would otherwise
 * OOM the backend by accumulating unbounded PendingImageGen items in memory.
 *
 * At the cap:
 *   - The NEW enqueue is rejected (protect in-flight work, don't evict the
 *     oldest — the oldest is closest to being served next).
 *   - A warn-log fires with the depth.
 *   - A `<uuid>.failure.json` with `{reason:"unknown", message:"queue full —
 *     try again later"}` is dropped so the caller sees a distinct failure
 *     rather than a silent 5-minute timeout.
 *
 * Sizing: 10_000 leaves ~9995 items of headroom above WORKER_COUNT=5 while
 * bounding worst-case memory. Each PendingImageGen without `refImage` is
 * ~1KB; 10K items = ~10MB. With refImage (up to 20MB each per FIX 6), the
 * scan-orchestrator's per-tick companion-fetch loop would tighten this
 * further, but the pending array holds only the pointers to already-fetched
 * bytes, so the memory pressure sits on refImage buffers not the queue.
 */
export const MAX_QUEUE_DEPTH = 10_000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The processImageGen signature the queue expects. Kept as a local type
 * alias so starter.ts wiring (and tests) can name the injection type
 * without pulling the worker's runtime.
 */
export type ProcessImageGenFn = (
  item: PendingImageGen,
  deps: WorkerDeps,
) => Promise<void>;

// ---------------------------------------------------------------------------
// Module state (NOT exported — internal queue mechanics)
// ---------------------------------------------------------------------------

const pending: PendingImageGen[] = [];

/**
 * FIFO waiter list. Each entry is a resolver that a subsequent enqueue()
 * will call directly with the just-pushed item — this bypasses the
 * shift+reshift dance and gives immediate FIFO wake-up.
 */
const waiters: Array<(item: PendingImageGen) => void> = [];

let processImageGenFn: ProcessImageGenFn | null = null;
let workerDeps: WorkerDeps | null = null;
let stopped = false;
let poolStarted = false;

// ---------------------------------------------------------------------------
// Internal loop mechanics
// ---------------------------------------------------------------------------

/**
 * Block until there's an item to process. Returns immediately if `pending`
 * has one, else parks the caller on a waiter Promise that enqueue() resolves.
 */
function dequeueBlocking(): Promise<PendingImageGen> {
  const head = pending.shift();
  if (head !== undefined) {
    return Promise.resolve(head);
  }
  return new Promise<PendingImageGen>((resolve) => {
    waiters.push(resolve);
  });
}

/**
 * One worker loop. Awaits an item, invokes processImageGenFn, catches any
 * throw so the loop never dies on a bad item, and repeats until stopped.
 *
 * If processImageGenFn or workerDeps aren't wired at loop-body entry time we
 * log and exit the loop — starter.ts must always call setProcessImageGen +
 * setWorkerDeps BEFORE startPool() (which is exactly what the wiring block
 * does), but the guard prevents an unhandled null-deref if the invariant is
 * ever violated.
 */
async function workerLoop(loopId: number): Promise<void> {
  while (!stopped) {
    const item = await dequeueBlocking();
    if (stopped) return;
    if (processImageGenFn === null || workerDeps === null) {
      systemLogger.error("image-gen queue: worker loop missing injection — exiting", {
        operation: "image_gen_worker_loop_missing_injection",
        loopId,
        hasProcessFn: processImageGenFn !== null,
        hasDeps: workerDeps !== null,
      });
      return;
    }
    try {
      await processImageGenFn(item, workerDeps);
    } catch (err) {
      // Do NOT let the error escape — the queue must not stall on one bad
      // item. Matches spawn-requests/queue.ts:45-54 drain-error containment.
      systemLogger.error("image-gen queue: worker drain error", {
        operation: "image_gen_worker_drain_error",
        loopId,
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
 * Wire the processImageGen function into the queue.
 * Called once at startup by starter.ts. Tests call it directly to inject a mock.
 * This inversion avoids a circular queue↔worker import at module-load time.
 */
export function setProcessImageGen(fn: ProcessImageGenFn): void {
  processImageGenFn = fn;
}

/**
 * Wire the boot-time-singleton WorkerDeps (containing the single tokenBucket
 * instance the starter creates at boot) into the queue. Called once at
 * startup by starter.ts.
 */
export function setWorkerDeps(deps: WorkerDeps): void {
  workerDeps = deps;
}

/**
 * Enqueue a pending image-gen item. Returns synchronously.
 *
 * Path:
 *   - If a worker loop is currently parked as a waiter, hand the item to
 *     that waiter DIRECTLY (bypassing the pending array). This bypasses the
 *     MAX_QUEUE_DEPTH cap because a parked waiter has already earned a slot
 *     and there is no pending-array growth.
 *   - Otherwise, if pending.length >= MAX_QUEUE_DEPTH, REJECT the new item
 *     (warn-log + fire a failure.json drop off-loop so the caller sees a
 *     distinct `unknown` failure rather than a silent 5-minute timeout).
 *   - Otherwise, push onto pending.
 *
 * The failure-file drop is fire-and-forget (void promise) — enqueue's
 * synchronous contract cannot await it. writeImageGenFailureFile owns its
 * own try/catch so an SFTP-side error is logged, not thrown.
 */
export function enqueue(item: PendingImageGen): void {
  systemLogger.info("image-gen queue: enqueued", {
    operation: "image_gen_enqueued",
    uuid: item.uuid,
    hostId: item.hostIdNum,
    hasRef: item.refImage !== undefined,
  });
  const waiter = waiters.shift();
  if (waiter !== undefined) {
    // Direct hand-off — the loop's dequeueBlocking Promise resolves now.
    waiter(item);
    return;
  }
  if (pending.length >= MAX_QUEUE_DEPTH) {
    systemLogger.warn("image-gen queue: MAX_QUEUE_DEPTH reached — rejecting new item", {
      operation: "image_gen_queue_full_reject",
      uuid: item.uuid,
      hostId: item.hostIdNum,
      pendingDepth: pending.length,
      cap: MAX_QUEUE_DEPTH,
    });
    // Drop a proper failure.json so the caller distinguishes "queue full"
    // from "silent timeout". Fire-and-forget — writeImageGenFailureFile
    // owns its own try/catch. Only attempt if workerDeps has been wired
    // (starter.ts wires it at boot before startPool; tests may leave it
    // unset, in which case we skip the drop and only warn-log).
    if (workerDeps !== null) {
      void writeImageGenFailureFile(item, workerDeps, {
        reason: "unknown",
        message: "queue full — try again later",
      });
    }
    return;
  }
  pending.push(item);
}

/**
 * Start the fixed pool of WORKER_COUNT concurrent worker loops. Idempotent —
 * calling twice does not double the loop count. Must be called AFTER
 * setProcessImageGen + setWorkerDeps.
 */
export function startPool(): void {
  if (poolStarted) return;
  poolStarted = true;
  stopped = false;
  systemLogger.info("image-gen queue: starting worker pool", {
    operation: "image_gen_worker_pool_starting",
    workerCount: WORKER_COUNT,
  });
  for (let i = 0; i < WORKER_COUNT; i++) {
    // Fire-and-forget — the loop is `async` and its inner try/catch prevents
    // any unhandled rejection from escaping into the process error handler.
    void workerLoop(i);
  }
}

/**
 * Signal all worker loops to stop. Any loop currently parked on a waiter
 * Promise will remain parked until the process exits (in-memory queue dies
 * on restart — matches Phase 99 D-06 in-memory-only invariant). Loops
 * currently mid-processImageGen finish their in-flight item then exit.
 *
 * Called from starter.ts's SIGTERM hook.
 */
export function stopPool(): void {
  stopped = true;
  systemLogger.info("image-gen queue: stopping worker pool", {
    operation: "image_gen_worker_pool_stopping",
    pendingItems: pending.length,
    parkedWaiters: waiters.length,
  });
}

/**
 * Returns true when the pending queue is empty. Does NOT consider parked
 * waiters (matches Phase 99's isEmpty semantic — this is a pending-only
 * gauge, not a full-idle predicate).
 */
export function isEmpty(): boolean {
  return pending.length === 0;
}

/**
 * Test-only reset — do not call from production code.
 * Clears pending, clears waiters, resets stopped + poolStarted, and clears
 * the processImageGen / workerDeps injections so tests start from a clean
 * state.
 */
export function __resetForTests(): void {
  pending.length = 0;
  waiters.length = 0;
  stopped = false;
  poolStarted = false;
  processImageGenFn = null;
  workerDeps = null;
}
