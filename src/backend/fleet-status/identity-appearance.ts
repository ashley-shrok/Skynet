/**
 * identity-appearance.ts — Single authority for identity-over-role cosmetics merge.
 *
 * This module is the ONE place the `identity ?? role ?? null` cascade lives.
 * Both the request path (`publicIdentity()` in database/routes/identities.ts)
 * and the fleet-status sweep path (ssh-poll-orchestrator.ts, Plan 111-03) call
 * `resolveIdentityAppearance`. There must be no second copy of this cascade.
 *
 * Design constraints:
 *   - Zero imports from `src/backend/database/` — pure function module so both
 *     the route layer and the fleet-status layer can depend on it without a cycle.
 *   - Zero imports from `express` or `zod` — the route layer owns those.
 *   - `null` cosmetics is treated identically to `{}` (fail-closed contract: an
 *     unreadable identity file yields a plain, fully-shaped appearance, never a
 *     throw and never a missing value).
 */

// ---------------------------------------------------------------------------
// Raw cosmetic shape — the subset of frontmatter fields this module merges.
// ---------------------------------------------------------------------------

/**
 * Raw cosmetics as parsed from an identity or role frontmatter file.
 * Every field is optional because: (a) identity files may omit any field;
 * (b) role files may carry only a subset.
 *
 * Used on both legs of the merge:
 *   - `cosmetics` — the identity's OWN frontmatter (identity_cosmetics on wire)
 *   - `roleCosmetics` — the ROLE file's frontmatter (role_cosmetics on wire)
 */
export type RawCosmetics = {
  displayName?: string;
  title?: string;
  colorHue?: number;
  voice?: string;
  task?: string;
  avatar?: string;
  coordinator?: boolean;
  /**
   * Phase 117 Plan 117-07 (D-05 identity carrier): project slug from the
   * identity's frontmatter `project:` field. Per-identity, NOT inherited from
   * the role — same discipline as `task` (D-05 write-once semantic). Permissive
   * on read (any non-empty string is surfaced); dangling slugs handled at
   * frontend render time (D-07 graceful degradation).
   */
  project?: string;
  /**
   * Phase 129 (D-10 field name locked, D-3 absent-⇒-omit fallback): per-user
   * visibility gate — YAML list of Skynet usernames. Empty / absent = "no gate
   * on this side" (falls open — matches the shape file's fallback rule
   * "visible to everyone with host access"; zero-migration invariant).
   *
   * CASE-SENSITIVE comparison against the caller's Skynet username at
   * gate-apply time — matches DB users.username storage discipline
   * (`users.ts` L172 uses `eq(users.username, username)`; case is stored
   * as-typed at register). RESEARCH § Common Pitfall 7 lock.
   *
   * Applied by the companion pure function `isIdentityVisibleToUser`
   * (`identity-visibility-gate.ts`) — NOT inside resolveIdentityAppearance's
   * cascade (D-8: visibility filter, not permission system; Phase 111 T-111-08
   * "one cascade authority" invariant preserved).
   */
  users?: string[];
};

// ---------------------------------------------------------------------------
// Resolved shape — the merge output, fully-typed with no optional fields.
// ---------------------------------------------------------------------------

/**
 * The appearance of an identity after applying the identity-over-role merge.
 * Every field is resolved to a concrete value; no optionals here.
 *
 * Field semantics mirror `publicIdentity()`'s return object exactly.
 * The frontend merge (Plan 111-04) writes these names directly onto the
 * Identity row — using the same names keeps the merge a straight field copy,
 * not a translation layer.
 */
export type ResolvedIdentityAppearance = {
  displayName: string;
  title: string | null;
  colorHue: number | null;
  voice: string | null;
  /** NOT inherited from the role — task is per-identity (D-05 write-once at birth). */
  task: string | null;
  /**
   * Phase 117 Plan 117-07 (D-05 identity carrier): project slug from the
   * identity's frontmatter `project:` field. NOT inherited from the role —
   * same discipline as `task` (per-identity write-once). Null when absent.
   */
  project: string | null;
  coordinator: boolean;
  role: string | null;
  /**
   * Three-valued semantics:
   *   - `null`       → no role resolvable (identity has no `role:` frontmatter,
   *                    or role-file read failed)
   *   - `{}`         → role exists but carries no cosmetic frontmatter fields
   *   - `{...}`      → the role's raw cosmetic values (used by IdentityModal
   *                    to render inherit-vs-override affordances per Phase 85-05)
   */
  roleDefaults: RawCosmetics | null;
  avatarUrl: string;
  pinned: boolean;
};

// ---------------------------------------------------------------------------
// capitalizeFirstIdentityKey — moved verbatim from identities.ts
// ---------------------------------------------------------------------------

/**
 * Safe-default display name when no `displayName` cosmetic is present.
 * Mirrors `capitalizeFirst` from `database/routes/identities.ts` byte-for-byte.
 *
 * Phase 66 Plan 03 origin. Exported here so both `publicIdentity()` (which now
 * delegates to `resolveIdentityAppearance`) and any future consumer share the
 * same implementation.
 */
export function capitalizeFirstIdentityKey(s: string): string {
  if (!s || s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// resolveIdentityAppearance — the single cascade
// ---------------------------------------------------------------------------

/**
 * Apply the identity-over-role cosmetics merge and return a fully-resolved
 * `ResolvedIdentityAppearance` object.
 *
 * This is the ONE authoritative implementation of the `identity ?? role ?? null`
 * cascade (T-111-08 mitigation). `publicIdentity()` delegates to this function;
 * the fleet-status sweep path calls it via `ssh-poll-orchestrator`'s source-B
 * adapter (Plan 111-03).
 *
 * Fail-closed contract: a `null` `cosmetics` argument (unreadable identity file)
 * is treated identically to `{}`. Every field falls through to its role value or
 * its safe default. No throw, no missing value — the row always gets a
 * fully-shaped appearance.
 *
 * Two carve-outs that differ from a naive "merge everything" cascade:
 *
 *   1. `task` is NOT inherited from the role.
 *      `task` is per-identity (D-05 write-once at birth). The role's `task`
 *      field — if it exists — is irrelevant here. See `publicIdentity()`'s own
 *      comment: "Not merged with role: task is per-identity (D-05 write-once
 *      at birth)." A future edit that removes the `task` carve-out will break
 *      the test in `identity-appearance.test.ts`.
 *
 *   2. `displayName` falls back to `capitalizeFirstIdentityKey(identityKey)`,
 *      NOT to the role's `displayName`.
 *      `roleCosmetics.displayName` exists on the wire and is accessible here;
 *      falling through to it is the natural-looking mistake. We do NOT do that.
 *      The display name is per-identity — the capitalized key is the safe default.
 *      A future edit that changes this to fall through to `roleCosmetics.displayName`
 *      will break the carve-out test in `identity-appearance.test.ts`.
 */
export function resolveIdentityAppearance(args: {
  identityKey: string;
  hostId: number;
  cosmetics: RawCosmetics | null;
  roleCosmetics: RawCosmetics | null;
  role: string | null;
  pinned: boolean;
}): ResolvedIdentityAppearance {
  const { identityKey, hostId, role, roleCosmetics, pinned } = args;
  // null cosmetics → treat as empty object (fail-closed contract)
  const cosmetics = args.cosmetics ?? {};

  // --- title: identity ?? role ?? null ---
  const title =
    typeof cosmetics.title === "string"
      ? cosmetics.title
      : typeof roleCosmetics?.title === "string"
        ? roleCosmetics.title
        : null;

  // --- colorHue: identity ?? role ?? null (typeof guard preserves 0 as present) ---
  const colorHue =
    typeof cosmetics.colorHue === "number"
      ? cosmetics.colorHue
      : typeof roleCosmetics?.colorHue === "number"
        ? roleCosmetics.colorHue
        : null;

  // --- voice: identity ?? role ?? null ---
  const voice =
    typeof cosmetics.voice === "string"
      ? cosmetics.voice
      : typeof roleCosmetics?.voice === "string"
        ? roleCosmetics.voice
        : null;

  // --- task: per-identity ONLY, NOT inherited from the role (D-05 write-once at birth) ---
  const task = typeof cosmetics.task === "string" ? cosmetics.task : null;

  // --- project: per-identity ONLY, NOT inherited from the role (Phase 117 D-05) ---
  // Same discipline as `task`. A role's `project:` frontmatter is NOT a
  // fallback — project membership is a per-identity assignment carried in
  // the identity file (not the role file).
  const project =
    typeof cosmetics.project === "string" ? cosmetics.project : null;

  // --- displayName: identity ?? capitalizeFirst(identityKey), NOT the role's displayName ---
  // NOTE: roleCosmetics.displayName is intentionally NOT a fallback here.
  // The safe default is always capitalizeFirstIdentityKey(identityKey).
  const displayName =
    typeof cosmetics.displayName === "string" && cosmetics.displayName.length > 0
      ? cosmetics.displayName
      : capitalizeFirstIdentityKey(identityKey);

  // --- coordinator: identity boolean, safe-default false ---
  const coordinator =
    typeof cosmetics.coordinator === "boolean" ? cosmetics.coordinator : false;

  // --- roleDefaults: pass roleCosmetics through verbatim ---
  // null  → no role resolvable (identity has no role: frontmatter, or role read failed)
  // {}    → role exists but has no cosmetics
  // {...} → role's raw cosmetic values (frontend uses for inherit-vs-override display)
  const roleDefaults = roleCosmetics;

  // --- avatarUrl: deterministic from (identityKey, hostId) ---
  const avatarUrl = `/identities/${identityKey}/avatar?hostId=${hostId}`;

  return {
    displayName,
    title,
    colorHue,
    voice,
    task,
    project,
    coordinator,
    role,
    roleDefaults,
    avatarUrl,
    pinned,
  };
}
