/**
 * Phase 22 (SRIC-03): POST /identities/clone — clone an existing fleet
 * identity into a new identity on the SAME host, preserving role/host/color
 * (LOCKED) and letting the user edit only name/title/voice/avatar.
 *
 * Endpoint contract:
 *   POST /identities/clone
 *     Content-Type: application/json (NOT multipart — sidesteps Phase 20
 *       patch #77 silent-no-op trap per RESEARCH Pitfall 2; 415 gate below)
 *     Body: {
 *       sourceIdentityKey: string,   // must pass IDENTITY_KEY_RE
 *       hostId: number,              // positive integer, resolveHostById gate
 *       newName: string,             // must pass IDENTITY_KEY_RE
 *       title: string,               // required non-empty (≤200 chars)
 *       voice: string | null,        // optional (≤100 chars)
 *       colorHue: number | null,     // integer 0-359 (frontend passes source's;
 *                                    // LOCKED in UI — no picker on clone dialog)
 *       avatarCandidateId: string | null,  // if provided, candidate bytes are
 *                                          // written as sibling avatar file
 *       path: string,                // remote working directory for sessions
 *     }
 *   Responses:
 *     201 { publicIdentity(newRow) } — created
 *     400 — validation failure (with distinct error strings)
 *     401 — missing/invalid JWT
 *     404 — hostId not owned OR source identity not found in Skynet DB
 *     409 — newName collides with existing folder on target host
 *     415 — Content-Type not application/json
 *     500 — source has no role frontmatter (mirrors resolveRoleForIdentity
 *           throw) OR unexpected error (sanitized)
 *     502 — SSH connect failure
 *
 * Sequence:
 *   1. Validate JSON body (IDENTITY_KEY_RE, hostId, title, voice, avatarCandidateId).
 *   2. Content-Type gate: 415 if not application/json (defense-in-depth on top
 *      of express.json() body-parser only decoding JSON bodies).
 *   3. Fetch source row from Skynet DB via (userId, sourceIdentityKey) — 404 on
 *      not-found (cross-user isolation via userId filter).
 *   4. Fetch avatar bytes: from candidate cache if avatarCandidateId provided
 *      (400 if expired), else reuse source.avatarData.
 *   5. resolveHostById(hostId, userId) — 404 on cross-user / unknown.
 *   6. SSH connect (5s timeout) — 502 on failure.
 *   7. resolveRoleForIdentity(conn, sourceIdentityKey) — THROWS on missing
 *      frontmatter (500 with "source has no role frontmatter"). NO fallback
 *      branch per Pitfall 8 + D-CONTEXT LOCKED "no such identities exist".
 *   8. Collision probe: `if [ -d "$HOME/.claude/identities/<newName>" ]` —
 *      409 if "exists".
 *   9. Provision new fleet folder (mirrors 22-02 Step 2.5 shape MINUS the
 *      SSH relay-register block per REVISION 2026-08-04):
 *      - `mkdir -p ~/.claude/identities/<newName>/wakeups`
 *      - `touch ~/.claude/identities/<newName>/handoff.md`
 *      - `echo $HOME` for absolute path resolution
 *      - writeMarkdownFileAtomic with `role: <sourceRole>` frontmatter +
 *        SEED COMMENT (wake-up agent registers own relay account on first
 *        wake per the seed's plain-English instruction).
 *   10. DB insert (mirrors identity-birth.ts:73-90) with new nanoid id,
 *       identityKey=newName, colorHue=sourceRow.colorHue (LOCKED, user
 *       CANNOT override), title/voice=user-edited (fallback to source),
 *       avatarData=avatarBytes, fresh md5 etag, now timestamps.
 *   11. Re-select new row for response shape.
 *   12. consumeCandidateForBirth if avatarCandidateId was provided.
 *   13. 201 with publicIdentity(newRow) response.
 *   14. Finally: try conn.end() catch {} — best-effort cleanup on every exit.
 *
 * REVISION 2026-08-04 (Ashley at 22-02 checkpoint, applied here per same-
 * pattern extension): Skynet does NOT invoke the relay-register block via
 * SSH from this endpoint. Same refinement as 22-02 Task 3 (revised): the
 * new identity file gets a SEED COMMENT instructing the wake-up agent to
 * register a Matrix relay account on first wake. Rationale: fewer moving
 * parts in Skynet, cleaner boundary (Skynet does file setup, agent does
 * identity setup), same end-state. See CLONE_SEED_COMMENT constant below.
 *
 * Security posture (STRIDE T-22-03-* in the plan's threat model):
 *   T-22-03-01: Shell injection via newName — MITIGATE via IDENTITY_KEY_RE
 *     gate blocking quotes/backticks/semicolons/spaces.
 *   T-22-03-02: Shell injection via role in frontmatter — MITIGATE via
 *     resolveRoleForIdentity's inner IDENTITY_KEY_RE gate (Plan 22-01).
 *   T-22-03-03: Cross-user clone via spoofed hostId/sourceIdentityKey —
 *     MITIGATE via resolveHostById(hostId, userId) 404 gate + DB filter
 *     on userId.
 *   T-22-03-04: Multipart silent no-op — MITIGATE via 415 content-type gate.
 *   T-22-03-05: SFTP EEXIST trap — MITIGATE via writeMarkdownFileAtomic
 *     (ext_openssh_rename per Pitfall 3).
 *   T-22-03-06: Info disclosure via SSH stderr — MITIGATE via sanitized
 *     500 responses (never leak upstream detail in response body).
 *   T-22-03-08: LOCKED-field bypass — MITIGATE by pulling colorHue from
 *     sourceRow (NOT req.body); role from resolveRoleForIdentity (NOT
 *     req.body); host from resolveHostById (NOT req.body override).
 *
 * Mount point: app.use("/identities/clone", identityCloneRoutes) — MUST be
 * mounted BEFORE app.use("/identities", identitiesRoutes) so the exact path
 * wins over the generic identities router (see database.ts adjacent to the
 * /identities/birth and /identities/exists-on-host mounts).
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import { identities } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger, sshLogger } from "../../utils/logger.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import {
  writeMarkdownFileAtomic,
  writeAvatarSiblingFile,
  resolveRoleForIdentity,
  MIME_TO_AVATAR_EXT,
  IDENTITY_KEY_RE,
  type AvatarExt,
} from "../../claude-session/identity-artifact-reader.js";
import yaml from "js-yaml";
import { resolveHostById } from "../../ssh/host-resolver.js";
import {
  getCandidateForBirth,
  consumeCandidateForBirth,
} from "./identity-avatar-batch.js";
import { startHarnessOnIdentity } from "./identity-harness-start.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches other one-shot SSH endpoints. */
const SSH_CONNECT_TIMEOUT_MS = 5000;

/** SSH exec race timeout — bounded so a hung remote can't stall the route. */
const SSH_EXEC_TIMEOUT_MS = 5000;

/** Field length caps. */
const MAX_TITLE_LEN = 200;
const MAX_VOICE_LEN = 100;
/** Working-directory path cap. Typical PATH_MAX is 4096; keep generous. */
const MAX_PATH_LEN = 4096;

/** tmux new-session terminal sizing (mirrors identity-birth-orchestrator's
 *  TMUX_NEW_SESSION_FLAGS — Nelly §3 terminal-sizing gotcha). */
const TMUX_NEW_SESSION_FLAGS = "-x 220 -y 50";

/** POSIX single-quote escape. Wraps s in '...' and escapes embedded ' as '\''.
 *  Mirrors identity-birth-orchestrator's shellSingleQuote — same trap class
 *  (user string interpolated into a remote shell) needs the same discipline. */
function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Shell-safe path helper: leave "$HOME" or "$HOME/..." UNQUOTED so the remote
 *  shell expands the var, single-quote everything else. Mirrors birth's shellPath.
 *  Caller must normalize "~" / "~/foo" to "$HOME" / "$HOME/foo" first. */
function shellPath(p: string): string {
  if (p === "$HOME" || p.startsWith("$HOME/")) return p;
  return shellSingleQuote(p);
}

/** Normalize a user-supplied path for remote shell use. Mirrors the same
 *  helper in identity-birth-orchestrator.ts step 0b (patch #318): "~" / "~/"
 *  → "$HOME"; "~/foo" → "$HOME/foo"; everything else passes through unchanged.
 *  Without this, single-quoted "~/foo" hits the remote shell literally and
 *  tilde does NOT expand — mkdir would create a directory called "~". */
function normalizeRemotePath(p: string): string {
  let n = p.replace(/\\/g, "/");
  if (n === "" || n === "~" || n === "~/") return "$HOME";
  if (n.startsWith("~/")) return "$HOME/" + n.slice(2);
  return n;
}

/**
 * REVISION 2026-08-04 (Ashley at 22-02 checkpoint, applied here per same-
 * pattern extension). Seed comment embedded in the new identity file
 * telling the wake-up agent to register a Matrix relay account for this
 * identity on first wake.
 *
 * Style constraints (verbatim from Ashley — enforced by test 8 assertions):
 *   - Do NOT say "Skynet" (agents don't know what that is)
 *   - Do NOT reference §2 / §3 / "id skill" / SKILL.md (fragile skill refs)
 *   - Plain-terms instructions to the wake-up agent
 *   - Ends with "remove this comment" so the agent knows to clear it
 *   - MUST contain: "This identity has no relay account yet", "On first wake",
 *     "register a Matrix relay account", "remove this comment"
 */
const CLONE_SEED_COMMENT =
  "<!-- This identity has no relay account yet. On first wake, please register a Matrix relay account for this identity and remove this comment. -->";

/**
 * Public identity DTO — mirrors identities.ts publicIdentity(). Phase 66
 * Plan 04: cosmetic columns (displayName / title / colorHue / voice /
 * avatarMime / avatarEtag) no longer live in the store row. This constructor
 * PRESERVES the Plan 03 safe-defaults contract (co-located with the READ
 * flip per checker B2) so the frontend Identity type's non-nullable-string
 * contract is honored without a type widening:
 *   - displayName = capitalizeFirst(identityKey)   (non-nullable string)
 *   - avatarMime  = ""                              (non-nullable string)
 *   - avatarEtag  = ""                              (non-nullable string)
 *   - title/colorHue/voice = null                  (nullable in Identity type)
 *
 * capitalizeFirst mirrors the identities.ts helper exactly (see comment
 * there). It is duplicated locally rather than imported to avoid a circular
 * import between identities.ts and identity-clone.ts (both are mounted
 * routers in database.ts and importing each other's helpers would cause
 * bundler-time cycles that vitest's mock resolver can trip on).
 */
function capitalizeFirst(s: string): string {
  if (!s || s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function publicIdentity(row: typeof identities.$inferSelect) {
  return {
    id: row.id,
    identityKey: row.identityKey,
    displayName: capitalizeFirst(row.identityKey),
    title: null as string | null,
    colorHue: null as number | null,
    voice: null as string | null,
    avatarMime: "",
    avatarUrl: `/identities/${row.id}/avatar`,
    avatarEtag: "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Race an exec against a timeout so a hung remote can't stall the route.
 * Mirrors roles-create.ts execWithTimeout / identity-artifact-reader.
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
 * Body: { sourceIdentityKey, hostId, newName, title, voice, avatarCandidateId }
 * Provisions ~/.claude/identities/<newName>/ + wakeups/ + handoff.md +
 * <newName>.md (with role: frontmatter and wake-up seed comment) and inserts
 * a new Skynet DB row that mirrors the source's colorHue.
 */
router.post(
  "/",
  // Content-Type gate: reject non-JSON with 415 BEFORE body parsing so
  // multipart requests don't slip through as an empty req.body.
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.is("application/json")) {
      res.status(415).json({ error: "clone requires application/json body" });
      return;
    }
    next();
  },
  express.json({ limit: "64kb" }),
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;
    // Patch #316: getCandidateForBirth / consumeCandidateForBirth now expect
    // a string (users.id = text() in schema); parseInt→NaN pattern removed.

    // -----------------------------------------------------------------------
    // 1. Body validation
    // -----------------------------------------------------------------------
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawSource = body.sourceIdentityKey;
    const rawNewName = body.newName;
    const rawHostId = body.hostId;
    const rawTitle = body.title;
    const rawVoice = body.voice;
    const rawColorHue = body.colorHue;
    const rawCandidateId = body.avatarCandidateId;
    const rawPath = body.path;

    if (typeof rawSource !== "string" || rawSource.length === 0) {
      res.status(400).json({ error: "sourceIdentityKey is required" });
      return;
    }
    if (!IDENTITY_KEY_RE.test(rawSource)) {
      res.status(400).json({
        error: "sourceIdentityKey must match [a-z0-9_-]{1,64}",
      });
      return;
    }
    if (typeof rawNewName !== "string" || rawNewName.length === 0) {
      res.status(400).json({ error: "newName is required" });
      return;
    }
    if (!IDENTITY_KEY_RE.test(rawNewName)) {
      res.status(400).json({
        error: "newName must match [a-z0-9_-]{1,64}",
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
    if (typeof rawTitle !== "string" || rawTitle.trim().length === 0) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    if (rawTitle.length > MAX_TITLE_LEN) {
      res.status(400).json({ error: `title must be ≤${MAX_TITLE_LEN} chars` });
      return;
    }
    if (rawVoice !== null && rawVoice !== undefined && typeof rawVoice !== "string") {
      res.status(400).json({ error: "voice must be a string or null" });
      return;
    }
    if (typeof rawVoice === "string" && rawVoice.length > MAX_VOICE_LEN) {
      res.status(400).json({ error: `voice must be ≤${MAX_VOICE_LEN} chars` });
      return;
    }
    // colorHue: optional. Frontend passes source identity's colorHue (LOCKED
    // in the UI — no picker on the clone dialog) so the cloned identity
    // inherits the color of the identity it was cloned from. Backend validates
    // the shape only (integer 0-359 or null/absent) — no server-side check
    // against source's on-disk colorHue since sourceRow.colorHue was retired
    // when Phase 66 Plan 04 dropped the store columns.
    if (
      rawColorHue !== null &&
      rawColorHue !== undefined &&
      (typeof rawColorHue !== "number" ||
        !Number.isInteger(rawColorHue) ||
        rawColorHue < 0 ||
        rawColorHue > 359)
    ) {
      res.status(400).json({ error: "colorHue must be an integer 0-359 or null" });
      return;
    }
    if (
      rawCandidateId !== null &&
      rawCandidateId !== undefined &&
      typeof rawCandidateId !== "string"
    ) {
      res.status(400).json({ error: "avatarCandidateId must be a string or null" });
      return;
    }
    if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
      res.status(400).json({ error: "path is required" });
      return;
    }
    if (rawPath.length > MAX_PATH_LEN) {
      res.status(400).json({ error: `path must be ≤${MAX_PATH_LEN} chars` });
      return;
    }

    const sourceIdentityKey = rawSource;
    const newName = rawNewName;
    const hostId = rawHostId;
    const title = rawTitle.trim();
    const voice: string | null = typeof rawVoice === "string" ? rawVoice : null;
    const colorHue: number | null = typeof rawColorHue === "number" ? rawColorHue : null;
    const avatarCandidateId: string | null =
      typeof rawCandidateId === "string" && rawCandidateId.length > 0
        ? rawCandidateId
        : null;
    const path = rawPath.trim();

    // -----------------------------------------------------------------------
    // 2. Fetch source row from Skynet DB (userId filter for cross-user gate)
    // -----------------------------------------------------------------------
    const sourceRows = db
      .select()
      .from(identities)
      .where(
        and(
          eq(identities.userId, userId),
          eq(identities.identityKey, sourceIdentityKey),
        ),
      )
      .all();
    if (sourceRows.length === 0) {
      res.status(404).json({ error: "source not found" });
      return;
    }
    const sourceRow = sourceRows[0];

    // -----------------------------------------------------------------------
    // 2b. Precheck: DB (userId, newName) uniqueness. Prevents the halfway-
    //     through state where SFTP creates the identity folder on the target
    //     but the DB insert then trips the (user_id, identity_key) UNIQUE
    //     constraint — surfaced as a generic 500 the frontend renders as
    //     "server error occurred please try again later." The FE already maps
    //     409 → IdentityCloneCollisionError → inline "name already exists"
    //     modal error, so returning 409 here gives the user an actionable
    //     message and short-circuits before any SSH work.
    // -----------------------------------------------------------------------
    const existingRows = db
      .select()
      .from(identities)
      .where(
        and(
          eq(identities.userId, userId),
          eq(identities.identityKey, newName),
        ),
      )
      .all();
    if (existingRows.length > 0) {
      res.status(409).json({ error: "identity name already in use" });
      return;
    }

    // -----------------------------------------------------------------------
    // 3. Fetch avatar bytes (candidate cache only — Phase 66 Plan 04 dropped
    //    sourceRow.avatarData). If the user supplies avatarCandidateId, the
    //    candidate bytes + mime are written to the cloned identity's home
    //    folder as a sibling avatar file in step 10a below (matches the birth
    //    flow's Step 2.5). If the user does NOT supply a candidate, the cloned
    //    identity ships without an avatar sibling (renders with placeholder
    //    initial — same fallback as any identity whose on-disk avatar is
    //    absent). Inheriting the source's on-disk avatar bytes when the user
    //    doesn't override is orthogonal follow-up work.
    // -----------------------------------------------------------------------
    let avatarBytes: Buffer | null = null;
    let avatarMime: string | null = null;
    if (avatarCandidateId) {
      const cand = getCandidateForBirth(userId, avatarCandidateId);
      if (!cand) {
        res.status(400).json({ error: "avatar candidate expired" });
        return;
      }
      avatarBytes = cand.bytes;
      avatarMime = cand.mime;
    }

    // -----------------------------------------------------------------------
    // 4. Resolve host (cross-user isolation gate)
    // -----------------------------------------------------------------------
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    // -----------------------------------------------------------------------
    // 5. SSH connect (5s timeout) — 502 on failure
    // -----------------------------------------------------------------------
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("identity-clone: SSH connect failed", {
          operation: "identity_clone_connect",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      // ---------------------------------------------------------------------
      // 6. Resolve source's role via the two-step (throws when identity file
      //    lacks role: frontmatter — no fallback per Pitfall 8 / D-CONTEXT
      //    LOCKED "no such identities exist post-migration").
      // ---------------------------------------------------------------------
      let sourceRole: string;
      try {
        sourceRole = await resolveRoleForIdentity(conn, sourceIdentityKey);
      } catch (err) {
        databaseLogger.error(
          "identity-clone: source has no role frontmatter",
          err,
          {
            operation: "identity_clone_role_resolve",
            userId,
            sourceIdentityKey,
          },
        );
        res.status(500).json({ error: "source has no role frontmatter" });
        return;
      }

      // ---------------------------------------------------------------------
      // 7. Collision probe: 409 if new identity folder already exists.
      //    newName is pre-validated by IDENTITY_KEY_RE so interpolation into
      //    the double-quoted path is shell-safe (matches identity-exists-on-
      //    host.ts:118-122 "validate-then-interpolate" pattern).
      // ---------------------------------------------------------------------
      let existsStdout: string;
      try {
        existsStdout = await execWithTimeout(
          conn,
          `if [ -d "$HOME/.claude/identities/${newName}" ]; then echo exists; else echo missing; fi`,
        );
      } catch (err) {
        sshLogger.warn("identity-clone: existence probe failed", {
          operation: "identity_clone_exists_probe",
          hostId,
          newName,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }
      if (existsStdout.trim() === "exists") {
        res.status(409).json({ error: "identity exists on host" });
        return;
      }

      // ---------------------------------------------------------------------
      // 8. Provision new fleet folder — mirrors 22-02 Step 2.5 pattern MINUS
      //    the SSH relay-register block per REVISION 2026-08-04.
      //    - mkdir -p new-identity-dir + wakeups (single exec, idempotent)
      //    - touch handoff.md
      //    - mkdir -p <working-dir> for the identity's sessions. Idempotent;
      //      supports "~", "~/foo", absolute paths — normalizeRemotePath()
      //      rewrites tilde to $HOME so the remote shell expands it (single-
      //      quoted "~/foo" doesn't expand — same trap birth caught in
      //      patch #318). shellPath() leaves "$HOME..." unquoted, single-
      //      quotes everything else for injection safety.
      // ---------------------------------------------------------------------
      try {
        await execWithTimeout(
          conn,
          `mkdir -p "$HOME/.claude/identities/${newName}/wakeups"`,
        );
        await execWithTimeout(
          conn,
          `touch "$HOME/.claude/identities/${newName}/handoff.md"`,
        );
        const escWorkingPath = shellPath(normalizeRemotePath(path));
        // mkdir + tmux new-session in one exec (mirrors identity-birth-
        // orchestrator step 2's shape). tmux has-session gate makes the
        // create idempotent — a re-clone with the same name after prior
        // cleanup is safe; a live conflicting session prevents accidental
        // clobber. newName is already gated by IDENTITY_KEY_RE so it's
        // shell-safe to interpolate into `-s <name>`. Without this step
        // the tmux session that starts when the user clicks the new row
        // in the sidebar lands in $HOME (Skynet's default cwd for a fresh
        // tmux) instead of the path — exactly the "clone lands in poppy's
        // cwd" problem this patch was meant to fix.
        await execWithTimeout(
          conn,
          `mkdir -p ${escWorkingPath} && (tmux has-session -t ${newName} 2>/dev/null || tmux new-session -d -s ${newName} -c ${escWorkingPath} ${TMUX_NEW_SESSION_FLAGS})`,
        );

        // quick-260806-dwe: launch the Claude harness on the freshly-created
        // tmux session so cloneIdentity does not return 201 until the Claude
        // REPL is live AND /id <newName> has been sent. Without this, patch
        // #321's auto-route callback (CloneAgentDialog.onCreateSession) fires
        // on a bare login shell and pretty-view renders "no active Claude
        // session" for the newly-cloned identity's tab. Same helper birth
        // uses for its own steps 3-5. Latency added: ~25s (2s post-launch
        // sleep + 6 × 3s Enter-train gaps + exec RTT overhead). If the helper
        // rejects (e.g. SSH exec failure mid-Enter-train), the outer catch
        // below returns 502 "SSH exec failed" — same class as an mkdir
        // failure, so no new error-shape surface for the frontend.
        await startHarnessOnIdentity({
          exec: (cmd) => execWithTimeout(conn!, cmd),
          name: newName,
          remotePath: escWorkingPath,
        });
      } catch (err) {
        sshLogger.warn("identity-clone: provision exec failed", {
          operation: "identity_clone_provision",
          hostId,
          newName,
          path,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      // ---------------------------------------------------------------------
      // 9. Resolve remote $HOME for absolute path to SFTP write.
      // ---------------------------------------------------------------------
      let remoteHome: string;
      try {
        remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
        if (!remoteHome) {
          throw new Error("could not resolve remote $HOME");
        }
      } catch (err) {
        sshLogger.warn("identity-clone: $HOME resolution failed", {
          operation: "identity_clone_home",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      // ---------------------------------------------------------------------
      // 10. Build new identity file body (frontmatter + seed comment) and
      //     write atomically via SFTP tmp+rename (Pitfall 3 discipline).
      //     Body shape (REVISION 2026-08-04):
      //       ---
      //       role: <sourceRole>
      //       ---
      //
      //       <SEED COMMENT>
      //
      //       # <newName>
      //
      //       (cloned from <sourceIdentityKey>)
      // ---------------------------------------------------------------------
      // Phase 66 /close 2026-09-01 follow-up: grow the frontmatter to include
      // the full cosmetic scalars (displayName, title, colorHue, voice, avatar
      // filename when candidate bytes are provided). Mirrors the birth flow's
      // Step 2.5 emission via buildIdentityFileBody in identity-birth-
      // orchestrator.ts. Absent-⇒-omit rule: any scalar that is null, absent,
      // or empty-after-trim is omitted from the frontmatter (do NOT write null).
      const cloneDisplayName =
        newName.charAt(0).toUpperCase() + newName.slice(1);
      let avatarExt: AvatarExt | null = null;
      if (avatarBytes && avatarMime) {
        const looked = MIME_TO_AVATAR_EXT[avatarMime];
        if (!looked) {
          res
            .status(400)
            .json({ error: `unsupported avatar mime: ${avatarMime}` });
          return;
        }
        avatarExt = looked;
      }
      const cloneFrontmatterPairs: Array<[string, string | number]> = [];
      cloneFrontmatterPairs.push(["role", sourceRole]);
      cloneFrontmatterPairs.push(["displayName", cloneDisplayName]);
      if (title.length > 0) {
        cloneFrontmatterPairs.push(["title", title]);
      }
      if (colorHue !== null) {
        cloneFrontmatterPairs.push(["colorHue", colorHue]);
      }
      if (voice !== null && voice.trim().length > 0) {
        cloneFrontmatterPairs.push(["voice", voice]);
      }
      if (avatarExt !== null) {
        cloneFrontmatterPairs.push(["avatar", `${newName}.${avatarExt}`]);
      }
      const cloneYamlBody = yaml.dump(
        Object.fromEntries(cloneFrontmatterPairs),
        {
          sortKeys: false,
          lineWidth: -1,
          noRefs: true,
          forceQuotes: false,
        },
      );
      const identityFileMarkdown =
        `---\n${cloneYamlBody}---\n\n${CLONE_SEED_COMMENT}\n\n# ${newName}\n\n(cloned from ${sourceIdentityKey})\n`;
      const targetPath = `${remoteHome}/.claude/identities/${newName}/${newName}.md`;
      try {
        await writeMarkdownFileAtomic(conn, targetPath, identityFileMarkdown);
      } catch (err) {
        sshLogger.error(
          "identity-clone: SFTP write failed",
          err instanceof Error ? err : new Error(String(err)),
          {
            operation: "identity_clone_sftp_write",
            hostId,
            newName,
            targetPath,
          },
        );
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      // -------------------------------------------------------------------
      // 10a. Write the sibling avatar file if candidate bytes provided.
      //      Same SSH connection + same SFTP tmp+rename discipline as the
      //      markdown write. On failure, we've already written the .md — the
      //      clone folder is partially populated. That's the same failure
      //      mode as birth Step 2.5 (accepted). The identity renders with a
      //      placeholder until either the operator retries clone or a
      //      subsequent PUT /:id/avatar lands on disk.
      // -------------------------------------------------------------------
      if (avatarBytes && avatarExt !== null) {
        try {
          await writeAvatarSiblingFile(conn, newName, avatarExt, avatarBytes);
        } catch (err) {
          sshLogger.error(
            "identity-clone: avatar sibling write failed",
            err instanceof Error ? err : new Error(String(err)),
            {
              operation: "identity_clone_avatar_write",
              hostId,
              newName,
              avatarExt,
            },
          );
          res.status(502).json({ error: "SSH exec failed" });
          return;
        }
      }

      // ---------------------------------------------------------------------
      // 11. Insert new Skynet DB row.
      //     LOCKED fields (from D-CONTEXT §UX):
      //       - colorHue: sourceRow.colorHue (NOT req.body — LOCKED)
      //       - identityKey: newName
      //       - displayName: newName
      //     Editable fields:
      //       - title: user-edited (fallback to source's title if source has
      //         one; but title is required in the body so this fallback is
      //         belt-and-suspenders — user always provides one).
      //       - voice: user-edited (null OK; fallback to source's voice when
      //         null so cloned identity doesn't lose the voice preference).
      // ---------------------------------------------------------------------
      const newId = nanoid();
      const now = new Date().toISOString();
      // Phase 66 Plan 04: cosmetic columns physically dropped from identities.
      // The clone insertRow holds only the 5 surviving columns. The cloned
      // identity's cosmetics live on disk in the frontmatter emitted at step
      // 10 above (displayName/title/colorHue/voice/avatar), and the avatar
      // sibling file written at step 10a. This matches the birth flow's
      // Step 2.5 shape end-to-end (Phase 66 /close 2026-09-01 follow-up).
      const insertRow = {
        id: newId,
        userId,
        identityKey: newName,
        createdAt: now,
        updatedAt: now,
      };

      try {
        db.insert(identities).values(insertRow).run();
      } catch (err) {
        // Race backstop for the step-2b precheck: two concurrent clones with
        // the same newName can both pass the precheck and reach the insert.
        // better-sqlite3 tags UNIQUE-index violations with
        // .code === "SQLITE_CONSTRAINT_UNIQUE"; surface as 409 so the FE
        // inline-error path fires instead of the misleading generic 500.
        const code = (err as { code?: string } | undefined)?.code;
        if (code === "SQLITE_CONSTRAINT_UNIQUE") {
          databaseLogger.warn(
            "identity-clone: DB insert collided after precheck (race)",
            {
              operation: "identity_clone_db_insert_collision",
              userId,
              newName,
            },
          );
          res.status(409).json({ error: "identity name already in use" });
          return;
        }
        databaseLogger.error("identity-clone: DB insert failed", err, {
          operation: "identity_clone_db_insert",
          userId,
          newName,
        });
        res.status(500).json({ error: "internal" });
        return;
      }
      // In-memory-SQLite persistence discipline (CLAUDE.md rule + code review
      // HIGH #3, 2026-09-01) — direct .run() writes only reach RAM; force-save
      // to disk. Failure to save doesn't fail the request (row exists in RAM,
      // user's response is honest) but logs a warning for follow-up.
      try {
        await DatabaseSaveTrigger.forceSave("identity_cloned");
      } catch (saveErr) {
        databaseLogger.warn("Force-save after identity clone failed", {
          operation: "identity_clone_save_failed",
          userId,
          newName,
          error: saveErr instanceof Error ? saveErr.message : "Unknown",
        });
      }

      // ---------------------------------------------------------------------
      // 12. Re-select the new row for the response shape.
      // ---------------------------------------------------------------------
      const newRows = db
        .select()
        .from(identities)
        .where(eq(identities.id, newId))
        .all();
      if (newRows.length === 0) {
        databaseLogger.error(
          "identity-clone: clone row missing after insert",
          new Error("re-select empty"),
          {
            operation: "identity_clone_reselect",
            newId,
            userId,
          },
        );
        res.status(500).json({ error: "internal" });
        return;
      }
      const newRow = newRows[0];

      // ---------------------------------------------------------------------
      // 13. Consume the avatar candidate (idempotent — safe to call twice).
      // ---------------------------------------------------------------------
      if (avatarCandidateId) {
        try {
          consumeCandidateForBirth(userId, avatarCandidateId);
        } catch {
          // Best-effort — cache eviction failure doesn't affect the clone
        }
      }

      // ---------------------------------------------------------------------
      // 14. Response 201.
      // ---------------------------------------------------------------------
      res.status(201).json(publicIdentity(newRow));
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

// Generic 500 fallback error handler (mirrors identities.ts:316-333).
// Sanitizes upstream detail per RESEARCH V7 (never leak stderr/tailnet paths
// in the response body).
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    databaseLogger.error("identity-clone: unhandled error", err, {
      operation: "identity_clone_error",
    });
    return res.status(500).json({ error: "internal" });
  },
);

export default router;
