/**
 * /identities/:key/condense — the user pressed Condense conversation. Drops
 * the `.compact-requested` request on the identity's host; the agent-supervisor
 * carries it out on its next tick (waking a dormant agent through its inbox,
 * waiting for an awake one to be at rest), compacts the conversation, and then
 * delivers a "Compaction done" event so the agent takes a turn. The same file
 * is what an agent drops to compact itself, so the button and the agent share
 * one way in.
 *
 * POST /identities/:key/condense  body: { hostId: number, guidance?: string }
 *   → 200 { ok: true }
 *
 * `guidance` is whatever the user had typed in the composer — passed to the
 * compaction as what the summary should keep. Whitespace (newlines included)
 * is collapsed, control characters dropped, and it is capped at
 * GUIDANCE_MAX_CHARS; empty means none.
 *
 * Same shape as identity-archive.ts: authenticateJWT → IDENTITY_KEY_RE gate →
 * resolveHostById (cross-user / unknown → 404) → LOCAL/REMOTE branch →
 * writeIdentityFile → conn.end(). 500s return a generic message; the guidance
 * text is never logged.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { getHostSemaphore } from "../../ssh/host-semaphore-registry.js";
import {
  isLocalHostId,
  IDENTITY_KEY_RE,
} from "../../claude-session/identity-artifact-reader.js";
import { writeIdentityFile } from "../../claude-session/per-identity-file.js";

/** Remote SSH work holds one per-host semaphore slot; local disk work needs none. */
function withHostSlot<T>(hostId: number, fn: () => Promise<T>): Promise<T> {
  return isLocalHostId(hostId) ? fn() : getHostSemaphore(hostId).run(fn);
}

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const SSH_CONNECT_TIMEOUT_MS = 3000;

/** The supervisor caps it again (in bytes); this keeps the request file small. */
export const GUIDANCE_MAX_CHARS = 1000;

export function normalizeGuidance(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // Whitespace (newlines included) collapses to single spaces; other control
  // characters are dropped — an ESC sequence could end the supervisor's
  // bracketed paste early.
  // eslint-disable-next-line no-control-regex
  const flat = raw.replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return Array.from(flat).slice(0, GUIDANCE_MAX_CHARS).join("");
}

router.post(
  "/:key/condense",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    const body = (req.body ?? {}) as { hostId?: unknown; guidance?: unknown };
    const rawHostId = body.hostId;
    if (rawHostId === undefined || rawHostId === null || rawHostId === "") {
      return res.status(400).json({ error: "hostId is required" });
    }
    const hostId =
      typeof rawHostId === "number" ? rawHostId : parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      return res.status(400).json({ error: "hostId must be a positive integer" });
    }

    const key = String(req.params.key ?? "");
    if (!key || !IDENTITY_KEY_RE.test(key)) {
      return res
        .status(400)
        .json({ error: "identity key must match [a-z0-9_-]{1,64}" });
    }

    const host = await resolveHostById(hostId, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    const guidance = normalizeGuidance(body.guidance);

    return withHostSlot(hostId, async () => {
      let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
      if (!isLocalHostId(hostId)) {
        try {
          conn = await connectOneShot(
            host as unknown as Parameters<typeof connectOneShot>[0],
            SSH_CONNECT_TIMEOUT_MS,
          );
        } catch {
          databaseLogger.warn("identity condense: host unreachable", {
            operation: "identity_condense_unreachable",
            userId,
            hostId,
            key,
          });
          return res.status(504).json({ error: "Host unreachable" });
        }
      }
      try {
        await writeIdentityFile(key, ".compact-requested", guidance, {
          hostId,
          conn,
        });
        databaseLogger.info("identity condense requested", {
          operation: "identity_condense_requested",
          userId,
          hostId,
          key,
          guidanceChars: guidance.length,
        });
        return res.json({ ok: true });
      } catch (err) {
        databaseLogger.error("identity condense: request write failed", undefined, {
          operation: "identity_condense_write_failed",
          userId,
          hostId,
          key,
          error: err instanceof Error ? err.message : String(err),
        });
        return res.status(500).json({ error: "failed to request condense" });
      } finally {
        if (conn) {
          try {
            conn.end();
          } catch {
            /* ignore */
          }
        }
      }
    });
  },
);

router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    return res
      .status(500)
      .json({ error: err?.message ?? "identity-condense route error" });
  },
);

export default router;
