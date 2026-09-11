/**
 * Phase 20 (IDUI-06/08/09): POST /identities/birth — SSE birth orchestrator route.
 *
 * Thin SSE glue around the pure birthIdentity() orchestrator. Responsibilities:
 *   - JWT auth + body validation (400 on missing/invalid fields)
 *   - SSE header flushing (Content-Type: text/event-stream, no-cache, etc.)
 *   - Assembling the real deps object and invoking birthIdentity()
 *   - Framing each BirthEvent as `event: birth\ndata: {...}\n\n`
 *   - Closing the connection after the orchestrator finishes
 *
 * Mount point: app.use("/identities/birth", identityBirthRoutes)
 * Must be mounted BEFORE the general /identities mount (more-specific path wins).
 */

import express from "express";
import type { Request, Response } from "express";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fsp from "node:fs/promises";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
// Phase 106 (D-05/D-06): the wait-for-supervisor sensor wired into the
// birthIdentity orchestrator's `BirthDeps.discoverIdentitySessionFile`.
// Same helper fleet-status and sessions.ts already trust for "this is a
// live agent session, not a bare shell." Do NOT wire a parallel sensor.
import { discoverIdentitySessionFile } from "../../claude-session/discover-identity-session-file.js";
import {
  isLocalHostId,
  writeMarkdownFileAtomic,
  writeAvatarSiblingFile,
} from "../../claude-session/identity-artifact-reader.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
// Phase 98 Plan 07: whitelist voice-value validation on identity birth. Same
// contract as identities.ts's PUT handler — any voice value that isn't one of
// the 7 supported Polly voice IDs is 400-rejected. Null/absent are legal
// (identity is born voiceless; owner picks in the identity modal later).
import { isValidPollyVoice } from "../../voice/polly-voice-catalog.js";
import {
  birthIdentity,
  runRelayMintAndWrite,
  ROLE_NAME_PATTERN,
  ROLE_NAME_RE,
  SSH_CONNECT_TIMEOUT_MS,
  sanitizeError,
  type BirthEvent,
  type BirthDeps,
} from "./identity-birth-orchestrator.js";
import {
  getCandidateForBirth,
  consumeCandidateForBirth,
} from "./identity-avatar-batch.js";
// Phase 75 Plan 04 — Matrix admin client (Plan 02) + creds store (Plan 01).
// Phase 80 Plan 80-03b — countUsersMatching (Plan 02) for Step 6 MXID ordinal
// derivation when opts.poolPicked === true.
import {
  createOrUpdateUser as matrixCreateOrUpdateUser,
  loginAsUser as matrixLoginAsUser,
  buildRelayJsonBody,
  countUsersMatching as matrixCountUsersMatching,
} from "../../matrix/matrix-admin-client.js";
import { getMatrixAdminCreds } from "../../matrix/matrix-admin-creds-store.js";
import type { AuthenticatedRequest } from "../../../types/index.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireAdmin = authManager.createAdminMiddleware();
const execAsync = promisify(exec);

// Phase 75 Plan 04 — matches identity-birth-orchestrator.ts IDENTITY_KEY_RE.
// Duplicated locally so we can validate req.params.key at the retry-route
// entry before touching any DB / SSH / Synapse dep (T-75-16 defense-in-depth).
const IDENTITY_KEY_RE = /^[a-z0-9._=/+-]+$/;

// ---------------------------------------------------------------------------
// Local exec helper (child_process.exec promisified)
// ---------------------------------------------------------------------------

async function execLocal(command: string): Promise<string> {
  const { stdout } = await execAsync(command);
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// POST /
// ---------------------------------------------------------------------------

router.post(
  "/",
  express.json(),
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // -----------------------------------------------------------------------
    // Body validation — 400 before opening SSE if any required field is missing
    // -----------------------------------------------------------------------
    const {
      hostId,
      name,
      title,
      path,
      colorHue,
      voice,
      avatarCandidateId,
      role,
      task,
      poolPicked,
    } = req.body as Record<string, unknown>;

    if (
      typeof hostId !== "number" ||
      !Number.isInteger(hostId) ||
      hostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }

    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    // Phase 88 code-review M1 (defense-in-depth): gate `name` against
    // IDENTITY_KEY_RE at the route layer for parity with the `role` gate at
    // L146. The orchestrator revalidates `opts.name` before any shell/SFTP
    // work (identity-birth-orchestrator.ts:862/871), so this is not the
    // primary defense today — but Plan 88-01's parsedPath fallback at
    // L228-232 substitutes `name.trim().toLowerCase()` into the working-
    // directory path, and a future refactor that ever reorders those checks
    // would turn a bad name into path traversal via `parsedPath` before the
    // orchestrator's gate fires. Closing the asymmetry here removes the
    // footgun for zero behavior change today.
    if (!IDENTITY_KEY_RE.test(name.trim())) {
      res
        .status(400)
        .json({ error: "name must match [a-z0-9._=/+-]+ (kebab-case)" });
      return;
    }

    // Phase 86 Plan 86-04: title-required gate deleted. Identities born without
    // a title inherit their role's title on landing (D-CTX-86-inherit) — the
    // orchestrator's absent-⇒-omit invariant at buildIdentityFileBody L392-395
    // already skips emitting a title: key when opts.title is empty/absent, and
    // the backend merge in publicIdentity (Plan 86-01) resolves the display
    // title from the role's frontmatter under `identity ?? role ?? null`.
    if (title !== undefined && title !== null && typeof title !== "string") {
      res.status(400).json({ error: "title must be a string or null" });
      return;
    }

    // Phase 86 Plan 86-04: avatarCandidateId-required gate deleted. Identities
    // born without an avatar inherit their role's avatar (served via
    // /identities/:key/avatar role-folder fallback landed in Plan 86-01).
    // Downstream: when opts.avatarCandidateId is empty, the orchestrator's
    // Step 1 candidate lookup + Step 2.5 sibling-file write are skipped
    // entirely (see identity-birth-orchestrator.ts's absent-avatar branch).
    if (
      avatarCandidateId !== undefined &&
      avatarCandidateId !== null &&
      typeof avatarCandidateId !== "string"
    ) {
      res
        .status(400)
        .json({ error: "avatarCandidateId must be a string or null" });
      return;
    }

    // Phase 22 SRIC-02: role is REQUIRED and must be kebab-case-lowercase.
    // Defense in depth — the orchestrator re-validates before shell interpolation.
    if (typeof role !== "string" || !ROLE_NAME_PATTERN.test(role.trim())) {
      res.status(400).json({
        error: "role is required and must be kebab-case-lowercase",
      });
      return;
    }

    // colorHue and voice are optional (nullable)
    if (colorHue !== null && colorHue !== undefined && typeof colorHue !== "number") {
      res.status(400).json({ error: "colorHue must be a number or null" });
      return;
    }

    if (voice !== null && voice !== undefined && typeof voice !== "string") {
      res.status(400).json({ error: "voice must be a string or null" });
      return;
    }
    // Phase 98 Plan 07: tighten voice validation to the Polly whitelist.
    // A present-and-string voice value must match one of the 7 supported
    // Polly voice IDs (isValidPollyVoice). Null / absent voice remains legal
    // — a newborn identity without a voice frontmatter key inherits its
    // role's voice at read time (Plan 86-01 merge in publicIdentity).
    if (voice !== null && voice !== undefined && !isValidPollyVoice(voice)) {
      res
        .status(400)
        .json({ error: "voice must be one of the supported Polly voice IDs" });
      return;
    }

    // Phase 80 Plan 80-03: task is optional (nullable). Validate BEFORE
    // flushHeaders so a 400 lands as JSON, not as an SSE frame after the
    // stream opens (RESEARCH §7 landmine parity with existing shape).
    // Hard-cap at 500 chars (T-80-03-02 DoS mitigation) — frontend soft-caps
    // ~200 chars; server hard-caps 500 as defense-in-depth.
    if (task !== null && task !== undefined && typeof task !== "string") {
      res.status(400).json({ error: "task must be a string or null" });
      return;
    }
    if (typeof task === "string" && task.length > 500) {
      res.status(400).json({ error: "task must be ≤500 chars" });
      return;
    }

    // Phase 80 Plan 80-03b: poolPicked is optional (nullable). When true, Step 6
    // derives MXID via composeMxidLocalpart + deriveMxidWithOrdinal from the
    // pool-picked name + role. When false/absent, legacy `@<name>:<server>`
    // shape is used (backward compat for pre-Phase-80 identities and
    // manually-typed names). Validated as boolean-or-undefined; 400 on any
    // other type so client bugs surface loudly rather than silently taking
    // the legacy branch.
    if (poolPicked !== undefined && typeof poolPicked !== "boolean") {
      res.status(400).json({ error: "poolPicked must be a boolean" });
      return;
    }

    // Phase 80 review fix (H3): when poolPicked === true, role MUST match the
    // stricter ROLE_NAME_RE (no leading digit per segment, no empty segments)
    // because composeMxidLocalpart's derivation uses the same regex and will
    // rethrow mid-birth (Step 6 failure) on malformed segments — leaving a
    // partial state (identity folder on disk, no relay account). Reject at
    // the HTTP door instead of falling into the orchestrator's throw-path.
    if (poolPicked === true && !ROLE_NAME_RE.test(role.trim())) {
      res.status(400).json({
        error:
          "role must be kebab-case-lowercase with no leading digit per segment when poolPicked=true",
      });
      return;
    }

    const parsedColorHue = (typeof colorHue === "number" ? colorHue : null) as number | null;
    const parsedVoice = (typeof voice === "string" ? voice : null) as string | null;
    // Phase 88 (Plan 88-01) + Phase 96 D-04 (2026-09-11): substitute the
    // canonical per-identity workspace path when the request body path is
    // absent or empty. Non-admin submits from NewSessionDialog arrive here
    // with body.path === "" or === undefined (admin-gate wraps the Path input
    // in an isAdmin-conditional JSX guard). Admin submits arrive with the
    // frontend default (`~/`) or an admin-typed override. Admin-typed-empty
    // edge case: an admin who actively clears the default hits this same
    // fallback branch and lands in the workspace path.
    //
    // Path convention is Phase 96 D-04: `~/fleet/identities/<name>/workspace/`.
    // Pre-Phase-96 this substituted `~/<name>/` (bug: caused Alice's
    // onboarding-rehearsal on T800 test03-vm to birth aster at ~/aster/
    // instead of ~/fleet/identities/aster/workspace/, and the supervisor's
    // disk-scan cwd fallback specifically expects the new path — see
    // agent-supervisor.sh's launch_claude cwd resolution). The substituted
    // name is the already-trimmed identity name from the same payload
    // (see the `!name.trim()` guard at L111-114 above), lower-cased to match
    // what the client sends (`name: name.toLowerCase()`) and the orchestrator
    // invocation (`name: name.trim()`).
    //
    // Downstream: parsedPath is threaded into orchestrator opts.path, which
    // is consumed by the tmux `-c` working-directory argument (step 2 of
    // birth) and the SFTP write target (step 2.5 role frontmatter); both
    // accept the `~/fleet/identities/<name>/workspace/` form and expand it
    // via shell/SFTP tilde-resolution.
    const parsedPath = (
      typeof path === "string" && path.trim()
        ? path
        : `~/fleet/identities/${(typeof name === "string" ? name.trim().toLowerCase() : "")}/workspace/`
    ) as string;
    // Phase 86 Plan 86-04: absent-⇒-empty-string fallbacks for cosmetics that
    // moved to role level. The orchestrator's buildIdentityFileBody
    // (identity-birth-orchestrator.ts L392-395) already treats empty-string
    // title as absent (omits the `title:` key from frontmatter), so passing ""
    // is byte-equivalent to omitting the field from identity frontmatter — the
    // role's title wins via the Plan 86-01 merge at publicIdentity.
    const parsedTitle =
      typeof title === "string" && title.trim() ? title.trim() : "";
    // Empty avatarCandidateId signals the orchestrator to skip Step 1's
    // candidate lookup + Step 2.5's avatar-sibling write; the role's
    // avatar file is served via Plan 86-01's GET /:key/avatar fallback.
    const parsedAvatarCandidateId =
      typeof avatarCandidateId === "string" && avatarCandidateId.trim()
        ? avatarCandidateId.trim()
        : "";
    // Phase 80 Plan 80-03: trim task string here so orchestrator's absent-⇒-omit
    // guard (opts.task.trim().length > 0) sees the canonical value. Null → null.
    const parsedTask = (typeof task === "string" ? task.trim() : null) as string | null;
    // Phase 80 Plan 80-03b: parsedPoolPicked preserves the tri-state (true / false /
    // undefined). undefined → orchestrator takes legacy branch. false is threaded
    // as-is (explicit opt-out from a client that knows the field exists but wants
    // legacy shape).
    const parsedPoolPicked =
      typeof poolPicked === "boolean" ? poolPicked : undefined;

    // -----------------------------------------------------------------------
    // Phase 75 Plan 04 — fail-early 503 when matrix admin creds absent.
    //
    // Fail-early per D-OQ7 in 75-04-PLAN + T-75-28 in threat model — no
    // hardcoded homeserver fallback; each Skynet box is its own island
    // (CONTEXT.md § Philosophy). On a fresh non-ingested deployment the
    // operator sees a clear "matrix_admin_foundation_not_ingested" signal
    // rather than a mint-call failure several steps later against a fake
    // homeserver.
    //
    // MUST run BEFORE opening SSE (returns application/json 503, not an SSE
    // stream with a failed event) so the frontend can surface the deploy-
    // runbook message inline.
    // -----------------------------------------------------------------------
    const creds = await getMatrixAdminCreds();
    if (!creds) {
      res.status(503).json({
        error: "matrix_admin_foundation_not_ingested",
        detail: "matrix admin foundation not ingested — see deploy runbook",
      });
      return;
    }

    // -----------------------------------------------------------------------
    // Open SSE stream (headers flushed BEFORE orchestrator starts)
    // -----------------------------------------------------------------------
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // nginx SSE disable-buffering hint
    res.flushHeaders();

    // -----------------------------------------------------------------------
    // Phase 106 (D-09): 30s SSE comment-frame keepalive.
    //
    // The birth stream holds open up to WAIT_FOR_SUPERVISOR_TIMEOUT_MS
    // (120s in identity-birth-orchestrator.ts) during the wait-for-supervisor
    // poll after Step 8. Intermediary idle-timeout defaults (nginx 60s, Caddy
    // 30s per docker/nginx.conf + docker/nginx-https.conf) would kill the
    // stream mid-wait without a periodic frame. The `:keepalive` leading-colon
    // form is an SSE comment per spec — consumers ignore it silently, so no
    // frontend-side handling is needed.
    //
    // 30s cadence sits well under both the nginx default (60s) and Caddy
    // default (30s), giving the first keepalive frame ~two chances to fire
    // before Caddy would close on inactivity.
    // -----------------------------------------------------------------------
    const keepAliveInterval = setInterval(() => {
      try {
        res.write(":keepalive\n\n");
      } catch {
        /* ignore write errors after close */
      }
    }, 30000);

    // -------------------------------------------------------------------------
    // Phase 106 review (M1 fix): wire an AbortController to req.on("close")
    // so a client disconnect (browser tab close, hard navigation, user's
    // AbortController.abort()) breaks the orchestrator's up-to-120s wait
    // block instead of pinning an SSH connection + firing wasted discovery
    // execs against the target host. Only the wait block honors it; the mint
    // steps (1/2/6/7/8) are seconds-scale and abort-mid-mint would leave
    // worse partial state than letting them finish.
    // -------------------------------------------------------------------------
    const abortController = new AbortController();
    req.on("close", () => {
      abortController.abort();
    });

    // -----------------------------------------------------------------------
    // Emit helper — frames each event as SSE
    // -----------------------------------------------------------------------
    const emit = (e: BirthEvent): void => {
      res.write(`event: birth\ndata: ${JSON.stringify(e)}\n\n`);
    };

    // -----------------------------------------------------------------------
    // Build real deps object
    // -----------------------------------------------------------------------
    // Patch #316: userId is the JWT subject string (users.id = text() in
    // schema). Prior parseInt() produced NaN → String(NaN) = "NaN" downstream,
    // breaking every birth at step 1's getCandidateForBirth scope guard.
    // Pass the string through unmodified; dep signatures updated to match.

    // Phase 68 Plan 03: createIdentityRecord + getIdentityRecord removed —
    // no DB record is created; disk folder + frontmatter + avatar sibling ARE
    // the identity's identity. forceSave also removed (no DB mutation to save).
    const deps: BirthDeps = {
      connectOneShot,
      execCommand,
      isLocalHostId,
      execLocal,
      getCandidateForBirth: (uid, id) => getCandidateForBirth(uid, id),
      resolveHostById: async (hostId, uid) =>
        resolveHostById(hostId, uid),
      fsp: {
        readFile: (p: string, enc: "utf8") => fsp.readFile(p, enc),
        writeFile: (p: string, content: string) => fsp.writeFile(p, content),
      },
      // Phase 22 SRIC-02: SFTP tmp+rename helper for Step 2.5 pre-write.
      writeMarkdownFileAtomic: async (conn, targetPath, contents) =>
        writeMarkdownFileAtomic(conn, targetPath, contents),
      // Phase 66 Plan 66-01 Track 1: SFTP binary tmp+rename helper for the
      // Step 2.5 avatar sibling write — same ext_openssh_rename discipline
      // as writeMarkdownFileAtomic, binary payload, log tag
      // identity_avatar_write.
      writeAvatarSiblingFile: async (conn, identityKey, ext, bytes) =>
        writeAvatarSiblingFile(conn, identityKey, ext, bytes),
      // Phase 75 Plan 04 — four new BirthDeps for the admin-mint + relay.json
      // write sequence (Steps 6/7/8). Wired to Plan 02's matrix-admin-client
      // exports. matrixHomeserver is read from the first-class column on
      // matrix_admin_creds (W-1: read creds.homeserverBase directly; do NOT
      // split creds.userId to derive it). D-OQ7: NO hardcoded fallback —
      // the 503 fail-early check above guarantees creds is non-null here.
      matrixCreateOrUpdateUser: (mxid, password, displayname) =>
        matrixCreateOrUpdateUser(mxid, password, displayname),
      matrixLoginAsUser: (mxid, validUntilMs) =>
        matrixLoginAsUser(mxid, validUntilMs),
      matrixHomeserver: creds.homeserverBase,
      matrixServerName: creds.serverName,
      // Host-reachable relay.json base — falls back to homeserverBase when
      // the hostSideBase column is null (single-URL fleets like t1000).
      relayJsonHomeserverBase: creds.hostSideBase ?? creds.homeserverBase,
      buildRelayJsonBody: (opts) => buildRelayJsonBody(opts),
      // Phase 80 Plan 80-03b — countUsersMatching primitive from plan 80-02.
      // Called by deriveMxidWithOrdinal inside Step 6 to find the first unused
      // ordinal for the composed base handle when opts.poolPicked === true.
      // Never invoked on the legacy path (poolPicked absent/false).
      matrixCountUsersMatching: (mxid) => matrixCountUsersMatching(mxid),
      // Phase 106 (D-05/D-06) — wait-for-supervisor sensor. Called every
      // WAIT_FOR_SUPERVISOR_POLL_MS from birthIdentity's wait block after
      // Step 8's relay.json write. Same helper fleet-status and sessions.ts
      // already trust — do NOT introduce a parallel sensor per shape file
      // §"What would make it wrong" bullet 7.
      discoverIdentitySessionFile: (conn, identityName) =>
        discoverIdentitySessionFile(conn, identityName),
    };

    // -----------------------------------------------------------------------
    // Invoke orchestrator — catch errors and surface in SSE stream
    // -----------------------------------------------------------------------
    try {
      await birthIdentity(
        {
          userId,
          hostId,
          name: name.trim(),
          // Phase 86 Plan 86-04: empty-string title threads the absent-⇒-omit
          // invariant through the orchestrator so the identity's frontmatter
          // gets no `title:` key and inherits from the role at read time
          // (D-CTX-86-inherit + Plan 86-01 publicIdentity merge).
          title: parsedTitle,
          path: parsedPath,
          colorHue: parsedColorHue,
          voice: parsedVoice,
          // Phase 86 Plan 86-04: empty-string avatarCandidateId signals the
          // orchestrator's Step 1 candidate lookup + Step 2.5 sibling-file
          // write to skip; the role's avatar file is served via Plan 86-01's
          // GET /:key/avatar role-folder fallback (D-CTX-86-inherit).
          avatarCandidateId: parsedAvatarCandidateId,
          role: role.trim(),
          // Phase 80 Plan 80-03: thread task through opts. ?? undefined so
          // parsedTask=null → orchestrator sees undefined (omit-empty matches
          // BirthOptions optional shape).
          task: parsedTask ?? undefined,
          // Phase 80 Plan 80-03b: thread poolPicked through opts. undefined
          // (absent from body) → orchestrator takes legacy `@<name>:<server>`
          // MXID branch. true → derivation path. false → legacy branch
          // (explicit opt-out preserved as boolean, distinct from undefined).
          poolPicked: parsedPoolPicked,
          // Phase 106 review M1 fix: thread the client-disconnect signal into
          // the orchestrator so the wait-for-supervisor loop breaks early on
          // browser navigation / tab close instead of pinning an SSH conn.
          abortSignal: abortController.signal,
        },
        emit,
        deps,
      );
    } catch (err) {
      // Unexpected throw from orchestrator (should emit ended event itself,
      // but catch here as a safety net — emit an ended{ok:false} if not already).
      // Phase 106 (D-11): carry sanitized reason on the safety-net emit too,
      // for log-forensic wire parity with the orchestrator's own outer-catch
      // and with the retry-route's safety-net emit.
      databaseLogger.error("Identity birth orchestrator threw unexpectedly", err, {
        operation: "identity_birth",
        userId,
        name,
      });
      emit({ type: "ended", ok: false, reason: sanitizeError(err) });
    } finally {
      // Phase 106 (D-09): tear down the keepalive timer FIRST — the interval
      // holds a ref on the event loop, and any post-close write attempt from
      // the interval would race with `res.end()` below.
      clearInterval(keepAliveInterval);
      // Consume the candidate to prevent re-use.
      // Phase 86 Plan 86-04: skip when no candidate was submitted — role-
      // inherited-avatar births (D-CTX-86-inherit) never touch the candidate
      // cache, so there is nothing to consume. consumeCandidateForBirth is
      // already a no-op on missing entries, but skipping saves a spurious
      // lookup and prevents any future variant of the helper from surfacing
      // a `key not found` warning on the happy path.
      if (parsedAvatarCandidateId) {
        try {
          consumeCandidateForBirth(userId, parsedAvatarCandidateId);
        } catch {
          // Ignore cleanup errors
        }
      }
      res.end();
    }
  },
);

// ---------------------------------------------------------------------------
// Phase 75 Plan 04 — POST /identities/birth/retry/:key
//
// Q2 partial-failure recovery: if a prior birth's Step 6/7/8 failed, the
// identity folder is on disk (Q2 no-rollback lock) but the relay account /
// relay.json may be incomplete. This admin-gated route re-runs
// runRelayMintAndWrite for the existing identity so the operator can recover
// from the same admin session without touching the target host by hand.
//
// D-OQ1 lock: mounted under /identities/birth (inherits existing nginx
// coverage — no new location blocks required per RESEARCH.md § Pitfall 1).
// Idempotent: PUT /_synapse/admin/v2/users/<uid> is idempotent (200 update
// returns fresh state) and writeMarkdownFileAtomic uses ext_openssh_rename
// for atomic overwrite.
//
// Validation order (defense-in-depth):
//   401 on missing JWT       — createAdminMiddleware
//   403 on non-admin         — createAdminMiddleware
//   400 on bad :key          — IDENTITY_KEY_RE
//   400 on missing hostId    — inline
//   503 on missing admin creds — getMatrixAdminCreds() === null
//   then run runRelayMintAndWrite
//
// NEVER logs the access_token, agent password, or Synapse response bodies.
// ---------------------------------------------------------------------------
router.post("/retry/:key", express.json(), requireAdmin, async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;
    const key = req.params.key;

    // Validate identity key (defense-in-depth: same regex as orchestrator)
    if (typeof key !== "string" || !IDENTITY_KEY_RE.test(key)) {
      res.status(400).json({ error: "invalid identity key" });
      return;
    }

    const { hostId } = req.body as Record<string, unknown>;
    if (
      typeof hostId !== "number" ||
      !Number.isInteger(hostId) ||
      hostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }

    // Phase 75 Plan 04 — same fail-early gate as the birth handler above.
    // Fail-early per D-OQ7 in 75-04-PLAN + T-75-28 in threat model — no
    // hardcoded homeserver fallback; each Skynet box is its own island
    // (CONTEXT.md § Philosophy).
    const creds = await getMatrixAdminCreds();
    if (!creds) {
      res.status(503).json({
        error: "matrix_admin_foundation_not_ingested",
        detail: "matrix admin foundation not ingested — see deploy runbook",
      });
      return;
    }

    // Resolve the host BEFORE opening SSE so a 404 surfaces as JSON.
    let host: unknown;
    try {
      host = await resolveHostById(hostId, userId);
    } catch (resolveErr) {
      databaseLogger.warn("relay retry: host resolve failed", {
        operation: "identity_birth_retry_host_resolve_failed",
        userId,
        hostId,
        error: resolveErr instanceof Error ? resolveErr.message : String(resolveErr),
      });
      res.status(404).json({ error: "host not found" });
      return;
    }
    if (!host) {
      res.status(404).json({ error: "host not found" });
      return;
    }

    // Open SSE with the same envelope as the birth handler.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Phase 106 (D-09): 30s SSE comment-frame keepalive — mirror of the POST /
    // route's keepalive above. Retry cumulative time is under 30s in the happy
    // case (Steps 6/7/8 + no supervisor wait), but a slow Synapse admin API
    // round-trip could plausibly push a single step past the nginx/Caddy
    // intermediary idle-timeout. Defense-in-depth to keep the wire warm.
    const keepAliveInterval = setInterval(() => {
      try {
        res.write(":keepalive\n\n");
      } catch {
        /* ignore write errors after close */
      }
    }, 30000);

    const emit = (e: BirthEvent): void => {
      res.write(`event: birth\ndata: ${JSON.stringify(e)}\n\n`);
    };

    // Assemble the four Phase 75 deps that runRelayMintAndWrite needs.
    // Same wiring as the birth handler's BirthDeps for consistency.
    const deps: Pick<
      BirthDeps,
      | "matrixCreateOrUpdateUser"
      | "matrixLoginAsUser"
      | "matrixHomeserver"
      | "matrixServerName"
      | "relayJsonHomeserverBase"
      | "buildRelayJsonBody"
      | "writeMarkdownFileAtomic"
      | "execCommand"
    > = {
      execCommand,
      writeMarkdownFileAtomic: async (conn, targetPath, contents) =>
        writeMarkdownFileAtomic(conn, targetPath, contents),
      matrixCreateOrUpdateUser: (mxid, password, displayname) =>
        matrixCreateOrUpdateUser(mxid, password, displayname),
      matrixLoginAsUser: (mxid, validUntilMs) =>
        matrixLoginAsUser(mxid, validUntilMs),
      matrixHomeserver: creds.homeserverBase,
      matrixServerName: creds.serverName,
      // Host-reachable relay.json base — falls back to homeserverBase when
      // the hostSideBase column is null (single-URL fleets like t1000).
      relayJsonHomeserverBase: creds.hostSideBase ?? creds.homeserverBase,
      buildRelayJsonBody: (opts) => buildRelayJsonBody(opts),
    };

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    let endedEmitted = false;
    try {
      conn = await connectOneShot(host as Parameters<typeof connectOneShot>[0], SSH_CONNECT_TIMEOUT_MS);
      // displayName mirrors the orchestrator's Step 2.5 derivation
      const displayName =
        key.length > 0 ? key[0].toUpperCase() + key.slice(1) : key;
      // runRelayMintAndWrite emits ended{ok:false, failedStep:N} on any step
      // failure via its internal runStep, so we only need to catch here for
      // "unexpected error, no ended emitted yet" and for the success path
      // (which does NOT emit ended — the retry route emits ended{ok:true}
      // on success below).
      await runRelayMintAndWrite(
        { name: key, displayName, hostId },
        (e: BirthEvent) => {
          emit(e);
          if (e.type === "ended") endedEmitted = true;
        },
        deps as BirthDeps,
        conn,
      );
      // Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode + agent-supervisor race
      // Success: emit ended{ok:true} to close out the SSE stream cleanly.
      // runRelayMintAndWrite only emits ended on FAILURE (via runStep's
      // catch); happy-path completion needs an explicit ended{ok:true} here.
      if (!endedEmitted) {
        emit({ type: "ended", ok: true, identityId: key, sessionName: key });
      }
    } catch (err) {
      // Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode + agent-supervisor race
      // BirthAborted from runStep already emitted step:N:failed + ended.
      // Any other throw (SSH connect failure, unexpected) needs a fallback
      // ended{ok:false} emit if runRelayMintAndWrite did not emit one.
      databaseLogger.error("relay retry unexpectedly threw", err, {
        operation: "identity_birth_retry",
        userId,
        key,
        hostId,
      });
      if (!endedEmitted) {
        // Phase 106 (D-11 + W-1 fix): carry the sanitized reason string on
        // the failure ended emit so log-forensic parity holds across birth
        // and retry paths. sanitizeError is the SAME helper the orchestrator
        // uses on its outer-catch failure branch — reuses the 200-char cap
        // + SSH-message-to-safe-string mapping.
        emit({ type: "ended", ok: false, reason: sanitizeError(err) });
      }
    } finally {
      // Phase 106 (D-09): tear down the keepalive timer FIRST — same
      // ordering discipline as the POST / route above.
      clearInterval(keepAliveInterval);
      if (conn) {
        try {
          (conn as unknown as { end: () => void }).end();
        } catch {
          // Ignore cleanup errors — Q2 no-rollback lock — see 75-CONTEXT.md § Storage failure mode + agent-supervisor race
        }
      }
      res.end();
    }
  },
);

// ---------------------------------------------------------------------------
// Error handler (mirrors identities.ts L316-333)
// ---------------------------------------------------------------------------
router.use(
  (
    err: Error & { code?: string },
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    databaseLogger.error("Identity birth route error", err, {
      operation: "identity_birth_route_error",
    });
    return res.status(500).json({ error: err?.message ?? "Identity birth error" });
  },
);

export default router;
