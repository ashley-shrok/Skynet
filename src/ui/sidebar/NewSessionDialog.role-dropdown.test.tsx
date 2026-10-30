// ─── NewSessionDialog roles coverage (Phase 22 SRIC-02 Plan 22-02 Task 4) ────
//
// Covers the Roles part of the new-conversation dialog in agent mode:
//   - Every machine that can host agents is asked for its roles at open
//   - Create is blocked until "No roles" or a role is picked
//   - Zero roles is a normal choice ("No roles")
//   - Role state resets on close
//   - The roles are absent in the admin-only Shell mode
//   - The birth request carries the picked roles, in pick order
//
// 2026-10-18 (no host step for agents): one host → bare-slug values and no
// headings; several → one group per host (alphabetical, case-insensitive),
// values `${hostId}/${slug}`. The picked role decides the host; a role from a
// different host replaces the earlier picks.
//
// 2026-10-22 (apple-ux, shape-creation-and-search-dialogs): the roles are a
// list in the dialog (RolePickList) instead of a drop-down — rows with a
// picture, the name, the one-line description and a check when picked; the
// machine's name as a heading only when there is more than one machine; a
// search box past eight roles; "New role…" at the bottom. The pill labels the
// drop-down had ("Tina · bravo") are gone — a row's machine is its group.
// The "Choose a custom agent name" tick-box is gone too; the Name field is
// always there.
//
// Fixture host ids are numeric strings ("1", "2"): the dialog passes
// parseInt(host.id) to listRolesForHost, and rolesByHost() keys on that.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, screen, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
}));

// Mock identities-api — including the NEW listRolesForHost from Task 1
const mockListIdentities = vi.fn().mockResolvedValue([]);
const mockPostGenerateAvatarBatch = vi.fn();
const mockGetIdentityExistsOnHost = vi.fn().mockResolvedValue(false);
const mockOpenBirthStream = vi.fn();
const mockListRolesForHost = vi.fn();
// Phase 80 Plan 80-06 Task 2: NewSessionDialog now fires pickPoolName on role
// changes in identity-mode. Reject silently so this role-dropdown suite is
// unaffected by pool prefill (dedicated task-input.test.tsx covers pool).
const mockPickPoolName = vi.fn().mockRejectedValue(
  new Error("pickPoolName not exercised in role-dropdown.test.tsx"),
);

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listIdentities: (...args: unknown[]) => mockListIdentities(...args),
    postGenerateAvatarBatch: (...args: unknown[]) =>
      mockPostGenerateAvatarBatch(...args),
    getIdentityExistsOnHost: (...args: unknown[]) =>
      mockGetIdentityExistsOnHost(...args),
    openBirthStream: (...args: unknown[]) => mockOpenBirthStream(...args),
    listRolesForHost: (...args: unknown[]) => mockListRolesForHost(...args),
    pickPoolName: (...args: unknown[]) => mockPickPoolName(...args),
  };
});

// Sibling mocks lifted from NewSessionDialog.test.tsx so this file is
// self-contained (identity registry + voice + session-hue).
vi.mock("@/api/voice-api", () => ({
  SAMPLE_PHRASE: "Hi.",
  postSpeak: vi.fn().mockResolvedValue(new Blob(["a"], { type: "audio/mpeg" })),
  postSpeakStream: vi.fn(),
}));
vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: () => null,
  useSessionIdentity: () => ({ identity: null, identityHue: null }),
}));
vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({ byKey: new Map() }),
}));
vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

// Empty stream helper — used by tests that need to click Create to trigger the
// birth payload capture without actually running the full birth flow.
async function* emptyStream() {
  // nothing — resolves immediately
}


import { NewSessionDialog } from "./NewSessionDialog";
import { clearHostRolesCache } from "./host-roles-cache";
import {
  queryRolesGroup,
  roleOptionValues,
  pickedRoleValues,
  pickedRoleSlugs,
  pickedRoleLabels,
  roleGroupHeaders,
  roleListRows,
  roleRow,
  rowLabel,
  rowDescription,
  rolesLoading,
  toggleRole,
  rolesByHost,
  deferred,
  toggleNoRoles,
  queryNewRoleRow,
  chooseShell,
  chooseAgent,
  typeName,
  nameInput,
  NO_ROLES_VALUE,
} from "./NewSessionDialog.roles-test-helpers";
import type { Host, HostFolder } from "@/types/ui-types";

function makeHost(id: string, name: string, overrides: Partial<Host> = {}): Host {
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
    // Can host agents — agent mode only offers such machines.
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

const twoHostTree: HostFolder = {
  name: "root",
  children: [
    makeHost("1", "alpha", { username: "root", ip: "10.0.0.1" }),
    makeHost("2", "bravo", { username: "root", ip: "10.0.0.2" }),
  ],
};

const oneHostTree: HostFolder = {
  name: "root",
  children: [makeHost("1", "alpha", { username: "root", ip: "10.0.0.1" })],
};

// Tree order deliberately NOT alphabetical (and mixed case) so grouping
// order is observable; the RDP host is not pickable and must not be asked.
const mixedTree: HostFolder = {
  name: "root",
  children: [
    makeHost("1", "zulu"),
    { name: "f", children: [makeHost("2", "Alpha"), makeHost("3", "mike")] } as HostFolder,
    makeHost("4", "rdp-box", { enableRdp: true }),
  ],
};

const role = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  description: "",
  ...extra,
});

// renderDialog defaults to isAdmin=true (the admin surface is a superset);
// agent mode is the default either way, so the roles list shows on mount.
function renderDialog(overrides: {
  open?: boolean;
  onClose?: () => void;
  onCreate?: ReturnType<typeof vi.fn>;
  hostTree?: HostFolder;
  isAdmin?: boolean;
} = {}) {
  const onCreate = overrides.onCreate ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  const result = render(
    <NewSessionDialog
      open={overrides.open ?? true}
      onClose={onClose}
      hostTree={overrides.hostTree ?? twoHostTree}
      onCreate={onCreate}
      isAdmin={overrides.isAdmin ?? true}
    />,
  );
  return { ...result, onCreate, onClose };
}

/** Type a name of the user's own (the Name field is always shown). */
function typeCustomName(name = "alicia") {
  typeName(name);
}

const createBtn = () =>
  screen.getByRole("button", { name: /^(open|create|creating)/i }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  clearHostRolesCache();
  // Default: no roles returned (individual tests override)
  mockListRolesForHost.mockResolvedValue([]);
  mockListIdentities.mockResolvedValue([]);
  mockGetIdentityExistsOnHost.mockResolvedValue(false);
  mockPickPoolName.mockRejectedValue(
    new Error("pickPoolName not exercised in role-dropdown.test.tsx"),
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 20: opening the dialog asks every pickable host for its roles, once
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog roles: Test 20 — open fetches roles from every host", () => {
  it("Test 20: open in agent mode → listRolesForHost called once per non-RDP host; no host list; picking does not refetch", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("zed")], 2: [role("ay"), role("bee")], 3: [role("em")] }),
    );
    renderDialog({ hostTree: mixedTree });
    await waitFor(() => expect(mockListRolesForHost).toHaveBeenCalledTimes(3));
    const ids = mockListRolesForHost.mock.calls.map((c) => c[0]).sort();
    expect(ids).toEqual([1, 2, 3]);
    // No host step in agent mode.
    expect(screen.queryByLabelText(/search hosts/i)).toBeNull();
    expect(screen.queryByText(/pick a host/i)).toBeNull();

    await waitFor(() => expect(roleOptionValues()).toHaveLength(4));
    toggleRole("ay");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["2/ay"]));
    toggleRole("zed");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["1/zed"]));
    await new Promise((r) => setTimeout(r, 20));
    expect(mockListRolesForHost).toHaveBeenCalledTimes(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 21: the roles render as rows in the dialog
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog roles: Test 21 — roles render as rows in the dialog", () => {
  it("Test 21: single host with two roles → bare-slug rows, no machine heading, host auto-selected", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("box-maintainer"), role("tina")] }),
    );
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    renderDialog({ hostTree: oneHostTree });
    await waitFor(() => expect(roleOptionValues()).toEqual(["box-maintainer", "tina"]));
    expect(roleListRows()).toEqual([NO_ROLES_VALUE, "box-maintainer", "tina"]);
    // Shape §What would make it wrong: no machine heading with one machine.
    expect(roleGroupHeaders()).toEqual([]);
    expect(screen.queryByText("alpha")).toBeNull();
    // The list is in the dialog itself — no drop-down trigger to open.
    expect(screen.queryByRole("combobox", { name: /roles/i })).toBeNull();
    toggleRole("tina");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["tina"]));
    expect(pickedRoleLabels()).toEqual(["Tina"]);
    // The sole host was picked for us — Create goes to it.
    typeCustomName();
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.hostId).toBe(1);
    expect(payload.role).toBe("tina");
  });

  it("Test 21b: several hosts → groups alphabetical by host name (case-insensitive), a heading each, composite values; a zero-role host's group holds just \"No roles\"", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("zed")], 2: [role("ay"), role("bee")], 3: [] }),
    );
    renderDialog({ hostTree: mixedTree });
    await waitFor(() => expect(roleOptionValues()).toHaveLength(3));
    expect(roleListRows()).toEqual([
      "# Alpha", `2/${NO_ROLES_VALUE}`, "2/ay", "2/bee",
      "# mike", `3/${NO_ROLES_VALUE}`,
      "# zulu", `1/${NO_ROLES_VALUE}`, "1/zed",
    ]);
    expect(roleGroupHeaders()).toEqual(["Alpha", "mike", "zulu"]);
  });

  it("Test 21c: three hosts with roles → headings Alpha, mike, zulu in that order", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("zed")], 2: [role("ay")], 3: [role("em")] }),
    );
    renderDialog({ hostTree: mixedTree });
    await waitFor(() => expect(roleOptionValues()).toHaveLength(3));
    expect(roleListRows()).toEqual([
      "# Alpha", `2/${NO_ROLES_VALUE}`, "2/ay",
      "# mike", `3/${NO_ROLES_VALUE}`, "3/em",
      "# zulu", `1/${NO_ROLES_VALUE}`, "1/zed",
    ]);
  });

  it("Test 21d: a row shows the role's display name, \"· on every host\" for an instance-wide role, and its one-line description; the picked row sits under its machine", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({
        1: [
          role("tina", { description: "Keeps the books tidy." }),
          role("ops", { displayName: "Ops Crew", instanceWide: true }),
        ],
        2: [role("tina")],
      }),
    );
    renderDialog();
    await waitFor(() => expect(roleOptionValues()).toHaveLength(3));
    expect(rowLabel(roleRow("1/tina")!)).toBe("Tina");
    expect(rowDescription(roleRow("1/tina")!)).toBe("Keeps the books tidy.");
    // A role with no description yet shows just its name.
    expect(rowDescription(roleRow("2/tina")!)).toBeNull();
    expect(rowLabel(roleRow("1/ops")!)).toBe("Ops Crew · on every host");
    // "No roles" explains itself.
    expect(rowLabel(roleRow(`1/${NO_ROLES_VALUE}`)!)).toBe("No roles");
    expect(rowDescription(roleRow(`1/${NO_ROLES_VALUE}`)!)).toMatch(/a plain agent/i);

    toggleRole("tina", "2");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["2/tina"]));
    expect(
      screen.getByTestId("role-pick-group-2").contains(roleRow("2/tina")),
    ).toBe(true);
    toggleRole("ops");
    await waitFor(() => expect(pickedRoleLabels()).toEqual(["Ops Crew · on every host"]));
  });

  it("Test 21e: a role with a picture shows it; one without shows its initial", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("tina", { avatar: "avatar.png" }), role("ops")] }),
    );
    renderDialog({ hostTree: oneHostTree });
    await waitFor(() => expect(roleOptionValues()).toEqual(["tina", "ops"]));
    const img = roleRow("tina")!.querySelector("img");
    expect(img).toBeTruthy();
    expect(img!.getAttribute("src")).toMatch(/tina/);
    expect(roleRow("ops")!.querySelector("img")).toBeNull();
    expect(roleRow("ops")!.textContent).toContain("O");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Search past eight roles
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog roles: search past eight roles", () => {
  const names = ["ant", "bee", "cat", "dog", "eel", "fox", "gnu", "hen", "ibis"];

  it("eight roles → no search box", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: names.slice(0, 8).map((n) => role(n)) }));
    renderDialog({ hostTree: oneHostTree });
    await waitFor(() => expect(roleOptionValues()).toHaveLength(8));
    expect(screen.queryByLabelText(/search roles/i)).toBeNull();
  });

  it("nine roles → a search box that narrows the list (No roles hidden while searching); a pick survives the filter", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: names.slice(0, 5).map((n) => role(n)), 2: names.slice(5).map((n) => role(n, { description: "a bird" })) }),
    );
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    renderDialog();
    await waitFor(() => expect(roleOptionValues()).toHaveLength(9));
    const search = screen.getByLabelText(/search roles/i);
    toggleRole("cat");
    fireEvent.change(search, { target: { value: "bird" } });
    // Matches description text; groups with no match drop out.
    expect(roleOptionValues()).toEqual(["2/fox", "2/gnu", "2/hen", "2/ibis"]);
    expect(roleListRows()).not.toContain(`2/${NO_ROLES_VALUE}`);
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(roleOptionValues()).toEqual([]);
    expect(screen.getByTestId("role-pick-no-matches")).toBeTruthy();
    fireEvent.change(search, { target: { value: "" } });
    expect(pickedRoleValues()).toEqual(["1/cat"]);
    typeCustomName();
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    expect(mockOpenBirthStream.mock.calls[0][0]).toMatchObject({ hostId: 1, role: "cat" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 22: a role from a different host replaces the picks (and the host)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog roles: Test 22 — role from another host switches host", () => {
  it("Test 22: pick two of alpha's roles → pick one of bravo's → picks are just bravo's; birth goes to bravo", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({
        1: [role("box-maintainer"), role("tina")],
        2: [role("other-role"), role("another-role")],
      }),
    );
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    renderDialog();
    await waitFor(() => expect(roleOptionValues()).toHaveLength(4));
    toggleRole("tina");
    toggleRole("box-maintainer");
    await waitFor(() =>
      expect(pickedRoleValues()).toEqual(["1/box-maintainer", "1/tina"]),
    );
    toggleRole("other-role");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["2/other-role"]));
    // Same-host picks add again.
    toggleRole("another-role");
    await waitFor(() =>
      expect(pickedRoleValues()).toEqual(["2/other-role", "2/another-role"]),
    );
    // Un-picking within the host just removes it.
    toggleRole("another-role");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["2/other-role"]));
    // No refetch from any of this.
    expect(mockListRolesForHost).toHaveBeenCalledTimes(2);

    typeCustomName();
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.hostId).toBe(2);
    expect(payload.role).toBe("other-role");
    expect("roles" in payload).toBe(false);
  });

  it("Test 22b: exactly one role across all hosts → nothing auto-selects", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [], 2: [role("only-role")] }),
    );
    renderDialog();
    await waitFor(() => expect(roleOptionValues()).toEqual(["2/only-role"]));
    await new Promise((r) => setTimeout(r, 20));
    expect(pickedRoleValues()).toEqual([]);
  });

  it("Test 22c: one role on each of two hosts → nothing auto-selects", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("tina")], 2: [role("tina")] }),
    );
    renderDialog();
    await waitFor(() => expect(roleOptionValues()).toEqual(["1/tina", "2/tina"]));
    await new Promise((r) => setTimeout(r, 20));
    expect(pickedRoleValues()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 23: Create disabled while nothing is picked
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog roles: Test 23 — Create blocked without a roles pick", () => {
  it("Test 23: multi-host, name valid but no role picked → Create disabled; pick a role → enabled", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("box-maintainer")], 2: [role("general-assistant")] }),
    );
    renderDialog();
    await waitFor(() => expect(roleOptionValues()).toHaveLength(2));
    // Before a role is picked (several machines) the name says so.
    expect(nameInput().placeholder).toBe("Pick a role first");
    typeCustomName();
    // Create still disabled — nothing (and so no host) picked
    expect(createBtn().disabled).toBe(true);
    toggleRole("box-maintainer");
    await waitFor(() => expect(createBtn().disabled).toBe(false));
  });

  it("Test 23b: one host with a single role → \"No roles\" preselected, Create enabled without touching the roles", async () => {
    // A lone role is not auto-selected; the one-host default is "No roles",
    // so Create is still reachable with zero interactions beyond opening.
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("box-maintainer")] }),
    );
    mockPickPoolName.mockResolvedValue({ name: "willow" });
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    renderDialog({ hostTree: oneHostTree });

    await waitFor(() => expect(roleOptionValues()).toEqual(["box-maintainer"]));
    expect(pickedRoleValues()).toEqual([NO_ROLES_VALUE]);
    expect(pickedRoleLabels()).toEqual(["No roles"]);
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.hostId).toBe(1);
    expect(payload.name).toBe("willow");
    expect("role" in payload).toBe(false);
    expect("roles" in payload).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 24: birth payload includes role
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog roles: Test 24 — birth payload carries role", () => {
  it("Test 24: submit success → openBirthStream body includes role: <picked>", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("box-maintainer")] }),
    );
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    renderDialog({ hostTree: oneHostTree });
    await waitFor(() => expect(roleOptionValues()).toEqual(["box-maintainer"]));
    typeCustomName();
    // Picking the role replaces the preselected "No roles".
    toggleRole("box-maintainer");
    await waitFor(() => {
      expect(pickedRoleValues()).toEqual(["box-maintainer"]);
    });
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => {
      expect(mockOpenBirthStream).toHaveBeenCalledTimes(1);
    });
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.role).toBe("box-maintainer");
    // Single pick → no `roles` key at all.
    expect("roles" in payload).toBe(false);
  });
});

describe("NewSessionDialog roles: several picks", () => {
  const threeRoles = [role("box-maintainer"), role("sky-uat"), role("tina")];

  // alpha holds the three roles; bravo holds one more so the tree stays
  // multi-host (composite values, groups).
  async function openWithName() {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: threeRoles, 2: [role("bravo-only")] }),
    );
    const utils = renderDialog();
    await waitFor(() => expect(roleOptionValues()).toHaveLength(4));
    typeCustomName();
    return utils;
  }

  it("checking two roles sends the first pick as role and the second in roles[]", async () => {
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    await openWithName();
    // Pick order, not list order, decides which role goes first.
    toggleRole("tina");
    toggleRole("box-maintainer");
    // Both carry a check (the list shows them in list order).
    await waitFor(() =>
      expect(pickedRoleSlugs()).toEqual(["box-maintainer", "tina"]),
    );
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.hostId).toBe(1);
    expect(payload.role).toBe("tina");
    expect(payload.roles).toEqual(["box-maintainer"]);
  });

  it("three picks keep their pick order on the wire, even after un-picking and re-picking one", async () => {
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    await openWithName();
    toggleRole("sky-uat");
    toggleRole("tina");
    toggleRole("box-maintainer");
    toggleRole("sky-uat"); // un-pick the first …
    toggleRole("sky-uat"); // … and pick it again: it is now last
    await waitFor(() => expect(pickedRoleSlugs()).toHaveLength(3));
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.role).toBe("tina");
    expect(payload.roles).toEqual(["box-maintainer", "sky-uat"]);
  });

  it("unchecking the last role falls back to \"No roles\" on that role's host", async () => {
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    await openWithName();
    expect(createBtn().disabled).toBe(true);
    toggleRole("tina");
    toggleRole("sky-uat");
    toggleRole("sky-uat");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["1/tina"]));
    toggleRole("tina");
    await waitFor(() => expect(pickedRoleValues()).toEqual([`1/${NO_ROLES_VALUE}`]));
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.hostId).toBe(1);
    expect("role" in payload).toBe(false);
    expect("roles" in payload).toBe(false);
  });

  it("unticking \"No roles\" with several hosts leaves nothing picked and Create disabled", async () => {
    await openWithName();
    toggleNoRoles("2");
    await waitFor(() => expect(pickedRoleValues()).toEqual([`2/${NO_ROLES_VALUE}`]));
    toggleNoRoles("2");
    await waitFor(() => expect(pickedRoleValues()).toEqual([]));
    expect(createBtn().disabled).toBe(true);
  });

  it("a single pick sends role only, with no roles key", async () => {
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    await openWithName();
    toggleRole("sky-uat");
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.role).toBe("sky-uat");
    expect("roles" in payload).toBe(false);
  });
});

describe("NewSessionDialog roles: \"No roles\" entry", () => {
  async function openTwoHosts() {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("box-maintainer"), role("tina")], 2: [role("ops")] }),
    );
    renderDialog();
    await waitFor(() => expect(roleOptionValues()).toHaveLength(3));
    typeCustomName();
  }

  it("several hosts: nothing preselected, Create disabled; \"No roles\" in bravo's group picks bravo and births there with no role", async () => {
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    await openTwoHosts();
    expect(pickedRoleValues()).toEqual([]);
    expect(createBtn().disabled).toBe(true);
    toggleNoRoles("2");
    await waitFor(() => expect(pickedRoleValues()).toEqual([`2/${NO_ROLES_VALUE}`]));
    expect(pickedRoleLabels()).toEqual(["No roles"]);
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.hostId).toBe(2);
    expect("role" in payload).toBe(false);
    expect("roles" in payload).toBe(false);
  });

  it("\"No roles\" and roles are mutually exclusive", async () => {
    await openTwoHosts();
    // Roles, then "No roles" on the same host → roles cleared.
    toggleRole("tina");
    toggleRole("box-maintainer");
    await waitFor(() => expect(pickedRoleSlugs()).toEqual(["box-maintainer", "tina"]));
    toggleNoRoles("1");
    await waitFor(() => expect(pickedRoleValues()).toEqual([`1/${NO_ROLES_VALUE}`]));
    // A role on the same host → "No roles" cleared.
    toggleRole("tina");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["1/tina"]));
    // "No roles" on another host → replaces the picks and switches host.
    toggleNoRoles("2");
    await waitFor(() => expect(pickedRoleValues()).toEqual([`2/${NO_ROLES_VALUE}`]));
    // A role on another host → replaces "No roles" and switches back.
    toggleRole("box-maintainer");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["1/box-maintainer"]));
  });

  it("single host: picking a role clears \"No roles\"; picking \"No roles\" clears the role", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: [role("tina")] }));
    renderDialog({ hostTree: oneHostTree });
    await waitFor(() => expect(roleOptionValues()).toEqual(["tina"]));
    expect(pickedRoleValues()).toEqual([NO_ROLES_VALUE]);
    toggleRole("tina");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["tina"]));
    toggleNoRoles();
    await waitFor(() => expect(pickedRoleValues()).toEqual([NO_ROLES_VALUE]));
  });
});

// Agent mode only offers machines that can host agents (canHostAgents).
describe("NewSessionDialog roles: only machines that can host agents", () => {
  const notFleet = makeHost("2", "winbox", { canHostAgents: false, enableSsh: false });
  const noFlag = makeHost("3", "legacy", { canHostAgents: undefined });

  it("ineligible hosts get no group, no \"No roles\" entry and no roles request", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("tina")], 2: [role("ops")], 4: [role("em")] }),
    );
    renderDialog({
      hostTree: {
        name: "root",
        children: [makeHost("1", "alpha"), notFleet, noFlag, makeHost("4", "delta")],
      },
    });
    await waitFor(() => expect(roleOptionValues()).toHaveLength(2));
    expect(roleListRows()).toEqual([
      "# alpha", `1/${NO_ROLES_VALUE}`, "1/tina",
      "# delta", `4/${NO_ROLES_VALUE}`, "4/em",
    ]);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockListRolesForHost.mock.calls.map((c) => c[0]).sort()).toEqual([1, 4]);
  });

  it("one eligible + one ineligible behaves as one machine: no heading, \"No roles\" preselected, Create goes to the eligible host", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: [role("tina")], 2: [role("ops")] }));
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    renderDialog({ hostTree: { name: "root", children: [makeHost("1", "alpha"), notFleet] } });
    await waitFor(() => expect(roleOptionValues()).toEqual(["tina"]));
    expect(roleListRows()).toEqual([NO_ROLES_VALUE, "tina"]);
    expect(roleGroupHeaders()).toEqual([]);
    expect(pickedRoleValues()).toEqual([NO_ROLES_VALUE]);
    expect(mockListRolesForHost.mock.calls.map((c) => c[0])).toEqual([1]);
    typeCustomName();
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.hostId).toBe(1);
  });

  it("no eligible host → no \"No roles\" entry and nothing asked", async () => {
    renderDialog({ hostTree: { name: "root", children: [notFleet] } });
    await new Promise((r) => setTimeout(r, 20));
    expect(roleListRows()).toEqual([]);
    expect(pickedRoleValues()).toEqual([]);
    expect(mockListRolesForHost).not.toHaveBeenCalled();
  });

  it("an ineligible initialHost is no pre-fill in agent mode", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: [role("tina")], 4: [role("em")] }));
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        onCreate={vi.fn()}
        isAdmin
        hostTree={{ name: "root", children: [makeHost("1", "alpha"), notFleet, makeHost("4", "delta")] }}
        initialHost={notFleet}
        initialRole="ops"
      />,
    );
    await waitFor(() => expect(roleOptionValues()).toHaveLength(2));
    expect(pickedRoleValues()).toEqual([]);
    expect(createBtn().disabled).toBe(true);
  });

  it("Shell still lists every non-RDP host", async () => {
    renderDialog({
      hostTree: { name: "root", children: [makeHost("1", "alpha"), notFleet, makeHost("4", "delta")] },
    });
    chooseShell();
    await waitFor(() => expect(screen.getByText("winbox")).toBeTruthy());
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("delta")).toBeTruthy();
  });
});

describe("NewSessionDialog roles: one-machine \"No roles\" default tracks the machine count", () => {
  const props = { onClose: vi.fn(), onCreate: vi.fn(), isAdmin: true };

  it("a second machine appearing while open withdraws the untouched default; headings appear; Create disabled", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: [role("tina")], 2: [role("ops")] }));
    const { rerender } = render(<NewSessionDialog open {...props} hostTree={oneHostTree} />);
    await waitFor(() => expect(pickedRoleValues()).toEqual([NO_ROLES_VALUE]));
    expect(roleGroupHeaders()).toEqual([]);
    typeCustomName();
    await waitFor(() => expect(createBtn().disabled).toBe(false));

    rerender(<NewSessionDialog open {...props} hostTree={twoHostTree} />);
    await waitFor(() => expect(roleOptionValues()).toHaveLength(2));
    await waitFor(() => expect(pickedRoleValues()).toEqual([]));
    expect(roleGroupHeaders()).toEqual(["alpha", "bravo"]);
    expect(createBtn().disabled).toBe(true);
  });

  it("a machine appearing after open (0 → 1) gets the default", async () => {
    const empty: HostFolder = { name: "root", children: [] };
    const { rerender } = render(<NewSessionDialog open {...props} hostTree={empty} />);
    rerender(<NewSessionDialog open {...props} hostTree={oneHostTree} />);
    await waitFor(() => expect(pickedRoleValues()).toEqual([NO_ROLES_VALUE]));
  });

  it("a user's own pick survives a second machine appearing", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: [role("tina")], 2: [role("ops")] }));
    const { rerender } = render(<NewSessionDialog open {...props} hostTree={oneHostTree} />);
    await waitFor(() => expect(roleOptionValues()).toEqual(["tina"]));
    toggleRole("tina");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["tina"]));
    rerender(<NewSessionDialog open {...props} hostTree={twoHostTree} />);
    await waitFor(() => expect(roleOptionValues()).toHaveLength(2));
    expect(pickedRoleValues()).toEqual(["1/tina"]);
  });

  it("unticking the default \"No roles\" on one machine is not re-seeded", async () => {
    renderDialog({ hostTree: oneHostTree });
    await waitFor(() => expect(pickedRoleValues()).toEqual([NO_ROLES_VALUE]));
    toggleNoRoles();
    await waitFor(() => expect(pickedRoleValues()).toEqual([]));
    await new Promise((r) => setTimeout(r, 20));
    expect(pickedRoleValues()).toEqual([]);
  });

  it("switching to Shell and back to Agent re-seeds \"No roles\" on one machine; Create enabled", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: [role("tina")] }));
    renderDialog({ hostTree: oneHostTree });
    await waitFor(() => expect(pickedRoleValues()).toEqual([NO_ROLES_VALUE]));
    chooseShell();
    await waitFor(() => expect(queryRolesGroup()).toBeFalsy());
    chooseAgent();
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    await waitFor(() => expect(pickedRoleValues()).toEqual([NO_ROLES_VALUE]));
    typeCustomName();
    await waitFor(() => expect(createBtn().disabled).toBe(false));
  });

  it("one machine whose roles fail to load still shows its preselected \"No roles\" entry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: new Error("boom") }));
    renderDialog({ hostTree: oneHostTree });
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/roles fetch failed hostId=1/)),
    );
    await waitFor(() => expect(roleListRows()).toEqual([NO_ROLES_VALUE]));
    expect(pickedRoleValues()).toEqual([NO_ROLES_VALUE]);
    typeCustomName();
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.hostId).toBe(1);
    expect("role" in payload).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 25: zero roles is a normal choice
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog roles: Test 25 — zero roles is a normal choice", () => {
  it("Test 25: single host, listRolesForHost returns [] → no hint; \"No roles\" picked", async () => {
    renderDialog({ hostTree: oneHostTree });
    await waitFor(() => expect(pickedRoleValues()).toEqual([NO_ROLES_VALUE]));
    expect(screen.queryByText(/no roles on this host/i)).toBeNull();
    expect(roleListRows()).toEqual([NO_ROLES_VALUE]);
  });

  it("Test 25b: several hosts, none with roles → no hint; each host offers \"No roles\"", async () => {
    renderDialog();
    await waitFor(() => expect(roleListRows()).toHaveLength(4));
    expect(screen.queryByText(/no roles (on this host )?yet/i)).toBeNull();
    expect(pickedRoleValues()).toEqual([]);
    expect(roleListRows()).toEqual([
      "# alpha", `1/${NO_ROLES_VALUE}`,
      "# bravo", `2/${NO_ROLES_VALUE}`,
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Loading + fetch errors — each host answers on its own
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog roles: per-host loading and errors", () => {
  it("the list waits behind 'Loading roles…' until every host has answered, then shows at once", async () => {
    const alpha = deferred<ReturnType<typeof role>[]>();
    const bravo = deferred<ReturnType<typeof role>[]>();
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: alpha.promise, 2: bravo.promise }));
    renderDialog();
    await waitFor(() => expect(rolesLoading()).toBe(true));
    expect(roleListRows()).toEqual([]);

    bravo.resolve([role("tina"), role("ops")]);
    await waitFor(() => expect(mockListRolesForHost).toHaveBeenCalledTimes(2));
    // One host answering is not enough: nothing shows yet, so nothing moves.
    await act(async () => {});
    expect(roleListRows()).toEqual([]);
    expect(rolesLoading()).toBe(true);
    expect(screen.queryByText(/no roles (on this host )?yet/i)).toBeNull();

    alpha.resolve([role("box-maintainer")]);
    await waitFor(() => expect(rolesLoading()).toBe(false));
    expect(roleListRows()).toEqual([
      "# alpha", `1/${NO_ROLES_VALUE}`, "1/box-maintainer",
      "# bravo", `2/${NO_ROLES_VALUE}`, "2/tina", "2/ops",
    ]);
  });

  it("a slow host holds the list back only so long; its roles then join under the others", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const alpha = deferred<ReturnType<typeof role>[]>();
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: alpha.promise, 2: [role("tina")] }));
    renderDialog();
    await waitFor(() => expect(mockListRolesForHost).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(roleListRows()).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    await waitFor(() => expect(roleOptionValues()).toEqual(["2/tina"]));
    // alpha hasn't answered: the loading line stays, under the groups.
    expect(rolesLoading()).toBe(true);
    const loadingLine = screen.getByTestId("role-pick-loading");
    const lastGroup = screen.getByTestId("role-pick-group-2");
    expect(lastGroup.compareDocumentPosition(loadingLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    toggleRole("tina");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["2/tina"]));

    alpha.resolve([role("box-maintainer")]);
    await waitFor(() => expect(roleOptionValues()).toHaveLength(2));
    expect(rolesLoading()).toBe(false);
    expect(roleGroupHeaders()).toEqual(["alpha", "bravo"]);
    // A late host's roles don't disturb the picks.
    expect(pickedRoleValues()).toEqual(["2/tina"]);
  });

  it("reopening shows the roles from last time straight away, then takes each host's fresh answer", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: [role("box-maintainer")], 2: [role("tina")] }));
    const { rerender } = render(
      <NewSessionDialog open onClose={vi.fn()} hostTree={twoHostTree} onCreate={vi.fn()} isAdmin />,
    );
    await waitFor(() => expect(roleOptionValues()).toEqual(["1/box-maintainer", "2/tina"]));
    rerender(<NewSessionDialog open={false} onClose={vi.fn()} hostTree={twoHostTree} onCreate={vi.fn()} isAdmin />);

    const alpha = deferred<ReturnType<typeof role>[]>();
    const bravo = deferred<ReturnType<typeof role>[]>();
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: alpha.promise, 2: bravo.promise }));
    rerender(<NewSessionDialog open onClose={vi.fn()} hostTree={twoHostTree} onCreate={vi.fn()} isAdmin />);
    // Last time's roles on the very first paint, before either host has
    // answered again — and no loading line under them.
    expect(roleOptionValues()).toEqual(["1/box-maintainer", "2/tina"]);
    expect(rolesLoading()).toBe(false);

    alpha.resolve([role("box-maintainer")]);
    bravo.resolve([role("tina"), role("ops")]);
    await waitFor(() => expect(roleOptionValues()).toEqual(["1/box-maintainer", "2/tina", "2/ops"]));
  });

  it("a host that failed last time doesn't hold a reopened list behind 'Loading roles…'", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: new Error("connect ETIMEDOUT"), 2: [role("tina")] }),
    );
    const { rerender } = render(
      <NewSessionDialog open onClose={vi.fn()} hostTree={twoHostTree} onCreate={vi.fn()} isAdmin />,
    );
    await waitFor(() => expect(roleOptionValues()).toEqual(["2/tina"]));
    await waitFor(() => expect(rolesLoading()).toBe(false));
    rerender(<NewSessionDialog open={false} onClose={vi.fn()} hostTree={twoHostTree} onCreate={vi.fn()} isAdmin />);

    const alpha = deferred<ReturnType<typeof role>[]>();
    const bravo = deferred<ReturnType<typeof role>[]>();
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: alpha.promise, 2: bravo.promise }));
    rerender(<NewSessionDialog open onClose={vi.fn()} hostTree={twoHostTree} onCreate={vi.fn()} isAdmin />);
    expect(roleOptionValues()).toEqual(["2/tina"]);
    expect(rolesLoading()).toBe(false);

    // The failed host coming back adds its section.
    alpha.resolve([role("box-maintainer")]);
    bravo.resolve([role("tina")]);
    await waitFor(() => expect(roleOptionValues()).toEqual(["1/box-maintainer", "2/tina"]));
    warn.mockRestore();
  });

  it("one host failing still lists the other hosts' roles, with no error line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: new Error("connect ETIMEDOUT"), 2: [role("tina")] }),
    );
    renderDialog();
    await waitFor(() => expect(roleOptionValues()).toEqual(["2/tina"]));
    // The failed machine has no group at all — and with one group left,
    // there's no heading either.
    expect(screen.queryByTestId("role-pick-group-1")).toBeNull();
    expect(roleListRows()).toEqual([`2/${NO_ROLES_VALUE}`, "2/tina"]);
    expect(screen.queryByText(/couldn't load roles/i)).toBeNull();
    expect(screen.queryByText(/ETIMEDOUT/)).toBeNull();
    // An error is not "no roles".
    expect(screen.queryByText(/no roles (on this host )?yet/i)).toBeNull();
    // The failure still reaches the logs.
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/roles fetch failed hostId=1/));
  });

  it("every host failing → no error lines and no zero-roles hint", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: new Error("boom-a"), 2: new Error("boom-b") }),
    );
    renderDialog();
    await waitFor(() => expect(mockListRolesForHost).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(rolesLoading()).toBe(false));
    expect(screen.queryByText(/boom/)).toBeNull();
    expect(screen.queryByText(/couldn't load roles/i)).toBeNull();
    expect(screen.queryByText(/no roles (on this host )?yet/i)).toBeNull();
    // Nothing to list, and nothing was searched for: a plain empty line, not
    // "No matching roles".
    expect(screen.queryByTestId("role-pick-no-matches")).toBeNull();
    expect(screen.getByTestId("role-pick-empty").textContent).toBe("No roles to pick from right now");
  });

  it("one machine: No roles is preselected while its roles are still loading, and shows with them", async () => {
    const alpha = deferred<ReturnType<typeof role>[]>();
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: alpha.promise }));
    renderDialog({ hostTree: oneHostTree });
    await waitFor(() => expect(rolesLoading()).toBe(true));
    expect(roleListRows()).toEqual([]);
    expect(screen.queryByTestId("role-pick-empty")).toBeNull();
    alpha.resolve([role("tina")]);
    await waitFor(() => expect(rolesLoading()).toBe(false));
    expect(roleListRows()).toEqual([NO_ROLES_VALUE, "tina"]);
    expect(pickedRoleValues()).toEqual([NO_ROLES_VALUE]);
  });

  it("single host failing → no error line", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: new Error("boom") }));
    renderDialog({ hostTree: oneHostTree });
    await waitFor(() => expect(roleListRows()).toEqual([NO_ROLES_VALUE]));
    expect(screen.queryByText("boom")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// "New role…" row at the bottom of the roles list
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog roles: New role… row", () => {
  const twoRoles = [role("box-maintainer"), role("tina")];

  function renderWithNewRole(extra: Partial<Parameters<typeof NewSessionDialog>[0]> = {}) {
    const onNewRole = vi.fn();
    const utils = render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
        isAdmin
        onNewRole={onNewRole}
        {...extra}
      />,
    );
    return { ...utils, onNewRole };
  }

  it("is the last row; clicking it hands over the picked role's host and roles (in pick order)", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: twoRoles, 2: [role("x")] }));
    const { onNewRole } = renderWithNewRole();
    await waitFor(() => expect(roleOptionValues()).toHaveLength(3));
    toggleRole("tina");
    toggleRole("box-maintainer");
    const row = queryNewRoleRow()!;
    expect(row.textContent).toMatch(/new role/i);
    // After every role row.
    const rows = Array.from(document.querySelectorAll('[data-testid^="role-pick-"]'));
    expect(rows[rows.length - 1]).toBe(row);
    fireEvent.click(row);
    expect(onNewRole).toHaveBeenCalledTimes(1);
    const [ctx] = onNewRole.mock.calls[0];
    expect(ctx.host.id).toBe("1");
    expect(ctx.roles).toEqual(["tina", "box-maintainer"]);
  });

  it("absent without onNewRole", async () => {
    renderDialog();
    await waitFor(() => expect(roleListRows()).toHaveLength(4));
    expect(queryNewRoleRow()).toBeNull();
  });

  it("multi-host with nothing picked hands over host: null", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: twoRoles, 2: [role("x")] }));
    const { onNewRole } = renderWithNewRole();
    await waitFor(() => expect(roleOptionValues()).toHaveLength(3));
    fireEvent.click(queryNewRoleRow()!);
    const [ctx] = onNewRole.mock.calls[0];
    expect(ctx.host).toBeNull();
    expect(ctx.roles).toEqual([]);
  });

  it("is there when no host has roles", async () => {
    const { onNewRole } = renderWithNewRole();
    await waitFor(() => expect(roleListRows()).toHaveLength(4));
    expect(screen.queryByText(/no matching roles/i)).toBeNull();
    fireEvent.click(queryNewRoleRow()!);
    expect(onNewRole.mock.calls[0][0].roles).toEqual([]);
  });

  it("single host with zero roles → no nudge to create a role", async () => {
    renderWithNewRole({ hostTree: oneHostTree });
    await waitFor(() => expect(roleListRows()).toEqual([NO_ROLES_VALUE]));
    expect(screen.queryByText(/No roles (on this host )?yet/)).toBeNull();
    expect(queryNewRoleRow()).toBeTruthy();
  });

  it("a new hostTree object while open does not re-seed over the user's picks or refetch", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: twoRoles, 2: [] }));
    const props = {
      open: true,
      onClose: vi.fn(),
      onCreate: vi.fn(),
      isAdmin: true,
      onNewRole: vi.fn(),
      initialHost: twoHostTree.children[0] as Host,
      initialRoles: ["tina"],
    };
    const { rerender } = render(<NewSessionDialog {...props} hostTree={twoHostTree} />);
    await waitFor(() => expect(pickedRoleSlugs()).toEqual(["tina"]));
    toggleRole("box-maintainer");
    await waitFor(() => expect(pickedRoleSlugs()).toEqual(["box-maintainer", "tina"]));
    // Same hosts, fresh object (what a parent re-render can hand over).
    rerender(<NewSessionDialog {...props} hostTree={{ ...twoHostTree, children: [...twoHostTree.children] }} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(pickedRoleSlugs()).toEqual(["box-maintainer", "tina"]);
    expect(mockListRolesForHost).toHaveBeenCalledTimes(2);
  });

  it("hands over a typed name and restores it via initialName", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: twoRoles, 2: [] }));
    const first = renderWithNewRole();
    await waitFor(() => expect(roleOptionValues()).toHaveLength(2));
    typeName("alicia");
    fireEvent.click(queryNewRoleRow()!);
    expect(first.onNewRole.mock.calls[0][0].name).toBe("alicia");
    first.unmount();

    const back = renderWithNewRole({
      initialHost: twoHostTree.children[0] as Host,
      initialName: "alicia",
    });
    await waitFor(() =>
      expect((back.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe("alicia"),
    );
  });

  it("does not hand over a pool suggestion as the user's name", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: twoRoles, 2: [] }));
    mockPickPoolName.mockResolvedValue({ name: "willow" });
    const { onNewRole } = renderWithNewRole({ initialHost: twoHostTree.children[0] as Host });
    await waitFor(() => expect(nameInput().value).toBe("willow"));
    fireEvent.click(queryNewRoleRow()!);
    expect(onNewRole.mock.calls[0][0].name).toBeNull();
  });

  it("initialRoles seeds several picks; birth keeps the seeded order", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: twoRoles, 2: [] }));
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    renderWithNewRole({
      initialHost: twoHostTree.children[0] as Host,
      initialRoles: ["tina", "box-maintainer"],
    });
    await waitFor(() =>
      expect(pickedRoleValues()).toEqual(["1/box-maintainer", "1/tina"]),
    );
    expect(pickedRoleLabels()).toEqual(["Box Maintainer", "Tina"]);
    typeCustomName();
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    expect(mockOpenBirthStream.mock.calls[0][0]).toMatchObject({
      hostId: 1,
      role: "tina",
      roles: ["box-maintainer"],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 26: role state resets on modal close
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog roles: Test 26 — role resets on close", () => {
  it("Test 26: pick role, close modal, re-open → role empty + roles refetched from every host", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("box-maintainer"), role("tina")], 2: [role("x")] }),
    );
    const { rerender, onClose } = renderDialog();
    await waitFor(() => expect(roleOptionValues()).toHaveLength(3));
    toggleRole("tina");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["1/tina"]));
    expect(mockListRolesForHost).toHaveBeenCalledTimes(2);

    // Close modal
    rerender(
      <NewSessionDialog
        open={false}
        onClose={onClose}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
      />,
    );
    // Re-open
    rerender(
      <NewSessionDialog
        open={true}
        onClose={onClose}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
      />,
    );
    // Every host asked again; the roles list is back with nothing picked.
    await waitFor(() => expect(mockListRolesForHost).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(roleOptionValues()).toHaveLength(3));
    expect(pickedRoleValues()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 27: roles NOT shown in Shell
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog roles: Test 27 — hidden when an admin picks Shell", () => {
  it("Test 27: choose Shell → roles list absent from DOM; host list appears", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: [role("box-maintainer")] }));
    renderDialog();
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    // In Agent the machines are only role-list headings, not a host picker.
    expect(screen.queryByLabelText(/search hosts/i)).toBeNull();
    chooseShell();
    await waitFor(() => {
      expect(queryRolesGroup()).toBeFalsy();
    });
    expect(screen.getByLabelText(/search hosts/i)).toBeTruthy();
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("bravo")).toBeTruthy();
  });
});
