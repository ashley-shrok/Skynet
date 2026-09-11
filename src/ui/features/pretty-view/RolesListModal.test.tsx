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

// CreateRoleDialog mock retained (data-testid still checked by Test N as a
// negative — the stub must never render because the mount is no longer
// internal). D-10 revised 2026-09-11: swap-not-stack, parent owns the mount.
vi.mock("@/sidebar/CreateRoleDialog", () => ({
  CreateRoleDialog: ({ open }: { open: boolean }) => {
    if (!open) return null;
    return <div data-testid="create-role-dialog-stub">stub</div>;
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

  it("J: no-cosmetics fallback — row uses hue 190 fallback + row still clickable", async () => {
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
    const row = await screen.findByRole("button", { name: /Unadorned/ });
    const style = row.getAttribute("style") ?? "";
    // Fallback hue 190 leaks through the box-shadow hsla slot (jsdom
    // preserves box-shadow hsla verbatim while normalizing background hsla
    // to rgba — see Test I for the same substring assertion strategy).
    expect(style).toMatch(/hsla\(190,\s*70%,\s*55%,\s*0\.20?\)/i);
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

  it("P: empty state — 'This host has no roles yet.' when list is empty, header + New role still available", async () => {
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
        expect(screen.queryByText(/this host has no roles yet/i)).toBeTruthy(),
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
});
