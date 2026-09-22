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
// user's real pin count is well under 100; 1000 is a generous ceiling that
// mitigates the input-validation / DoS threat from the phase threat model
// (T-15-06) — an attacker cannot balloon the row into a payload that slows
// subsequent GETs / bloats the encrypted SQLite volume.
const PINNED_CONVERSATION_IDS_MAX_LENGTH = 1000;

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
  // (Phase 115 Plan 115-02: `.hidden` code path fully retired per D-21;
  // the earlier `hiddenConversationIds` slice was already off GET.)
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
  } = (body ?? {}) as {
    reopenTabsOnLogin?: boolean;
    theme?: string | null;
    fontSize?: string | null;
    accentColor?: string | null;
    language?: string | null;
    pinnedConversationIds?: unknown;
    identityHosts?: unknown;
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

  // Function-scope scratch for the disk-authoritative echo the response emits
  // for the pin fanout slice. Populated inside the try block below.
  let echoPinnedFinal: string[] | undefined;

  // -------------------------------------------------------------------------
  // Phase 92 Plan 92-02: pin sentinel fan-out
  // -------------------------------------------------------------------------
  //
  // (Phase 115 Plan 115-02: the sibling `.hidden` fanout was retired per
  // D-21 — the archive gesture ships in 115-06 via a dedicated POST endpoint,
  // not a PUT array shape. See 114-CONTEXT.md § D-17.)
  //
  // Validation for the pin slice happens BEFORE any conn is opened so a
  // malformed body fails fast. H3 lowercase-on-disk invariant: identityHosts
  // keys are lowercased at the parseIdentityHosts entry boundary. Keys
  // threaded VERBATIM into all primitive calls — no further coercion between
  // the entry boundary and the disk write.

  // Validate the pin slice BEFORE opening any conns (fail-fast pre-checks).
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

  let didFanoutSentinels = false;

  if (pinnedConversationIds !== undefined) {
    // Per-host conn map — opened ONCE per unique host across the pin fanout.
    const connByHost = new Map<number, import("ssh2").Client | null>();
    // Hosts whose SSH conn couldn't be opened (offline, timeout, resolver
    // failure). Identities on these hosts are skipped from every step of the
    // fanout so one unreachable host doesn't fail the PUT for identities on
    // healthy hosts. Fail-closed on read (identityFileExists on a REMOTE
    // host with conn=null throws → per-key try/catch already treats it as
    // "not pinned") mirrors this at the primitive layer.
    const unreachableHosts = new Set<number>();

    try {
      // -----------------------------------------------------------------------
      // PIN FANOUT (Phase 92 Plan 92-02, per-host tolerant)
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
        // Open conns per-host with tolerance: an openConn failure marks the
        // host unreachable and does NOT throw out of the fanout. This is the
        // whole point of unreachableHosts — an offline fleet peer used to
        // 500 every pin PUT on the whole fleet.
        await Promise.all(
          uniquePinHostIds
            .filter((hostId) => !connByHost.has(hostId))
            .map(async (hostId) => {
              try {
                const { conn } = await openConnForHost(hostId, userId);
                connByHost.set(hostId, conn);
              } catch (openErr) {
                unreachableHosts.add(hostId);
                connByHost.set(hostId, null);
                databaseLogger.warn(
                  "Pin fanout: host unreachable — skipping",
                  {
                    operation: "user_preferences_pin_fanout_host_unreachable",
                    userId,
                    hostId,
                    error:
                      openErr instanceof Error
                        ? openErr.message
                        : String(openErr),
                  },
                );
              }
            }),
        );

        // Reachable-host key filter — every downstream step operates over
        // this subset only. Identities whose host is unreachable are dropped
        // from the fanout entirely (no previous probe, no delta, no write,
        // no post-echo). Their on-disk .pinned state is left untouched.
        const identityHostsKeys = Object.keys(identityHosts).filter(
          (k) => !unreachableHosts.has(identityHosts[k]),
        );
        const reachableKeySet = new Set(identityHostsKeys);

        // --- Step 1: derive previous set from disk ------------------------
        // For each REACHABLE identityHosts key, probe identityFileExists. Any
        // failure → false (fail-closed per D-01 — never over-report pinned).
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
        // nextSet drops any client-requested pin whose host is unreachable —
        // we can't persist the sentinel, so echoing it back would lie about
        // disk truth. The client will observe the drop on the next GET
        // /identities refresh (which fail-closes on unreachable hosts too).
        const nextSet = new Set<string>(
          pinnedIds.filter((k) => reachableKeySet.has(k)),
        );
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
        echoPinnedFinal = echoPinned;
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
      // Single cleanup point for pin fanout conns.
      for (const conn of connByHost.values()) {
        if (conn) {
          try { conn.end(); } catch { /* ignore */ }
        }
      }
    }
  }

  // Guard: updates always carries { updatedAt } — length 1 means no user
  // fields were provided AND no pin fanout occurred.
  // Phase 92-02: didFanoutSentinels=true (pin fanout) also counts as "did something".
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
    // the same source of truth as the GET handler. Phase 92-02: pin state does
    // NOT surface via pickPreferences — instead, the disk-derived echo held in
    // echoPinnedFinal (populated inside the try block by the pin fanout)
    // attaches as pinnedConversationIds.
    const row = db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .all()[0];

    const responseBody: Record<string, unknown> = {
      success: true,
      ...pickPreferences(row),
    };
    if (echoPinnedFinal !== undefined) {
      // D-06 UI-invariance: PUT still echoes pinnedConversationIds as an array
      // so the frontend's putPinnedIds()-await site gets the shape it expects.
      responseBody.pinnedConversationIds = echoPinnedFinal;
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
 *     responses:
 *       200:
 *         description: Preferences updated successfully.
 */
router.put("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  return handlePutPreferences(userId, req.body, res);
});

export default router;
