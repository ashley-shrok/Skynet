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

// Instance-wide list: none (keeps these tests off the network).
vi.mock("@/api/instance-wide-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig, listInstanceWide: vi.fn().mockResolvedValue({ isAdmin: false, items: [] }) };
});

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
import { RolesListModal } from "./RolesListModal";
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
describe("RolesListModal — Phase 90 Plan 90-05", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: listRolesForHost resolves with the canned array after a
    // small delay so tests can observe the loading branch.
    listRolesForHost.mockImplementation(
      async (_hostId) => {
        await new Promise((r) => setTimeout(r, 30));
        return CANNED_ROLES;
      },
    );
    // Default: listArchivedRoles resolves empty (tests override as needed).
    listArchivedRolesMock.mockResolvedValue([]);
    // Default: unarchiveRole resolves ok.
    unarchiveRoleMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Task 1 — shell, host-picker, fetch ────────────────────────────────────

  it("A: portals to document.body — DialogContent appears without a container prop", async () => {
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={MULTI_HOST_TREE}
        defaultHostId={null}
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
      />,
    );
    // The modal Title is rendered via DialogTitle; the "Roles" header text
    // should be findable in document.body.
    await waitFor(() => expect(screen.queryByText("Roles")).toBeTruthy(), {
      timeout: 2000,
    });
    // Verify it landed in document.body (portal target) — walk up from the
    // Dialog element. The DialogContent has role="dialog" once rendered.
    const dialog = await screen.findByRole("dialog");
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("B: host-picker multi-host — <select> renders one option per host + placeholder", async () => {
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={MULTI_HOST_TREE}
        defaultHostId={null}
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
      />,
    );
    const select = await screen.findByLabelText(/host/i);
    const options = within(select as HTMLElement).getAllByRole("option");
    // 3 hosts + one "Pick a host…" placeholder
    expect(options.length).toBe(4);
    expect(options[0].textContent).toMatch(/pick a host/i);
    const hostNames = options.slice(1).map((o) => o.textContent);
    expect(hostNames).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("C: host-picker single-host — picker is hidden (auto-selected in place)", async () => {
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
    // With one host, the picker element should not render (matches
    // CreateRoleDialog L762 pattern: `flatHosts.length !== 1 && ...`).
    await waitFor(() => expect(screen.queryByText("Roles")).toBeTruthy());
    expect(screen.queryByLabelText(/host/i)).toBeNull();
    // And the fetch fires for the sole host (id=2)
    await waitFor(() => expect(listRolesForHost).toHaveBeenCalledWith(2), {
      timeout: 2000,
    });
  });

  it("D: fetch on host change — listRolesForHost fires with picked hostId", async () => {
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={MULTI_HOST_TREE}
        defaultHostId={null}
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
      />,
    );
    const select = (await screen.findByLabelText(/host/i)) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "3" } });
    await waitFor(() => expect(listRolesForHost).toHaveBeenCalledWith(3), {
      timeout: 2000,
    });
    // 3 canned roles resolve — 3 rows render
    await waitFor(
      () => expect(screen.queryAllByRole("button", { name: /Box Maintainer|Ally|Unadorned/ }).length).toBeGreaterThanOrEqual(3),
      { timeout: 2000 },
    );
  });

  it("E: loading state — renders a Loading… branch before fetch resolves", async () => {
    // Give the fetch a slow resolution so the loading state is observable.
    listRolesForHost.mockImplementation(
      () =>
        new Promise((resolve) => setTimeout(() => resolve(CANNED_ROLES), 200)),
    );
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeTruthy(), {
      timeout: 500,
    });
  });

  it("F: error state — rejected fetch surfaces the error message", async () => {
    listRolesForHost.mockRejectedValueOnce(new Error("kaboom"));
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.queryByText(/kaboom/i)).toBeTruthy(), {
      timeout: 2000,
    });
  });

  it("G: defaultHostId honored — auto-selects the given host on open", async () => {
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={MULTI_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
      />,
    );
    await waitFor(() => expect(listRolesForHost).toHaveBeenCalledWith(2), {
      timeout: 2000,
    });
  });

  it("H: reset on close — closing + reopening clears state (no stale roles)", async () => {
    const { rerender } = render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
      />,
    );
    await waitFor(() => expect(listRolesForHost).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    // Close
    rerender(
      <RolesListModal
        open={false}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
      />,
    );
    // Reopen — should re-fetch (new fetch call means state was reset)
    rerender(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
      />,
    );
    await waitFor(() => expect(listRolesForHost).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    });
  });

  // ─── Task 2 — rows, click routing, + New role, empty state ─────────────────

  it("I: full-cosmetics row — inline style contains the hue-tinted tokens keyed on colorHue", async () => {
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
      />,
    );
    // 3 roles alphabetical by displayName → Ally, Box Maintainer, Unadorned
    // Phase 143 Plan 143-07: rows are now <div role="button"> (not <button>)
    // so the kebab <button> can live as a sibling without violating HTML
    // rules against nested <button> elements.
    const row = await screen.findByRole("button", { name: /Box Maintainer/ });
    // Inline .pv-row treatment keyed on the box-maintainer hue (320).
    // Note: jsdom normalizes `hsla()` in background/border to `rgba()` but
    // retains raw `hsla()` in `box-shadow`. Assert on the box-shadow slot
    // (hue-glow ring stop) — that carries the hue verbatim.
    const style = row.getAttribute("style") ?? "";
    expect(style).toMatch(/hsla\(320,\s*70%,\s*55%,\s*0\.20?\)/i);
    expect(style).toMatch(/hsla\(320,\s*70%,\s*52%,\s*0\.18?\)/i);
    // Also assert the row's border-radius token (14px = .pv-row's
    // --radius-pv-bubble) survives the round-trip.
    expect(style).toMatch(/border-radius:\s*14px/i);
    // The 40px round avatar is present (an <img> pointing at the role avatar URL).
    // Note: `<img alt="">` has no implicit role (WAI-ARIA "presentation" default
    // for empty alt), so we query the element directly via tagName.
    const avatar = row.querySelector("img");
    expect(avatar).not.toBeNull();
    expect(avatar?.getAttribute("src")).toContain(
      "/roles/box-maintainer/avatar?hostId=2",
    );
  });

  it("J: no-cosmetics fallback — row uses hue 190 fallback + row still interactive", async () => {
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
      />,
    );
    // The `unadorned` role has no colorHue → hue 190 fallback per D-05.
    // Phase 143 Plan 143-07: row is now <div role="button"> (not <button>),
    // so .disabled does not apply. Assert via aria-disabled absence instead.
    const row = await screen.findByRole("button", { name: /Unadorned/ });
    const style = row.getAttribute("style") ?? "";
    // Fallback hue 190 leaks through the box-shadow hsla slot (jsdom
    // preserves box-shadow hsla verbatim while normalizing background hsla
    // to rgba — see Test I for the same substring assertion strategy).
    expect(style).toMatch(/hsla\(190,\s*70%,\s*55%,\s*0\.20?\)/i);
    // Row must be interactive — no aria-disabled attribute set.
    expect(row.getAttribute("aria-disabled")).toBeNull();
  });

  it("K: displayName fallback — kebab-case slug becomes title-cased text when displayName absent", async () => {
    // Custom fixture: single role with no displayName
    listRolesForHost.mockResolvedValueOnce([
      { name: "box-maintainer", description: "" } as RoleSummary,
    ]);
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
      />,
    );
    await waitFor(
      () => expect(screen.queryByText("Box Maintainer")).toBeTruthy(),
      { timeout: 2000 },
    );
  });

  it("L: alphabetical sort by displayName — Ally before Zeb", async () => {
    listRolesForHost.mockResolvedValueOnce([
      { name: "zebra", description: "", displayName: "Ally", colorHue: 100 },
      { name: "aardvark", description: "", displayName: "Zeb", colorHue: 100 },
    ]);
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.queryByText("Ally")).toBeTruthy());
    // The two role rows should appear in Ally, Zeb order — filter by the
    // aria-label pinned on each row (`Ally` / `Zeb`), then walk their DOM
    // order to confirm sorting.
    const rows = screen
      .getAllByRole("button")
      .filter((b) => {
        const label = b.getAttribute("aria-label");
        return label === "Ally" || label === "Zeb";
      });
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(["Ally", "Zeb"]);
  });

  it("M: row click — emits onSelectRole with full RoleSummary + hostId", async () => {
    const onSelectRole = vi.fn();
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={onSelectRole}
        onNewRole={vi.fn()}
      />,
    );
    const row = await screen.findByRole("button", { name: /Box Maintainer/ });
    fireEvent.click(row);
    expect(onSelectRole).toHaveBeenCalledTimes(1);
    const arg = onSelectRole.mock.calls[0][0];
    expect(arg.roleName).toBe("box-maintainer");
    expect(arg.hostId).toBe(2);
    expect(arg.roleCosmetics.displayName).toBe("Box Maintainer");
    expect(arg.roleCosmetics.colorHue).toBe(320);
  });

  it("N: '+ New role' button — fires onNewRole callback (D-10 revised 2026-09-11: swap-not-stack, parent opens CreateRoleDialog)", async () => {
    const onNewRole = vi.fn();
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
        onNewRole={onNewRole}
      />,
    );
    const btn = await screen.findByRole("button", { name: /\+ New role/i });
    fireEvent.click(btn);
    expect(onNewRole).toHaveBeenCalledTimes(1);
    // Internal CreateRoleDialog mount is GONE; the stub can never render.
    expect(screen.queryByTestId("create-role-dialog-stub")).toBeNull();
  });

  it("P: empty state — 'No roles yet.' when list is empty, header + New role still available", async () => {
    listRolesForHost.mockResolvedValueOnce([]);
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
        onNewRole={vi.fn()}
      />,
    );
    await waitFor(
      () =>
        expect(screen.queryByText(/^no roles yet\.?$/i)).toBeTruthy(),
      { timeout: 2000 },
    );
    // + New role button remains available — the header button always renders
    // and the empty-state body renders its own prominent secondary. Both are
    // acceptable per D-05 "surface the + New role affordance prominently".
    const newRoleButtons = screen.getAllByRole("button", {
      name: /\+ New role/i,
    });
    expect(newRoleButtons.length).toBeGreaterThanOrEqual(1);
  });

  // Phase 143 (un-archiving shape 2, D-27): the "Phase 133 D-01/D-02/D-03/D-04 — archive role context menu"
  // describe block that pinned the right-click Archive invocation on this surface has been REMOVED.
  // The right-click gesture is retired here in favor of the always-visible three-dots kebab menu
  // (D-12/D-13/D-14/D-15). New coverage of the kebab-menu Archive path lives in the "Phase 143 —
  // kebab-menu Archive on live-role rows" describe block below.
  // Mirrors shape 1's precedent: agent-supervisor-archive-scan.sh removed its D-12 "no _synapse/admin
  // refs" and D-16 "no unarchive keywords" tests with breadcrumb comments naming the shape file.
  // Ref: .planning/campaigns/un-archiving/shape-unarchive-frontend-backend.md

  // ─── Phase 143 — kebab-menu Archive on live-role rows ──────────────────────
  describe("Phase 143 — kebab-menu Archive on live-role rows", () => {
    const SOLO_ROLE_FIXTURE: RoleSummary[] = [
      {
        name: "role-a",
        description: "the test role",
        displayName: "Role A",
        colorHue: 100,
      },
    ];

    const TWO_ROLE_FIXTURE: RoleSummary[] = [
      {
        name: "role-a",
        description: "the test role",
        displayName: "Role A",
        colorHue: 100,
      },
      {
        name: "role-b",
        description: "the sibling role",
        displayName: "Role B",
        colorHue: 200,
      },
    ];

    beforeEach(() => {
      archiveRoleMock.mockReset();
      archiveRoleMock.mockResolvedValue({ ok: true });
      useIdentitiesReturn.identities = [];
      vi.spyOn(window, "confirm").mockReturnValue(true);
      vi.spyOn(window, "alert").mockImplementation(() => {});
      listRolesForHost.mockImplementation(async () => SOLO_ROLE_FIXTURE);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("1: renders always-visible kebab trigger on each live-role row", async () => {
      listRolesForHost.mockImplementation(async () => TWO_ROLE_FIXTURE);
      render(
        <RolesListModal
          open={true}
          onOpenChange={vi.fn()}
          hostTree={SINGLE_HOST_TREE}
          defaultHostId={2}
          onSelectRole={vi.fn()}
          onNewRole={vi.fn()}
        />,
      );
      // Wait for rows to load
      await screen.findByRole("button", { name: /Role A/ });
      // Both rows should have a kebab trigger (testId pattern roles-list-row-kebab-<name>)
      const kebabs = screen.getAllByTestId(/^roles-list-row-kebab-/);
      expect(kebabs.length).toBe(2);
    });

    it("2: clicking kebab opens menu with a single Archive item", async () => {
      const user = userEvent.setup();
      render(
        <RolesListModal
          open={true}
          onOpenChange={vi.fn()}
          hostTree={SINGLE_HOST_TREE}
          defaultHostId={2}
          onSelectRole={vi.fn()}
          onNewRole={vi.fn()}
        />,
      );
      await screen.findByRole("button", { name: /Role A/ });
      const kebab = screen.getByTestId("roles-list-row-kebab-role-a");
      await user.click(kebab);
      const archiveItem = await screen.findByRole("menuitem", { name: /^Archive$/ });
      expect(archiveItem).toBeTruthy();
    });

    it("3: clicking Archive item opens the double-confirm dialog (window.confirm called twice)", async () => {
      const user = userEvent.setup();
      render(
        <RolesListModal
          open={true}
          onOpenChange={vi.fn()}
          hostTree={SINGLE_HOST_TREE}
          defaultHostId={2}
          onSelectRole={vi.fn()}
          onNewRole={vi.fn()}
        />,
      );
      await screen.findByRole("button", { name: /Role A/ });
      const kebab = screen.getByTestId("roles-list-row-kebab-role-a");
      await user.click(kebab);
      const archiveItem = await screen.findByRole("menuitem", { name: /^Archive$/ });
      await user.click(archiveItem);
      expect(window.confirm).toHaveBeenCalledTimes(2);
    });

    it("4: cancel on first confirm short-circuits — no API call", async () => {
      vi.spyOn(window, "confirm").mockReturnValueOnce(false);
      const user = userEvent.setup();
      render(
        <RolesListModal
          open={true}
          onOpenChange={vi.fn()}
          hostTree={SINGLE_HOST_TREE}
          defaultHostId={2}
          onSelectRole={vi.fn()}
          onNewRole={vi.fn()}
        />,
      );
      await screen.findByRole("button", { name: /Role A/ });
      const kebab = screen.getByTestId("roles-list-row-kebab-role-a");
      await user.click(kebab);
      const archiveItem = await screen.findByRole("menuitem", { name: /^Archive$/ });
      await user.click(archiveItem);
      expect(window.confirm).toHaveBeenCalledTimes(1);
      expect(archiveRoleMock).not.toHaveBeenCalled();
    });

    it("5: happy path — archiveRole is called with (hostId, roleName)", async () => {
      const user = userEvent.setup();
      render(
        <RolesListModal
          open={true}
          onOpenChange={vi.fn()}
          hostTree={SINGLE_HOST_TREE}
          defaultHostId={2}
          onSelectRole={vi.fn()}
          onNewRole={vi.fn()}
        />,
      );
      await screen.findByRole("button", { name: /Role A/ });
      const kebab = screen.getByTestId("roles-list-row-kebab-role-a");
      await user.click(kebab);
      const archiveItem = await screen.findByRole("menuitem", { name: /^Archive$/ });
      await user.click(archiveItem);
      expect(archiveRoleMock).toHaveBeenCalledTimes(1);
      expect(archiveRoleMock).toHaveBeenCalledWith(2, "role-a");
    });

    it("6: optimistic-remove — row disappears immediately on Archive click (archive path preserves pre-existing optimistic behavior)", async () => {
      listRolesForHost.mockImplementation(async () => TWO_ROLE_FIXTURE);
      // Never-resolving promise to confirm the removal is optimistic (not post-resolve).
      archiveRoleMock.mockReturnValueOnce(new Promise(() => {}));
      const user = userEvent.setup();
      render(
        <RolesListModal
          open={true}
          onOpenChange={vi.fn()}
          hostTree={SINGLE_HOST_TREE}
          defaultHostId={2}
          onSelectRole={vi.fn()}
          onNewRole={vi.fn()}
        />,
      );
      await screen.findByRole("button", { name: /Role A/ });
      await screen.findByRole("button", { name: /Role B/ });
      const kebab = screen.getByTestId("roles-list-row-kebab-role-a");
      await user.click(kebab);
      const archiveItem = await screen.findByRole("menuitem", { name: /^Archive$/ });
      await user.click(archiveItem);
      // Role A optimistically gone; Role B still present.
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: /Role A/ })).toBeNull(),
      );
      expect(screen.getByRole("button", { name: /Role B/ })).toBeDefined();
    });

    it("7: RolesListModal stays open after Archive click (no onOpenChange(false))", async () => {
      const onOpenChange = vi.fn();
      const user = userEvent.setup();
      render(
        <RolesListModal
          open={true}
          onOpenChange={onOpenChange}
          hostTree={SINGLE_HOST_TREE}
          defaultHostId={2}
          onSelectRole={vi.fn()}
          onNewRole={vi.fn()}
        />,
      );
      await screen.findByRole("button", { name: /Role A/ });
      const kebab = screen.getByTestId("roles-list-row-kebab-role-a");
      await user.click(kebab);
      const archiveItem = await screen.findByRole("menuitem", { name: /^Archive$/ });
      await user.click(archiveItem);
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it("8: kebab click stops propagation — clicking the kebab does NOT open RoleModal (onSelectRole not called)", async () => {
      const onSelectRole = vi.fn();
      const user = userEvent.setup();
      render(
        <RolesListModal
          open={true}
          onOpenChange={vi.fn()}
          hostTree={SINGLE_HOST_TREE}
          defaultHostId={2}
          onSelectRole={onSelectRole}
          onNewRole={vi.fn()}
        />,
      );
      await screen.findByRole("button", { name: /Role A/ });
      const kebab = screen.getByTestId("roles-list-row-kebab-role-a");
      // Open the kebab menu — click should stop propagation to the row's onClick
      await user.click(kebab);
      // Menu appeared — the Archive item is visible
      await screen.findByRole("menuitem", { name: /^Archive$/ });
      // But the row's onSelectRole was NOT invoked (D-14)
      expect(onSelectRole).not.toHaveBeenCalled();
    });
  });

  // ─── Phase 143 — archived-roles collapsed section (D-10, D-18, D-19) ───────
  describe("Phase 143 — archived-roles collapsed section (D-10, D-18, D-19)", () => {
    const ARCHIVED_ROLE_FIXTURE: ArchivedRoleListEntry[] = [
      { name: "old-maintainer" },
      { name: "retired-researcher" },
    ];

    beforeEach(() => {
      listArchivedRolesMock.mockReset();
      unarchiveRoleMock.mockReset();
      listArchivedRolesMock.mockResolvedValue(ARCHIVED_ROLE_FIXTURE);
      unarchiveRoleMock.mockResolvedValue({ ok: true });
      vi.spyOn(window, "alert").mockImplementation(() => {});
      listRolesForHost.mockImplementation(async () => [
        {
          name: "box-maintainer",
          description: "keeps the box healthy",
          displayName: "Box Maintainer",
          colorHue: 320,
          avatar: "box-maintainer.webp",
        },
      ]);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function renderModal(props?: { onOpenChange?: (open: boolean) => void; defaultHostId?: number }): void {
      render(
        <RolesListModal
          open={true}
          onOpenChange={props?.onOpenChange ?? vi.fn()}
          hostTree={SINGLE_HOST_TREE}
          defaultHostId={props?.defaultHostId ?? 2}
          onSelectRole={vi.fn()}
          onNewRole={vi.fn()}
        />,
      );
    }

    it("1: archived-roles section header renders even when zero archived roles exist (D-18)", async () => {
      // Section header should be present before expand (always-visible per D-18).
      renderModal();
      // Wait for the modal to finish rendering roles
      await screen.findByRole("button", { name: /Box Maintainer/ });
      const header = screen.getByTestId("roles-list-archived-section-header");
      expect(header).toBeTruthy();
    });

    it("2: header is not clicked → no fetch fires (lazy-load lock)", async () => {
      renderModal();
      await screen.findByRole("button", { name: /Box Maintainer/ });
      // Section header present but listArchivedRoles should NOT have been called
      // (lazy — only fires on expand).
      expect(listArchivedRolesMock).not.toHaveBeenCalled();
    });

    it("3: clicking header expands section AND fires listArchivedRoles(selectedHostId), empty state shows 'No archived roles.'", async () => {
      listArchivedRolesMock.mockResolvedValue([]);
      renderModal();
      await screen.findByRole("button", { name: /Box Maintainer/ });
      const header = screen.getByTestId("roles-list-archived-section-header");
      fireEvent.click(header);
      await waitFor(() =>
        expect(listArchivedRolesMock).toHaveBeenCalledWith(2),
        { timeout: 2000 },
      );
      await waitFor(() =>
        expect(screen.queryByText("No archived roles.")).toBeTruthy(),
        { timeout: 2000 },
      );
    });

    it("4: with archived entries, renders one row per entry with kebab", async () => {
      renderModal();
      await screen.findByRole("button", { name: /Box Maintainer/ });
      const header = screen.getByTestId("roles-list-archived-section-header");
      fireEvent.click(header);
      await waitFor(() =>
        expect(screen.getAllByTestId(/^roles-list-archived-row-kebab-/).length).toBe(2),
        { timeout: 2000 },
      );
    });

    it("5: row disappears ONLY after endpoint returns 200 (endpoint-first sequence — locks CONTEXT.md Risk Summary invariant)", async () => {
      // Set up a manually-controlled never-resolving promise for unarchiveRole.
      // This lets us assert the row is STILL PRESENT mid-flight (before the
      // endpoint returns), and only GONE after we manually resolve it with 200.
      let resolveUnarchive!: () => void;
      unarchiveRoleMock.mockImplementation(
        () => new Promise<{ ok: true }>((res) => {
          resolveUnarchive = () => res({ ok: true });
        }),
      );
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      const user = userEvent.setup();

      renderModal();
      await screen.findByRole("button", { name: /Box Maintainer/ });
      // Expand the archived section
      const header = screen.getByTestId("roles-list-archived-section-header");
      fireEvent.click(header);
      // Wait for archived rows to appear
      await waitFor(() =>
        expect(screen.getAllByTestId(/^roles-list-archived-row-kebab-/).length).toBe(2),
        { timeout: 2000 },
      );

      // Open the kebab on the first archived row and click Un-archive
      const kebab = screen.getByTestId("roles-list-archived-row-kebab-old-maintainer");
      await user.click(kebab);
      const unarchiveItem = await screen.findByRole("menuitem", { name: /^Un-archive$/ });
      await user.click(unarchiveItem);

      // MID-FLIGHT ASSERTION: the endpoint has not resolved yet.
      // The row must still be present in the DOM and window.alert must NOT have been called.
      expect(screen.queryByText("Old Maintainer")).toBeTruthy();
      expect(alertSpy).not.toHaveBeenCalled();

      // Now resolve the never-resolving mock (endpoint returns 200).
      resolveUnarchive();

      // After endpoint returns 200, the row should be GONE and the success alert fired.
      await waitFor(() =>
        expect(screen.queryByText("Old Maintainer")).toBeNull(),
        { timeout: 2000 },
      );
      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Un-archiving role/),
      );
    });

    it("6: Un-archive failure with name_collision → row stays + distinct alert copy", async () => {
      unarchiveRoleMock.mockRejectedValueOnce(
        new UnarchiveError("collision", "name_collision"),
      );
      const user = userEvent.setup();

      renderModal();
      await screen.findByRole("button", { name: /Box Maintainer/ });
      const header = screen.getByTestId("roles-list-archived-section-header");
      fireEvent.click(header);
      await waitFor(() =>
        expect(screen.getAllByTestId(/^roles-list-archived-row-kebab-/).length).toBe(2),
        { timeout: 2000 },
      );

      const kebab = screen.getByTestId("roles-list-archived-row-kebab-old-maintainer");
      await user.click(kebab);
      const unarchiveItem = await screen.findByRole("menuitem", { name: /^Un-archive$/ });
      await user.click(unarchiveItem);

      // Row must STAY after the promise settles (failure path — no removal)
      await waitFor(() =>
        expect(window.alert).toHaveBeenCalled(),
        { timeout: 2000 },
      );
      expect(screen.queryByText("Old Maintainer")).toBeTruthy();
      const alertMsg = (window.alert as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(alertMsg).toMatch(/live role.*already exists/i);
    });

    it("7: Un-archive generic failure → row stays + generic alert copy", async () => {
      unarchiveRoleMock.mockRejectedValueOnce(new Error("network"));
      const user = userEvent.setup();

      renderModal();
      await screen.findByRole("button", { name: /Box Maintainer/ });
      const header = screen.getByTestId("roles-list-archived-section-header");
      fireEvent.click(header);
      await waitFor(() =>
        expect(screen.getAllByTestId(/^roles-list-archived-row-kebab-/).length).toBe(2),
        { timeout: 2000 },
      );

      const kebab = screen.getByTestId("roles-list-archived-row-kebab-old-maintainer");
      await user.click(kebab);
      const unarchiveItem = await screen.findByRole("menuitem", { name: /^Un-archive$/ });
      await user.click(unarchiveItem);

      await waitFor(() =>
        expect(window.alert).toHaveBeenCalled(),
        { timeout: 2000 },
      );
      expect(screen.queryByText("Old Maintainer")).toBeTruthy();
      const alertMsg = (window.alert as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(alertMsg).toMatch(/try again in a moment/i);
    });

    it("8: section stays expanded after un-archive (D-19)", async () => {
      const user = userEvent.setup();
      // Use a resolved mock for this test (not the never-resolving one)
      unarchiveRoleMock.mockResolvedValue({ ok: true });

      renderModal();
      await screen.findByRole("button", { name: /Box Maintainer/ });
      const header = screen.getByTestId("roles-list-archived-section-header");
      fireEvent.click(header);
      await waitFor(() =>
        expect(screen.getAllByTestId(/^roles-list-archived-row-kebab-/).length).toBe(2),
        { timeout: 2000 },
      );

      // Un-archive the first entry
      const kebab = screen.getByTestId("roles-list-archived-row-kebab-old-maintainer");
      await user.click(kebab);
      const unarchiveItem = await screen.findByRole("menuitem", { name: /^Un-archive$/ });
      await user.click(unarchiveItem);

      // After successful un-archive, section body should STAY expanded (D-19).
      // Assert by checking the second archived row is still visible.
      await waitFor(() =>
        expect(screen.queryByText("Old Maintainer")).toBeNull(),
        { timeout: 2000 },
      );
      // The section is still expanded — second row (retired-researcher) still present
      expect(screen.queryByText("Retired Researcher")).toBeTruthy();
    });

    it("9: switching selectedHostId collapses the section AND resets fetch state (D-07 host-scope)", async () => {
      const { rerender } = render(
        <RolesListModal
          open={true}
          onOpenChange={vi.fn()}
          hostTree={MULTI_HOST_TREE}
          defaultHostId={2}
          onSelectRole={vi.fn()}
          onNewRole={vi.fn()}
        />,
      );
      // Wait for initial host 2 roles to load
      await waitFor(() => expect(listRolesForHost).toHaveBeenCalledWith(2), { timeout: 2000 });
      // Expand the archived section (triggers first fetch for host 2)
      const header = screen.getByTestId("roles-list-archived-section-header");
      fireEvent.click(header);
      await waitFor(() =>
        expect(listArchivedRolesMock).toHaveBeenCalledWith(2),
        { timeout: 2000 },
      );
      const firstCallCount = listArchivedRolesMock.mock.calls.length;

      // Switch to host 3 by changing the picker
      const select = screen.getByLabelText(/host/i) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "3" } });

      // Wait for the live-roles fetch for host 3
      await waitFor(() => expect(listRolesForHost).toHaveBeenCalledWith(3), { timeout: 2000 });

      // After host switch: section header still present (always visible per D-18)
      const headerAfterSwitch = screen.getByTestId("roles-list-archived-section-header");
      expect(headerAfterSwitch).toBeTruthy();
      // aria-expanded should be false (collapsed after host switch)
      expect(headerAfterSwitch.getAttribute("aria-expanded")).toBe("false");

      // Now expand again — should fire listArchivedRoles with new hostId (3)
      fireEvent.click(headerAfterSwitch);
      await waitFor(() =>
        expect(listArchivedRolesMock.mock.calls.length).toBeGreaterThan(firstCallCount),
        { timeout: 2000 },
      );
      const lastCall = listArchivedRolesMock.mock.calls[listArchivedRolesMock.mock.calls.length - 1];
      expect(lastCall[0]).toBe(3);
    });
  });
});
