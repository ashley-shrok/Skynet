// ─── NewSessionDialog chain-prefill coverage (Phase 22 SRIC-05 Plan 22-05 Task 1)
//
// Tests 1-9 cover the NEW optional `initialHost` + `initialRole` props on
// NewSessionDialog that let a parent (PrettyConversationsPanel) chain in from
// CreateRoleDialog with role + host pre-filled. Behavior spec:
//   - Test 1: open with initialHost + initialRole + identity-mode ON → both pre-filled
//   - Test 2: open with no props → existing behavior preserved (auto-select-single-host if 1 host, else null)
//   - Test 3: initialHost only → host pre-filled, role empty (dropdown requires manual pick)
//   - Test 4: initialRole only (no host) → role stays empty (can't seed without host);
//              auto-select-single-host still runs
//   - Test 5: when opened with both, role dropdown fetches roles-for-host and the
//              pre-filled role appears in the returned options
//   - Test 6: if pre-filled role is NOT in the fetched roles list → selectedRole is CLEARED
//   - Test 7: both pre-filled fields are EDITABLE (not locked / not disabled)
//   - Test 8: on close + reopen without props → default empty state (no stale seed)
//   - Test 9: identity-mode OFF → initialRole is IGNORED (role dropdown only exists in
//              identity-mode)
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

const hostA = makeHost("h1", "box-a", { username: "root", ip: "10.0.0.1" });
const hostB = makeHost("h2", "box-b", { username: "root", ip: "10.0.0.2" });

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
    mockListRolesForHost.mockResolvedValue([
      { name: "box-maintainer", description: "" },
      { name: "tina", description: "" },
    ]);
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

    // Host is pre-selected: the corresponding option row has aria-selected=true
    await waitFor(() => {
      const hostRow = screen.getByRole("option", { name: /box-a/i });
      expect(hostRow.getAttribute("aria-selected")).toBe("true");
    });

    // Role dropdown appears with the pre-filled role selected
    await waitFor(() => {
      const sel = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
      expect(sel.value).toBe("box-maintainer");
    });

    // listRolesForHost was called with box-a's numeric id
    expect(mockListRolesForHost).toHaveBeenCalled();
    const [hostId] = mockListRolesForHost.mock.calls[0] as [number];
    expect(typeof hostId).toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: no props → existing behavior preserved (regression gate)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog chain: Test 2 — no props preserves existing behavior", () => {
  it("Test 2a: open with 1-host tree + no props → auto-select-single-host + empty role", async () => {
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={singleHostTree}
        onCreate={vi.fn()}
      />,
    );
    // Auto-select happens because there's only one host
    await waitFor(() => {
      const hostRow = screen.getByRole("option", { name: /box-a/i });
      expect(hostRow.getAttribute("aria-selected")).toBe("true");
    });
    // Role dropdown fetches roles for that host, but selection stays empty
    await waitFor(() => {
      const sel = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
      expect(sel.value).toBe("");
    });
  });

  it("Test 2b: open with 2-host tree + no props → no auto-select, no role dropdown", () => {
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
      />,
    );
    // Neither host row is selected (aria-selected may be "false" or absent —
    // React 18 normalizes falsy boolean aria attrs to string "false" only on
    // some paths; the reliable test is "no row has aria-selected=true").
    const rows = screen.getAllByRole("option");
    for (const r of rows) {
      expect(r.getAttribute("aria-selected")).not.toBe("true");
    }
    // No role dropdown rendered because no host is picked
    expect(screen.queryByLabelText(/^role$/i)).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: initialHost only → host pre-filled, role empty
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog chain: Test 3 — initialHost alone", () => {
  it("Test 3: initialHost=box-a, initialRole not provided → host pre-filled + role empty", async () => {
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
        initialHost={hostA}
      />,
    );
    // Host pre-selected
    await waitFor(() => {
      const hostRow = screen.getByRole("option", { name: /box-a/i });
      expect(hostRow.getAttribute("aria-selected")).toBe("true");
    });
    // Role dropdown appears (identity-mode default ON, host picked → dropdown renders)
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    // Role selection empty (user must manually pick)
    const sel = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
    expect(sel.value).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: initialRole only, no initialHost → role stays empty; auto-select single host still runs
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog chain: Test 4 — initialRole alone", () => {
  it("Test 4a: initialRole='box-maintainer' + 2-host tree (no auto-select) → role empty + no dropdown", () => {
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
        initialRole="box-maintainer"
      />,
    );
    // No host picked → no role dropdown rendered
    expect(screen.queryByLabelText(/^role$/i)).toBeFalsy();
  });

  it("Test 4b: initialRole='box-maintainer' + single-host tree → auto-select still runs; role empty (needs host-first seed)", async () => {
    render(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={singleHostTree}
        onCreate={vi.fn()}
        initialRole="box-maintainer"
      />,
    );
    // Auto-select still runs (Test 2a behavior)
    await waitFor(() => {
      const hostRow = screen.getByRole("option", { name: /box-a/i });
      expect(hostRow.getAttribute("aria-selected")).toBe("true");
    });
    // Role dropdown appears
    await waitFor(() => expect(screen.queryByLabelText(/^role$/i)).toBeTruthy());
    // Role selection stays empty — initialRole is only seeded when initialHost is also provided
    const sel = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
    expect(sel.value).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: role dropdown fetches for pre-filled host + pre-filled role appears in options
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog chain: Test 5 — role dropdown fetches for pre-filled host", () => {
  it("Test 5: initialHost + initialRole → listRolesForHost fired with host id, pre-filled role is in options", async () => {
    mockListRolesForHost.mockResolvedValue([
      { name: "box-maintainer", description: "" },
      { name: "tina", description: "" },
    ]);
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
      expect(mockListRolesForHost).toHaveBeenCalled();
    });
    await waitFor(() => {
      const sel = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
      const optionVals = Array.from(sel.options).map((o) => o.value);
      expect(optionVals).toContain("box-maintainer");
    });
    // The pre-filled role stays selected because it's in the fetched list
    const sel = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
    expect(sel.value).toBe("box-maintainer");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: if pre-filled role is NOT in fetched roles → selectedRole cleared
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog chain: Test 6 — stale pre-filled role is cleared", () => {
  it("Test 6: initialRole='ghost-role' not in server response → selectedRole cleared to ''", async () => {
    mockListRolesForHost.mockResolvedValue([
      { name: "box-maintainer", description: "" },
      { name: "tina", description: "" },
    ]);
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
      const sel = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
      // rolesForHost has been populated but ghost-role is not in it → clear
      expect(sel.value).toBe("");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: pre-filled host and role are EDITABLE (not locked)
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog chain: Test 7 — pre-filled fields are editable", () => {
  it("Test 7: user can change host + role after pre-fill", async () => {
    mockListRolesForHost.mockResolvedValue([
      { name: "box-maintainer", description: "" },
      { name: "tina", description: "" },
    ]);
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
      const hostRow = screen.getByRole("option", { name: /box-a/i });
      expect(hostRow.getAttribute("aria-selected")).toBe("true");
    });
    await waitFor(() => {
      const sel = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
      expect(sel.value).toBe("box-maintainer");
    });

    // Change host — the option button MUST NOT be disabled
    const hostBRow = screen.getByRole("option", { name: /box-b/i }) as HTMLButtonElement;
    expect(hostBRow.disabled).toBe(false);
    fireEvent.click(hostBRow);
    await waitFor(() => {
      const rowB = screen.getByRole("option", { name: /box-b/i });
      expect(rowB.getAttribute("aria-selected")).toBe("true");
    });

    // Change role — the select MUST NOT be disabled (once loading resolves)
    // After host change, roles are re-fetched for host B; wait for that to settle
    mockListRolesForHost.mockResolvedValue([
      { name: "other-role", description: "" },
    ]);
    // Second fetch triggered by host change should not disable the role dropdown after resolution
    await waitFor(() => {
      const sel = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
      expect(sel.disabled).toBe(false);
    });
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
      const sel = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
      expect(sel.value).toBe("box-maintainer");
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
    rerender(
      <NewSessionDialog
        open
        onClose={vi.fn()}
        hostTree={twoHostTree}
        onCreate={vi.fn()}
      />,
    );
    // No host picked → no role dropdown → verified stale state was cleared
    expect(screen.queryByLabelText(/^role$/i)).toBeFalsy();
    const rows = screen.getAllByRole("option");
    for (const r of rows) {
      expect(r.getAttribute("aria-selected")).not.toBe("true");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9: identity-mode OFF → initialRole is IGNORED
// ─────────────────────────────────────────────────────────────────────────────
describe("NewSessionDialog chain: Test 9 — initialRole ignored when identity-mode OFF", () => {
  it("Test 9: open with seed, then toggle identity-mode OFF → role dropdown gone; seed does not leak into session mode", async () => {
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
      />,
    );
    // Confirm role dropdown starts populated
    await waitFor(() => {
      const sel = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
      expect(sel.value).toBe("box-maintainer");
    });
    // Toggle identity-mode OFF
    const checkbox = screen.getByRole("checkbox", { name: /create new identity/i });
    fireEvent.click(checkbox);
    // Role dropdown must be gone (CREATE-only surface per D-CONTEXT §UX rules)
    await waitFor(() => {
      expect(screen.queryByLabelText(/^role$/i)).toBeFalsy();
    });
  });
});
