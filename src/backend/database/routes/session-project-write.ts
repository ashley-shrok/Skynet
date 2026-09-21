/**
 * Phase 117 Plan 117-05 Task 1: POST /identities/:key/project — write
 * (or clear) the `project:` frontmatter field on an identity's markdown
 * file. Delegates to writeSessionProjectField (from 117-01) which does
 * the full yaml.load / yaml.dump round-trip preserving every other
 * frontmatter key (Pitfall 5).
 *
 * POST /identities/:key/project  body: { hostId: number, project: string | null }
 *   → 200 { ok: true }
 *
 * Semantic contract (per Phase 117 CONTEXT):
 *   - D-05: `project:` frontmatter is the source of truth for identity-
 *     associated conversation project membership.
 *   - D-06 (single-project-per-conversation): `project:` is a single
 *     scalar; the writer atomically REPLACES it on any set.
 *   - D-31 (clear gesture): body `project: null` DELETES the key from
 *     the frontmatter dict (absent-⇒-omit invariant enforced by
 *     writeSessionProjectField).
 *   - D-36a: JSON body (no multipart, no file uploads).
 *   - D-37 (wire event): every successful write triggers
 *     publishProjectListChanged so connected clients receive an
 *     idempotent-checked fanout. The projects[] array itself does not
 *     change on a session-field write, but the registry's JSON.stringify
 *     idempotent-skip absorbs the no-op cheaply; if a follow-up phase
 *     adds a distinct `session-project-changed` frame that will slot in
 *     as an additive discriminated-union member.
 *
 * Byte-shape mirrors identity-archive.ts:76-159 verbatim, with:
 *   - IDENTITY_KEY_RE gate on the path segment (T-117-05 path-traversal)
 *   - PROJECT_SLUG_RE gate on the body (T-117-05-04 tag-key injection)
 *   - JWT + resolveHostById 404-on-cross-user (T-117-05-01)
 *   - LOCAL/REMOTE branch on isLocalHostId
 *   - try/catch/finally with conn.end() in finally
 *   - Generic 500 shape "failed to write session project" (T-117-05-06 no leak)
 *
 * Threat register (T-117-05-05 ACCEPTED): the backend cannot cheaply
 * distinguish terminal identity files from regular identity files; the
 * frontend gates via rdpHostRow (D-08). If a forged `project:` lands on
 * a terminal identity, the id-skill amendment gracefully no-ops per D-33
 * (project directory missing → skip clause) so the failure mode is
 * inert. See threat model in 117-05-PLAN.md § threat_model.
 *
 * Mounted at /identities in database.ts AFTER identity-archive so the
 * :key/project sub-route isn't shadowed by identitiesRoutes's :identityKey
 * handlers.
 */

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
  PROJECT_SLUG_RE,
  writeSessionProjectField,
  // Phase 117 M5 fix (2026-09-18): listProjects import removed —
  // this route no longer re-enumerates the host's project list after
  // a session-field write (which does not change the list itself).
} from "../../claude-session/identity-artifact-reader.js";
import { getSubscriptionRegistry } from "../../fleet-status/subscription-registry.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches sibling identity-archive.ts. */
const SSH_CONNECT_TIMEOUT_MS = 3000;

/**
 * POST /:key/project  body: { hostId: number, project: string | null }
 *
 * Writes (or clears) the `project:` frontmatter field on the identity's
 * markdown file via writeSessionProjectField (117-01).
 *
 * Errors:
 *   - 400 { error: "hostId is required" }                       — missing hostId
 *   - 400 { error: "hostId must be a positive integer" }        — malformed hostId
 *   - 400 { error: "identity key must match [a-z0-9_-]{1,64}" } — bad key
 *   - 400 { error: "project must be a string matching [a-z0-9-]{1,64} or null" }
 *   - 404 { error: "Host not found" }                           — cross-user / unknown host
 *   - 504 { error: "Host unreachable" }                         — SSH connect failure
 *   - 500 { error: "failed to write session project" }          — writer failure (generic)
 */
router.post(
  "/:key/project",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;
    const body = (req.body ?? {}) as {
      hostId?: unknown;
      project?: unknown;
    };

    // 1. Parse + validate hostId (body).
    const rawHostId = body.hostId;
    if (rawHostId === undefined || rawHostId === null || rawHostId === "") {
      res.status(400).json({ error: "hostId is required" });
      return;
    }
    const hostId =
      typeof rawHostId === "number"
        ? rawHostId
        : parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }

    // 2. Validate identity key via IDENTITY_KEY_RE (T-117-05 gate).
    const key = String(req.params.key ?? "");
    if (!key || !IDENTITY_KEY_RE.test(key)) {
      res
        .status(400)
        .json({ error: "identity key must match [a-z0-9_-]{1,64}" });
      return;
    }

    // 3. Validate `project` — must be either `null` OR a string matching
    // PROJECT_SLUG_RE. Empty string is NOT valid (use null to clear per
    // D-31 absent-⇒-omit); numbers/booleans/undefined all reject.
    //
    // The `project` key MUST be present in the body — omitting it (i.e.
    // undefined) is a 400. This forces the caller to make an explicit
    // choice between assign and clear; ambiguous "no field" is not a
    // valid gesture.
    if (!("project" in body)) {
      res.status(400).json({
        error:
          "project must be a string matching [a-z0-9-]{1,64} or null",
      });
      return;
    }
    const rawProject = body.project;
    let project: string | null;
    if (rawProject === null) {
      project = null;
    } else if (typeof rawProject === "string") {
      if (!PROJECT_SLUG_RE.test(rawProject)) {
        res.status(400).json({
          error:
            "project must be a valid slug matching [a-z0-9-]{1,64} or null",
        });
        return;
      }
      project = rawProject;
    } else {
      res.status(400).json({
        error:
          "project must be a string matching [a-z0-9-]{1,64} or null",
      });
      return;
    }

    // 4. Verify host ownership (T-117-05-01 gate). Returns null for
    // cross-user or unknown hostId → 404 (same shape as sibling routes).
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    // 5. Branch on LOCAL vs REMOTE. LOCAL passes conn=null; REMOTE opens
    // a one-shot SSH connection whose lifetime is scoped by try/finally.
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    if (!isLocalHostId(hostId)) {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch {
        // Connect failure → 504 with generic message (T-117-05-06).
        res.status(504).json({ error: "Host unreachable" });
        return;
      }
    }

    try {
      try {
        await writeSessionProjectField(conn, key, project);
      } catch (err) {
        // Log server-side; return generic message (T-117-05-06 no leak).
        databaseLogger.error(
          `failed to write session project field key=${key} hostId=${hostId} project=${project ?? "null"}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        res.status(500).json({ error: "failed to write session project" });
        return;
      }

      // 6. Post-write wire event: fan out session-project-changed carrying
      // { identityKey, hostId, project }. Distinct from
      // project-list-changed — the projects[] array itself doesn't change
      // when an identity moves between projects, only which identity
      // belongs where. Frontend sidebar listens for this to patch the
      // affected identity row in place without a full /identities refetch.
      //
      // Phase 117 M5 (2026-09-18) removed the pre-existing (unrelated)
      // publishProjectListChanged call here because it was fanning out a
      // list that hadn't changed. This is the promised follow-up frame.
      //
      // Publisher failure MUST NOT convert a successful write into a 500 —
      // the on-disk state is correct even if one fanout hop drops. Log and
      // continue.
      try {
        const registry = getSubscriptionRegistry();
        if (registry) {
          registry.publishSessionProjectChanged(key, hostId, project);
        }
      } catch (pubErr) {
        databaseLogger.warn(
          `session-project-changed publish failed key=${key} hostId=${hostId}: ${
            pubErr instanceof Error ? pubErr.message : String(pubErr)
          }`,
        );
      }

      // Audit log per T-117-05 (repudiation): who wrote what.
      databaseLogger.info(
        `session-project written: userId=${userId} hostId=${hostId} key=${key} project=${project ?? "null"}`,
      );
      res.json({ ok: true });
      return;
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

// Generic 500 fallback error handler (mirrors sibling routes).
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    return res
      .status(500)
      .json({ error: err?.message ?? "session-project-write route error" });
  },
);

export default router;
