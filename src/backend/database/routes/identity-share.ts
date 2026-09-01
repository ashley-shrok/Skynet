/**
 * Phase 38 (identity-sharing, Plan 38-01): POST /identities/:id/share.
 *
 * Copy-and-diverge identity row duplicator. Any authenticated user with a
 * given identity in their `userId` scope can share it onward to any other
 * user by inserting a fresh row for the target user carrying the same
 * identityKey/displayName/title/colorHue/voice/avatarMime/avatarData/
 * avatarEtag. Fresh id (nanoid) + fresh createdAt/updatedAt.
 *
 * Endpoint contract:
 *   POST /identities/:id/share
 *     Body: { targetUserId: string }
 *   Responses:
 *     200 { identityId: <new-uuid>, shared: true }  — happy path
 *     200 { identityId: <existing-uuid>, shared: false }
 *          — no-op: target already has an identity with the same identityKey.
 *            The existing id is returned so the frontend can update its
 *            "already shared" set without a second round-trip.
 *     400 { error: "targetUserId is required" }
 *          — body missing / non-string / empty targetUserId
 *     400 { error: "Cannot share to self" }
 *          — targetUserId === requesterUserId
 *     400 { error: "Target user not found" }
 *          — targetUserId does not correspond to a users row
 *     401 { error: "Unauthorized" }
 *          — missing/invalid JWT (from AuthManager middleware)
 *     404 { error: "Identity not found" }
 *          — source :id does not exist under the requester's userId scope.
 *            This SAME 404 fires when the id genuinely doesn't exist OR when
 *            it exists but belongs to another user — do NOT distinguish, to
 *            avoid leaking identity-id existence across users (T-38-01-05).
 *     500 { error: "internal" }
 *          — unexpected error (sanitized, never leak internals)
 *
 * Sequence:
 *   1. Parse body — validate targetUserId is a non-empty string.
 *   2. Self-target guard.
 *   3. Source lookup filtered by (userId=requester, id=sourceId) — 404 if
 *      empty. This is the ONLY permission gate: any user who can see the
 *      identity can share it onward (Phase 38 CONTEXT.md § Who can share:
 *      "The endpoint MUST NOT check 'did this user create the source
 *      identity'"). Row-level permission gating would break the copy-and-
 *      diverge model where recipients are indistinguishable from creators.
 *   4. Target user existence check — 400 if empty.
 *   5. No-op detection: SELECT identities WHERE userId=target AND
 *      identityKey=source.identityKey. If any row exists → 200 with
 *      {identityId: existing[0].id, shared: false}. NO insert.
 *   6. Happy path: INSERT new row with fresh id + timestamps, copying every
 *      other column from the source. Respond 200 with
 *      {identityId: newId, shared: true}.
 *
 * Mount discipline (see database.ts): this router MUST be mounted BEFORE
 * the generic `app.use("/identities", identitiesRoutes)` so POST
 * /identities/:id/share resolves here without falling through to the
 * generic identities router's PUT/DELETE :id handlers.
 *
 * Security posture (STRIDE T-38-01-* in the plan's threat model):
 *   T-38-01-01: Spoofing — authenticateJWT middleware (existing AuthManager
 *     pattern) gates the handler.
 *   T-38-01-02: EoP — source lookup filtered by (id, userId) so the
 *     requester cannot share an identity they can't see. 404 (not 403)
 *     prevents id enumeration across users.
 *   T-38-01-03: Tampering — explicit typeof + trim + users-table existence
 *     check for targetUserId.
 *   T-38-01-05: Info disclosure — generic "Identity not found" 404 for both
 *     "does not exist" and "exists under different user."
 *   T-38-01-08: Body-parser — this router does NOT mount its own body
 *     parser; the app-level `bodyParser.json({limit:"1gb"})` in database.ts
 *     handles ingress before the request reaches us.
 *
 * Phase 38 explicit non-goals (do NOT add):
 *   - `sharedFromId` column, `identity_shares` join table, provenance
 *     tracking, audit log — CONTEXT.md § Data model LOCKED copy-and-diverge.
 *   - Revoke / un-share flow — CONTEXT.md § Deferred.
 *   - Recipient-side accept/notification — CONTEXT.md § Deferred.
 *   - Permission gate on original creator — CONTEXT.md § Who can share
 *     LOCKED "sharing would not be restricted to the original creator."
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import { identities, users } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * POST /:id/share
 * Body: { targetUserId: string }
 * Duplicates the source identity row onto the target user with fresh id +
 * timestamps. No-op with shared:false if target already has this identityKey.
 */
router.post(
  "/:id/share",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;
    const sourceId = String(req.params.id);

    // -----------------------------------------------------------------------
    // 1. Body validation
    // -----------------------------------------------------------------------
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawTarget = body.targetUserId;
    if (typeof rawTarget !== "string" || rawTarget.trim().length === 0) {
      res.status(400).json({ error: "targetUserId is required" });
      return;
    }
    const targetUserId = rawTarget.trim();

    // -----------------------------------------------------------------------
    // 2. Self-target guard
    // -----------------------------------------------------------------------
    if (targetUserId === userId) {
      res.status(400).json({ error: "Cannot share to self" });
      return;
    }

    try {
      // ---------------------------------------------------------------------
      // 3. Source lookup — filtered by requester's userId scope. This 404
      //    fires identically for "does not exist" and "exists but not owned
      //    by requester" so we never leak identity-id existence across users.
      // ---------------------------------------------------------------------
      const sourceRows = db
        .select()
        .from(identities)
        .where(
          and(eq(identities.id, sourceId), eq(identities.userId, userId)),
        )
        .all();
      if (sourceRows.length === 0) {
        res.status(404).json({ error: "Identity not found" });
        return;
      }
      const sourceRow = sourceRows[0];

      // ---------------------------------------------------------------------
      // 4. Target user existence check — 400 if the target user id does not
      //    correspond to any users row. We select only {id} to keep the
      //    query minimal and to avoid accidentally exposing sensitive user
      //    columns even in this internal-only branch.
      // ---------------------------------------------------------------------
      const targetUserRows = db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, targetUserId))
        .all();
      if (targetUserRows.length === 0) {
        res.status(400).json({ error: "Target user not found" });
        return;
      }

      // ---------------------------------------------------------------------
      // 5. No-op detection: if target already has an identity with the same
      //    identityKey, return 200 shared:false with the EXISTING row's id.
      //    Detection is on (targetUserId, identityKey) so it fires whether
      //    the target created their own row with this key OR received it
      //    via a prior share — matches the "silent no-op on repeat" LOCKED
      //    decision. The existing id is returned so the frontend can update
      //    its "already shared" set without a second round-trip.
      // ---------------------------------------------------------------------
      const existingTargetRows = db
        .select()
        .from(identities)
        .where(
          and(
            eq(identities.userId, targetUserId),
            eq(identities.identityKey, sourceRow.identityKey),
          ),
        )
        .all();
      if (existingTargetRows.length > 0) {
        const existingId = existingTargetRows[0].id;
        databaseLogger.info(
          "identity-share: no-op — target already has identityKey",
          {
            operation: "identity_share_noop",
            requesterUserId: userId,
            targetUserId,
            sourceId,
            identityKey: sourceRow.identityKey,
            existingIdentityId: existingId,
          },
        );
        res.status(200).json({ identityId: existingId, shared: false });
        return;
      }

      // ---------------------------------------------------------------------
      // 6. Happy path: insert a fresh row for the target user with every
      //    presentation column copied verbatim from source. Fresh id +
      //    timestamps. No provenance column (copy-and-diverge LOCKED).
      // ---------------------------------------------------------------------
      const newId = nanoid();
      const now = new Date().toISOString();
      // Phase 66 Plan 04: cosmetic columns dropped from identities. The share
      // insertRow copies only the 5 surviving columns. Cosmetics are disk-
      // authoritative and travel with the identity's on-disk .md file — the
      // share-onward case implicitly gains them because the target user's
      // render surfaces read from disk using identityKey (Plan 03 + Plan 05
      // wire the identityHosts map). The insertRow is narrow; nothing to
      // null-echo (there's no publicIdentity constructor in this file —
      // response body is `{identityId, shared}` at the send calls below).
      const insertRow = {
        id: newId,
        userId: targetUserId,
        identityKey: sourceRow.identityKey,
        createdAt: now,
        updatedAt: now,
      };

      // Race-safe insert: the (targetUserId, identityKey) SELECT above narrows
      // the common case, but a concurrent request (mobile double-tap, or a
      // concurrent independent identity creation on the target with the same
      // identityKey) can land its own row between our SELECT and INSERT. The
      // schema declares UNIQUE (user_id, identity_key) on identities, so the
      // second INSERT throws SQLITE_CONSTRAINT_UNIQUE. That is semantically a
      // "silent no-op on repeat" per CONTEXT.md, not an internal error — we
      // re-SELECT the winning row and return {shared:false} with its id so the
      // frontend still gets the marker signal.
      try {
        db.insert(identities).values(insertRow).run();
      } catch (insertErr) {
        const errCode = (insertErr as { code?: string })?.code;
        const isUniqueRace = errCode === "SQLITE_CONSTRAINT_UNIQUE";
        if (!isUniqueRace) throw insertErr;
        const raceWinnerRows = db
          .select()
          .from(identities)
          .where(
            and(
              eq(identities.userId, targetUserId),
              eq(identities.identityKey, sourceRow.identityKey),
            ),
          )
          .all();
        if (raceWinnerRows.length === 0) {
          // Should not happen — the UNIQUE constraint fired, so a row must
          // exist. If we can't find it we can't honor the no-op contract.
          throw insertErr;
        }
        const raceWinnerId = raceWinnerRows[0].id;
        databaseLogger.info(
          "identity-share: no-op via UNIQUE-constraint race",
          {
            operation: "identity_share_race_noop",
            requesterUserId: userId,
            targetUserId,
            sourceId,
            identityKey: sourceRow.identityKey,
            existingIdentityId: raceWinnerId,
          },
        );
        res.status(200).json({ identityId: raceWinnerId, shared: false });
        return;
      }
      // In-memory-SQLite persistence discipline (CLAUDE.md rule + code review
      // HIGH #3, 2026-09-01) — direct .run() writes only reach RAM; force-save
      // to disk. Failure logs a warning but doesn't fail the share request.
      try {
        await DatabaseSaveTrigger.forceSave("identity_shared");
      } catch (saveErr) {
        databaseLogger.warn("Force-save after identity share failed", {
          operation: "identity_share_save_failed",
          requesterUserId: userId,
          targetUserId,
          sourceId,
          error: saveErr instanceof Error ? saveErr.message : "Unknown",
        });
      }

      databaseLogger.info("identity-share: shared identity to target user", {
        operation: "identity_share_success",
        requesterUserId: userId,
        targetUserId,
        sourceId,
        newIdentityId: newId,
        identityKey: sourceRow.identityKey,
      });

      res.status(200).json({ identityId: newId, shared: true });
    } catch (err) {
      databaseLogger.error("identity-share: unexpected error", err, {
        operation: "identity_share_error",
        requesterUserId: userId,
        targetUserId,
        sourceId,
      });
      res.status(500).json({ error: "internal" });
    }
  },
);

// Generic 500 fallback error handler (mirrors identity-exists-on-host.ts
// L162-172). Sanitizes upstream detail per fleet convention.
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    databaseLogger.error("identity-share: unhandled error", err, {
      operation: "identity_share_unhandled",
    });
    return res.status(500).json({ error: "internal" });
  },
);

export default router;
