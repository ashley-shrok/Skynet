/**
 * Phase 118 Plan 118-01 (D-04, D-16, D-17, D-19, D-20, D-21, D-22):
 * SFTP-backed workspace CRUD router.
 *
 * Delivers 9 REST endpoints under /workspace (mounted in database.ts):
 *   POST   /list           — directory listing
 *   POST   /read-file      — stat + readFile (cap 2 MB)
 *   PUT    /write-file     — atomic write (tmp+rename)
 *   DELETE /entry          — unlink or rmdir (ENOTEMPTY → 409 not_empty)
 *   POST   /rename         — sftp.rename (both paths validated)
 *   POST   /mkdir          — sftp.mkdir (exists → 409 already_exists)
 *   POST   /create-file    — createWriteStream flags "wx" (exists → 409 already_exists)
 *   POST   /upload         — multer memoryStorage, SFTP createWriteStream + rename
 *   GET    /download       — readFile (cap 500 MB), Content-Disposition attachment
 *
 * Every endpoint enforces the 9-step chain:
 *   1. Body/query validation → 400 invalid_body
 *   2. IDENTITY_KEY_RE.test(identityKey) → 400 invalid_identity_key  (one call per endpoint)
 *   3. Static traversal check → 400 path_traversal
 *   4. resolveHostById(hostId, userId) → 404 unknown_host
 *   5. permissionManager.canAccessHost(userId, hostId, "read"|"write") → 403 permission_denied
 *   6. withConnection → openSftp → sftpRealpath(".")  (tilde expansion — SFTP is tilde-blind)
 *   7. Build workspaceRoot + absolutePath
 *   8. Post-realpath re-check (symlink escape + FORBIDDEN_PATH_RE)
 *   9. SFTP operation
 *  10. Catch → { error: classifyErrorToClass(err) } — NEVER err.message (T-40-05)
 *
 * D-04 (blind stance): imports contain zero agent-notification subsystems.
 * No agent-facing side effects on any success path.
 */

import express from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { sshLogger } from "../../utils/logger.js";
import { withConnection } from "../../ssh/ssh-connection-pool.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { IDENTITY_KEY_RE } from "../../claude-session/identity-artifact-reader.js";
import type { Client as SSHClientType } from "ssh2";

/* ------------------------------------------------------------------------ */
/*  Constants                                                               */
/* ------------------------------------------------------------------------ */

/** Max bytes for inline read-file response (2 MB). */
const MAX_READ_BYTES = 2_000_000;

/** Max bytes for download endpoint (500 MB). */
const MAX_DOWNLOAD_BYTES = 500_000_000;

/** Max bytes for upload (50 MB via multer limits + nginx client_max_body_size). */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** SSH connect timeout for connectOneShot (ms). */
const SSH_CONNECT_TIMEOUT_MS = 5_000;

/** Whole-operation SFTP timeout (ms). */
const SFTP_OP_TIMEOUT_MS = 8_000;

/**
 * Forbidden-path regex — applied at BOTH the pre-SSH boundary AND inside
 * the SFTP callback (against sftp.realpath resolved target) to close the
 * T-78-07 symlink-escape gap.
 */
const FORBIDDEN_PATH_RE = /^\/(proc|sys|dev)(\/|$)/;

/* ------------------------------------------------------------------------ */
/*  Wire-up: auth middleware + permission manager                           */
/* ------------------------------------------------------------------------ */

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const permissionManager = PermissionManager.getInstance();

/* ------------------------------------------------------------------------ */
/*  Dedicated multer instance (Pitfall 6 — NOT the .sqlite-filtered         */
/*  global upload from database.ts)                                         */
/* ------------------------------------------------------------------------ */

const workspaceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

/* ------------------------------------------------------------------------ */
/*  SFTP duck type + promise wrappers                                        */
/*  (copied from pretty-view-fetch-host-file.ts + extended for workspace)   */
/* ------------------------------------------------------------------------ */

type SftpLike = {
  realpath(p: string, cb: (err: Error | null, resolved: string) => void): void;
  stat(
    p: string,
    cb: (
      err: (Error & { code?: number }) | null,
      stats?: { size: number; isFile: () => boolean; isDirectory: () => boolean },
    ) => void,
  ): void;
  readFile(p: string, cb: (err: Error | null, data: Buffer) => void): void;
  readdir(
    p: string,
    cb: (err: Error | null, list: SftpEntry[]) => void,
  ): void;
  mkdir(p: string, cb: (err: Error | null) => void): void;
  unlink(p: string, cb: (err: Error | null) => void): void;
  rmdir(p: string, cb: (err: Error | null) => void): void;
  rename(from: string, to: string, cb: (err: Error | null) => void): void;
  createWriteStream(
    p: string,
    opts?: { flags?: string },
  ): NodeJS.WritableStream & {
    on(event: "close", cb: () => void): NodeJS.WritableStream;
    on(event: "error", cb: (err: Error) => void): NodeJS.WritableStream;
  };
};

type SftpEntry = {
  filename: string;
  attrs: {
    size: number;
    mtime: number;
    mode: number;
    isFile: () => boolean;
    isDirectory: () => boolean;
    isSymbolicLink: () => boolean;
  };
};

function openSftp(sshConn: SSHClientType): Promise<SftpLike> {
  return new Promise((resolve, reject) => {
    (
      sshConn as unknown as {
        sftp: (cb: (err: Error | null, sftp: SftpLike) => void) => void;
      }
    ).sftp((err, sftp) => {
      if (err) return reject(err);
      resolve(sftp);
    });
  });
}

function sftpRealpath(sftp: SftpLike, p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sftp.realpath(p, (err, resolved) => {
      if (err) return reject(err);
      resolve(resolved);
    });
  });
}

function sftpStat(
  sftp: SftpLike,
  p: string,
): Promise<{ size: number; isFile: () => boolean; isDirectory: () => boolean }> {
  return new Promise((resolve, reject) => {
    sftp.stat(p, (err, stats) => {
      if (err || !stats) return reject(err ?? new Error("stat failed"));
      resolve(stats);
    });
  });
}

function sftpReadFile(sftp: SftpLike, p: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(p, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

function sftpReaddir(sftp: SftpLike, p: string): Promise<SftpEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(p, (err, list) => {
      if (err) return reject(err);
      resolve(list.filter((e) => e.filename !== "." && e.filename !== ".."));
    });
  });
}

function sftpMkdir(sftp: SftpLike, p: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(p, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function sftpUnlink(sftp: SftpLike, p: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(p, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function sftpRmdir(sftp: SftpLike, p: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(p, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function sftpRename(sftp: SftpLike, from: string, to: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(from, to, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * Atomic write: create write stream to a .partial temp path, write buffer,
 * then sftp.rename into place. Uses "wx" flag to fail if the temp path
 * already exists.
 */
function sftpWriteBuffer(
  sftp: SftpLike,
  absolutePath: string,
  buffer: Buffer,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tempPath = `${absolutePath}.${Date.now()}.partial`;
    const stream = sftp.createWriteStream(tempPath, { flags: "wx" });
    stream.on("error", (err) => reject(err));
    stream.on("close", () => {
      sftp.rename(tempPath, absolutePath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    (stream as unknown as { write: (b: Buffer) => void }).write(buffer);
    stream.end();
  });
}

/**
 * Create an empty file using "wx" (fail if exists → already_exists).
 */
function sftpCreateEmpty(sftp: SftpLike, absolutePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(absolutePath, { flags: "wx" });
    let errored = false;
    stream.on("error", (err) => {
      errored = true;
      reject(err);
    });
    stream.on("close", () => {
      if (!errored) resolve();
    });
    stream.end();
  });
}

/* ------------------------------------------------------------------------ */
/*  runWithAbort (copied from pretty-view-fetch-host-file.ts verbatim)     */
/* ------------------------------------------------------------------------ */

function runWithAbort<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    task().then(
      (v) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/* ------------------------------------------------------------------------ */
/*  Path helpers                                                            */
/* ------------------------------------------------------------------------ */

type WorkspaceEntry = {
  name: string;
  type: "file" | "directory" | "symlink";
  size: number | null;
  mtimeMs: number;
  path: string;
};

/**
 * Static pre-SFTP traversal check. Rejects relativePath with .. segments
 * in any form before any SFTP call is made.
 */
function validateRelativePath(p: string): void {
  if (
    p.includes("/../") ||
    p.startsWith("../") ||
    p === ".." ||
    p.endsWith("/..") ||
    p.includes("/./") ||
    p.endsWith("/.")
  ) {
    throw new Error("path_traversal");
  }
}

/**
 * Build absolutePath from workspaceRoot + relativePath. Never produces a
 * double-slash; handles empty relativePath correctly.
 */
function buildAbsolutePath(workspaceRoot: string, relativePath: string): string {
  if (!relativePath) return workspaceRoot;
  const clean = relativePath.startsWith("/") ? relativePath.slice(1) : relativePath;
  return `${workspaceRoot}/${clean}`;
}

/**
 * Post-realpath assertion: resolved must be workspaceRoot itself or be
 * strictly under workspaceRoot/. Closes symlink escape (T-118-04).
 */
function assertResolvedUnderRoot(resolved: string, workspaceRoot: string): void {
  if (resolved !== workspaceRoot && !resolved.startsWith(workspaceRoot + "/")) {
    throw new Error("path_traversal");
  }
}

/* ------------------------------------------------------------------------ */
/*  Error classification helpers                                            */
/*  (extended from pretty-view-fetch-host-file.ts to add workspace classes) */
/* ------------------------------------------------------------------------ */

function classifyErrorToStatus(err: unknown): number {
  const name = err instanceof Error ? err.name : "unknown";
  const msg = err instanceof Error ? err.message : "";
  if (name === "AbortError") return 504;
  if (msg === "invalid_body") return 400;
  if (msg === "invalid_identity_key") return 400;
  if (msg === "path_traversal") return 400;
  if (msg === "path_forbidden") return 400;
  if (msg === "path_must_be_absolute") return 400;
  if (msg === "not_a_file") return 400;
  if (msg === "not_a_directory") return 400;
  if (msg === "unknown_host") return 404;
  if (msg === "permission_denied") return 403;
  if (msg === "too_large") return 413;
  if (msg === "already_exists") return 409;
  if (msg === "not_empty") return 409;
  // SSH2 ENOTEMPTY — recognise by descriptive message text only. SSH_FX_FAILURE
  // (code 4) is a generic-failure bucket used for many unrelated errors (write
  // failures, quota, transient SFTP issues), so a bare `code === 4` match
  // mis-attributed everything under it to "not empty". Trust the msg regex.
  if (/ENOTEMPTY|Directory not empty/i.test(msg)) return 409;
  // EEXIST → already_exists
  if (/EEXIST|already exists/i.test(msg)) return 409;
  if (msg.includes("ENOENT") || msg.includes("No such file")) return 404;
  if (msg.includes("Permission") || msg.includes("EACCES")) return 403;
  return 502;
}

function classifyErrorToClass(err: unknown): string {
  const name = err instanceof Error ? err.name : "unknown";
  const msg = err instanceof Error ? err.message : "";
  if (name === "AbortError") return "ssh_timeout";
  if (
    msg === "invalid_body" ||
    msg === "invalid_identity_key" ||
    msg === "path_traversal" ||
    msg === "path_forbidden" ||
    msg === "path_must_be_absolute" ||
    msg === "not_a_file" ||
    msg === "not_a_directory" ||
    msg === "unknown_host" ||
    msg === "permission_denied" ||
    msg === "too_large" ||
    msg === "already_exists" ||
    msg === "not_empty"
  ) {
    return msg;
  }
  // SSH2 ENOTEMPTY — see classifyErrorToStatus above for why we do NOT
  // trust a bare `code === 4` here.
  if (/ENOTEMPTY|Directory not empty/i.test(msg)) return "not_empty";
  // EEXIST → already_exists
  if (/EEXIST|already exists/i.test(msg)) return "already_exists";
  if (msg.includes("ENOENT") || msg.includes("No such file")) return "not_found";
  if (msg.includes("Permission") || msg.includes("EACCES")) return "permission_denied";
  return "host_unreachable";
}

/* ------------------------------------------------------------------------ */
/*  Router                                                                  */
/* ------------------------------------------------------------------------ */

export const workspaceRoutes = express.Router();

/* ---- POST /list ---- */
workspaceRoutes.post(
  "/list",
  express.json({ limit: "1mb" }),
  authenticateJWT,
  async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | null;
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.identityKey !== "string" ||
      (typeof body.hostId !== "number" && typeof body.hostId !== "string")
    ) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const { identityKey, hostId, relativePath = "" } = body as {
      identityKey: string;
      hostId: number | string;
      relativePath?: string;
    };
    const userId = (req as Request & { userId: string }).userId;

    // Step 2: IDENTITY_KEY_RE.test(identityKey) — Pitfall 5
    if (!IDENTITY_KEY_RE.test(identityKey)) {
      res.status(400).json({ error: "invalid_identity_key" });
      return;
    }

    // Step 3: Static traversal check
    try {
      validateRelativePath(String(relativePath));
    } catch {
      res.status(400).json({ error: "path_traversal" });
      return;
    }

    // Step 4: Host resolution
    const host = await resolveHostById(Number(hostId), userId);
    if (!host) {
      res.status(404).json({ error: "unknown_host" });
      return;
    }

    // Step 5: RBAC — canAccessHost(userId, hostId, "read")
    const accessInfo = await permissionManager.canAccessHost(userId, Number(hostId), "read");
    if (!accessInfo.hasAccess) {
      res.status(403).json({ error: "permission_denied" });
      return;
    }

    const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SFTP_OP_TIMEOUT_MS);
    try {
      const result = await withConnection(
        poolKey,
        () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
        async (client) => {
          return await runWithAbort(ctrl.signal, async () => {
            // Step 6: tilde expansion — sftpRealpath(sftp, ".")
            const sftp = await openSftp(client);
            const homeDir = await sftpRealpath(sftp, ".");
            const workspaceRoot = `${homeDir}/fleet/identities/${identityKey}/workspace`;
            const absolutePath = buildAbsolutePath(workspaceRoot, String(relativePath));

            // Step 8: Post-realpath re-check (symlink escape defense)
            const resolved = await sftpRealpath(sftp, absolutePath);
            assertResolvedUnderRoot(resolved, workspaceRoot);
            if (FORBIDDEN_PATH_RE.test(resolved)) throw new Error("path_forbidden");

            // Step 9: SFTP operation
            const raw = await sftpReaddir(sftp, resolved);
            const entries: WorkspaceEntry[] = raw.map((e) => ({
              name: e.filename,
              type: e.attrs.isDirectory()
                ? "directory"
                : e.attrs.isSymbolicLink()
                  ? "symlink"
                  : "file",
              size: e.attrs.isDirectory() ? null : e.attrs.size,
              mtimeMs: e.attrs.mtime * 1000,
              path: relativePath
                ? `${relativePath}/${e.filename}`
                : e.filename,
            }));
            return { entries, path: String(relativePath) };
          });
        },
      );
      res.json(result);
    } catch (err) {
      // Step 10: T-40-05 — NEVER err.message in response body
      res.status(classifyErrorToStatus(err)).json({ error: classifyErrorToClass(err) });
      sshLogger.warn("workspace /list error", {
        operation: "workspace_list",
        errorName: err instanceof Error ? err.name : "unknown",
        userId,
      });
    } finally {
      clearTimeout(timer);
    }
  },
);

/* ---- POST /read-file ---- */
workspaceRoutes.post(
  "/read-file",
  express.json({ limit: "1mb" }),
  authenticateJWT,
  async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | null;
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.identityKey !== "string" ||
      typeof body.relativePath !== "string" ||
      (typeof body.hostId !== "number" && typeof body.hostId !== "string")
    ) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const { identityKey, hostId, relativePath } = body as {
      identityKey: string;
      hostId: number | string;
      relativePath: string;
    };
    const userId = (req as Request & { userId: string }).userId;

    if (!IDENTITY_KEY_RE.test(identityKey)) {
      res.status(400).json({ error: "invalid_identity_key" });
      return;
    }

    try {
      validateRelativePath(relativePath);
    } catch {
      res.status(400).json({ error: "path_traversal" });
      return;
    }

    const host = await resolveHostById(Number(hostId), userId);
    if (!host) {
      res.status(404).json({ error: "unknown_host" });
      return;
    }

    const accessInfo = await permissionManager.canAccessHost(userId, Number(hostId), "read");
    if (!accessInfo.hasAccess) {
      res.status(403).json({ error: "permission_denied" });
      return;
    }

    const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SFTP_OP_TIMEOUT_MS);
    try {
      const result = await withConnection(
        poolKey,
        () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
        async (client) => {
          return await runWithAbort(ctrl.signal, async () => {
            const sftp = await openSftp(client);
            const homeDir = await sftpRealpath(sftp, ".");
            const workspaceRoot = `${homeDir}/fleet/identities/${identityKey}/workspace`;
            const absolutePath = buildAbsolutePath(workspaceRoot, relativePath);

            const resolved = await sftpRealpath(sftp, absolutePath);
            assertResolvedUnderRoot(resolved, workspaceRoot);
            if (FORBIDDEN_PATH_RE.test(resolved)) throw new Error("path_forbidden");

            const stat = await sftpStat(sftp, resolved);
            if (!stat.isFile()) throw new Error("not_a_file");
            if (stat.size > MAX_READ_BYTES) throw new Error("too_large");

            const data = await sftpReadFile(sftp, resolved);
            const filename = relativePath.split("/").pop() ?? "";
            const dotIdx = filename.lastIndexOf(".");
            const extension =
              dotIdx === -1 || dotIdx === filename.length - 1
                ? null
                : filename.slice(dotIdx + 1).toLowerCase();
            return {
              contentBase64: data.toString("base64"),
              sizeBytes: data.byteLength,
              filename,
              extension,
            };
          });
        },
      );
      res.json(result);
    } catch (err) {
      res.status(classifyErrorToStatus(err)).json({ error: classifyErrorToClass(err) });
      sshLogger.warn("workspace /read-file error", {
        operation: "workspace_read_file",
        errorName: err instanceof Error ? err.name : "unknown",
        userId,
      });
    } finally {
      clearTimeout(timer);
    }
  },
);

/* ---- PUT /write-file ---- */
workspaceRoutes.put(
  "/write-file",
  express.json({ limit: "10mb" }),
  authenticateJWT,
  async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | null;
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.identityKey !== "string" ||
      typeof body.relativePath !== "string" ||
      typeof body.content !== "string" ||
      (typeof body.hostId !== "number" && typeof body.hostId !== "string")
    ) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const { identityKey, hostId, relativePath, content } = body as {
      identityKey: string;
      hostId: number | string;
      relativePath: string;
      content: string;
    };
    const userId = (req as Request & { userId: string }).userId;

    if (!IDENTITY_KEY_RE.test(identityKey)) {
      res.status(400).json({ error: "invalid_identity_key" });
      return;
    }

    try {
      validateRelativePath(relativePath);
    } catch {
      res.status(400).json({ error: "path_traversal" });
      return;
    }

    const host = await resolveHostById(Number(hostId), userId);
    if (!host) {
      res.status(404).json({ error: "unknown_host" });
      return;
    }

    const accessInfo = await permissionManager.canAccessHost(userId, Number(hostId), "write");
    if (!accessInfo.hasAccess) {
      res.status(403).json({ error: "permission_denied" });
      return;
    }

    const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SFTP_OP_TIMEOUT_MS);
    try {
      await withConnection(
        poolKey,
        () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
        async (client) => {
          return await runWithAbort(ctrl.signal, async () => {
            const sftp = await openSftp(client);
            const homeDir = await sftpRealpath(sftp, ".");
            const workspaceRoot = `${homeDir}/fleet/identities/${identityKey}/workspace`;
            const absolutePath = buildAbsolutePath(workspaceRoot, relativePath);

            // Realpath check on the parent directory (file may not exist yet)
            const dirPath = absolutePath.substring(0, absolutePath.lastIndexOf("/"));
            const resolvedDir = await sftpRealpath(sftp, dirPath);
            assertResolvedUnderRoot(resolvedDir, workspaceRoot);
            if (FORBIDDEN_PATH_RE.test(resolvedDir)) throw new Error("path_forbidden");

            await sftpWriteBuffer(sftp, absolutePath, Buffer.from(content, "utf8"));
          });
        },
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(classifyErrorToStatus(err)).json({ error: classifyErrorToClass(err) });
      sshLogger.warn("workspace /write-file error", {
        operation: "workspace_write_file",
        errorName: err instanceof Error ? err.name : "unknown",
        errorMessage: err instanceof Error ? err.message : "",
        errorCode: (err as { code?: number }).code,
        userId,
      });
    } finally {
      clearTimeout(timer);
    }
  },
);

/* ---- DELETE /entry ---- */
workspaceRoutes.delete(
  "/entry",
  express.json({ limit: "1mb" }),
  authenticateJWT,
  async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | null;
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.identityKey !== "string" ||
      typeof body.relativePath !== "string" ||
      (typeof body.hostId !== "number" && typeof body.hostId !== "string")
    ) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const { identityKey, hostId, relativePath } = body as {
      identityKey: string;
      hostId: number | string;
      relativePath: string;
    };
    const userId = (req as Request & { userId: string }).userId;

    if (!IDENTITY_KEY_RE.test(identityKey)) {
      res.status(400).json({ error: "invalid_identity_key" });
      return;
    }

    try {
      validateRelativePath(relativePath);
    } catch {
      res.status(400).json({ error: "path_traversal" });
      return;
    }

    const host = await resolveHostById(Number(hostId), userId);
    if (!host) {
      res.status(404).json({ error: "unknown_host" });
      return;
    }

    const accessInfo = await permissionManager.canAccessHost(userId, Number(hostId), "write");
    if (!accessInfo.hasAccess) {
      res.status(403).json({ error: "permission_denied" });
      return;
    }

    const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SFTP_OP_TIMEOUT_MS);
    try {
      await withConnection(
        poolKey,
        () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
        async (client) => {
          return await runWithAbort(ctrl.signal, async () => {
            const sftp = await openSftp(client);
            const homeDir = await sftpRealpath(sftp, ".");
            const workspaceRoot = `${homeDir}/fleet/identities/${identityKey}/workspace`;
            const absolutePath = buildAbsolutePath(workspaceRoot, relativePath);

            const resolved = await sftpRealpath(sftp, absolutePath);
            assertResolvedUnderRoot(resolved, workspaceRoot);
            if (FORBIDDEN_PATH_RE.test(resolved)) throw new Error("path_forbidden");
            // Guard: can't delete the workspace root itself
            if (resolved === workspaceRoot) throw new Error("path_traversal");

            const stat = await sftpStat(sftp, resolved);
            if (stat.isDirectory()) {
              await sftpRmdir(sftp, resolved);
            } else {
              await sftpUnlink(sftp, resolved);
            }
          });
        },
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(classifyErrorToStatus(err)).json({ error: classifyErrorToClass(err) });
      sshLogger.warn("workspace /entry DELETE error", {
        operation: "workspace_delete",
        errorName: err instanceof Error ? err.name : "unknown",
        userId,
      });
    } finally {
      clearTimeout(timer);
    }
  },
);

/* ---- POST /rename ---- */
workspaceRoutes.post(
  "/rename",
  express.json({ limit: "1mb" }),
  authenticateJWT,
  async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | null;
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.identityKey !== "string" ||
      typeof body.from !== "string" ||
      typeof body.to !== "string" ||
      (typeof body.hostId !== "number" && typeof body.hostId !== "string")
    ) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const { identityKey, hostId, from, to } = body as {
      identityKey: string;
      hostId: number | string;
      from: string;
      to: string;
    };
    const userId = (req as Request & { userId: string }).userId;

    if (!IDENTITY_KEY_RE.test(identityKey)) {
      res.status(400).json({ error: "invalid_identity_key" });
      return;
    }

    // Validate both from and to
    try {
      validateRelativePath(from);
      validateRelativePath(to);
    } catch {
      res.status(400).json({ error: "path_traversal" });
      return;
    }

    const host = await resolveHostById(Number(hostId), userId);
    if (!host) {
      res.status(404).json({ error: "unknown_host" });
      return;
    }

    const accessInfo = await permissionManager.canAccessHost(userId, Number(hostId), "write");
    if (!accessInfo.hasAccess) {
      res.status(403).json({ error: "permission_denied" });
      return;
    }

    const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SFTP_OP_TIMEOUT_MS);
    try {
      await withConnection(
        poolKey,
        () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
        async (client) => {
          return await runWithAbort(ctrl.signal, async () => {
            const sftp = await openSftp(client);
            const homeDir = await sftpRealpath(sftp, ".");
            const workspaceRoot = `${homeDir}/fleet/identities/${identityKey}/workspace`;
            const fromPath = buildAbsolutePath(workspaceRoot, from);
            const toPath = buildAbsolutePath(workspaceRoot, to);

            // Realpath check on 'from' (must exist)
            const resolvedFrom = await sftpRealpath(sftp, fromPath);
            assertResolvedUnderRoot(resolvedFrom, workspaceRoot);
            if (FORBIDDEN_PATH_RE.test(resolvedFrom)) throw new Error("path_forbidden");

            // Realpath check on 'to' parent (toPath itself may not exist yet)
            const toParent = toPath.substring(0, toPath.lastIndexOf("/"));
            const resolvedToParent = await sftpRealpath(sftp, toParent);
            assertResolvedUnderRoot(resolvedToParent, workspaceRoot);
            if (FORBIDDEN_PATH_RE.test(resolvedToParent)) throw new Error("path_forbidden");

            await sftpRename(sftp, resolvedFrom, toPath);
          });
        },
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(classifyErrorToStatus(err)).json({ error: classifyErrorToClass(err) });
      sshLogger.warn("workspace /rename error", {
        operation: "workspace_rename",
        errorName: err instanceof Error ? err.name : "unknown",
        userId,
      });
    } finally {
      clearTimeout(timer);
    }
  },
);

/* ---- POST /mkdir ---- */
workspaceRoutes.post(
  "/mkdir",
  express.json({ limit: "1mb" }),
  authenticateJWT,
  async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | null;
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.identityKey !== "string" ||
      typeof body.relativePath !== "string" ||
      (typeof body.hostId !== "number" && typeof body.hostId !== "string")
    ) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const { identityKey, hostId, relativePath } = body as {
      identityKey: string;
      hostId: number | string;
      relativePath: string;
    };
    const userId = (req as Request & { userId: string }).userId;

    if (!IDENTITY_KEY_RE.test(identityKey)) {
      res.status(400).json({ error: "invalid_identity_key" });
      return;
    }

    try {
      validateRelativePath(relativePath);
    } catch {
      res.status(400).json({ error: "path_traversal" });
      return;
    }

    const host = await resolveHostById(Number(hostId), userId);
    if (!host) {
      res.status(404).json({ error: "unknown_host" });
      return;
    }

    const accessInfo = await permissionManager.canAccessHost(userId, Number(hostId), "write");
    if (!accessInfo.hasAccess) {
      res.status(403).json({ error: "permission_denied" });
      return;
    }

    const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SFTP_OP_TIMEOUT_MS);
    try {
      await withConnection(
        poolKey,
        () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
        async (client) => {
          return await runWithAbort(ctrl.signal, async () => {
            const sftp = await openSftp(client);
            const homeDir = await sftpRealpath(sftp, ".");
            const workspaceRoot = `${homeDir}/fleet/identities/${identityKey}/workspace`;
            const absolutePath = buildAbsolutePath(workspaceRoot, relativePath);

            // Realpath check on parent
            const parentPath = absolutePath.substring(0, absolutePath.lastIndexOf("/"));
            const resolvedParent = await sftpRealpath(sftp, parentPath);
            assertResolvedUnderRoot(resolvedParent, workspaceRoot);
            if (FORBIDDEN_PATH_RE.test(resolvedParent)) throw new Error("path_forbidden");

            await sftpMkdir(sftp, absolutePath);
          });
        },
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(classifyErrorToStatus(err)).json({ error: classifyErrorToClass(err) });
      sshLogger.warn("workspace /mkdir error", {
        operation: "workspace_mkdir",
        errorName: err instanceof Error ? err.name : "unknown",
        userId,
      });
    } finally {
      clearTimeout(timer);
    }
  },
);

/* ---- POST /create-file ---- */
workspaceRoutes.post(
  "/create-file",
  express.json({ limit: "1mb" }),
  authenticateJWT,
  async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | null;
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.identityKey !== "string" ||
      typeof body.relativePath !== "string" ||
      (typeof body.hostId !== "number" && typeof body.hostId !== "string")
    ) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const { identityKey, hostId, relativePath } = body as {
      identityKey: string;
      hostId: number | string;
      relativePath: string;
    };
    const userId = (req as Request & { userId: string }).userId;

    if (!IDENTITY_KEY_RE.test(identityKey)) {
      res.status(400).json({ error: "invalid_identity_key" });
      return;
    }

    try {
      validateRelativePath(relativePath);
    } catch {
      res.status(400).json({ error: "path_traversal" });
      return;
    }

    const host = await resolveHostById(Number(hostId), userId);
    if (!host) {
      res.status(404).json({ error: "unknown_host" });
      return;
    }

    const accessInfo = await permissionManager.canAccessHost(userId, Number(hostId), "write");
    if (!accessInfo.hasAccess) {
      res.status(403).json({ error: "permission_denied" });
      return;
    }

    const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SFTP_OP_TIMEOUT_MS);
    try {
      await withConnection(
        poolKey,
        () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
        async (client) => {
          return await runWithAbort(ctrl.signal, async () => {
            const sftp = await openSftp(client);
            const homeDir = await sftpRealpath(sftp, ".");
            const workspaceRoot = `${homeDir}/fleet/identities/${identityKey}/workspace`;
            const absolutePath = buildAbsolutePath(workspaceRoot, relativePath);

            // Realpath check on parent dir
            const parentPath = absolutePath.substring(0, absolutePath.lastIndexOf("/"));
            const resolvedParent = await sftpRealpath(sftp, parentPath);
            assertResolvedUnderRoot(resolvedParent, workspaceRoot);
            if (FORBIDDEN_PATH_RE.test(resolvedParent)) throw new Error("path_forbidden");

            await sftpCreateEmpty(sftp, absolutePath);
          });
        },
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(classifyErrorToStatus(err)).json({ error: classifyErrorToClass(err) });
      sshLogger.warn("workspace /create-file error", {
        operation: "workspace_create_file",
        errorName: err instanceof Error ? err.name : "unknown",
        userId,
      });
    } finally {
      clearTimeout(timer);
    }
  },
);

/* ---- POST /upload (multipart — dedicated multer instance, Pitfall 6) ---- */
workspaceRoutes.post(
  "/upload",
  workspaceUpload.single("file"),
  authenticateJWT,
  async (req: Request, res: Response) => {
    const { identityKey, hostId, relativePath } = req.body as Record<
      string,
      unknown
    >;

    if (
      typeof identityKey !== "string" ||
      typeof relativePath !== "string" ||
      (typeof hostId !== "number" && typeof hostId !== "string") ||
      !req.file
    ) {
      // Wave 4 UAT: drag-drop upload surfaced invalid_body with no
      // way to see which field the multer parse dropped. Log the shape so a
      // re-occurrence tells us the actual missing field.
      sshLogger.warn("workspace /upload invalid_body", {
        operation: "workspace_upload",
        hasFile: !!req.file,
        identityKeyType: typeof identityKey,
        relativePathType: typeof relativePath,
        hostIdType: typeof hostId,
        contentType: req.headers["content-type"],
      });
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const userId = (req as Request & { userId: string }).userId;

    if (!IDENTITY_KEY_RE.test(identityKey)) {
      res.status(400).json({ error: "invalid_identity_key" });
      return;
    }

    try {
      validateRelativePath(relativePath);
    } catch {
      res.status(400).json({ error: "path_traversal" });
      return;
    }

    const host = await resolveHostById(Number(hostId), userId);
    if (!host) {
      res.status(404).json({ error: "unknown_host" });
      return;
    }

    const accessInfo = await permissionManager.canAccessHost(userId, Number(hostId), "write");
    if (!accessInfo.hasAccess) {
      res.status(403).json({ error: "permission_denied" });
      return;
    }

    const fileBuffer = req.file.buffer;
    const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SFTP_OP_TIMEOUT_MS);
    try {
      await withConnection(
        poolKey,
        () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
        async (client) => {
          return await runWithAbort(ctrl.signal, async () => {
            const sftp = await openSftp(client);
            const homeDir = await sftpRealpath(sftp, ".");
            const workspaceRoot = `${homeDir}/fleet/identities/${identityKey}/workspace`;
            const absolutePath = buildAbsolutePath(workspaceRoot, relativePath);

            // Realpath check on parent dir
            const parentPath = absolutePath.substring(0, absolutePath.lastIndexOf("/"));
            const resolvedParent = await sftpRealpath(sftp, parentPath);
            assertResolvedUnderRoot(resolvedParent, workspaceRoot);
            if (FORBIDDEN_PATH_RE.test(resolvedParent)) throw new Error("path_forbidden");

            await sftpWriteBuffer(sftp, absolutePath, fileBuffer);
          });
        },
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(classifyErrorToStatus(err)).json({ error: classifyErrorToClass(err) });
      sshLogger.warn("workspace /upload error", {
        operation: "workspace_upload",
        errorName: err instanceof Error ? err.name : "unknown",
        errorMessage: err instanceof Error ? err.message : "",
        errorCode: (err as { code?: number }).code,
        userId,
      });
    } finally {
      clearTimeout(timer);
    }
  },
);

/* ---- GET /download ---- */
workspaceRoutes.get(
  "/download",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const { identityKey, hostId, relativePath } = req.query as Record<
      string,
      unknown
    >;

    if (
      typeof identityKey !== "string" ||
      typeof relativePath !== "string" ||
      (typeof hostId !== "number" && typeof hostId !== "string")
    ) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const userId = (req as Request & { userId: string }).userId;

    if (!IDENTITY_KEY_RE.test(identityKey)) {
      res.status(400).json({ error: "invalid_identity_key" });
      return;
    }

    try {
      validateRelativePath(relativePath);
    } catch {
      res.status(400).json({ error: "path_traversal" });
      return;
    }

    const host = await resolveHostById(Number(hostId), userId);
    if (!host) {
      res.status(404).json({ error: "unknown_host" });
      return;
    }

    const accessInfo = await permissionManager.canAccessHost(userId, Number(hostId), "read");
    if (!accessInfo.hasAccess) {
      res.status(403).json({ error: "permission_denied" });
      return;
    }

    const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SFTP_OP_TIMEOUT_MS);
    try {
      const bytes = await withConnection(
        poolKey,
        () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
        async (client) => {
          return await runWithAbort(ctrl.signal, async () => {
            const sftp = await openSftp(client);
            const homeDir = await sftpRealpath(sftp, ".");
            const workspaceRoot = `${homeDir}/fleet/identities/${identityKey}/workspace`;
            const absolutePath = buildAbsolutePath(workspaceRoot, relativePath);

            const resolved = await sftpRealpath(sftp, absolutePath);
            assertResolvedUnderRoot(resolved, workspaceRoot);
            if (FORBIDDEN_PATH_RE.test(resolved)) throw new Error("path_forbidden");

            const stat = await sftpStat(sftp, resolved);
            if (!stat.isFile()) throw new Error("not_a_file");
            if (stat.size > MAX_DOWNLOAD_BYTES) throw new Error("too_large");

            return await sftpReadFile(sftp, resolved);
          });
        },
      );
      const filename = relativePath.split("/").pop() ?? "file";
      res.set({
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.status(200).send(bytes);
    } catch (err) {
      res.status(classifyErrorToStatus(err)).json({ error: classifyErrorToClass(err) });
      sshLogger.warn("workspace /download error", {
        operation: "workspace_download",
        errorName: err instanceof Error ? err.name : "unknown",
        userId,
      });
    } finally {
      clearTimeout(timer);
    }
  },
);

export default workspaceRoutes;
