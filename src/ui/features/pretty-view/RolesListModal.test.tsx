/**
 * Phase 90 Plan 90-05 — RolesListModal tests.
 *
 * Byte-shape mirror of GlobalFilesModal.test.tsx / SkillsEditorModal.test.tsx
 * (host-picker + cancellable fetch pattern) with the role dimension threaded
 * into every fixture.
 *
 * Task 1 tests (A–H): shell + host-picker + fetch effect.
 * Task 2 tests (I–P): `.pv-row` row rendering, row click emits onSelectRole,
 * '+ New role' opens CreateRoleDialog, empty state.
 *
 * Mocking strategy:
 *   - @/api/identities-api: listRolesForHost resolves asynchronously with
 *     canned RoleSummary payloads keyed by hostId; roleAvatarUrl is the real
 *     helper (pure string builder, no mock needed).
 *   - CreateRoleDialog is stubbed out to avoid pulling in its own dependency
 *     tree (POST /roles, avatar batch generator, cosmetic pickers) — the
 *     tests only care that the dialog gets mounted with `open={true}` and
 *     that firing its `onCreated` re-invokes listRolesForHost.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import type { HostFolder } from "@/types/ui-types";
import type { RoleSummary } from "@/api/identities-api";

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

// Stub CreateRoleDialog — the real component pulls in a batch avatar generator,
// pickers, POST /roles multipart, etc. For this modal's tests we only need to
// observe (a) the stub renders when `open={true}` and (b) invoking its
// `onCreated` re-triggers RolesListModal's fetch. The stub renders a marker
// <div> + an exposed button that fires `onCreated`.
vi.mock("@/sidebar/CreateRoleDialog", () => ({
  CreateRoleDialog: ({
    open,
    onCreated,
    onClose,
  }: {
    open: boolean;
    onCreated?: (r: { name: string; description: string; host: { id: string } }) => void;
    onClose: () => void;
  }) => {
    if (!open) return null;
    return (
      <div data-testid="create-role-dialog-stub">
        <span>CreateRoleDialog stub open</span>
        <button
          type="button"
          data-testid="stub-fire-created"
          onClick={() => {
            onCreated?.({
              name: "new-role",
              description: "d",
              host: { id: "3" } as never,
            });
            onClose();
          }}
        >
          Fire onCreated
        </button>
        <button type="button" data-testid="stub-close" onClick={onClose}>
          Close stub
        </button>
      </div>
    );
  },
}));

// ── Late imports (after mocks are registered) ────────────────────────────────
import { RolesListModal } from "./RolesListModal";

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
      />,
    );
    await waitFor(() => expect(listRolesForHost).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    });
  });

  // ─── Task 2 — rows, click routing, + New role, empty state ─────────────────

  it("I: full-cosmetics row — inline style contains the hue-tinted gradient stops keyed on colorHue", async () => {
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
      />,
    );
    // 3 roles alphabetical by displayName → Ally, Box Maintainer, Unadorned
    const row = await screen.findByRole("button", { name: /Box Maintainer/ });
    // Inline gradient contains the box-maintainer hue (320) with the .pv-row
    // stop tokens.
    const style = row.getAttribute("style") ?? "";
    expect(style).toMatch(/hsla\(320,\s*50%,\s*38%,\s*0\.55\)/i);
    expect(style).toMatch(/hsla\(320,\s*45%,\s*24%,\s*0\.6/i);
    // The 40px round avatar is present (an <img> pointing at the role avatar URL).
    const avatar = within(row).getByRole("img");
    expect(avatar.getAttribute("src")).toContain(
      "/roles/box-maintainer/avatar?hostId=2",
    );
  });

  it("J: no-cosmetics fallback — row uses hue 190 fallback + row still clickable", async () => {
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
      />,
    );
    // The `unadorned` role has no colorHue → hue 190 fallback per D-05.
    const row = await screen.findByRole("button", { name: /Unadorned/ });
    const style = row.getAttribute("style") ?? "";
    expect(style).toMatch(/hsla\(190,\s*50%,\s*38%,\s*0\.55\)/i);
    // Row must be a live button — no aria-disabled / disabled attribute
    expect((row as HTMLButtonElement).disabled).toBe(false);
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
      />,
    );
    await waitFor(() => expect(screen.queryByText("Ally")).toBeTruthy());
    // The two role rows should appear in Ally, Zeb order — check via
    // DOM position of the button elements bearing those names.
    const rows = screen
      .getAllByRole("button")
      .filter((b) => /^(Ally|Zeb)$/.test(b.textContent?.trim() ?? ""));
    expect(rows.map((r) => r.textContent?.trim())).toEqual(["Ally", "Zeb"]);
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

  it("N: '+ New role' button — opens CreateRoleDialog on top (stack, list stays)", async () => {
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
      />,
    );
    const btn = await screen.findByRole("button", { name: /\+ New role/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.queryByTestId("create-role-dialog-stub")).toBeTruthy(),
    );
    // RolesListModal stays open — "Roles" title still present.
    expect(screen.queryByText("Roles")).toBeTruthy();
  });

  it("O: CreateRoleDialog onCreated — re-fetches the roles list", async () => {
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
      />,
    );
    // Wait for the initial fetch
    await waitFor(() => expect(listRolesForHost).toHaveBeenCalledTimes(1));
    // Open CreateRoleDialog
    const btn = await screen.findByRole("button", { name: /\+ New role/i });
    fireEvent.click(btn);
    // Fire the stub's onCreated
    const fire = await screen.findByTestId("stub-fire-created");
    fireEvent.click(fire);
    // Re-fetch should now have fired
    await waitFor(() => expect(listRolesForHost).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    });
  });

  it("P: empty state — 'This host has no roles yet.' when list is empty, header + New role still available", async () => {
    listRolesForHost.mockResolvedValueOnce([]);
    render(
      <RolesListModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={SINGLE_HOST_TREE}
        defaultHostId={2}
        onSelectRole={vi.fn()}
      />,
    );
    await waitFor(
      () =>
        expect(screen.queryByText(/this host has no roles yet/i)).toBeTruthy(),
      { timeout: 2000 },
    );
    // + New role button still present in the header
    expect(screen.queryByRole("button", { name: /\+ New role/i })).toBeTruthy();
  });
});
