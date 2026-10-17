/**
 * project-visibility-gate.ts — Phase 130 per-user visibility gate on projects.
 *
 * Companion pure function to the Phase 117 project pipeline (project-list.ts,
 * identity-artifact-reader.ts:listProjects). Every caller whose output is
 * user-facing MUST invoke this gate on each project's `users` field with the
 * caller's Skynet username and drop rows where it returns false BEFORE
 * surfacing the result to the frontend / WS subscriber.
 *
 * Design locks (mirror identity-visibility-gate.ts):
 *   - Projects have no role parent, so the intersection semantics that
 *     isIdentityVisibleToUser applies (BOTH identity AND role gates must pass)
 *     do NOT apply here. A project's `users` list is the only gate.
 *   - D-3 fallback (falls open on empty/absent list): matches shape file's
 *     "visible to everyone with host access" default. Zero-migration
 *     invariant — every existing pre-130 project.md across the fleet has no
 *     `users:` frontmatter and stays visible to every user with host access.
 *   - D-8 (visibility filter, NOT permission system): this gate hides rows
 *     from a user's sidebar; it does NOT enforce SSH access, does NOT gate
 *     write endpoints. The current host-access gate remains the authoritative
 *     security boundary.
 *
 * `callerUsername === null` DISABLES the gate entirely (returns true).
 * Used by internal-server consumers (fleet-status sweep writer side,
 * background sweeps, tests, admin bypass sites if any exist).
 *
 * CASE-SENSITIVE comparison — matches the DB's users.username storage
 * discipline (users.ts L172 `eq(users.username, username)`; case is stored
 * as-typed at register with no normalization layer). RESEARCH § Common
 * Pitfall 7 lock (Phase 129) — operator responsibility is to match the case
 * of the target's registered Skynet username.
 *
 * Design constraints (mirror identity-visibility-gate.ts:37-42):
 *   - Zero imports from `src/backend/database/` — pure function so both route
 *     layer and fleet-status layer can depend on it without a cycle.
 *   - Zero imports from `express` or `zod` — the route layer owns those.
 *   - No logger import — pure function, no side effects; the caller logs
 *     the gate decision at the seam.
 */

/**
 * Returns true iff the project with `projectUsers` frontmatter list is visible
 * to `callerUsername`. See file-header docblock for the full fallback +
 * null-caller-bypass contract.
 */
export function isProjectVisibleToUser(
  projectUsers: string[] | null,
  callerUsername: string | null,
): boolean {
  // Null caller → gate disabled (internal-server / test / admin bypass).
  if (callerUsername === null) return true;

  // D-3 fallback: absent / non-array / empty list = "no gate" (falls open).
  // Otherwise, callerUsername must be in the list (case-sensitive).
  return (
    !Array.isArray(projectUsers) ||
    projectUsers.length === 0 ||
    projectUsers.includes(callerUsername)
  );
}

/**
 * Nested projects: tree-aware visibility. A project is visible iff it passes
 * its own `users` gate AND every ancestor reachable through `parent` links
 * within `projects` (one host's full list) passes its gate.
 *
 * The walk stops at a parent slug that isn't in the list (missing or
 * archived parent → the child reads as top level and needs only its own
 * gate). A hand-edited loop is judged the way the sidebar draws it: every
 * project ON the loop sits at top level, so only the chain up to where the
 * walk first re-enters the loop counts — a hidden loop partner never hides
 * a visible one. A sub-project can narrow its audience, never widen it, and
 * a hidden parent never "looks missing" here because the input is the
 * unfiltered list.
 *
 * Preserves input order; returns the same element references.
 * `callerUsername === null` disables the gate (everything visible).
 */
export function filterVisibleProjectTree<
  T extends {
    slug: string;
    parent?: string | null;
    users?: string[] | null;
  },
>(projects: T[], callerUsername: string | null): T[] {
  if (callerUsername === null) return projects.slice();

  const bySlug = new Map<string, T>();
  for (const p of projects) bySlug.set(p.slug, p);

  return projects.filter((p) => {
    // Walk up collecting the chain; on a repeat, the chain is cut just after
    // the first loop member reached (that member is drawn at top level).
    const chain: T[] = [];
    const indexOf = new Map<string, number>();
    let node: T | undefined = p;
    while (node !== undefined) {
      const seenAt = indexOf.get(node.slug);
      if (seenAt !== undefined) {
        chain.length = seenAt + 1;
        break;
      }
      indexOf.set(node.slug, chain.length);
      chain.push(node);
      node =
        typeof node.parent === "string" ? bySlug.get(node.parent) : undefined;
    }
    return chain.every((n) =>
      isProjectVisibleToUser(n.users ?? null, callerUsername),
    );
  });
}

/**
 * For the wire: a surviving project whose `parent` names a project that
 * EXISTS on the host but is hidden from the caller (only possible when a
 * hidden project sits on a hand-edited loop) gets `parent: null`, so a hidden
 * project's slug never reaches someone it's hidden from. A parent that is
 * genuinely missing is kept: the sidebar needs it to offer "Top level" to
 * clear the stale line. `all` is the unfiltered host list, `visible` the
 * output of filterVisibleProjectTree over it.
 */
export function redactHiddenParents<
  T extends { slug: string; parent?: string | null },
>(all: readonly T[], visible: T[]): T[] {
  const existing = new Set(all.map((p) => p.slug));
  const shown = new Set(visible.map((p) => p.slug));
  return visible.map((p) =>
    typeof p.parent === "string" && existing.has(p.parent) && !shown.has(p.parent)
      ? { ...p, parent: null }
      : p,
  );
}

/**
 * The users who can see `slug` through filterVisibleProjectTree's rules:
 * the intersection of every non-empty `users` list along its chain (own
 * project first, cut at the same loop point), or null when nothing in the
 * chain restricts it (everyone with host access). `parentOverride`, when
 * given, judges the project as if its parent were that slug (null = top
 * level) — used to tell whether a move would widen its audience.
 */
export function effectiveProjectAudience<
  T extends {
    slug: string;
    parent?: string | null;
    users?: string[] | null;
  },
>(
  projects: readonly T[],
  slug: string,
  parentOverride?: string | null,
): string[] | null {
  const bySlug = new Map<string, T>();
  for (const p of projects) bySlug.set(p.slug, p);
  const parentOf = (s: string): string | null | undefined =>
    s === slug && parentOverride !== undefined
      ? parentOverride
      : bySlug.get(s)?.parent;

  // Same chain as filterVisibleProjectTree: on a repeat, cut just after the
  // first loop member reached.
  const chain: string[] = [];
  const indexOf = new Map<string, number>();
  let node: string | null | undefined = slug;
  while (typeof node === "string" && bySlug.has(node)) {
    const seenAt = indexOf.get(node);
    if (seenAt !== undefined) {
      chain.length = seenAt + 1;
      break;
    }
    indexOf.set(node, chain.length);
    chain.push(node);
    node = parentOf(node);
  }

  let audience: Set<string> | null = null;
  for (const s of chain) {
    const users = bySlug.get(s)!.users;
    if (Array.isArray(users) && users.length > 0) {
      audience =
        audience === null
          ? new Set(users)
          : new Set([...audience].filter((u) => users.includes(u)));
    }
  }
  return audience === null ? null : [...audience].sort();
}

/** True iff audience `next` lets in someone `prev` keeps out. */
export function audienceWidens(
  prev: readonly string[] | null,
  next: readonly string[] | null,
): boolean {
  if (prev === null) return false;
  if (next === null) return true;
  return next.some((u) => !prev.includes(u));
}
