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
