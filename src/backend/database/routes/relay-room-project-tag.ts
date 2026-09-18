/**
 * Phase 117 Plan 117-05 Task 2: POST /relay-rooms/:roomId/project —
 * D-05a read-modify-write on the Matrix room's m.tag account_data for
 * relay-room-associated conversations.
 *
 * Delegates to setRoomProjectTag (from 117-02) which:
 *   Step 1: GET the room's existing m.tag blob (as the acting user)
 *   Step 2: preserve all non-project tags (favorites, low-priority, etc.)
 *   Step 3: strip any existing u.project.* tags (D-06 single-project invariant)
 *   Step 4: if projectSlug !== null, add u.project.<slug> = {}
 *   Step 5: PUT the merged blob
 *
 * POST /relay-rooms/:roomId/project  body: { userMxid: string, project: string | null }
 *   → 200 { ok: true }
 *
 * Semantic contract (per Phase 117 CONTEXT):
 *   - D-05:  relay-room membership carrier is Matrix m.tag account_data.
 *   - D-05a: read-modify-write (never blind overwrite) — the client
 *            module owns steps 1-5; this route is just the HTTP surface.
 *   - D-06:  single-project-per-conversation enforced in
 *            setRoomProjectTag (strips ALL u.project.* on any write).
 *   - D-36a: JSON body (no multipart, no file uploads).
 *   - D-37:  every successful write triggers publishProjectListChanged
 *            so connected clients receive the wire event.
 *
 * Trust boundaries + threat register (117-05-PLAN.md § threat_model):
 *   - T-117-05-01 (JWT + host isolation): every route call authenticated
 *     via JWT middleware; the resolved userId is trusted (populated by
 *     AuthManager) and mapped to a Matrix mxid via users.mxid.
 *   - T-117-05-02 (writing m.tag as another user's mxid): defense-in-depth
 *     check that body.userMxid MATCHES the authenticated user's mxid on
 *     record. Matrix homeserver ALSO enforces this because the per-user
 *     token minted by matrix-room-tag-client is the acting user's token —
 *     double defense.
 *   - T-117-05-03 (roomId injection): route validates /^!.+:.+$/ before
 *     any I/O. setRoomProjectTag additionally applies encodeURIComponent
 *     on the roomId (T-117-02-02).
 *   - T-117-05-04 (slug injection): PROJECT_SLUG_RE gate here AND in
 *     setRoomProjectTag itself. Slug becomes `u.project.<validated-slug>`
 *     as a tag key — no path or shell metacharacters possible.
 *   - T-117-05-06 (500 body leak): fixed error shape; err.message goes
 *     to databaseLogger only.
 *
 * NOT applicable:
 *   - NO SSH branch — the Matrix HTTP client owns the connection lifecycle.
 *   - NO resolveHostById — Matrix is fleet-wide, not per-host.
 *   - NO DatabaseSaveTrigger.forceSave — no SQL DB rows written.
 *
 * Mounted at /relay-rooms in database.ts (plural, to avoid collision with
 * existing /relay-room/create + /relay-room/:roomId/participants under
 * the /relay-room singular base).
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { setRoomProjectTag } from "../../matrix/matrix-room-tag-client.js";
import { PROJECT_SLUG_RE } from "../../claude-session/identity-artifact-reader.js";
// Phase 117 H2 fix (2026-09-18): getSubscriptionRegistry import removed —
// this route no longer publishes anything after a room-tag write (see the
// intentionally-omitted publish block below for the full rationale).

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * Matrix room-id grammar (minimal, defense-in-depth). The Matrix homeserver
 * also validates on the PUT, but rejecting malformed values before the
 * outbound HTTP call is cheaper and yields a clearer error surface.
 * Matches the same shape used by relay-room-participants.ts.
 */
const MATRIX_ROOM_ID_RE = /^![a-zA-Z0-9._=-]+:[a-zA-Z0-9.-]+$/;

/**
 * Matrix mxid grammar — matches the shape used by matrix-admin-routes.ts:29.
 * Applied to `body.userMxid` before any comparison; blocks obvious garbage
 * (empty strings, missing `@`, etc.) at the body-parse step.
 */
const MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/;

/**
 * Look up the authenticated user's own mxid from users.mxid.
 *
 * Returns null if the user row has no mxid (pre-Phase-88 accounts). The
 * caller MUST treat null as "cannot verify — reject" per T-117-05-02
 * defense-in-depth: a user with no mxid on record cannot legitimately
 * write m.tag on any room as ANY mxid.
 *
 * Mirrors relay-room-participants.ts:78-99 (lookupViewingUserMxid).
 */
async function lookupCallerMxid(userId: string): Promise<string | null> {
  try {
    const rows = (await db
      .select({ mxid: users.mxid })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)) as Array<{ mxid: string | null }>;
    const row = rows[0];
    if (row === undefined) return null;
    return typeof row.mxid === "string" && row.mxid.length > 0
      ? row.mxid
      : null;
  } catch (err) {
    databaseLogger.warn(
      `relay-room-project-tag: lookupCallerMxid failed userId=${userId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

/**
 * POST /:roomId/project  body: { userMxid: string, project: string | null }
 *
 * Writes (or clears) the room's u.project.<slug> account_data tag as the
 * acting user via setRoomProjectTag (117-02).
 *
 * Errors:
 *   - 400 { error: "invalid_room_id" }                              — bad roomId
 *   - 400 { error: "userMxid is required" }                         — missing/bad mxid shape
 *   - 400 { error: "project must be a string matching [a-z0-9-]{1,64} or null" }
 *   - 401 { error: "Unauthorized" }                                 — no JWT
 *   - 403 { error: "userMxid does not match authenticated user" }   — defense-in-depth
 *   - 500 { error: "failed to set room project tag" }               — setter throws (generic)
 *   - 502 { error: "matrix write failed", code: <error> }           — Matrix non-2xx (AdminErr)
 */
router.post(
  "/:roomId/project",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Validate roomId path segment (defense-in-depth).
    const rawRoomId = String(req.params.roomId ?? "");
    if (!rawRoomId || !MATRIX_ROOM_ID_RE.test(rawRoomId)) {
      res.status(400).json({ error: "invalid_room_id" });
      return;
    }
    const roomId = rawRoomId;

    // 2. Parse body.
    const body = (req.body ?? {}) as {
      userMxid?: unknown;
      project?: unknown;
    };

    // 3. Validate userMxid (must be present + valid mxid shape).
    const rawUserMxid = body.userMxid;
    if (
      typeof rawUserMxid !== "string" ||
      rawUserMxid.length === 0 ||
      !MXID_RE.test(rawUserMxid)
    ) {
      res.status(400).json({ error: "userMxid is required" });
      return;
    }
    const userMxid = rawUserMxid;

    // 4. Validate project (string matching PROJECT_SLUG_RE OR null; must be
    // present in body — omitting it is a 400, mirroring session-project-write).
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

    // 5. Defense-in-depth (T-117-05-02): body.userMxid MUST match the
    // authenticated user's mxid on record. The Matrix homeserver ALSO
    // enforces this because the per-user token minted downstream is
    // scoped to the caller — but rejecting here is cheaper (no wasted
    // HTTP round-trip) and yields a clearer error surface than a Matrix
    // 403 forwarded as 502.
    const callerMxid = await lookupCallerMxid(userId);
    if (callerMxid === null || callerMxid !== userMxid) {
      res
        .status(403)
        .json({ error: "userMxid does not match authenticated user" });
      return;
    }

    // 6. Delegate to setRoomProjectTag (117-02). Three outcomes:
    //   - {ok: true} → publishProjectListChanged; 200
    //   - {ok: false, status, error} → 502 with the Matrix error code
    //   - throw → 500 generic (no err.message leak per T-117-05-06)
    let result: Awaited<ReturnType<typeof setRoomProjectTag>>;
    try {
      result = await setRoomProjectTag(userMxid, roomId, project);
    } catch (err) {
      databaseLogger.error(
        `failed to set room project tag userMxid=${userMxid} roomId=${roomId} project=${project ?? "null"}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      res.status(500).json({ error: "failed to set room project tag" });
      return;
    }

    if (!result.ok) {
      databaseLogger.warn(
        `matrix room-tag write failed userMxid=${userMxid} roomId=${roomId} status=${result.status} error=${result.error}`,
      );
      res.status(502).json({
        error: "matrix write failed",
        code: result.error,
      });
      return;
    }

    // 7. Post-write wire event (D-37) — INTENTIONALLY OMITTED.
    //
    // Phase 117 H2 fix (2026-09-18): pre-fix, this route called
    // registry.publishProjectListChanged([]) after a successful
    // room-tag write. The intent was to invalidate any downstream
    // listeners; the bug was that
    // subscription-registry.publishProjectListChanged compares to the
    // *previous* cache — publishing [] when the cache is populated
    // (which it always is after boot hydration) is a real delta.
    // The registry then overwrote its cache with [] and fanned out an
    // empty project-list-changed frame to every WS subscriber, which
    // on the frontend set state.projects = [] and vaporized every
    // project header for every connected client.
    //
    // The correct behavior: a room-tag write does NOT change the
    // projects[] list itself (only which conversations belong to a
    // project changes), so we do not publish anything here. If a
    // frontend needs a per-room membership ping in the future, that
    // should be a distinct session-project-changed frame carrying
    // {roomId, project} without touching the projects cache — but
    // that's out of scope for this fix pass.
    //
    // Note: getSubscriptionRegistry is intentionally NOT called here
    // now — no publish means no lookup.

    // Audit log.
    databaseLogger.info(
      `relay-room project tag written: userId=${userId} userMxid=${userMxid} roomId=${roomId} project=${project ?? "null"}`,
    );
    res.json({ ok: true });
    return;
  },
);

// Generic 500 fallback error handler.
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    return res
      .status(500)
      .json({ error: err?.message ?? "relay-room-project-tag route error" });
  },
);

export default router;
