/**
 * Phase 143 Plan 143-04 (D-01/D-02/D-03/D-04): POST /identities/:key/unarchive
 *
 * User-initiated un-archive gesture. The route runs the fast precondition
 * checks, drops the `.unarchive-requested` flag inside the archived identity's
 * folder (`~/fleet/identities-archive/<key>/`), then waits for the outcome.
 *
 * One un-archive path (shape-unarchive-one-path-supervisor-reactivation.md):
 * the flag is the only trigger — front end and agents drop the same one — and
 * the agent-supervisor on the identity's host does everything after it,
 * including asking this backend (identity-reactivate agent service) to bring
 * the chat account back. This route does no chat-account work.
 *
 * POST /identities/:key/unarchive  body: { hostId: number }
 *   → 200 { ok: true, outcome: "restored" }                    — folder back in the live tree
 *   → 200 { ok: true, outcome: "pending" }                     — no outcome within UNARCHIVE_WAIT_MS; still in progress
 *   → 409 { reason: "refused", message: string }               — supervisor refused (its note, verbatim)
 *   → 409 { reason: "archive_not_found" }                       — precondition 1
 *   → 409 { reason: "name_collision" }                          — precondition 2
 *   → 409 { reason: "missing_roles", missingRoles: string[] }   — precondition 3
 *   → 409 { reason: "identity_unreadable" }                     — identity file missing / unparseable
 *   → 500 { error: "failed to drop unarchive sentinel" }        — sentinel write failure
 *
 * Semantic contract:
 *   - D-01: Drops `.unarchive-requested` inside the ARCHIVE folder. The
 *     supervisor reactivates the chat account, logs in, and moves the folder
 *     back to the live tree; refusals leave `.unarchive-refused` and clear the flag.
 *   - D-02: Three fast-path preconditions (defense-in-depth; reconciler enforces
 *     the same logic independently per D-04):
 *       1. archive-exists: `~/fleet/identities-archive/<key>/` must be present.
 *       2. name-collision: `~/fleet/identities/<key>/` must NOT exist (would
 *          shadow the returning folder).
 *       3. all-roles-live: every role listed in the archived identity's
 *          `roles:` frontmatter must have a live folder (`~/fleet/roles/<name>/`).
 *          If any are still archived, refuse with missingRoles listing them.
 *   - D-03: Failure response shape — structured 409 `{ reason, missingRoles? }`
 *     for preconditions; 5xx with generic `error` text for disk failures.
 *   - D-04: Reconciler is authoritative on-tick; the precondition check is
 *     fast-path defense so the frontend surfaces a reason immediately.
 *   - Idempotent: sentinel already present → write succeeds via tmp+rename
 *     overwrite, and the wait picks up whatever the in-flight attempt yields.
 *
 * Route mirrors identity-archive.ts byte-for-byte through step 4 (auth →
 * hostId parse → key gate → resolveHostById → LOCAL/REMOTE branch), then
 * runs preconditions (5a/5b/5c), the sentinel drop (5d), and the outcome
 * wait (5e).
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
import { getHostSemaphore } from "../../ssh/host-semaphore-registry.js";
import {
  isLocalHostId,
  IDENTITY_KEY_RE,
  getLocalIdentitiesRoot,
  getLocalRolesRoot,
} from "../../claude-session/identity-artifact-reader.js";
import { writeIdentityArchiveFile } from "../../claude-session/per-identity-archive-file.js";
import { getLocalArchivedIdentitiesRoot } from "../../claude-session/list-archived-identity-keys.js";
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

/** Remote SSH work holds one per-host semaphore slot; local disk work needs none. */
function withHostSlot<T>(hostId: number, fn: () => Promise<T>): Promise<T> {
  return isLocalHostId(hostId) ? fn() : getHostSemaphore(hostId).run(fn);
}

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches sibling identity-archive.ts. */
const SSH_CONNECT_TIMEOUT_MS = 3000;

/** How long the button's request waits for the supervisor's outcome. */
export const UNARCHIVE_WAIT_MS = 2 * 60 * 1000;
/** Poll cadence while waiting. */
export const UNARCHIVE_POLL_MS = 3000;
/** Refusal note the supervisor leaves in the archived folder. */
export const UNARCHIVE_REFUSED_NOTE = ".unarchive-refused";
const NOTE_MAX_CHARS = 500;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type UnarchiveOutcome =
  | { state: "restored" }
  | { state: "refused"; note: string }
  | { state: "pending" };

function cleanNote(raw: string): string {
  const note = raw.trim().slice(0, NOTE_MAX_CHARS);
  return note || "the un-archive was refused without a reason";
}

/**
 * One look at where the un-archive stands. Restored = live folder present and
 * archive folder gone. Refused = archive folder still there, the flag gone and
 * a refusal note present (the supervisor writes the note, then clears the
 * flag). Flag gone without a note is the success path mid-move → pending.
 */
async function readUnarchiveOutcome(
  key: string,
  conn: Awaited<ReturnType<typeof connectOneShot>> | null,
): Promise<UnarchiveOutcome> {
  if (conn === null) {
    const exists = (p: string) => fs.access(p).then(() => true, () => false);
    const archDir = path.join(getLocalArchivedIdentitiesRoot(), key);
    const live = await exists(path.join(getLocalIdentitiesRoot(), key));
    const archived = await exists(archDir);
    if (live && !archived) return { state: "restored" };
    if (
      archived &&
      !(await exists(path.join(archDir, ".unarchive-requested"))) &&
      (await exists(path.join(archDir, UNARCHIVE_REFUSED_NOTE)))
    ) {
      const note = await fs
        .readFile(path.join(archDir, UNARCHIVE_REFUSED_NOTE), "utf8")
        .catch(() => "");
      return { state: "refused", note: cleanNote(note) };
    }
    return { state: "pending" };
  }
  // REMOTE — key is IDENTITY_KEY_RE-validated, so interpolation is safe.
  const out = await execCommand(
    conn,
    `a="$HOME/fleet/identities-archive/${key}"; l="$HOME/fleet/identities/${key}"; ` +
      `if [ -d "$l" ] && [ ! -d "$a" ]; then echo restored; ` +
      `elif [ -d "$a" ] && [ ! -e "$a/.unarchive-requested" ] && [ -e "$a/${UNARCHIVE_REFUSED_NOTE}" ]; then echo refused; head -c ${NOTE_MAX_CHARS} "$a/${UNARCHIVE_REFUSED_NOTE}" 2>/dev/null; ` +
      `else echo pending; fi`,
  ).catch(() => "pending");
  const [first, ...rest] = out.split("\n");
  if (first.trim() === "restored") return { state: "restored" };
  if (first.trim() === "refused") return { state: "refused", note: cleanNote(rest.join("\n")) };
  return { state: "pending" };
}

/**
 * Embedded Python that prints, as a JSON array on stdout, every role named in
 * the `roles:` frontmatter of the identity file given as argv[1].
 *
 * The parsing function is a VERBATIM COPY of parse_roles_frontmatter from the
 * canonical reference, substrate/scripts/tests/fixtures/roles_frontmatter_reference.py
 * (stdlib only, no PyYAML) — keep it byte-identical to that file. The
 * conformance test (substrate/scripts/tests/roles-frontmatter-conformance.test.sh)
 * extracts this constant from this TS file and runs it against
 * roles-frontmatter-cases.json, so it must stay a plain array-of-lines string
 * constant. Accepts scalar / quoted / flow / bare-comma / block-list shapes,
 * trailing comments, CRLF; the singular `role:` key is NOT read.
 *
 * Contract: `python3 -c EXTRACT_ROLES_PYTHON <path>` → stdout `["a", "b"]`
 * (no trailing newline), `[]` when nothing valid. Used LOCALLY via execFile and
 * REMOTELY over SSH (see parseRolesFrom{Local,Remote}IdentityMd below).
 *
 * Regular (non-template) strings avoid backtick collision with TS template
 * literals.
 */
const EXTRACT_ROLES_PYTHON = [
  "import sys, re, json",
  "",
  "# Copy of parse_roles_frontmatter from",
  "# substrate/scripts/tests/fixtures/roles_frontmatter_reference.py \u2014 keep in sync.",
  "ROLES_SLUG_RE = re.compile(r\"^[a-z0-9][a-z0-9_-]{0,63}$\")",
  "",
  "",
  "def parse_roles_frontmatter(text):",
  "    lines = text.lstrip(\"\\ufeff\").replace(\"\\r\\n\", \"\\n\").split(\"\\n\")",
  "    if not lines or lines[0].strip() != \"---\":",
  "        return []",
  "    end = None",
  "    for i in range(1, len(lines)):",
  "        if lines[i].strip() == \"---\":",
  "            end = i",
  "            break",
  "    if end is None:",
  "        return []",
  "",
  "    def clean(s):",
  "        s = re.sub(r\"\\s+#.*$\", \"\", s).strip()",
  "        return s.strip(\"\\\"'\").strip()",
  "",
  "    raw = []",
  "    for i in range(1, end):",
  "        m = re.match(r\"^roles:(.*)$\", lines[i])",
  "        if not m:",
  "            continue",
  "        inline = re.sub(r\"(^|\\s)#.*$\", \"\", m.group(1)).strip()",
  "        if inline in (\"~\", \"null\", \"Null\", \"NULL\"):",
  "            break  # YAML null: zero roles",
  "        if inline:",
  "            if inline.startswith(\"[\") and inline.endswith(\"]\"):",
  "                inline = inline[1:-1]",
  "            raw = [clean(p) for p in inline.split(\",\")]",
  "        else:",
  "            for j in range(i + 1, end):",
  "                s = lines[j].strip()",
  "                if not s or s.startswith(\"#\"):",
  "                    continue",
  "                m2 = re.match(r\"^-\\s*(.*)$\", s)",
  "                if not m2:",
  "                    break",
  "                raw.append(clean(m2.group(1)))",
  "        break",
  "",
  "    out = []",
  "    for r in raw:",
  "        if r and ROLES_SLUG_RE.match(r) and r not in out:",
  "            out.append(r)",
  "    return out",
  "",
  "",
  "with open(sys.argv[1], encoding=\"utf-8\", errors=\"replace\", newline=\"\") as f:",
  "    print(json.dumps(parse_roles_frontmatter(f.read())), end=\"\")",
].join("\n");

/**
 * Parse the `roles:` frontmatter from a LOCAL identity.md file using the Python
 * inline (D-02). Returns a list of role names ([] = a roleless identity), or
 * null when the file is missing or couldn't be read/parsed — "couldn't tell"
 * must never pass as "no roles", or the role check would be skipped.
 */
async function parseRolesFromLocalIdentityMd(
  identityMdPath: string,
): Promise<string[] | null> {
  try {
    await fs.access(identityMdPath);
  } catch {
    return null;
  }
  try {
    const { stdout } = await execFileAsync("python3", ["-c", EXTRACT_ROLES_PYTHON, identityMdPath]);
    const roles = JSON.parse(stdout.trim() || "[]") as string[];
    return Array.isArray(roles) ? roles : null;
  } catch {
    return null;
  }
}

/**
 * Parse the `roles:` frontmatter from a REMOTE identity.md file using the Python
 * inline over SSH (D-02). Returns a list of role names ([] = a roleless
 * identity), or null when the file is missing or couldn't be read/parsed.
 */
async function parseRolesFromRemoteIdentityMd(
  conn: Awaited<ReturnType<typeof connectOneShot>>,
  key: string,
): Promise<string[] | null> {
  const MISSING = "__SKYNET_IDENTITY_FILE_MISSING__";
  let fileContent: string;
  try {
    fileContent = await execCommand(
      conn,
      // Identity files are `<key>/<key>.md`; `identity.md` kept as a legacy
      // fallback. (Reading only identity.md made roles always [] → the
      // missing_roles precondition never fired and the supervisor refused
      // silently after a 200.) A missing file prints a marker rather than
      // nothing, so it can't be mistaken for a roleless identity.
      `d="$HOME/fleet/identities-archive/${key}"; if [ -f "$d/${key}.md" ]; then cat "$d/${key}.md"; elif [ -f "$d/identity.md" ]; then cat "$d/identity.md"; else printf '%s' '${MISSING}'; fi`,
    );
  } catch {
    return null;
  }

  if (fileContent.trim() === MISSING) {
    return null;
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
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // Clean up on error
    try {
      await execCommand(conn, `rm -f ${tmpPath}`);
    } catch {
      /* ignore */
    }
    return null;
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
    // Remote: SSH connect + work + end hold ONE per-host semaphore slot
    // (verify:ssh-cap). Local: no SSH channel, no slot.
    return withHostSlot(hostId, async () => {
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
        // Parse the archived identity's roles: frontmatter and check every listed
        // role has a live folder. Refuse with missingRoles listing if any are
        // still archived.
        let roles: string[] | null;
        if (conn === null) {
          // LOCAL branch
          // `<key>/<key>.md` is the identity file; identity.md is a legacy
          // fallback (see the remote branch).
          const archivedDir = path.join(getLocalArchivedIdentitiesRoot(), key);
          const primary = path.join(archivedDir, `${key}.md`);
          const primaryExists = await fs.access(primary).then(() => true, () => false);
          roles = await parseRolesFromLocalIdentityMd(
            primaryExists ? primary : path.join(archivedDir, "identity.md"),
          );
        } else {
          // REMOTE branch
          roles = await parseRolesFromRemoteIdentityMd(conn, key);
        }

        if (roles === null) {
          // Missing or unreadable identity file. Refuse BEFORE dropping
          // the flag — treating it as roleless would skip the role check and
          // leave a half-restored identity the supervisor then refuses.
          databaseLogger.warn("identity-unarchive: identity file unreadable, refusing", {
            operation: "identity_unarchive_identity_unreadable",
            identityKey: key,
            hostId,
          });
          return res.status(409).json({ reason: "identity_unreadable" });
        }

        if (roles.length === 0) {
          // Roleless identities restore normally — there are just no role
          // folders to check.
          databaseLogger.info("identity-unarchive: roleless identity, no role check", {
            operation: "identity_unarchive_roleless",
            identityKey: key,
            hostId,
          });
        }

        {
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

        // 5d. Drop the flag. The supervisor owns everything after this point
        // (chat-account reactivation via the identity-reactivate agent service,
        // login, folder move); the route waits for the outcome the same way
        // identity birth waits for the supervisor.
        await writeIdentityArchiveFile(key, ".unarchive-requested", "", {
          hostId,
          conn,
        });

        // Audit log per T-143-04-07 (repudiation): who requested un-archive on what.
        databaseLogger.info(
          `identity unarchive requested: userId=${userId}, hostId=${hostId}, key=${key}`,
        );

        // 5e. Wait for the supervisor's outcome: restored (folder back in the
        // live tree), refused (flag cleared, folder still archived, refusal
        // note says why), or still pending after UNARCHIVE_WAIT_MS.
        let clientGone = false;
        // `req` "close" doesn't fire once express.json() has consumed the
        // body; the response's "close" does (before we've finished = client left).
        res.on("close", () => {
          if (!res.writableFinished) clientGone = true;
        });
        const waitStart = Date.now();
        while (!clientGone && Date.now() - waitStart < UNARCHIVE_WAIT_MS) {
          await sleep(UNARCHIVE_POLL_MS);
          const outcome = await readUnarchiveOutcome(key, conn);
          if (outcome.state === "restored") {
            databaseLogger.info("identity unarchive: restored", {
              operation: "identity_unarchive_restored",
              identityKey: key,
              hostId,
              elapsedMs: Date.now() - waitStart,
            });
            return res.json({ ok: true, outcome: "restored" });
          }
          if (outcome.state === "refused") {
            databaseLogger.warn("identity unarchive: refused by supervisor", {
              operation: "identity_unarchive_refused",
              identityKey: key,
              hostId,
              note: outcome.note,
              elapsedMs: Date.now() - waitStart,
            });
            return res.status(409).json({ reason: "refused", message: outcome.note });
          }
        }
        if (clientGone) {
          databaseLogger.info("identity unarchive: client left during wait", {
            operation: "identity_unarchive_client_gone",
            identityKey: key,
            hostId,
            elapsedMs: Date.now() - waitStart,
          });
          return;
        }
        databaseLogger.warn("identity unarchive: still pending after wait", {
          operation: "identity_unarchive_wait_timeout",
          identityKey: key,
          hostId,
          timeoutMs: UNARCHIVE_WAIT_MS,
        });
        return res.json({ ok: true, outcome: "pending" });
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
    });
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
