/**
 * Download / inline-view a file that must live under a fixed root on a
 * managed host (a skill directory, a runbook directory). Used by the
 * skills / runbooks editor `GET /download` routes.
 *
 * Path safety: callers validate names + the relative path with their own
 * regex gates; this helper then resolves both the root and the file with
 * SFTP realpath and refuses anything whose resolved target is outside the
 * resolved root (symlink escape), plus /proc, /sys and /dev.
 */

import type { Request, Response } from "express";
import type { Readable } from "node:stream";
import type { Client as SSHClientType } from "ssh2";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { sendSftpFile } from "./sftp-file-response.js";

const SSH_CONNECT_TIMEOUT_MS = 5_000;
/** Bounds connect-to-first-byte; cleared once streaming starts. */
const SETUP_TIMEOUT_MS = 15_000;
/** Streaming is constant-memory; this is a wrong-file sanity ceiling. */
const MAX_BYTES = 10 * 1024 ** 3; // 10 GiB
const FORBIDDEN_PATH_RE = /^\/(proc|sys|dev)(\/|$)/;

type SftpLike = {
  realpath(p: string, cb: (err: Error | null, resolved: string) => void): void;
  stat(
    p: string,
    cb: (err: (Error & { code?: number }) | null, stats?: { size: number; isFile: () => boolean }) => void,
  ): void;
  createReadStream(p: string, options?: { start?: number; end?: number }): Readable;
};

class DownloadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function openSftp(conn: SSHClientType): Promise<SftpLike> {
  return new Promise((resolve, reject) => {
    (conn as unknown as { sftp: (cb: (err: Error | null, s: SftpLike) => void) => void }).sftp(
      (err, sftp) => (err ? reject(err) : resolve(sftp)),
    );
  });
}

function realpath(sftp: SftpLike, p: string): Promise<string> {
  return new Promise((resolve, reject) =>
    sftp.realpath(p, (err, r) => (err ? reject(new DownloadError(404, "not found")) : resolve(r))),
  );
}

function stat(sftp: SftpLike, p: string): Promise<{ size: number; isFile: () => boolean }> {
  return new Promise((resolve, reject) =>
    sftp.stat(p, (err, s) => (err || !s ? reject(new DownloadError(404, "not found")) : resolve(s))),
  );
}

export interface SendRemoteFileOptions {
  req: Request;
  res: Response;
  host: Parameters<typeof connectOneShot>[0];
  /**
   * Given the remote $HOME, the root directory and the file's absolute path.
   * Return null to reject (400).
   */
  buildPaths: (home: string) => { root: string; absPath: string } | null;
  /** inline=1: browser-viewable types inline; otherwise always a download. */
  inline: boolean;
}

/**
 * Stream the file as the response. Errors before streaming become JSON
 * `{ error }` with 400 / 404 / 413 / 502; after streaming starts the
 * response is torn down. Never throws.
 */
export async function sendRemoteFileUnderRoot(opts: SendRemoteFileOptions): Promise<{ ok: boolean; error?: string }> {
  const { req, res } = opts;
  let conn: SSHClientType | null = null;
  const timer = setTimeout(() => {
    if (!res.headersSent) res.status(504).json({ error: "timed out" });
    conn?.end();
  }, SETUP_TIMEOUT_MS);

  try {
    try {
      conn = (await connectOneShot(opts.host, SSH_CONNECT_TIMEOUT_MS)) as SSHClientType;
    } catch {
      throw new DownloadError(502, "SSH connect failed");
    }
    const sftp = await openSftp(conn);
    const home = await realpath(sftp, ".");
    const paths = opts.buildPaths(home);
    if (!paths) throw new DownloadError(400, "invalid path");

    const root = await realpath(sftp, paths.root);
    const resolved = await realpath(sftp, paths.absPath);
    if (!resolved.startsWith(root + "/") || FORBIDDEN_PATH_RE.test(resolved)) {
      throw new DownloadError(400, "path escapes root");
    }
    const st = await stat(sftp, resolved);
    if (!st.isFile()) throw new DownloadError(400, "not a file");
    if (st.size > MAX_BYTES) throw new DownloadError(413, "too large");
    if (res.headersSent) return { ok: false, error: "timed out" };

    await sendSftpFile({
      req,
      res,
      sftp,
      path: resolved,
      size: st.size,
      filename: paths.absPath.split("/").pop() ?? "file",
      disposition: opts.inline ? "auto" : "attachment",
      onStreamStart: () => clearTimeout(timer),
    });
    return { ok: true };
  } catch (err) {
    const status = err instanceof DownloadError ? err.status : 502;
    const message = err instanceof DownloadError ? err.message : "SFTP error";
    if (!res.headersSent) res.status(status).json({ error: message });
    else res.destroy();
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
    try {
      conn?.end();
    } catch {
      /* best-effort cleanup */
    }
  }
}
