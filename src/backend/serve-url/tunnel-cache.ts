/**
 * Phase 103 Plan 03a — Per-target SSH tunnel cache for serve-URL reverse proxy.
 *
 * For each `(hostname, port)` target the agent constructs into a serve URL,
 * open exactly one SSH tunnel: a local TCP listener on 127.0.0.1 that pipes
 * bytes over `sshClient.forwardOut` into the agent's port on the agent's
 * box. Cache the resulting `{ server, tunnelPort }` keyed by
 * `${hostname}:${port}` so repeat requests (page load → many asset fetches
 * → HMR WS) all share the same tunnel instance.
 *
 * SSH reuse invariant (R&D GOTCHA 3): the underlying SSH client comes from
 * `withConnection(poolKey, factory, cb)` in ssh-connection-pool.ts. Do NOT
 * open our own ssh2 Client here — the pool caps at 3 conns × 10 MaxSessions
 * per host (~30 concurrent channels), plenty for serve-URL load. A parallel
 * pool would defeat that cap and blow past OpenSSH's MaxSessions on the
 * agent's sshd.
 *
 * No-eviction invariant (D-16): unlike ssh-connection-pool.ts, this cache
 * has NO periodic sweep and NO cleanup() method. Per-target tunnel =
 * 1 net.Server + 1 SSH channel from the shared pool. Realistic worst case
 * is ~50-100 (host, port) pairs per user for the container lifetime —
 * well under any resource limit. Add eviction only if pressure surfaces
 * post-ship (T-103-14 disposition = accept).
 *
 * Transparent recovery (D-15): when a tunnel dies (network flap, sshd
 * restart, target reboot), the local server's `close` event evicts the
 * Map entry. The NEXT request for that target rebuilds a fresh tunnel
 * through `withConnection` (which itself health-checks its pooled
 * client). In-flight WebSockets close with a transport-level close code
 * so the client's reconnect logic knows to retry.
 *
 * Info-leak invariant (T-40-05): log messages carry only `target`
 * (cacheKey) + `duration` + `errorClass` (Error.name). NEVER include
 * err.message, stack traces, or absolute paths.
 */

import net from "node:net";
import type { Client as SSHClient } from "ssh2";
import { withConnection } from "../ssh/ssh-connection-pool.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { sshLogger } from "../utils/logger.js";
import type { ServeTarget } from "./types.js";

/* ------------------------------------------------------------------------ */
/*  Constants                                                               */
/* ------------------------------------------------------------------------ */

/** SSH connect timeout for factory-on-miss calls (ms). Matches the same
 *  constant name/value used across the rest of the backend. */
const SSH_CONNECT_TIMEOUT_MS = 5_000;

/* ------------------------------------------------------------------------ */
/*  Public types                                                            */
/* ------------------------------------------------------------------------ */

/**
 * A live tunnel instance. `tunnelPort` is what Plan 03b's proxy-factory
 * points `createProxyMiddleware({ target })` at; the `server` reference is
 * kept so callers (Plan 03b) can attach `error` / `close` listeners for
 * transparent-recovery signaling. `sshPoolKey` is exposed so callers can
 * correlate a tunnel with its SSH pool entry when diagnosing.
 */
export interface TunnelInstance {
  server: net.Server;
  tunnelPort: number;
  sshPoolKey: string;
}

/* ------------------------------------------------------------------------ */
/*  Cache implementation                                                    */
/* ------------------------------------------------------------------------ */

class TunnelCache {
  /** Cache key format: `${target.hostname}:${target.port}` (the AGENT's
   *  port on the AGENT's box — NOT the SSH port, and NOT the same as the
   *  SSH pool key which incorporates host.ip + host.username). */
  private cache = new Map<string, TunnelInstance>();

  /**
   * In-flight promises for cache misses so two concurrent requests for the
   * same target coalesce into one tunnel open instead of racing to build
   * two servers on two random ports.
   */
  private inFlight = new Map<string, Promise<TunnelInstance>>();

  async getOrCreate(target: ServeTarget): Promise<TunnelInstance> {
    const cacheKey = `${target.hostname}:${target.port}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const already = this.inFlight.get(cacheKey);
    if (already) return already;

    const opening = this.openTunnel(target, cacheKey);
    this.inFlight.set(cacheKey, opening);
    try {
      const instance = await opening;
      this.cache.set(cacheKey, instance);
      return instance;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  /**
   * Test-only helper for the future integration test (Plan 04) — exposes
   * the cached size so a test can assert the coalescing invariant. NOT
   * used by production code paths.
   */
  size(): number {
    return this.cache.size;
  }

  private async openTunnel(
    target: ServeTarget,
    cacheKey: string,
  ): Promise<TunnelInstance> {
    const startEpoch = Date.now();
    const host = target.host;
    // Pool key format matches pretty-view-fetch-host-file.ts L249 so the
    // serve-url tunnel shares an SSH connection with any Phase 78 file-URL
    // fetch to the same host/user pair.
    const sshPoolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;

    try {
      const instance = await withConnection<TunnelInstance>(
        sshPoolKey,
        () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
        async (sshClient) => this.buildLocalServer(sshClient, target, sshPoolKey, cacheKey),
      );
      sshLogger.info("serve-url tunnel: opened", {
        operation: "serve_url_tunnel_open",
        target: cacheKey,
        duration: Date.now() - startEpoch,
      });
      return instance;
    } catch (err) {
      sshLogger.warn("serve-url tunnel: open failed", {
        operation: "serve_url_tunnel_open_failed",
        target: cacheKey,
        errorClass: err instanceof Error ? err.name : "unknown",
        duration: Date.now() - startEpoch,
      });
      throw err;
    }
  }

  /**
   * Build a local net.Server that pipes each accepted socket through
   * `sshClient.forwardOut` to the agent's port. Pattern matches
   * guacamole/routes.ts:321-368. Difference from that pattern: no
   * setTimeout auto-cleanup (per D-16); on-close cache eviction wired in
   * (per D-15).
   */
  private buildLocalServer(
    sshClient: SSHClient,
    target: ServeTarget,
    sshPoolKey: string,
    cacheKey: string,
  ): Promise<TunnelInstance> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((sock) => {
        // Reach the agent's port at `127.0.0.1:target.port` FROM THE SSH
        // SERVER'S PERSPECTIVE (i.e. localhost of the box we SSH'd into,
        // which is the agent's box). We do NOT reference target.host.ip
        // here — that's the box's tailnet address, not what the agent's
        // process is bound to. Agents bind to 127.0.0.1 by convention.
        sshClient.forwardOut(
          "127.0.0.1",
          0,
          "127.0.0.1",
          target.port,
          (err, stream) => {
            if (err) {
              sock.destroy();
              return;
            }
            sock.pipe(stream).pipe(sock);
            sock.on("error", () => stream.destroy());
            stream.on("error", () => sock.destroy());
          },
        );
      });

      // On any local server close (whether triggered by our own code or by
      // upstream tunnel death propagating through forwardOut failures), evict
      // the cache entry so the NEXT request for this target rebuilds. This
      // is the D-15 transparent-recovery hook.
      server.on("close", () => {
        this.cache.delete(cacheKey);
        sshLogger.warn("serve-url tunnel: closed", {
          operation: "serve_url_tunnel_close",
          target: cacheKey,
        });
      });

      server.once("error", (err) => {
        // Listen error (e.g. EADDRINUSE — unlikely because we use port 0):
        // reject the open, cache stays clean.
        reject(err);
      });

      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as net.AddressInfo;
        resolve({
          server,
          tunnelPort: addr.port,
          sshPoolKey,
        });
      });
    });
  }
}

/**
 * Singleton per D-16 (container-lifetime cache; no eviction). Same
 * singleton-export shape as ssh-connection-pool.ts:212's `connectionPool`.
 */
export const tunnelCache = new TunnelCache();
