import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db, DatabaseSaveTrigger } from "../db/index.js";
import { userPreferences } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
// Phase 92 Plan 92-02 Task 2: pin sentinel fan-out. The PUT handler drives
// per-identity `.pinned` writes/removes over the Plan 92-01 primitive
// instead of touching the user_preferences DB row for pinnedConversationIds.
// The GET path retires the row-read entirely (D-03 no DB mirror).
import {
  writeIdentityFile,
  removeIdentityFile,
  identityFileExists,
} from "../../claude-session/per-identity-file.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// Phase 15 Plan 1 — max size cap on pinnedConversationIds array.
// Alice's real pin count is well under 100; 1000 is a generous ceiling that
// mitigates the input-validation / DoS threat from the phase threat model
// (T-15-06) — an attacker cannot balloon the row into a payload that slows
// subsequent GETs / bloats the encrypted SQLite volume.
const PINNED_CONVERSATION_IDS_MAX_LENGTH = 1000;

// quick-260731-tgg — max size cap on hiddenConversationIds array. Mirrors
// PINNED_CONVERSATION_IDS_MAX_LENGTH byte-for-byte (same threat model: DoS
// via oversized TEXT column write). Alice's real hide count is expected to
// be small; 1000 is a generous ceiling matching the pin cap.
const HIDDEN_CONVERSATION_IDS_MAX_LENGTH = 1000;

/**
 * Phase 92 Plan 92-02: parseIdentityHosts mirrors identities.ts:239-255 shape.
 *
 * Accepts a Record<string, unknown> (typically from the PUT body) and returns
 * a `Record<string, number>` where every key is LOWERCASED (H3 entry-boundary
 * normalization — `out[k.toLowerCase()] = v`, same as identities.ts:248). Any
 * value that isn't a positive integer hostId is dropped.
 *
 * Duplicated here rather than imported from identities.ts to avoid a
 * cross-route circular import. The two implementations MUST stay behaviorally
 * identical — the identityHosts wire shape is a single contract shared by
 * GET /identities and PUT /user-preferences.
 *
 * H3 lowercase-on-disk invariant: this is the sole entry point where PUT-body
 * identityHosts keys get normalized. Every downstream identityKey threaded
 * into writeIdentityFile / removeIdentityFile / identityFileExists is the
 * post-toLowerCase value — VERBATIM, no further coercion.
 */
function parseIdentityHosts(raw: unknown): Record<string, number> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isInteger(v) && v > 0) {
      out[k.toLowerCase()] = v;
    }
  }
  return out;
}

const pickPreferences = (row?: typeof userPreferences.$inferSelect) => ({
  reopenTabsOnLogin: row?.reopenTabsOnLogin ?? false,
  theme: row?.theme ?? null,
  fontSize: row?.fontSize ?? null,
  accentColor: row?.accentColor ?? null,
  language: row?.language ?? null,
  // Phase 92 Plan 92-02: pinnedConversationIds NO LONGER surfaces on the GET
  // response body — the row is not consulted for pins (D-03 no DB mirror).
  // The frontend Plan 04 projects pinned state from GET /identities' per-
  // identity `pinned` field instead.
  // Phase 107 Plan 107-02: hiddenConversationIds ALSO removed from GET response
  // (D-02 complete). The frontend derives hidden state from per-identity
  // `hidden: boolean` on GET /identities. parseHiddenConversationIds deleted.
});

// --- core handlers (exported for direct testing without Express harness;
//     mirrors debug.ts patch #146 pattern) ---

export function handleGetPreferences(
  userId: string,
  res: Response,
): Response {
  try {
    const rows = db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .all();

    return res.json(pickPreferences(rows[0]));
  } catch (e) {
    databaseLogger.error("Failed to get user preferences", e, {
      operation: "get_user_preferences",
      userId,
    });
    return res.status(500).json({ error: "Failed to get user preferences" });
  }
}

/**
 * Phase 92 Plan 92-02: helper that resolves an SSH conn for a hostId if the
 * host is REMOTE, or returns null for LOCAL. Callers must close returned
 * connections in a finally.
 *
 * Returns { conn, local }.
 * Throws on unresolvable hostId or SSH failure — the fanout treats this as a
 * synchronous error per D-06.
 */
async function openConnForHost(
  hostId: number,
  userId: string,
): Promise<{ conn: import("ssh2").Client | null; local: boolean }> {
  if (isLocalHostId(hostId)) {
    return { conn: null, local: true };
  }
  const host = await resolveHostById(hostId, userId);
  if (!host) {
    throw new Error(`hostId ${hostId} not resolvable`);
  }
  const conn = await connectOneShot(host, 5_000);
  return { conn, local: false };
}

export async function handlePutPreferences(
  userId: string,
  body: unknown,
  res: Response,
): Promise<Response> {
  const {
    reopenTabsOnLogin,
    theme,
    fontSize,
    accentColor,
    language,
    pinnedConversationIds,
    identityHosts: identityHostsRaw,
    hiddenConversationIds,
  } = (body ?? {}) as {
    reopenTabsOnLogin?: boolean;
    theme?: string | null;
    fontSize?: string | null;
    accentColor?: string | null;
    language?: string | null;
    pinnedConversationIds?: unknown;
    identityHosts?: unknown;
    hiddenConversationIds?: unknown;
  };

  const updates: Partial<typeof userPreferences.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (reopenTabsOnLogin !== undefined) {
    if (typeof reopenTabsOnLogin !== "boolean") {
      return res
        .status(400)
        .json({ error: "reopenTabsOnLogin must be a boolean" });
    }
    updates.reopenTabsOnLogin = reopenTabsOnLogin;
  }

  for (const [key, value] of Object.entries({
    theme,
    fontSize,
    accentColor,
    language,
  })) {
    if (value !== undefined && value !== null && typeof value !== "string") {
      return res.status(400).json({ error: `${key} must be a string` });
    }
  }

  if (theme !== undefined) updates.theme = theme;
  if (fontSize !== undefined) updates.fontSize = fontSize;
  if (accentColor !== undefined) updates.accentColor = accentColor;
  if (language !== undefined) updates.language = language;

  // -------------------------------------------------------------------------
  // Phase 92 Plan 92-02 + Phase 107 Plan 107-02: pin + hidden sentinel fan-outs
  // -------------------------------------------------------------------------
  //
  // Both pin (pinnedConversationIds) and hidden (hiddenConversationIds) fanouts
  // share ONE connByHost map and ONE try/finally block. When both slices arrive
  // in the same PUT body, one SSH conn per unique host serves BOTH fanouts
  // (T-107-02-05 — HID-107-PUT-09 regression trap).
  //
  // Sequence: pin fanout (if present), then hidden fanout (if present), inside
  // the same try block. The single finally closes ALL conns from BOTH fanouts.
  //
  // Validation for BOTH slices happens BEFORE any conn is opened so a malformed
  // body fails fast. H3 lowercase-on-disk invariant: identityHosts keys are
  // lowercased at the parseIdentityHosts entry boundary. Keys threaded VERBATIM
  // into all primitive calls — no further coercion between the entry boundary
  // and the disk write.

  // Validate both slices BEFORE opening any conns (fail-fast pre-checks).
  if (pinnedConversationIds !== undefined) {
    // Validation retained verbatim from pre-92 (PUT-92-07a/b/c).
    if (!Array.isArray(pinnedConversationIds)) {
      return res.status(400).json({
        error: "pinnedConversationIds must be an array of strings",
      });
    }
    for (const v of pinnedConversationIds) {
      if (typeof v !== "string") {
        return res.status(400).json({
          error: "pinnedConversationIds must be an array of strings",
        });
      }
    }
    if (pinnedConversationIds.length > PINNED_CONVERSATION_IDS_MAX_LENGTH) {
      return res.status(400).json({
        error: `pinnedConversationIds exceeds max length of ${PINNED_CONVERSATION_IDS_MAX_LENGTH}`,
      });
    }
    // Phase 92-02: identityHosts is REQUIRED when pinnedConversationIds is
    // in the body — no host routing means no fanout means silent no-op.
    // PUT-92-07d locks the missing-identityHosts case at 400.
    if (identityHostsRaw === undefined || identityHostsRaw === null) {
      return res.status(400).json({
        error: "identityHosts required in body when setting pinnedConversationIds",
      });
    }
  }

  // -------------------------------------------------------------------------
  // Phase 107 Plan 107-02: hidden slice validation (mirrors pin validation)
  // -------------------------------------------------------------------------
  //
  // H3 lowercase-on-disk invariant: identityHosts keys are lowercased at the
  // parseIdentityHosts entry boundary. Threaded VERBATIM into identityFileExists
  // / writeIdentityFile / removeIdentityFile for `.hidden`. Plan 01's stricter
  // IDENTITY_KEY_RE gate at the primitive layer is the belt-and-suspenders lock.
  if (hiddenConversationIds !== undefined) {
    // Validation retained verbatim from pre-107 (HID-107-PUT-07a/b/c).
    if (!Array.isArray(hiddenConversationIds)) {
      return res.status(400).json({
        error: "hiddenConversationIds must be an array of strings",
      });
    }
    for (const v of hiddenConversationIds) {
      if (typeof v !== "string") {
        return res.status(400).json({
          error: "hiddenConversationIds must be an array of strings",
        });
      }
    }
    if (hiddenConversationIds.length > HIDDEN_CONVERSATION_IDS_MAX_LENGTH) {
      return res.status(400).json({
        error: `hiddenConversationIds exceeds max length of ${HIDDEN_CONVERSATION_IDS_MAX_LENGTH}`,
      });
    }
    // Phase 107-02: identityHosts is REQUIRED when hiddenConversationIds is
    // in the body — mirrors the pin guard at PUT-92-07d verbatim.
    // HID-107-PUT-07d locks the missing-identityHosts case at 400.
    if (identityHostsRaw === undefined || identityHostsRaw === null) {
      return res.status(400).json({
        error: "identityHosts required in body when setting hiddenConversationIds",
      });
    }
  }

  let didFanoutSentinels = false;

  if (pinnedConversationIds !== undefined || hiddenConversationIds !== undefined) {
    // Shared connByHost map — opened ONCE per unique host across BOTH fanouts
    // (HID-107-PUT-09 conn-sharing invariant).
    const connByHost = new Map<number, import("ssh2").Client | null>();

    try {
      // -----------------------------------------------------------------------
      // PIN FANOUT (Phase 92 Plan 92-02) — unchanged behavior
      // -----------------------------------------------------------------------
      if (pinnedConversationIds !== undefined) {
        // Type assertion: validation above confirmed pinnedConversationIds is string[].
        const pinnedIds = pinnedConversationIds as string[];
        const identityHosts = parseIdentityHosts(identityHostsRaw);
        if (Object.keys(identityHosts).length === 0 && pinnedIds.length > 0) {
          // Empty map + nonempty pins → the fanout would silently miss every key.
          // PUT-92-06 covers the mismatched-key case; this covers the
          // no-map case for symmetric defense.
          return res.status(400).json({
            error: "identityHosts required in body when setting pinnedConversationIds",
          });
        }

        // Defense-in-depth: every pin key MUST have a host mapping. Missing key
        // → 400 (PUT-92-06). No sentinel writes attempted.
        for (const key of pinnedIds) {
          if (!(key in identityHosts)) {
            return res.status(400).json({
              error: `identity host required for identityKey ${JSON.stringify(key)}`,
            });
          }
        }

        // Fanout target: every identityHosts key gets probed for its current
        // .pinned state, and any delta drives a write or a remove.
        // Dedupe hostIds so we open one SSH conn per unique host (T-92-02-05).
        const uniquePinHostIds = [...new Set(Object.values(identityHosts))];
        // Open conns for any host not yet in the shared connByHost map.
        await Promise.all(
          uniquePinHostIds
            .filter((hostId) => !connByHost.has(hostId))
            .map(async (hostId) => {
              const { conn } = await openConnForHost(hostId, userId);
              connByHost.set(hostId, conn);
            }),
        );

        // --- Step 1: derive previous set from disk ------------------------
        // For each identityHosts key, probe identityFileExists. Any failure
        // → false (fail-closed per D-01 — never over-report pinned).
        const identityHostsKeys = Object.keys(identityHosts);
        const previousStates = await Promise.all(
          identityHostsKeys.map(async (key) => {
            const hostId = identityHosts[key];
            try {
              const exists = await identityFileExists(key, ".pinned", {
                hostId,
                conn: connByHost.get(hostId) ?? null,
              });
              return exists;
            } catch {
              return false;
            }
          }),
        );
        const previousSet = new Set<string>();
        identityHostsKeys.forEach((k, i) => {
          if (previousStates[i]) previousSet.add(k);
        });

        // --- Step 2: compute deltas ---------------------------------------
        const nextSet = new Set<string>(pinnedIds);
        const toAdd: string[] = [];
        const toRemove: string[] = [];
        for (const k of nextSet) {
          if (!previousSet.has(k)) toAdd.push(k);
        }
        for (const k of previousSet) {
          if (!nextSet.has(k)) toRemove.push(k);
        }

        // --- Step 3: fan out writes + removes in parallel ------------------
        // Any throw propagates → outer catch surfaces as 500 (D-06 synchronous
        // truth). identityKey is passed VERBATIM to the primitive (H3
        // lowercase-on-disk invariant — parseIdentityHosts already lowercased).
        await Promise.all([
          ...toAdd.map((k) =>
            writeIdentityFile(k, ".pinned", "", {
              hostId: identityHosts[k],
              conn: connByHost.get(identityHosts[k]) ?? null,
            }),
          ),
          ...toRemove.map((k) =>
            removeIdentityFile(k, ".pinned", {
              hostId: identityHosts[k],
              conn: connByHost.get(identityHosts[k]) ?? null,
            }),
          ),
        ]);
        didFanoutSentinels = true;

        // --- Step 4: re-derive disk-authoritative set for response echo ----
        // Do NOT trust the client input for the echo — disk is truth now.
        const postStates = await Promise.all(
          identityHostsKeys.map(async (key) => {
            const hostId = identityHosts[key];
            try {
              return await identityFileExists(key, ".pinned", {
                hostId,
                conn: connByHost.get(hostId) ?? null,
              });
            } catch {
              return false;
            }
          }),
        );
        const echoPinned: string[] = [];
        identityHostsKeys.forEach((k, i) => {
          if (postStates[i]) echoPinned.push(k);
        });

        // Stash for response echo (read after DB write block).
        (res as unknown as { _echoPinned: string[] })._echoPinned = echoPinned;
      }

      // -----------------------------------------------------------------------
      // HIDDEN FANOUT (Phase 107 Plan 107-02) — sibling block to pin fanout
      // -----------------------------------------------------------------------
      //
      // H3 lowercase-on-disk invariant: identityHosts keys arriving at PUT are
      // lowercased by parseIdentityHosts at the entry boundary (mirroring the pin
      // path). Keys threaded VERBATIM into writeIdentityFile / removeIdentityFile /
      // identityFileExists for `.hidden` — no additional coercion. The primitive's
      // IDENTITY_KEY_RE gate is the belt-and-suspenders lock (HID-107-PUT-08).
      if (hiddenConversationIds !== undefined) {
        // Type assertion: validation above confirmed hiddenConversationIds is string[].
        const hiddenIds = hiddenConversationIds as string[];
        const identityHosts = parseIdentityHosts(identityHostsRaw);
        if (Object.keys(identityHosts).length === 0 && hiddenIds.length > 0) {
          return res.status(400).json({
            error: "identityHosts required in body when setting hiddenConversationIds",
          });
        }

        // Defense-in-depth: every hidden key MUST have a host mapping.
        // HID-107-PUT-06 locks this at 400.
        for (const key of hiddenIds) {
          if (!(key in identityHosts)) {
            return res.status(400).json({
              error: `identity host required for identityKey ${JSON.stringify(key)}`,
            });
          }
        }

        // Extend connByHost with any hosts the pin fanout didn't open yet
        // (union of pin.uniqueHostIds and hidden.uniqueHostIds — deduped by hostId).
        const uniqueHiddenHostIds = [...new Set(Object.values(identityHosts))];
        await Promise.all(
          uniqueHiddenHostIds
            .filter((hostId) => !connByHost.has(hostId))
            .map(async (hostId) => {
              const { conn } = await openConnForHost(hostId, userId);
              connByHost.set(hostId, conn);
            }),
        );

        // --- Step 1: derive previous hidden set from disk -----------------
        const identityHostsKeys = Object.keys(identityHosts);
        const previousStates = await Promise.all(
          identityHostsKeys.map(async (key) => {
            const hostId = identityHosts[key];
            try {
              return await identityFileExists(key, ".hidden", {
                hostId,
                conn: connByHost.get(hostId) ?? null,
              });
            } catch {
              return false;
            }
          }),
        );
        const previousSet = new Set<string>();
        identityHostsKeys.forEach((k, i) => {
          if (previousStates[i]) previousSet.add(k);
        });

        // --- Step 2: compute deltas ---------------------------------------
        const nextSet = new Set<string>(hiddenIds);
        const toAdd: string[] = [];
        const toRemove: string[] = [];
        for (const k of nextSet) {
          if (!previousSet.has(k)) toAdd.push(k);
        }
        for (const k of previousSet) {
          if (!nextSet.has(k)) toRemove.push(k);
        }

        // --- Step 3: fan out .hidden writes + removes in parallel ----------
        await Promise.all([
          ...toAdd.map((k) =>
            writeIdentityFile(k, ".hidden", "", {
              hostId: identityHosts[k],
              conn: connByHost.get(identityHosts[k]) ?? null,
            }),
          ),
          ...toRemove.map((k) =>
            removeIdentityFile(k, ".hidden", {
              hostId: identityHosts[k],
              conn: connByHost.get(identityHosts[k]) ?? null,
            }),
          ),
        ]);
        didFanoutSentinels = true;

        // --- Step 4: re-derive disk-authoritative set for response echo ----
        // Disk is truth — do NOT trust client input (D-06/T-107-02-07).
        const postStates = await Promise.all(
          identityHostsKeys.map(async (key) => {
            const hostId = identityHosts[key];
            try {
              return await identityFileExists(key, ".hidden", {
                hostId,
                conn: connByHost.get(hostId) ?? null,
              });
            } catch {
              return false;
            }
          }),
        );
        const echoHidden: string[] = [];
        identityHostsKeys.forEach((k, i) => {
          if (postStates[i]) echoHidden.push(k);
        });

        // Stash for response echo.
        (res as unknown as { _echoHidden: string[] })._echoHidden = echoHidden;
      }
    } catch (e) {
      databaseLogger.error("Sentinel fan-out failed", e, {
        operation: "user_preferences_sentinel_fanout",
        userId,
      });
      // Conn cleanup happens in `finally` below.
      return res
        .status(500)
        .json({ error: "Failed to update user preferences" });
    } finally {
      // Single cleanup point for both pin and hidden fanout conns.
      for (const conn of connByHost.values()) {
        if (conn) {
          try { conn.end(); } catch { /* ignore */ }
        }
      }
    }
  }

  // Guard: updates always carries { updatedAt } — length 1 means no user
  // fields were provided AND no pin or hidden fanout occurred.
  // Phase 92-02: didFanoutSentinels=true (pin fanout) also counts as "did something".
  // Phase 107-02: hidden fanout also sets didFanoutSentinels=true.
  if (Object.keys(updates).length === 1 && !didFanoutSentinels) {
    return res.status(400).json({ error: "No preferences provided" });
  }

  try {
    // Phase 92-02: skip the DB write block entirely for pin-only requests
    // (Object.keys(updates).length === 1 means only updatedAt is set, so no
    // real user fields were provided — the fanout already happened above).
    if (Object.keys(updates).length > 1) {
      const existing = db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .all();

      if (existing.length === 0) {
        db.insert(userPreferences)
          .values({
            userId,
            ...updates,
          })
          .run();
      } else {
        db.update(userPreferences)
          .set(updates)
          .where(eq(userPreferences.userId, userId))
          .run();
      }

      // Skynet's DB is in-memory-decrypted SQLite; raw db.insert/update writes
      // reach RAM only. The 5-min isDirty poller is gated on _dirty=true which
      // only triggerSave/forceSave set — direct writes never mark dirty. Without
      // an explicit save call, hides survive to disk only if SIGTERM's
      // graceful flush wins the deploy race. Force the save here so the write
      // is durable before we ACK. Silent-warn on failure — an in-memory-only
      // preference is worse UX than a slow response, but a 500 is worse still.
      // Pattern reference: identities.ts:264-273 (identity_updated).
      try {
        await DatabaseSaveTrigger.forceSave("user_preferences_updated");
      } catch (saveErr) {
        databaseLogger.warn(
          "Force-save after user preferences update failed",
          {
            operation: "user_preferences_update_save_failed",
            userId,
            error:
              saveErr instanceof Error ? saveErr.message : "Unknown error",
          },
        );
      }
    }

    // Read the row back through pickPreferences so the response body shape is
    // the same source of truth as the GET handler. Phase 92-02: pin state
    // does NOT surface via pickPreferences — instead, the disk-derived echo
    // (previously stashed on res._echoPinned) attaches as pinnedConversationIds.
    const row = db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .all()[0];

    const echoPinned = (res as unknown as { _echoPinned?: string[] })._echoPinned;
    const echoHidden = (res as unknown as { _echoHidden?: string[] })._echoHidden;
    const responseBody: Record<string, unknown> = {
      success: true,
      ...pickPreferences(row),
    };
    if (echoPinned !== undefined) {
      // D-06 UI-invariance: PUT still echoes pinnedConversationIds as an array
      // so the frontend's putPinnedIds()-await site gets the shape it expects.
      responseBody.pinnedConversationIds = echoPinned;
    }
    if (echoHidden !== undefined) {
      // Phase 107 Plan 107-02: PUT echoes hiddenConversationIds as the
      // disk-authoritative post-fanout set (D-06 truth-first invariant).
      responseBody.hiddenConversationIds = echoHidden;
    }
    return res.json(responseBody);
  } catch (e) {
    databaseLogger.error("Failed to update user preferences", e, {
      operation: "update_user_preferences",
      userId,
    });
    return res.status(500).json({ error: "Failed to update user preferences" });
  }
}

/**
 * @openapi
 * /user-preferences:
 *   get:
 *     summary: Get preferences for the current user
 *     tags:
 *       - User Preferences
 *     responses:
 *       200:
 *         description: User preferences.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reopenTabsOnLogin:
 *                   type: boolean
 *                 hiddenConversationIds:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.get("/", authenticateJWT, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  return handleGetPreferences(userId, res);
});

/**
 * @openapi
 * /user-preferences:
 *   put:
 *     summary: Update preferences for the current user
 *     tags:
 *       - User Preferences
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reopenTabsOnLogin:
 *                 type: boolean
 *               pinnedConversationIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: "Phase 92-02: writes fan out to per-identity `.pinned` sentinels. Requires identityHosts body field."
 *               identityHosts:
 *                 type: object
 *                 additionalProperties:
 *                   type: integer
 *                 description: "Phase 92-02: map of identityKey → hostId. Required when pinnedConversationIds is present."
 *               hiddenConversationIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Preferences updated successfully.
 */
router.put("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  return handlePutPreferences(userId, req.body, res);
});

export default router;
