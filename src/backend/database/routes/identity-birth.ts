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
import {
  isLocalHostId,
  writeMarkdownFileAtomic,
  writeAvatarSiblingFile,
} from "../../claude-session/identity-artifact-reader.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import {
  birthIdentity,
  runRelayMintAndWrite,
  ROLE_NAME_PATTERN,
  SSH_CONNECT_TIMEOUT_MS,
  type BirthEvent,
  type BirthDeps,
} from "./identity-birth-orchestrator.js";
import {
  getCandidateForBirth,
  consumeCandidateForBirth,
} from "./identity-avatar-batch.js";
// Phase 75 Plan 04 — Matrix admin client (Plan 02) + creds store (Plan 01).
import {
  createOrUpdateUser as matrixCreateOrUpdateUser,
  loginAsUser as matrixLoginAsUser,
  buildRelayJsonBody,
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

    if (typeof title !== "string" || !title.trim()) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    if (typeof avatarCandidateId !== "string" || !avatarCandidateId.trim()) {
      res.status(400).json({ error: "avatarCandidateId is required" });
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

    const parsedColorHue = (typeof colorHue === "number" ? colorHue : null) as number | null;
    const parsedVoice = (typeof voice === "string" ? voice : null) as string | null;
    const parsedPath = (typeof path === "string" ? path : "~") as string;
    // Phase 80 Plan 80-03: trim task string here so orchestrator's absent-⇒-omit
    // guard (opts.task.trim().length > 0) sees the canonical value. Null → null.
    const parsedTask = (typeof task === "string" ? task.trim() : null) as string | null;

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
      buildRelayJsonBody: (opts) => buildRelayJsonBody(opts),
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
          title: title.trim(),
          path: parsedPath,
          colorHue: parsedColorHue,
          voice: parsedVoice,
          avatarCandidateId: avatarCandidateId.trim(),
          role: role.trim(),
          // Phase 80 Plan 80-03: thread task through opts. ?? undefined so
          // parsedTask=null → orchestrator sees undefined (omit-empty matches
          // BirthOptions optional shape).
          task: parsedTask ?? undefined,
        },
        emit,
        deps,
      );
    } catch (err) {
      // Unexpected throw from orchestrator (should emit ended event itself,
      // but catch here as a safety net — emit an ended{ok:false} if not already)
      databaseLogger.error("Identity birth orchestrator threw unexpectedly", err, {
        operation: "identity_birth",
        userId,
        name,
      });
      emit({ type: "ended", ok: false });
    } finally {
      // Consume the candidate to prevent re-use
      try {
        consumeCandidateForBirth(userId, avatarCandidateId as string);
      } catch {
        // Ignore cleanup errors
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
        { name: key, displayName },
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
        emit({ type: "ended", ok: false });
      }
    } finally {
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
