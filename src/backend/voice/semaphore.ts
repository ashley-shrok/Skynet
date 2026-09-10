/**
 * D-09 (N=5 concurrent Transcribe streams, under 25-stream account quota);
 * D-10 (module-level singleton mirrors TranscribeStreamingClient at
 * transcribe-adapter.ts:93). This module is dep-free — no imports.
 *
 * Inline counting semaphore: limits the number of concurrently-active
 * async calls to `limit`. Excess callers queue up and are admitted one
 * by one as active callers resolve or reject.
 */

/**
 * Creates a counting semaphore that limits concurrent async calls to `limit`.
 *
 * @param limit - Maximum number of concurrent async fn invocations.
 * @returns An `acquire` function. Call `acquire(fn)` to run `fn()` under the
 *   semaphore. The (limit+1)th concurrent call will wait until a prior call
 *   resolves. Slots are released in the `finally` block — rejection does not
 *   leak a slot.
 */
export function createSemaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function acquire<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
