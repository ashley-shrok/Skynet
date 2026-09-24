// Phase 135 Plan 135-02 Task 5 — PrettyConversationsPanel wake-ups button.
//
// 4 tests mirroring PrettyConversationsPanel.new-role-button.test.tsx's
// panel-button-test pattern (~140 lines of shared vi.mock boilerplate for
// stores + sibling modals, then a focused describe on the new button).
//
// Coverage:
//   Test 1: pv-header-wakeups-button renders with correct chrome + a11y attrs
//   Test 2: button absent when onCreateSession is undefined (showPencilButton guard)
//   Test 3: clicking the button opens WakeupsModal (stubbed)
//   Test 4: button position — after Globe, before feedback + kebab
//
// Kept as a sibling test file (not appended to the main panel test) so the
// surface stays isolated from the 25+ pre-existing tests in the main suite —
// matches the sibling-file pattern established by
// PrettyConversationsPanel.new-role-button.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
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
  deriveDiskPinnedIds: () => [],
  buildIdentityHostsFromFleet: () => ({}),
}));

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
    pinnedUnassigned: [],
    projectSections: [],
    rdp: null,
  }),
  useSelectedConversationId: () => null,
  usePinnedIds: () => new Set(),
  useActiveSet: () => new Set(),
  useFleetSessionsLoaded: () => false,
  getFleetSessionsSnapshot: () => [],
  selectConversation: () => {},
  pinConversation: () => {},
  unpinConversation: () => {},
  addToActiveSet: () => {},
  removeFromActiveSet: () => {},
  fleetRowId: (hostId: number, sessionName: string) =>
    `fleet::${hostId}::${sessionName}`,
  hydratePinnedIdsFromServer: () => {},
  useArchivedFleetRows: () => [],
  useProjects: () => [],
}));

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

// Stub the sibling modals so the panel mounts them without pulling
// their full dep trees.
vi.mock("@/features/pretty-view/GlobalFilesModal", () => ({
  default: (props: { open: boolean }) =>
    props.open ? <div data-testid="global-files-modal-stub" /> : null,
}));

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

// Additional wake-ups-specific mocks.
vi.mock("./WakeupsModal", () => ({
  WakeupsModal: (props: { open: boolean }) =>
    props.open ? <div data-testid="wakeups-modal-stub" /> : null,
}));

vi.mock("@/api/wakeups-api", () => ({
  listWakeups: vi.fn().mockResolvedValue([]),
  createWakeup: vi.fn(),
  updateWakeup: vi.fn(),
  toggleWakeupEnabled: vi.fn(),
  deleteWakeup: vi.fn(),
}));

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
  children: [makeHost("h1", "host-a")],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PrettyConversationsPanel: Wake-ups header button", () => {
  it("Test 1: pv-header-wakeups-button renders with correct chrome + a11y attrs", () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );
    const btn = screen.getByTestId("pv-header-wakeups-button");
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toBe("Wake-ups");
    expect(btn.getAttribute("title")).toBe("Wake-ups");
    // Shares the .pv-pencil chrome with siblings.
    expect(btn.classList.contains("pv-pencil")).toBe(true);
  });

  it("Test 2: button absent when onCreateSession is undefined (showPencilButton guard)", () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
      />,
    );
    expect(screen.queryByTestId("pv-header-wakeups-button")).toBeNull();
  });

  it("Test 3: clicking pv-header-wakeups-button opens WakeupsModal (stub visible)", async () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );
    // Stub is not in doc before click.
    expect(screen.queryByTestId("wakeups-modal-stub")).toBeNull();

    fireEvent.click(screen.getByTestId("pv-header-wakeups-button"));

    await waitFor(() => {
      expect(screen.getByTestId("wakeups-modal-stub")).toBeInTheDocument();
    });
  });

  it("Test 4: button position — appears after Globe, before kebab", () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );
    const globe = screen.getByTestId("pv-header-global-files-button");
    const wakeup = screen.getByTestId("pv-header-wakeups-button");
    const kebab = screen.getByTestId("pv-header-menu-button");
    // Node.DOCUMENT_POSITION_FOLLOWING = 4
    expect(
      globe.compareDocumentPosition(wakeup) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      wakeup.compareDocumentPosition(kebab) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
