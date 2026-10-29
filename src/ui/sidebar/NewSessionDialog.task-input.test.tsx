// ─── NewSessionDialog task-input coverage (Phase 80 Plan 80-06) ─────────────
//
// Covers the Phase 80 unified-modal additions to NewSessionDialog:
//   1. Task textarea (identity-mode only, maxLength=200) — Task 1
//   2. Task string wired into openBirthStream request body — Task 1
//   3. poolPicked wire signal (true iff name is unedited pool prefill) — Task 1
//   4. pickPoolName auto-prefill on role change — Task 2
//   5. Prefill respects user-typed name (no overwrite when name != "") — Task 2
//   6. Role-select bug fix: "pick a host" hint OR widened auto-pick — Task 3
//      (2026-10-18: the hint is gone — agent mode has no host step and the
//      Roles dropdown lists every host's roles at open; Task 3c now pins
//      that the roles group shows with no host picked, and Task 2e re-suggests
//      on a host switch made by picking another host's role)
//   7. apple-ux 2026-10-22: the Name field is always shown (the "Choose a
//      custom agent name" tick-box is gone), pre-filled with the suggestion
//      and helped by "Suggested — change it if you like."; the admin-only
//      "Just a shell" tick-box became an Agent / Shell switch
//
// Mock scaffolding lifted from NewSessionDialog.role-dropdown.test.tsx so this
// file is self-contained. Follows the sibling-test-file pattern (Landmine 10 —
// grow, don't rewrite; smaller focused suites over one giant one).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, screen, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
}));

// Mock identities-api — including the new pickPoolName from plan 80-05.
const mockListIdentities = vi.fn().mockResolvedValue([]);
const mockPostGenerateAvatarBatch = vi.fn();
const mockGetIdentityExistsOnHost = vi.fn().mockResolvedValue(false);
const mockOpenBirthStream = vi.fn();
const mockListRolesForHost = vi.fn();
const mockPickPoolName = vi.fn();

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

// Sibling mocks so this file is self-contained (identity registry + voice + hue).
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
  refreshIdentities: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

// Empty stream helper — resolves immediately so submit path can capture the
// request payload without running the actual birth loop.
async function* emptyStream() {
  // nothing
}

import { NewSessionDialog } from "./NewSessionDialog";
import { clearHostRolesCache } from "./host-roles-cache";
import {
  queryRolesGroup,
  pickedRoleValues,
  roleOptionValues,
  toggleRole,
  chooseShell,
  nameInput,
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

// Single-host tree — dialog auto-selects the sole host on open so we skip the
// host-click step in most cases.
const oneHostTree: HostFolder = {
  name: "root",
  children: [
    makeHost("1", "alpha", { username: "root", ip: "10.0.0.1" }),
  ],
};

const twoHostTree: HostFolder = {
  name: "root",
  children: [
    makeHost("1", "alpha", { username: "root", ip: "10.0.0.1" }),
    makeHost("2", "bravo", { username: "root", ip: "10.0.0.2" }),
  ],
};

// Phase 88 (Plan 88-03 Task 5): renderDialog helper accepts isAdmin
// with a default of `true` to preserve existing coverage's admin-surface
// assumptions (Path + the Agent / Shell switch are admin-gated). Task 1b +
// Task 3e switch to Shell and so rely on the switch being rendered.
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
      hostTree={overrides.hostTree ?? oneHostTree}
      onCreate={onCreate}
      isAdmin={overrides.isAdmin ?? true}
    />,
  );
  return { ...result, onCreate, onClose };
}

// Ensure `slug` is checked in the Roles group (clicking an already-checked
// row would UNcheck it, so only click when it is not already picked).
function ensureRolePicked(slug: string) {
  if (!pickedRoleValues().includes(slug)) toggleRole(slug);
}

// Helper that fills in a full identity form ready to submit, given a
// resolved role list. Picks "box-maintainer".
async function fillFormForSubmit(opts: {
  name?: string;
  editNameAfterPrefill?: boolean;
  waitForPrefill?: boolean;
} = {}) {
  const { name = "alicia", editNameAfterPrefill, waitForPrefill } = opts;
  // Wait for the roles group to appear
  await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
  // Pick a role
  ensureRolePicked("box-maintainer");
  if (waitForPrefill) {
    await waitFor(() => expect(mockPickPoolName).toHaveBeenCalled());
    // Wait for name field to acquire prefilled value
    await waitFor(() => {
      const nameInput = screen.getByLabelText(/^name$/i) as HTMLInputElement;
      expect(nameInput.value.length).toBeGreaterThan(0);
    });
    if (editNameAfterPrefill) {
      const nameInput = screen.getByLabelText(/^name$/i) as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: name } });
    }
  } else {
    // No prefill — user types manually
    const nameInput = screen.getByLabelText(/^name$/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: name } });
  }
  // Phase 86 Plan 86-04: title / brief / generate / avatar-pick UI is
  // deleted from source. canOpen (post-Phase-86) requires only
  // host + valid name + role in identity-mode. The old scaffolding is
  // stripped from this helper accordingly.
  //
  // 2026-09-14: the task-textarea fill step is gone with the field itself —
  // birth always sends TASK_PLACEHOLDER, so there is nothing to type here.
  // Wait until Create is enabled
  await waitFor(() => {
    const createBtn = screen.getByRole("button", {
      name: /^(open|create|creating)/i,
    }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(false);
  });
}

beforeEach(() => {
  clearHostRolesCache();
  // Clear call history AND drain any leftover mockResolvedValueOnce queues so
  // an unconsumed Once-value from a prior test cannot leak into this one.
  // We do NOT use resetAllMocks() because that wipes the vi.mock() factory-
  // returned function bodies (mockListRolesForHost etc.) and breaks every
  // test that relies on them being callable at all.
  vi.clearAllMocks();
  mockListRolesForHost.mockReset();
  mockPickPoolName.mockReset();
  mockOpenBirthStream.mockReset();
  mockListIdentities.mockReset();
  mockGetIdentityExistsOnHost.mockReset();
  mockPostGenerateAvatarBatch.mockReset();
  // Default: one role available, so identity-mode form is submittable
  mockListRolesForHost.mockResolvedValue([
    { name: "box-maintainer", description: "" },
  ]);
  mockListIdentities.mockResolvedValue([]);
  mockGetIdentityExistsOnHost.mockResolvedValue(false);
  mockPostGenerateAvatarBatch.mockResolvedValue([
    { id: "c1", url: "/c/c1" },
    { id: "c2", url: "/c/c2" },
    { id: "c3", url: "/c/c3" },
  ]);
  mockOpenBirthStream.mockReturnValue(emptyStream());
  // Default pickPoolName failure — individual tests override with resolved values
  mockPickPoolName.mockRejectedValue(new Error("no pool endpoint in this test"));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 1 — Task textarea presence + attributes + wiring into birth body
// ─────────────────────────────────────────────────────────────────────────────

describe("NewSessionDialog task input: removed from the modal (2026-09-14)", () => {
  // The "What will this agent work on?" textarea was REMOVED. It asked too
  // early — the user often does not know at creation time, and restates it
  // conversationally the moment the agent wakes. Birth now records
  // TASK_PLACEHOLDER and the agent overwrites its own `task:` frontmatter on
  // first wake (substrate/skills/id/SKILL.md).
  //
  // Original 1a (textarea present) and 1c (maxLength=200) are inverted/dropped;
  // 1b survives because "absent in shell mode" is still true — it is now absent
  // in BOTH modes.

  it("Task 1a: task textarea is absent in agent mode (the field is gone)", async () => {
    renderDialog();
    // Wait on the roles group first: it proves the agent-mode cluster
    // actually rendered, so a missing textarea is meaningful rather than just
    // "nothing has mounted yet".
    await waitFor(() => {
      expect(queryRolesGroup()).toBeTruthy();
    });
    expect(screen.queryByLabelText(/^task$/i)).toBeFalsy();
    expect(screen.queryByText(/what will this agent work on/i)).toBeFalsy();
  });

  it("Task 1b: task textarea is absent in shell mode too", async () => {
    renderDialog();
    chooseShell();
    await waitFor(() => {
      expect(screen.queryByLabelText(/^task$/i)).toBeFalsy();
    });
  });
});

describe("NewSessionDialog task input: wiring into POST /identities/birth body", () => {
  it("Task 1d: birth body carries the placeholder", async () => {
    renderDialog();
    await fillFormForSubmit({ name: "alicia" });
    fireEvent.click(
      screen.getByRole("button", { name: /^(open|create|creating)/i }),
    );
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(payload.task).toBe("Untitled conversation");
  });

  it("Task 1e: placeholder is sent unconditionally, never omitted", async () => {
    // Sent rather than omitted so the row has readable primary text from the
    // moment it appears — PrettyConversationRow renders `task` as the row's
    // primary line, and an absent value would render blank until first wake.
    renderDialog();
    await fillFormForSubmit({ name: "bella" });
    fireEvent.click(
      screen.getByRole("button", { name: /^(open|create|creating)/i }),
    );
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(payload.task).toBeDefined();
    expect(payload.task).not.toBe("");
  });
});

describe("NewSessionDialog task input: poolPicked wire signal (A1 MXID lock)", () => {
  it("Task 1f: user manually types name (no pool prefill) → birth body omits poolPicked", async () => {
    renderDialog();
    await fillFormForSubmit({ name: "alicia" });
    fireEvent.click(
      screen.getByRole("button", { name: /^(open|create|creating)/i }),
    );
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(payload.poolPicked).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2 — Auto-prefill via pickPoolName on role change
// ─────────────────────────────────────────────────────────────────────────────

describe("NewSessionDialog task input: pickPoolName auto-prefill", () => {
  it("Task 2a: the suggestion request fires once on host-select and prefills the name", async () => {
    // 2026-09-14: the request is keyed on HOST, not role. It used to fire on role
    // selection; now it fires as soon as a host is known, and picking a role does
    // NOT re-issue it — role has no bearing on the answer (availability is
    // host-scoped), so a re-pick would spend a second SSH round-trip on a result
    // the apply-guard would then discard.
    //
    // Signature is (hostId, role?) with hostId leading, since it is the only
    // required argument now.
    mockListRolesForHost.mockResolvedValue([
      { name: "box-maintainer", description: "" },
      { name: "tina", description: "" },
    ]);
    mockPickPoolName.mockResolvedValueOnce({ name: "willow" });
    renderDialog();

    await waitFor(() => expect(mockPickPoolName).toHaveBeenCalled());
    const [hostId] = mockPickPoolName.mock.calls[0] as [
      number,
      string | undefined,
    ];
    expect(typeof hostId).toBe("number");


    // Name field populated with returned pool name
    await waitFor(() => {
      const nameInput = screen.getByLabelText(/^name$/i) as HTMLInputElement;
      expect(nameInput.value).toBe("willow");
    });

    // Picking a role must NOT trigger another request.
    const callsBefore = mockPickPoolName.mock.calls.length;
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    toggleRole("box-maintainer");
    await waitFor(() =>
      expect(pickedRoleValues()).toEqual(["box-maintainer"]),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPickPoolName.mock.calls.length).toBe(callsBefore);
  });

  it("Task 2b: user-typed name is NOT overwritten when role changes and pool returns a value", async () => {
    // First role change returns "willow", second returns "cinder"
    mockPickPoolName
      .mockResolvedValueOnce({ name: "willow" })
      .mockResolvedValueOnce({ name: "cinder" });
    // Two-host tree so we start with no host — user picks alpha then bravo.
    // Simpler: single-host tree, but list two roles so we can change role.
    mockListRolesForHost.mockResolvedValue([
      { name: "box-maintainer", description: "" },
      { name: "tina", description: "" },
    ]);
    renderDialog();
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    // User types a custom name FIRST (before any prefill).
    const nameInput = screen.getByLabelText(/^name$/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "custom-name" } });
    // Pick a role → pickPoolName resolves "willow" but name is non-empty, so no overwrite.
    toggleRole("box-maintainer");
    await waitFor(() => expect(mockPickPoolName).toHaveBeenCalled());
    // Give React a tick to potentially setName (but it shouldn't)
    await new Promise((r) => setTimeout(r, 50));
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe(
      "custom-name",
    );
  });

  it("Task 2b-race: a name typed WHILE a suggestion is in flight is not overwritten", async () => {
    // The race Task 2b no longer reaches. Since the role gate came off, the
    // suggestion request fires at modal open — so the dangerous window is "user
    // starts typing a name they already know, and the in-flight response lands
    // after them". The effect must not clobber what they typed.
    //
    // Task 2b types AFTER a prefill has already landed, so it only proves
    // "non-empty field is not overwritten". Here the field is genuinely empty at
    // the moment the request is issued, which is what makes the stale-closure
    // read observable.
    let releasePick: (v: { name: string }) => void = () => {};
    mockPickPoolName.mockImplementation(
      () => new Promise((resolve) => { releasePick = resolve; }),
    );
    mockListRolesForHost.mockResolvedValue([
      { name: "box-maintainer", description: "" },
      { name: "general-assistant", description: "" },
    ]);
    renderDialog();

    // Request is in flight, field still empty.
    await waitFor(() => expect(mockPickPoolName).toHaveBeenCalled());
    const nameInput = screen.getByLabelText(/^name$/i) as HTMLInputElement;
    expect(nameInput.value).toBe("");

    // User types while the suggestion is still pending.
    fireEvent.change(nameInput, { target: { value: "sample" } });
    expect(
      (screen.getByLabelText(/^name$/i) as HTMLInputElement).value,
    ).toBe("sample");

    // Suggestion now resolves — intent must win.
    releasePick({ name: "willow" });
    await new Promise((r) => setTimeout(r, 50));
    expect(
      (screen.getByLabelText(/^name$/i) as HTMLInputElement).value,
    ).toBe("sample");
  });

  it("Task 2e: switching hosts (via another host's role) re-suggests, replacing an unedited suggestion", async () => {
    // A suggestion is only trustworthy for the host it was checked against, so a
    // host switch must replace an untouched suggestion rather than leave the
    // previous host's name sitting there. Distinct from Task 2b: that guards a
    // USER-TYPED name; this one is a name only we wrote.
    //
    // 2026-10-18: there is no host list in agent mode — the host switches when
    // the user picks a role from a different host's section.
    mockPickPoolName
      .mockResolvedValueOnce({ name: "willow" })
      .mockResolvedValueOnce({ name: "aster" });
    // Every host answers with the same two roles.
    mockListRolesForHost.mockResolvedValue([
      { name: "box-maintainer", description: "" },
      { name: "general-assistant", description: "" },
    ]);
    // Numeric ids so the effect's Number.isFinite guard passes.
    renderDialog({ hostTree: twoHostTree });

    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    // No host yet → no suggestion yet.
    expect(mockPickPoolName).not.toHaveBeenCalled();
    toggleRole("box-maintainer", "1");
    await waitFor(() => {
      expect(
        (screen.getByLabelText(/^name$/i) as HTMLInputElement).value,
      ).toBe("willow");
    });
    expect(mockPickPoolName.mock.calls[0][0]).toBe(1);

    toggleRole("box-maintainer", "2");
    await waitFor(() => {
      expect(
        (screen.getByLabelText(/^name$/i) as HTMLInputElement).value,
      ).toBe("aster");
    });
    expect(mockPickPoolName.mock.calls[1][0]).toBe(2);
  });

  it("Task 2c: pickPoolName failure is silent (no toast/error/throw) — user can type", async () => {
    mockPickPoolName.mockRejectedValueOnce(new Error("pool endpoint down"));
    renderDialog();
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    ensureRolePicked("box-maintainer");
    await waitFor(() => expect(mockPickPoolName).toHaveBeenCalled());
    // Give it a beat to settle
    await new Promise((r) => setTimeout(r, 50));
    // No new error text like "pool endpoint down" should surface anywhere
    expect(screen.queryByText(/pool endpoint down/i)).toBeFalsy();
    // Name field still empty so user can type
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe(
      "",
    );
  });
  it("Task 2d: name prefills with NO role selected (2026-09-14 — role gate removed)", async () => {
    // The prefill effect used to early-return on `!selectedRole`, so the Name
    // field sat empty until the user also picked a role. Role never had
    // anything to do with name availability — it was only there to compose the
    // MXID the old probe checked. With availability answered by the host, the
    // suggestion lands as soon as a host is known.

    mockListRolesForHost.mockResolvedValue([
      { name: "box-maintainer", description: "" },
      { name: "general-assistant", description: "" },
    ]);
    mockPickPoolName.mockResolvedValue({ name: "willow" });
    renderDialog();

    await waitFor(() => {
      const nameInput = screen.getByLabelText(/^name$/i) as HTMLInputElement;
      expect(nameInput.value).toBe("willow");
    });

    // No role picked ("No roles" is the one-host default), and the call
    // carried role === undefined.
    expect(pickedRoleValues()).toEqual([NO_ROLES_VALUE]);
    const [hostId, role] = mockPickPoolName.mock.calls[0] as [
      number,
      string | undefined,
    ];
    expect(typeof hostId).toBe("number");
    expect(role).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 1 + 2 — poolPicked wire signal end-to-end (A1 MXID lock)
// ─────────────────────────────────────────────────────────────────────────────

describe("NewSessionDialog task input: poolPicked wire signal end-to-end", () => {
  it("Task 3a: unedited pool-prefilled name → submit body contains poolPicked: true", async () => {
    mockPickPoolName.mockResolvedValueOnce({ name: "willow" });
    renderDialog();
    await fillFormForSubmit({ waitForPrefill: true });
    fireEvent.click(
      screen.getByRole("button", { name: /^(open|create|creating)/i }),
    );
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(payload.poolPicked).toBe(true);
    // Sanity: name is the pool-picked value
    expect(payload.name).toBe("willow");
  });

  it("Task 3b: user edits name after pool-prefill → submit body omits poolPicked and sends displayName (pretty-names shape 2026-09-30)", async () => {
    mockPickPoolName.mockResolvedValueOnce({ name: "willow" });
    renderDialog();
    await fillFormForSubmit({
      waitForPrefill: true,
      editNameAfterPrefill: true,
      name: "willow-my-custom",
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^(open|create|creating)/i }),
    );
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(payload.poolPicked).toBeUndefined();
    // Pretty-names shape: edited (= name-it-myself) submits displayName; the
    // backend derives the slug. `name` is absent on the wire.
    expect(payload.name).toBeUndefined();
    expect(payload.displayName).toBe("willow-my-custom");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3 — Role-select bug fix: "pick a host first" affordance
// 2026-10-18: superseded — there is no host step in agent mode, so the hint
// it added is gone. The roles group renders with no host picked instead.
// ─────────────────────────────────────────────────────────────────────────────

describe("NewSessionDialog role-select bug fix: host-null affordance", () => {
  it("Task 3c: agent mode (default) + several hosts, none picked → roles group shows every host's roles; no 'Pick a host' hint", async () => {
    // Was: the "Pick a host to see available roles." hint showed until a host
    // was clicked. Agent mode no longer has a host list, so the dropdown itself
    // is the affordance — it must be there, populated, with no host chosen.
    renderDialog({ hostTree: twoHostTree });
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    expect(roleOptionValues()).toEqual(["1/box-maintainer", "2/box-maintainer"]);
    expect(pickedRoleValues()).toEqual([]);
    expect(screen.queryByText(/pick a host/i)).toBeFalsy();
  });

  it("Task 3d: agent mode (default) + one host auto-picked → hint is NOT visible + roles group appears", async () => {
    renderDialog({ hostTree: oneHostTree });
    // Wait for auto-pick to resolve
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    // Hint should be gone (host is now picked)
    expect(
      screen.queryByText(/pick a host to see available roles/i),
    ).toBeFalsy();
  });

  it("Task 3e: user opts into shell mode + no host picked → hint is NOT visible (hint is agent-mode-only)", async () => {
    // Phase 88: choosing Shell (now the Agent / Shell switch; was a tick-box,
    // and before that opting out of identity mode). The hint lived in the agent-cluster (post-Phase-88
    // {!shellOnly && (…)} gate), so opting into shell mode removes the hint.
    renderDialog({ hostTree: twoHostTree });
    chooseShell();
    // Hint must NOT be visible in shell mode.
    await waitFor(() => {
      expect(
        screen.queryByText(/pick a host to see available roles/i),
      ).toBeFalsy();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// apple-ux 2026-10-22 — the Name is always shown and pre-filled
// Shape §What would make it wrong: "A name field hidden behind a tick-box, or
// a suggested name overwriting one the user typed."
// ─────────────────────────────────────────────────────────────────────────────

describe("NewSessionDialog name: always shown, pre-filled with the suggestion", () => {
  const SUGGESTED_HELP = "Suggested — change it if you like.";

  it("the suggestion lands in the visible Name field with its help line, no tick-box needed", async () => {
    mockPickPoolName.mockResolvedValue({ name: "willow" });
    renderDialog();
    // The field is there before the suggestion arrives.
    expect(nameInput()).toBeTruthy();
    expect(screen.queryByLabelText(/choose a custom agent name/i)).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    await waitFor(() => expect(nameInput().value).toBe("willow"));
    expect(screen.getByText(SUGGESTED_HELP)).toBeTruthy();
  });

  it("typing replaces the suggestion and the help line goes; typing the suggestion back counts as the suggestion again", async () => {
    mockPickPoolName.mockResolvedValue({ name: "willow" });
    renderDialog();
    await waitFor(() => expect(nameInput().value).toBe("willow"));
    typeName("Alicia Smith");
    expect(nameInput().value).toBe("Alicia Smith");
    expect(screen.queryByText(SUGGESTED_HELP)).toBeNull();
    typeName("willow");
    expect(screen.getByText(SUGGESTED_HELP)).toBeTruthy();
  });

  it("a later suggestion (host switch) never overwrites a typed name", async () => {
    mockPickPoolName
      .mockResolvedValueOnce({ name: "willow" })
      .mockResolvedValueOnce({ name: "aster" });
    mockListRolesForHost.mockResolvedValue([{ name: "box-maintainer", description: "" }]);
    renderDialog({ hostTree: twoHostTree });
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    toggleRole("box-maintainer", "1");
    await waitFor(() => expect(nameInput().value).toBe("willow"));
    typeName("my-own");
    toggleRole("box-maintainer", "2");
    await waitFor(() => expect(mockPickPoolName).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(nameInput().value).toBe("my-own");
    expect(screen.queryByText(SUGGESTED_HELP)).toBeNull();
  });

  it("a machine change drops the previous machine's untouched suggestion; the new machine's fills in", async () => {
    let resolveSecond!: (v: { name: string }) => void;
    mockPickPoolName
      .mockResolvedValueOnce({ name: "willow" })
      .mockImplementationOnce(() => new Promise((r) => { resolveSecond = r; }));
    mockListRolesForHost.mockResolvedValue([{ name: "box-maintainer", description: "" }]);
    renderDialog({ hostTree: twoHostTree });
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    toggleRole("box-maintainer", "1");
    await waitFor(() => expect(nameInput().value).toBe("willow"));
    expect(screen.getByText(SUGGESTED_HELP)).toBeTruthy();
    // Picking on the other machine: willow was checked on machine 1 only.
    toggleRole("box-maintainer", "2");
    await waitFor(() => expect(mockPickPoolName).toHaveBeenCalledTimes(2));
    expect(nameInput().value).toBe("");
    expect(screen.queryByText(SUGGESTED_HELP)).toBeNull();
    // Machine 2's own suggestion lands in the emptied field, labelled again.
    resolveSecond({ name: "aster" });
    await waitFor(() => expect(nameInput().value).toBe("aster"));
    expect(screen.getByText(SUGGESTED_HELP)).toBeTruthy();
  });

  it("a machine change whose suggestion fails leaves an empty field, not the old machine's name", async () => {
    mockPickPoolName
      .mockResolvedValueOnce({ name: "willow" })
      .mockRejectedValueOnce(new Error("pool down"));
    mockListRolesForHost.mockResolvedValue([{ name: "box-maintainer", description: "" }]);
    renderDialog({ hostTree: twoHostTree });
    await waitFor(() => expect(queryRolesGroup()).toBeTruthy());
    toggleRole("box-maintainer", "1");
    await waitFor(() => expect(nameInput().value).toBe("willow"));
    toggleRole("box-maintainer", "2");
    await waitFor(() => expect(mockPickPoolName).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(nameInput().value).toBe("");
    expect(nameInput().disabled).toBe(false);
    expect(screen.queryByText(SUGGESTED_HELP)).toBeNull();
  });

  it("no suggestion (pool down) → the field is empty and typable, with no help line and no error", async () => {
    renderDialog();
    await waitFor(() => expect(mockPickPoolName).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(nameInput().value).toBe("");
    expect(nameInput().disabled).toBe(false);
    expect(screen.queryByText(SUGGESTED_HELP)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    typeName("alicia");
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /^create$/i }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });
});
