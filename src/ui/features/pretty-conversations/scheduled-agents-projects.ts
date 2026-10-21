// Project helpers for the scheduled-tasks form: the picker's sidebar-ordered,
// indented option list, and the top-down display path shown on a task's row.

import type { ScheduledAgentProjectOption } from "@/api/scheduled-agents-api";

export type ProjectPickerOption = {
  slug: string;
  displayName: string;
  /** Nesting depth — 0 for a top-level project. */
  depth: number;
};

/**
 * Projects in sidebar order: each top-level project (alphabetical by display
 * name) followed by its sub-projects, depth-first. A project whose parent is
 * gone shows at top level, as in the sidebar; a parent loop is cut.
 */
export function orderProjectsAsTree(
  projects: ScheduledAgentProjectOption[],
): ProjectPickerOption[] {
  const bySlug = new Map(projects.map((p) => [p.slug, p]));
  const children = new Map<string | null, ScheduledAgentProjectOption[]>();
  for (const p of projects) {
    const parent = p.parent !== null && bySlug.has(p.parent) && p.parent !== p.slug ? p.parent : null;
    const list = children.get(parent) ?? [];
    list.push(p);
    children.set(parent, list);
  }
  const byName = (a: ScheduledAgentProjectOption, b: ScheduledAgentProjectOption) =>
    a.displayName.localeCompare(b.displayName) || a.slug.localeCompare(b.slug);
  const out: ProjectPickerOption[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const p of [...(children.get(parent) ?? [])].sort(byName)) {
      if (seen.has(p.slug)) continue;
      seen.add(p.slug);
      out.push({ slug: p.slug, displayName: p.displayName, depth });
      walk(p.slug, depth + 1);
    }
  };
  walk(null, 0);
  // Projects only reachable through a loop never hang off the top level —
  // surface them there so none goes unlisted.
  for (const p of [...projects].sort(byName)) {
    if (!seen.has(p.slug)) {
      seen.add(p.slug);
      out.push({ slug: p.slug, displayName: p.displayName, depth: 0 });
      walk(p.slug, 1);
    }
  }
  return out;
}

/** Display names from the top-level project down to `slug`; null if absent.
 *  Same walk as the backend's projectPathFor. */
export function projectPathFromOptions(
  slug: string,
  projects: ScheduledAgentProjectOption[],
): string[] | null {
  const bySlug = new Map(projects.map((p) => [p.slug, p]));
  const path: string[] = [];
  const seen = new Set<string>();
  let cur = bySlug.get(slug);
  if (!cur) return null;
  while (cur && !seen.has(cur.slug)) {
    seen.add(cur.slug);
    path.unshift(cur.displayName);
    cur = cur.parent ? bySlug.get(cur.parent) : undefined;
  }
  return path;
}

/** "SKYNET › later" — how a task's project reads on its row. */
export function formatProjectPath(path: string[]): string {
  return path.join(" › ");
}
