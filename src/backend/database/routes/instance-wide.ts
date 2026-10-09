/**
 * /instance-wide router — list instance-wide skills and roles with their sync
 * status, promote a host's skill/role to instance-wide, remove one, and nudge
 * a sync. Editing an instance-wide skill's files goes through the skills
 * editor with hostId=0 (see instance-skill-files.ts).
 *
 * Admin-only for every mutation; anyone signed in may list.
 * Shape: .planning/shapes/shape-instance-wide-roles-and-skills.md
 */
import express from "express";
import type { Request, Response } from "express";
import yaml from "js-yaml";
import { eq } from "drizzle-orm";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { systemLogger } from "../../utils/logger.js";
import { isItemKind, isValidItemName, type ItemKind } from "../../instance-wide/model.js";
import { PromoteError } from "../../instance-wide/engine.js";
import { callerIsAdmin } from "../../instance-wide/admin.js";
import { getInstanceWide, machineForHostRow } from "../../instance-wide/production.js";
import { isIdentityVisibleToUser } from "../../fleet-status/identity-visibility-gate.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

async function callerUsername(userId: string): Promise<string | null> {
  const rows = await db.select().from(users).where(eq(users.id, userId));
  return rows[0]?.username ?? null;
}

function frontmatterOf(text: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  try {
    const parsed = yaml.load(m[1]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseTarget(body: Record<string, unknown>):
  | { kind: ItemKind; name: string }
  | null {
  const { kind, name } = body;
  if (!isItemKind(kind) || !isValidItemName(name)) return null;
  return { kind, name };
}

function sendPromoteError(res: Response, err: unknown): void {
  if (err instanceof PromoteError) {
    const status =
      err.code === "not_found" ? 404 : err.code === "exists" ? 409 : err.code === "too_large" ? 413 : 502;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  systemLogger.error("instance-wide route failed", {
    operation: "instance_wide_route_error",
    error: err instanceof Error ? err.message : "unknown",
  });
  if (!res.headersSent) res.status(500).json({ error: "internal" });
}

// ---------------------------------------------------------------------------
// GET /instance-wide/items?kind=skill|role
// ---------------------------------------------------------------------------
router.get("/items", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const engine = getInstanceWide();
  if (!engine) {
    res.json({ isAdmin: await callerIsAdmin(userId), items: [] });
    return;
  }
  try {
    const kindFilter = isItemKind(req.query.kind) ? req.query.kind : null;
    const isAdmin = await callerIsAdmin(userId);
    const username = await callerUsername(userId);
    const items = [];
    for (const st of await engine.status()) {
      if (kindFilter && st.kind !== kindFilter) continue;
      const mainFile = st.kind === "skill" ? "SKILL.md" : `${st.name}.md`;
      let fm: Record<string, unknown> = {};
      try {
        fm = frontmatterOf((await engine.readMasterFile(st.kind, st.name, mainFile)).toString("utf-8"));
      } catch {
        fm = {};
      }
      if (st.kind === "role" && !isAdmin) {
        const visible = isIdentityVisibleToUser(
          null,
          { users: Array.isArray(fm.users) ? fm.users.map(String) : undefined },
          username,
        );
        if (!visible) continue;
      }
      const description =
        typeof fm.description === "string" ? fm.description.replace(/\s+/g, " ").trim() : undefined;
      items.push({
        ...st,
        description,
        hostCount: await engine.hostCount(st.kind, st.name),
      });
    }
    res.json({ isAdmin, items });
  } catch (err) {
    sendPromoteError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /instance-wide/promote/preview  { kind, name, hostId }
// POST /instance-wide/promote          { kind, name, hostId }
// ---------------------------------------------------------------------------
async function resolvePromoteSource(req: Request, res: Response) {
  const userId = (req as AuthenticatedRequest).userId;
  if (!(await callerIsAdmin(userId))) {
    res.status(403).json({ error: "only admins can make things instance-wide" });
    return null;
  }
  const engine = getInstanceWide();
  if (!engine) {
    res.status(503).json({ error: "instance-wide sync is not running" });
    return null;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const target = parseTarget(body);
  const hostId = typeof body.hostId === "number" ? body.hostId : NaN;
  if (!target || !Number.isInteger(hostId) || hostId <= 0) {
    res.status(400).json({ error: "kind, name and hostId are required" });
    return null;
  }
  if (!(await resolveHostById(hostId, userId))) {
    res.status(404).json({ error: "Host not found" });
    return null;
  }
  const machine = await machineForHostRow(hostId);
  if (!machine) {
    res.status(400).json({
      error: "this host does not receive the standard agent files, so it can't be a source",
    });
    return null;
  }
  return { engine, machine, ...target };
}

router.post("/promote/preview", authenticateJWT, async (req: Request, res: Response) => {
  const src = await resolvePromoteSource(req, res);
  if (!src) return;
  try {
    if (await src.engine.isInstanceWide(src.kind, src.name)) {
      res.status(409).json({ error: `${src.kind} "${src.name}" is already instance-wide`, code: "exists" });
      return;
    }
    const size = await src.engine.inspectSource(src.kind, src.name, src.machine);
    const { clashes, unreachable } = await src.engine.findClashes(
      src.kind,
      src.name,
      src.machine.machineId,
    );
    res.json({ ...size, clashes, unreachable, sourceHostName: src.machine.hostName });
  } catch (err) {
    sendPromoteError(res, err);
  }
});

router.post("/promote", authenticateJWT, async (req: Request, res: Response) => {
  const src = await resolvePromoteSource(req, res);
  if (!src) return;
  try {
    const result = await src.engine.promote(src.kind, src.name, src.machine);
    res.json(result);
  } catch (err) {
    sendPromoteError(res, err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /instance-wide/items  { kind, name }
// ---------------------------------------------------------------------------
router.delete("/items", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  if (!(await callerIsAdmin(userId))) {
    res.status(403).json({ error: "only admins can remove instance-wide items" });
    return;
  }
  const engine = getInstanceWide();
  const target = parseTarget((req.body ?? {}) as Record<string, unknown>);
  if (!engine || !target) {
    res.status(engine ? 400 : 503).json({ error: engine ? "kind and name are required" : "not running" });
    return;
  }
  try {
    res.json(await engine.removeItem(target.kind, target.name));
  } catch (err) {
    sendPromoteError(res, err);
  }
});

// ---------------------------------------------------------------------------
// POST /instance-wide/sync — run a sync pass soon (admin)
// ---------------------------------------------------------------------------
router.post("/sync", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  if (!(await callerIsAdmin(userId))) {
    res.status(403).json({ error: "admin only" });
    return;
  }
  getInstanceWide()?.requestSync();
  res.json({ ok: true });
});

export default router;
