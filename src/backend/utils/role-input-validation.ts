/**
 * role-input-validation.ts — the name + description gates for creating a
 * role, shared by POST /roles (the new-role dialog) and the role-request
 * file drop (spawn-requests/ with `kind: "role"`).
 *
 * Kept dependency-free apart from the pretty-name helper so the spawn-request
 * parser (parse-request-body.ts, deliberately light) can import it.
 */

import { derivePrettyNameSlug } from "./pretty-name-slug.js";

/** Description length cap (bytes) — T-22-04-04 DoS via unbounded payload. */
export const MAX_ROLE_DESCRIPTION_BYTES = 4096;

/** Cap on the derived role slug (folder-name sanity). */
export const MAX_ROLE_SLUG_LENGTH = 64;

export type RoleDisplayNameResult =
  | { ok: true; slug: string; displayName: string }
  | { ok: false; error: string };

/**
 * Typed pretty name → role slug. Error strings are the ones POST /roles has
 * always returned, so the dialog's messages are unchanged.
 */
export function validateRoleDisplayName(raw: unknown): RoleDisplayNameResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "displayName is required" };
  }
  const derivation = derivePrettyNameSlug(raw);
  if (derivation.ok !== true) {
    const error =
      derivation.reason === "empty"
        ? "displayName is required"
        : derivation.reason === "too_long"
          ? "displayName must be 80 characters or fewer"
          : "displayName must contain at least one letter";
    return { ok: false, error };
  }
  // The 80-char input cap means the slug rarely exceeds 64, but digit
  // spell-out can grow strings — defense in depth.
  if (derivation.slug.length > MAX_ROLE_SLUG_LENGTH) {
    return {
      ok: false,
      error: `displayName derived slug exceeds ${MAX_ROLE_SLUG_LENGTH} chars; shorten the name`,
    };
  }
  return { ok: true, slug: derivation.slug, displayName: raw.trim() };
}

export type RoleDescriptionResult =
  | { ok: true; description: string }
  | { ok: false; error: string };

export function validateRoleDescription(raw: unknown): RoleDescriptionResult {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, error: "description is required" };
  }
  if (Buffer.byteLength(raw, "utf-8") > MAX_ROLE_DESCRIPTION_BYTES) {
    return {
      ok: false,
      error: `description must be ≤${MAX_ROLE_DESCRIPTION_BYTES} bytes`,
    };
  }
  return { ok: true, description: raw };
}
