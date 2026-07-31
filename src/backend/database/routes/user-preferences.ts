import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import { userPreferences } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// Phase 15 Plan 1 — max size cap on pinnedConversationIds array.
// Ashley's real pin count is well under 100; 1000 is a generous ceiling that
// mitigates the input-validation / DoS threat from the phase threat model
// (T-15-06) — an attacker cannot balloon the row into a payload that slows
// subsequent GETs / bloats the encrypted SQLite volume.
const PINNED_CONVERSATION_IDS_MAX_LENGTH = 1000;

// quick-260731-tgg — max size cap on hiddenConversationIds array. Mirrors
// PINNED_CONVERSATION_IDS_MAX_LENGTH byte-for-byte (same threat model: DoS
// via oversized TEXT column write). Ashley's real hide count is expected to
// be small; 1000 is a generous ceiling matching the pin cap.
const HIDDEN_CONVERSATION_IDS_MAX_LENGTH = 1000;

/**
 * Parse the raw JSON-serialized string[] stored in the pinned_conversation_ids
 * TEXT column into an actual string[].
 *
 * Returns [] for:
 *   - null / undefined (user has never set pins)
 *   - malformed JSON
 *   - JSON that parses to a non-array
 *   - arrays containing any non-string element (defense-in-depth against a
 *     corrupted row — mirror of the client-side hydrate pattern)
 *
 * Silent-catch: never throws, never propagates a corrupted-row failure to the
 * client. Wave 2's optimistic reconciliation must never see an exception path.
 */
function parsePinnedConversationIds(
  raw: string | null | undefined,
): string[] {
  if (raw == null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    for (const v of parsed) {
      if (typeof v !== "string") return [];
    }
    return parsed as string[];
  } catch {
    return [];
  }
}

/**
 * Parse the raw JSON-serialized string[] stored in the hidden_conversation_ids
 * TEXT column into an actual string[].
 *
 * Returns [] for:
 *   - null / undefined (user has never hidden any conversation)
 *   - malformed JSON
 *   - JSON that parses to a non-array
 *   - arrays containing any non-string element (defense-in-depth against a
 *     corrupted row — mirror of parsePinnedConversationIds)
 *
 * Silent-catch: never throws. quick-260731-tgg structural mirror of
 * parsePinnedConversationIds — do NOT extract a shared helper.
 */
function parseHiddenConversationIds(
  raw: string | null | undefined,
): string[] {
  if (raw == null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    for (const v of parsed) {
      if (typeof v !== "string") return [];
    }
    return parsed as string[];
  } catch {
    return [];
  }
}

const pickPreferences = (row?: typeof userPreferences.$inferSelect) => ({
  reopenTabsOnLogin: row?.reopenTabsOnLogin ?? false,
  theme: row?.theme ?? null,
  fontSize: row?.fontSize ?? null,
  accentColor: row?.accentColor ?? null,
  language: row?.language ?? null,
  pinnedConversationIds: parsePinnedConversationIds(
    row?.pinnedConversationIds,
  ),
  hiddenConversationIds: parseHiddenConversationIds(
    row?.hiddenConversationIds,
  ),
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

export function handlePutPreferences(
  userId: string,
  body: unknown,
  res: Response,
): Response {
  const {
    reopenTabsOnLogin,
    theme,
    fontSize,
    accentColor,
    language,
    pinnedConversationIds,
    hiddenConversationIds,
  } = (body ?? {}) as {
    reopenTabsOnLogin?: boolean;
    theme?: string | null;
    fontSize?: string | null;
    accentColor?: string | null;
    language?: string | null;
    pinnedConversationIds?: unknown;
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

  // Phase 15 Plan 1 — pinnedConversationIds validation + serialization.
  // Reject non-arrays, non-string elements, and arrays that exceed the
  // configured DoS-mitigation length cap. Serialize to JSON at the boundary
  // because the column is TEXT (no native JSON type in SQLite).
  if (pinnedConversationIds !== undefined) {
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
    updates.pinnedConversationIds = JSON.stringify(pinnedConversationIds);
  }

  // quick-260731-tgg — hiddenConversationIds validation + serialization.
  // Structural mirror of the pinnedConversationIds block above: reject non-
  // arrays, non-string elements, and arrays exceeding the configured DoS-
  // mitigation cap. Serialize to JSON at the boundary (column is TEXT).
  if (hiddenConversationIds !== undefined) {
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
    updates.hiddenConversationIds = JSON.stringify(hiddenConversationIds);
  }

  // Guard: updates always carries { updatedAt } — length 1 means no user
  // fields were provided. Any single user field (including pinnedConversationIds)
  // pushes length to 2 and passes.
  if (Object.keys(updates).length === 1) {
    return res.status(400).json({ error: "No preferences provided" });
  }

  try {
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

    // Read the row back through pickPreferences so the response body shape is
    // the same source of truth as the GET handler — including the parsed
    // pinnedConversationIds ARRAY (not the raw JSON string). Wave 2's
    // optimistic reconciliation depends on this contract (Test 5 in
    // user-preferences.test.ts asserts Array.isArray + deep-equals).
    const row = db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .all()[0];

    return res.json({ success: true, ...pickPreferences(row) });
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
 *                 pinnedConversationIds:
 *                   type: array
 *                   items:
 *                     type: string
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
 *               hiddenConversationIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Preferences updated successfully.
 */
router.put("/", authenticateJWT, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  return handlePutPreferences(userId, req.body, res);
});

export default router;
