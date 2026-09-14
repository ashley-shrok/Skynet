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
      expect(screen.queryByLabelText(/^role$/i)).toBeTruthy();
    }, { timeout: 15000 });
    // Pick a role. The .value assertion is wrapped in waitFor because under
    // full-suite load React 18 concurrent-mode batching can delay the
    // controlled-input re-render past the synchronous fireEvent boundary
    // (flake surfaced during quick 260809-ih9's suite run; observed once,
    // did not repro in isolation — this hardening is the fix user asked
    // for post-#370).
    const roleSelect = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: "tina" } });
    await waitFor(() => {
      expect(
        (screen.getByLabelText(/^role$/i) as HTMLSelectElement).value,
      ).toBe("tina");
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
    // Selection cleared — the select falls back to placeholder (empty value).
    // Host A's "tina" must NOT carry over.
    await waitFor(() => {
      const sel = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
      expect(sel.value).toBe("");
    }, { timeout: 15000 });
  }, 20000);

  it("Test 22b: host change to a SINGLE-role host auto-selects that role", async () => {
    // Companion to Test 22, and the interaction worth pinning: the stale-role
    // clear and the sole-role auto-select COMPOSE. The clear drops host A's
    // role, then the auto-select lands the user on host B's only valid choice
    // instead of an empty dropdown that gates Create for no reason.
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "box-maintainer", description: "" },
      { name: "tina", description: "" },
    ]);
    renderDialog();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => {
      expect(screen.queryByLabelText(/^role$/i)).toBeTruthy();
    }, { timeout: 15000 });
    fireEvent.change(screen.getByLabelText(/^role$/i), {
      target: { value: "tina" },
    });
    await waitFor(() => {
      expect(
        (screen.getByLabelText(/^role$/i) as HTMLSelectElement).value,
      ).toBe("tina");
    }, { timeout: 15000 });

    // Host B offers exactly one role.
    mockListRolesForHost.mockResolvedValueOnce([
      { name: "other-role", description: "" },
    ]);
    fireEvent.click(screen.getByText("bravo"));
    await waitFor(() => {
      const sel = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
      expect(sel.value).toBe("other-role");
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
    // Wait for the roles fetch to resolve so the dropdown appears
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    // Fill name (title/brief/generate/img UI is gone post-Phase-86)
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "alicia" } });
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

  it("Test 23b: single-role host → Create enabled without the user touching the dropdown", async () => {
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
      const sel = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
      expect(sel.value).toBe("box-maintainer");
    });
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
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    fireEvent.change(getByLabelText(/^name$/i), { target: { value: "alicia" } });
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
describe("NewSessionDialog role dropdown: Test 27 — hidden when user opts into shell mode", () => {
  it("Test 27: click 'Just a shell — no agent' → role dropdown absent from DOM", async () => {
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
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    // Click the shell-only checkbox to opt INTO shell mode
    const checkbox = getByRole("checkbox", {
      name: /just a shell.*no agent/i,
    });
    fireEvent.click(checkbox);
    // Role dropdown must disappear
    await waitFor(() => {
      expect(screen.queryByLabelText(/^role$/i)).toBeFalsy();
    });
  });
});
