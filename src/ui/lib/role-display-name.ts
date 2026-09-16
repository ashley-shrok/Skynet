// Role slugs are kebab-case-lowercase on disk (`box-maintainer`). Every surface
// that shows a role to the user renders this instead: the role's own
// `displayName:` frontmatter when it authored one, else the title-cased slug.
//
// Consolidates the two prior copies at RolesListModal.displayNameFor and
// RoleModal.titleCase.
export function roleDisplayName(
  slug: string,
  displayName?: string | null,
): string {
  if (displayName && displayName.trim().length > 0) return displayName;
  return slug
    .split("-")
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
