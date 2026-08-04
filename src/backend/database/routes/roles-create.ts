/**
 * Phase 22 (SRIC-04): POST /roles — target-host-side role folder creation.
 *
 * POST /roles
 *   Body: { name: string, description: string, hostId: number }
 *   → 201 { name, description } on success
 *   → 400 on validation failure (missing/malformed name/description/hostId)
 *   → 401 without JWT
 *   → 404 when hostId does not resolve for the caller (cross-user isolation)
 *   → 409 when ~/.claude/roles/<name>/ already exists on the target host
 *   → 502 on SSH connect failure
 *
 * Sequence per RESEARCH F8-B6 "Pattern for roles:create mkdir + touch + write":
 *   1. Validate body (name via ROLE_NAME_PATTERN, description non-empty ≤4KB,
 *      hostId positive integer).
 *   2. resolveHostById(hostId, userId) → 404 on cross-user / unknown.
 *   3. connectOneShot(host, 5000) — 502 on failure.
 *   4. Collision probe: exec `if [ -d "$HOME/.claude/roles/<name>" ] ...` —
 *      409 if "exists".
 *   5. Provision atomically:
 *      a. `mkdir -p "$HOME/.claude/roles/<name>/bounties"` (creates parent
 *         AND bounties/ in one idempotent call — survives the roles-list race
 *         per RESEARCH Security "Role name collision race — accept the race
 *         — worst case is duplicate mkdir which is idempotent").
 *      b. `touch "$HOME/.claude/roles/<name>/history.md"`.
 *      c. Resolve remote $HOME via `echo $HOME`.
 *      d. writeMarkdownFileAtomic(conn, "<remoteHome>/.claude/roles/<name>/<name>.md",
 *         stubMarkdown) — MUST use the SFTP helper (Pitfall 3 / #260802-qrw:
 *         raw sftp.rename triggers SSH2_FX_FAILURE on overwrite; the helper
 *         uses ext_openssh_rename with POSIX atomic-overwrite semantics).
 *   6. Response 201 { name, description }.
 *   7. Finally: conn.end() (try/catch swallow — best-effort).
 *
 * Stub body — REVISION 2026-08-04 (Ashley at 22-02 checkpoint, applies HERE
 * per same-pattern extension). When Skynet auto-creates a role folder, embed
 * a SEED COMMENT below the description telling the first-agent-of-role to
 * flesh out the file on wake. Same style rules as the identity-file seed
 * (22-02 Task 3): plain terms, no system-specific names (no "Skynet"), no
 * id-skill section refs (no §2/§3/SKILL.md).
 *
 * Body shape written verbatim (see ROLE_STUB_SEED_COMMENT constant):
 *   # <name>
 *
 *   ## Role
 *
 *   <description>
 *
 *   <!-- This role file was auto-generated with only a basic description. On
 *   first wake of an agent holding this role, please flesh out the role with
 *   standing directives, learned preferences, and a 10,000-foot view of the
 *   domain the role covers, then remove this comment. -->
 *
 * Security posture (STRIDE threat register in the plan):
 *   T-22-04-01: Shell injection via role name in mkdir/touch — MITIGATE via
 *     ROLE_NAME_PATTERN /^[a-z0-9-]+$/ gate at HTTP handler entry. Kebab-case-
 *     lowercase has NO shell-special chars (no quotes, backticks, spaces,
 *     semicolons, redirections). Test 2 covers uppercase+underscore; Test 2b
 *     covers path traversal.
 *   T-22-04-02: Path traversal via ../ in role name — MITIGATE via same regex
 *     (dots and slashes blocked). Test 2b.
 *   T-22-04-03: Cross-user role provisioning via spoofed hostId — MITIGATE via
 *     resolveHostById(hostId, userId) returning null for cross-user hosts.
 *     Test 4.
 *   T-22-04-04: DoS via unbounded description — MITIGATE via 4KB cap in body
 *     validator. Nginx block also sets client_max_body_size 32k as belt.
 *   T-22-04-05: SFTP EEXIST trap — MITIGATE by using writeMarkdownFileAtomic
 *     (ext_openssh_rename) NOT raw sftp.rename. Test 6 asserts the helper is
 *     called (mock guards the call site).
 *   T-22-04-07: Info disclosure via SSH stderr — MITIGATE via generic 5xx
 *     response bodies; upstream detail only in sshLogger.
 *
 * Mount point: app.use("/roles", rolesCreateRoutes) alongside the sibling
 * rolesListForHostRoutes (also at "/roles"). Both routers are Router instances;
 * the list router handles GET only, so POST falls through to this router.
 * Both /roles mounts appear BEFORE /identities in database.ts to preserve
 * match precedence.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { writeMarkdownFileAtomic } from "../../claude-session/identity-artifact-reader.js";
import { ROLE_NAME_PATTERN } from "./identity-birth-orchestrator.js";
import { sshLogger } from "../../utils/logger.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches other one-shot SSH endpoints. */
const SSH_CONNECT_TIMEOUT_MS = 5000;

/** SSH exec race timeout — bounded so a hung remote can't stall the route. */
const SSH_EXEC_TIMEOUT_MS = 5000;

/** Description length cap (bytes). 4KB matches the plan's threat model
 *  (T-22-04-04 DoS via unbounded payload) and the nginx client_max_body_size
 *  32k belt (which also covers JSON envelope + name + hostId). */
const MAX_DESCRIPTION_BYTES = 4096;

/** Maximum role-name length matching frontend UI expectations. */
const MAX_NAME_LENGTH = 64;

/**
 * REVISION 2026-08-04 (Ashley at 22-02 checkpoint, applies HERE per same-
 * pattern extension). Seed comment embedded below the description so the
 * first agent to hold this role knows to flesh out the file on wake.
 *
 * Style constraints (verbatim from Ashley — enforced by test 6 assertions):
 *   - Do NOT say "Skynet" (agents don't know what that is)
 *   - Do NOT reference §2 / §3 / "id skill" / SKILL.md (fragile skill refs)
 *   - Plain-terms instructions to the wake-up agent
 *   - Ends with "remove this comment" so the agent knows to clear it
 */
const ROLE_STUB_SEED_COMMENT =
  "<!-- This role file was auto-generated with only a basic description. On first wake of an agent holding this role, please flesh out the role with standing directives, learned preferences, and a 10,000-foot view of the domain the role covers, then remove this comment. -->";

/**
 * Race an exec against a timeout so a hung remote can't stall the route.
 * Matches roles-list-for-host.execWithTimeout / identity-artifact-reader.
 * execWithTimeout shape.
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
 * POST /
 * Body: { name, description, hostId }
 * Provisions ~/.claude/roles/<name>/ + bounties/ + history.md + <name>.md stub.
 */
router.post(
  "/",
  express.json({ limit: "32kb" }),
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // -----------------------------------------------------------------------
    // 1. Body validation — 400 on any failure with distinct error messages
    // -----------------------------------------------------------------------
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawName = body.name;
    const rawDescription = body.description;
    const rawHostId = body.hostId;

    if (typeof rawName !== "string" || rawName.length === 0) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (rawName.length > MAX_NAME_LENGTH) {
      res.status(400).json({ error: `name must be ≤${MAX_NAME_LENGTH} chars` });
      return;
    }
    if (!ROLE_NAME_PATTERN.test(rawName)) {
      res.status(400).json({
        error: "name must be kebab-case-lowercase (a-z, 0-9, hyphen only)",
      });
      return;
    }
    if (typeof rawDescription !== "string" || rawDescription.length === 0) {
      res.status(400).json({ error: "description is required" });
      return;
    }
    if (Buffer.byteLength(rawDescription, "utf-8") > MAX_DESCRIPTION_BYTES) {
      res.status(400).json({
        error: `description must be ≤${MAX_DESCRIPTION_BYTES} bytes`,
      });
      return;
    }
    if (
      typeof rawHostId !== "number" ||
      !Number.isInteger(rawHostId) ||
      rawHostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }

    const name = rawName;
    const description = rawDescription;
    const hostId = rawHostId;

    // -----------------------------------------------------------------------
    // 2. Host resolution — 404 for cross-user / unknown hosts
    // -----------------------------------------------------------------------
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    // -----------------------------------------------------------------------
    // 3. SSH connect — 502 on failure (conn not yet assigned → no cleanup)
    // -----------------------------------------------------------------------
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("roles-create: SSH connect failed", {
          operation: "roles_create_connect",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      // ---------------------------------------------------------------------
      // 4. Collision probe: 409 if the role folder already exists.
      //    name is pre-validated by ROLE_NAME_PATTERN so the interpolation
      //    into the double-quoted path is shell-safe (kebab-case has no
      //    shell-special chars; matches identity-exists-on-host.ts:118-122
      //    "validate-then-interpolate" pattern).
      // ---------------------------------------------------------------------
      let existsStdout: string;
      try {
        existsStdout = await execWithTimeout(
          conn,
          `if [ -d "$HOME/.claude/roles/${name}" ]; then echo exists; else echo missing; fi`,
        );
      } catch (err) {
        sshLogger.warn("roles-create: existence probe exec failed", {
          operation: "roles_create_exists_probe",
          hostId,
          name,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      if (existsStdout.trim() === "exists") {
        res.status(409).json({ error: "role exists on host" });
        return;
      }

      // ---------------------------------------------------------------------
      // 5. Provision: mkdir -p (idempotent, race-tolerant) + touch history.md.
      //    -p creates the parent role dir AND bounties/ in one atomic exec.
      // ---------------------------------------------------------------------
      try {
        await execWithTimeout(
          conn,
          `mkdir -p "$HOME/.claude/roles/${name}/bounties"`,
        );
        await execWithTimeout(
          conn,
          `touch "$HOME/.claude/roles/${name}/history.md"`,
        );
      } catch (err) {
        sshLogger.warn("roles-create: provision exec failed", {
          operation: "roles_create_provision",
          hostId,
          name,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      // ---------------------------------------------------------------------
      // 6. Resolve remote $HOME so we can pass an absolute path to SFTP
      //    (writeMarkdownFileAtomic works over SFTP which does NOT tilde-
      //    expand — the target path must be absolute).
      // ---------------------------------------------------------------------
      let remoteHome: string;
      try {
        remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
        if (!remoteHome) {
          throw new Error("could not resolve remote $HOME");
        }
      } catch (err) {
        sshLogger.warn("roles-create: $HOME resolution failed", {
          operation: "roles_create_home",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      // ---------------------------------------------------------------------
      // 7. Build stub markdown + write via SFTP tmp+rename.
      //    Description passed VERBATIM (multi-line preserved). Placed under
      //    ## Role per D-CONTEXT §Claude's Discretion default (matches id
      //    skill template — the same source roles-list-for-host reads back).
      //    REVISION: seed comment embedded below the description so the
      //    first-wake agent knows to flesh out the file.
      // ---------------------------------------------------------------------
      const stubMarkdown =
        `# ${name}\n\n## Role\n\n${description}\n\n${ROLE_STUB_SEED_COMMENT}\n`;

      const targetPath = `${remoteHome}/.claude/roles/${name}/${name}.md`;

      try {
        await writeMarkdownFileAtomic(conn, targetPath, stubMarkdown);
      } catch (err) {
        sshLogger.error(
          "roles-create: SFTP write failed",
          err instanceof Error ? err : new Error(String(err)),
          {
            operation: "roles_create_sftp_write",
            hostId,
            name,
            targetPath,
          },
        );
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      // ---------------------------------------------------------------------
      // 8. Response 201 { name, description }.
      // ---------------------------------------------------------------------
      res.status(201).json({ name, description });
      return;
    } finally {
      if (conn) {
        try {
          conn.end();
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  },
);

// Generic 500 fallback error handler (mirrors roles-list-for-host / identities.ts).
// Sanitizes upstream detail per RESEARCH V7 (never leak stderr/tailnet paths in
// response body).
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    sshLogger.error("roles-create: unhandled error", {
      operation: "roles_create_error",
      error: err?.message,
    });
    return res.status(500).json({ error: "internal" });
  },
);

export default router;
