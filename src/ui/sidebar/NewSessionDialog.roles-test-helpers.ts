// Shared test helpers for NewSessionDialog's multi-select Roles group.
//
// The old single-pick `<select aria-label="Role">` was replaced by a
// `<div role="group" aria-labelledby="new-identity-roles-label">` holding one
// `<input type="checkbox" value={slug}>` per role offered by the host. These
// helpers give the NewSessionDialog suites a compact vocabulary for it:
//   - presence of the old select      → queryRolesGroup() !== null
//   - `select.value === "x"`          → pickedRoleValues() equals ["x"]
//   - `select.options`                → roleOptionValues()
//   - `select.disabled`               → every roleCheckboxes() is disabled
//   - `fireEvent.change(select, "x")` → toggleRole("x")

import { fireEvent, screen } from "@testing-library/react";

/** The Roles checkbox group, or null when it is not rendered. */
export function queryRolesGroup(): HTMLElement | null {
  return screen.queryByRole("group", { name: /^roles$/i });
}

/** The Roles checkbox group; throws when it is not rendered. */
export function getRolesGroup(): HTMLElement {
  return screen.getByRole("group", { name: /^roles$/i });
}

/** Every role checkbox inside the group (empty when the group is absent). */
export function roleCheckboxes(): HTMLInputElement[] {
  const group = queryRolesGroup();
  if (!group) return [];
  return Array.from(
    group.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  );
}

/** Role slugs offered by the host, in DOM order. */
export function roleOptionValues(): string[] {
  return roleCheckboxes().map((cb) => cb.value);
}

/** Checked role slugs, in DOM order. */
export function pickedRoleValues(): string[] {
  return roleCheckboxes()
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);
}

/** Click the checkbox for `slug`, toggling it. Throws if no such role. */
export function toggleRole(slug: string): void {
  const cb = roleCheckboxes().find((c) => c.value === slug);
  if (!cb) {
    throw new Error(
      `toggleRole: no role checkbox with value "${slug}" (have: ${roleOptionValues().join(", ") || "none"})`,
    );
  }
  fireEvent.click(cb);
}
