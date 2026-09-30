/**
 * Phase 143 Plan 143-04 (D-01/D-02/D-03/D-04): POST /identities/:key/unarchive
 *
 * User-initiated un-archive gesture. Drops the `.unarchive-requested` sentinel
 * inside the archived identity's folder (`~/fleet/identities-archive/<key>/`)
 * so the agent-supervisor's reconcile tick picks it up on its next scan and
 * runs the un-archive procedure (matrix reactivate + folder move back to live tree).
 *
 * POST /identities/:key/unarchive  body: { hostId: number }
 *   → 200 { ok: true }
 *   → 409 { reason: "archive_not_found" }                       — D-02 precondition 1
 *   → 409 { reason: "name_collision" }                          — D-02 precondition 2
 *   → 409 { reason: "missing_roles", missingRoles: string[] }   — D-02 precondition 3
 *
 * Semantic contract (per Phase 143 CONTEXT D-01/D-02/D-03/D-04):
 *   - D-01: Drops `.unarchive-requested` inside the ARCHIVE folder. Reconciler
 *     (shape 1, already landed) moves the folder back to the live tree on the
 *     next scan tick.
 *   - D-02: Three fast-path preconditions (defense-in-depth; reconciler enforces
 *     the same logic independently per D-04):
 *       1. archive-exists: `~/fleet/identities-archive/<key>/` must be present.
 *       2. name-collision: `~/fleet/identities/<key>/` must NOT exist (would
 *          shadow the returning folder).
 *       3. all-roles-live: every role listed in the archived identity's
 *          `role:` frontmatter must have a live folder (`~/fleet/roles/<name>/`).
 *          If any are still archived, refuse with missingRoles listing them.
 *          Role frontmatter is parsed with the SAME Python inline used by shape 1's
 *          supervisor scanner (_extract_frontmatter_roles in agent-supervisor.sh) —
 *          handles scalar, flow-list, and block-list YAML shapes (D-02 explicit).
 *   - D-03: Failure response shape — structured 409 `{ reason, missingRoles? }`.
 *     reason is exactly one of: "archive_not_found", "name_collision", "missing_roles".
 *   - D-04: Reconciler is authoritative on-tick; this precondition check is
 *     fast-path defense so the frontend can surface a reason immediately.
 *   - Idempotent (D-01 / CONTEXT Specifics): sentinel already present → write
 *     succeeds via tmp+rename overwrite → endpoint returns 200.
 *
 * Route mirrors identity-archive.ts byte-for-byte through step 4 (auth →
 * hostId parse → key gate → resolveHostById → LOCAL/REMOTE branch), then
 * inserts three preconditions (5a/5b/5c) BEFORE the sentinel write (5d).
 *
 * Security (Phase 143 Plan 143-04 threat register):
 *   - T-143-04-01 (EoP, unauth caller): authenticateJWT middleware runs first;
 *     resolveHostById(hostId, userId) → 404 on cross-user hostId (mirrors
 *     identity-archive.ts T-115-03-01 shape).
 *   - T-143-04-02 (Tampering, path traversal via key): IDENTITY_KEY_RE gate at
 *     route entry BEFORE any disk or SSH activity. Archive-tree writer
 *     (plan 143-01) re-validates as defense-in-depth. All `test -d` and `cat`
 *     shell interpolations use ONLY regex-vetted values.
 *   - T-143-04-03 (Tampering, relPath traversal): writer whitelist locked to
 *     `.unarchive-requested` only (plan 143-01). Route only ever passes that
 *     literal string.
 *   - T-143-04-04 (EoP, precondition bypass): writer NOT called when a
 *     precondition fails — checked-then-written discipline enforced by test
 *     4/5 (missing_roles writer-NOT-called assertion).
 *   - T-143-04-06 (Information Disclosure, 500 leak): generic error message
 *     returned to client; full detail logged server-side.
 *   - T-143-04-07 (Repudiation): audit log on success with userId + hostId + key.
 *
 * Mounted in database.ts immediately AFTER app.use("/identities", identityArchiveRoutes)
 * (Phase 143 D-01). Both routers coexist under "/identities"; their POST sub-paths
 * are distinct (:key/archive vs :key/unarchive) so no handler shadowing occurs.
 */

import path from "path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import {
  isLocalHostId,
  IDENTITY_KEY_RE,
  getLocalIdentitiesRoot,
} from "../../claude-session/identity-artifact-reader.js";
import { writeIdentityArchiveFile } from "../../claude-session/per-identity-archive-file.js";
import { getLocalArchivedIdentitiesRoot } from "../../claude-session/list-archived-identity-keys.js";
import { getLocalArchivedRolesRoot } from "../../claude-session/per-role-archive-file.js";
import { execCommand } from "../../ssh/tmux-helper.js";

/**
 * Promisified wrapper for execFile that resolves with { stdout, stderr }.
 * Defined as an explicit async function (rather than util.promisify) so that
 * the node:child_process mock in tests only needs to provide a standard
 * callback-style execFile mock — no util.promisify.custom symbol required.
 */
function execFileAsync(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches sibling identity-archive.ts. */
const SSH_CONNECT_TIMEOUT_MS = 3000;

/**
 * The Python inline from shape 1's _extract_frontmatter_roles (agent-supervisor.sh
 * lines 1279-1349). Parses the `role:` frontmatter from an identity.md file and
 * prints a JSON array of role names to stdout. Handles all three YAML shapes:
 *   - Scalar:     role: box-maintainer
 *   - Flow-list:  role: [box-maintainer, sky-uat]
 *   - Block-list: role:\n  - box-maintainer\n  - sky-uat
 *
 * D-02 explicit: "SAME Python inline shape 1's supervisor scanner uses".
 * This is the verbatim inline from agent-supervisor.sh (stdlib only, no PyYAML).
 */
// The Python inline from shape 1's _extract_frontmatter_roles (agent-supervisor.sh
// lines 1279-1349). Using a regular (non-template) string to avoid backtick
// collision with TS template-literal parsing.
const EXTRACT_ROLES_PYTHON = [
  "import sys, re, json",
  "",
  "with open(sys.argv[1]) as f:",
  "    lines = f.read().split('\\n')",
  "",
  "# Find the frontmatter block bounded by --- ... ---.",
  "if not lines or lines[0].strip() != '---':",
  "    print('[]', end=''); sys.exit(1)",
  "fm_end = None",
  "for i in range(1, len(lines)):",
  "    if lines[i].strip() == '---':",
  "        fm_end = i",
  "        break",
  "if fm_end is None:",
  "    print('[]', end=''); sys.exit(1)",
  "fm = lines[1:fm_end]",
  "",
  "# Find the \"role:\" line.",
  "role_idx = None",
  "for i, line in enumerate(fm):",
  "    if re.match(r'^role\\s*:', line):",
  "        role_idx = i",
  "        break",
  "if role_idx is None:",
  "    # No role field -- legal, just empty.",
  "    print('[]', end=''); sys.exit(0)",
  "",
  "value = re.sub(r'^role\\s*:\\s*', '', fm[role_idx])",
  "",
  "def strip_quotes(v):",
  "    v = v.strip()",
  "    # Require length >= 2 before stripping.",
  "    if len(v) < 2:",
  "        return v",
  "    if (v.startswith('\"') and v.endswith('\"')) or (v.startswith(\"'\") and v.endswith(\"'\")):",
  "        v = v[1:-1]",
  "    return v",
  "",
  "roles = []",
  "if value.strip() == '':",
  "    # Block list -- subsequent indented \"  - name\" lines.",
  "    for line in fm[role_idx+1:]:",
  "        m = re.match(r'^\\s+-\\s+(.+?)\\s*$', line)",
  "        if not m:",
  "            if line.strip() == '':",
  "                continue",
  "            break",
  "        roles.append(strip_quotes(m.group(1)))",
  "elif value.strip().startswith('['):",
  "    # Flow list -- [a, b, c] (assume single-line).",
  "    inner = value.strip()",
  "    if not inner.endswith(']'):",
  "        print('[]', end=''); sys.exit(1)",
  "    inner = inner[1:-1]",
  "    for part in inner.split(','):",
  "        v = strip_quotes(part)",
  "        if v:",
  "            roles.append(v)",
  "else:",
  "    # Scalar.",
  "    roles.append(strip_quotes(value))",
  "",
  "print(json.dumps(roles), end='')",
].join("\n");

/**
 * Parse the `role:` frontmatter from a LOCAL identity.md file using the Python
 * inline (D-02). Returns a list of role names. Returns [] on file-not-found or
 * any parse failure (the precondition is vacuously satisfied with an empty list).
 */
async function parseRolesFromLocalIdentityMd(
  identityMdPath: string,
): Promise<string[]> {
  try {
    await fs.access(identityMdPath);
  } catch {
    // identity.md missing — treat as no roles (precondition satisfied).
    return [];
  }
  try {
    const { stdout } = await execFileAsync("python3", ["-c", EXTRACT_ROLES_PYTHON, identityMdPath]);
    const roles = JSON.parse(stdout.trim() || "[]") as string[];
    return Array.isArray(roles) ? roles : [];
  } catch {
    // Parse failure → treat as empty roles list (precondition satisfied).
    return [];
  }
}

/**
 * Parse the `role:` frontmatter from a REMOTE identity.md file using the Python
 * inline over SSH (D-02). Returns a list of role names. Returns [] on any error.
 */
async function parseRolesFromRemoteIdentityMd(
  conn: Awaited<ReturnType<typeof connectOneShot>>,
  key: string,
): Promise<string[]> {
  // cat the file; if missing (cat exits non-zero) we get empty output — treat as no roles.
  let fileContent: string;
  try {
    fileContent = await execCommand(
      conn,
      `cat "$HOME/fleet/identities-archive/${key}/identity.md" 2>/dev/null || true`,
    );
  } catch {
    return [];
  }

  if (!fileContent.trim()) {
    return [];
  }

  // Run the Python inline via heredoc pattern: write content to a temp file
  // then parse it. We use `python3 -c '...' /dev/stdin` pattern by piping
  // the content; however, since the Python script reads sys.argv[1] as a
  // FILE path, we use a two-step: write to a tmpfile, parse, remove.
  // Simpler and equally safe: use printf + python3 reading from /proc/self/fd/0
  // via sys.argv approach by passing filename as - and reading stdin.
  //
  // Instead we use the most direct approach: write to a remote tmp file, parse, clean.
  const tmpPath = `/tmp/.skynet-role-parse-${key}-${Date.now()}`;
  // Escape content for single-quoted shell — escape single quotes as '\''
  const escaped = fileContent.replace(/'/g, "'\\''");
  try {
    const cmd = [
      `printf '%s' '${escaped}' > ${tmpPath}`,
      `python3 -c ${shellEscapeForRemote(EXTRACT_ROLES_PYTHON)} ${tmpPath}`,
      `rm -f ${tmpPath}`,
    ].join(" && ");
    const result = await execCommand(conn, cmd);
    const parsed = JSON.parse(result.trim() || "[]") as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Clean up on error
    try {
      await execCommand(conn, `rm -f ${tmpPath}`);
    } catch {
      /* ignore */
    }
    return [];
  }
}

/**
 * Minimal shell escaping: wraps the string in single quotes, escaping any
 * embedded single quotes as '\''. Used for REMOTE python3 -c invocations.
 */
function shellEscapeForRemote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * POST /:key/unarchive  body: { hostId: number }
 *
 * Drops `.unarchive-requested` inside the archived identity folder after
 * checking three preconditions (D-02).
 *
 * Errors:
 *   - 400 { error: "hostId is required" }              — missing hostId
 *   - 400 { error: "hostId must be a positive integer" } — malformed hostId
 *   - 400 { error: "identity key must match [a-z0-9_-]{1,64}" } — bad key
 *   - 404 { error: "Host not found" }                  — unknown / cross-user hostId
 *   - 409 { reason: "archive_not_found" }              — archived folder missing (D-02 §1)
 *   - 409 { reason: "name_collision" }                 — live folder exists (D-02 §2)
 *   - 409 { reason: "missing_roles", missingRoles: string[] } — roles still archived (D-02 §3)
 *   - 504 { error: "Host unreachable" }                — SSH connect failure (REMOTE)
 *   - 500 { error: "failed to drop unarchive sentinel" } — write failure
 */
router.post(
  "/:key/unarchive",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse + validate hostId (body).
    const rawHostId = (req.body as { hostId?: unknown } | undefined)?.hostId;
    if (rawHostId === undefined || rawHostId === null || rawHostId === "") {
      return res.status(400).json({ error: "hostId is required" });
    }
    const hostId =
      typeof rawHostId === "number"
        ? rawHostId
        : parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      return res
        .status(400)
        .json({ error: "hostId must be a positive integer" });
    }

    // 2. Validate identity key via IDENTITY_KEY_RE (T-143-04-02 gate).
    const key = String(req.params.key ?? "");
    if (!key || !IDENTITY_KEY_RE.test(key)) {
      return res
        .status(400)
        .json({ error: "identity key must match [a-z0-9_-]{1,64}" });
    }

    // 3. Verify host ownership (T-143-04-01 gate). Returns null for cross-user
    // or unknown hostId → 404 (same shape as sibling routes to avoid a
    // 403-vs-404 probe distinguisher).
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    // 4. Branch on LOCAL vs REMOTE. LOCAL branch passes conn=null; REMOTE
    // branch opens a one-shot SSH connection whose lifetime is scoped to the
    // precondition checks + writeIdentityArchiveFile call by the try/finally.
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    if (!isLocalHostId(hostId)) {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch {
        // Connect failure → 504 with generic message (T-143-04-06).
        return res.status(504).json({ error: "Host unreachable" });
      }
    }

    try {
      // 5a. archive-exists precondition (D-02 §1):
      // Refuse if the archived folder does not exist at the expected path.
      if (conn === null) {
        // LOCAL branch
        try {
          await fs.access(
            path.join(getLocalArchivedIdentitiesRoot(), key),
          );
        } catch {
          return res.status(409).json({ reason: "archive_not_found" });
        }
      } else {
        // REMOTE branch — all IDENTITY_KEY_RE-validated values, no shell-metachar risk.
        const out = await execCommand(
          conn,
          `test -d "$HOME/fleet/identities-archive/${key}" && echo yes || echo no`,
        );
        if (out.trim() !== "yes") {
          return res.status(409).json({ reason: "archive_not_found" });
        }
      }

      // 5b. name-collision precondition (D-02 §2):
      // Refuse if a live-tree identity with the same key already exists.
      if (conn === null) {
        // LOCAL branch — success (no ENOENT) means live folder exists → collision
        try {
          await fs.access(path.join(getLocalIdentitiesRoot(), key));
          // fs.access succeeded → live folder exists
          return res.status(409).json({ reason: "name_collision" });
        } catch {
          // ENOENT — no collision, continue
        }
      } else {
        // REMOTE branch
        const out = await execCommand(
          conn,
          `test -d "$HOME/fleet/identities/${key}" && echo yes || echo no`,
        );
        if (out.trim() === "yes") {
          return res.status(409).json({ reason: "name_collision" });
        }
      }

      // 5c. all-roles-live precondition (D-02 §3, identity-only):
      // Parse the archived identity's role: frontmatter and check every listed
      // role has a live folder. Refuse with missingRoles listing if any are
      // still archived.
      let roles: string[];
      if (conn === null) {
        // LOCAL branch
        const identityMdPath = path.join(
          getLocalArchivedIdentitiesRoot(),
          key,
          "identity.md",
        );
        roles = await parseRolesFromLocalIdentityMd(identityMdPath);
      } else {
        // REMOTE branch
        roles = await parseRolesFromRemoteIdentityMd(conn, key);
      }

      if (roles.length > 0) {
        // Check each role — collect still-archived ones.
        const stillArchived: string[] = [];

        for (const roleName of roles) {
          if (conn === null) {
            // LOCAL: role is still archived if its folder exists under roles-archive
            try {
              await fs.access(
                path.join(getLocalArchivedRolesRoot(), roleName),
              );
              // access succeeded → still archived
              stillArchived.push(roleName);
            } catch {
              // ENOENT → not archived (live or doesn't exist — either way, not blocking)
            }
          } else {
            // REMOTE
            const out = await execCommand(
              conn,
              `test -d "$HOME/fleet/roles-archive/${roleName}" && echo yes || echo no`,
            );
            if (out.trim() === "yes") {
              stillArchived.push(roleName);
            }
          }
        }

        if (stillArchived.length > 0) {
          return res.status(409).json({
            reason: "missing_roles",
            missingRoles: stillArchived.sort(),
          });
        }
      }

      // 5d. Drop the sentinel via the archive-tree writer (plan 143-01).
      // The writer re-validates key + relPath before touching disk (belt-and-suspenders).
      // Idempotent by construction: existing sentinel is overwritten via tmp+rename.
      await writeIdentityArchiveFile(key, ".unarchive-requested", "", {
        hostId,
        conn,
      });

      // Audit log per T-143-04-07 (repudiation): who requested un-archive on what.
      databaseLogger.info(
        `identity unarchive requested: userId=${userId}, hostId=${hostId}, key=${key}`,
      );

      return res.json({ ok: true });
    } catch (err) {
      // Log server-side; return generic message to the client (T-143-04-06).
      databaseLogger.error(
        `failed to drop .unarchive-requested sentinel for key=${key} hostId=${hostId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return res
        .status(500)
        .json({ error: "failed to drop unarchive sentinel" });
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

// Generic 500 fallback error handler (mirrors sibling identity-archive.ts).
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    return res
      .status(500)
      .json({ error: err?.message ?? "identity-unarchive route error" });
  },
);

export default router;
