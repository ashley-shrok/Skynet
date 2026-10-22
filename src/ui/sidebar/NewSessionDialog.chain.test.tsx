// ─── NewSessionDialog chain-prefill coverage (Phase 22 SRIC-05 Plan 22-05 Task 1)
//
// Tests 1-9 cover the NEW optional `initialHost` + `initialRole` props on
// NewSessionDialog that let a parent (PrettyConversationsPanel) chain in from
// CreateRoleDialog with role + host pre-filled. Behavior spec:
//   - Test 1: open with initialHost + initialRole + identity-mode ON → both pre-filled
//   - Test 2: open with no props → existing behavior preserved (auto-select-single-host if 1 host, else null);
//              one host also preselects "No roles"
//   - Test 3: initialHost only → host pre-filled, role empty (user must pick manually)
//   - Test 4: initialRole only (no host) → role stays empty (can't seed without host —
//              with no host step the role group still renders, unseeded);
//              auto-select-single-host still runs
//   - Test 5: when opened with both, roles group fetches roles-for-host and the
//              pre-filled role appears in the returned options
//   - Test 6: if pre-filled role is NOT in the fetched roles list → selectedRole is CLEARED
//   - Test 7: both pre-filled fields are EDITABLE (not locked / not disabled)
//   - Test 8: on close + reopen without props → default empty state (no stale seed)
//   - Test 9: identity-mode OFF → initialRole is IGNORED (roles group only exists in
//              identity-mode)
//
// 2026-10-18 (no host step for agents): agent mode has no host list; every
// host's roles are fetched at open and the picked role decides the host. The
// seed still sets host + roles, so "host pre-selected" is now observed through
// the picks' composite `${hostId}/${role}` values, the pill's "· <host>"
// suffix, the New role… hand-over's host, or the birth payload's hostId —
// not through an aria-selected host row (that list is shell-mode only now).
//   Test 2b / 4a / 8: the roles group renders with no host picked (was:
//     absent until a host was picked).
//   Test 3b: a lone role anywhere is not auto-selected.
//   Test 7: "change host" is now "pick a role from the other host".
// Host ids are numeric strings so rolesByHost() can answer per host.
//
// 2026-10-22 (apple-ux): the roles are a list in the dialog; a picked row's
// machine is the group it sits in (the drop-down's "· <host>" pill suffix is
// gone), the Name field is always shown, and the admin-only "Just a shell"
// tick-box is an Agent / Shell switch.
//
// Mock pattern lifted verbatim from NewSessionDialog.role-dropdown.test.tsx so this
// sibling file stays self-contained + isolated from the 25+ pre-existing suite.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
}));

// Mock identities-api — including listRolesForHost (spied to inspect calls)
const mockListIdentities = vi.fn().mockResolvedValue([]);
const mockPostGenerateAvatarBatch = vi.fn();
const mockGetIdentityExistsOnHost = vi.fn().mockResolvedValue(false);
const mockOpenBirthStream = vi.fn();
const mockListRolesForHost = vi.fn();
// Phase 80 Plan 80-06 Task 2: NewSessionDialog now fires pickPoolName on role
// changes in identity-mode. Reject silently so this chain-prefill suite does
// not exercise pool prefill.
const mockPickPoolName = vi.fn().mockRejectedValue(
  new Error("pickPoolName not exercised in chain.test.tsx"),
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
// Phase 106 Plan 106-04 (D-18): mock `refreshOneIdentity` so the birth+auto-
// route chain test (Test 11 below) can assert the success chain fires the
// D-16 identityMode:true payload on `onCreate` after the ended:ok:true event.
const mockRefreshOneIdentity = vi.fn().mockResolvedValue(true);
vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({ byKey: new Map() }),
  refreshOneIdentity: (...args: unknown[]) => mockRefreshOneIdentity(...args),
}));
vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

import { NewSessionDialog } from "./NewSessionDialog";
import {
  queryRolesGroup,
  getRolesGroup,
  roleOptionValues,
  pickedRoleValues,
  pickedRoleSlugs,
  pickedRoleLabels,
  toggleRole,
  rolesByHost,
  roleRow,
  queryNewRoleRow,
  chooseShell,
  typeName,
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

const hostA = makeHost("1", "box-a", { username: "root", ip: "10.0.0.1" });
const hostB = makeHost("2", "box-b", { username: "root", ip: "10.0.0.2" });

const role = (name: string) => ({ name, description: "" });

// The host the dialog would hand to "New role…" right now — the observable
// stand-in for "which host is selected" when no role pins it (null = none).
function selectedHostViaNewRole(onNewRole: ReturnType<typeof vi.fn>): Host | null {
  fireEvent.click(queryNewRoleRow()!);
  const calls = onNewRole.mock.calls;
  return (calls[calls.length - 1][0] as { host: Host | null }).host;
}

const twoHostTree: HostFolder = {
  name: "root",
  children: [hostA, hostB],
};

const singleHostTree: HostFolder = {
  name: "root",
  children: [hostA],
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: one role returned matching "box-maintainer"
  mockListRolesForHost.mockResolvedValue([
    { name: "box-maintainer", description: "" },
  ]);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: open with initialHost + initialRole + identity-mode ON → both pre-filled
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog chain: Test 1 — initialHost + initialRole pre-fill both", () => {
  it("Test 1: open with initialHost=box-a + initialRole='box-maintainer' → host + role pre-selected", async () => {
    // Both hosts offer box-maintainer, so the composite value is what proves
    // box-a (not box-b) was seeded.
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("box-maintainer"), role("tina")], 2: [role("box-maintainer")] }),
    );
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
        initialHost={hostA}
        initialRole="box-maintainer"
      />,
    );

    // Roles group appears with the pre-filled role selected, on box-a
    await waitFor(() => {
      expect(pickedRoleValues()).toEqual(["1/box-maintainer"]);
    });
    expect(pickedRoleLabels()).toEqual(["Box Maintainer"]);
    // On box-a: the picked row sits in box-a's group, under its heading.
    const groupA = screen.getByTestId("role-pick-group-1");
    expect(groupA.contains(roleRow("1/box-maintainer"))).toBe(true);
    expect(groupA.querySelector(".k-group-title")?.textContent).toBe("box-a");

    // Every host was asked (the seed doesn't narrow the fetch), by numeric id
    expect(mockListRolesForHost.mock.calls.map((c) => c[0]).sort()).toEqual([1, 2]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: no props → existing behavior preserved (regression gate)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog chain: Test 2 — no props preserves existing behavior", () => {
  it("Test 2a: open with 1-host tree + no props → auto-select-single-host (roles group appears with \"No roles\" picked)", async () => {
    mockListRolesForHost.mockResolvedValue([
      { name: "box-maintainer", description: "" },
      { name: "tina", description: "" },
    ]);
    // Phase 84 hide-picker-when-1-host (commit bc07561e): with a
    // single-host tree the sole host is auto-selected. Agent mode has no
    // host list at all now (2026-10-18), and the roles group no longer waits
    // on a host, so the auto-select is observed through what "New role…"
    // would hand over (null when no host is selected).
    const onNewRole = vi.fn();
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={singleHostTree}
        onCreate={vi.fn()}
        onNewRole={onNewRole}
      />,
    );
    // Flat list (single host): bare role names; no role seeded, so the
    // one-host default "No roles" is what's picked.
    await waitFor(() => expect(roleOptionValues()).toEqual(["box-maintainer", "tina"]));
    expect(pickedRoleValues()).toEqual([NO_ROLES_VALUE]);
    expect(selectedHostViaNewRole(onNewRole)?.id).toBe("1");
  });

  it("Test 2b: open with 2-host tree + no props → no host list, nothing picked; roles group lists both hosts' roles", async () => {
    const onNewRole = vi.fn();
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
        onNewRole={onNewRole}
      />,
    );
    // No host list in agent mode — machine names only head the roles groups.
    expect(
      screen.queryAllByText("box-a").filter((el) => !el.closest('[data-testid="role-pick-list"]')),
    ).toEqual([]);
    await waitFor(() =>
      expect(roleOptionValues()).toEqual(["1/box-maintainer", "2/box-maintainer"]),
    );
    expect(pickedRoleValues()).toEqual([]);
    // No host auto-selected either.
    expect(selectedHostViaNewRole(onNewRole)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: initialHost only → host pre-filled, role empty
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog chain: Test 3 — initialHost alone", () => {
  it("Test 3: initialHost=box-a, initialRole not provided → host pre-filled + role empty", async () => {
    mockListRolesForHost.mockResolvedValue([
      { name: "box-maintainer", description: "" },
      { name: "general-assistant", description: "" },
    ]);
    const onNewRole = vi.fn();
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
        initialHost={hostA}
        onNewRole={onNewRole}
      />,
    );
    // Roles group appears (identity-mode default ON)
    await waitFor(() => expect(roleOptionValues()).toHaveLength(4));
    // Role selection empty (user must manually pick)
    expect(pickedRoleValues()).toEqual([]);
    // Host pre-selected: it is what "New role…" would hand over.
    expect(selectedHostViaNewRole(onNewRole)?.id).toBe("1");
  });

  it("Test 3b: initialHost + a single available role anywhere → nothing is auto-selected", async () => {
    // A host's only role is not picked for the user: with several hosts
    // nothing is preselected, "No roles" included.
    mockListRolesForHost.mockImplementation(rolesByHost({ 1: [role("box-maintainer")], 2: [] }));
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
        initialHost={hostA}
      />,
    );
    await waitFor(() => expect(roleOptionValues()).toEqual(["1/box-maintainer"]));
    expect(pickedRoleValues()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: initialRole only, no initialHost → role stays empty; auto-select single host still runs
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog chain: Test 4 — initialRole alone", () => {
  it("Test 4a: initialRole='box-maintainer' + 2-host tree (no auto-select) → role not seeded", async () => {
    // Default mock: box-maintainer on both hosts — two roles, no auto-select.
    // Without initialHost there is no telling which host's copy was meant.
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
        initialRole="box-maintainer"
      />,
    );
    await waitFor(() => expect(roleOptionValues()).toHaveLength(2));
    expect(pickedRoleValues()).toEqual([]);
  });

  it("Test 4b: initialRole='box-maintainer' + single-host tree → auto-select still runs; no role seeded (needs host-first seed)", async () => {
    // Phase 84 hide-picker-when-1-host (commit bc07561e): with a
    // single-host tree the sole host is auto-selected (Test 2a pins that).
    //
    // The assertion below is that initialRole WITHOUT initialHost does not
    // seed. Note the role names here deliberately EXCLUDE "box-maintainer" —
    // if the seed did wrongly apply, the phantom-role guard would also clear
    // it, so an empty pick would be ambiguous. Excluding it means the one-host
    // default can only mean "never seeded".
    mockListRolesForHost.mockResolvedValue([
      { name: "general-assistant", description: "" },
      { name: "video-producer", description: "" },
    ]);
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={singleHostTree}
        onCreate={vi.fn()}
        initialRole="box-maintainer"
      />,
    );
    // Roles group appears once the host's roles resolve
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    // No role seeded — initialRole is only seeded when initialHost is also
    // provided — so the one-host default "No roles" is picked.
    expect(pickedRoleValues()).toEqual([NO_ROLES_VALUE]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: roles group fetches for pre-filled host + pre-filled role appears in options
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog chain: Test 5 — roles group fetches for pre-filled host", () => {
  it("Test 5: initialHost + initialRole → listRolesForHost fired with host id, pre-filled role is in options", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("box-maintainer"), role("tina")], 2: [role("other-role")] }),
    );
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
        initialHost={hostA}
        initialRole="box-maintainer"
      />,
    );
    await waitFor(() => {
      expect(mockListRolesForHost).toHaveBeenCalledWith(1);
    });
    expect(mockListRolesForHost).toHaveBeenCalledWith(2);
    await waitFor(() => {
      expect(roleOptionValues()).toContain("1/box-maintainer");
    });
    // The pre-filled role stays selected because it's in the fetched list
    expect(pickedRoleValues()).toEqual(["1/box-maintainer"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: if pre-filled role is NOT in fetched roles → selectedRole cleared
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog chain: Test 6 — stale pre-filled role is cleared", () => {
  it("Test 6: initialRole='ghost-role' not in server response → selected roles cleared", async () => {
    // ghost-role exists on box-b but NOT on the seeded box-a — the guard
    // validates against the seeded host, so it is still cleared.
    mockListRolesForHost.mockImplementation(
      rolesByHost({ 1: [role("box-maintainer"), role("tina")], 2: [role("ghost-role")] }),
    );
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
        initialHost={hostA}
        initialRole="ghost-role"
      />,
    );
    // Wait for the fetch to complete
    await waitFor(() => {
      expect(mockListRolesForHost).toHaveBeenCalled();
    });
    await waitFor(() => {
      // box-a's roles landed but ghost-role is not among them → clear
      expect(roleOptionValues()).toEqual(["1/box-maintainer", "1/tina", "2/ghost-role"]);
      expect(pickedRoleValues()).toEqual([]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: pre-filled host and role are EDITABLE (not locked)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog chain: Test 7 — pre-filled fields are editable", () => {
  it("Test 7: user can change role — and host, via another host's role — after pre-fill", async () => {
    mockListRolesForHost.mockImplementation(
      rolesByHost({
        1: [role("box-maintainer"), role("tina")],
        2: [role("other-role"), role("another-role")],
      }),
    );
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
        initialHost={hostA}
        initialRole="box-maintainer"
      />,
    );
    // Wait for initial pre-fill
    await waitFor(() => {
      expect(pickedRoleValues()).toEqual(["1/box-maintainer"]);
    });
    // The rows MUST NOT be disabled
    expect(getRolesGroup()).toBeTruthy();
    expect(roleRow("1/tina")!.dataset.disabled).toBeUndefined();

    // Add a role on the same host
    toggleRole("tina");
    await waitFor(() => {
      expect(pickedRoleValues()).toEqual(["1/box-maintainer", "1/tina"]);
    });

    // Change host by picking box-b's role: the seed's picks give way
    toggleRole("other-role");
    await waitFor(() => {
      expect(pickedRoleValues()).toEqual(["2/other-role"]);
    });
    expect(pickedRoleLabels()).toEqual(["Other Role"]);
    expect(screen.getByTestId("role-pick-group-2").contains(roleRow("2/other-role"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8: seed values are not persisted across close/reopen without props
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog chain: Test 8 — seed values do not persist across close/reopen", () => {
  it("Test 8: open with seed → close → reopen without seed → default empty state", async () => {
    mockListRolesForHost.mockResolvedValue([
      { name: "box-maintainer", description: "" },
    ]);
    const { rerender } = render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
        initialHost={hostA}
        initialRole="box-maintainer"
      />,
    );
    await waitFor(() => {
      expect(pickedRoleValues()).toEqual(["1/box-maintainer"]);
    });

    // Close modal
    rerender(
      <NewSessionDialog
        open={false}
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
      />,
    );

    // Reopen without seed props on a 2-host tree — no host should auto-select
    const onNewRole = vi.fn();
    rerender(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
        onNewRole={onNewRole}
      />,
    );
    // Roles group is back (default mock: one role per host, no auto-select)
    // with nothing picked and no host carried over → stale state was cleared
    await waitFor(() => expect(roleOptionValues()).toHaveLength(2));
    expect(pickedRoleValues()).toEqual([]);
    expect(selectedHostViaNewRole(onNewRole)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10 (2026-08-05): initialBrief pre-fills the Brief textarea
// ─────────────────────────────────────────────────────────────────────────────
// Phase 86 Plan 86-04 stripped the Brief textarea (and all cosmetic UI)
// from NewSessionDialog. The initialBrief prop still exists on
// NewSessionDialogProps for API compatibility with PrettyConversationsPanel's
// chain-prefill, but no field consumes it. Tests 10a/10b/10c are rewritten
// as regression guards asserting the brief field STAYS deleted (per
// D-CTX-86-surface-4 acceptance criteria).
describe("NewSessionDialog chain: Test 10 — initialBrief ignored (brief field stripped in Phase 86)", () => {
  it("Test 10a: open with initialBrief='desc-from-role' + agent mode default → Brief textarea NOT rendered (regression guard)", async () => {
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
        initialHost={hostA}
        initialRole="box-maintainer"
        initialBrief="desc-from-role"
      />,
    );
    // Wait for roles group to appear so the identity-cluster is fully
    // rendered before we assert brief-absence
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    // The brief textarea was deleted in Phase 86 Plan 86-04. initialBrief
    // is accepted for API compat with chain-prefill but no UI consumes it.
    expect(screen.queryByLabelText(/^brief$/i)).toBeFalsy();
  });

  it("Test 10b: open with no initialBrief → Brief textarea NOT rendered (regression guard)", async () => {
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
      />,
    );
    // Phase 86 Plan 86-04 stripped the brief textarea. Regression guard
    // against accidental re-introduction.
    expect(screen.queryByLabelText(/^brief$/i)).toBeFalsy();
  });

  it("Test 10c: shell mode → brief field also absent (brief was identity-mode-only; now brief is always absent)", async () => {
    // The Agent / Shell switch is admin-gated, so isAdmin={true}. The brief
    // field was always identity-cluster-only and is always absent since
    // Phase 86, so this is trivially true — it still exercises the switch.
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
        initialHost={hostA}
        initialBrief="desc-from-role"
        isAdmin={true}
      />,
    );
    chooseShell();
    await waitFor(() => {
      expect(screen.queryByLabelText(/^brief$/i)).toBeFalsy();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9: user opts into shell mode → initialRole is IGNORED (roles group gone)
// ─────────────────────────────────────────────────────────────────────────────
// Phase 88 (Plan 88-03): semantic-inverted from the old "identity-mode OFF"
// framing; the tick-box is now the admin-only Agent / Shell switch, so this
// test renders under isAdmin={true}.
describe("NewSessionDialog chain: Test 9 — initialRole ignored when user opts into shell mode", () => {
  it("Test 9: open with seed → roles list populated; choose Shell → roles list gone; seed does not leak into shell mode", async () => {
    mockListRolesForHost.mockResolvedValue([
      { name: "box-maintainer", description: "" },
    ]);
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
        initialHost={hostA}
        initialRole="box-maintainer"
        isAdmin={true}
      />,
    );
    // Confirm roles group starts populated
    await waitFor(() => {
      expect(pickedRoleSlugs()).toEqual(["box-maintainer"]);
    });
    chooseShell();
    // Roles group must be gone (CREATE-only surface per D-CONTEXT §UX rules)
    await waitFor(() => {
      expect(queryRolesGroup()).toBeFalsy();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 11 (Phase 106 Plan 106-04, D-16 + D-18): birth+auto-route chain
// still fires after the terminal `ended:ok:true` event (single-event
// contract per D-10/D-12 — no per-step events on the wire under the new
// sole-spawner shape).
//
// This test pins the chain half of the D-21 axis: given a chain-prefilled
// modal (initialHost + initialRole) that leads into a successful birth, the
// auto-route chain (refreshOneIdentity → onCreate → onClose) still fires
// with the D-16 payload shape (identityMode: true, name preserved).
//
// The modal is opened with initialHost + initialRole (chain-prefill from a
// prior CreateRoleDialog handoff — Phase 22 SRIC-05); the user fills only
// the required name field and clicks Create. openBirthStream is mocked to
// yield ONLY a single `{ type: "ended", ok: true, ... }` event — matching
// Plan 106-01's new backend contract where step:1..5 events no longer exist.
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog chain: Test 11 — birth+auto-route chain fires on ended:ok:true (single-event contract)", () => {
  it("Test 11: chain-prefilled modal + successful birth (single ended:ok:true) → onCreate fires with identityMode:true + refreshOneIdentity called + onClose fires", async () => {
    mockListRolesForHost.mockResolvedValue([
      { name: "box-maintainer", description: "" },
    ]);

    // Plan 106-01's new wire contract: only the terminal `ended` event
    // matters to the frontend. Any intermediate step:6/7/8 events are
    // discarded (see NewSessionDialog.handleBirth's `if (evt.type ===
    // "ended") break;` — Plan 106-02 edit 8). Yielding a single
    // ended:ok:true event exercises the D-16 success chain without
    // depending on any pre-Phase-106 step-event scaffolding.
    async function* singleEndedOkStream() {
      await Promise.resolve(); // let React flush render before terminal event
      // Plan 106-01/106-02 single-event contract: `type: "ended", ok: true`.
      yield { type: "ended" as const, ok: true, identityId: "alicia", sessionName: "alicia" };
    }
    mockOpenBirthStream.mockReturnValueOnce(singleEndedOkStream());

    const onCreate = vi.fn();
    const onClose = vi.fn();

    render(
      <NewSessionDialog
        open
        onClose={onClose}
        hostTree={twoHostTree}
        onCreate={onCreate}
        initialHost={hostA}
        initialRole="box-maintainer"
      />,
    );

    // Wait for chain-prefill to settle: roles group appears with box-maintainer
    await waitFor(() => {
      expect(pickedRoleValues()).toEqual(["1/box-maintainer"]);
    });

    // Type a name (the Name field is always shown).
    typeName("alicia");

    // Wait for Create to become enabled, then click.
    await waitFor(() => {
      const createBtn = screen.getByRole("button", {
        name: /^(open|create|creating|creating agent)/i,
      }) as HTMLButtonElement;
      expect(createBtn.disabled).toBe(false);
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^(open|create|creating|creating agent)/i }),
    );

    // D-16 + D-18 chain: after the terminal ended:ok:true event, the
    // frontend fires refreshOneIdentity → onCreate → onClose.
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    // D-18: identities store was refreshed BEFORE onCreate (so AppShell's
    // openTab can resolve the new identity into pretty-view routing).
    expect(mockRefreshOneIdentity).toHaveBeenCalled();

    // D-16 payload shape preservation — AppShell.tsx:2236 onCreateSession
    // narrows on identityMode:true; this pins the wire contract that the
    // chain relies on.
    expect(onCreate.mock.calls[0][0]).toEqual(
      expect.objectContaining({ identityMode: true, name: "alicia" }),
    );

    // Sanity: the mock stream was consumed via a single ended event; no
    // step:3/4/5 events were required (D-10/D-12 single-ended contract).
    expect(mockOpenBirthStream).toHaveBeenCalledTimes(1);
    // The seeded host is where the agent is born.
    expect((mockOpenBirthStream.mock.calls[0][0] as { hostId: unknown }).hostId).toBe(1);
  });
});
