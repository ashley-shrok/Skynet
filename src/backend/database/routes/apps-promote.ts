/**
 * convo-scoped apps: POST /apps/:hostId/:slug/promote-request
 *
 * The user's "Move to sidebar" on a conversation app. This route does NOT
 * move anything: it tells the owning agent, which does the move itself with
 * the app-development skill's promote-app.sh and confirms in the
 * conversation — so the agent always knows what happened to its app.
 *
 * Delivery is the agent-supervisor inbox: a message file dropped into
 * ~/fleet/identities/<owner>/inbox/ wakes a dormant agent and is pasted into
 * its session (inbox-watcher). That works whether or not the conversation is
 * open in any browser. The body is a <task-notification> envelope so the
 * agent can tell it came from the app, not from the user typing.
 *
 *   → 200 { ok: true }
 *   → 400 bad hostId / slug
 *   → 404 host unknown to the caller, app unknown, not a conversation app, or
 *         the caller can't see the owning identity (one shape — no probe leak)
 *   → 503 app registry not yet available
 *   → 504 host unreachable
 *   → 500 inbox write failed
 *
 * Host resolution mirrors apps-archive.ts (resolveHostById on the caller's
 * own hosts; LOCAL bind-mount vs REMOTE one-shot SSH under the per-host
 * semaphore).
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
  APP_SLUG_RE,
  isLocalHostId,
} from "../../claude-session/identity-artifact-reader.js";
import {
  dropIdentityInboxMessage,
  IdentityGoneError,
} from "../../claude-session/per-identity-file.js";
import { getRegistry } from "../../fleet-status/registry-holder.js";
import { canUserSeeIdentity } from "../../fleet-status/identity-gate-holder.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const SSH_CONNECT_TIMEOUT_MS = 3000;

/**
 * One request per app per minute reaches the agent: a repeat inside the
 * window answers ok without dropping another inbox message, so repeated
 * clicks (from any viewer, any browser) can't keep waking the agent.
 */
const PROMOTE_DEDUPE_MS = 60_000;
const recentRequests = new Map<string, number>();

function recentlyRequested(key: string, now: number): boolean {
  for (const [k, at] of recentRequests) if (now - at >= PROMOTE_DEDUPE_MS) recentRequests.delete(k);
  return recentRequests.has(key);
}

export function _resetPromoteDedupeForTesting(): void {
  recentRequests.clear();
}

/**
 * The event the agent receives. The title is the agent's own app.json text,
 * but it is still flattened to one line and stripped of angle brackets so it
 * can't close the envelope early.
 */
export function buildPromoteRequestMessage(slug: string, title: string): string {
  const safeTitle = title.replace(/[<>\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return (
    "<task-notification>\n" +
    "<summary>Move to sidebar — delivered by the app</summary>\n" +
    `<event>[app ${slug}] The user asked to move your conversation app "${safeTitle}" to the sidebar. ` +
    `Run: bash ~/.claude/skills/app-development/promote-app.sh ${slug} — then tell the user in this conversation whether it worked.</event>\n` +
    "</task-notification>"
  );
}

router.post(
  "/:hostId/:slug/promote-request",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    const hostId = Number(req.params.hostId);
    if (!Number.isFinite(hostId) || !Number.isInteger(hostId) || hostId <= 0) {
      return res.status(400).json({ error: "hostId must be a positive integer" });
    }
    const slug = String(req.params.slug);
    if (!slug || !APP_SLUG_RE.test(slug)) {
      return res.status(400).json({ error: "slug must match [a-z0-9-]{1,64}" });
    }

    const host = await resolveHostById(hostId, userId);
    if (!host) {
      return res.status(404).json({ error: "Not found" });
    }

    const registry = getRegistry();
    if (registry === null) {
      return res.status(503).json({ error: "app registry not yet available" });
    }
    const app = registry
      .getAppSnapshot()
      .find((a) => a.hostId === String(hostId) && a.slug === slug);
    const owner = app?.owner ?? null;
    if (!app || owner === null) {
      return res.status(404).json({ error: "Not found" });
    }
    if (!(await canUserSeeIdentity(owner, String(hostId), userId))) {
      return res.status(404).json({ error: "Not found" });
    }

    const dedupeKey = `${hostId}/${slug}`;
    if (recentlyRequested(dedupeKey, Date.now())) {
      return res.json({ ok: true });
    }

    const body = buildPromoteRequestMessage(slug, app.title);

    const doWork = async () => {
      let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
      if (!isLocalHostId(hostId)) {
        try {
          conn = await connectOneShot(
            host as unknown as Parameters<typeof connectOneShot>[0],
            SSH_CONNECT_TIMEOUT_MS,
          );
        } catch {
          return res.status(504).json({ error: "Host unreachable" });
        }
      }
      try {
        const file = await dropIdentityInboxMessage(owner, body, { hostId, conn });
        recentRequests.set(dedupeKey, Date.now());
        databaseLogger.info("app promote requested", {
          operation: "apps_promote_request",
          userId,
          hostId,
          slug,
          owner,
          inboxFile: file,
        });
        return res.json({ ok: true });
      } catch (err) {
        if (err instanceof IdentityGoneError) {
          // Archived since the registry last saw it — nothing to ask.
          return res.status(404).json({ error: "Not found" });
        }
        databaseLogger.error("app promote request: inbox write failed", {
          operation: "apps_promote_request_failed",
          hostId,
          slug,
          owner,
          error: err instanceof Error ? err.message : String(err),
        });
        return res.status(500).json({ error: "failed to send the request to the agent" });
      } finally {
        if (conn) {
          try {
            conn.end();
          } catch {
            /* ignore */
          }
        }
      }
    };
    return isLocalHostId(hostId) ? doWork() : getHostSemaphore(hostId).run(doWork);
  },
);

export default router;
