// Shared test helpers for NewSessionDialog's Roles multi-select.
//
// The old single-pick `<select aria-label="Role">` was replaced by a
// dropdown multi-select (components/multi-select.tsx): a combobox trigger
// named "Roles" that shows the picked roles as pills, opening a listbox of
// `role="option"` buttons (data-value={slug}) that toggle on click. These
// helpers give the NewSessionDialog suites a compact vocabulary for it:
//   - presence of the old select      → queryRolesGroup() !== null
//   - `select.value === "x"`          → pickedRoleValues() equals ["x"]
//   - `select.options`                → roleOptionValues()
//   - `select.disabled`               → getRolesGroup().disabled
//   - `fireEvent.change(select, "x")` → toggleRole("x")

import { fireEvent, screen } from "@testing-library/react";

function queryTrigger(): HTMLButtonElement | null {
  // Preferred path: role-based query. Breaks when the Roles MultiSelect's
  // Popover is open and running in modal mode (added by the role-dropdown
  // scroll fix) — Radix stamps aria-hidden="true" on the parent Dialog
  // while the modal popover is active, and testing-library honors
  // aria-hidden and returns null. The pills we read live on the trigger
  // itself (not on hidden siblings), so for test purposes a DOM query is
  // the right fallback — the user's actual accessibility experience is
  // not affected by this bypass.
  const byRole = screen.queryByRole("combobox", {
    name: /^roles$/i,
  }) as HTMLButtonElement | null;
  if (byRole) return byRole;
  return document.querySelector<HTMLButtonElement>(
    'button[role=combobox][aria-label=Roles]',
  );
}

/**
 * The Roles trigger, or null when it isn't usable yet — absent (no host /
 * shell mode) or still showing the "Loading roles..." placeholder. Mirrors
 * when the old select had its options populated.
 */
export function queryRolesGroup(): HTMLButtonElement | null {
  const t = queryTrigger();
  if (!t) return null;
  if (/loading roles/i.test(t.textContent ?? "")) return null;
  return t;
}

/** The Roles trigger; throws when it is not usable (see queryRolesGroup). */
export function getRolesGroup(): HTMLButtonElement {
  const t = queryRolesGroup();
  if (!t) throw new Error("getRolesGroup: Roles multi-select not rendered/loaded");
  return t;
}

/** Open the Roles list (if closed) and return its option buttons. */
export function roleOptions(): HTMLButtonElement[] {
  const t = queryRolesGroup();
  if (!t || t.disabled) return [];
  if (t.getAttribute("aria-expanded") !== "true") fireEvent.click(t);
  const list = screen.queryByRole("listbox", { name: /^roles$/i });
  if (!list) return [];
  return Array.from(list.querySelectorAll<HTMLButtonElement>('[role="option"]'));
}

/** Role slugs offered by the host, in list order. */
export function roleOptionValues(): string[] {
  return roleOptions().map((o) => o.dataset.value ?? "");
}

/** Picked role slugs, in pick order (read off the trigger's pills). */
export function pickedRoleValues(): string[] {
  const t = queryTrigger();
  if (!t) return [];
  return Array.from(t.querySelectorAll<HTMLElement>("[data-selected-value]")).map(
    (el) => el.dataset.selectedValue ?? "",
  );
}

/** Toggle the role `slug` via its list option. Throws if no such role. */
export function toggleRole(slug: string): void {
  const opt = roleOptions().find((o) => o.dataset.value === slug);
  if (!opt) {
    throw new Error(
      `toggleRole: no role option "${slug}" (have: ${roleOptionValues().join(", ") || "none"})`,
    );
  }
  fireEvent.click(opt);
}

/**
 * Close the Roles multi-select popover if it is open. Needed before tests
 * interact with Dialog buttons like "Create": the Popover is modal, which
 * stamps aria-hidden="true" on the parent Dialog while open, blocking
 * testing-library's role-based queries for anything inside the Dialog.
 * No-op when already closed. The user flow is equivalent to clicking
 * outside the dropdown; here we fire Escape against the open trigger,
 * which Radix maps to onOpenChange(false).
 */
export function closeRoleDropdown(): void {
  const t = queryTrigger();
  if (!t) return;
  if (t.getAttribute("aria-expanded") !== "true") return;
  fireEvent.keyDown(t, { key: "Escape", code: "Escape" });
}
