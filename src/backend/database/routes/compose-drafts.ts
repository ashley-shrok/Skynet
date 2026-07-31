import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import { composeDrafts } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

// Patch #57: per-pane ComposeBox draft persistence.
//
// Singleton draft row per (userId, hostId, tmuxSession). Two endpoints:
//
//   GET  /?hostId=<int>&tmuxSession=<str|omitted>
//     → 200 { body: string; queueSlots: Array<{id:string;text:string}> }
//     Returns { body: "", queueSlots: [] } when no row exists (never 404 —
//     first-time load on an empty pane is a normal success path, not a miss).
//
//   PUT  /  body { hostId: int, tmuxSession?: string|null, body: string, queueSlots?: [...] }
//     → 204 on success
//     Upsert via raw ON CONFLICT — see NULL-KEY RATIONALE below.
//
// Bounty message-queue-in-pretty-view: queue_slots TEXT column added to the
// compose_drafts table. GET returns queueSlots alongside body (defaults to []
// on missing or corrupt JSON). PUT accepts optional queueSlots (validated
// array of {id,text}); when omitted, the existing column value is preserved
// via the ON CONFLICT DO UPDATE SET clause (body-only PUT is backward-compat).
//
// NULL-KEY RATIONALE: SQLite treats NULL as distinct in a UNIQUE /
// PRIMARY KEY constraint. Two rows with the same non-null user_id +
// host_id and NULL tmux_session would BOTH be allowed, and the upsert
// ON CONFLICT (user_id, host_id, tmux_session) DO UPDATE clause would
// silently miss the match. To keep the upsert trivial and correct for
// non-tmux hosts (Windows / GIGAASHLEYPC — no tmux, so the client
// sends tmuxSession = null), the column is stored as `NOT NULL DEFAULT ''`
// and the route layer coalesces null → '' at the storage boundary. The
// client wire type stays nullable (`string | null`) — the coalesce is
// server-side only. Same pattern used elsewhere in the SQLite
// ecosystem for singleton-per-composite-key tables.

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

function parseHostId(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function parseTmuxSession(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw);
  if (s === "" || s === "null") return null;
  return s;
}

// Coalesce a nullable client-facing tmuxSession to the storage-layer
// empty-string sentinel — SQLite treats NULL as distinct in the composite
// PRIMARY KEY, so the empty string is the only way to keep ON CONFLICT
// upserts working correctly for non-tmux hosts.
function tmuxSessionForStorage(raw: string | null): string {
  return raw ?? "";
}

// ---------------------------------------------------------------------------
// Helpers: queue slot validation and parsing
// ---------------------------------------------------------------------------

/**
 * Parse the queue_slots column value from storage. On any parse failure
 * (invalid JSON, non-array, any item missing string id/text) returns []
 * and logs a warning. Never throws.
 */
export function parseQueueSlotsFromStorage(
  raw: string | null | undefined,
): Array<{ id: string; text: string }> {
  if (raw == null || raw === "") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      databaseLogger.warn("compose_drafts queue_slots is not an array, defaulting to []", {
        operation: "load_compose_draft_queue_slots_corrupt",
      });
      return [];
    }
    const valid = parsed.every(
      (item: unknown) =>
        item !== null &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).id === "string" &&
        typeof (item as Record<string, unknown>).text === "string",
    );
    if (!valid) {
      databaseLogger.warn("compose_drafts queue_slots items have invalid shape, defaulting to []", {
        operation: "load_compose_draft_queue_slots_corrupt",
      });
      return [];
    }
    return parsed as Array<{ id: string; text: string }>;
  } catch {
    databaseLogger.warn("compose_drafts queue_slots JSON parse failure, defaulting to []", {
      operation: "load_compose_draft_queue_slots_corrupt",
    });
    return [];
  }
}

/**
 * Validate queueSlots from a PUT request body. Returns { ok: true, value }
 * when valid (must be an array of {id: string, text: string}; empty array is valid).
 * Returns { ok: false, error } when invalid.
 */
export function validateQueueSlotsFromRequest(
  raw: unknown,
): { ok: true; value: Array<{ id: string; text: string }> } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "invalid queueSlots shape" };
  }
  for (const item of raw) {
    if (
      item === null ||
      typeof item !== "object" ||
      typeof (item as Record<string, unknown>).id !== "string" ||
      typeof (item as Record<string, unknown>).text !== "string"
    ) {
      return { ok: false, error: "invalid queueSlots shape" };
    }
  }
  return { ok: true, value: raw as Array<{ id: string; text: string }> };
}

// ---------------------------------------------------------------------------
// Exported handler functions (for testing per debug.test.ts / user-preferences.test.ts pattern)
// ---------------------------------------------------------------------------

/**
 * Core GET logic: load draft for (userId, hostId, storageTmuxSession) and
 * return { body, queueSlots } via res.json(). Exported for unit testing.
 */
export function handleGetDraft(
  userId: string,
  hostId: number,
  storageTmuxSession: string,
  res: Response,
): void {
  try {
    const row = db
      .select({ body: composeDrafts.body, queueSlots: composeDrafts.queueSlots })
      .from(composeDrafts)
      .where(
        and(
          eq(composeDrafts.userId, userId),
          eq(composeDrafts.hostId, hostId),
          eq(composeDrafts.tmuxSession, storageTmuxSession),
        ),
      )
      .get();
    res.json({
      body: row?.body ?? "",
      queueSlots: parseQueueSlotsFromStorage(row?.queueSlots),
    });
  } catch (e) {
    databaseLogger.error("Failed to load compose draft", e, {
      operation: "load_compose_draft",
      userId,
    });
    res.status(500).json({ error: "Failed to load compose draft" });
  }
}

/**
 * Core PUT logic: upsert (userId, hostId, storageTmuxSession, body, queueSlots).
 * When queueSlots is undefined, preserves the existing column value.
 * When queueSlots is an array, overwrites the column.
 * Returns 204 on success, 400 on invalid shape, 500 on DB error.
 * Exported for unit testing.
 */
export function handlePutDraft(
  userId: string,
  hostId: number,
  storageTmuxSession: string,
  body: string,
  queueSlots: Array<{ id: string; text: string }> | undefined,
  res: Response,
): void {
  // When queueSlots is present, branch the upsert to include queue_slots in
  // the ON CONFLICT DO UPDATE SET clause. When absent, omit it so the existing
  // column value is preserved (backward-compat with body-only PUT paths).
  try {
    if (queueSlots !== undefined) {
      const queueSlotsJson = JSON.stringify(queueSlots);
      // Raw SQL upsert — drizzle-orm's onConflictDoUpdate against a
      // composite target has fussy typing in some versions and the raw
      // form is the safest bet across upgrades. Do NOT delete the row on
      // empty body — an empty body IS a state (cleared-on-send).
      db.run(sql`
        INSERT INTO compose_drafts (user_id, host_id, tmux_session, body, queue_slots, updated_at)
        VALUES (${userId}, ${hostId}, ${storageTmuxSession}, ${body}, ${queueSlotsJson}, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, host_id, tmux_session)
        DO UPDATE SET body = excluded.body, queue_slots = excluded.queue_slots, updated_at = CURRENT_TIMESTAMP
      `);
    } else {
      // body-only PUT: preserve the existing queue_slots column value.
      db.run(sql`
        INSERT INTO compose_drafts (user_id, host_id, tmux_session, body, queue_slots, updated_at)
        VALUES (${userId}, ${hostId}, ${storageTmuxSession}, ${body}, '[]', CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, host_id, tmux_session)
        DO UPDATE SET body = excluded.body, updated_at = CURRENT_TIMESTAMP
      `);
    }
    res.status(204).end();
  } catch (e) {
    databaseLogger.error("Failed to save compose draft", e, {
      operation: "save_compose_draft",
      userId,
    });
    res.status(500).json({ error: "Failed to save compose draft" });
  }
}

// ---------------------------------------------------------------------------
// Express routes
// ---------------------------------------------------------------------------

router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const hostId = parseHostId(req.query.hostId);
  if (hostId === null) {
    return res.status(400).json({ error: "hostId is required" });
  }
  const tmuxSession = parseTmuxSession(req.query.tmuxSession);
  const storageTmuxSession = tmuxSessionForStorage(tmuxSession);
  return handleGetDraft(userId, hostId, storageTmuxSession, res);
});

router.put("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const hostId = parseHostId(req.body?.hostId);
  if (hostId === null) {
    return res.status(400).json({ error: "hostId is required" });
  }
  const tmuxSession = parseTmuxSession(req.body?.tmuxSession);
  const storageTmuxSession = tmuxSessionForStorage(tmuxSession);
  const body = typeof req.body?.body === "string" ? req.body.body : "";

  // Validate queueSlots if present in the request body.
  // LOCKED: queueSlots is OPTIONAL on PUT — omitting it preserves the existing
  // column value. Providing it (even as []) overwrites the column.
  let validatedQueueSlots: Array<{ id: string; text: string }> | undefined;
  if ("queueSlots" in (req.body ?? {})) {
    const validation = validateQueueSlotsFromRequest(req.body.queueSlots);
    if (!validation.ok) {
      return res.status(400).json({ error: (validation as { ok: false; error: string }).error });
    }
    validatedQueueSlots = (validation as { ok: true; value: Array<{ id: string; text: string }> }).value;
  }

  return handlePutDraft(userId, hostId, storageTmuxSession, body, validatedQueueSlots, res);
});

export default router;
