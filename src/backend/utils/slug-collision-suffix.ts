/**
 * Collision auto-suffix helper for backend-derived slugs.
 *
 * The three entity types (roles, identities in the name-it-myself path,
 * projects) hide slugs from the user — users type pretty names, systems
 * derive slugs. When two typed names derive to the same slug, the second
 * one gets a numeric suffix appended by the system (base-2, base-3, …)
 * rather than erroring out and forcing the user to think about slugs.
 *
 * This function is pure except for the exists-predicate the caller injects.
 * Each caller is responsible for its own existence check (directory read,
 * Matrix account lookup, DB query — whatever fits the entity type) and
 * passes that in.
 *
 * Guarantee: the returned slug does NOT currently exist per the predicate.
 * The predicate is invoked in ascending order (base first, then base-2,
 * base-3, …) and stops at the first miss.
 *
 * Note: the base slug passed in is expected to be the output of
 * derivePrettyNameSlug — pure `[a-z]+(-[a-z]+)*`, no digits. The suffix
 * `-<n>` is the ONLY place a digit appears in a system-derived slug on
 * disk, which means callers reading a slug can distinguish auto-suffixed
 * copies from user-typed content unambiguously.
 */

export async function resolveSlugCollision(
  base: string,
  existsAsync: (slug: string) => Promise<boolean>,
): Promise<string> {
  if (!(await existsAsync(base))) {
    return base;
  }
  let n = 2;
  while (true) {
    const candidate = `${base}-${n}`;
    if (!(await existsAsync(candidate))) {
      return candidate;
    }
    n += 1;
  }
}

/**
 * Synchronous variant for callers whose exists-check is already in-memory
 * (e.g. a Set of known slugs). Semantics match the async variant.
 */
export function resolveSlugCollisionSync(
  base: string,
  existsSync: (slug: string) => boolean,
): string {
  if (!existsSync(base)) {
    return base;
  }
  let n = 2;
  while (true) {
    const candidate = `${base}-${n}`;
    if (!existsSync(candidate)) {
      return candidate;
    }
    n += 1;
  }
}
