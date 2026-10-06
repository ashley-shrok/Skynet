/**
 * desktop-tunnel — SSH port-forwards that let guacd reach an identity's
 * desktop VNC server.
 *
 * Each identity's desktop (substrate/scripts/agent-desktop) runs Xvnc with
 * `-localhost`: VNC listens on the agent host's loopback only. guacd runs in
 * its own container, so it can reach neither that loopback nor a listener on
 * this container's 127.0.0.1. So for each desktop we:
 *
 *   1. find the address guacd can reach us on — open a probe socket to guacd
 *      and read its localAddress (the interface on the shared network);
 *   2. listen on THAT address only, on an ephemeral port, and accept
 *      connections only from guacd's own address;
 *   3. pipe each accepted connection through `forwardOut` on a dedicated SSH
 *      connection to 127.0.0.1:<vncPort> on the agent host.
 *
 * VNC auth still applies on top (per-identity password in the token), and a
 * tunnel lives only while it is used: it closes IDLE_CLOSE_MS after its last
 * connection ends (the same timer gives guacd a grace period to connect after
 * the token is issued), or when its SSH connection drops. Tokens pointing at a
 * closed tunnel are dead, which bounds their replay window.
 *
 * Tunnels are shared per (host, identity, vncPort): opening the tab twice
 * reuses one SSH connection.
 */

import net from "net";
import type { Client as SSHClient } from "ssh2";
import { guacLogger } from "../utils/logger.js";

/** Close a tunnel this long after its last VNC connection ends. */
export const IDLE_CLOSE_MS = 60_000;
/** Upper bound on simultaneously open tunnels (one per watched desktop). */
export const MAX_TUNNELS = 32;

export interface GuacdEndpoint {
  host: string;
  port: number;
}

export interface DesktopTunnel {
  /** Address guacd should connect to (this container, on guacd's network). */
  host: string;
  port: number;
}

interface TunnelEntry {
  server: net.Server;
  client: SSHClient;
  host: string;
  port: number;
  active: number;
  idleTimer: NodeJS.Timeout | null;
  closed: boolean;
}

const tunnels = new Map<string, TunnelEntry>();
const pending = new Map<string, Promise<DesktopTunnel>>();

/** Strip the IPv4-mapped prefix so "::ffff:10.0.0.2" compares equal to "10.0.0.2". */
function normalizeAddr(addr: string | undefined): string {
  if (!addr) return "";
  return addr.startsWith("::ffff:") ? addr.slice(7) : addr;
}

/**
 * Which local address can guacd reach us on, and what is guacd's own address?
 * Answered by the kernel's routing for a real connection to guacd.
 */
export function probeGuacdRoute(
  guacd: GuacdEndpoint,
  timeoutMs = 3_000,
): Promise<{ localAddress: string; guacdAddress: string }> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: guacd.host, port: guacd.port });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("guacd_unreachable"));
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      const out = {
        localAddress: normalizeAddr(sock.localAddress),
        guacdAddress: normalizeAddr(sock.remoteAddress),
      };
      sock.destroy();
      resolve(out);
    });
    sock.once("error", () => {
      clearTimeout(timer);
      sock.destroy();
      reject(new Error("guacd_unreachable"));
    });
  });
}

function closeTunnel(key: string, reason: string): void {
  const t = tunnels.get(key);
  if (!t || t.closed) return;
  t.closed = true;
  tunnels.delete(key);
  if (t.idleTimer) clearTimeout(t.idleTimer);
  t.server.close();
  try {
    t.client.end();
  } catch {
    /* already gone */
  }
  guacLogger.info("Desktop tunnel closed", {
    operation: "desktop_tunnel_close",
    key,
    reason,
  });
}

function armIdleTimer(key: string, t: TunnelEntry): void {
  if (t.idleTimer) clearTimeout(t.idleTimer);
  t.idleTimer = setTimeout(() => {
    if (t.active === 0) closeTunnel(key, "idle");
  }, IDLE_CLOSE_MS);
  t.idleTimer.unref?.();
}

/**
 * Get (or open) the tunnel for one desktop.
 *
 * @param key       stable id for the desktop, e.g. `${hostId}:${identityKey}:${vncPort}`
 * @param connect   opens a dedicated SSH connection to the agent host (not
 *                  pooled: the tunnel holds it for as long as it lives)
 * @param vncPort   VNC port on the agent host's loopback
 * @param guacd     where guacd listens (from the guac_url setting)
 */
export async function getDesktopTunnel(
  key: string,
  connect: () => Promise<SSHClient>,
  vncPort: number,
  guacd: GuacdEndpoint,
): Promise<DesktopTunnel> {
  const existing = tunnels.get(key);
  if (existing && !existing.closed) {
    armIdleTimer(key, existing); // fresh grace period for the new token
    return { host: existing.host, port: existing.port };
  }
  const inflight = pending.get(key);
  if (inflight) return inflight;

  const p = (async () => {
    if (tunnels.size >= MAX_TUNNELS) throw new Error("too_many_tunnels");
    const route = await probeGuacdRoute(guacd);
    const client = await connect();

    const entry: TunnelEntry = {
      server: net.createServer(),
      client,
      host: route.localAddress,
      port: 0,
      active: 0,
      idleTimer: null,
      closed: false,
    };

    entry.server.on("connection", (sock) => {
      if (normalizeAddr(sock.remoteAddress) !== route.guacdAddress) {
        guacLogger.warn("Desktop tunnel refused a non-guacd connection", {
          operation: "desktop_tunnel_refused",
          key,
        });
        sock.destroy();
        return;
      }
      entry.active++;
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        entry.active--;
        if (entry.active === 0 && !entry.closed) armIdleTimer(key, entry);
      };
      sock.on("close", release);
      sock.on("error", () => sock.destroy());
      client.forwardOut("127.0.0.1", 0, "127.0.0.1", vncPort, (err, stream) => {
        if (err) {
          guacLogger.warn("Desktop tunnel forwardOut failed", {
            operation: "desktop_tunnel_forward_error",
            key,
            error: err.message,
          });
          sock.destroy();
          return;
        }
        stream.on("error", () => sock.destroy());
        stream.on("close", () => sock.destroy());
        sock.on("close", () => stream.destroy());
        sock.pipe(stream).pipe(sock);
      });
    });

    client.on("close", () => closeTunnel(key, "ssh_closed"));
    client.on("error", () => closeTunnel(key, "ssh_error"));

    await new Promise<void>((resolve, reject) => {
      entry.server.once("error", reject);
      entry.server.listen(0, route.localAddress, () => {
        entry.server.off("error", reject);
        resolve();
      });
    }).catch((err) => {
      try {
        client.end();
      } catch {
        /* ignore */
      }
      throw err;
    });

    entry.port = (entry.server.address() as net.AddressInfo).port;
    tunnels.set(key, entry);
    armIdleTimer(key, entry);
    guacLogger.info("Desktop tunnel opened", {
      operation: "desktop_tunnel_open",
      key,
      listen: `${entry.host}:${entry.port}`,
    });
    return { host: entry.host, port: entry.port };
  })();

  pending.set(key, p);
  try {
    return await p;
  } finally {
    pending.delete(key);
  }
}

/** Test hook: close every tunnel. */
export function closeAllDesktopTunnels(): void {
  for (const key of [...tunnels.keys()]) closeTunnel(key, "shutdown");
}

/** Test hook: how many tunnels are open. */
export function openDesktopTunnelCount(): number {
  return tunnels.size;
}
