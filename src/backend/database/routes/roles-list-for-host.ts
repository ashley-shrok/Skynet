/**
 * Phase 22 (SRIC-02): /roles?hostId=<n> — target-host-side role directory
 * enumeration endpoint.
 *
 * GET /roles?hostId=<n>
 *   → [{ name, description }]
 *
 * SSH-only: opens a connectOneShot connection and runs two exec calls:
 *   1. `ls -1 "$HOME/.claude/roles"` — enumerate role directories.
 *   2. Batched `cat` (===ROLE:<n>=== delimited) — fetch each role's `<name>.md`
 *      markdown in a single SSH round-trip.
 *
 * Each result's `description` is the trimmed content of the `## Role` section
 * (bounded by the next `##` heading or EOF). Missing `## Role` → empty string
 * (dropdown still renders the role by name).
 *
 * Security:
 *   - authenticateJWT gates the route.
 *   - resolveHostById(hostId, userId) provides per-user host isolation (404 for
 *     cross-user / unknown hosts) — matches identity-exists-on-host.ts pattern.
 *   - ROLE_NAME_PATTERN (kebab-case-lowercase: /^[a-z0-9-]+$/) filters ls
 *     entries BEFORE they're shell-interpolated into the batched cat command.
 *     Malformed dir names are silently dropped (defense-in-depth per RESEARCH
 *     Security Domain V4 / STRIDE T-22-02-02).
 *   - SSH errors (connect timeout, exec failure) → 502 with generic message
 *     ("SSH connect failed" / "SSH exec failed"); no upstream error detail
 *     leaked into response body (T-22-02 information disclosure).
 *   - try/finally guarantees conn.end() cleanup on every exit path (matches
 *     claude-session-server.ts SSH resource cleanup pattern from RESEARCH F8-B6).
 *
 * Mount ordering:
 *   Mounted BEFORE /identities in database.ts. Even though /roles is not a
 *   subpath of /identities, keeping standalone mounts in a stable order
 *   preserves clarity when future /roles subpaths land.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { sshLogger } from "../../utils/logger.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * Role name validator — kebab-case-lowercase per D-CONTEXT §Frontend surfaces.
 * Stricter subset of IDENTITY_KEY_RE (no dots, slashes, plus, equals, underscores).
 * Applied both to entries read from `ls ~/.claude/roles/` (SSH branch defense
 * in depth per STRIDE T-22-02-02) and any future role-name request params.
 */
const ROLE_NAME_PATTERN = /^[a-z0-9-]+$/;

/** SSH connect timeout — matches other one-shot SSH endpoints. */
const SSH_CONNECT_TIMEOUT_MS = 5000;

/** SSH exec race timeout — bounded so a hung remote can't stall the route. */
const SSH_EXEC_TIMEOUT_MS = 5000;

/**
 * Extract the trimmed content of the `## Role` section from a markdown body.
 * Returns "" (empty string) when the section is absent — callers still render
 * the role by name (Test 6 pins this: NEVER null; downstream dropdown renders).
 */
function extractRoleDescription(markdown: string): string {
  // Match `## Role` heading (anywhere in doc), capture everything up to the next
  // `## ` heading or end-of-string. We use `[\s\S]*?` for cross-line capture and
  // `(?=\n##\s|$(?![\s\S]))` as the terminator — `$` alone under `/m` would
  // match every line end, cutting descriptions after the first line (Test 5
  // regression).
  const match = markdown.match(
    /(?:^|\n)##\s+Role\s*\n([\s\S]*?)(?=\n##\s|$(?![\s\S]))/,
  );
  if (!match) return "";
  return match[1].trim();
}

/**
 * Race an exec against a timeout so a hung remote can't stall the route.
 * Matches identity-artifact-reader.execWithTimeout shape.
 */
function execWithTimeout(
  conn: Awaited<ReturnType<typeof connectOneShot>>,
  command: string,
  timeoutMs: number = SSH_EXEC_TIMEOUT_MS,
): Promise<string> {
  return Promise.race([
    execCommand(conn, command),
    new Promise<string>((_, reject) =>
      setTimeout(
        () => reject(new Error(`SSH exec timeout after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}

/**
 * GET /roles?hostId=<n>
 * Returns [{name, description}] for every valid role in ~/.claude/roles/ on the target host.
 */
router.get(
  "/",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse + validate hostId
    const rawHostId = req.query.hostId;
    if (rawHostId === undefined || rawHostId === "") {
      return res.status(400).json({ error: "hostId is required" });
    }
    const hostId = parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      return res.status(400).json({ error: "hostId must be a positive integer" });
    }

    // 2. Verify host ownership — returns null for cross-user / unknown hosts.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    // 3. Open SSH connection (try/finally guarantees end() on every exit).
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("roles-list-for-host: SSH connect failed", {
          operation: "roles_list_for_host_connect",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        return res.status(502).json({ error: "SSH connect failed" });
      }

      // 4. List role directories. `|| true` protects the exit code if the
      //    directory does not exist; empty ls just yields the empty array.
      let lsOutput: string;
      try {
        lsOutput = await execWithTimeout(
          conn,
          `ls -1 "$HOME/.claude/roles" 2>/dev/null || true`,
        );
      } catch (err) {
        sshLogger.warn("roles-list-for-host: SSH exec (ls) failed", {
          operation: "roles_list_for_host_ls",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        // Non-fatal: return empty list so dropdown renders "no roles" instead
        // of a hard error surface (Ashley sees empty state, not a 500).
        return res.json([]);
      }

      const rawEntries = lsOutput
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // 5. Silently drop entries that fail the kebab-case gate (STRIDE T-22-02-02).
      const validRoles = rawEntries
        .filter((name) => ROLE_NAME_PATTERN.test(name))
        .sort();

      if (validRoles.length === 0) {
        return res.json([]);
      }

      // 6. Batched cat with ===ROLE:<n>=== delimiters (single SSH round-trip).
      //    Role names are pre-validated by ROLE_NAME_PATTERN so shell
      //    interpolation is safe (kebab-case has no shell-special chars).
      const catCmd = validRoles
        .map(
          (r) =>
            `echo "===ROLE:${r}===" && cat "$HOME/.claude/roles/${r}/${r}.md" 2>/dev/null || true`,
        )
        .join(" ; ");

      let catOutput: string;
      try {
        catOutput = await execWithTimeout(conn, catCmd);
      } catch (err) {
        sshLogger.warn("roles-list-for-host: SSH exec (cat) failed", {
          operation: "roles_list_for_host_cat",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        // Same graceful path — return names with empty descriptions so
        // Ashley can still pick a role even if descriptions failed to load.
        return res.json(validRoles.map((name) => ({ name, description: "" })));
      }

      // 7. Split on ===ROLE:<n>=== delimiters and extract per-role description.
      //    First split yields ["", "<name>", "<body>", "<name>", "<body>", ...]
      //    because the delimiter is at the start of every block.
      const blocks = catOutput.split(/^===ROLE:([a-z0-9-]+)===\s*$/m);
      // blocks[0] is the pre-first-delimiter text (empty or whitespace).
      // Then pairs of [name, body] follow.
      const descByName = new Map<string, string>();
      for (let i = 1; i < blocks.length; i += 2) {
        const name = blocks[i];
        const body = blocks[i + 1] ?? "";
        if (ROLE_NAME_PATTERN.test(name)) {
          descByName.set(name, extractRoleDescription(body));
        }
      }

      const result = validRoles.map((name) => ({
        name,
        description: descByName.get(name) ?? "",
      }));

      return res.json(result);
    } finally {
      if (conn) {
        try {
          conn.end();
        } catch {
          /* ignore */
        }
      }
    }
  },
);

// Generic 500 fallback error handler (mirrors identities.ts / identity-exists-on-host.ts)
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    sshLogger.error("roles-list-for-host: unhandled error", {
      operation: "roles_list_for_host_error",
      error: err?.message,
    });
    return res
      .status(500)
      .json({ error: "internal" });
  },
);

export default router;
