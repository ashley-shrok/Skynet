/**
 * PrettyView — an agent's window → the roles window, and back.
 *
 * Clicking a role name in the agent's window (IdentityModal) closes it and
 * opens the roles window straight onto that role, scoped to this agent's
 * host (a one-host tree). Closing the roles window brings the agent's window
 * back. Renders the real PrettyView; the agent's window, its task pill and
 * the roles window are stubs that expose their props.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

vi.mock("@/api/claude-session-api", () => ({
  openClaudeSessionSocket: vi.fn(() => ({
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    onmessage: null,
    onopen: null,
    onerror: null,
    onclose: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
}));

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

const listRolesForHost = vi.fn();
vi.mock("@/api/identities-api", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  listRolesForHost: (...a: unknown[]) => listRolesForHost(...a),
}));

const useSessionIdentityMock = vi.fn((_name?: unknown) => ({
  identity: null as unknown,
  identityHue: null as number | null,
}));
vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: (name: string | null | undefined) => (name ? name.toLowerCase() : null),
  useSessionIdentity: (name: string | null | undefined) => useSessionIdentityMock(name),
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

// The task pill opens the agent's window.
vi.mock("./TaskPill", () => ({
  TaskPill: (props: { onOpen: () => void }) => (
    <button type="button" data-testid="task-pill-stub" onClick={() => props.onOpen()} />
  ),
}));

// The agent's window: a role link per role, behaving like the real one
// (closes itself, then asks for the role).
vi.mock("./IdentityModal", () => ({
  IdentityModal: (props: {
    open: boolean;
    identity: Identity;
    onOpenChange: (o: boolean) => void;
    onOpenRoleModal: (identity: Identity, roleName: string) => void;
  }) =>
    props.open ? (
      <div data-testid="identity-modal-stub">
        {(props.identity.roles ?? [props.identity.role]).map((r) => (
          <button
            key={r}
            type="button"
            data-testid={`role-link-${r}`}
            onClick={() => {
              props.onOpenChange(false);
              props.onOpenRoleModal(props.identity, r as string);
            }}
          />
        ))}
      </div>
    ) : null,
}));

// The roles window: shows where it was asked to start and on which hosts.
vi.mock("./roles-window/RolesWindow", () => ({
  RolesWindow: (props: {
    open: boolean;
    start: unknown;
    hostTree: unknown;
    onOpenChange: (o: boolean) => void;
  }) =>
    props.open ? (
      <div
        data-testid="roles-window-stub"
        data-start={JSON.stringify(props.start)}
        data-tree={JSON.stringify(props.hostTree)}
      >
        <button type="button" data-testid="roles-window-stub-close" onClick={() => props.onOpenChange(false)} />
      </div>
    ) : null,
}));

import { PrettyView } from "./PrettyView";

const IDENTITY: Identity = {
  identityKey: "tabitha",
  displayName: "Tabitha",
  title: "Skynet",
  colorHue: null,
  voice: null,
  role: "box-maintainer",
  roles: ["box-maintainer", "sky-uat"],
  task: null,
  project: null,
  avatarMime: "image/png",
  avatarUrl: "/identities/tabitha/avatar?hostId=7",
  avatarEtag: "etag-1",
  coordinator: false,
  roleDefaults: { displayName: "Box Maintainer", colorHue: 190, voice: "coral", avatar: "bm.webp" },
} as unknown as Identity;

function renderView(): void {
  render(
    <PrettyView
      source={{ kind: "harness", hostId: 7, tmuxSession: "tabitha", tabId: "t1" }}
      hostId={7}
      hostName="Skynet"
      tmuxSession="tabitha"
      tabId="t1"
      isVisible={true}
      onSend={() => true}
    />,
  );
}

async function openAgentWindow(): Promise<void> {
  fireEvent.click(await screen.findByTestId("task-pill-stub"));
  await screen.findByTestId("identity-modal-stub");
}

function windowStart(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId("roles-window-stub").dataset.start ?? "null");
}

describe("PrettyView — agent's window ↔ roles window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRolesForHost.mockResolvedValue([]);
    useSessionIdentityMock.mockReturnValue({ identity: IDENTITY, identityHue: 190 });
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(function () {
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the role link closes the agent's window and opens the roles window on that role, scoped to this host", async () => {
    renderView();
    await openAgentWindow();
    expect(screen.queryByTestId("roles-window-stub")).toBeNull();

    fireEvent.click(screen.getByTestId("role-link-box-maintainer"));

    await screen.findByTestId("roles-window-stub");
    expect(screen.queryByTestId("identity-modal-stub")).toBeNull();
    // The look role comes straight from the agent's roleDefaults — no fetch.
    expect(windowStart()).toEqual({
      view: "role",
      hostId: 7,
      role: {
        name: "box-maintainer",
        description: "",
        displayName: "Box Maintainer",
        colorHue: 190,
        voice: "coral",
        avatar: "bm.webp",
      },
    });
    expect(listRolesForHost).not.toHaveBeenCalled();
    // One host: the agent's own.
    const tree = JSON.parse(screen.getByTestId("roles-window-stub").dataset.tree ?? "null");
    expect(tree.children).toEqual([{ id: "7", name: "Skynet" }]);
  });

  it("closing the roles window brings the agent's window back", async () => {
    renderView();
    await openAgentWindow();
    fireEvent.click(screen.getByTestId("role-link-box-maintainer"));
    fireEvent.click(await screen.findByTestId("roles-window-stub-close"));
    await waitFor(() => expect(screen.queryByTestId("roles-window-stub")).toBeNull());
    expect(await screen.findByTestId("identity-modal-stub")).toBeTruthy();
  });

  it("another role the agent holds is looked up on the host, then opened", async () => {
    const skyUat = { name: "sky-uat", description: "Tests the sky", displayName: "Sky UAT", colorHue: 40 };
    listRolesForHost.mockResolvedValue([skyUat]);
    renderView();
    await openAgentWindow();
    fireEvent.click(screen.getByTestId("role-link-sky-uat"));
    await screen.findByTestId("roles-window-stub");
    expect(listRolesForHost).toHaveBeenCalledWith(7);
    expect(windowStart()).toEqual({ view: "role", hostId: 7, role: skyUat });
  });

  it("a role the host doesn't have opens nothing", async () => {
    renderView();
    await openAgentWindow();
    fireEvent.click(screen.getByTestId("role-link-sky-uat"));
    await waitFor(() => expect(listRolesForHost).toHaveBeenCalledWith(7));
    expect(screen.queryByTestId("roles-window-stub")).toBeNull();
  });
});
