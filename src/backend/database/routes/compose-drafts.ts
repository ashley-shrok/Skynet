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
//     → 200 { body: string }
//     Returns { body: "" } when no row exists (never 404 — first-time
//     load on an empty pane is a normal success path, not a miss).
//
//   PUT  /  body { hostId: int, tmuxSession?: string|null, body: string }
//     → 204 on success
//     Upsert via raw ON CONFLICT — see NULL-KEY RATIONALE below.
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

router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const hostId = parseHostId(req.query.hostId);
  if (hostId === null) {
    return res.status(400).json({ error: "hostId is required" });
  }
  const tmuxSession = parseTmuxSession(req.query.tmuxSession);
  const storageTmuxSession = tmuxSessionForStorage(tmuxSession);
  try {
    const row = db
      .select({ body: composeDrafts.body })
      .from(composeDrafts)
      .where(
        and(
          eq(composeDrafts.userId, userId),
          eq(composeDrafts.hostId, hostId),
          eq(composeDrafts.tmuxSession, storageTmuxSession),
        ),
      )
      .get();
    return res.json({ body: row?.body ?? "" });
  } catch (e) {
    databaseLogger.error("Failed to load compose draft", e, {
      operation: "load_compose_draft",
      userId,
    });
    return res.status(500).json({ error: "Failed to load compose draft" });
  }
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
  try {
    // Raw SQL upsert — drizzle-orm's onConflictDoUpdate against a
    // composite target has fussy typing in some versions and the raw
    // form is the safest bet across upgrades. Do NOT delete the row on
    // empty body — an empty body IS a state (cleared-on-send), keeping
    // the row preserves the FK-cascade audit trail and matches the
    // clear-on-send posture spec'd in the plan.
    db.run(sql`
      INSERT INTO compose_drafts (user_id, host_id, tmux_session, body, updated_at)
      VALUES (${userId}, ${hostId}, ${storageTmuxSession}, ${body}, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, host_id, tmux_session)
      DO UPDATE SET body = excluded.body, updated_at = CURRENT_TIMESTAMP
    `);
    return res.status(204).end();
  } catch (e) {
    databaseLogger.error("Failed to save compose draft", e, {
      operation: "save_compose_draft",
      userId,
    });
    return res.status(500).json({ error: "Failed to save compose draft" });
  }
});

export default router;
