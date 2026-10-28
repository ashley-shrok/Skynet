/**
 * Name search across the folder tree under a Files-tab folder.
 *
 *   POST /workspace/search — body: target fields + hostId + relativePath
 *                            (the folder searched from; "" = target root) +
 *                            query (words matched case-insensitively against
 *                            each entry's own name, all must appear)
 *     → { results: WorkspaceEntry[], truncated, timedOut }
 *       results[].path is relative to the TARGET ROOT, like /list entries.
 *       truncated = more than SEARCH_MAX_RESULTS matched (first ones returned)
 *       timedOut  = the time limit stopped the search; there may be more
 *
 * Same request chain as workspace-routes.ts (body check → extractTarget →
 * traversal check → resolveHostById → canAccessHost "read" → pooled SSH);
 * step 9 runs the script from workspace-search-script.ts on an exec channel.
 *
 * Safety:
 *   - Every client-supplied string reaches the shell through shellEscape;
 *     query words are also fnmatch-escaped so they match literally.
 *   - The script refuses a start folder that resolves outside the root, and
 *     find never follows symlinks, so results stay inside the target.
 *   - The target's reserved root file (role file / project.md) is never
 *     returned: find skips it whenever the search starts at the target root
 *     (decided on the resolved path), so it never counts toward the cap.
 *   - Bounded on the host (timeout + nice; a host without timeout is refused)
 *     and here: reading stops at SEARCH_MAX_RESULTS + 1 records or
 *     MAX_OUTPUT_BYTES (either reports truncated), and the channel is closed
 *     when the client goes away, so a superseded search stops early.
 *   - Error bodies are { error: "<class>" } only — never err.message (T-40-05).
 */

import express from "express";
import type { Request, Response } from "express";
import type { Client as SSHClientType } from "ssh2";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { sshLogger } from "../../utils/logger.js";
import { withConnection, hostPoolKey } from "../../ssh/ssh-connection-pool.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { getHostSemaphore } from "../../ssh/host-semaphore-registry.js";
import { hangUpChannel } from "../../ssh/channel-hangup.js";
import {
  classifyErrorToClass,
  classifyErrorToStatus,
  extractTarget,
  reservedRootFileName,
  runWithAbort,
  validateRelativePath,
} from "./workspace-routes.js";
import {
  SEARCH_MAX_RESULTS,
  SEARCH_TIME_LIMIT_S,
  SearchScriptError,
  buildSearchScript,
  parseSearchOutput,
  parseSearchQuery,
  shellEscape,
} from "./workspace-search-script.js";

const SSH_CONNECT_TIMEOUT_MS = 5_000;
/** Backstop over the host-side time limit; under nginx's 15s proxy_read_timeout on /workspace. */
const SEARCH_OP_TIMEOUT_MS = (SEARCH_TIME_LIMIT_S + 6) * 1000;
/** Byte backstop — 201 records of long paths fit far under this. */
const MAX_OUTPUT_BYTES = 2_000_000;

const SEARCH_ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  path_traversal: 400,
  search_unsupported: 501,
  search_failed: 502,
};

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const permissionManager = PermissionManager.getInstance();

/** Bytes from the start of `buf` up to and including its `n`th NUL, or -1. */
function offsetAfterNthNul(buf: Buffer, n: number): number {
  let idx = -1;
  for (let i = 0; i < n; i++) {
    idx = buf.indexOf(0, idx + 1);
    if (idx === -1) return -1;
  }
  return idx + 1;
}

/**
 * Run the search script and buffer stdout until it ends, the record cap is
 * reached (then the channel is closed — find dies on its next write), the
 * byte backstop is hit, or `signal` aborts.
 */
function execSearch(
  client: SSHClientType,
  script: string,
  signal: AbortSignal,
): Promise<{ stdout: string; stoppedEarly: boolean }> {
  const maxRecords = SEARCH_MAX_RESULTS + 1;
  return new Promise((resolve, reject) => {
    client.exec(`sh -c ${shellEscape(script)}`, (err, stream) => {
      if (err) return reject(err);
      let buf = Buffer.alloc(0);
      let stoppedEarly = false;
      let done = false;
      // Usually called while the search is still writing; a plain close
      // there drops the whole connection on Tailscale SSH.
      const stop = () => hangUpChannel(stream);
      const onAbort = () => stop();
      signal.addEventListener("abort", onAbort, { once: true });
      // Aborted while exec was opening the channel — stop it now.
      if (signal.aborted) stop();
      stream.on("data", (chunk: Buffer) => {
        if (stoppedEarly) return;
        buf = Buffer.concat([buf, chunk]);
        const cut = offsetAfterNthNul(buf, maxRecords);
        if (cut !== -1 || buf.length >= MAX_OUTPUT_BYTES) {
          if (cut !== -1) buf = buf.subarray(0, cut);
          stoppedEarly = true;
          stop();
          // Answer now; the channel winds down in the background.
          done = true;
          signal.removeEventListener("abort", onAbort);
          resolve({ stdout: buf.toString("utf-8"), stoppedEarly });
        }
      });
      stream.stderr.on("data", () => {
        /* drained; the script silences stderr */
      });
      stream.on("close", () => {
        if (done) return;
        done = true;
        signal.removeEventListener("abort", onAbort);
        resolve({ stdout: buf.toString("utf-8"), stoppedEarly });
      });
      stream.on("error", (e: Error) => {
        if (done) return;
        done = true;
        signal.removeEventListener("abort", onAbort);
        reject(e);
      });
    });
  });
}

function errorStatus(err: unknown): number {
  if (err instanceof SearchScriptError) return SEARCH_ERROR_STATUS[err.message] ?? 502;
  return classifyErrorToStatus(err);
}

function errorClass(err: unknown): string {
  if (err instanceof SearchScriptError) {
    return err.message in SEARCH_ERROR_STATUS ? err.message : "search_failed";
  }
  return classifyErrorToClass(err);
}

const workspaceSearchRoutes = express.Router();

workspaceSearchRoutes.post(
  "/",
  express.json({ limit: "64kb" }),
  authenticateJWT,
  async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | null;
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      (typeof body.hostId !== "number" && typeof body.hostId !== "string") ||
      (body.relativePath !== undefined && typeof body.relativePath !== "string")
    ) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const words = parseSearchQuery(body.query);
    if (!words) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const userId = (req as Request & { userId: string }).userId;

    const targetResult = extractTarget(body);
    if (targetResult.ok === false) {
      res.status(400).json({ error: targetResult.error });
      return;
    }
    const target = targetResult.target;

    const startPath = typeof body.relativePath === "string" ? body.relativePath.replace(/\/+$/, "") : "";
    try {
      validateRelativePath(startPath);
      if (startPath.startsWith("/") || startPath.includes("\0")) throw new Error("path_traversal");
    } catch {
      res.status(400).json({ error: "path_traversal" });
      return;
    }

    const hostId = Number(body.hostId);
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "unknown_host" });
      return;
    }
    const accessInfo = await permissionManager.canAccessHost(userId, hostId, "read");
    if (!accessInfo.hasAccess) {
      res.status(403).json({ error: "permission_denied" });
      return;
    }

    const startedAt = Date.now();
    const poolKey = hostPoolKey(host);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SEARCH_OP_TIMEOUT_MS);
    // A superseded search (client aborted the fetch) stops the remote find.
    let clientGone = false;
    const onClientGone = () => {
      if (res.writableEnded) return;
      clientGone = true;
      ctrl.abort();
    };
    res.on("close", onClientGone);
    try {
      const out = await getHostSemaphore(hostId).run(() =>
        withConnection(
          poolKey,
          () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
          (client) =>
            runWithAbort(ctrl.signal, () =>
              execSearch(
                client,
                buildSearchScript(target, startPath, words, reservedRootFileName(target)),
                ctrl.signal,
              ),
            ),
        ),
      );
      const parsed = parseSearchOutput(out.stdout);
      const all = parsed.matches.map((m) => ({
        ...m,
        path: startPath ? `${startPath}/${m.path}` : m.path,
      }));
      const truncated = all.length > SEARCH_MAX_RESULTS || out.stoppedEarly;
      const results = all.slice(0, SEARCH_MAX_RESULTS);
      res.json({ results, truncated, timedOut: parsed.timedOut });
      sshLogger.info("workspace /search done", {
        operation: "workspace_search",
        hostId,
        targetKind: target.kind,
        words: words.length,
        results: results.length,
        truncated,
        timedOut: parsed.timedOut,
        stoppedEarly: out.stoppedEarly,
        durationMs: Date.now() - startedAt,
        userId,
      });
    } catch (err) {
      if (!res.writableEnded && !res.destroyed) {
        res.status(errorStatus(err)).json({ error: errorClass(err) });
      }
      sshLogger.warn("workspace /search error", {
        operation: "workspace_search",
        hostId,
        targetKind: target.kind,
        errorName: err instanceof Error ? err.name : "unknown",
        errorClass: errorClass(err),
        clientGone,
        durationMs: Date.now() - startedAt,
        userId,
      });
    } finally {
      clearTimeout(timer);
      res.off("close", onClientGone);
    }
  },
);

export default workspaceSearchRoutes;
