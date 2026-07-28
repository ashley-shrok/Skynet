/**
 * RELAYBUB-04 (Phase 17): /relay-pointer — SSRF-safe backend proxy for recv.sh file-pointer content.
 *
 * Fetches a long-inbound relay body file from the pane's remote host via SSH.
 * Gated by:
 *   1. WHITELIST_REGEX — path must match /tmp/relay-msg-[A-Za-z0-9._-]+.txt exactly (SSRF gate)
 *   2. resolveHostById(hostId, userId) — per-user host ownership (elevation-of-privilege gate)
 *   3. head -c bounded remote read — server-side truncation at SSH exec channel so backend RAM
 *      is bounded by construction (CLAUDE.md "Ashley never loses access to her fleet" constraint)
 *
 * Mounted on port 30001 (main Express backend), NOT port 30011 (WSS-only).
 * Structural pattern mirrors src/backend/database/routes/sessions.ts exactly.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { sshLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * SSRF whitelist: only /tmp/relay-msg-[A-Za-z0-9._-]+.txt paths are allowed.
 * Character class rejects `/`, `..`, shell metacharacters. Anchored `^...$` prevents prefix bypass.
 * T-17-02-01 mitigation.
 */
export const WHITELIST_REGEX = /^\/tmp\/relay-msg-[A-Za-z0-9._-]+\.txt$/;

/**
 * Server-side read cap: 512 KB.
 * head -c $(MAX_POINTER_SIZE_BYTES + 1) reads AT MOST cap+1 bytes at the remote SSH exec channel —
 * protects backend RAM against oversized files before bytes stream to the backend.
 * T-17-02-03 mitigation (CLAUDE.md fleet-availability hard constraint gate).
 */
export const MAX_POINTER_SIZE_BYTES = 512 * 1024;

/**
 * Per-fetch SSH timeout. Bounded well below nginx's 30s proxy_read_timeout.
 * T-17-02-04 mitigation.
 */
export const RELAY_POINTER_TIMEOUT_MS = 5000;

/**
 * Named adapter so unit tests can drive it independently without the Express harness.
 *
 * SSH command: `head -c $((MAX_POINTER_SIZE_BYTES + 1)) "${path}" 2>/dev/null; echo "__RELAY_EXIT_$?"`
 *   - `head -c N` reads AT MOST N bytes at the remote end — SSH exec channel never streams more.
 *   - The +1 sentinel byte distinguishes "file <= cap" from "file > cap" (truncated by head).
 *   - `echo "__RELAY_EXIT_$?"` captures head's exit status inline, avoiding SSH stderr parsing.
 *
 * Sentinel handling: execCommand calls resolve(stdout.trim()) at tmux-helper.ts:45, stripping
 * any trailing \n. ALL sentinel checks use the un-newlined form (endsWith("__RELAY_EXIT_N")).
 * Body-strip regex uses \n?__RELAY_EXIT_0$ for defense-in-depth against future trim changes.
 * T-17-02-08 mitigation.
 */
export async function readRelayPointerFile(
  hostId: number,
  userId: string,
  path: string,
): Promise<string> {
  // Step 1: per-user host ownership gate — resolveHostById returns null for cross-user hosts.
  // T-17-02-02 mitigation.
  const resolved = await resolveHostById(hostId, userId);
  if (!resolved) {
    throw Object.assign(new Error("unauthorized_host"), { code: "UNAUTHORIZED_HOST" });
  }

  // Step 2: open SSH connection (one-shot, same cast as sessions.ts:71)
  const conn = await connectOneShot(
    resolved as unknown as Parameters<typeof connectOneShot>[0],
    RELAY_POINTER_TIMEOUT_MS,
  );

  try {
    // Step 3: bounded remote read with exit-status sentinel.
    // CRITICAL: uses `head -c` NOT bare `cat` — T-17-02-03 fleet-availability protection.
    // The character class in WHITELIST_REGEX guarantees `path` contains no shell metacharacters,
    // so direct interpolation inside double-quotes is safe (T-17-02-07 rationale).
    const output = await Promise.race([
      execCommand(
        conn,
        `head -c ${MAX_POINTER_SIZE_BYTES + 1} "${path}" 2>/dev/null; echo "__RELAY_EXIT_$?"`,
      ),
      new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error("relay-pointer timeout")),
          RELAY_POINTER_TIMEOUT_MS,
        ),
      ),
    ]);

    // Sentinel checks: execCommand trims stdout, so no trailing \n on the sentinel.
    // endsWith("__RELAY_EXIT_1") = head returned ENOENT (file missing).
    // endsWith("__RELAY_EXIT_2") = permission denied — treat as not-reachable (T-17-02-08).
    if (output.endsWith("__RELAY_EXIT_1") || output.endsWith("__RELAY_EXIT_2")) {
      throw Object.assign(new Error("file_not_found"), { code: "FILE_NOT_FOUND" });
    }

    // Strip the sentinel line from the body.
    // \n?__RELAY_EXIT_0$ is tolerant: handles both trimmed form (current execCommand behavior)
    // and untrimmed form (defense-in-depth for future execCommand changes). T-17-02-08.
    const body = output.replace(/\n?__RELAY_EXIT_0$/, "");

    // Oversize detection: if head read exactly cap+1 bytes it truncated (file was larger).
    // Compare stripped body length against cap+1 to detect truncation. T-17-02-03.
    if (body.length === MAX_POINTER_SIZE_BYTES + 1) {
      throw Object.assign(new Error("file_too_large"), { code: "FILE_TOO_LARGE" });
    }

    return body;
  } finally {
    try {
      conn.end();
    } catch {
      /* ignore */
    }
  }
}

/**
 * GET / handler for /relay-pointer
 *
 * Query params:
 *   - hostId (integer): the SSH host to read from (per-user ownership enforced by resolveHostById)
 *   - path (string): absolute path to the file — MUST match WHITELIST_REGEX
 *
 * HTTP response codes:
 *   200  text/plain body
 *   400  invalid_params | whitelist_reject
 *   403  unauthorized_host
 *   404  file_not_found
 *   413  file_too_large
 *   500  fetch_error
 *
 * authenticateJWT middleware runs BEFORE this handler (Express ordering), so unauthenticated
 * requests return 401 from auth-manager.ts before the whitelist check fires. T-17-02-06.
 */
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  // Step 1: parse + validate query params
  const hostIdRaw = req.query.hostId as string | undefined;
  const filePath = req.query.path as string | undefined;

  if (!hostIdRaw || !filePath) {
    return res.status(400).send("invalid_params");
  }

  const hostId = parseInt(hostIdRaw, 10);
  if (isNaN(hostId)) {
    return res.status(400).send("invalid_params");
  }

  // Step 2: SSRF whitelist check — MUST run before any host access. T-17-02-01.
  if (!WHITELIST_REGEX.test(filePath)) {
    return res.status(400).send("whitelist_reject");
  }

  // Step 3: extract userId from JWT-authenticated request
  const userId = (req as AuthenticatedRequest).userId;

  try {
    // Step 4: fetch file via SSH adapter
    const body = await readRelayPointerFile(hostId, userId, filePath);

    // Step 5: success
    return res.type("text/plain").send(body);
  } catch (err) {
    const error = err as Error & { code?: string };

    if (error.code === "UNAUTHORIZED_HOST") {
      return res.status(403).send("unauthorized_host");
    }
    if (error.code === "FILE_NOT_FOUND") {
      return res.status(404).send("file_not_found");
    }
    if (error.code === "FILE_TOO_LARGE") {
      return res.status(413).send("file_too_large");
    }

    // Unexpected error — log and return 500
    sshLogger.warn("relay-pointer: unexpected fetch error", {
      operation: "relay_pointer_fetch",
      hostId,
      error: error.message,
    });
    return res.status(500).send("fetch_error");
  }
});

export default router;
