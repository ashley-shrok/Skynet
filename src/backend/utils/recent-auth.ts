import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../database/db/index.js";
import { sessions, users } from "../database/db/schema.js";
import type { AuthenticatedRequest } from "../../types/index.js";
import { authLogger } from "./logger.js";

// "Confirm it's you": actions that would let whoever holds a signed-in
// browser keep access or widen it need the session to have proved who it is
// (password + two-step code) within the last few minutes. A fresh sign-in
// counts; POST /users/confirm-identity re-confirms later in the session.
// Access keys and the server's own sessionless tokens can never confirm, so
// they can never do these actions.

export const RECENT_AUTH_WINDOW_MS = 10 * 60 * 1000;

export const REAUTH_REQUIRED = "REAUTH_REQUIRED";
export const REAUTH_UNAVAILABLE = "REAUTH_UNAVAILABLE";

export function isRecentlyConfirmed(
  confirmedAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!confirmedAt) return false;
  const at = new Date(confirmedAt).getTime();
  if (!Number.isFinite(at)) return false;
  return now - at >= -60_000 && now - at <= RECENT_AUTH_WINDOW_MS;
}

function presentedToken(req: Request): string | undefined {
  const cookie = (req as AuthenticatedRequest).cookies?.jwt as
    | string
    | undefined;
  if (cookie) return cookie;
  const header = req.headers["authorization"];
  return header?.startsWith("Bearer ") ? header.split(" ")[1] : undefined;
}

/**
 * Mount AFTER the route's sign-in / admin check (it relies on the userId and
 * sessionId those set). Responds 403 `REAUTH_REQUIRED` when the session
 * hasn't confirmed recently, and 403 `REAUTH_UNAVAILABLE` when the caller is
 * something that can't confirm at all (an access key, a sessionless token).
 */
export async function requireRecentAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.userId;
  const sessionId = authReq.sessionId;
  const viaKey = presentedToken(req)?.startsWith("tmx_") ?? false;

  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  if (viaKey || !sessionId) {
    authLogger.warn("Sensitive action refused: caller can't confirm identity", {
      operation: "reauth_unavailable",
      userId,
      endpoint: `${req.method} ${req.originalUrl}`,
      reason: viaKey ? "api_key" : "no_session",
    });
    res.status(403).json({
      error:
        "This action needs a signed-in browser session that has confirmed it's you. Access keys can't do it.",
      code: REAUTH_UNAVAILABLE,
    });
    return;
  }

  try {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (session && session.userId === userId && isRecentlyConfirmed(session.confirmedAt)) {
      next();
      return;
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    authLogger.info("Sensitive action needs identity confirmation", {
      operation: "reauth_required",
      userId,
      sessionId,
      endpoint: `${req.method} ${req.originalUrl}`,
      confirmedAt: session?.confirmedAt ?? null,
    });
    res.status(403).json({
      error: "Confirm it's you to continue.",
      code: REAUTH_REQUIRED,
      totpRequired: !!user?.totpEnabled,
    });
  } catch (error) {
    authLogger.error("Recent-auth check failed", error, {
      operation: "reauth_check_failed",
      userId,
      sessionId,
    });
    res.status(500).json({ error: "Could not check identity confirmation" });
  }
}

/**
 * For signing out one session: signing out the session you're using needs
 * nothing; signing out any other one needs a recent confirmation (otherwise a
 * stolen sign-in could sign the owner out device by device).
 */
export function requireRecentAuthUnlessOwnSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void | Promise<void> {
  const target = req.params.sessionId;
  const current = (req as AuthenticatedRequest).sessionId;
  if (current && target === current) {
    next();
    return;
  }
  return requireRecentAuth(req, res, next);
}
