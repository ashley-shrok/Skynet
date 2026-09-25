import ssh2Pkg from "ssh2";
import type { Client as SSHClient } from "ssh2";
import { sshLogger } from "../utils/logger.js";

const { Client } = ssh2Pkg;

/**
 * Open a fresh ssh2 Client to a host for one-shot exec usage.
 *
 * Intentionally minimal: only supports password and key auth. Skips
 * jump hosts, SOCKS5, port knocking, and host-key prompts. Callers
 * use this for short server-side queries like `tmux list-sessions`
 * and should `client.end()` themselves once done.
 *
 * Returns a Promise that resolves to a connected Client, or rejects
 * on connect error / timeout. The host-key fingerprint is not checked
 * — this is fine for server-side fan-out where there's no UI to prompt
 * and any spoofing already requires being inside the user's tailnet.
 */
export function connectOneShot(
  host: {
    ip: string;
    port?: number | null;
    sshPort?: number | null;
    username: string;
    authType?: string;
    password?: string | null;
    key?: string | null;
    keyPassword?: string | null;
  },
  timeoutMs: number,
): Promise<SSHClient> {
  return new Promise((resolve, reject) => {
    // 2026-09-25 (tina): timing diag — paired with execCommand's phase timing
    // in tmux-helper.ts. On workstation cold-attach bursts the discovery exec
    // hits 5s ceilings per attempt; we don't yet know whether the SSH connect
    // itself is what's slow or the subsequent exec on an established
    // connection. Emit a single connect-summary log so a reload burst
    // produces one line per pane with the peer + duration.
    const tStart = Date.now();
    const peer = `${host.ip}:${host.sshPort ?? host.port ?? 22}`;
    const conn = new Client();
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - tStart;
      if (err) {
        sshLogger.warn(
          `[ssh-one-shot] connect-failed peer=${peer} durationMs=${durationMs} err="${err.message}"`,
          { operation: "ssh_one_shot_connect_failed", peer, durationMs, error: err.message },
        );
        try {
          conn.end();
        } catch {
          /* ignore */
        }
        reject(err);
      } else {
        // Only log slow-side connects — a healthy connect is <200ms; anything
        // >500ms is worth eyeballing in a reload-burst trace.
        if (durationMs >= 500) {
          sshLogger.info(
            `[ssh-one-shot] connect-slow peer=${peer} durationMs=${durationMs}`,
            { operation: "ssh_one_shot_connect_slow", peer, durationMs },
          );
        }
        resolve(conn);
      }
    };

    const timer = setTimeout(
      () => finish(new Error(`Connect timeout after ${timeoutMs}ms`)),
      timeoutMs,
    );

    conn.on("ready", () => finish());
    conn.on("error", (err: Error) => finish(err));

    const cfg: Record<string, unknown> = {
      host: host.ip,
      port: host.sshPort ?? host.port ?? 22,
      username: host.username,
      readyTimeout: timeoutMs,
      tcpKeepAlive: true,
      // SSH-level keepalive (2026-09-25 tina): ssh2 sends a
      // `keepalive@openssh.com` global request every 30s so the peer
      // sshd doesn't kill the connection during idle periods. Without
      // this, long-lived pooled connections (serve-url tunnels, video
      // playback with `<video>` pause states, any workflow that leaves
      // a tunnel idle for minutes) get silently reaped on the peer
      // side and the next request through the pool hits
      // `Error: Not connected` from `forwardOut`. `tcpKeepAlive` above
      // is TCP-level (probes for a dead peer host); this is SSH-level
      // (heartbeats the SSH channel itself). Matches docker-console.ts's
      // long-standing shape.
      keepaliveInterval: 30000,
      // After 3 consecutive missed keepalives (~90s of unreachable peer
      // at 30s interval), fail the connection fast rather than hanging
      // waiting for eventual TCP timeout. Consumers already re-drive
      // via the pool's health check + connectOneShot fallback.
      keepaliveCountMax: 3,
      // Server-side query; no UI to verify host keys here. Anyone able
      // to spoof has already breached the tailnet.
      hostVerifier: () => true,
    };

    if (host.authType === "key" && host.key) {
      try {
        const cleanKey = host.key
          .trim()
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n");
        cfg.privateKey = Buffer.from(cleanKey, "utf8");
        if (host.keyPassword) cfg.passphrase = host.keyPassword;
      } catch (e) {
        finish(e instanceof Error ? e : new Error("Invalid key"));
        return;
      }
    } else if (host.authType === "password" && host.password) {
      cfg.password = host.password;
    } else {
      finish(new Error(`Unsupported authType: ${host.authType ?? "none"}`));
      return;
    }

    try {
      conn.connect(cfg);
    } catch (e) {
      finish(e instanceof Error ? e : new Error("Connect failed"));
    }
  });
}
