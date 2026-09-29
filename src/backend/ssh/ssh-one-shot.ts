import ssh2Pkg from "ssh2";
import type { Client as SSHClient } from "ssh2";
import { sshLogger } from "../utils/logger.js";
import {
  CircuitBreakerOpenError,
  checkBreaker,
  recordFailure,
  recordSuccess,
} from "./host-circuit-breaker.js";

const { Client } = ssh2Pkg;

/**
 * Classify a connect-side error as a credential problem vs a
 * host-availability problem. Credential problems (auth failure, malformed
 * key, unsupported authType) do NOT trip the circuit breaker — retrying
 * with the same bad credentials against a healthy host would just repeat
 * the failure and open the breaker system-wide for that peer, blocking
 * every other legitimate caller.
 *
 * ssh2 tags authentication failures with `err.level === "client-authentication"`
 * (see ssh2/lib/client.js — emitted when the "None"/"password"/"publickey"
 * auth loop exhausts all methods). The sync config-error paths in
 * connectOneShot below never route through this classifier because they
 * short-circuit before the breaker gate.
 *
 * Exported for unit tests; not for other callers to consume.
 */
export function isCredentialError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const level = (err as { level?: unknown }).level;
  return level === "client-authentication";
}

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
 *
 * Circuit breaker (2026-09-29): every call consults the per-peer breaker
 * before opening a socket. When a peer has failed FAILURE_THRESHOLD
 * consecutive connects, further attempts short-circuit with
 * CircuitBreakerOpenError until an exponentially-backed-off probe window
 * elapses. See host-circuit-breaker.ts for the full state machine and
 * rationale (2026-09-29 workstation collapse). Callers can `instanceof`
 * check CircuitBreakerOpenError to log the refusal differently from a
 * real connect failure.
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

    // Circuit breaker gate — refuse the attempt entirely if the peer is
    // in a backoff window. No socket, no timer, no state on the ssh2 side.
    // Breaker state transitions happen inside recordSuccess/recordFailure
    // in finish() below.
    const gate = checkBreaker(peer);
    if (gate.allowed === false) {
      reject(new CircuitBreakerOpenError(peer, gate.nextAttemptAt));
      return;
    }

    const conn = new Client();
    let settled = false;

    /**
     * finishAsConfigError — sync exit path for credential/config errors
     * (invalid key parse, unsupported authType). These never reach the
     * network, so they must NOT count against the breaker or the
     * connect-failed log stream (which is scoped to host-availability
     * signals, not caller misconfiguration).
     */
    const finishAsConfigError = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sshLogger.warn(
        `[ssh-one-shot] config-error peer=${peer} err="${err.message}"`,
        { operation: "ssh_one_shot_config_error", peer, error: err.message },
      );
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      reject(err);
    };

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - tStart;
      if (err) {
        // Auth failures (bad password, wrong key, key passphrase mismatch)
        // are credential problems, not host-availability problems. Do NOT
        // trip the breaker — that would open it for every other caller of
        // this peer when the only fix is to update credentials.
        const isCredErr = isCredentialError(err);
        if (!isCredErr) {
          recordFailure(peer);
        }
        sshLogger.warn(
          `[ssh-one-shot] connect-failed peer=${peer} durationMs=${durationMs} err="${err.message}" credentialError=${isCredErr}`,
          {
            operation: "ssh_one_shot_connect_failed",
            peer,
            durationMs,
            error: err.message,
            credentialError: isCredErr,
          },
        );
        try {
          conn.end();
        } catch {
          /* ignore */
        }
        reject(err);
      } else {
        recordSuccess(peer);
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
        // Config error (invalid key material) — never touched the network,
        // must not trip the breaker.
        finishAsConfigError(e instanceof Error ? e : new Error("Invalid key"));
        return;
      }
    } else if (host.authType === "password" && host.password) {
      cfg.password = host.password;
    } else {
      // Config error (unsupported authType) — never touched the network,
      // must not trip the breaker.
      finishAsConfigError(
        new Error(`Unsupported authType: ${host.authType ?? "none"}`),
      );
      return;
    }

    try {
      conn.connect(cfg);
    } catch (e) {
      // Sync throws from ssh2's connect() are config-validation failures
      // (invalid config shape) — never touched the network, so route
      // through finishAsConfigError so the breaker doesn't trip on a
      // caller's malformed input.
      finishAsConfigError(e instanceof Error ? e : new Error("Connect failed"));
    }
  });
}
