/**
 * app-visibility-gate.ts — Phase 130 per-user visibility gate on apps.
 *
 * Companion pure function to the Phase 118 apps pipeline (SweepAppLine →
 * adaptAppLineToState → AppState → publishAppUpdate/publishAppSnapshot).
 * Every seam that emits app frames to subscribers MUST invoke this gate
 * on each AppState's `users` field with the caller's Skynet username and
 * drop entries where it returns false BEFORE reaching the wire.
 *
 * Design locks (mirror identity-visibility-gate.ts + project-visibility-gate.ts):
 *   - Apps have no role parent, so the intersection semantics that
 *     isIdentityVisibleToUser applies (BOTH identity AND role gates must pass)
 *     do NOT apply here. An app's `users` list is the only gate.
 *   - D-3 fallback (falls open on empty/absent list): matches shape file's
 *     "visible to everyone with host access" default. Zero-migration
 *     invariant — every existing pre-130 app.json across the fleet has no
 *     `users` field and stays visible to every user with host access.
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
 * Pitfall 7 lock (Phase 129).
 *
 * Design constraints (mirror identity-visibility-gate.ts + project-visibility-gate.ts):
 *   - Zero imports from `src/backend/database/` — pure function so both route
 *     layer and fleet-status layer can depend on it without a cycle.
 *   - Zero imports from `express` or `zod` — the route layer owns those.
 *   - No logger import — pure function, no side effects; the caller logs
 *     the gate decision at the seam.
 *
 * Kept as a separate file from project-visibility-gate.ts (rather than a
 * shared `isResourceVisibleToUser`) so a grep for `isAppVisibleToUser(` is
 * the audit-visible answer to "did we gate every app emit site?".
 */

/**
 * Returns true iff the app with `appUsers` frontmatter list is visible to
 * `callerUsername`. See file-header docblock for the full fallback +
 * null-caller-bypass contract.
 */
export function isAppVisibleToUser(
  appUsers: string[] | null,
  callerUsername: string | null,
): boolean {
  // Null caller → gate disabled (internal-server / test / admin bypass).
  if (callerUsername === null) return true;

  // D-3 fallback: absent / non-array / empty list = "no gate" (falls open).
  // Otherwise, callerUsername must be in the list (case-sensitive).
  return (
    !Array.isArray(appUsers) ||
    appUsers.length === 0 ||
    appUsers.includes(callerUsername)
  );
}
