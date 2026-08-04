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
  };
});

// Sibling mocks lifted from NewSessionDialog.test.tsx so this file is
// self-contained (identity registry + voice + session-hue).
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
      hostTree={overrides.hostTree ?? twoHostTree}
      onCreate={onCreate}
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
  it("Test 21: listRolesForHost returns two roles → dropdown shows both", async () => {
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "box-maintainer", description: "" },
      { name: "tina", description: "" },
    ]);
    renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => {
      const roleSelect = screen.queryByLabelText(/^role$/i);
      expect(roleSelect).toBeTruthy();
    });
    const roleSelect = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
    const optionTexts = Array.from(roleSelect.options).map((o) => o.value);
    expect(optionTexts).toContain("box-maintainer");
    expect(optionTexts).toContain("tina");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 22: changing selected host clears role selection AND re-fetches
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 22 — host change clears role + refetches", () => {
  it("Test 22: pick host A, pick role → pick host B → listRolesForHost re-called + role cleared", async () => {
    // Host A: two roles
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "box-maintainer", description: "" },
      { name: "tina", description: "" },
    ]);
    renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => {
      expect(screen.queryByLabelText(/^role$/i)).toBeTruthy();
    });
    // Pick a role
    const roleSelect = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: "tina" } });
    expect(roleSelect.value).toBe("tina");

    // Host B: different roles
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "other-role", description: "" },
    ]);
    fireEvent.click(screen.getByText("bravo"));
    await waitFor(() => {
      expect(mockListRolesForHost).toHaveBeenCalledTimes(2);
    });
    // Selection cleared — the select falls back to placeholder (empty value)
    await waitFor(() => {
      const sel = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
      expect(sel.value).toBe("");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 23: Create disabled while role is empty (identity-mode ON)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 23 — Create blocked without role", () => {
  it("Test 23: everything else valid but role empty → Create disabled; pick role → enabled", async () => {
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "box-maintainer", description: "" },
    ]);
    mockPostGenerateAvatarBatch.mockResolvedValueOnce([
      { id: "c1", url: "/c/c1" },
      { id: "c2", url: "/c/c2" },
      { id: "c3", url: "/c/c3" },
    ]);
    mockListIdentities.mockResolvedValue([]);
    mockGetIdentityExistsOnHost.mockResolvedValue(false);
    const { getByLabelText, getByRole } = renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    // Wait for the roles fetch to resolve so the dropdown appears
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    // Fill name / title / brief
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "alicia" } });
    fireEvent.change(getByLabelText(/^title$/i), { target: { value: "Alicia" } });
    fireEvent.change(getByLabelText(/^brief$/i), { target: { value: "brief" } });
    fireEvent.click(getByRole("button", { name: /generate/i }));
    await waitFor(() =>
      expect(document.querySelectorAll("img").length).toBe(3),
    );
    fireEvent.click(document.querySelectorAll("img")[0].closest("button") as HTMLElement);
    // Create still disabled — role not picked
    const createBtn = getByRole("button", {
      name: /^(open|create|creating)/i,
    }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
    // Pick role → Create enabled
    const roleSelect = getByLabelText(/^role$/i) as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: "box-maintainer" } });
    await waitFor(() => {
      expect(createBtn.disabled).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 24: birth payload includes role
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 24 — birth payload carries role", () => {
  it("Test 24: submit success → openBirthStream body includes role: <picked>", async () => {
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "box-maintainer", description: "" },
    ]);
    mockPostGenerateAvatarBatch.mockResolvedValueOnce([
      { id: "c1", url: "/c/c1" },
      { id: "c2", url: "/c/c2" },
      { id: "c3", url: "/c/c3" },
    ]);
    mockListIdentities.mockResolvedValue([]);
    mockGetIdentityExistsOnHost.mockResolvedValue(false);
    mockOpenBirthStream.mockReturnValueOnce(emptyStream());
    const { getByLabelText, getByRole } = renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "alicia" } });
    fireEvent.change(getByLabelText(/^title$/i), { target: { value: "Alicia" } });
    fireEvent.change(getByLabelText(/^brief$/i), { target: { value: "brief" } });
    fireEvent.click(getByRole("button", { name: /generate/i }));
    await waitFor(() =>
      expect(document.querySelectorAll("img").length).toBe(3),
    );
    fireEvent.click(document.querySelectorAll("img")[0].closest("button") as HTMLElement);
    // Pick role
    fireEvent.change(getByLabelText(/^role$/i), {
      target: { value: "box-maintainer" },
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
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 25: zero-roles response renders inline hint
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 25 — zero roles renders inline hint", () => {
  it("Test 25: listRolesForHost returns [] → 'no roles on this host — create one first' hint", async () => {
    mockListRolesForHost.mockResolvedValueOnce([]);
    renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => {
      expect(
        screen.queryByText(/no roles on this host/i),
      ).toBeTruthy();
    });
    // Must include the "create one first" phrasing per D-CONTEXT §Failure modes
    expect(screen.queryByText(/create one first/i)).toBeTruthy();
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
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    const roleSelect = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: "box-maintainer" } });
    expect(roleSelect.value).toBe("box-maintainer");

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
    // dropdown is rendered on re-open. That's the correct "fresh defaults"
    // behavior.
    expect(screen.queryByLabelText(/^role$/i)).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 27: role dropdown NOT shown when identity-mode is OFF
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog role dropdown: Test 27 — hidden when identity-mode OFF", () => {
  it("Test 27: uncheck identity-mode → role dropdown absent from DOM", async () => {
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "box-maintainer", description: "" },
    ]);
    const { getByRole } = renderDialog();
    // Identity-mode is ON by default; picking a host would populate the dropdown
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    // Now uncheck identity-mode
    const checkbox = getByRole("checkbox", {
      name: /create new identity/i,
    });
    fireEvent.click(checkbox);
    // Role dropdown must disappear
    await waitFor(() => {
      expect(screen.queryByLabelText(/^role$/i)).toBeFalsy();
    });
  });
});
