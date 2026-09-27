/**
 * scheduled-agent-visibility-gate.ts — per-user visibility gate on scheduled
 * agents (a.k.a. global wakeups).
 *
 * Companion pure function to the scheduled-agents pipeline (scheduled-agents-list.ts).
 * Every caller whose output is user-facing MUST invoke this gate on each row's
 * `users` field with the caller's Skynet username and drop rows where it
 * returns false BEFORE surfacing the result to the frontend.
 *
 * Design locks (mirror project-visibility-gate.ts + app-visibility-gate.ts):
 *   - Scheduled agents have no role parent, so the intersection semantics
 *     that isIdentityVisibleToUser applies (BOTH identity AND role gates
 *     must pass) do NOT apply here. A scheduled agent's `users` list is the
 *     only gate.
 *   - D-3 fallback (falls open on empty/absent list): matches shape file's
 *     "visible to everyone with host access" default. Zero-migration
 *     invariant — every existing scheduled-agent.json across the fleet has
 *     no `users` field and stays visible to every user with host access.
 *   - D-8 (visibility filter, NOT permission system): this gate hides rows
 *     from a user's list; it does NOT enforce SSH access, does NOT gate
 *     write endpoints. The current host-access gate remains the
 *     authoritative security boundary — mirrors how identity + identity-
 *     wakeup writes stay ungated on the users list.
 *
 * `callerUsername === null` DISABLES the gate entirely (returns true).
 * Used by internal-server consumers (background sweeps, tests, admin bypass
 * sites if any exist).
 *
 * CASE-SENSITIVE comparison — matches the DB's users.username storage
 * discipline (users.ts L172 `eq(users.username, username)`; case is stored
 * as-typed at register with no normalization layer). Operator responsibility
 * is to match the case of the target's registered Skynet username.
 *
 * Design constraints (mirror project-visibility-gate.ts):
 *   - Zero imports from `src/backend/database/` — pure function so both
 *     route layer and fleet-status layer can depend on it without a cycle.
 *   - Zero imports from `express` or `zod` — the route layer owns those.
 *   - No logger import — pure function, no side effects; the caller logs
 *     the gate decision at the seam.
 *
 * Kept as a separate file from project-visibility-gate.ts / app-visibility-gate.ts
 * (rather than a shared `isResourceVisibleToUser`) so a grep for
 * `isScheduledAgentVisibleToUser(` is the audit-visible answer to "did we
 * gate every scheduled-agent emit site?".
 */

/**
 * Returns true iff the scheduled agent with `specUsers` list is visible
 * to `callerUsername`. See file-header docblock for the full fallback +
 * null-caller-bypass contract.
 */
export function isScheduledAgentVisibleToUser(
  specUsers: string[] | null,
  callerUsername: string | null,
): boolean {
  // Null caller → gate disabled (internal-server / test / admin bypass).
  if (callerUsername === null) return true;

  // D-3 fallback: absent / non-array / empty list = "no gate" (falls open).
  // Otherwise, callerUsername must be in the list (case-sensitive).
  return (
    !Array.isArray(specUsers) ||
    specUsers.length === 0 ||
    specUsers.includes(callerUsername)
  );
}
