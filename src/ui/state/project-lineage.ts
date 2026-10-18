/**
 * project-lineage.ts — the chain of projects an agent sits in, top level
 * first ("Morpheus 2" › "M2 · Runs"). Resolved the way the sidebar nests
 * them (see project-tree.ts), so a missing parent or a loop ends the chain
 * exactly where the sidebar puts the project.
 */

import { ancestorKeys, projectKey, resolveEffectiveParents } from "./project-tree";
import type { ProjectRow } from "./conversation-store";

/**
 * Display names from the top-level project down to the agent's own, or []
 * when the agent isn't in a (known) project on its host.
 */
export function projectLineage(
  projects: readonly ProjectRow[],
  hostId: number | string,
  slug: string | null | undefined,
): string[] {
  if (!slug) return [];
  const own = projectKey(String(hostId), slug);
  const byKey = new Map(projects.map((p) => [projectKey(p.hostId, p.slug), p]));
  if (!byKey.has(own)) return [];
  const chain = [own, ...ancestorKeys(own, resolveEffectiveParents(projects))].reverse();
  return chain.map((k) => byKey.get(k)?.displayName || k.split("::")[1]);
}
