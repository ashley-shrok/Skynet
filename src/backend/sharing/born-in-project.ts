/**
 * born-in-project.ts — who a new agent or sub-project made inside a project
 * starts shared with: whoever made it plus everyone who can see the project
 * (its own list narrowed by every project above it), or everyone when the
 * project isn't limited at all. Null = no such project; the usual
 * creator-only tag stands.
 */
import { effectiveProjectAudience } from "../fleet-status/project-visibility-gate.js";

export function bornInProjectUsers(
  projects: ReadonlyArray<{ slug: string; parent?: string | null; users?: string[] | null }>,
  project: string,
  creator: string,
): string[] | "everyone" | null {
  if (!projects.some((p) => p.slug === project)) return null;
  const audience = effectiveProjectAudience(projects, project);
  if (audience === null) return "everyone";
  return [creator, ...audience.filter((u) => u !== creator)];
}
