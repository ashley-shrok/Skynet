/**
 * agent-services/user-secrets/routes.ts — managing per-user service secrets.
 * Mounted on the /users router.
 *
 * Every route is write-only: responses say whether a secret is set and when,
 * never what it is.
 *
 *   GET    /users/me/service-secrets                   your user-managed secrets
 *   PUT    /users/me/service-secrets/:service/:name    { value }
 *   DELETE /users/me/service-secrets/:service/:name
 *
 *   GET    /users/:id/service-secrets                  (admin) all of a user's secrets
 *   PUT    /users/:id/service-secrets/:service/:name   (admin) { value }
 *   DELETE /users/:id/service-secrets/:service/:name   (admin)
 *
 * Admin-managed secrets (managedBy: "admin", e.g. a company Zoho key) are
 * absent from the /me routes entirely: they are not listed, and PUT/DELETE
 * on one returns the same 404 as a secret that doesn't exist.
 */

import type { RequestHandler, Response, Router } from "express";
import { eq } from "drizzle-orm";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { db } from "../../database/db/index.js";
import { users } from "../../database/db/schema.js";
import { authLogger } from "../../utils/logger.js";
import { AGENT_SERVICES } from "../registry.js";
import { declaredUserSecrets, type DeclaredUserSecret } from "./declared.js";
import {
  clearUserSecret,
  listUserSecretStatus,
  setUserSecret,
  type UserSecretStatus,
} from "./store.js";

/** Longest value accepted. Generous for tokens; stops accidental pastes of whole files. */
export const MAX_SECRET_LENGTH = 8192;

export interface ServiceSecretRouteDeps {
  declared(): DeclaredUserSecret[];
  getUser(userId: string): Promise<{ id: string; isAdmin: boolean } | null>;
  listStatus(userId: string): Promise<UserSecretStatus[]>;
  set(
    userId: string,
    service: string,
    name: string,
    value: string,
    updatedBy: string,
  ): Promise<void>;
  clear(userId: string, service: string, name: string): Promise<boolean>;
}

const productionDeps: ServiceSecretRouteDeps = {
  declared: () => declaredUserSecrets(AGENT_SERVICES),
  async getUser(userId) {
    const rows = await db
      .select({ id: users.id, isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0] ?? null;
  },
  listStatus: listUserSecretStatus,
  set: setUserSecret,
  clear: clearUserSecret,
};

export function registerServiceSecretRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
  deps: ServiceSecretRouteDeps = productionDeps,
): void {
  const callerId = (req: unknown) => (req as AuthenticatedRequest).userId;

  async function listFor(
    userId: string,
    visible: (d: DeclaredUserSecret) => boolean,
  ) {
    const status = await deps.listStatus(userId);
    return deps
      .declared()
      .filter(visible)
      .map((d) => {
        const s = status.find(
          (x) => x.service === d.service && x.name === d.name,
        );
        return { ...d, isSet: Boolean(s), updatedAt: s?.updatedAt ?? null };
      });
  }

  function findDeclared(
    service: string,
    name: string,
    visible: (d: DeclaredUserSecret) => boolean,
  ) {
    return (
      deps
        .declared()
        .find((d) => d.service === service && d.name === name && visible(d)) ??
      null
    );
  }

  function readValue(body: unknown): string | null {
    const value = (body as { value?: unknown } | undefined)?.value;
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= MAX_SECRET_LENGTH
      ? trimmed
      : null;
  }

  const fail = (res: Response, err: unknown, what: string) => {
    authLogger.error(`Failed to ${what}`, err);
    res.status(500).json({ error: `Failed to ${what}` });
  };

  const userManaged = (d: DeclaredUserSecret) => d.managedBy === "user";
  const any = () => true;

  // Shared PUT/DELETE body: `targetId` is whose secret, `actorId` who is
  // changing it, `visible` which declarations this caller may touch.
  async function put(
    req: unknown,
    res: Response,
    targetId: string,
    actorId: string,
    visible: (d: DeclaredUserSecret) => boolean,
  ) {
    const { service, name } = (req as { params: Record<string, string> })
      .params;
    if (!findDeclared(service, name, visible)) {
      return res.status(404).json({ error: "No such service secret" });
    }
    const value = readValue((req as { body?: unknown }).body);
    if (value === null) {
      return res
        .status(400)
        .json({
          error: `value must be a non-empty string of at most ${MAX_SECRET_LENGTH} characters`,
        });
    }
    await deps.set(targetId, service, name, value, actorId);
    authLogger.info("agent-service user secret set", {
      operation: "agent_service_user_secret_set",
      userId: targetId,
      actorId,
      service,
      name,
    });
    res.json({ ok: true });
  }

  async function del(
    req: unknown,
    res: Response,
    targetId: string,
    actorId: string,
    visible: (d: DeclaredUserSecret) => boolean,
  ) {
    const { service, name } = (req as { params: Record<string, string> })
      .params;
    if (!findDeclared(service, name, visible)) {
      return res.status(404).json({ error: "No such service secret" });
    }
    const removed = await deps.clear(targetId, service, name);
    authLogger.info("agent-service user secret cleared", {
      operation: "agent_service_user_secret_clear",
      userId: targetId,
      actorId,
      service,
      name,
      removed,
    });
    res.json({ ok: true, removed });
  }

  /** Resolves the admin route's target user, or answers 403/404 and returns null. */
  async function adminTarget(
    req: unknown,
    res: Response,
  ): Promise<string | null> {
    const caller = await deps.getUser(callerId(req));
    if (!caller?.isAdmin) {
      res.status(403).json({ error: "Not authorized" });
      return null;
    }
    const targetId = (req as { params: Record<string, string> }).params.id;
    if (!(await deps.getUser(targetId))) {
      res.status(404).json({ error: "User not found" });
      return null;
    }
    return targetId;
  }

  // /me routes first so "me" is never taken for an :id.

  /**
   * @openapi
   * /users/me/service-secrets:
   *   get:
   *     summary: List the caller's user-managed agent-service secrets
   *     description: Which secrets the caller can set for agent services, and whether each is set. Values are never returned. Admin-managed secrets are not listed.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: The caller's user-managed secrets.
   */
  router.get("/me/service-secrets", authenticateJWT, async (req, res) => {
    try {
      res.json({ secrets: await listFor(callerId(req), userManaged) });
    } catch (err) {
      fail(res, err, "list service secrets");
    }
  });

  /**
   * @openapi
   * /users/me/service-secrets/{service}/{name}:
   *   put:
   *     summary: Set one of the caller's user-managed agent-service secrets
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Saved.
   *       400:
   *         description: value missing, empty or too long.
   *       404:
   *         description: No such user-managed secret.
   *   delete:
   *     summary: Clear one of the caller's user-managed agent-service secrets
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Cleared (removed is false if nothing was set).
   *       404:
   *         description: No such user-managed secret.
   */
  router.put(
    "/me/service-secrets/:service/:name",
    authenticateJWT,
    async (req, res) => {
      try {
        await put(req, res, callerId(req), callerId(req), userManaged);
      } catch (err) {
        fail(res, err, "save service secret");
      }
    },
  );

  router.delete(
    "/me/service-secrets/:service/:name",
    authenticateJWT,
    async (req, res) => {
      try {
        await del(req, res, callerId(req), callerId(req), userManaged);
      } catch (err) {
        fail(res, err, "clear service secret");
      }
    },
  );

  /**
   * @openapi
   * /users/{id}/service-secrets:
   *   get:
   *     summary: List a user's agent-service secrets (admin only)
   *     description: Every declared per-user secret, user- and admin-managed, with whether it is set. Values are never returned.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: The user's secrets.
   *       403:
   *         description: Not authorized.
   *       404:
   *         description: User not found.
   */
  router.get("/:id/service-secrets", authenticateJWT, async (req, res) => {
    try {
      const targetId = await adminTarget(req, res);
      if (targetId === null) return;
      res.json({ secrets: await listFor(targetId, any) });
    } catch (err) {
      fail(res, err, "list service secrets");
    }
  });

  /**
   * @openapi
   * /users/{id}/service-secrets/{service}/{name}:
   *   put:
   *     summary: Set a user's agent-service secret (admin only)
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Saved.
   *       400:
   *         description: value missing, empty or too long.
   *       403:
   *         description: Not authorized.
   *       404:
   *         description: User or secret not found.
   *   delete:
   *     summary: Clear a user's agent-service secret (admin only)
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Cleared.
   *       403:
   *         description: Not authorized.
   *       404:
   *         description: User or secret not found.
   */
  router.put(
    "/:id/service-secrets/:service/:name",
    authenticateJWT,
    async (req, res) => {
      try {
        const targetId = await adminTarget(req, res);
        if (targetId === null) return;
        await put(req, res, targetId, callerId(req), any);
      } catch (err) {
        fail(res, err, "save service secret");
      }
    },
  );

  router.delete(
    "/:id/service-secrets/:service/:name",
    authenticateJWT,
    async (req, res) => {
      try {
        const targetId = await adminTarget(req, res);
        if (targetId === null) return;
        await del(req, res, targetId, callerId(req), any);
      } catch (err) {
        fail(res, err, "clear service secret");
      }
    },
  );
}
