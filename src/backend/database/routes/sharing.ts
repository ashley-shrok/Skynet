/**
 * /sharing — the "Shared with" control for agents, roles, projects, sidebar
 * apps and scheduled tasks.
 *
 *   GET  /sharing?hostId&kind&slug                     → who it's shared with, everyone on the machine
 *   GET  /sharing/people?hostId                        → everyone on the machine (a new task's list)
 *   POST /sharing/plan { hostId, kind, slug, add?, remove?, shareRoles?, shareRolesFor? }
 *                                                      → what the change reaches
 *   PUT  /sharing      { same }                        → apply it
 *
 * A change is the people ticked (`add`) and unticked (`remove`), applied to
 * the list as it is on disk at that moment — never a whole list built from a
 * stale copy, so two people changing the same list don't undo each other.
 *
 * Who-can-see is organization, not security: machine access stays the only
 * boundary. Anyone who can see a thing may change its list. On a machine with
 * a single person every answer is `{ multiUser: false }` (worked out before
 * any SSH) and nothing is written. A thing's list is answered only to someone
 * it is visible to, and things hidden from the caller are counted in a
 * confirm, never named.
 *
 * Shapes: .planning/shape-sharing-agents-roles-projects.closed.md,
 *         .planning/shape-sharing-apps-tasks.closed.md
 */
import express from "express";
import type { Request, Response } from "express";
import type { Client as SSHClientType } from "ssh2";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import {
  APP_SLUG_RE,
  IDENTITY_KEY_RE,
  IDENTITY_SLUG_RE,
  PROJECT_SLUG_RE,
  listProjects,
} from "../../claude-session/identity-artifact-reader.js";
import { machineLockKey, withScheduledAgentLock } from "./scheduled-agents-write.js";
import { ROLE_NAME_PATTERN } from "./identity-birth-orchestrator.js";
import { getUsernameForUserId } from "../../utils/host-user-counter.js";
import { listMachinePeople } from "../../distributor/machine-people.js";
import { getInstanceWide } from "../../instance-wide/production.js";
import { getSubscriptionRegistry } from "../../fleet-status/subscription-registry.js";
import { enrichForWire } from "./project-list.js";
import {
  ShareError,
  agentVisibleTo,
  ownList,
  planShareChange,
  projectVisibleTo,
  projectsHiding,
  rolesHiding,
  shownAudience,
  type ShareHostState,
  type ShareKind,
  type SharePlan,
  type ShareRef,
} from "../../sharing/sharing-plan.js";
import { readShareHostState, writeShareList } from "../../sharing/sharing-host.js";
import { HttpError, withHost } from "../../sharing/host-conn.js";
import { resolveHostById } from "../../ssh/host-resolver.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const KINDS: readonly ShareKind[] = ["agent", "role", "project", "app", "task"];

const SLUG_RES: Record<ShareKind, RegExp> = {
  agent: IDENTITY_KEY_RE,
  role: ROLE_NAME_PATTERN,
  project: PROJECT_SLUG_RE,
  app: APP_SLUG_RE,
  task: IDENTITY_SLUG_RE,
};

/**
 * One sharing write at a time per machine — keyed on the machine itself
 * (address, port, login), since everyone who added the same box has their
 * own host row for it.
 */
const writeLocks = new Map<string, Promise<unknown>>();
function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  writeLocks.set(key, tail);
  void tail.then(() => {
    if (writeLocks.get(key) === tail) writeLocks.delete(key);
  });
  return run;
}

async function machineKey(hostId: number, userId: string): Promise<string> {
  const host = await resolveHostById(hostId, userId);
  if (!host) throw new HttpError(404, "Host not found");
  return machineLockKey(host, hostId);
}

interface Target {
  hostId: number;
  kind: ShareKind;
  slug: string;
}

function parseHostId(raw: unknown): number | string {
  const hostId = typeof raw === "number" ? raw : /^\d+$/.test(String(raw ?? "")) ? Number(raw) : NaN;
  if (!Number.isInteger(hostId) || hostId <= 0) return "hostId must be a positive integer";
  return hostId;
}

function parseTarget(src: Record<string, unknown>): Target | string {
  const hostId = parseHostId(src.hostId);
  if (typeof hostId === "string") return hostId;
  const kind = src.kind as ShareKind;
  if (!KINDS.includes(kind)) return "kind must be agent, role, project, app or task";
  const slug = typeof src.slug === "string" ? src.slug : "";
  if (!SLUG_RES[kind].test(slug)) return "invalid slug";
  return { hostId, kind, slug };
}

interface Change {
  add: string[];
  remove: string[];
  shareRoles: boolean;
  shareRolesFor?: string[];
}

function parseChange(body: Record<string, unknown>): Change | string {
  const names = (v: unknown, field: string): string[] | string => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return `${field} must be a list of usernames`;
    return v as string[];
  };
  const add = names(body.add, "add");
  const remove = names(body.remove, "remove");
  const fix = body.shareRolesFor === undefined ? undefined : names(body.shareRolesFor, "shareRolesFor");
  if (typeof add === "string") return add;
  if (typeof remove === "string") return remove;
  if (typeof fix === "string") return fix;
  return { add, remove, shareRoles: body.shareRoles === true, ...(fix ? { shareRolesFor: fix } : {}) };
}

/**
 * Roles kept on every machine. When that list can't be read, every role is
 * treated as one (fails closed: nothing an admin keeps in step gets written).
 */
async function instanceWideRoleNames(): Promise<Set<string> | "unknown"> {
  try {
    return new Set((await getInstanceWide()?.listNames("role")) ?? []);
  } catch (err) {
    databaseLogger.warn("sharing: couldn't list roles kept on every machine — treating all roles as locked", {
      operation: "sharing_instance_wide_unknown",
      error: err instanceof Error ? err.message : String(err),
    });
    return "unknown";
  }
}

function visibleTo(state: ShareHostState, t: Target, person: string): boolean {
  const roles = new Map(state.roles.map((r) => [r.name, r]));
  if (t.kind === "agent") {
    const a = state.agents.find((x) => x.name === t.slug);
    return a !== undefined && agentVisibleTo(a, roles, person);
  }
  if (t.kind === "role") {
    const r = roles.get(t.slug);
    return r !== undefined && (r.users === null || r.users.includes(person));
  }
  if (t.kind === "app" || t.kind === "task") {
    const thing = t.kind === "app" ? state.apps.find((a) => a.name === t.slug) : state.tasks.find((x) => x.name === t.slug);
    return thing !== undefined && (thing.users === null || thing.users.includes(person));
  }
  return projectVisibleTo(state.projects, t.slug, person);
}

/** The control's payload for one thing, as `you` sees it. */
function describe(state: ShareHostState, t: Target, you: string) {
  const roles = new Map(state.roles.map((r) => [r.name, r]));
  const users = ownList(state, t.kind, t.slug);
  const ticked = shownAudience(state, t.kind, t.slug);
  const former = ticked.filter((u) => !state.people.includes(u));
  const hiddenBy: Record<string, Array<{ kind: "role" | "project"; name: string; label: string; fixable: boolean }>> = {};
  for (const person of state.people) {
    if (t.kind === "agent" || t.kind === "task") {
      // A task's conversations take on its roles, so its roles hide them.
      const holder = t.kind === "agent" ? state.agents.find((a) => a.name === t.slug)! : state.tasks.find((x) => x.name === t.slug)!;
      const hiding = rolesHiding(holder, roles, person);
      if (hiding.length > 0) {
        hiddenBy[person] = hiding.map((r) => ({ kind: "role", name: r.name, label: r.label, fixable: !r.instanceWide }));
      }
    } else if (t.kind === "project") {
      const hiding = projectsHiding(state.projects, t.slug, person);
      if (hiding.length > 0) {
        hiddenBy[person] = hiding.map((p) => ({ kind: "project", name: p.slug, label: p.label, fixable: false }));
      }
    }
  }
  return {
    multiUser: true as const,
    you,
    people: state.people,
    /** Its own list; null = it has none. */
    users,
    /** Who shows ticked: its own list, or who can see it without one. */
    ticked,
    former,
    hiddenBy,
    instanceWide: t.kind === "role" ? roles.get(t.slug)?.instanceWide === true : false,
  };
}

interface Loaded {
  state: ShareHostState;
  you: string;
}

/** Everyone on the machine — no SSH; fewer than two means nothing to show. */
async function peopleOn(hostId: number): Promise<string[]> {
  return ((await listMachinePeople(hostId)) ?? []).map((p) => p.username);
}

/** Read everything for `t`. Throws 404 when the thing isn't there or the caller can't see it. */
async function load(conn: SSHClientType | null, t: Target, userId: string, people: string[]): Promise<Loaded> {
  const you = await getUsernameForUserId(userId);
  if (!you) throw new HttpError(404, "Not found");
  const iw = await instanceWideRoleNames();
  if (iw === "unknown" && t.kind === "role") throw new HttpError(503, "Try again in a moment");
  const state = await readShareHostState(conn, people, iw === "unknown" ? "all" : iw, t);
  if (!visibleTo(state, t, you)) throw new HttpError(404, "Not found");
  return { state, you };
}

/**
 * What the confirm needs — labels only, and only of things `you` can see:
 * anything inside a project (or holding a role) that is hidden from the
 * person making the change is counted, never named.
 */
function planSummary(plan: SharePlan, state: ShareHostState, you: string) {
  const roles = new Map(state.roles.map((r) => [r.name, r]));
  const agents = new Map(state.agents.map((a) => [a.name, a]));
  const seesAgent = (r: ShareRef) => {
    const a = agents.get(r.name);
    return a !== undefined && agentVisibleTo(a, roles, you);
  };
  const seesRole = (r: ShareRef) => {
    const role = roles.get(r.name);
    return role !== undefined && (role.users === null || role.users.includes(you));
  };
  const seesProject = (r: ShareRef) => projectVisibleTo(state.projects, r.name, you);
  const split = (refs: ShareRef[], sees: (r: ShareRef) => boolean) => {
    const shown = refs.filter(sees);
    return { labels: shown.map((r) => r.label), hidden: refs.length - shown.length };
  };
  const sp = split(plan.alsoShared.projects, seesProject);
  const sa = split(plan.alsoShared.agents, seesAgent);
  const sr = split(plan.alsoShared.roles, seesRole);
  const up = split(plan.alsoUnshared.projects, seesProject);
  const ua = split(plan.alsoUnshared.agents, seesAgent);
  const gone = split(plan.disappearing, seesAgent);
  const kept = plan.keptShared.filter((k) => seesAgent(k.agent));
  return {
    added: plan.added,
    removed: plan.removed,
    rolesToShare: plan.rolesToShare,
    alsoShared: { projects: sp.labels, agents: sa.labels, roles: sr.labels, hidden: sp.hidden + sa.hidden + sr.hidden },
    alsoUnshared: { projects: up.labels, agents: ua.labels, hidden: up.hidden + ua.hidden },
    keptShared: kept.map((k) => ({ agent: k.agent.label, people: k.people })),
    keptHidden: plan.keptShared.length - kept.length,
    disappearing: gone.labels,
    disappearingHidden: gone.hidden,
  };
}

function sendError(res: Response, err: unknown, ctx: Record<string, unknown>): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ShareError) {
    const status = err.code === "not_found" ? 404 : 400;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  databaseLogger.error("sharing: request failed", {
    operation: "sharing_failed",
    ...ctx,
    error: err instanceof Error ? err.message : String(err),
  });
  res.status(500).json({ error: "sharing failed" });
}

router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const t = parseTarget(req.query as Record<string, unknown>);
  if (typeof t === "string") {
    res.status(400).json({ error: t });
    return;
  }
  try {
    const people = await peopleOn(t.hostId);
    if (people.length < 2) {
      // Still only for the caller's own hosts.
      if (!(await resolveHostById(t.hostId, userId))) throw new HttpError(404, "Host not found");
      res.json({ multiUser: false });
      return;
    }
    const out = await withHost(t.hostId, userId, async (conn) => {
      const loaded = await load(conn, t, userId, people);
      return describe(loaded.state, t, loaded.you);
    });
    res.json(out);
  } catch (err) {
    sendError(res, err, { userId, ...t });
  }
});

router.get("/people", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const hostId = parseHostId((req.query as Record<string, unknown>).hostId);
  if (typeof hostId === "string") {
    res.status(400).json({ error: hostId });
    return;
  }
  try {
    if (!(await resolveHostById(hostId, userId))) throw new HttpError(404, "Host not found");
    const people = await peopleOn(hostId);
    const you = await getUsernameForUserId(userId);
    if (people.length < 2 || !you) {
      res.json({ multiUser: false });
      return;
    }
    res.json({ multiUser: true, you, people });
  } catch (err) {
    sendError(res, err, { userId, hostId, op: "people" });
  }
});

router.post("/plan", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const t = parseTarget(body);
  const change = parseChange(body);
  if (typeof t === "string" || typeof change === "string") {
    res.status(400).json({ error: typeof t === "string" ? t : change });
    return;
  }
  try {
    const people = await peopleOn(t.hostId);
    if (people.length < 2) throw new HttpError(409, "Only one person uses this machine");
    const out = await withHost(t.hostId, userId, async (conn) => {
      const loaded = await load(conn, t, userId, people);
      return planSummary(planShareChange(loaded.state, t.kind, t.slug, change, change), loaded.state, loaded.you);
    });
    res.json(out);
  } catch (err) {
    sendError(res, err, { userId, ...t, op: "plan" });
  }
});

router.put("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const t = parseTarget(body);
  const change = parseChange(body);
  if (typeof t === "string" || typeof change === "string") {
    res.status(400).json({ error: typeof t === "string" ? t : change });
    return;
  }
  try {
    const people = await peopleOn(t.hostId);
    if (people.length < 2) throw new HttpError(409, "Only one person uses this machine");
    const key = await machineKey(t.hostId, userId);
    // A task's own edits serialize on it too, so a Save never lands between
    // this re-read and this write.
    const taskLock = <T,>(fn: () => Promise<T>): Promise<T> =>
      t.kind === "task" ? withScheduledAgentLock(key, t.slug, fn) : fn();
    const out = await withWriteLock(key, () => taskLock(() =>
      withHost(t.hostId, userId, async (conn) => {
        const loaded = await load(conn, t, userId, people);
        const plan = planShareChange(loaded.state, t.kind, t.slug, change, change);
        const written: string[] = [];
        try {
          for (const w of plan.writes) {
            await writeShareList(conn, w);
            written.push(`${w.kind}:${w.slug}`);
          }
        } catch (err) {
          databaseLogger.error("sharing: write failed part-way", {
            operation: "sharing_write_partial",
            userId,
            ...t,
            written,
            planned: plan.writes.length,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
        databaseLogger.info("sharing: list changed", {
          operation: "sharing_changed",
          userId,
          ...t,
          added: plan.added.length,
          removed: plan.removed.length,
          writes: written,
          shareRoles: change.shareRoles,
          fixRoles: change.shareRolesFor?.length ?? 0,
        });
        if (plan.writes.some((w) => w.kind === "project")) {
          try {
            const registry = getSubscriptionRegistry();
            if (registry) {
              const host = await resolveHostById(t.hostId, userId);
              registry.publishProjectListChanged(
                String(t.hostId),
                enrichForWire(await listProjects(conn), t.hostId, host?.name ?? String(t.hostId)),
              );
            }
          } catch (publishErr) {
            databaseLogger.warn("sharing: project-list publish failed", {
              operation: "sharing_project_publish_failed",
              ...t,
              error: publishErr instanceof Error ? publishErr.message : String(publishErr),
            });
          }
        }
        const after = await load(conn, t, userId, people).catch((err: unknown) => {
          if (err instanceof HttpError && err.status === 404) return "gone" as const;
          throw err;
        });
        if (after === "gone") return { gone: true as const };
        return describe(after.state, t, after.you);
      })),
    );
    res.json(out);
  } catch (err) {
    sendError(res, err, { userId, ...t, op: "apply" });
  }
});

export default router;
