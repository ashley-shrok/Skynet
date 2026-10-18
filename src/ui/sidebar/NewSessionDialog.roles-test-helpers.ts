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
//
// 2026-10-18 (no host step for agents): the dialog lists every host's roles
// in one dropdown. With one host an option's data-value is the bare slug;
// with several it is `${hostId}/${slug}`, under a per-host header row
// ([data-testid="multi-select-group"]), and the pill carries the same
// composite value. toggleRole(slug, hostId?) accepts the bare slug either
// way; pickedRoleSlugs() strips the host prefix off the pills.
//
// Roles are optional: each host's entries start with a "No roles" option
// whose data-value is NO_ROLES_VALUE (`${hostId}/${NO_ROLES_VALUE}` with
// several hosts). roleOptionValues() leaves those out so it lists real roles
// only; roleListRows() keeps them; toggleNoRoles(hostId?) clicks one.

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
 * The Roles trigger, or null when it isn't usable yet — absent (shell
 * mode) or still showing the "Loading roles..." placeholder. Mirrors
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

/** The "No roles" option's data-value (bare, single-host). */
export const NO_ROLES_VALUE = ":no-roles";

const isNoRolesValue = (v: string) =>
  v === NO_ROLES_VALUE || v.endsWith(`/${NO_ROLES_VALUE}`);

/**
 * Role option data-values in list order (bare slugs single-host,
 * `${hostId}/${slug}` multi-host). "No roles" entries are left out.
 */
export function roleOptionValues(): string[] {
  return roleOptions()
    .map((o) => o.dataset.value ?? "")
    .filter((v) => !isNoRolesValue(v));
}

/** Toggle the "No roles" entry — the flat one, or `hostId`'s with several hosts. */
export function toggleNoRoles(hostId?: string): void {
  const want = hostId === undefined ? NO_ROLES_VALUE : `${hostId}/${NO_ROLES_VALUE}`;
  const match = roleOptions().find((o) => o.dataset.value === want);
  if (!match) throw new Error(`toggleNoRoles: no "${want}" option`);
  fireEvent.click(match);
}

/** Picked option values, in pick order (read off the trigger's pills). */
export function pickedRoleValues(): string[] {
  const t = queryTrigger();
  if (!t) return [];
  return Array.from(t.querySelectorAll<HTMLElement>("[data-selected-value]")).map(
    (el) => el.dataset.selectedValue ?? "",
  );
}

/**
 * Toggle the role `slug` via its list option. Matches an option whose
 * data-value is `slug` (single-host, flat list) or ends with `/${slug}`
 * (multi-host, `${hostId}/${slug}`). Pass `hostId` to pick that host's copy
 * when the same role is on several hosts. Throws if no option matches, or if
 * more than one does and `hostId` was not given.
 */
export function toggleRole(slug: string, hostId?: string): void {
  const matches = roleOptions().filter((o) => {
    const v = o.dataset.value ?? "";
    if (hostId !== undefined) return v === `${hostId}/${slug}`;
    return v === slug || v.endsWith(`/${slug}`);
  });
  if (matches.length === 0) {
    throw new Error(
      `toggleRole: no role option "${slug}"${hostId ? ` on host ${hostId}` : ""} (have: ${roleOptionValues().join(", ") || "none"})`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `toggleRole: role "${slug}" is on several hosts (${matches.map((o) => o.dataset.value).join(", ")}) — pass a hostId`,
    );
  }
  fireEvent.click(matches[0]);
}

/** Picked role slugs with any `${hostId}/` prefix stripped, in pick order. */
export function pickedRoleSlugs(): string[] {
  return pickedRoleValues().map((v) => v.slice(v.indexOf("/") + 1));
}

/** Pill texts on the trigger, in pick order. */
export function pickedRoleLabels(): string[] {
  const t = queryTrigger();
  if (!t) return [];
  return Array.from(t.querySelectorAll<HTMLElement>("[data-selected-value]")).map(
    (el) => el.textContent ?? "",
  );
}

/** Host section headers in the open Roles list, in list order. */
export function roleGroupHeaders(): string[] {
  roleOptions(); // opens the list if needed
  const list = screen.queryByRole("listbox", { name: /^roles$/i });
  if (!list) return [];
  return Array.from(
    list.querySelectorAll<HTMLElement>('[data-testid="multi-select-group"]'),
  ).map((el) => el.textContent ?? "");
}

/**
 * The open Roles list as rows in DOM order: `# <host>` for a header, the
 * option's data-value otherwise. Pins sectioning + ordering in one assert.
 */
export function roleListRows(): string[] {
  roleOptions();
  const list = screen.queryByRole("listbox", { name: /^roles$/i });
  if (!list) return [];
  return Array.from(
    list.querySelectorAll<HTMLElement>(
      '[data-testid="multi-select-group"], [role="option"]',
    ),
  ).map((el) =>
    el.dataset.testid === "multi-select-group"
      ? `# ${el.textContent ?? ""}`
      : (el.dataset.value ?? ""),
  );
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

type RoleStub = { name: string; description: string; displayName?: string | null; instanceWide?: boolean };

/**
 * A listRolesForHost mock implementation answering per host, keyed by the
 * numeric host id the dialog passes (parseInt of Host.id — fixtures must use
 * numeric-string ids like "1" for this to tell hosts apart). A value can be
 * a role list (resolves), an Error (rejects), or a Promise (e.g. from
 * deferred(), to hold a host in its loading state). Unlisted hosts answer [].
 */
export function rolesByHost(
  map: Record<number, RoleStub[] | Error | Promise<RoleStub[]>>,
): (hostId: number) => Promise<RoleStub[]> {
  return (hostId: number) => {
    const v = map[hostId];
    if (v === undefined) return Promise.resolve([]);
    if (v instanceof Error) return Promise.reject(v);
    if (v instanceof Promise) return v;
    return Promise.resolve(v);
  };
}

/** A promise plus its resolve/reject, for holding a host's roles request open. */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
