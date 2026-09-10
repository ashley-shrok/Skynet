/**
 * Shared error classifier for serve URL failures. Used by both the
 * tunnel-open path (serve-route.ts) and the proxy-time path
 * (proxy-factory.ts's on.error handler).
 *
 * Discriminates via structured fields ONLY (code / level / name); never
 * touches Error body text or stack traces so classification cannot become
 * an info-leak channel. Same D-14 taxonomy either side.
 *
 * Categories:
 *  - ECONNREFUSED               → port_not_listening (tunnel opened but the
 *                                 forwarded connection was refused at the
 *                                 target — port isn't listening).
 *  - ETIMEDOUT / EHOSTUNREACH / → host_unreachable (network flap, target
 *    ENETUNREACH                  reboot, DNS, or the SSH connect never
 *                                 completed).
 *  - ssh2 client-authentication → ssh_failure (auth mismatch — bad key,
 *    or SSH_* code family or      wrong username, sshd rejected).
 *    ssh2 ClientError name
 *  - Anything else              → ssh_failure (catchall).
 */
import type { ErrorClass } from "./types.js";

type ClassifiableError = {
  code?: string;
  level?: string;
  name?: string;
};

export function classifyTunnelError(err: unknown): ErrorClass {
  const e = (err ?? {}) as ClassifiableError;
  const code = typeof e.code === "string" ? e.code : "";
  const level = typeof e.level === "string" ? e.level : "";
  const name = typeof e.name === "string" ? e.name : "";

  if (code === "ECONNREFUSED") return "port_not_listening";
  // ECONNRESET on the proxy-time path is almost always the SSH tunnel's
  // forward-out getting CHANNEL_OPEN_FAILURE (reason: CONNECT_FAILED) from
  // the target's sshd — target port refused the connection. Bucket into
  // port_not_listening; the tunnel-open path never sees ECONNRESET (its
  // failures land on the specific SSH-* / connect-time codes above).
  // Discovered 2026-09-10 UAT — killed http.server on thenasty:8899 while
  // the SSH tunnel was already up; the proxy hit ECONNRESET.
  if (code === "ECONNRESET") return "port_not_listening";
  if (code === "ETIMEDOUT" || code === "EHOSTUNREACH" || code === "ENETUNREACH") {
    return "host_unreachable";
  }
  if (level === "client-authentication") return "ssh_failure";
  if (code.startsWith("SSH_")) return "ssh_failure";
  if (name === "ClientError") return "ssh_failure";
  return "ssh_failure";
}
