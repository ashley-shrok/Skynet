// ─── NewSessionDialog role-dropdown coverage (Phase 22 SRIC-02 Plan 22-02 Task 4)
//
// Tests 20-27 cover the REQUIRED Role dropdown added to NewSessionDialog when
// identity-mode is ON. Behavior spec:
//   - Populates via GET /roles?hostId=<n> (listRolesForHost) for every
//     pickable host when the dialog opens
//   - Blocks submit until a role is picked
//   - Zero-roles response renders an inline "no roles … yet" hint
//   - Role state resets on modal close
//   - Dropdown is NOT shown when identity-mode is OFF (CREATE-only surface)
//   - Birth payload includes role: <selectedRoleName>
//
// 2026-10-18 (no host step for agents): there is no host list in agent mode.
// Every host is asked for its roles at open; one host → a flat list of bare
// slugs, several → sections per host (alphabetical, header rows), option
// values `${hostId}/${slug}`, pills "<Role> · <host>". The picked role decides
// the host; a role from a different host replaces the earlier picks.
//   Test 20: was "click a host → fetch"; now "open → fetch every host once".
//   Test 22: was "host change clears role + refetches" (no host change exists
//     any more); now "a role from another host replaces the picks".
//   Test 22b: was "change to a single-role host auto-selects"; now the sole
//     role across ALL hosts auto-selects, with its host, once all answered.
//   Test 26: re-open now shows the roles group straight away (no host gate).
//   New: sectioning/headers, pill labels, per-host errors, partial loading,
//     multi-host zero-roles hint, null host in the New role… hand-over.
//
// Fixture host ids are numeric strings ("1", "2"): the dialog passes
// parseInt(host.id) to listRolesForHost, and rolesByHost() keys on that.
//
// Fixtures + mocks copy the shape of NewSessionDialog.test.tsx (react-i18next
// passthrough, voice-api mock, session-hue mock, etc.) — kept as a sibling
// file so the Task 4 addition doesn't bloat the existing 1400-line suite.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";

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
import {
  queryRolesGroup,
  roleOptionValues,
  pickedRoleValues,
  pickedRoleSlugs,
  pickedRoleLabels,
  roleGroupHeaders,
  roleListRows,
  toggleRole,
  closeRoleDropdown,
  rolesByHost,
  deferred,
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

// Tree order deliberately NOT alphabetical (and mixed case) so sectioning
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

// Phase 88 (Plan 88-03 Task 4): renderDialog helper accepts isAdmin
// with a default of `true` to preserve existing coverage's admin-surface
// assumptions (Path + shell-only checkbox were universal before Phase 88;
// they are now admin-gated). Tests in this file exercise the role
// dropdown which lives inside the identity-cluster gate (post-Phase-88:
// {!shellOnly && (…)}). Agent-mode is the default (shellOnly=false)
// so the dropdown IS visible on fresh mount.
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

/**
 * Reveal the custom-name input (if not already shown) and type `name`.
 * With numeric host ids a role pick fires pickPoolName, whose rejecting
 * default mock flips the custom-name checkbox ON by itself — so only click
 * it when it is still off.
 */
function typeCustomName(name = "alicia") {
  const box = screen.getByLabelText(/choose a custom agent name/i) as HTMLInputElement;
  if (!box.checked) fireEvent.click(box);
  fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: name } });
}

const createBtn = () =>
  screen.getByRole("button", { name: /^(open|create|creating)/i }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no roles returned (individual tests override)
  mockListRolesForHost.mockResolvedValue([]);
  mockListIdentities.mockResolvedValue([]);
  mockGetIdentityExistsOnHost.mockResolvedValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 20: opening the dialog asks every pickable host for its roles, once
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 20 — open fetches roles from every host", () => {
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
    expect(screen.queryByText("zulu")).toBeNull();
    expect(screen.queryByText(/pick a host/i)).toBeNull();

    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    toggleRole("ay");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["2/ay"]));
    toggleRole("zed");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["1/zed"]));
    await new Promise((r) => setTimeout(r, 20));
    expect(mockListRolesForHost).toHaveBeenCalledTimes(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 21: API returns roles → dropdown renders those options
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 21 — roles render as options", () => {
  it("Test 21: single host with two roles → flat bare-slug options, no headers, host auto-selected", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("box-maintainer"), role("tina")] }),
    );
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    renderDialog({ hostTree: oneHostTree });
    await waitFor(() => {
      expect(queryRolesGroup()).toBeTruthy();
    });
    expect(roleOptionValues()).toEqual(["box-maintainer", "tina"]);
    expect(roleGroupHeaders()).toEqual([]);
    toggleRole("tina");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["tina"]));
    // Single host: the pill is just the role, no host suffix.
    expect(pickedRoleLabels()).toEqual(["Tina"]);
    closeRoleDropdown();
    // The sole host was picked for us — Create goes to it.
    typeCustomName();
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.hostId).toBe(1);
    expect(payload.role).toBe("tina");
  });

  it("Test 21b: several hosts → sections alphabetical by host name (case-insensitive), a header each, composite values; zero-role hosts get no header", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("zed")], 2: [role("ay"), role("bee")], 3: [] }),
    );
    renderDialog({ hostTree: mixedTree });
    await waitFor(() => expect(roleOptionValues()).toHaveLength(3));
    expect(roleListRows()).toEqual(["# Alpha", "2/ay", "2/bee", "# zulu", "1/zed"]);
    expect(roleGroupHeaders()).toEqual(["Alpha", "zulu"]);
  });

  it("Test 21c: three hosts with roles → headers Alpha, mike, zulu in that order", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("zed")], 2: [role("ay")], 3: [role("em")] }),
    );
    renderDialog({ hostTree: mixedTree });
    await waitFor(() => expect(roleOptionValues()).toHaveLength(3));
    expect(roleListRows()).toEqual(["# Alpha", "2/ay", "# mike", "3/em", "# zulu", "1/zed"]);
  });

  it("Test 21d: multi-host pill label is '<Role> · <host>'; instance-wide marker kept", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({
        1: [role("tina"), role("ops", { displayName: "Ops Crew", instanceWide: true })],
        2: [role("tina")],
      }),
    );
    renderDialog();
    await waitFor(() => expect(roleOptionValues()).toHaveLength(3));
    toggleRole("tina", "2");
    await waitFor(() => expect(pickedRoleLabels()).toEqual(["Tina · bravo"]));
    toggleRole("ops");
    await waitFor(() =>
      expect(pickedRoleLabels()).toEqual(["Ops Crew · instance-wide · alpha"]),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 22: a role from a different host replaces the picks (and the host)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 22 — role from another host switches host", () => {
  it("Test 22: pick two of alpha's roles → pick one of bravo's → picks are just bravo's; birth goes to bravo", async () => {
    // Was: "pick host A, pick role → pick host B → refetch + role cleared".
    // There is no host change to make any more; the equivalent guard is that
    // a role picked from host A does not survive picking one from host B —
    // an agent lives on one machine.
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
      expect(pickedRoleValues()).toEqual(["1/tina", "1/box-maintainer"]),
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
    closeRoleDropdown();

    typeCustomName();
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.hostId).toBe(2);
    expect(payload.role).toBe("other-role");
    expect("roles" in payload).toBe(false);
  });

  it("Test 22b: exactly one role across all hosts → it auto-selects, with its host, once every host has answered", async () => {
    // Was: "host change to a single-role host auto-selects". Sole-role now
    // counts across every host, and must wait for all of them — a slow host
    // could still turn up a second role.
    const alpha = deferred<ReturnType<typeof role>[]>();
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: alpha.promise, 2: [role("only-role")] }),
    );
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    renderDialog();
    // bravo answered; alpha still loading → its role is listed, not picked.
    await waitFor(() => expect(roleOptionValues()).toEqual(["2/only-role"]));
    closeRoleDropdown();
    await new Promise((r) => setTimeout(r, 20));
    expect(pickedRoleValues()).toEqual([]);

    alpha.resolve([]);
    await waitFor(() => expect(pickedRoleValues()).toEqual(["2/only-role"]));
    expect(pickedRoleLabels()).toEqual(["Only Role · bravo"]);

    typeCustomName();
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.hostId).toBe(2);
    expect(payload.role).toBe("only-role");
  });

  it("Test 22c: one role on each of two hosts → nothing auto-selects", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("tina")], 2: [role("tina")] }),
    );
    renderDialog();
    await waitFor(() => expect(roleOptionValues()).toEqual(["1/tina", "2/tina"]));
    closeRoleDropdown();
    await new Promise((r) => setTimeout(r, 20));
    expect(pickedRoleValues()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 23: Create disabled while role is empty (identity-mode ON)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 23 — Create blocked without role", () => {
  it("Test 23: multi-host, name valid but no role picked → Create disabled; pick a role → enabled", async () => {
    // Phase 86 Plan 86-04 stripped cosmetic UI (title / brief / voice /
    // color / avatar generate). Post-Plan-86-04 canOpen requires only
    // host + valid name + role in identity-mode. With no host step, no host
    // is chosen until a role is — so this pins both gates at once.
    // Two roles (one per host) so sole-role auto-select stays out of the way.
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("box-maintainer")], 2: [role("general-assistant")] }),
    );
    renderDialog();
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    typeCustomName();
    // Create still disabled — role (and so host) not picked
    expect(createBtn().disabled).toBe(true);
    // Pick role → Create enabled
    toggleRole("box-maintainer");
    closeRoleDropdown();
    await waitFor(() => {
      expect(createBtn().disabled).toBe(false);
    });
  });

  it("Test 23b: a single role across the hosts → Create enabled without the user touching the roles", async () => {
    // The payoff of sole-role auto-select: name is prefilled and the only role
    // (and its host) is selected, so Create is reachable with zero
    // interactions beyond opening the modal. This is the case Aither-style
    // one-role deployments hit constantly.
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("box-maintainer")], 2: [] }),
    );
    mockPickPoolName.mockResolvedValue({ name: "willow" });
    const { getByRole } = renderDialog();

    await waitFor(() => {
      expect(pickedRoleValues()).toEqual(["1/box-maintainer"]);
    });
    // 2026-09-27: reveal the manual input so we can observe the prefilled
    // value. The auto path submits the same value silently, but this test
    // encodes "prefill actually populated the state" which is only visible in
    // the DOM once the input renders.
    fireEvent.click(screen.getByLabelText(/choose a custom agent name/i));
    // Name must actually prefill for Create to enable, so assert it landed
    // before checking the button (this suite's default pickPoolName mock
    // REJECTS — see the module-level mock — so the resolved override above is
    // load-bearing here).
    await waitFor(() => {
      const nameInput = screen.getByLabelText(/^name$/i) as HTMLInputElement;
      expect(nameInput.value).toBe("willow");
    });
    await waitFor(() => {
      const btn = getByRole("button", {
        name: /^(open|create|creating)/i,
      }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 24: birth payload includes role
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 24 — birth payload carries role", () => {
  it("Test 24: submit success → openBirthStream body includes role: <picked>", async () => {
    // Phase 86 Plan 86-04 stripped cosmetic UI (title/brief/generate/img).
    // Post-Plan-86-04 the birth submit body carries hostId, name, role,
    // voice:null, colorHue:null, task, poolPicked, path (no title, no
    // avatarCandidateId).
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("box-maintainer")] }),
    );
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    renderDialog({ hostTree: oneHostTree });
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    // 2026-09-27: reveal the manual name input for typing.
    typeCustomName();
    // The sole role auto-selects — clicking it again would UNcheck it, so
    // just confirm it is picked.
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

describe("NewSessionDialog roles: multi-select", () => {
  const threeRoles = [role("box-maintainer"), role("sky-uat"), role("tina")];

  // alpha holds the three roles; bravo holds one more so the tree stays
  // multi-host (composite values, sections) without auto-selecting.
  async function openWithName() {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: threeRoles, 2: [role("bravo-only")] }),
    );
    const utils = renderDialog();
    await waitFor(() => expect(roleOptionValues()).toHaveLength(4));
    closeRoleDropdown();
    typeCustomName();
    return utils;
  }

  it("checking two roles sends the first pick as role and the second in roles[]", async () => {
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    await openWithName();
    // Pick order, not list order, decides which role goes first.
    toggleRole("tina");
    toggleRole("box-maintainer");
    // The trigger's pills show the picks in pick order.
    await waitFor(() =>
      expect(pickedRoleSlugs()).toEqual(["tina", "box-maintainer"]),
    );
    // Close the modal Popover so Dialog loses aria-hidden and the Create
    // button becomes discoverable via role-based queries.
    closeRoleDropdown();
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.hostId).toBe(1);
    expect(payload.role).toBe("tina");
    expect(payload.roles).toEqual(["box-maintainer"]);
  });

  it("unchecking every role leaves Create disabled", async () => {
    await openWithName();
    expect(createBtn().disabled).toBe(true);
    toggleRole("tina");
    closeRoleDropdown();
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    toggleRole("tina");
    await waitFor(() => expect(pickedRoleValues()).toEqual([]));
    closeRoleDropdown();
    expect(createBtn().disabled).toBe(true);
  });

  it("a single pick sends role only, with no roles key", async () => {
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    await openWithName();
    toggleRole("sky-uat");
    closeRoleDropdown();
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.role).toBe("sky-uat");
    expect("roles" in payload).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 25: zero-roles response renders inline hint
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 25 — zero roles renders inline hint", () => {
  it("Test 25: single host, listRolesForHost returns [] → 'no roles on this host' hint (not a link)", async () => {
    renderDialog({ hostTree: oneHostTree });
    await waitFor(() => {
      expect(screen.queryByText(/no roles on this host yet\./i)).toBeTruthy();
    });
    expect(screen.queryByText(/no roles on this host/i)!.tagName).not.toBe("BUTTON");
    // Without onNewRole the dropdown stays disabled and has no New role row.
    expect(queryRolesGroup()!.disabled).toBe(true);
  });

  it("Test 25b: several hosts, none with roles → 'No roles yet.' (no 'on this host')", async () => {
    renderDialog();
    await waitFor(() => expect(screen.queryByText(/^no roles yet\.$/i)).toBeTruthy());
    expect(screen.queryByText(/on this host/i)).toBeNull();
    expect(queryRolesGroup()!.disabled).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Loading + fetch errors — each host answers on its own
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: per-host loading and errors", () => {
  it("'Loading roles...' (disabled) only until the first host answers; its roles are pickable while the other still loads", async () => {
    const alpha = deferred<ReturnType<typeof role>[]>();
    const bravo = deferred<ReturnType<typeof role>[]>();
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: alpha.promise, 2: bravo.promise }));
    renderDialog();
    const trigger = () =>
      document.querySelector<HTMLButtonElement>("button[role=combobox][aria-label=Roles]")!;
    await waitFor(() => expect(trigger()).toBeTruthy());
    expect(trigger().textContent).toMatch(/loading roles/i);
    expect(trigger().disabled).toBe(true);

    bravo.resolve([role("tina"), role("ops")]);
    await waitFor(() => expect(trigger().textContent).toMatch(/pick roles/i));
    expect(trigger().disabled).toBe(false);
    expect(roleOptionValues()).toEqual(["2/tina", "2/ops"]);
    // No zero-roles hint while a host is still loading.
    expect(screen.queryByText(/no roles/i)).toBeNull();
    toggleRole("tina");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["2/tina"]));

    alpha.resolve([role("box-maintainer")]);
    await waitFor(() => expect(roleOptionValues()).toHaveLength(3));
    expect(roleGroupHeaders()).toEqual(["alpha", "bravo"]);
    // A late host's roles don't disturb the picks.
    expect(pickedRoleValues()).toEqual(["2/tina"]);
  });

  it("one host failing still lists the other hosts' roles, plus a per-host error line", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: new Error("connect ETIMEDOUT"), 2: [role("tina")] }),
    );
    renderDialog();
    await waitFor(() =>
      expect(
        screen.queryByText("Couldn't load roles from alpha: connect ETIMEDOUT"),
      ).toBeTruthy(),
    );
    expect(roleOptionValues()).toEqual(["2/tina"]);
    expect(roleGroupHeaders()).toEqual(["bravo"]);
    closeRoleDropdown();
    // An error is not "no roles".
    expect(screen.queryByText(/no roles/i)).toBeNull();
  });

  it("every host failing → one error line per host", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: new Error("boom-a"), 2: new Error("boom-b") }),
    );
    renderDialog();
    await waitFor(() =>
      expect(screen.queryByText("Couldn't load roles from bravo: boom-b")).toBeTruthy(),
    );
    expect(screen.queryByText("Couldn't load roles from alpha: boom-a")).toBeTruthy();
    expect(screen.queryByText(/no roles/i)).toBeNull();
  });

  it("single host failing → just the error, no host name", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: new Error("boom") }));
    renderDialog({ hostTree: oneHostTree });
    await waitFor(() => expect(screen.queryByText("boom")).toBeTruthy());
    expect(screen.queryByText(/couldn't load roles/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// "New role…" row at the top of the Roles dropdown
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: New role… row", () => {
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

  it("is the first row; clicking it hands over the picked role's host and roles", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: twoRoles, 2: [role("x")] }));
    const { onNewRole } = renderWithNewRole();
    await waitFor(() => expect(roleOptionValues()).toHaveLength(3));
    toggleRole("tina");
    const row = screen.getByTestId("multi-select-leading-action");
    expect(row.textContent).toMatch(/new role/i);
    fireEvent.click(row);
    expect(onNewRole).toHaveBeenCalledTimes(1);
    const [ctx] = onNewRole.mock.calls[0];
    expect(ctx.host.id).toBe("1");
    expect(ctx.roles).toEqual(["tina"]);
  });

  it("multi-host with nothing picked hands over host: null", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: twoRoles, 2: [role("x")] }));
    const { onNewRole } = renderWithNewRole();
    await waitFor(() => expect(roleOptionValues()).toHaveLength(3));
    fireEvent.click(screen.getByTestId("multi-select-leading-action"));
    const [ctx] = onNewRole.mock.calls[0];
    expect(ctx.host).toBeNull();
    expect(ctx.roles).toEqual([]);
  });

  it("keeps the dropdown openable when no host has roles", async () => {
    const { onNewRole } = renderWithNewRole();
    await waitFor(() =>
      expect(
        screen.queryByText("No roles yet — create one from the Roles dropdown."),
      ).toBeTruthy(),
    );
    const trigger = queryRolesGroup()!;
    expect(trigger.disabled).toBe(false);
    fireEvent.click(trigger);
    expect(screen.queryByText(/no matches/i)).toBeNull();
    fireEvent.click(screen.getByTestId("multi-select-leading-action"));
    expect(onNewRole.mock.calls[0][0].roles).toEqual([]);
  });

  it("single host with zero roles → 'No roles on this host yet — create one…' and openable", async () => {
    renderWithNewRole({ hostTree: oneHostTree });
    await waitFor(() =>
      expect(
        screen.queryByText("No roles on this host yet — create one from the Roles dropdown."),
      ).toBeTruthy(),
    );
    expect(queryRolesGroup()!.disabled).toBe(false);
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
    await waitFor(() => expect(pickedRoleSlugs()).toEqual(["tina", "box-maintainer"]));
    // Same hosts, fresh object (what a parent re-render can hand over).
    rerender(<NewSessionDialog {...props} hostTree={{ ...twoHostTree, children: [...twoHostTree.children] }} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(pickedRoleSlugs()).toEqual(["tina", "box-maintainer"]);
    expect(mockListRolesForHost).toHaveBeenCalledTimes(2);
  });

  it("hands over a typed custom name and restores it via initialName", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: twoRoles, 2: [] }));
    const first = renderWithNewRole();
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    fireEvent.click(first.getByLabelText(/choose a custom agent name/i));
    fireEvent.change(first.getByLabelText(/^name$/i), { target: { value: "alicia" } });
    fireEvent.click(queryRolesGroup()!);
    fireEvent.click(screen.getByTestId("multi-select-leading-action"));
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

  it("initialRoles seeds several picks in order", async () => {
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: twoRoles, 2: [] }));
    renderWithNewRole({
      initialHost: twoHostTree.children[0] as Host,
      initialRoles: ["tina", "box-maintainer"],
    });
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    await waitFor(() =>
      expect(pickedRoleValues()).toEqual(["1/tina", "1/box-maintainer"]),
    );
    expect(pickedRoleLabels()).toEqual(["Tina · alpha", "Box Maintainer · alpha"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 26: role state resets on modal close
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 26 — role resets on close", () => {
  it("Test 26: pick role, close modal, re-open → role empty + roles refetched from every host", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("box-maintainer"), role("tina")], 2: [role("x")] }),
    );
    const { rerender, onClose } = renderDialog();
    await waitFor(() => expect(roleOptionValues()).toHaveLength(3));
    toggleRole("tina");
    await waitFor(() => expect(pickedRoleValues()).toEqual(["1/tina"]));
    closeRoleDropdown();
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
    // Every host asked again; the roles group is back with nothing picked.
    await waitFor(() => expect(mockListRolesForHost).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(roleOptionValues()).toHaveLength(3));
    expect(pickedRoleValues()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 27: role dropdown NOT shown when identity-mode is OFF
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 27 — hidden when user opts into shell mode", () => {
  it("Test 27: click 'Just a shell — no agent' → roles group absent from DOM; host list appears", async () => {
    // Phase 88 (Plan 88-03 Task 4): semantic-inverted from the old
    // "identity-mode OFF" framing. Post-Phase-88 clicking the checkbox
    // OPTS INTO shell mode (was: opted out of identity mode); the role
    // dropdown disappears in shell mode because it lives inside the
    // {!shellOnly && (…)} identity-cluster gate (Plan 88-02 Edit D).
    // 2026-10-18: shell mode is also the only place the host list renders.
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: [role("box-maintainer")] }));
    const { getByRole } = renderDialog();
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    expect(screen.queryByText("bravo")).toBeNull();
    // Click the shell-only checkbox to opt INTO shell mode
    const checkbox = getByRole("checkbox", {
      name: /just a shell.*no agent/i,
    });
    fireEvent.click(checkbox);
    // Roles group must disappear
    await waitFor(() => {
      expect(queryRolesGroup()).toBeFalsy();
    });
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("bravo")).toBeTruthy();
  });
});
