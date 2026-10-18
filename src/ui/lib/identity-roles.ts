import type { Identity } from "@/api/identities-api";
import { roleDisplayName } from "@/lib/role-display-name";

/**
 * Every role an identity holds, in frontmatter order. Prefers the backend's
 * `roles` list; falls back to the single `role` for payloads that predate it.
 * Use this — not `identity.role` — wherever the UI says WHICH roles an
 * identity has: `role` is null for a multi-role identity, because `role` is
 * the one role whose look the identity inherits.
 */
export function identityRoles(
  identity: Pick<Identity, "role" | "roles">,
): string[] {
  if (Array.isArray(identity.roles)) {
    return identity.roles.filter((r) => typeof r === "string" && r.length > 0);
  }
  return typeof identity.role === "string" && identity.role.length > 0
    ? [identity.role]
    : [];
}

/**
 * Display label for every role the identity holds, comma-separated
 * ("Box Maintainer, Sky Uat"). The inherited-look role uses its frontmatter
 * displayName (from roleDefaults); others title-case their slug. "" when the
 * identity holds no role.
 */
export function identityRolesLabel(
  identity: Pick<Identity, "role" | "roles" | "roleDefaults">,
): string {
  return identityRoles(identity)
    .map((r) =>
      roleDisplayName(
        r,
        r === identity.role ? identity.roleDefaults?.displayName : undefined,
      ),
    )
    .join(", ");
}

/**
 * True when the identity holds more than one role. A multi-role identity
 * inherits no role's look; with no colorHue of its own the backend resolves
 * it to gold (`MULTI_ROLE_GOLD_HUE` in identity-appearance.ts), and the UI
 * adds a metallic sheen via the `pv-multi-role` class (index.css).
 */
export function isMultiRole(
  identity: Pick<Identity, "role" | "roles"> | null | undefined,
): boolean {
  return identity != null && identityRoles(identity).length > 1;
}

/**
 * True when the identity holds no roles and has no colorHue of its own. With
 * no role to borrow a look from, it paints in one neutral grey on every
 * surface (the `pv-neutral` class, index.css; `identityTint` for surfaces that
 * build their colors in JS) rather than each surface's own default hue.
 */
export function hasNeutralLook(
  identity: Pick<Identity, "role" | "roles" | "colorHue"> | null | undefined,
): boolean {
  return identity != null && identity.colorHue == null && identityRoles(identity).length === 0;
}

/**
 * The hue a neutral identity carries in --pv-hue / --pv-id-hue — the
 * canonical modal's slate. Only small accents the grey doesn't cover reach it.
 */
export const NEUTRAL_HUE = 220;

/**
 * hsla() for an identity tint at the given saturation / lightness / alpha —
 * the same lightness and alpha in grey when `neutral`.
 */
export function identityTint(
  hue: number,
  neutral: boolean,
): (saturation: number, lightness: number, alpha: number) => string {
  return (s, l, a) =>
    neutral ? `hsla(0, 0%, ${l}%, ${a})` : `hsla(${hue}, ${s}%, ${l}%, ${a})`;
}
