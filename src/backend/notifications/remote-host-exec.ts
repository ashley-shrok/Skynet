/**
 * One-shot SSH work against a fleet host, for the push-trigger's per-sender
 * lookups (which box holds an identity, what it's called).
 *
 * Access is checked AS `userId` (a host the user can't access is never
 * touched): the user must own the host or hold a read grant — the same gate
 * resolveHostById applies. Takes the host's SSH semaphore slot, opens a
 * one-shot connection, and races `fn` against `timeoutMs` so a hung host
 * can't stall a notification. The connection is always closed.
 *
 * Credentials: substrate hosts use the system-wrapped (CSKEK) connection
 * details from listSubstrateHosts, so a push does not depend on the target
 * user's per-user data key being in memory (it is only restored while they
 * have a live browser session — the push loop runs unattended). Hosts that
 * are not substrate hosts fall back to resolveHostById(hostId, userId),
 * which needs that key.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../database/db/index.js";
import { hosts } from "../database/db/schema.js";
import { listSubstrateHosts } from "../distributor/list-substrate-hosts.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { getHostSemaphore } from "../ssh/host-semaphore-registry.js";
import { databaseLogger } from "../utils/logger.js";

export type OneShotConn = Awaited<ReturnType<typeof connectOneShot>>;

/** How long the substrate-host conn-details snapshot is reused. */
export const SYSTEM_CONN_DETAILS_TTL_MS = 30_000;

export interface RemoteHostExecDeps {
  /** hostId → system-wrapped conn details for every substrate host. */
  listSystemConnDetails(): Promise<Map<number, Record<string, unknown>>>;
  /** Owner userId of the host row; null when the host does not exist. */
  getHostOwnerUserId(hostId: number): Promise<string | null>;
  /** Non-owner read grant (direct or via role). No per-user key needed. */
  canAccessHost(userId: string, hostId: number): Promise<boolean>;
  /** Per-user path; needs `userId`'s data key in memory. */
  resolveHostById(hostId: number, userId: string): Promise<unknown>;
  connect(host: unknown, timeoutMs: number): Promise<OneShotConn>;
  runWithSemaphore<T>(hostId: number, fn: () => Promise<T>): Promise<T>;
  now(): number;
}

export type WithRemoteHost = <T>(
  hostId: number,
  userId: string,
  timeoutMs: number,
  fn: (conn: OneShotConn) => Promise<T>,
) => Promise<T | null>;

/** Build a runner with its own conn-details cache. Exported for tests. */
export function createWithRemoteHost(deps: RemoteHostExecDeps): WithRemoteHost {
  let snapshot: { map: Map<number, Record<string, unknown>>; expiresAt: number } | null =
    null;
  let inFlight: Promise<Map<number, Record<string, unknown>>> | null = null;

  async function systemConnDetails(): Promise<Map<number, Record<string, unknown>>> {
    if (snapshot && snapshot.expiresAt > deps.now()) return snapshot.map;
    if (!inFlight) {
      inFlight = deps
        .listSystemConnDetails()
        .catch(() => new Map<number, Record<string, unknown>>())
        .then((map) => {
          snapshot = { map, expiresAt: deps.now() + SYSTEM_CONN_DETAILS_TTL_MS };
          return map;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  }

  /** Same gate as resolveHostById: owner, or an unexpired read grant. */
  async function userMayAccess(hostId: number, userId: string): Promise<boolean> {
    const owner = await deps.getHostOwnerUserId(hostId);
    if (owner === null) return false;
    if (owner === userId) return true;
    return deps.canAccessHost(userId, hostId);
  }

  return async function withRemoteHost(hostId, userId, timeoutMs, fn) {
    const system = (await systemConnDetails()).get(hostId);
    let host: unknown;
    if (system) {
      if (!(await userMayAccess(hostId, userId))) {
        databaseLogger.debug("remote host work: user has no access to host", {
          operation: "notifications_remote_host_access_denied",
          hostId,
          userId,
          credSource: "system",
        });
        return null;
      }
      host = system;
    } else {
      host = await deps.resolveHostById(hostId, userId);
    }
    const credSource = system ? "system" : "user";
    // debug: probes fan out to every host per unresolved sender.
    databaseLogger.debug("remote host work: host resolved", {
      operation: "notifications_remote_host_resolve",
      hostId,
      credSource,
      resolved: host != null,
    });
    if (!host) return null;

    return deps.runWithSemaphore(hostId, async () => {
      let conn: OneShotConn | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        conn = await deps.connect(host, timeoutMs);
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
  };
}

// ---------------------------------------------------------------------------
// Production wiring
// ---------------------------------------------------------------------------

/**
 * Run `fn` on a fresh connection to `hostId`. Returns null when the host is
 * unknown or `userId` lacks access; throws on connect failure, `fn` failure,
 * or timeout.
 */
export const withRemoteHost: WithRemoteHost = createWithRemoteHost({
  listSystemConnDetails: async () => {
    const list = await listSubstrateHosts({ getDb });
    return new Map(list.map((h) => [Number(h.id), h._connDetails]));
  },
  getHostOwnerUserId: async (hostId) => {
    const rows = await getDb()
      .select({ userId: hosts.userId })
      .from(hosts)
      .where(eq(hosts.id, hostId))
      .limit(1);
    return rows[0]?.userId ?? null;
  },
  canAccessHost: async (userId, hostId) => {
    const { PermissionManager } = await import("../utils/permission-manager.js");
    const access = await PermissionManager.getInstance().canAccessHost(
      userId,
      hostId,
      "read",
    );
    return access.hasAccess;
  },
  resolveHostById: (hostId, userId) => resolveHostById(hostId, userId),
  connect: (host, timeoutMs) =>
    connectOneShot(host as unknown as Parameters<typeof connectOneShot>[0], timeoutMs),
  runWithSemaphore: (hostId, fn) => getHostSemaphore(hostId).run(fn),
  now: () => Date.now(),
});
