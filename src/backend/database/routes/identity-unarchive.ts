/**
 * Phase 143 Plan 143-04 (D-01/D-02/D-03/D-04): POST /identities/:key/unarchive
 *
 * User-initiated un-archive gesture. The route owns the full on-the-wire
 * sequence from precondition checks through the Matrix reactivate + token
 * mint + relay.json rewrite and finally the `.unarchive-requested` sentinel
 * drop inside the archived identity's folder (`~/fleet/identities-archive/<key>/`).
 * The agent-supervisor's reconcile tick picks up the sentinel and does the
 * folder move back to the live tree.
 *
 * 2026-10-01 matrix-cred-location correction: the Matrix reactivate + token
 * mint + relay.json rewrite steps live HERE (always run on T1000 where the
 * encrypted admin creds live) rather than in the per-host supervisor (which
 * doesn't have access to the admin creds on hosts other than T1000). The
 * supervisor retains folder-mv + sentinel-delete + dormancy logic + a whoami
 * safety-check that refuses a sentinel the backend didn't precede (half-un-archive
 * guard). See `.planning/campaigns/un-archiving/shape-agent-side-identity-unarchive-correction.md`
 * for the agent-side-restoration shape and the architecture rationale.
 *
 * POST /identities/:key/unarchive  body: { hostId: number }
 *   → 200 { ok: true }
 *   → 409 { reason: "archive_not_found" }                       — precondition 1
 *   → 409 { reason: "name_collision" }                          — precondition 2
 *   → 409 { reason: "missing_roles", missingRoles: string[] }   — precondition 3
 *   → 502 { error: "matrix reactivate failed" }                 — admin API failure
 *   → 502 { error: "matrix mint failed" }                       — admin login-as-user failure
 *   → 500 { error: "relay.json read/parse failed" }             — archive relay corrupt
 *   → 500 { error: "relay.json rewrite failed" }                — write-side failure (incl. SSH)
 *   → 500 { error: "failed to drop unarchive sentinel" }        — sentinel write failure
 *
 * On a Matrix-reactivate/mint partial success followed by relay.json rewrite
 * or sentinel-drop failure: the Synapse account is reactivated but the on-disk
 * state is NOT updated. The orphan state (reactivated account, dead token in
 * relay.json, no sentinel) is harmless and self-healing: user retries → the
 * admin PUT is idempotent (deactivated=false either way), login_as_user mints
 * a fresh token, relay.json rewrites again, sentinel drops. No compensating
 * re-deactivate (shape 4 discussion will revisit if the pattern changes).
 *
 * Semantic contract:
 *   - D-01: Drops `.unarchive-requested` inside the ARCHIVE folder. Reconciler
 *     (shape 1, already landed) moves the folder back to the live tree on the
 *     next scan tick after a whoami probe confirms the Matrix account is live.
 *   - D-02: Three fast-path preconditions (defense-in-depth; reconciler enforces
 *     the same logic independently per D-04):
 *       1. archive-exists: `~/fleet/identities-archive/<key>/` must be present.
 *       2. name-collision: `~/fleet/identities/<key>/` must NOT exist (would
 *          shadow the returning folder).
 *       3. all-roles-live: every role listed in the archived identity's
 *          `role:` frontmatter must have a live folder (`~/fleet/roles/<name>/`).
 *          If any are still archived, refuse with missingRoles listing them.
 *   - D-03: Failure response shape — structured 409 `{ reason, missingRoles? }`
 *     for preconditions; 5xx with generic `error` text for Matrix / disk failures.
 *   - D-04: Reconciler is authoritative on-tick; the precondition check is
 *     fast-path defense so the frontend surfaces a reason immediately.
 *   - Idempotent: sentinel already present → write succeeds via tmp+rename
 *     overwrite → endpoint returns 200. Matrix reactivate + mint are idempotent
 *     per the Synapse admin API contract.
 *
 * Route mirrors identity-archive.ts byte-for-byte through step 4 (auth →
 * hostId parse → key gate → resolveHostById → LOCAL/REMOTE branch), then
 * runs preconditions (5a/5b/5c), the Matrix step (5d/5e/5f — 2026-10-01),
 * and finally the sentinel drop (5g).
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
  getLocalRolesRoot,
} from "../../claude-session/identity-artifact-reader.js";
import {
  writeIdentityArchiveFile,
  readIdentityArchiveFile,
} from "../../claude-session/per-identity-archive-file.js";
import { getLocalArchivedIdentitiesRoot } from "../../claude-session/list-archived-identity-keys.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import {
  createOrUpdateUser,
  loginAsUser,
} from "../../matrix/matrix-admin-client.js";

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
      // Identity files are `<key>/<key>.md`; `identity.md` kept as a legacy
      // fallback. (Reading only identity.md made roles always [] → the
      // missing_roles precondition never fired and the supervisor refused
      // silently after a 200.)
      `cat "$HOME/fleet/identities-archive/${key}/${key}.md" 2>/dev/null || cat "$HOME/fleet/identities-archive/${key}/identity.md" 2>/dev/null || true`,
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
        // `<key>/<key>.md` is the identity file; identity.md is a legacy
        // fallback (see the remote branch).
        const archivedDir = path.join(getLocalArchivedIdentitiesRoot(), key);
        roles = await parseRolesFromLocalIdentityMd(path.join(archivedDir, `${key}.md`));
        if (roles.length === 0) {
          roles = await parseRolesFromLocalIdentityMd(path.join(archivedDir, "identity.md"));
        }
      } else {
        // REMOTE branch
        roles = await parseRolesFromRemoteIdentityMd(conn, key);
      }

      if (roles.length > 0) {
        // Check each role — collect ones that are NOT live. Must match the
        // supervisor's un-archive gate exactly (it requires `~/fleet/roles/<role>/`
        // to exist): a role that is archived OR absent from the host would
        // otherwise pass here with a 200 and then be refused silently by the
        // supervisor. Role names come from frontmatter and are interpolated
        // into a shell command — anything not slug-shaped counts as missing.
        const stillArchived: string[] = [];
        const ROLE_NAME_RE = /^[a-z0-9_-]{1,64}$/;

        for (const roleName of roles) {
          if (!ROLE_NAME_RE.test(roleName)) {
            stillArchived.push(roleName);
            continue;
          }
          if (conn === null) {
            try {
              await fs.access(path.join(getLocalRolesRoot(), roleName));
            } catch {
              stillArchived.push(roleName);
            }
          } else {
            const out = await execCommand(
              conn,
              `test -d "$HOME/fleet/roles/${roleName}" && echo yes || echo no`,
            );
            if (out.trim() !== "yes") {
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

      // -----------------------------------------------------------------
      // 5d/5e/5f (2026-10-01 matrix-cred-location correction):
      // Matrix reactivate + token mint + relay.json rewrite BEFORE the
      // sentinel drop. Admin creds live in the DB on T1000 (where this
      // route always runs); the supervisor on the identity's home host
      // no longer touches Matrix admin at all. For LOCAL identities the
      // relay.json rewrite goes via fs; for REMOTE it goes via SSH using
      // the archive-tree writer's whitelist expansion for relay.json.
      //
      // Partial-success / orphan handling: Matrix reactivate is idempotent
      // (PUT deactivated=false either way), login_as_user is cheap, so a
      // write-side failure leaves a self-healing orphan: next user retry
      // flows through all three steps cleanly. No compensating re-deactivate.
      // -----------------------------------------------------------------

      // 5d. Read the archived relay.json for mxid + password. Preserve the
      // full JSON object so other fields (base, legacy keys) survive the
      // rewrite — only access_token + token alias change.
      let relayParsed: Record<string, unknown>;
      let mxid: string;
      let password: string;
      try {
        const raw = await readIdentityArchiveFile(key, "relay.json", {
          hostId,
          conn,
        });
        relayParsed = JSON.parse(raw) as Record<string, unknown>;
        const uid = relayParsed.user_id;
        const pw = relayParsed.password;
        if (typeof uid !== "string" || !uid.startsWith("@")) {
          throw new Error("relay.json user_id missing or malformed");
        }
        if (typeof pw !== "string" || pw.length === 0) {
          throw new Error("relay.json password missing");
        }
        mxid = uid;
        password = pw;
      } catch (readErr) {
        databaseLogger.error(
          `identity unarchive: relay.json read/parse failed for key=${key} hostId=${hostId}: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
        );
        return res
          .status(500)
          .json({ error: "relay.json read/parse failed" });
      }

      // 5e. Matrix reactivate (admin PUT /_synapse/admin/v2/users/{mxid}
      // with deactivated=false). createOrUpdateUser is the shared primitive;
      // same call shape identity-birth Step 6 uses.
      const reactivateResult = await createOrUpdateUser(mxid, password);
      if (reactivateResult.ok === false) {
        databaseLogger.error(
          `identity unarchive: matrix reactivate failed for mxid=${mxid} key=${key} status=${reactivateResult.status} error=${reactivateResult.error}`,
        );
        return res
          .status(502)
          .json({ error: "matrix reactivate failed" });
      }

      // 5f. Mint fresh access_token (admin POST /_synapse/admin/v1/users/{mxid}/login).
      const mintResult = await loginAsUser(mxid);
      if (mintResult.ok === false) {
        databaseLogger.error(
          `identity unarchive: matrix mint failed for mxid=${mxid} key=${key} status=${mintResult.status} error=${mintResult.error}`,
        );
        return res
          .status(502)
          .json({ error: "matrix mint failed" });
      }

      // 5f.5. Rewrite relay.json with the fresh token. Preserve all other
      // keys verbatim (base, legacy fields). Both access_token AND token
      // alias get the fresh value — recv.sh reads either (belt-and-braces
      // across historical schema variants per matrix-admin-client.ts:431).
      const newRelay = {
        ...relayParsed,
        access_token: mintResult.accessToken,
        token: mintResult.accessToken,
      };
      try {
        await writeIdentityArchiveFile(
          key,
          "relay.json",
          JSON.stringify(newRelay, null, 2),
          { hostId, conn, chmod: 0o600 },
        );
      } catch (writeErr) {
        databaseLogger.error(
          `identity unarchive: relay.json rewrite failed for key=${key} hostId=${hostId}: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
        );
        return res
          .status(500)
          .json({ error: "relay.json rewrite failed" });
      }

      // 5g. Drop the sentinel via the archive-tree writer (plan 143-01).
      // The writer re-validates key + relPath before touching disk (belt-and-suspenders).
      // Idempotent by construction: existing sentinel is overwritten via tmp+rename.
      // The supervisor's whoami probe (2026-10-01 safety) will see the fresh
      // token minted in step 5f and proceed with folder-mv.
      await writeIdentityArchiveFile(key, ".unarchive-requested", "", {
        hostId,
        conn,
      });

      // Audit log per T-143-04-07 (repudiation): who requested un-archive on what.
      databaseLogger.info(
        `identity unarchive requested: userId=${userId}, hostId=${hostId}, key=${key}, mxid=${mxid}`,
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
