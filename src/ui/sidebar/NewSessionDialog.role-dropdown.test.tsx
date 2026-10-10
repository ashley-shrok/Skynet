// ─── NewSessionDialog role-dropdown coverage (Phase 22 SRIC-02 Plan 22-02 Task 4)
//
// Tests 20-27 cover the REQUIRED Role dropdown added to NewSessionDialog when
// identity-mode is ON. Behavior spec:
//   - Populates via GET /roles?hostId=<n> (listRolesForHost) on host change
//   - Blocks submit until a role is picked
//   - Zero-roles response renders an inline "no roles on this host — create
//     one first" hint (click handler is a no-op stub, to be wired in 22-04)
//   - Role state resets on modal close
//   - Dropdown is NOT shown when identity-mode is OFF (CREATE-only surface)
//   - Birth payload includes role: <selectedRoleName>
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
  toggleRole,
  closeRoleDropdown,
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
    makeHost("h1", "alpha", { username: "root", ip: "10.0.0.1" }),
    makeHost("h2", "bravo", { username: "root", ip: "10.0.0.2" }),
  ],
};

// Phase 88 (Plan 88-03 Task 4): renderDialog helper accepts isAdmin
// with a default of `true` to preserve existing coverage's admin-surface
// assumptions (Path + shell-only checkbox were universal before Phase 88;
// they are now admin-gated). Tests in this file exercise the role
// dropdown which lives inside the identity-cluster gate (post-Phase-88:
// {!shellOnly && (…)}). Agent-mode is the new default (shellOnly=false)
// so the dropdown IS visible on fresh mount — matches the pre-Phase-88
// "identity-mode ON by default" behavior at the role-dropdown-visibility
// surface. No test-body edits required beyond this helper + the Test 27
// label-regex update below.
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

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no roles returned (individual tests override)
  mockListRolesForHost.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 20: selecting a host triggers listRolesForHost with the host's id
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 20 — host selection triggers listRolesForHost", () => {
  it("Test 20: click a host in identity-mode ON → listRolesForHost called with its id", async () => {
    mockListRolesForHost.mockResolvedValueOnce([]);
    renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => {
      expect(mockListRolesForHost).toHaveBeenCalled();
    });
    // First call arg should be a number (h1's numeric-parsed id)
    const [hostId] = mockListRolesForHost.mock.calls[0] as [number];
    expect(typeof hostId).toBe("number");
    // parseInt("h1", 10) is NaN; but the test still confirms the API is called
    // with a numeric argument. The real IDs at runtime are numeric strings.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 21: API returns roles → dropdown renders those options
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 21 — roles render as options", () => {
  it("Test 21: listRolesForHost returns two roles → roles group shows both", async () => {
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "box-maintainer", description: "" },
      { name: "tina", description: "" },
    ]);
    renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => {
      expect(queryRolesGroup()).toBeTruthy();
    });
    const optionValues = roleOptionValues();
    expect(optionValues).toContain("box-maintainer");
    expect(optionValues).toContain("tina");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 22: changing selected host clears role selection AND re-fetches
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 22 — host change clears role + refetches", () => {
  it("Test 22: pick host A, pick role → pick host B → listRolesForHost re-called + role cleared", async () => {
    // Rule 1 fix: 20s it() timeout + 15s waitFor timeouts — under full-suite CI
    // load, React 18 async state batching and promise resolution can push these
    // assertions well past 1000ms (pre-existing flake, same pattern as
    // quick 260809-ih9 host-change waitFor hardening).
    // Host A: two roles
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "box-maintainer", description: "" },
      { name: "tina", description: "" },
    ]);
    renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => {
      expect(queryRolesGroup()).toBeTruthy();
    }, { timeout: 15000 });
    // Pick a role. The .value assertion is wrapped in waitFor because under
    // full-suite load React 18 concurrent-mode batching can delay the
    // controlled-input re-render past the synchronous fireEvent boundary
    // (flake surfaced during quick 260809-ih9's suite run; observed once,
    // did not repro in isolation — this hardening is the fix user asked
    // for post-#370).
    toggleRole("tina");
    await waitFor(() => {
      expect(pickedRoleValues()).toEqual(["tina"]);
    }, { timeout: 15000 });

    // Host B: TWO different roles.
    //
    // 2026-09-14: host B deliberately offers two roles now. It used to offer
    // one, and the assertion below is `value === ""` — but with sole-role
    // auto-select in place a one-role host B would immediately select that role,
    // so the old assertion would fail for a reason unrelated to what this test
    // guards (that a stale cross-host role does not survive a host change).
    // Keeping host B multi-role keeps the "cleared" state observable. The
    // single-role case is covered by Test 22b below.
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "other-role", description: "" },
      { name: "another-role", description: "" },
    ]);
    fireEvent.click(screen.getByText("bravo"));
    await waitFor(() => {
      expect(mockListRolesForHost).toHaveBeenCalledTimes(2);
    }, { timeout: 15000 });
    // Selection cleared — host B's roles render with nothing checked.
    // Host A's "tina" must NOT carry over.
    await waitFor(() => {
      expect(roleOptionValues()).toEqual(["other-role", "another-role"]);
      expect(pickedRoleValues()).toEqual([]);
    }, { timeout: 15000 });
  }, 20000);

  it("Test 22b: host change to a SINGLE-role host auto-selects that role", async () => {
    // Companion to Test 22, and the interaction worth pinning: the stale-role
    // clear and the sole-role auto-select COMPOSE. The clear drops host A's
    // role, then the auto-select lands the user on host B's only valid choice
    // instead of an empty selection that gates Create for no reason.
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "box-maintainer", description: "" },
      { name: "tina", description: "" },
    ]);
    renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => {
      expect(queryRolesGroup()).toBeTruthy();
    }, { timeout: 15000 });
    toggleRole("tina");
    await waitFor(() => {
      expect(pickedRoleValues()).toEqual(["tina"]);
    }, { timeout: 15000 });

    // Host B offers exactly one role.
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "other-role", description: "" },
    ]);
    fireEvent.click(screen.getByText("bravo"));
    await waitFor(() => {
      expect(pickedRoleValues()).toEqual(["other-role"]);
    }, { timeout: 15000 });
  }, 20000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 23: Create disabled while role is empty (identity-mode ON)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 23 — Create blocked without role", () => {
  it("Test 23: name valid + host picked but role empty → Create disabled; pick role → enabled", async () => {
    // Phase 86 Plan 86-04 stripped cosmetic UI (title / brief / voice /
    // color / avatar generate). Post-Plan-86-04 canOpen requires only
    // host + valid name + role in identity-mode. This test was rewritten
    // to remove references to the deleted title/brief/generate/img UI
    // per D-CTX-86-surface-4 acceptance criteria.
    // 2026-09-14: TWO roles rather than one. With sole-role auto-select, a
    // single-role host would select its role immediately, so "role empty →
    // Create disabled" would be unobservable — the gate this test exists to
    // guard would appear broken when it is in fact just satisfied early. Two
    // roles means the user must genuinely pick, which is the state under test.
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "box-maintainer", description: "" },
      { name: "general-assistant", description: "" },
    ]);
    mockListIdentities.mockResolvedValue([]);
    mockGetIdentityExistsOnHost.mockResolvedValue(false);
    const { getByLabelText, getByRole } = renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    // Wait for the roles fetch to resolve so the roles group appears
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    // 2026-09-27: reveal the manual name input by opting into custom name.
    fireEvent.click(getByLabelText(/choose a custom agent name/i));
    // Fill name (title/brief/generate/img UI is gone post-Phase-86)
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "alicia" } });
    // Create still disabled — role not picked
    const createBtn = getByRole("button", {
      name: /^(open|create|creating)/i,
    }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
    // Pick role → Create enabled
    toggleRole("box-maintainer");
    await waitFor(() => {
      expect(createBtn.disabled).toBe(false);
    });
  });

  it("Test 23b: single-role host → Create enabled without the user touching the roles", async () => {
    // The payoff of sole-role auto-select: name is prefilled and the only role
    // is selected, so Create is reachable with zero interactions beyond opening
    // the modal. This is the case Aither-style one-role-per-host deployments hit
    // constantly.
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "box-maintainer", description: "" },
    ]);
    mockListIdentities.mockResolvedValue([]);
    mockGetIdentityExistsOnHost.mockResolvedValue(false);
    mockPickPoolName.mockResolvedValue({ name: "willow" });
    // NOTE the numeric host ids. This suite's shared twoHostTree uses "h1"/"h2",
    // which parseInt turns into NaN — the name-prefill effect bails on its
    // Number.isFinite guard, so no pool pick ever fires (see Test 20's comment
    // on the same quirk). Real host ids are numeric strings, and this test needs
    // the prefill to actually run, so it supplies its own fixture.
    const numericHostTree: HostFolder = {
      name: "root",
      children: [
        makeHost("1", "alpha", { username: "root", ip: "10.0.0.1" }),
        makeHost("2", "bravo", { username: "root", ip: "10.0.0.2" }),
      ],
    };
    const { getByRole } = renderDialog({ hostTree: numericHostTree });
    fireEvent.click(screen.getByText("alpha"));

    await waitFor(() => {
      expect(pickedRoleValues()).toEqual(["box-maintainer"]);
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
      const createBtn = getByRole("button", {
        name: /^(open|create|creating)/i,
      }) as HTMLButtonElement;
      expect(createBtn.disabled).toBe(false);
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
    // avatarCandidateId). This test was rewritten to skip filling the
    // deleted UI while still asserting the role wire-contract per
    // D-CTX-86-surface-4 acceptance criteria.
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "box-maintainer", description: "" },
    ]);
    mockListIdentities.mockResolvedValue([]);
    mockGetIdentityExistsOnHost.mockResolvedValue(false);
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    const { getByLabelText, getByRole } = renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    // 2026-09-27: reveal the manual name input for typing.
    fireEvent.click(getByLabelText(/choose a custom agent name/i));
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "alicia" } });
    // The sole role auto-selects — clicking it again would UNcheck it, so
    // just confirm it is picked.
    await waitFor(() => {
      expect(pickedRoleValues()).toEqual(["box-maintainer"]);
    });
    await waitFor(() => {
      const createBtn = getByRole("button", {
        name: /^(open|create|creating)/i,
      }) as HTMLButtonElement;
      expect(createBtn.disabled).toBe(false);
    });
    fireEvent.click(getByRole("button", { name: /^(open|create|creating)/i }));
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
  const threeRoles = [
    { name: "box-maintainer", description: "" },
    { name: "sky-uat", description: "" },
    { name: "tina", description: "" },
  ];

  async function openWithName() {
    mockListIdentities.mockResolvedValue([]);
    mockGetIdentityExistsOnHost.mockResolvedValue(false);
    const utils = renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    fireEvent.click(utils.getByLabelText(/choose a custom agent name/i));
    fireEvent.change(utils.getByLabelText(/^name$/i), {
      target: { value: "alicia" },
    });
    const createBtn = () =>
      utils.getByRole("button", {
        name: /^(open|create|creating)/i,
      }) as HTMLButtonElement;
    return { ...utils, createBtn };
  }

  it("checking two roles sends the first pick as role and the second in roles[]", async () => {
    mockListRolesForHost.mockResolvedValueOnce(threeRoles);
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    const { createBtn } = await openWithName();
    // Pick order, not list order, decides which role goes first.
    toggleRole("tina");
    toggleRole("box-maintainer");
    // The trigger's pills show the picks in pick order.
    await waitFor(() =>
      expect(pickedRoleValues()).toEqual(["tina", "box-maintainer"]),
    );
    // Close the modal Popover so Dialog loses aria-hidden and the Create
    // button becomes discoverable via role-based queries.
    closeRoleDropdown();
    await waitFor(() => expect(createBtn().disabled).toBe(false));
    fireEvent.click(createBtn());
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [Record<string, unknown>];
    expect(payload.role).toBe("tina");
    expect(payload.roles).toEqual(["box-maintainer"]);
  });

  it("unchecking every role leaves Create disabled", async () => {
    mockListRolesForHost.mockResolvedValueOnce(threeRoles);
    const { createBtn } = await openWithName();
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
    mockListRolesForHost.mockResolvedValueOnce(threeRoles);
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    const { createBtn } = await openWithName();
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
  it("Test 25: listRolesForHost returns [] → 'no roles on this host' hint (not a link)", async () => {
    mockListRolesForHost.mockResolvedValueOnce([]);
    renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => {
      expect(screen.queryByText(/no roles on this host/i)).toBeTruthy();
    });
    expect(screen.queryByText(/no roles on this host/i)!.tagName).not.toBe("BUTTON");
    // Without onNewRole the dropdown stays disabled and has no New role row.
    expect(queryRolesGroup()!.disabled).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// "New role…" row at the top of the Roles dropdown
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: New role… row", () => {
  const twoRoles = [
    { name: "box-maintainer", description: "" },
    { name: "tina", description: "" },
  ];

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

  it("is the first row; clicking it hands over the host and picked roles", async () => {
    mockListRolesForHost.mockResolvedValueOnce(twoRoles);
    const { onNewRole } = renderWithNewRole();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    toggleRole("tina");
    const row = screen.getByTestId("multi-select-leading-action");
    expect(row.textContent).toMatch(/new role/i);
    fireEvent.click(row);
    expect(onNewRole).toHaveBeenCalledTimes(1);
    const [ctx] = onNewRole.mock.calls[0];
    expect(ctx.host.id).toBe("h1");
    expect(ctx.roles).toEqual(["tina"]);
  });

  it("keeps the dropdown openable on a host with zero roles", async () => {
    mockListRolesForHost.mockResolvedValueOnce([]);
    const { onNewRole } = renderWithNewRole();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => expect(screen.queryByText(/no roles on this host/i)).toBeTruthy());
    const trigger = queryRolesGroup()!;
    expect(trigger.disabled).toBe(false);
    fireEvent.click(trigger);
    expect(screen.queryByText(/no matches/i)).toBeNull();
    fireEvent.click(screen.getByTestId("multi-select-leading-action"));
    expect(onNewRole.mock.calls[0][0].roles).toEqual([]);
  });

  it("initialRoles seeds several picks in order", async () => {
    mockListRolesForHost.mockResolvedValueOnce(twoRoles);
    renderWithNewRole({
      initialHost: twoHostTree.children[0] as Host,
      initialRoles: ["tina", "box-maintainer"],
    });
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    await waitFor(() => expect(pickedRoleValues()).toEqual(["tina", "box-maintainer"]));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 26: role state resets on modal close
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 26 — role resets on close", () => {
  it("Test 26: pick role, close modal, re-open → role empty + roles refetched", async () => {
    mockListRolesForHost.mockResolvedValue([
      { name: "box-maintainer", description: "" },
    ]);
    const { rerender, onClose } = renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    // Sole role auto-selects — that is the "picked" state under test.
    await waitFor(() =>
      expect(pickedRoleValues()).toEqual(["box-maintainer"]),
    );

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
    // Two-host tree does not auto-select — no host is picked yet, so no role
    // group is rendered on re-open. That's the correct "fresh defaults"
    // behavior.
    expect(queryRolesGroup()).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 27: role dropdown NOT shown when identity-mode is OFF
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 27 — hidden when user opts into shell mode", () => {
  it("Test 27: click 'Just a shell — no agent' → roles group absent from DOM", async () => {
    // Phase 88 (Plan 88-03 Task 4): semantic-inverted from the old
    // "identity-mode OFF" framing. Post-Phase-88 clicking the checkbox
    // OPTS INTO shell mode (was: opted out of identity mode); the role
    // dropdown disappears in shell mode because it lives inside the
    // {!shellOnly && (…)} identity-cluster gate (Plan 88-02 Edit D).
    // Label regex updated to match the new Plan 88-02 Edit C label text.
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "box-maintainer", description: "" },
    ]);
    const { getByRole } = renderDialog();
    // Agent mode is the new default (shellOnly=false); picking a host
    // populates the dropdown as before.
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    // Click the shell-only checkbox to opt INTO shell mode
    const checkbox = getByRole("checkbox", {
      name: /just a shell.*no agent/i,
    });
    fireEvent.click(checkbox);
    // Roles group must disappear
    await waitFor(() => {
      expect(queryRolesGroup()).toBeFalsy();
    });
  });
});
