// Shared test helpers for NewSessionDialog's Roles list.
//
// apple-ux (shape-creation-and-search-dialogs, 2026-10-22): the roles are a
// list right in the dialog (RolePickList) instead of a drop-down. Each entry
// is a row `[data-testid="role-pick-<value>"]` that toggles on click and
// carries a check (aria-label "Picked") while picked. Rows sit in one group
// per machine (`[data-testid="role-pick-group-<hostId>"]`), titled with the
// machine's name only when there is more than one machine.
//
// With one machine a row's value is the bare slug; with several it is
// `${hostId}/${slug}`. Each machine's group starts with "No roles", whose
// value is NO_ROLES_VALUE (`${hostId}/${NO_ROLES_VALUE}` with several).
//
// The list shows what is picked, not the order it was picked in — pick order
// is asserted on the birth request (first pick → `role`, the rest → `roles`).
// pickedRoleValues() therefore reads in list order.

import { fireEvent, screen } from "@testing-library/react";

/** The "No roles" entry's value (bare, single-host). */
export const NO_ROLES_VALUE = ":no-roles";

const isNoRolesValue = (v: string) =>
  v === NO_ROLES_VALUE || v.endsWith(`/${NO_ROLES_VALUE}`);

function queryList(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="role-pick-list"]');
}

/**
 * The roles list, or null when it isn't usable yet — absent (shell mode) or
 * still showing "Loading roles…".
 */
export function queryRolesGroup(): HTMLElement | null {
  const list = queryList();
  if (!list) return null;
  if (/loading roles/i.test(list.textContent ?? "")) return null;
  return list;
}

/** The roles list; throws when it is not usable (see queryRolesGroup). */
export function getRolesGroup(): HTMLElement {
  const list = queryRolesGroup();
  if (!list) throw new Error("getRolesGroup: roles list not rendered/loaded");
  return list;
}

/** The list is showing its "Loading roles…" placeholder. */
export function rolesLoading(): boolean {
  const list = queryList();
  return !!list && /loading roles/i.test(list.textContent ?? "");
}

/** Every role row (including "No roles"), in list order. */
export function roleRows(): HTMLElement[] {
  const list = queryList();
  if (!list) return [];
  return Array.from(
    list.querySelectorAll<HTMLElement>(
      '[data-testid^="role-pick-group-"] [data-testid^="role-pick-"]',
    ),
  );
}

const rowValue = (el: HTMLElement) => (el.dataset.testid ?? "").slice("role-pick-".length);

/** The row for a value, or null. */
export function roleRow(value: string): HTMLElement | null {
  return roleRows().find((r) => rowValue(r) === value) ?? null;
}

/** A row is picked when it carries the check. */
export function isPicked(row: HTMLElement): boolean {
  return row.querySelector('[aria-label="Picked"]') !== null;
}

/** A row is disabled while the dialog is busy. */
export function isRowDisabled(row: HTMLElement): boolean {
  if (row.dataset.disabled === "true") return true;
  const btn = row.matches("button") ? (row as HTMLButtonElement) : row.querySelector("button");
  return !!btn && (btn as HTMLButtonElement).disabled;
}

/**
 * Role values in list order (bare slugs single-host, `${hostId}/${slug}`
 * multi-host). "No roles" entries are left out.
 */
export function roleOptionValues(): string[] {
  return roleRows().map(rowValue).filter((v) => !isNoRolesValue(v));
}

/** Toggle the "No roles" entry — the lone one, or `hostId`'s with several hosts. */
export function toggleNoRoles(hostId?: string): void {
  const want = hostId === undefined ? NO_ROLES_VALUE : `${hostId}/${NO_ROLES_VALUE}`;
  const row = roleRow(want);
  if (!row) throw new Error(`toggleNoRoles: no "${want}" row`);
  fireEvent.click(row);
}

/** Picked values, in list order. */
export function pickedRoleValues(): string[] {
  return roleRows().filter(isPicked).map(rowValue);
}

/**
 * Toggle the role `slug` via its row. Matches a row whose value is `slug`
 * (single host) or ends with `/${slug}` (several). Pass `hostId` to pick that
 * host's copy when the same role is on several hosts.
 */
export function toggleRole(slug: string, hostId?: string): void {
  const matches = roleRows().filter((r) => {
    const v = rowValue(r);
    if (hostId !== undefined) return v === `${hostId}/${slug}`;
    return v === slug || v.endsWith(`/${slug}`);
  });
  if (matches.length === 0) {
    throw new Error(
      `toggleRole: no role row "${slug}"${hostId ? ` on host ${hostId}` : ""} (have: ${roleOptionValues().join(", ") || "none"})`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `toggleRole: role "${slug}" is on several hosts (${matches.map(rowValue).join(", ")}) — pass a hostId`,
    );
  }
  fireEvent.click(matches[0]);
}

/** Picked role slugs with any `${hostId}/` prefix stripped, in list order. */
export function pickedRoleSlugs(): string[] {
  return pickedRoleValues().map((v) => v.slice(v.indexOf("/") + 1));
}

/** A row's name (its label, without the description). */
export function rowLabel(row: HTMLElement): string {
  return row.querySelector(".k-row-label")?.textContent ?? "";
}

/** A row's one-line description, or null when it has none. */
export function rowDescription(row: HTMLElement): string | null {
  return row.querySelector(".k-row-desc")?.textContent ?? null;
}

/** Names of the picked rows, in list order. */
export function pickedRoleLabels(): string[] {
  return roleRows().filter(isPicked).map(rowLabel);
}

/** Machine headings in the roles list, in list order. */
export function roleGroupHeaders(): string[] {
  const list = queryList();
  if (!list) return [];
  return Array.from(list.querySelectorAll<HTMLElement>(".k-group-title")).map(
    (el) => el.textContent ?? "",
  );
}

/**
 * The list as rows in DOM order: `# <host>` for a heading, the row's value
 * otherwise. Pins grouping + ordering in one assert.
 */
export function roleListRows(): string[] {
  const list = queryList();
  if (!list) return [];
  return Array.from(
    list.querySelectorAll<HTMLElement>(
      '[data-testid^="role-pick-group-"] .k-group-title, [data-testid^="role-pick-group-"] [data-testid^="role-pick-"]',
    ),
  ).map((el) => (el.classList.contains("k-group-title") ? `# ${el.textContent ?? ""}` : rowValue(el)));
}

/** The "New role…" row, or null. */
export function queryNewRoleRow(): HTMLElement | null {
  return screen.queryByTestId("role-pick-new-role");
}

type RoleStub = {
  name: string;
  description: string;
  displayName?: string | null;
  instanceWide?: boolean;
  avatar?: string;
};

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

/** The admin-only Agent / Shell switch, or null. */
export function queryModeSwitch(): HTMLElement | null {
  return screen.queryByTestId("new-session-identity-mode");
}

/** Switch the admin-only Agent / Shell control to Shell. */
export function chooseShell(): void {
  fireEvent.click(screen.getByTestId("new-session-mode-shell"));
}

/** Switch the admin-only Agent / Shell control back to Agent. */
export function chooseAgent(): void {
  fireEvent.click(screen.getByTestId("new-session-mode-agent"));
}

/** Whether the Shell segment is the pressed one. */
export function shellChosen(): boolean {
  return screen.getByTestId("new-session-mode-shell").getAttribute("aria-pressed") === "true";
}

/** The agent's Name input (always shown in agent mode). */
export function nameInput(): HTMLInputElement {
  return screen.getByLabelText(/^name$/i) as HTMLInputElement;
}

/** Type into the agent's Name input. */
export function typeName(value: string): void {
  fireEvent.change(nameInput(), { target: { value } });
}
