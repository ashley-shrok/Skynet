/**
 * settle-with-concurrency.ts — Promise.allSettled with at most `limit`
 * callbacks in flight.
 *
 * Used where many execs share ONE ssh2 connection: each exec is its own SSH
 * session channel, and OpenSSH's default MaxSessions=10 refuses the 11th
 * concurrent channel on a connection. Results keep input order, exactly like
 * Promise.allSettled; a throwing (or synchronously throwing) callback lands as
 * a rejected entry and never stops the others.
 */
export async function settleWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
