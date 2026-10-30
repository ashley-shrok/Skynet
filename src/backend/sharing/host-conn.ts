/**
 * host-conn.ts — run a request's work against one of the caller's machines:
 * LOCAL reads the bind-mount (no SSH); REMOTE opens one SSH connection under
 * the machine's semaphore slot and closes it after.
 */
import type { Client as SSHClientType } from "ssh2";
import { resolveHostById } from "../ssh/host-resolver.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { getHostSemaphore } from "../ssh/host-semaphore-registry.js";
import { isLocalHostId } from "../claude-session/identity-artifact-reader.js";
import { sshLogger } from "../utils/logger.js";

const SSH_CONNECT_TIMEOUT_MS = 3000;

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Throws HttpError 404 (not the caller's host) or 504 (unreachable). */
export async function withHost<T>(
  hostId: number,
  userId: string,
  fn: (conn: SSHClientType | null) => Promise<T>,
): Promise<T> {
  const host = await resolveHostById(hostId, userId);
  if (!host) throw new HttpError(404, "Host not found");
  if (isLocalHostId(hostId)) return fn(null);
  return getHostSemaphore(hostId).run(async () => {
    let conn: SSHClientType;
    try {
      conn = (await connectOneShot(
        host as unknown as Parameters<typeof connectOneShot>[0],
        SSH_CONNECT_TIMEOUT_MS,
      )) as SSHClientType;
    } catch (err) {
      sshLogger.warn("sharing: couldn't connect to the machine", {
        operation: "sharing_host_connect_failed",
        hostId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new HttpError(504, "Host unreachable");
    }
    try {
      return await fn(conn);
    } finally {
      try {
        conn.end();
      } catch {
        /* ignore */
      }
    }
  });
}
