/**
 * sharing-plan.ts — what a change to a "Shared with" list writes, and what it
 * reaches beyond the thing itself (for the confirm that names it).
 *
 * Pure: takes one machine's people, agents, roles and projects (with their
 * `users:` lists) and a requested list for one thing, and returns every
 * `users:` write plus the names the confirm has to show. The visibility rules
 * it serves are the gates' own (identity-visibility-gate.ts,
 * project-visibility-gate.ts): an absent or empty list is no gate; an agent
 * shows only when its own list and every role's list let the person in; a
 * project only when every project up its chain does.
 *
 * Shape: .planning/shape-sharing-agents-roles-projects.md
 */

export type ShareKind = "agent" | "role" | "project";

export interface ShareAgent {
  name: string;
  label: string;
  roles: string[];
  project: string | null;
  users: string[] | null;
}

export interface ShareRole {
  name: string;
  label: string;
  users: string[] | null;
  /** Kept on every machine — only admins change it, never written here. */
  instanceWide: boolean;
}

export interface ShareProject {
  slug: string;
  label: string;
  parent: string | null;
  users: string[] | null;
}

export interface ShareHostState {
  /** Everyone with access to the machine now. */
  people: string[];
  agents: ShareAgent[];
  roles: ShareRole[];
  projects: ShareProject[];
}

export interface ShareWrite {
  kind: ShareKind;
  /** Agent name, role name or project slug. */
  slug: string;
  users: string[];
}

/** A thing a change reaches: its name (agent/role name, project slug) and label. */
export interface ShareRef {
  name: string;
  label: string;
}

export interface SharePlan {
  writes: ShareWrite[];
  /** Agent: roles hiding it from someone being added (offered, written only with shareRoles). */
  rolesToShare: Array<{ name: string; label: string; people: string[] }>;
  /** Project share: everything inside it that also gets the new people. */
  alsoShared: { projects: ShareRef[]; agents: ShareRef[]; roles: ShareRef[] };
  /** Project unshare: everything inside it the people lose. */
  alsoUnshared: { projects: ShareRef[]; agents: ShareRef[] };
  /** Project unshare: agents left shared with someone because nobody else is on their list. */
  keptShared: Array<{ agent: ShareRef; people: string[] }>;
  /** Role unshare: agents that disappear for the people taken off. */
  disappearing: ShareRef[];
  added: string[];
  removed: string[];
}

export class ShareError extends Error {
  constructor(
    readonly code: "not_found" | "empty" | "unknown_person" | "instance_wide",
    message: string,
  ) {
    super(message);
  }
}

const hasList = (u: string[] | null | undefined): u is string[] =>
  Array.isArray(u) && u.length > 0;

/** Who a list lets in: its people, or everyone on the machine when there's no list. */
export function resolvedAudience(users: string[] | null, people: string[]): string[] {
  return hasList(users) ? users : people;
}

function passes(users: string[] | null, person: string): boolean {
  return !hasList(users) || users.includes(person);
}

/** Roles (by name) of `agent` whose list keeps `person` out. */
export function rolesHiding(
  agent: ShareAgent,
  roles: ReadonlyMap<string, ShareRole>,
  person: string,
): ShareRole[] {
  const out: ShareRole[] = [];
  for (const r of agent.roles) {
    const role = roles.get(r);
    if (role && !passes(role.users, person)) out.push(role);
  }
  return out;
}

export function agentVisibleTo(
  agent: ShareAgent,
  roles: ReadonlyMap<string, ShareRole>,
  person: string,
): boolean {
  return passes(agent.users, person) && rolesHiding(agent, roles, person).length === 0;
}

/** The project and every project beneath it (loop-safe), the project first. */
export function projectSubtree(projects: readonly ShareProject[], slug: string): string[] {
  const children = new Map<string, string[]>();
  for (const p of projects) {
    if (p.parent === null) continue;
    const list = children.get(p.parent) ?? [];
    list.push(p.slug);
    children.set(p.parent, list);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (s: string) => {
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
    for (const c of children.get(s) ?? []) walk(c);
  };
  walk(slug);
  return out;
}

/**
 * `slug` and the projects above it, nearest first, cut the way the sidebar
 * draws a hand-edited loop (just after the first project reached twice) —
 * the same chain as project-visibility-gate.ts.
 */
export function projectChain(projects: readonly ShareProject[], slug: string): ShareProject[] {
  const bySlug = new Map(projects.map((p) => [p.slug, p]));
  const chain: ShareProject[] = [];
  const indexOf = new Map<string, number>();
  let node = bySlug.get(slug);
  while (node !== undefined) {
    const seenAt = indexOf.get(node.slug);
    if (seenAt !== undefined) {
      chain.length = seenAt + 1;
      break;
    }
    indexOf.set(node.slug, chain.length);
    chain.push(node);
    node = node.parent === null ? undefined : bySlug.get(node.parent);
  }
  return chain;
}

/** The projects above `slug` whose list keeps `person` out. */
export function projectsHiding(projects: readonly ShareProject[], slug: string, person: string): ShareProject[] {
  return projectChain(projects, slug)
    .slice(1)
    .filter((p) => !passes(p.users, person));
}

/** `slug` and every project above it let `person` in (the sidebar's rule). */
export function projectVisibleTo(projects: readonly ShareProject[], slug: string, person: string): boolean {
  const chain = projectChain(projects, slug);
  return chain.length > 0 && chain.every((p) => passes(p.users, person));
}

/**
 * Who the control shows ticked: the thing's own list; for a project with no
 * list of its own, whoever the projects above it let in; otherwise everyone
 * on the machine.
 */
export function shownAudience(state: ShareHostState, kind: ShareKind, slug: string): string[] {
  if (kind === "agent") return resolvedAudience(state.agents.find((a) => a.name === slug)?.users ?? null, state.people);
  if (kind === "role") return resolvedAudience(state.roles.find((r) => r.name === slug)?.users ?? null, state.people);
  const chain = projectChain(state.projects, slug);
  const own = chain[0]?.users ?? null;
  if (hasList(own)) return own;
  let audience: string[] | null = null;
  for (const p of chain) {
    if (!hasList(p.users)) continue;
    audience = audience === null ? [...p.users] : audience.filter((u) => p.users!.includes(u));
  }
  return audience ?? state.people;
}

function dedupe(list: readonly string[]): string[] {
  return [...new Set(list)];
}

/** Keep `prev` order, drop `remove`, append `add` not already there. */
function editList(prev: readonly string[], add: readonly string[], remove: readonly string[]): string[] {
  const kept = prev.filter((u) => !remove.includes(u));
  for (const u of add) if (!kept.includes(u)) kept.push(u);
  return kept;
}

/**
 * The plan for ticking (`add`) and unticking (`remove`) people on one thing,
 * applied to its list as it is now — so two people changing the same list
 * never undo each other's ticks. Throws ShareError for a thing that isn't
 * there, a change that would empty the list, adding someone not on the
 * machine, or a role kept on every machine.
 */
export function planShareChange(
  state: ShareHostState,
  kind: ShareKind,
  slug: string,
  change: { add?: readonly string[]; remove?: readonly string[] },
  opts: {
    /** Agent: also share the roles hiding it from the people being added. */
    shareRoles?: boolean;
    /** Agent: share the roles hiding it from these people already on its list. */
    shareRolesFor?: readonly string[];
  } = {},
): SharePlan {
  const rolesByName = new Map(state.roles.map((r) => [r.name, r]));
  const agentsByName = new Map(state.agents.map((a) => [a.name, a]));
  const projectsBySlug = new Map(state.projects.map((p) => [p.slug, p]));

  const exists =
    kind === "agent"
      ? agentsByName.has(slug)
      : kind === "role"
        ? rolesByName.has(slug)
        : projectsBySlug.has(slug);
  if (!exists) throw new ShareError("not_found", `${kind} not found`);
  if (kind === "role" && rolesByName.get(slug)!.instanceWide) {
    throw new ShareError("instance_wide", "a role kept on every machine can't be changed here");
  }

  const clean = (l: readonly string[] | undefined) => dedupe((l ?? []).filter((u) => typeof u === "string" && u.length > 0));
  const add = clean(change.add);
  const remove = clean(change.remove);
  if (add.some((u) => !state.people.includes(u))) {
    throw new ShareError("unknown_person", "not someone on this machine");
  }

  const before = shownAudience(state, kind, slug);
  const next = editList(before, add, remove);
  if (next.length === 0) throw new ShareError("empty", "a list needs at least one person");
  const added = next.filter((u) => !before.includes(u));
  const removed = before.filter((u) => !next.includes(u));

  const plan: SharePlan = {
    writes: [],
    rolesToShare: [],
    alsoShared: { projects: [], agents: [], roles: [] },
    alsoUnshared: { projects: [], agents: [] },
    keptShared: [],
    disappearing: [],
    added,
    removed,
  };

  // Accumulated list per thing, so a role reached twice is written once.
  const pending = new Map<string, ShareWrite>();
  const listOf = (k: ShareKind, s: string, fallback: string[] | null): string[] | null =>
    pending.get(`${k}:${s}`)?.users ?? fallback;
  const put = (k: ShareKind, s: string, users: string[]) => {
    pending.set(`${k}:${s}`, { kind: k, slug: s, users });
  };

  if (added.length > 0 || removed.length > 0) put(kind, slug, next);

  const shareRolesFor = (agents: readonly ShareAgent[], people: readonly string[]) => {
    const byRole = new Map<string, string[]>();
    for (const a of agents) {
      for (const person of people) {
        for (const role of rolesHiding(a, rolesByName, person)) {
          if (role.instanceWide) continue;
          const list = byRole.get(role.name) ?? [];
          if (!list.includes(person)) list.push(person);
          byRole.set(role.name, list);
        }
      }
    }
    return byRole;
  };

  if (kind === "agent") {
    const self = agentsByName.get(slug)!;
    for (const [name, people] of shareRolesFor([self], added)) {
      plan.rolesToShare.push({ name, label: rolesByName.get(name)!.label, people });
    }
    const fixFor = dedupe([
      ...(opts.shareRoles ? added : []),
      ...(opts.shareRolesFor ?? []).filter((u) => next.includes(u)),
    ]);
    for (const [name, people] of shareRolesFor([self], fixFor)) {
      put("role", name, editList(listOf("role", name, rolesByName.get(name)!.users)!, people, []));
    }
  }

  if (kind === "role" && removed.length > 0) {
    for (const a of state.agents) {
      if (!a.roles.includes(slug)) continue;
      if (removed.some((u) => agentVisibleTo(a, rolesByName, u))) plan.disappearing.push({ name: a.name, label: a.label });
    }
  }

  if (kind === "project") {
    const subtree = projectSubtree(state.projects, slug);
    const inside = new Set(subtree);
    const subProjects = subtree.slice(1).map((s) => projectsBySlug.get(s)!);
    const agentsInside = state.agents.filter((a) => a.project !== null && inside.has(a.project));

    if (added.length > 0) {
      // Sub-projects with no list of their own follow the chain already.
      for (const p of subProjects) {
        if (!hasList(p.users)) continue;
        const missing = added.filter((u) => !p.users!.includes(u));
        if (missing.length === 0) continue;
        put("project", p.slug, editList(p.users, missing, []));
        plan.alsoShared.projects.push({ name: p.slug, label: p.label });
      }
      for (const a of agentsInside) {
        if (!hasList(a.users)) continue;
        const missing = added.filter((u) => !a.users!.includes(u));
        if (missing.length === 0) continue;
        put("agent", a.name, editList(a.users, missing, []));
        plan.alsoShared.agents.push({ name: a.name, label: a.label });
      }
      for (const [name, people] of shareRolesFor(agentsInside, added)) {
        const role = rolesByName.get(name)!;
        put("role", name, editList(listOf("role", name, role.users)!, people, []));
        plan.alsoShared.roles.push({ name: role.name, label: role.label });
      }
    }

    if (removed.length > 0) {
      // A sub-project is hidden by the chain once the project is, so one
      // whose list would empty keeps it rather than open to everyone.
      for (const p of subProjects) {
        if (!hasList(p.users)) continue;
        const after = p.users.filter((u) => !removed.includes(u));
        if (after.length === p.users.length || after.length === 0) continue;
        put("project", p.slug, editList(listOf("project", p.slug, p.users)!, [], removed));
        plan.alsoUnshared.projects.push({ name: p.slug, label: p.label });
      }
      // Agents aren't hidden by their project, so each one says so itself.
      for (const a of agentsInside) {
        const base = listOf("agent", a.name, a.users);
        const audience = resolvedAudience(base, state.people);
        const losing = removed.filter((u) => audience.includes(u));
        if (losing.length === 0) continue;
        const after = audience.filter((u) => !removed.includes(u));
        if (after.length === 0) {
          plan.keptShared.push({ agent: { name: a.name, label: a.label }, people: losing });
          continue;
        }
        put("agent", a.name, after);
        plan.alsoUnshared.agents.push({ name: a.name, label: a.label });
      }
    }
  }

  plan.writes = [...pending.values()];
  return plan;
}
