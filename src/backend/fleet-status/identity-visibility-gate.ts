/**
 * identity-visibility-gate.ts — Phase 129 per-user visibility gate on
 * roles + identities.
 *
 * Companion pure function to resolveIdentityAppearance's cosmetics merge
 * (identity-appearance.ts). Every caller of resolveIdentityAppearance whose
 * output is user-facing MUST also invoke this gate on the same
 * (identityCosmetics, roleCosmetics) pair and drop rows where it returns
 * false BEFORE surfacing the result to the frontend / WS subscriber.
 *
 * Design locks:
 *   - D-2 (intersection semantics): the identity is visible to `callerUsername`
 *     iff BOTH the identity's `users` gate AND the role's `users` gate pass.
 *     Empty or absent list on either side means "no gate on that side" (D-3
 *     fallback rule — falls open — preserves zero-migration invariant for
 *     every existing role/identity file across the fleet).
 *   - D-8 (visibility filter, NOT permission system): this gate hides rows
 *     from a user's sidebar; it does NOT enforce SSH access, does NOT block
 *     direct-URL avatar reads, does NOT gate write endpoints. The current
 *     host-access gate remains the authoritative security boundary.
 *   - Phase 111 T-111-08 ("one cascade authority"): resolveIdentityAppearance's
 *     signature intentionally does NOT carry callerUsername. Gating lives
 *     HERE, called by every caller separately, so a grep for
 *     `isIdentityVisibleToUser(` is the audit-visible answer to "did we
 *     gate this call site?".
 *
 * `callerUsername === null` DISABLES the gate entirely (returns true).
 * Used by internal-server consumers (fleet-status sweep writer side,
 * background sweeps, tests, admin bypass sites if any exist).
 *
 * CASE-SENSITIVE comparison — matches the DB's users.username storage
 * discipline (users.ts L172 `eq(users.username, username)`; case is stored
 * as-typed at register with no normalization layer). RESEARCH § Common
 * Pitfall 7 lock — documented case-sensitive rule; operator responsibility
 * is to match the case of the target's registered Skynet username.
 *
 * Design constraints (mirrors identity-appearance.ts L9-15):
 *   - Zero imports from `src/backend/database/` — pure function so both
 *     route layer and fleet-status layer can depend on it without a cycle.
 *   - Zero imports from `express` or `zod` — route layer owns those.
 *   - No logger import — pure function, no side effects; the caller logs
 *     the gate decision at the seam (Wave 2 / 3 plans).
 */

import type { RawCosmetics } from "./identity-appearance.js";

/**
 * Returns true iff the identity described by (identityCosmetics, roleCosmetics)
 * is visible to `callerUsername`. See file-header docblock for the full
 * intersection-semantics + fallback + null-caller-bypass contract.
 */
export function isIdentityVisibleToUser(
  identityCosmetics: RawCosmetics | null,
  roleCosmetics: RawCosmetics | null,
  callerUsername: string | null,
): boolean {
  // Null caller → gate disabled (internal-server / test / admin bypass).
  if (callerUsername === null) return true;

  const identityUsers = identityCosmetics?.users;
  const roleUsers = roleCosmetics?.users;

  // D-3 fallback: absent / non-array / empty list = "no gate on this side"
  // (falls open). Otherwise, callerUsername must be in the list.
  const identityGateOpen =
    !Array.isArray(identityUsers) ||
    identityUsers.length === 0 ||
    identityUsers.includes(callerUsername);
  const roleGateOpen =
    !Array.isArray(roleUsers) ||
    roleUsers.length === 0 ||
    roleUsers.includes(callerUsername);

  // D-2 intersection: BOTH sides must pass.
  return identityGateOpen && roleGateOpen;
}
