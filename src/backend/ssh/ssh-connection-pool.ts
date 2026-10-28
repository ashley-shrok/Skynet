import { Client } from "ssh2";
import { sshLogger } from "../utils/logger.js";

interface PooledConnection {
  client: Client;
  lastUsed: number;
  inUse: boolean;
  hostKey: string;
  /** Who took it (caller's file:line) and when — logged when a waiter gives
   *  up, so a slot that is never handed back can be traced to its caller. */
  holder?: string;
  acquiredAt?: number;
}

/** How long a caller waits for a free connection when all of a host's are
 *  in use before failing with SshPoolBusyError. Without a bound, a host
 *  whose slots are never released hangs every later request silently. */
export const POOL_WAIT_TIMEOUT_MS = 10_000;

export class SshPoolBusyError extends Error {
  constructor(readonly waitedMs: number) {
    super(`no pooled SSH connection freed within ${waitedMs}ms`);
    this.name = "SshPoolBusyError";
  }
}

/** First stack frame outside this file, as `file.js:line`. */
function callerLabel(): string {
  const frames = (new Error().stack ?? "").split("\n").slice(1);
  for (const f of frames) {
    if (/ssh-connection-pool\.[jt]s:/.test(f)) continue;
    const m = f.match(/([^/\\(\s]+):(\d+):\d+\)?\s*$/);
    if (m) return `${m[1]}:${m[2]}`;
  }
  return "unknown";
}

// Client-birth-time table for diagnostic logging. Keyed weakly so a
// removed client is GC'd along with its timestamp. Exposed via
// `getClientBornAt` so downstream layers (e.g. tunnel-cache) can log
// per-request ageMs at forwardOut-time.
const clientBornAt = new WeakMap<Client, number>();

export function getClientBornAt(client: Client): number | null {
  return clientBornAt.get(client) ?? null;
}

class SSHConnectionPool {
  private connections = new Map<string, PooledConnection[]>();
  private maxConnectionsPerHost = 3;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(
      () => {
        this.cleanup();
      },
      2 * 60 * 1000,
    );
  }

  private isConnectionHealthy(client: Client): boolean {
    try {
      const sock = (
        client as unknown as {
          _sock?: { destroyed?: boolean; writable?: boolean };
        }
      )._sock;
      if (sock && (sock.destroyed || !sock.writable)) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private take(pooled: PooledConnection, holder: string): Client {
    const now = Date.now();
    pooled.inUse = true;
    pooled.lastUsed = now;
    pooled.acquiredAt = now;
    pooled.holder = holder;
    return pooled.client;
  }

  private dropUnhealthy(key: string, pooled: PooledConnection): void {
    sshLogger.warn("Removing unhealthy connection from pool", {
      operation: "pool_remove_dead",
      hostKey: key,
    });
    try {
      pooled.client.end();
    } catch {
      // expected
    }
    this.removeConnection(key, pooled.client);
  }

  private async addNew(
    key: string,
    factory: () => Promise<Client>,
    holder: string,
  ): Promise<Client> {
    const client = await factory();
    const pooled: PooledConnection = {
      client,
      lastUsed: Date.now(),
      inUse: false,
      hostKey: key,
    };
    const connections = this.connections.get(key) || [];
    connections.push(pooled);
    this.connections.set(key, connections);
    this.wireClientDiagnostics(client, pooled);
    return this.take(pooled, holder);
  }

  async getConnection(
    key: string,
    factory: () => Promise<Client>,
    waitTimeoutMs: number = POOL_WAIT_TIMEOUT_MS,
  ): Promise<Client> {
    const holder = callerLabel();
    const startedAt = Date.now();
    for (;;) {
      const connections = this.connections.get(key) || [];
      const available = connections.find((conn) => !conn.inUse);
      if (available) {
        if (this.isConnectionHealthy(available.client)) {
          return this.take(available, holder);
        }
        // Dead free slot: drop it and open a fresh one in its place. A
        // failed connect rejects to the caller rather than leaving it
        // waiting.
        this.dropUnhealthy(key, available);
        return this.addNew(key, factory, holder);
      }
      if (connections.length < this.maxConnectionsPerHost) {
        return this.addNew(key, factory, holder);
      }
      const waitedMs = Date.now() - startedAt;
      if (waitedMs >= waitTimeoutMs) {
        const now = Date.now();
        sshLogger.warn("ssh pool: wait for a free connection timed out", {
          operation: "ssh_pool_wait_timeout",
          hostKey: key,
          caller: holder,
          waitedMs,
          holders: connections.map((c) => ({
            holder: c.holder ?? "unknown",
            heldMs: c.acquiredAt !== undefined ? now - c.acquiredAt : -1,
          })),
        });
        throw new SshPoolBusyError(waitedMs);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  releaseConnection(key: string, client: Client): void {
    const connections = this.connections.get(key) || [];
    const pooled = connections.find((conn) => conn.client === client);
    if (pooled) {
      pooled.inUse = false;
      pooled.lastUsed = Date.now();
      pooled.holder = undefined;
      pooled.acquiredAt = undefined;
    }
  }

  // Mark a pooled client as freshly used WITHOUT toggling inUse. Consumers
  // that capture a Client reference for long-lived out-of-pool work (the
  // serve-url tunnel-cache captures the client at build time and calls
  // `forwardOut` on every incoming browser socket) should call this on
  // every use so cleanup()'s 10-min idle sweep does not close a client
  // that IS actively serving traffic. Without this, tunnel-cache-captured
  // clients look idle to the pool forever (getConnection / releaseConnection
  // fire ONCE at tunnel build), and cleanup() reliably closes them at the
  // first 2-min tick after 10 min of pool-visible idleness — surfaces as
  // `apps pane proxy: proxy-time-error` 502s to the browser.
  //
  // No-op if the client is no longer in the pool (already removed by
  // cleanup or a peer close). Safe to call at high frequency.
  markUsed(key: string, client: Client): void {
    const connections = this.connections.get(key);
    if (!connections) return;
    const pooled = connections.find((conn) => conn.client === client);
    if (pooled) {
      pooled.lastUsed = Date.now();
    }
  }

  private removeConnection(key: string, client: Client): void {
    const connections = this.connections.get(key);
    if (!connections) return;
    const filtered = connections.filter((c) => c.client !== client);
    if (filtered.length === 0) {
      this.connections.delete(key);
    } else {
      this.connections.set(key, filtered);
    }
  }

  // Stamp bornAt and attach diagnostic listeners (end / close / error) that
  // log lifetime + idle deltas at death. Consolidates the two identical
  // `on("end") / on("close")` blocks the two client-creation paths had
  // before. Called EXACTLY ONCE per Client. Duplicate death logs across
  // end→close or error→close pairings are intentional — timestamps + kind
  // disambiguate, and seeing the pairing is diagnostic signal.
  private wireClientDiagnostics(
    client: Client,
    pooled: PooledConnection,
  ): void {
    clientBornAt.set(client, Date.now());
    const emitDeath = (kind: "end" | "close" | "error", err?: unknown): void => {
      const bornAt = clientBornAt.get(client);
      const e = (err ?? {}) as {
        code?: string;
        name?: string;
        message?: string;
      };
      sshLogger.warn("ssh pool: client death", {
        operation: "ssh_pool_client_death",
        hostKey: pooled.hostKey,
        kind,
        ageMs: bornAt !== undefined ? Date.now() - bornAt : -1,
        idleMs: Date.now() - pooled.lastUsed,
        inUse: pooled.inUse,
        errCode: typeof e.code === "string" ? e.code : "",
        errName: typeof e.name === "string" ? e.name : "",
        errMessage: typeof e.message === "string" ? e.message : "",
      });
    };
    client.on("end", () => {
      emitDeath("end");
      this.removeConnection(pooled.hostKey, client);
    });
    client.on("close", () => {
      emitDeath("close");
      this.removeConnection(pooled.hostKey, client);
    });
    client.on("error", (err) => {
      emitDeath("error", err);
      // Do NOT remove on error — ssh2 emits "close" after "error", and
      // the "close" handler above will remove. Removing here too would
      // duplicate map churn without changing semantics.
    });
  }

  clearKeyConnections(key: string): void {
    const connections = this.connections.get(key) || [];
    for (const conn of connections) {
      try {
        conn.client.end();
      } catch {
        // expected
      }
    }
    this.connections.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000;

    for (const [hostKey, connections] of this.connections.entries()) {
      const activeConnections = connections.filter((conn) => {
        if (!conn.inUse && now - conn.lastUsed > maxAge) {
          try {
            conn.client.end();
          } catch {
            // expected
          }
          return false;
        }
        if (!this.isConnectionHealthy(conn.client)) {
          try {
            conn.client.end();
          } catch {
            // expected
          }
          return false;
        }
        return true;
      });

      if (activeConnections.length === 0) {
        this.connections.delete(hostKey);
      } else {
        this.connections.set(hostKey, activeConnections);
      }
    }
  }

  clearAllConnections(): void {
    for (const connections of this.connections.values()) {
      for (const conn of connections) {
        try {
          conn.client.end();
        } catch {
          // expected
        }
      }
    }
    this.connections.clear();
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.clearAllConnections();
  }
}

export const connectionPool = new SSHConnectionPool();

/**
 * Pool key for a resolved host row. Scoped to the row's owner: two users can
 * have rows with the same ip/port/username (one with bogus credentials), and
 * a key without the owner would hand the second user the first user's
 * authenticated connection. Every withConnection caller keyed on a host row
 * must use this.
 */
export function hostPoolKey(host: {
  id?: number;
  userId?: string;
  ip: string;
  port?: number | null;
  username: string;
}): string {
  const owner = host.userId ?? `row${host.id ?? "?"}`;
  return `${owner}:${host.ip}:${host.port ?? 22}:${host.username}`;
}

export async function withConnection<T>(
  key: string,
  factory: () => Promise<Client>,
  fn: (client: Client) => Promise<T>,
  waitTimeoutMs?: number,
): Promise<T> {
  const client = await connectionPool.getConnection(key, factory, waitTimeoutMs);
  try {
    return await fn(client);
  } finally {
    connectionPool.releaseConnection(key, client);
  }
}
