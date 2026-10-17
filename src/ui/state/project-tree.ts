/**
 * project-tree.ts — resolve the nested-project tree from flat project rows.
 *
 * A project names its parent with an optional `parent:` slug in its
 * project.md; the parent is always a project on the SAME host. Folders stay
 * flat on disk, so the tree is purely a reading of those parent links.
 *
 * Resolution rules (never lose a project):
 *   - No parent, or a parent that isn't in the list (gone, archived, typo)
 *     → top level.
 *   - A project caught in a loop (A → B → A, or naming itself) → top level.
 *     Projects that merely hang off a loop keep their parent, so genuine
 *     sub-projects stay nested beneath the looped project.
 * The resolved links are therefore always acyclic.
 *
 * Pure functions, no store imports — the conversation-store snapshot and
 * the sidebar panel both build on these.
 */

export type ProjectTreeNode = {
  slug: string;
  hostId: string;
  parent?: string | null;
};

/** Projects are host-scoped: the same slug on two hosts is two projects. */
export function projectKey(hostId: string, slug: string): string {
  return `${hostId}::${slug}`;
}

// Loops already reported — the snapshot recomputes on every store change,
// so log each distinct loop once per page load, not once per render.
const reportedLoops = new Set<string>();

/**
 * Map every project key to its effective parent key (null = top level).
 * Logs each loop once so a hand-edited loop is visible in the
 * console-forward log without a sidebar warning.
 */
export function resolveEffectiveParents(
  projects: readonly ProjectTreeNode[],
): Map<string, string | null> {
  const byKey = new Map<string, ProjectTreeNode>();
  for (const p of projects) byKey.set(projectKey(p.hostId, p.slug), p);

  const rawParentKey = (p: ProjectTreeNode): string | null => {
    if (!p.parent) return null;
    const k = projectKey(p.hostId, p.parent);
    return byKey.has(k) ? k : null;
  };

  // Find every key that sits on a loop. Walk up from each project; when the
  // walk revisits a key from THIS walk, the keys from that point on form the
  // loop. `settled` marks keys whose upward walk is already known to end, so
  // the whole pass is linear.
  const inLoop = new Set<string>();
  const settled = new Set<string>();
  for (const start of byKey.keys()) {
    if (settled.has(start)) continue;
    const path: string[] = [];
    const onPath = new Map<string, number>();
    let cur: string | null = start;
    while (cur !== null && !settled.has(cur)) {
      if (onPath.has(cur)) {
        const loop = path.slice(onPath.get(cur));
        for (const k of loop) inLoop.add(k);
        const signature = [...loop].sort().join(",");
        if (!reportedLoops.has(signature)) {
          reportedLoops.add(signature);
          console.warn(
            `[projects] parent loop — rendering at top level: ${loop.join(" -> ")}`,
          );
        }
        break;
      }
      onPath.set(cur, path.length);
      path.push(cur);
      cur = rawParentKey(byKey.get(cur)!);
    }
    for (const k of path) settled.add(k);
  }

  const out = new Map<string, string | null>();
  for (const [k, p] of byKey) {
    out.set(k, inLoop.has(k) ? null : rawParentKey(p));
  }
  return out;
}

/** Children lists keyed by parent key; top-level projects under `null`. */
export function childrenByParent(
  effectiveParents: ReadonlyMap<string, string | null>,
): Map<string | null, string[]> {
  const out = new Map<string | null, string[]>();
  for (const [k, parent] of effectiveParents) {
    const list = out.get(parent) ?? [];
    list.push(k);
    out.set(parent, list);
  }
  return out;
}

/** Every key strictly beneath `key` in the resolved tree. */
export function descendantKeys(
  key: string,
  effectiveParents: ReadonlyMap<string, string | null>,
): Set<string> {
  const children = childrenByParent(effectiveParents);
  const out = new Set<string>();
  const stack = [...(children.get(key) ?? [])];
  while (stack.length > 0) {
    const k = stack.pop()!;
    if (out.has(k)) continue;
    out.add(k);
    stack.push(...(children.get(k) ?? []));
  }
  return out;
}

/** Ancestor keys of `key`, nearest first. */
export function ancestorKeys(
  key: string,
  effectiveParents: ReadonlyMap<string, string | null>,
): string[] {
  const out: string[] = [];
  let cur = effectiveParents.get(key) ?? null;
  while (cur !== null && !out.includes(cur)) {
    out.push(cur);
    cur = effectiveParents.get(cur) ?? null;
  }
  return out;
}

/**
 * Projects in sidebar tree order — each project followed by its
 * sub-projects, siblings alphabetical by displayName — with each one's depth
 * (0 = top level). Used for the indented "Move to" lists.
 */
export function orderProjectsAsTree<
  T extends ProjectTreeNode & { displayName: string },
>(projects: readonly T[]): Array<{ project: T; depth: number }> {
  const effectiveParents = resolveEffectiveParents(projects);
  const byKey = new Map<string, T>();
  for (const p of projects) byKey.set(projectKey(p.hostId, p.slug), p);
  const children = childrenByParent(effectiveParents);
  const byName = (a: string, b: string) =>
    byKey.get(a)!.displayName.localeCompare(byKey.get(b)!.displayName, undefined, {
      sensitivity: "base",
    });
  const out: Array<{ project: T; depth: number }> = [];
  const walk = (keys: string[], depth: number) => {
    for (const k of [...keys].sort(byName)) {
      out.push({ project: byKey.get(k)!, depth });
      walk(children.get(k) ?? [], depth + 1);
    }
  };
  walk(children.get(null) ?? [], 0);
  return out;
}
