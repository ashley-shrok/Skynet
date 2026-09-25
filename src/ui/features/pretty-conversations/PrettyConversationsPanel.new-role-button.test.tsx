// ─── PrettyConversationsPanel — "Edit roles" coverage
// (Phase 90 Plan 90-06 Task 3 — rewrite of the Phase 22/23 "+ New role" suite).
//
// Phase 90 (D-07): the three-dots menu's "New role" entry was DELETED and
// replaced with "Edit roles…", which opens RolesListModal. The rewritten
// tests keep the file name for git-blame continuity but swap all assertions
// from the old "New role" surface to the new "Edit roles…" surface.
//
// quick-260914-liu: "Edit roles" was promoted out of the kebab into a
// dedicated header icon button (pv-header-edit-roles-button).
//
// shape-sidebar-header-footer-redesign: "Edit roles" was migrated BACK into
// the kebab menu as the third item (after the Phase-44-guarded pair). The
// dedicated header button was retired. Tests 21a / 21b / 21c are re-anchored
// at the kebab entry point.
//
// Kept as a sibling test file (not appended to PrettyConversationsPanel.test.tsx)
// so the surface stays isolated from the 25+ pre-existing tests in the main
// suite — matches the sibling-file pattern from Plan 22-02 Task 4.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, within, waitFor } from "@testing-library/react";
import type { Host, HostFolder } from "@/types/ui-types";

// ─── Global mocks (BEFORE component import — Vitest hoists vi.mock) ──────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
}));

vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: (name: string | null | undefined) =>
    name ? name.toLowerCase() : null,
}));

vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({
    byKey: new Map(),
    identities: [],
    loaded: true,
    refresh: async () => {},
  }),
  // Phase 92 Plan 04: panel hydrate effect imports deriveDiskPinnedIds.
  // (Phase 115 Plan 115-02: sibling deriveDiskHiddenIds retired per D-21.)
  deriveDiskPinnedIds: () => [],
  buildIdentityHostsFromFleet: () => ({}),
}));

// Phase 104 Plan 02 — trapped-work-store (inert stub — panel mounts poller)
vi.mock("@/state/trapped-work-store", () => ({
  useTrappedWork: () => undefined,
  startTrappedWorkPoller: () => () => {},
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

vi.mock("@/state/conversation-store", () => ({
  useConversations: () => ({
    activeSet: [],
    pinned: [],
    middle: [],
    rdpGroup: null,
    // Phase 117 Plan 117-08 — additive derived-selector fields.
    pinnedUnassigned: [],
    projectSections: [],
    rdp: null,
  }),
  useSelectedConversationId: () => null,
  usePinnedIds: () => new Set(),
  useActiveSet: () => new Set(),
  useFleetSessionsLoaded: () => false,
  // Phase 92 Plan 04: panel hydrate reads fleet snapshot to build identityHosts.
  getFleetSessionsSnapshot: () => [],
  selectConversation: () => {},
  pinConversation: () => {},
  unpinConversation: () => {},
  addToActiveSet: () => {},
  removeFromActiveSet: () => {},
  fleetRowId: (hostId: number, sessionName: string) =>
    `fleet::${hostId}::${sessionName}`,
  hydratePinnedIdsFromServer: () => {},
  // Phase 117 Plan 117-08 — useProjects subscription (empty).
  useProjects: () => [],
}));

// Phase 117 Plan 117-08 — collapse hook + drop API stubs.
vi.mock("@/state/use-collapsed-project-slugs", () => ({
  useCollapsedProjectSlugs: () => ({
    collapsed: new Set<string>() as ReadonlySet<string>,
    toggle: () => {},
  }),
}));
vi.mock("@/api/session-project-api", () => ({
  setSessionProject: vi.fn(async () => ({ ok: true })),
  setRelayRoomProject: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/api/user-preferences-api", () => ({
  // Phase 92 Plan 04: getPinnedIds retired.
  // (Phase 115 Plan 115-02: putHiddenIds retired per D-21.)
  putPinnedIds: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/state/session-working-store", () => ({
  useSessionIsWorking: () => false,
  useSessionLastMessageAt: () => null,
  getSessionLastMessageAt: () => null,
  subscribeSessionWorkingStore: (_cb: () => void) => () => {},
  useSessionAiTitle: () => null,
  getSessionWorkingSnapshot: () => new Map(),
  useSessionIsDormant: () => false,
}));

// Phase 23 (GEFM-01): mock GlobalFilesModal so this test suite doesn't pull the
// full modal dep tree.
vi.mock("@/features/pretty-view/GlobalFilesModal", () => ({
  default: (props: { open: boolean }) =>
    props.open ? <div data-testid="global-files-modal-stub" /> : null,
}));

// Phase 90 Plan 90-06: mock SkillsEditorModal + RoleModal + RunbookEditorModal
// so the panel mounts them as stubs. RolesListModal we let render for real —
// it's the one whose "Roles" title we assert on.
vi.mock("@/features/pretty-view/SkillsEditorModal", () => ({
  default: (props: { open: boolean }) =>
    props.open ? <div data-testid="skills-editor-modal-stub" /> : null,
}));
vi.mock("@/features/pretty-view/RoleModal", () => ({
  RoleModal: (props: { open: boolean }) =>
    props.open ? <div data-testid="role-modal-stub" /> : null,
}));
vi.mock("@/features/pretty-view/RunbookEditorModal", () => ({
  default: (props: { open: boolean }) =>
    props.open ? <div data-testid="runbook-editor-modal-stub" /> : null,
}));

// Mock the identities API listRolesForHost so RolesListModal renders without a
// backend call.
vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listRolesForHost: vi.fn().mockResolvedValue([]),
    roleAvatarUrl: (hostId: number, roleName: string) =>
      `/roles/${roleName}/avatar?hostId=${hostId}`,
  };
});

vi.mock("@/api/global-files-api", () => ({
  listGlobalFiles: vi.fn().mockResolvedValue([]),
  readGlobalFile: vi.fn().mockResolvedValue({ content: "", mtime: 0, size: 0 }),
  writeGlobalFile: vi.fn().mockResolvedValue({ mtime: 0 }),
  GlobalFileMtimeConflictError: class GlobalFileMtimeConflictError extends Error {},
}));

// ─── Component under test (import AFTER mocks) ──────────────────────────────

import { PrettyConversationsPanel } from "./PrettyConversationsPanel";

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

const ONE_HOST_TREE: HostFolder = {
  name: "root",
  children: [makeHost("h1", "hostA")],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PrettyConversationsPanel: Edit roles kebab menu item (shape-sidebar-header-footer-redesign)", () => {
  it("Test 21a (shape-redesign): Edit roles is NOT a header button; it lives in the kebab as the third item (after the guarded pair)", () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    // No dedicated header button any more.
    expect(screen.queryByTestId("pv-header-edit-roles-button")).toBeNull();

    // Open the kebab and verify Edit roles is present as the third item.
    fireEvent.click(screen.getByTestId("pv-header-menu-button"));
    const menu = screen.getByRole("menu");
    const kebabItems = within(menu).getAllByRole("menuitem").map((el) =>
      el.textContent?.trim() ?? "",
    );
    // The old "New role" entry is GONE (D-07). Edit roles is back — appended
    // as the third item after the Phase-44-guarded pair, whose order is
    // preserved.
    expect(within(menu).queryByRole("menuitem", { name: /^new role$/i })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: /edit roles/i })).toBeTruthy();
    expect(kebabItems).toEqual([
      "New group conversation",
      "Edit global skills…",
      "Edit roles…",
    ]);
  });

  it("Test 21b (shape-redesign): showPencilButton siblings absent when onCreateSession is undefined — Edit roles is no longer a header button, so no explicit assertion", () => {
    // Phase 23 gate carries over unchanged — the whole menu vanishes when
    // the panel has no onCreateSession callback wired.
    render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
      />,
    );

    expect(screen.queryByTestId("pv-header-menu-button")).toBeNull();
    expect(screen.queryByTestId("pv-header-new-agent-button")).toBeNull();
    // pv-header-edit-roles-button is retired at all render states — the
    // migration to the kebab means it's not a header button in any gate.
    expect(screen.queryByTestId("pv-header-edit-roles-button")).toBeNull();
    // Globe migrated to the sidebar footer; new test-id
    // pv-footer-global-files-button lives on the footer, NOT under the
    // showPencilButton gate.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Test 21c (shape-redesign): clicking the kebab's Edit roles item opens RolesListModal (detection signal: the modal's 'Roles' title)", async () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    // Dialog is not open before click.
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(0);

    // Open the kebab, then click Edit roles inside.
    fireEvent.click(screen.getByTestId("pv-header-menu-button"));
    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /edit roles/i }));

    // RolesListModal is now rendered — assert on its "Roles" DialogTitle.
    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
      expect(dialog).toBeTruthy();
      // Its title contains the word "Roles" (from RolesListModal DialogTitle).
      expect(dialog!.textContent).toMatch(/^Roles/);
    });
  });
});
