// ─── NewSessionDialog task-input coverage (Phase 80 Plan 80-06) ─────────────
//
// Covers the Phase 80 unified-modal additions to NewSessionDialog:
//   1. Task textarea (identity-mode only, maxLength=200) — Task 1
//   2. Task string wired into openBirthStream request body — Task 1
//   3. poolPicked wire signal (true iff name is unedited pool prefill) — Task 1
//   4. pickPoolName auto-prefill on role change — Task 2
//   5. Prefill respects user-typed name (no overwrite when name != "") — Task 2
//   6. Role-select bug fix: "pick a host" hint OR widened auto-pick — Task 3
//
// Mock scaffolding lifted from NewSessionDialog.role-dropdown.test.tsx so this
// file is self-contained. Follows the sibling-test-file pattern (Landmine 10 —
// grow, don't rewrite; smaller focused suites over one giant one).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";

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
  getVoices: vi.fn().mockResolvedValue([
    { display_name: "Elena", filename: "Elena.wav" },
  ]),
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

function renderDialog(overrides: {
  open?: boolean;
  onClose?: () => void;
  onCreate?: ReturnType<typeof vi.fn>;
  hostTree?: HostFolder;
} = {}) {
  const onCreate = overrides.onCreate ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  const result = render(
    <NewSessionDialog
      open={overrides.open ?? true}
      onClose={onClose}
      hostTree={overrides.hostTree ?? oneHostTree}
      onCreate={onCreate}
    />,
  );
  return { ...result, onCreate, onClose };
}

// Helper that fills in a full identity form ready to submit, given a
// resolved role list. Selects the first role in the list.
async function fillFormForSubmit(opts: {
  name?: string;
  taskText?: string;
  editNameAfterPrefill?: boolean;
  waitForPrefill?: boolean;
} = {}) {
  const { name = "alicia", taskText, editNameAfterPrefill, waitForPrefill } = opts;
  // Wait for role dropdown to appear
  await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
  // Pick a role → triggers pickPoolName useEffect
  const roleSelect = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
  fireEvent.change(roleSelect, { target: { value: "box-maintainer" } });
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
  // Title + brief (required for Create enable)
  fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: "Alicia" } });
  fireEvent.change(screen.getByLabelText(/^brief$/i), { target: { value: "brief" } });
  // Task input — Phase 80 addition
  if (taskText !== undefined) {
    const taskArea = screen.getByLabelText(/^task$/i) as HTMLTextAreaElement;
    fireEvent.change(taskArea, { target: { value: taskText } });
  }
  // Generate + pick avatar
  fireEvent.click(screen.getByRole("button", { name: /generate/i }));
  await waitFor(() => expect(document.querySelectorAll("img").length).toBe(3));
  fireEvent.click(document.querySelectorAll("img")[0].closest("button") as HTMLElement);
  // Wait until Create is enabled
  await waitFor(() => {
    const createBtn = screen.getByRole("button", {
      name: /^(open|create|creating)/i,
    }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(false);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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

describe("NewSessionDialog task input: presence and attributes", () => {
  it("Task 1a: task textarea is rendered when identityMode=true", async () => {
    renderDialog();
    // Wait for identity cluster to be present (identity-mode is default on)
    await waitFor(() => {
      expect(screen.queryByLabelText(/^task$/i)).toBeTruthy();
    });
    const taskArea = screen.getByLabelText(/^task$/i) as HTMLTextAreaElement;
    expect(taskArea.tagName).toBe("TEXTAREA");
  });

  it("Task 1b: task textarea is absent when identityMode is toggled off", async () => {
    const { getByRole } = renderDialog();
    // Toggle off identity-mode
    const checkbox = getByRole("checkbox", {
      name: /create with new identity/i,
    });
    fireEvent.click(checkbox);
    await waitFor(() => {
      expect(screen.queryByLabelText(/^task$/i)).toBeFalsy();
    });
  });

  it("Task 1c: task textarea maxLength attribute is 200", async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.queryByLabelText(/^task$/i)).toBeTruthy();
    });
    const taskArea = screen.getByLabelText(/^task$/i) as HTMLTextAreaElement;
    expect(taskArea.maxLength).toBe(200);
  });
});

describe("NewSessionDialog task input: wiring into POST /identities/birth body", () => {
  it("Task 1d: submitting with a task string → birth body contains task: <typed value>", async () => {
    renderDialog();
    await fillFormForSubmit({ name: "alicia", taskText: "wire the pool-pick endpoint" });
    fireEvent.click(
      screen.getByRole("button", { name: /^(open|create|creating)/i }),
    );
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(payload.task).toBe("wire the pool-pick endpoint");
  });

  it("Task 1e: submitting with empty task → birth body omits task (undefined)", async () => {
    renderDialog();
    await fillFormForSubmit({ name: "alicia" }); // no taskText → left blank
    fireEvent.click(
      screen.getByRole("button", { name: /^(open|create|creating)/i }),
    );
    await waitFor(() => expect(mockOpenBirthStream).toHaveBeenCalledTimes(1));
    const [payload] = mockOpenBirthStream.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(payload.task).toBeUndefined();
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
  it("Task 2a: selecting a role calls pickPoolName(role, hostId) + name field is prefilled", async () => {
    mockPickPoolName.mockResolvedValueOnce({ name: "willow" });
    renderDialog();
    // Wait for the roles fetch to resolve so the dropdown appears
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    // Pick a role
    const roleSelect = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: "box-maintainer" } });
    // pickPoolName should be called with (role, hostIdNum)
    await waitFor(() => expect(mockPickPoolName).toHaveBeenCalled());
    const [role, hostId] = mockPickPoolName.mock.calls[0] as [string, number];
    expect(role).toBe("box-maintainer");
    expect(typeof hostId).toBe("number");
    // Name field populated with returned pool name
    await waitFor(() => {
      const nameInput = screen.getByLabelText(/^name$/i) as HTMLInputElement;
      expect(nameInput.value).toBe("willow");
    });
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
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    // User types a custom name FIRST (before any prefill).
    const nameInput = screen.getByLabelText(/^name$/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "custom-name" } });
    // Pick a role → pickPoolName resolves "willow" but name is non-empty, so no overwrite.
    const roleSelect = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: "box-maintainer" } });
    await waitFor(() => expect(mockPickPoolName).toHaveBeenCalled());
    // Give React a tick to potentially setName (but it shouldn't)
    await new Promise((r) => setTimeout(r, 50));
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe(
      "custom-name",
    );
  });

  it("Task 2c: pickPoolName failure is silent (no toast/error/throw) — user can type", async () => {
    mockPickPoolName.mockRejectedValueOnce(new Error("pool endpoint down"));
    renderDialog();
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    const roleSelect = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: "box-maintainer" } });
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

  it("Task 3b: user edits name after pool-prefill → submit body omits poolPicked", async () => {
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
    // Sanity: name is the user-edited value (lowercase)
    expect(payload.name).toBe("willow-my-custom");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3 — Role-select bug fix: "pick a host first" affordance
// ─────────────────────────────────────────────────────────────────────────────

describe("NewSessionDialog role-select bug fix: host-null affordance", () => {
  it("Task 3c: identityMode on + no host picked → 'pick a host' hint is visible", async () => {
    // Use two-host tree so no auto-select fires → selectedHost stays null on open
    renderDialog({ hostTree: twoHostTree });
    // Expect the "pick a host" hint to appear inside the identity cluster
    // (role dropdown itself is still host-gated at L961 — the hint fills the gap)
    await waitFor(() => {
      expect(screen.queryByText(/pick a host/i)).toBeTruthy();
    });
    // Sanity: role dropdown is still absent when host is null
    expect(screen.queryByLabelText(/^role$/i)).toBeFalsy();
  });

  it("Task 3d: identityMode on + one host auto-picked → 'pick a host' hint is NOT visible + role dropdown appears", async () => {
    renderDialog({ hostTree: oneHostTree });
    // Wait for auto-pick to resolve
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    // Hint should be gone (host is now picked)
    expect(screen.queryByText(/pick a host to see available roles/i)).toBeFalsy();
  });
});
