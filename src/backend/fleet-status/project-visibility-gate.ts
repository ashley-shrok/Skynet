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
