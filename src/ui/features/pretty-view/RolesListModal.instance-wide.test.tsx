/**
 * Phase 90 Plan 90-05 — RolesListModal tests.
 *
 * Byte-shape mirror of GlobalFilesModal.test.tsx / SkillsEditorModal.test.tsx
 * (host-picker + cancellable fetch pattern) with the role dimension threaded
 * into every fixture.
 *
 * Task 1 tests (A–H): shell + host-picker + fetch effect.
 * Task 2 tests (I–P): `.pv-row` row rendering, row click emits onSelectRole,
 * '+ New role' fires onNewRole callback, empty state.
 *
 * D-10 revised 2026-09-11: CreateRoleDialog is no longer mounted internally
 * (was Plan 90-06 D-07 stack pattern — caused a click-freeze from two Radix
 * Dialog portals contending, and dropped the CRD → NewSessionDialog chain).
 * '+ New role' now fires onNewRole; parent (PrettyConversationsPanel) owns
 * the CreateRoleDialog mount as a swap-not-stack sibling. Test O (post-create
 * re-fetch) is retired accordingly.
 *
 * Mocking strategy:
 *   - @/api/identities-api: listRolesForHost resolves asynchronously with
 *     canned RoleSummary payloads keyed by hostId; roleAvatarUrl is the real
 *     helper (pure string builder, no mock needed).
 *   - CreateRoleDialog stub retained solely so Test N can assert as a NEGATIVE
 *     (stub testid never appears — internal mount is gone).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HostFolder } from "@/types/ui-types";
import type { RoleSummary } from "@/api/identities-api";
import type { ArchivedRoleListEntry } from "@/api/roles-archive-list-api";

// ── Module mocks (hoisted — must appear before imports of the mocked modules) ──

// Held in module scope so the mock factory can read updated values across tests
// without vitest hoisting complaining about closure over live bindings.
const listRolesForHost = vi.fn<(hostId: number) => Promise<RoleSummary[]>>();

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    // Delegate to the module-scope spy so per-test .mockResolvedValueOnce works.
    listRolesForHost: (hostId: number) => listRolesForHost(hostId),
    // Real helper (deterministic string build); keep original.
  };
});

// CreateRoleDialog mock retained (data-testid still checked by Test N as a
// negative — the stub must never render because the mount is no longer
// internal). D-10 revised 2026-09-11: swap-not-stack, parent owns the mount.
vi.mock("@/sidebar/CreateRoleDialog", () => ({
  CreateRoleDialog: ({ open }: { open: boolean }) => {
    if (!open) return null;
    return <div data-testid="create-role-dialog-stub">stub</div>;
  },
}));

// Phase 133 Plan 133-05 (D-01/D-02/D-03/D-04) — mock the archiveRole API
// wrapper so tests can assert call args without hitting the network.
const archiveRoleMock =
  vi.fn<(hostId: number, roleName: string) => Promise<{ ok: true }>>();
vi.mock("@/api/role-archive-api", () => ({
  archiveRole: (hostId: number, roleName: string) =>
    archiveRoleMock(hostId, roleName),
}));

// Phase 143 Plan 143-10 — mock listArchivedRoles and unarchiveRole for
// the new archived-roles section tests.
const listArchivedRolesMock =
  vi.fn<(hostId: number) => Promise<ArchivedRoleListEntry[]>>();
const unarchiveRoleMock =
  vi.fn<(hostId: number, roleName: string) => Promise<{ ok: true }>>();

vi.mock("@/api/roles-archive-list-api", () => ({
  listArchivedRoles: (hostId: number) => listArchivedRolesMock(hostId),
}));

vi.mock("@/api/role-unarchive-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    unarchiveRole: (hostId: number, roleName: string) =>
      unarchiveRoleMock(hostId, roleName),
  };
});

// Phase 133 Plan 133-05 (D-04) — mock useIdentities so tests can seed the
// cascade-preview enumeration per-scenario. `identities` is a mutable module-
// scoped array; tests mutate `useIdentitiesReturn.identities` in place before
// rendering so the mock factory always yields the current value on call.
const useIdentitiesReturn: {
  identities: Array<{
    identityKey: string;
    displayName: string;
    role: string | null;
    hostId?: number;
    task: string | null;
  }>;
  byKey: Map<string, unknown>;
  byHostKey: Map<string, unknown>;
  loaded: boolean;
  refresh: () => Promise<void>;
} = {
  identities: [],
  byKey: new Map(),
  byHostKey: new Map(),
  loaded: true,
  refresh: vi.fn(async () => {}),
};
vi.mock("@/state/identities-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    useIdentities: () => useIdentitiesReturn,
  };
});

// ── Late imports (after mocks are registered) ────────────────────────────────
vi.mock("@/api/instance-wide-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listInstanceWide: vi.fn(),
    previewPromote: vi.fn().mockResolvedValue({
      files: 3,
      bytes: 4096,
      tooLarge: false,
      clashes: [],
      unreachable: [],
      sourceHostName: "thenasty",
    }),
    promote: vi.fn().mockResolvedValue(undefined),
    removeInstanceWide: vi.fn().mockResolvedValue({ hostCount: 4 }),
  };
});

import { RolesListModal } from "./RolesListModal";
import * as iwApi from "@/api/instance-wide-api";
import { UnarchiveError } from "@/api/identity-unarchive-api";

// ── Shared fixtures ──────────────────────────────────────────────────────────

function makeHost(id: string, name: string): HostFolder["children"][number] {
  return {
    id,
    name,
    enableRdp: false,
    enableSsh: true,
    enableTerminal: true,
    enableTunnel: false,
    enableFileManager: false,
    enableDocker: false,
    enableVnc: false,
    enableTelnet: false,
    username: "ubuntu",
    ip: `10.0.0.${id}`,
    port: 22,
    folder: "",
    online: true,
    cpu: null,
    ram: null,
    lastAccess: "",
    authType: "key",
    serverTunnels: [],
    quickActions: [],
    sshPort: 22,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
  } as HostFolder["children"][number];
}

const SINGLE_HOST_TREE: HostFolder = {
  name: "root",
  children: [makeHost("2", "thenasty")],
};

const MULTI_HOST_TREE: HostFolder = {
  name: "root",
  children: [
    makeHost("1", "alpha"),
    makeHost("2", "bravo"),
    makeHost("3", "charlie"),
  ],
};

const CANNED_ROLES: RoleSummary[] = [
  {
    name: "box-maintainer",
    description: "keeps the box healthy",
    title: "Box maintainer",
    displayName: "Box Maintainer",
    colorHue: 320,
    voice: "aoede",
    avatar: "box-maintainer.webp",
  },
  {
    name: "ally-role",
    description: "friendly helper",
    title: "Ally",
    displayName: "Ally",
    colorHue: 200,
    avatar: "ally.webp",
  },
  {
    name: "unadorned",
    description: "no cosmetics on this role",
    // no displayName, no colorHue, no avatar — fallback path
  },
];

// ── Test suite ────────────────────────────────────────────────────────────────

const IW_ROLES: RoleSummary[] = [
  { ...CANNED_ROLES[0] },
  { name: "support-bot", description: "helps", displayName: "Support Bot", instanceWide: true },
];
const SUPPORT_ITEM = {
  kind: "role" as const,
  name: "support-bot",
  updatedAt: 1,
  behind: 0,
  conflicts: 1,
  hostCount: 4,
  hosts: [{ machineId: "2", hostName: "thenasty", state: "conflict" as const, conflicts: ["support-bot.md.conflict-x"] }],
};

function renderSingle(): void {
  render(
    <RolesListModal
      open={true}
      onOpenChange={vi.fn()}
      hostTree={SINGLE_HOST_TREE}
      defaultHostId={null}
      onSelectRole={vi.fn()}
      onNewRole={vi.fn()}
    />,
  );
}

async function openRowMenu(roleName: string): Promise<void> {
  await userEvent.setup().click(await screen.findByTestId(`roles-list-row-kebab-${roleName}`));
  await screen.findByRole("menu");
}

describe("RolesListModal — instance-wide section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRolesForHost.mockResolvedValue(IW_ROLES);
    listArchivedRolesMock.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists instance-wide roles first under their own heading, with marker and status", async () => {
    vi.mocked(iwApi.listInstanceWide).mockResolvedValue({ isAdmin: true, items: [SUPPORT_ITEM] });
    renderSingle();
    const headings = await screen.findAllByTestId("roles-list-section-heading");
    expect(headings.map((h) => h.textContent)).toEqual(["Instance-wide — every host", "thenasty"]);
    expect(screen.getAllByTestId("instance-wide-chip")).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByTestId("instance-wide-sync-warning").textContent).toBe("1 conflict"),
    );
  });

  it("admin: local role offers Make instance-wide and promotes after confirm", async () => {
    vi.mocked(iwApi.listInstanceWide).mockResolvedValue({ isAdmin: true, items: [SUPPORT_ITEM] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSingle();
    await openRowMenu("box-maintainer");
    await userEvent.setup().click(screen.getByTestId("roles-list-promote-box-maintainer"));
    await waitFor(() => expect(iwApi.promote).toHaveBeenCalledWith("role", "box-maintainer", 2));
  });

  it("admin: instance-wide role offers Remove from every host (no Archive)", async () => {
    vi.mocked(iwApi.listInstanceWide).mockResolvedValue({ isAdmin: true, items: [SUPPORT_ITEM] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSingle();
    await waitFor(() => expect(iwApi.listInstanceWide).toHaveBeenCalled());
    await openRowMenu("support-bot");
    expect(screen.queryByText("Archive")).toBeNull();
    await userEvent.setup().click(screen.getByTestId("roles-list-remove-instance-support-bot"));
    await waitFor(() => expect(iwApi.removeInstanceWide).toHaveBeenCalledWith("role", "support-bot"));
    expect(confirmSpy.mock.calls[0][0]).toMatch(/4 hosts/);
  });

  it("non-admin: no promote, and instance-wide roles are marked read-only", async () => {
    vi.mocked(iwApi.listInstanceWide).mockResolvedValue({ isAdmin: false, items: [SUPPORT_ITEM] });
    renderSingle();
    await waitFor(() => expect(iwApi.listInstanceWide).toHaveBeenCalled());
    await openRowMenu("box-maintainer");
    expect(screen.queryByTestId("roles-list-promote-box-maintainer")).toBeNull();
    await userEvent.keyboard("{Escape}");
    await openRowMenu("support-bot");
    expect(screen.getByText(/only an admin can change it/i)).toBeTruthy();
  });
});
