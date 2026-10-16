/**
 * One-shot SSH work against a fleet host, for the push-trigger's per-sender
 * lookups (which box holds an identity, what it's called).
 *
 * Resolves the host AS `userId` (a host the user can't access is never
 * touched), takes the host's SSH semaphore slot, opens a one-shot
 * connection, and races `fn` against `timeoutMs` so a hung host can't stall
 * a notification. The connection is always closed.
 */

import { resolveHostById } from "../ssh/host-resolver.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { getHostSemaphore } from "../ssh/host-semaphore-registry.js";

export type OneShotConn = Awaited<ReturnType<typeof connectOneShot>>;

/**
 * Run `fn` on a fresh connection to `hostId`. Returns null when the host is
 * unknown or `userId` lacks access; throws on connect failure, `fn` failure,
 * or timeout.
 */
export async function withRemoteHost<T>(
  hostId: number,
  userId: string,
  timeoutMs: number,
  fn: (conn: OneShotConn) => Promise<T>,
): Promise<T | null> {
  const host = await resolveHostById(hostId, userId);
  if (!host) return null;

  return getHostSemaphore(hostId).run(async () => {
    let conn: OneShotConn | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      conn = await connectOneShot(
        host as unknown as Parameters<typeof connectOneShot>[0],
        timeoutMs,
      );
      const c = conn;
      return await Promise.race([
        fn(c),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`remote host work timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (conn) {
        try {
          conn.end();
        } catch {
          /* ignore */
        }
      }
    }
  });
}
