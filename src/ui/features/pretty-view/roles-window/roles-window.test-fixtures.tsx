// Fixtures + helpers for the roles-window test suites. Import AFTER the
// suite's vi.mock calls (see roles-window.test-mocks.tsx).

import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import type { Host, HostFolder } from "@/types/ui-types";
import type { RoleSummary } from "@/api/identities-api";
import { RolesWindow, type NewRoleHop, type RolesWindowStart } from "./RolesWindow";

// The rich editor loads lazily; on a busy box that can take past the
// default 1s wait, so these suites wait longer.
configure({ asyncUtilTimeout: 5000 });

// jsdom lacks ResizeObserver; Radix menus need it.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

export function makeHost(id: string, name: string, overrides: Partial<Host> = {}): Host {
  return {
    id,
    name,
    username: "ubuntu",
    ip: `10.0.0.${id}`,
    port: 22,
    folder: "",
    online: true,
    cpu: null,
    ram: null,
    lastAccess: "",
    authType: "key",
    enableTerminal: true,
    enableTunnel: false,
    serverTunnels: [],
    enableFileManager: false,
    enableDocker: false,
    quickActions: [],
    enableSsh: true,
    enableRdp: false,
    canHostAgents: true,
    enableVnc: false,
    enableTelnet: false,
    sshPort: 22,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
    ...overrides,
  } as Host;
}

export const HOST_ID = 2;
export const SINGLE_HOST_TREE: HostFolder = { name: "root", children: [makeHost("2", "boreal")] };
export const MULTI_HOST_TREE: HostFolder = {
  name: "root",
  children: [makeHost("1", "alpha"), makeHost("2", "boreal"), makeHost("3", "rdp-box", { enableRdp: true, canHostAgents: false }),
    makeHost("4", "windows-box", { enableSsh: false, canHostAgents: false }),
  ],
};

export const BOX: RoleSummary = {
  name: "box-maintainer",
  description: "Keeps the box healthy",
  displayName: "Box Maintainer",
  colorHue: 320,
  avatar: "box-maintainer.webp",
};
export const ALLY: RoleSummary = { name: "ally-role", description: "Friendly helper", displayName: "Ally" };
export const SUPPORT: RoleSummary = {
  name: "support-bot",
  description: "Answers questions",
  displayName: "Support Bot",
  instanceWide: true,
};
export const SUPPORT_ITEM = {
  kind: "role" as const,
  name: "support-bot",
  updatedAt: 1,
  behind: 0,
  conflicts: 0,
  hostCount: 4,
  hosts: [],
};

export function agent(key: string, roles: string[], hostId = HOST_ID, task: string | null = null): Record<string, unknown> {
  return {
    identityKey: key,
    displayName: key.charAt(0).toUpperCase() + key.slice(1),
    title: null,
    colorHue: null,
    voice: null,
    role: roles[0] ?? null,
    roles,
    hostId,
    task,
    avatarMime: "image/png",
    avatarUrl: `/identities/${key}/avatar`,
    avatarEtag: "e",
    coordinator: false,
  };
}

export interface RenderWindowOpts {
  tree?: HostFolder;
  start?: RolesWindowStart;
  newRoleHop?: NewRoleHop | null;
}

/** Mount the roles window; returns its onOpenChange spy. */
export function renderWindow(opts: RenderWindowOpts = {}): { onOpenChange: ReturnType<typeof vi.fn> } {
  const onOpenChange = vi.fn();
  render(
    <RolesWindow
      open={true}
      onOpenChange={onOpenChange}
      hostTree={opts.tree ?? SINGLE_HOST_TREE}
      start={opts.start ?? { view: "library" }}
      newRoleHop={opts.newRoleHop ?? null}
    />,
  );
  return { onOpenChange };
}

/** Open a role from the library by its row. */
export async function openRoleFromLibrary(name: string): Promise<void> {
  fireEvent.click(await screen.findByTestId(`roles-window-row-${name}`));
  await screen.findByTestId("role-view-facts");
}

/** The role view's head label ("‹ Roles") is on screen. */
export function backButton(): HTMLElement {
  return screen.getByTestId("roles-window-back");
}

/** Open a ⋯ menu by its trigger test id; returns the menu element. */
export async function openMenu(testId: string): Promise<HTMLElement> {
  await userEvent.setup().click(await screen.findByTestId(testId));
  return screen.findByRole("menu");
}

/** Press Esc the way a user does (window keydown). */
export function pressEscape(): void {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", code: "Escape" });
}

export async function expectLibrary(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId("roles-window-new-role")).toBeTruthy());
}

export { within };
