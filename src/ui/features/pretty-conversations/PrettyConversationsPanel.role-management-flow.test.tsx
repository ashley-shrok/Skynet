/**
 * The sidebar and the roles window — end-to-end in-process flows.
 *
 *   A: footer Roles button → the roles window on its library → a role opens
 *      in the SAME window → Esc steps back → Esc closes.
 *   B: new-conversation dialog → "New role…" → the window's new-role view
 *      (swap, not stack) → back restores the dialog with its earlier picks.
 *   C: … → create → back in the dialog with the earlier picks plus the new role.
 *   D: the X during the hop closes everything and drops the picks.
 *   E: a new-conversation request (any role's "Start a conversation") opens
 *      the dialog with that role picked — including from the window's ⋯ menu.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act, within } from "@testing-library/react";
import type { Host, HostFolder } from "@/types/ui-types";

// ── Global mocks ─────────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
}));

vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: (name: string | null | undefined) => (name ? name.toLowerCase() : null),
}));

vi.mock("@/state/trapped-work-store", () => ({
  useTrappedWork: () => undefined,
  startTrappedWorkPoller: () => () => {},
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

vi.mock("@/state/conversation-store", () => ({
  upsertFleetSession: () => {},
  patchRoomProjectAssignment: () => () => {},
  useConversations: () => ({
    activeSet: [],
    pinned: [],
    middle: [],
    rdpGroup: null,
    pinnedUnassigned: [],
    projectSections: [],
    rdp: null,
  }),
  useSelectedConversationId: () => null,
  usePinnedIds: () => new Set(),
  useActiveSet: () => new Set(),
  useFleetSessionsLoaded: () => false,
  getFleetSessionsSnapshot: () => [],
  selectConversation: () => {},
  pinConversation: () => {},
  unpinConversation: () => {},
  addToActiveSet: () => {},
  removeFromActiveSet: () => {},
  fleetRowId: (hostId: number, sessionName: string) => `fleet::${hostId}::${sessionName}`,
  hydratePinnedIdsFromServer: () => {},
  useProjects: () => [],
}));

vi.mock("@/state/use-collapsed-project-slugs", () => ({
  useCollapsedProjectSlugs: () => ({
    collapsed: new Set<string>() as ReadonlySet<string>,
    toggle: () => {},
  }),
}));
vi.mock("@/api/session-project-api", () => ({
  setSessionProject: vi.fn(async () => ({ ok: true })),
  setRelayRoomProject: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/api/user-preferences-api", () => ({
  putPinnedIds: vi.fn().mockResolvedValue([]),
  setIdentityPinned: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/state/session-working-store", () => ({
  useSessionIsWorking: () => false,
  useSessionLastMessageAt: () => null,
  getSessionLastMessageAt: () => null,
  subscribeSessionWorkingStore: (_cb: () => void) => () => {},
  useSessionAiTitle: () => null,
  getSessionWorkingSnapshot: () => new Map(),
  useSessionIsDormant: () => false,
}));

vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({
    byKey: new Map(),
    byHostKey: new Map(),
    identities: [],
    loaded: true,
    refresh: async () => {},
  }),
  applyIdentityChange: vi.fn(),
  deriveDiskPinnedIds: () => [],
  buildIdentityHostsFromFleet: () => ({}),
}));

vi.mock("@/features/pretty-view/SkillsEditorModal", () => ({
  default: (props: { open: boolean }) => (props.open ? <div data-testid="skills-editor-modal-stub" /> : null),
}));

vi.mock("@/api/global-files-api", () => ({
  listGlobalFiles: vi.fn().mockResolvedValue([]),
  readGlobalFile: vi.fn().mockResolvedValue({ content: "", mtime: 0, size: 0 }),
  writeGlobalFile: vi.fn().mockResolvedValue({ mtime: 0 }),
  GlobalFileMtimeConflictError: class GlobalFileMtimeConflictError extends Error {},
}));

vi.mock("@/main-axios", async (o) => ({
  ...((await o()) as Record<string, unknown>),
  getUserInfo: vi.fn().mockResolvedValue({ userId: "u-1" }),
}));

// The roles window's APIs (shared with the roles-window suites).
vi.mock("@/api/identities-api", async (o) => (await import("@/features/pretty-view/roles-window/roles-window.test-mocks")).identitiesApi(o));
vi.mock("@/api/instance-wide-api", async (o) => (await import("@/features/pretty-view/roles-window/roles-window.test-mocks")).instanceWideApi(o));
vi.mock("@/api/roles-archive-list-api", async () => (await import("@/features/pretty-view/roles-window/roles-window.test-mocks")).rolesArchiveListApi());
vi.mock("@/api/role-unarchive-api", async (o) => (await import("@/features/pretty-view/roles-window/roles-window.test-mocks")).roleUnarchiveApi(o));
vi.mock("@/api/role-archive-api", async () => (await import("@/features/pretty-view/roles-window/roles-window.test-mocks")).roleArchiveApi());
vi.mock("@/api/claude-session-api", async (o) => (await import("@/features/pretty-view/roles-window/roles-window.test-mocks")).claudeSessionApi(o));
vi.mock("@/api/role-skills-api", async (o) => (await import("@/features/pretty-view/roles-window/roles-window.test-mocks")).roleSkillsApi(o));
vi.mock("@/api/workspace-git-api", async (o) => (await import("@/features/pretty-view/roles-window/roles-window.test-mocks")).workspaceGitApi(o));
vi.mock("@/api/voice-api", async (o) => (await import("@/features/pretty-view/roles-window/roles-window.test-mocks")).voiceApi(o));
vi.mock("@mdxeditor/editor", async () => (await import("@/features/pretty-view/roles-window/roles-window.test-mocks")).mdxEditor());

// ── Late imports ─────────────────────────────────────────────────────────────
import { PrettyConversationsPanel } from "./PrettyConversationsPanel";
import { __resetKitDialogsForTests } from "@/components/kit";
import { requestNewConversation } from "@/lib/new-conversation-request";
import { m, resetRolesWindowMocks } from "@/features/pretty-view/roles-window/roles-window.test-mocks";
import {
  pickedRoleValues,
  queryNewRoleRow,
  queryRolesGroup,
  roleGroupHeaders,
  roleRow,
  rowDescription,
  toggleRole,
} from "@/sidebar/NewSessionDialog.roles-test-helpers";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
function makeHost(id: string, name: string): Host {
  return {
    id,
    name,
    username: "user",
    ip: "10.0.0.1",
    port: 22,
    folder: "",
    online: true,
    cpu: null,
    ram: null,
    lastAccess: "",
    authType: "password",
    enableTerminal: true,
    enableTunnel: false,
    serverTunnels: [],
    enableFileManager: false,
    enableDocker: false,
    quickActions: [],
    enableSsh: true,
    enableRdp: false,
    // Can host agents — the new-agent dialog only offers such machines.
    canHostAgents: true,
    enableVnc: false,
    enableTelnet: false,
    sshPort: 22,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
  } as Host;
}

const ONE_HOST_TREE: HostFolder = { name: "root", children: [makeHost("3", "hostA")] };

const BOX = { name: "box-maintainer", description: "The box maintainer role", displayName: "Box Maintainer", colorHue: 190 };
const HALL = { name: "hallmonitor", description: "The hall monitor role", displayName: "Hall Monitor", colorHue: 30 };
const MEAL = { name: "meal-planner", description: "Plans meals", displayName: "Meal Planner" };

function renderPanel(): void {
  render(
    <PrettyConversationsPanel
      variant="desktop"
      hostTree={ONE_HOST_TREE}
      onCreateSession={vi.fn()}
      onDeactivateRow={() => {}}
    />,
  );
}

const rolesWindow = (): HTMLElement | null => screen.queryByTestId("roles-window");
const dialogCount = (): number => document.querySelectorAll('[role="dialog"]').length;

function escape(): void {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape", code: "Escape" });
}

/** Open the new-agent dialog, pick hallmonitor, then the list's "New role…" row. */
async function hopToNewRole(): Promise<void> {
  fireEvent.click(screen.getByTestId("pv-header-new-agent-button"));
  await waitFor(() => expect(roleRow("hallmonitor")).toBeTruthy());
  toggleRole("hallmonitor");
  fireEvent.click(queryNewRoleRow()!);
  await screen.findByTestId("new-role-name");
}

beforeEach(() => {
  resetRolesWindowMocks();
  m.listRolesForHost.mockResolvedValue([BOX, HALL]);
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  __resetKitDialogsForTests();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("sidebar → roles window", () => {
  it("A: the footer Roles button opens the window on its library; a role opens in the same window; Esc steps back, then closes", async () => {
    renderPanel();
    expect(rolesWindow()).toBeNull();
    fireEvent.click(screen.getByTestId("pv-footer-roles-button"));

    const win = await screen.findByTestId("roles-window");
    expect(within(win).getByText("Roles")).toBeTruthy();
    // One host → picked for you; its roles listed.
    await within(win).findByTestId("roles-window-row-box-maintainer");
    expect(within(win).getByTestId("roles-window-row-hallmonitor")).toBeTruthy();
    expect(m.listRolesForHost).toHaveBeenCalledWith(3);

    fireEvent.click(within(win).getByTestId("roles-window-row-box-maintainer"));
    await within(win).findByTestId("role-view-facts");
    expect(dialogCount()).toBe(1);
    expect(screen.getByTestId("roles-window")).toBe(win);

    escape();
    await within(win).findByTestId("roles-window-row-box-maintainer");
    expect(rolesWindow()).toBeTruthy();

    escape();
    await waitFor(() => expect(rolesWindow()).toBeNull());
    expect(dialogCount()).toBe(0);
  });

  it("New role from the library opens the form in the same window and lands on the created role (not a new conversation)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob([new Uint8Array(4)]), { status: 200, headers: { "Content-Type": "image/webp" } }),
    );
    m.createRole.mockResolvedValue({ name: "meal-planner", description: "Plans meals", cosmetics: {} });
    renderPanel();
    fireEvent.click(screen.getByTestId("pv-footer-roles-button"));
    fireEvent.click(await screen.findByTestId("roles-window-new-role"));
    fireEvent.change(await screen.findByTestId("new-role-name"), { target: { value: "Meal Planner" } });
    fireEvent.change(screen.getByTestId("new-role-description"), { target: { value: "Plans meals" } });
    m.listRolesForHost.mockResolvedValue([BOX, HALL, MEAL]);
    fireEvent.click(screen.getByRole("button", { name: /Generate picture/ }));
    await waitFor(() => expect(document.querySelectorAll("[data-candidate-id]")).toHaveLength(3));
    fireEvent.click(document.querySelectorAll("[data-candidate-id]")[0]);
    fireEvent.click(screen.getByTestId("new-role-create"));
    await waitFor(() => expect(m.createRole).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(m.getRoleFileByName).toHaveBeenCalledWith({ roleName: "meal-planner", hostId: 3 }));
    expect(await screen.findByTestId("role-view-facts")).toBeTruthy();
    expect(queryRolesGroup()).toBeNull();
    expect(dialogCount()).toBe(1);
  });
});

describe("new-conversation dialog → New role… hop", () => {
  it("B0: the pencil's dialog lists the roles in the dialog — one machine, so no heading — with their descriptions and New role… at the bottom", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("pv-header-new-agent-button"));
    await waitFor(() => expect(roleRow("hallmonitor")).toBeTruthy());
    expect(roleGroupHeaders()).toEqual([]);
    expect(rowDescription(roleRow("hallmonitor")!)).toBe("The hall monitor role");
    expect(rowDescription(roleRow("box-maintainer")!)).toBe("The box maintainer role");
    expect(queryNewRoleRow()).toBeTruthy();
    // One machine: "No roles" is preselected.
    expect(pickedRoleValues()).toEqual([":no-roles"]);
  });

  it("B: New role… swaps to the window's new-role view; back restores the dialog with the earlier picks", async () => {
    renderPanel();
    await hopToNewRole();
    // Swap, not stack: only the roles window is up.
    expect(queryRolesGroup()).toBeNull();
    expect(dialogCount()).toBe(1);
    expect(rolesWindow()).toBeTruthy();
    expect(screen.getByTestId("roles-window-back").textContent).toContain("Back");

    fireEvent.click(screen.getByTestId("roles-window-back"));
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    await waitFor(() => expect(pickedRoleValues()).toEqual(["hallmonitor"]));
    expect(rolesWindow()).toBeNull();
  });

  it("B2: Esc on the new-role view also goes back to the dialog", async () => {
    renderPanel();
    await hopToNewRole();
    escape();
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    await waitFor(() => expect(pickedRoleValues()).toEqual(["hallmonitor"]));
  });

  it("C: creating the role returns to the dialog with the earlier picks plus the new role", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob([new Uint8Array(4)]), { status: 200, headers: { "Content-Type": "image/webp" } }),
    );
    m.createRole.mockResolvedValue({ name: "meal-planner", description: "Plans meals", cosmetics: {} });
    renderPanel();
    await hopToNewRole();
    fireEvent.change(screen.getByTestId("new-role-name"), { target: { value: "Meal Planner" } });
    fireEvent.change(screen.getByTestId("new-role-description"), { target: { value: "Plans meals" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate picture/ }));
    await waitFor(() => expect(document.querySelectorAll("[data-candidate-id]")).toHaveLength(3));
    fireEvent.click(document.querySelectorAll("[data-candidate-id]")[0]);
    // The dialog re-lists roles when it comes back — the new one included.
    m.listRolesForHost.mockResolvedValue([BOX, HALL, MEAL]);
    fireEvent.click(screen.getByTestId("new-role-create"));

    await waitFor(() => expect(m.createRole).toHaveBeenCalledTimes(1));
    expect((m.createRole.mock.calls[0][0] as { hostId: number }).hostId).toBe(3);
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    await waitFor(() => expect(pickedRoleValues()).toEqual(["hallmonitor", "meal-planner"]));
    expect(rolesWindow()).toBeNull();
    expect(dialogCount()).toBe(1);
  });

  it("D: the X during the hop closes the window and doesn't bring the dialog back", async () => {
    renderPanel();
    await hopToNewRole();
    fireEvent.click(screen.getByTestId("roles-window-close"));
    await waitFor(() => expect(rolesWindow()).toBeNull());
    expect(queryRolesGroup()).toBeNull();
    // A fresh open of the dialog doesn't inherit the hop's picks.
    fireEvent.click(screen.getByTestId("pv-header-new-agent-button"));
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    expect(pickedRoleValues()).not.toContain("hallmonitor");
  });
});

describe("new-conversation request", () => {
  it("E: a request opens the new-conversation dialog with that role picked", async () => {
    renderPanel();
    expect(queryRolesGroup()).toBeNull();
    act(() => requestNewConversation({ hostId: 3, role: "box-maintainer" }));
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    await waitFor(() => expect(pickedRoleValues()).toEqual(["box-maintainer"]));
  });

  it("E2: Start a conversation in the roles window's ⋯ menu closes the window and opens the dialog with the role", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("pv-footer-roles-button"));
    fireEvent.click(await screen.findByTestId("roles-window-row-hallmonitor"));
    await screen.findByTestId("role-view-facts");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(screen.getByTestId("role-view-menu"));
    fireEvent.click(await screen.findByTestId("role-view-start-conversation"));
    await waitFor(() => expect(rolesWindow()).toBeNull());
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    await waitFor(() => expect(pickedRoleValues()).toEqual(["hallmonitor"]));
    expect(dialogCount()).toBe(1);
  });
});
