/**
 * Phase 117 Plan 117-08 Task 2 — PrettyConversationsPanel projects zone.
 *
 * Behavior surface (see 117-08-PLAN.md <behavior> Task 2):
 *   Test 1  — project sections render BETWEEN pinned zone and flat middle (D-09)
 *   Test 2  — no "Projects" super-section wrapping label (D-10)
 *   Test 3  — empty project section renders as header-only (D-11) + still droppable
 *   Test 4  — collapse state hides rows; click header calls toggle
 *   Test 5  — create-project header button exists + click opens placeholder modal
 *   Test 6  — drop on project section (identity row) → setSessionProject(hostId, key, slug)
 *   Test 7  — drop on project section (relay-room row) → setRelayRoomProject(roomId, mxid, slug)
 *   Test 8  — drop on flat middle clears identity row's project (D-22 gesture #2)
 *   Test 9  — drop on flat middle on unassigned row is a no-op
 *   Test 10 — RDP row drop refused (D-08 defense-in-depth at panel handleProjectDrop)
 *   Test 11 — project sections rendered in the derived-selector order (regression guard)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  fireEvent,
  createEvent,
  cleanup,
} from "@testing-library/react";
import type { Host, HostFolder } from "@/types/ui-types";

// ─── Global mocks ─────────────────────────────────────────────────────────────

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

const refreshIdentitiesSpy = vi.fn(async () => true);

vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({
    byKey: new Map(),
    byHostKey: new Map(),
    identities: [],
    loaded: true,
    refresh: async () => {},
  }),
  deriveDiskPinnedIds: () => [],
  buildIdentityHostsFromFleet: () => ({}),
  refreshIdentities: (extra?: Record<string, number>) =>
    refreshIdentitiesSpy(extra),
}));

vi.mock("@/state/trapped-work-store", () => ({
  useTrappedWork: () => undefined,
  startTrappedWorkPoller: () => () => {},
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

// ─── conversation-store mock — including the new derived-selector fields ────
type MockRow = {
  id: string;
  type: string;
  label: string;
  host?: Host | undefined;
  targetTmuxSession: string | null;
  fleetOnly?: boolean;
  rdpHostRow?: boolean;
  kind?: "harness" | "relay-room";
  roomId?: string;
  roomTitle?: string | null;
};

type MockGroup = {
  hostId: string;
  hostName: string;
  rows: MockRow[];
};

type MockSnapshot = {
  activeSet: MockRow[];
  pinned: MockRow[];
  middle: MockRow[];
  rdpGroup: MockGroup | null;
  pinnedUnassigned: MockRow[];
  projectSections: Array<{
    slug: string;
    displayName: string;
    rows: MockRow[];
  }>;
  rdp: MockGroup | null;
  selectedId: string | null;
  pinnedIds: ReadonlySet<string>;
};

let snapshot: MockSnapshot = {
  activeSet: [],
  pinned: [],
  middle: [],
  rdpGroup: null,
  pinnedUnassigned: [],
  projectSections: [],
  rdp: null,
  selectedId: null,
  pinnedIds: new Set(),
};

function setSnapshot(next: Partial<MockSnapshot>): void {
  snapshot = {
    activeSet: next.activeSet ?? [],
    pinned: next.pinned ?? [],
    middle: next.middle ?? [],
    rdpGroup: next.rdpGroup ?? null,
    pinnedUnassigned: next.pinnedUnassigned ?? [],
    projectSections: next.projectSections ?? [],
    rdp: next.rdp ?? null,
    selectedId: next.selectedId ?? null,
    pinnedIds: next.pinnedIds ?? new Set(),
  };
}

// ProjectRow snapshot for useProjects() — the create-project button is
// state-only in this plan; the modal itself lands in 117-09. useProjects
// is consumed by the panel but never mutated in these tests.
let mockProjects: readonly {
  slug: string;
  displayName: string;
  hostId: string;
  hostname: string;
  archived: boolean;
}[] = [];

const selectConversationSpy = vi.fn();
const addToActiveSetSpy = vi.fn();
const removeFromActiveSetSpy = vi.fn();
const pinConversationSpy = vi.fn();
const unpinConversationSpy = vi.fn();
const hydratePinnedIdsFromServerSpy = vi.fn();

let mockActiveSet: ReadonlySet<string> = new Set();
let mockFleetSessionsLoaded = true;

vi.mock("@/state/conversation-store", () => ({
  useConversations: () => ({
    activeSet: snapshot.activeSet,
    pinned: snapshot.pinned,
    middle: snapshot.middle,
    rdpGroup: snapshot.rdpGroup,
    pinnedUnassigned: snapshot.pinnedUnassigned,
    projectSections: snapshot.projectSections,
    rdp: snapshot.rdp,
  }),
  useSelectedConversationId: () => snapshot.selectedId,
  usePinnedIds: () => snapshot.pinnedIds,
  useActiveSet: () => mockActiveSet,
  useFleetSessionsLoaded: () => mockFleetSessionsLoaded,
  getFleetSessionsSnapshot: () => [],
  useProjects: () => mockProjects,
  selectConversation: (id: string | null) => selectConversationSpy(id),
  pinConversation: (id: string) => pinConversationSpy(id),
  unpinConversation: (id: string) => unpinConversationSpy(id),
  addToActiveSet: (id: string) => addToActiveSetSpy(id),
  removeFromActiveSet: (id: string) => removeFromActiveSetSpy(id),
  fleetRowId: (hostId: number, sessionName: string) =>
    `fleet::${hostId}::${sessionName}`,
  hydratePinnedIdsFromServer: (ids: string[]) =>
    hydratePinnedIdsFromServerSpy(ids),
  useArchivedFleetRows: () => [],
}));

// use-collapsed-project-slugs mock — flexible per-test via mockCollapsed.
let mockCollapsed: Set<string> = new Set();
const toggleSpy = vi.fn((slug: string) => {
  if (mockCollapsed.has(slug)) mockCollapsed.delete(slug);
  else mockCollapsed.add(slug);
});
vi.mock("@/state/use-collapsed-project-slugs", () => ({
  useCollapsedProjectSlugs: () => ({
    collapsed: mockCollapsed as ReadonlySet<string>,
    toggle: toggleSpy,
  }),
}));

// session-project-api mocks
const setSessionProjectSpy = vi.fn<
  (hostId: number, key: string, slug: string | null) => Promise<{ ok: true }>
>(async () => ({ ok: true as const }));
const setRelayRoomProjectSpy = vi.fn<
  (roomId: string, mxid: string, slug: string | null) => Promise<{ ok: true }>
>(async () => ({ ok: true as const }));
vi.mock("@/api/session-project-api", () => ({
  setSessionProject: (hostId: number, key: string, slug: string | null) =>
    setSessionProjectSpy(hostId, key, slug),
  setRelayRoomProject: (roomId: string, mxid: string, slug: string | null) =>
    setRelayRoomProjectSpy(roomId, mxid, slug),
}));

// Phase 117 Plan 117-09 — project-list-api mock. The CreateProjectModal
// (117-09 Task 1) imports createProject from this module; the modal only
// fires the API on Submit-click, so tests that never click Submit see no
// spy invocations. Stubbed to a successful envelope so any incidental
// click path lands cleanly.
const createProjectSpy = vi.fn<
  (hostId: number, displayName: string) => Promise<{ ok: true; slug: string }>
>(async (_hostId, name) => ({
  ok: true as const,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
}));
const archiveProjectSpy = vi.fn<
  (hostId: number, slug: string) => Promise<{ ok: true }>
>(async () => ({ ok: true as const }));
vi.mock("@/api/project-list-api", () => ({
  createProject: (hostId: number, displayName: string) =>
    createProjectSpy(hostId, displayName),
  archiveProject: (hostId: number, slug: string) =>
    archiveProjectSpy(hostId, slug),
  listProjects: vi.fn(async () => ({ projects: [] })),
  listRelayRoomProjectTags: vi.fn(async () => ({ assignments: [] })),
}));

// viewing-user-store mock — panel-level handleProjectDrop uses userMxid for
// the relay-room path.
vi.mock("@/state/viewing-user-store", () => ({
  useViewingUserMxid: vi.fn(() => "@user:matrix.example"),
  useViewingUserId: vi.fn(() => "u-user"),
}));

vi.mock("@/api/user-preferences-api", () => ({
  putPinnedIds: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/api/identity-archive-api", () => ({
  archiveIdentity: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/api/user-management-api", () => ({
  getUsersListBasic: vi.fn(async () => []),
}));
vi.mock("@/api/relay-room-create-api", () => ({
  createRelayRoom: vi.fn(async () => ({
    ok: true,
    roomId: "!r:s",
    sessionId: "s1",
    roomTitle: "T",
  })),
}));

vi.mock("@/state/session-working-store", () => ({
  useSessionIsWorking: () => false,
  useSessionLastMessageAt: () => null,
  getSessionLastMessageAt: () => null,
  subscribeSessionWorkingStore: () => () => {},
  useSessionAiTitle: () => null,
  getSessionWorkingSnapshot: () => new Map(),
  useSessionIsDormant: () => false,
  useSessionIsRecycling: () => false,
}));

vi.mock("@/state/session-queue-pending-store", () => ({
  useSessionQueuePending: () => false,
}));

vi.mock("@/features/pretty-view/GlobalFilesModal", () => ({
  default: (props: { open: boolean }) =>
    props.open ? <div data-testid="global-files-modal-stub" /> : null,
}));

vi.mock("@/features/pretty-view/SkillsEditorModal", () => ({
  default: () => null,
}));

vi.mock("@/features/pretty-view/RolesListModal", () => ({
  RolesListModal: () => null,
}));

vi.mock("@/features/pretty-view/RoleModal", () => ({
  RoleModal: () => null,
}));

vi.mock("@/features/pretty-view/RunbookEditorModal", () => ({
  default: () => null,
}));

// Phase 117 M-F: NewSessionDialog stub — exposes buttons that fire onCreate
// with controlled opts so tests can observe the panel's setSessionProject
// wire without SSE / birth plumbing. Only renders when open=true. The
// synthetic-fire buttons carry testids that map 1:1 to the three
// NewSessionOnCreateOpts variants (identityMode false / true / "existing").
vi.mock("@/sidebar/NewSessionDialog", () => ({
  NewSessionDialog: (props: {
    open: boolean;
    onCreate: (opts: unknown) => void;
    onClose: () => void;
    // M-I: expose the incoming hostTree to tests so they can assert the
    // panel-side filter (single-host tree in project context).
    hostTree: { name: string; children: unknown[] } | null;
  }) => {
    if (!props.open) return null;
    // Count top-level hosts (folders skipped for simplicity — the panel
    // passes a flat single-host list in project context, not a nested tree).
    const treeChildCount = props.hostTree?.children?.length ?? 0;
    const host = {
      id: "1",
      name: "hostA",
      username: "u",
      ip: "1.1.1.1",
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
      enableSsh: true,
      enableRdp: false,
      pin: "",
      protocol: "ssh",
      publicKey: "",
      externalUrl: "",
      description: "",
      isPublic: false,
      autostart: false,
      autostartTimeout: 60,
    };
    return (
      <div
        data-testid="pv-mock-new-session-dialog"
        data-hosttree-child-count={String(treeChildCount)}
      >
        <button
          data-testid="pv-mock-nsd-fire-birth"
          onClick={() =>
            props.onCreate({
              host,
              identityMode: true,
              name: "wren",
              path: "/home/u",
            })
          }
        >
          fire birth
        </button>
        <button
          data-testid="pv-mock-nsd-fire-existing"
          onClick={() =>
            props.onCreate({
              host,
              identityMode: "existing",
              identityName: "vecto",
              identityId: "vecto",
              sessionName: "vecto",
              path: "/home/u",
            })
          }
        >
          fire existing
        </button>
        <button
          data-testid="pv-mock-nsd-fire-plain"
          onClick={() =>
            props.onCreate({
              host,
              identityMode: false,
              path: "/home/u",
            })
          }
        >
          fire plain
        </button>
      </div>
    );
  },
}));

vi.mock("@/sidebar/CreateRoleDialog", () => ({
  CreateRoleDialog: () => null,
}));

vi.mock("@/api/global-files-api", () => ({
  listGlobalFiles: vi.fn().mockResolvedValue([]),
  readGlobalFile: vi.fn().mockResolvedValue({ content: "", mtime: 0, size: 0 }),
  writeGlobalFile: vi.fn().mockResolvedValue({ mtime: 0 }),
  GlobalFileMtimeConflictError: class GlobalFileMtimeConflictError extends Error {},
}));

// ─── Component under test ───────────────────────────────────────────────────

import { PrettyConversationsPanel } from "./PrettyConversationsPanel";

// ─── Fixture helpers ────────────────────────────────────────────────────────

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

function makeRow(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "row-x",
    type: "terminal",
    label: "session-x",
    host: makeHost("1", "hostA"),
    targetTmuxSession: null,
    ...overrides,
  };
}

const HOST_TREE: HostFolder = {
  name: "root",
  children: [makeHost("1", "hostA")],
};

// DataTransfer stub — mirrors the shape in PrettyProjectSectionHeader.test.tsx.
function makeDataTransferStub(entries: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(entries));
  return {
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? "",
    effectAllowed: "none" as string,
    get types() {
      return Array.from(store.keys());
    },
  };
}

function dispatchDragOverAt(
  el: Element,
  clientX: number,
  clientY: number,
  dt: ReturnType<typeof makeDataTransferStub>,
): void {
  const evt = createEvent.dragOver(el, { dataTransfer: dt });
  Object.defineProperty(evt, "clientX", { value: clientX, configurable: true });
  Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
  fireEvent(el, evt);
}

function dispatchDrop(
  el: Element,
  dt: ReturnType<typeof makeDataTransferStub>,
): void {
  const evt = createEvent.drop(el, { dataTransfer: dt });
  fireEvent(el, evt);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  setSnapshot({});
  mockCollapsed = new Set();
  mockProjects = [];
  mockActiveSet = new Set();
  mockFleetSessionsLoaded = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — project sections render BETWEEN pinned zone and flat middle (D-09)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: projects zone position (D-09)", () => {
  it("Test 1: project sections render between pinned zone and flat middle", () => {
    const hostA = makeHost("1", "hostA");
    const rowPinned = makeRow({
      id: "pinned-1",
      label: "pinned-row",
      host: hostA,
      targetTmuxSession: "pinned-sess",
    });
    const rowAlpha = makeRow({
      id: "alpha-1",
      label: "alpha-row",
      host: hostA,
      targetTmuxSession: "alpha-sess",
    });
    const rowMiddle = makeRow({
      id: "middle-1",
      label: "middle-row",
      host: hostA,
      targetTmuxSession: "middle-sess",
    });
    setSnapshot({
      pinned: [rowPinned],
      pinnedUnassigned: [rowPinned],
      projectSections: [
        { slug: "alpha", displayName: "Alpha", rows: [rowAlpha] },
      ],
      middle: [rowMiddle],
      pinnedIds: new Set(["pinned-1"]),
    });
    mockProjects = [
      {
        slug: "alpha",
        displayName: "Alpha",
        hostId: "1",
        hostname: "hostA",
        archived: false,
      },
    ];

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );

    // Rows should appear in DOM order: pinned → project section → middle.
    const pinnedRow = container.querySelector('[data-conversation-id="pinned-1"]');
    const alphaSection = container.querySelector('[data-testid="pv-project-section-alpha"]');
    const middleRow = container.querySelector('[data-conversation-id="middle-1"]');
    expect(pinnedRow).not.toBeNull();
    expect(alphaSection).not.toBeNull();
    expect(middleRow).not.toBeNull();

    // Compare by DocumentPosition — pinned BEFORE alpha section BEFORE middle.
    const posAlpha = pinnedRow!.compareDocumentPosition(alphaSection!);
    expect(posAlpha & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const posMiddle = alphaSection!.compareDocumentPosition(middleRow!);
    expect(posMiddle & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — no "Projects" super-section wrapping label (D-10)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: no super-section 'Projects' label (D-10)", () => {
  it("Test 2: no element with text 'Projects' exists as a wrapping super-section header", () => {
    const hostA = makeHost("1", "hostA");
    const rowA = makeRow({
      id: "a-1",
      host: hostA,
      targetTmuxSession: "a-sess",
    });
    const rowB = makeRow({
      id: "b-1",
      host: hostA,
      targetTmuxSession: "b-sess",
    });
    setSnapshot({
      projectSections: [
        { slug: "alpha", displayName: "Alpha", rows: [rowA] },
        { slug: "beta", displayName: "Beta", rows: [rowB] },
      ],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
      { slug: "beta", displayName: "Beta", hostId: "1", hostname: "hostA", archived: false },
    ];

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );

    // Both individual project section headers exist.
    expect(container.querySelector('[data-testid="pv-project-section-header-alpha"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pv-project-section-header-beta"]')).not.toBeNull();

    // No wrapping label named "Projects" (plural). Check that no element has
    // trimmed text content exactly "Projects" — D-10 explicit rejection.
    const allSpans = container.querySelectorAll("span");
    for (const el of Array.from(allSpans)) {
      const txt = (el.textContent ?? "").trim();
      expect(txt).not.toBe("Projects");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — empty project section renders as header-only (D-11) + still droppable
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: empty projects visible (D-11)", () => {
  it("Test 3: empty project section renders header-only; section wrapper is droppable", () => {
    setSnapshot({
      projectSections: [
        { slug: "empty", displayName: "Empty", rows: [] },
      ],
    });
    mockProjects = [
      { slug: "empty", displayName: "Empty", hostId: "1", hostname: "hostA", archived: false },
    ];

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );

    const section = container.querySelector('[data-testid="pv-project-section-empty"]');
    expect(section).not.toBeNull();
    // Header exists (it's inside section).
    expect(container.querySelector('[data-testid="pv-project-section-header-empty"]')).not.toBeNull();
    // No rows inside (the section rendered no children rows).
    const rowsRegion = section!.querySelector('#pv-project-section-content-empty');
    // rowsRegion may be empty div — but its content should have no PrettyConversationRow elements.
    if (rowsRegion) {
      expect(rowsRegion.querySelectorAll('[data-conversation-id]').length).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — collapse state hides rows; click header calls toggle
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: collapse state (D-13)", () => {
  it("Test 4: collapsed slug hides rows; header click fires toggle(slug)", () => {
    const hostA = makeHost("1", "hostA");
    const rowA = makeRow({ id: "alpha-row", host: hostA, targetTmuxSession: "a-sess" });
    setSnapshot({
      projectSections: [
        { slug: "alpha", displayName: "Alpha", rows: [rowA] },
      ],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];
    mockCollapsed = new Set(["alpha"]);

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );

    // Rows NOT in DOM inside the collapsed section.
    const section = container.querySelector('[data-testid="pv-project-section-alpha"]');
    expect(section).not.toBeNull();
    expect(section!.querySelector('[data-conversation-id="alpha-row"]')).toBeNull();

    // Click header → toggle called with slug.
    const header = container.querySelector('[data-testid="pv-project-section-header-alpha"]') as HTMLElement;
    fireEvent.click(header);
    expect(toggleSpy).toHaveBeenCalledWith("alpha");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — create-project header button opens placeholder modal
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: create-project header button", () => {
  it("Test 5: 'Create project' button in header cluster; click toggles modal state (placeholder visible)", () => {
    const { getByLabelText, queryByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    // Placeholder modal NOT visible before click.
    expect(queryByTestId("create-project-modal-placeholder")).toBeNull();
    // Click the header create-project button.
    const btn = getByLabelText("Create project");
    fireEvent.click(btn);
    // Placeholder modal visible (state toggled to true).
    expect(queryByTestId("create-project-modal-placeholder")).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — drop on project section (identity row) → setSessionProject
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: project drop (identity row)", () => {
  it("Test 6: drop on project section fires setSessionProject(hostId, key, slug)", () => {
    setSnapshot({
      projectSections: [
        { slug: "alpha", displayName: "Alpha", rows: [] },
      ],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );

    const section = container.querySelector('[data-testid="pv-project-section-alpha"]') as HTMLElement;
    expect(section).not.toBeNull();

    const payload = {
      id: "wren-row",
      host: { id: "1" },
      targetTmuxSession: "wren-session",
      identityKey: "wren",
      rdpHostRow: false,
    };
    const dt = makeDataTransferStub({
      "application/x-skynet-row": JSON.stringify(payload),
    });
    dispatchDragOverAt(section, 200, 200, dt);
    dispatchDrop(section, dt);

    expect(setSessionProjectSpy).toHaveBeenCalledTimes(1);
    expect(setSessionProjectSpy).toHaveBeenCalledWith(1, "wren", "alpha");
    expect(setRelayRoomProjectSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — drop on project section (relay-room row) → setRelayRoomProject
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: project drop (relay-room row)", () => {
  it("Test 7: drop on project section fires setRelayRoomProject(roomId, mxid, slug)", () => {
    setSnapshot({
      projectSections: [
        { slug: "alpha", displayName: "Alpha", rows: [] },
      ],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );

    const section = container.querySelector('[data-testid="pv-project-section-alpha"]') as HTMLElement;
    const payload = {
      id: "relay-row-1",
      matrixRoomId: "!abc:matrix.example",
      rdpHostRow: false,
    };
    const dt = makeDataTransferStub({
      "application/x-skynet-row": JSON.stringify(payload),
    });
    dispatchDragOverAt(section, 200, 200, dt);
    dispatchDrop(section, dt);

    expect(setRelayRoomProjectSpy).toHaveBeenCalledTimes(1);
    expect(setRelayRoomProjectSpy).toHaveBeenCalledWith(
      "!abc:matrix.example",
      "@user:matrix.example",
      "alpha",
    );
    expect(setSessionProjectSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — drop on flat middle clears identity row's project (D-22 gesture #2)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: flat-middle clear-project (D-22 gesture #2)", () => {
  it("Test 8: drop on flat middle for row currently in a project fires setSessionProject(host, key, null)", () => {
    const hostA = makeHost("1", "hostA");
    const alphaRow = makeRow({
      id: "in-alpha",
      host: hostA,
      targetTmuxSession: "wren-session",
    });
    const middleRow = makeRow({
      id: "in-middle",
      host: hostA,
      targetTmuxSession: "other-session",
    });
    setSnapshot({
      middle: [middleRow],
      projectSections: [
        { slug: "alpha", displayName: "Alpha", rows: [alphaRow] },
      ],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );

    const flatMiddle = container.querySelector('[data-middle-group="true"]') as HTMLElement;
    expect(flatMiddle).not.toBeNull();

    // Drop the alphaRow's payload on the flat middle → should clear.
    const payload = {
      id: "in-alpha",
      host: { id: "1" },
      targetTmuxSession: "wren-session",
      identityKey: "wren",
      rdpHostRow: false,
    };
    const dt = makeDataTransferStub({
      "application/x-skynet-row": JSON.stringify(payload),
    });
    dispatchDragOverAt(flatMiddle, 100, 100, dt);
    dispatchDrop(flatMiddle, dt);

    expect(setSessionProjectSpy).toHaveBeenCalledTimes(1);
    expect(setSessionProjectSpy).toHaveBeenCalledWith(1, "wren", null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9 — drop on flat middle for unassigned row is a no-op
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: flat-middle no-op on unassigned", () => {
  it("Test 9: drop of a row NOT in any project on flat middle is a no-op", () => {
    const hostA = makeHost("1", "hostA");
    const middleRow = makeRow({
      id: "in-middle",
      host: hostA,
      targetTmuxSession: "other-session",
    });
    setSnapshot({
      middle: [middleRow],
      projectSections: [], // no projects → no possible current assignment
    });

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );

    const flatMiddle = container.querySelector('[data-middle-group="true"]') as HTMLElement;
    expect(flatMiddle).not.toBeNull();

    const payload = {
      id: "in-middle",
      host: { id: "1" },
      targetTmuxSession: "other-session",
      identityKey: "other",
      rdpHostRow: false,
    };
    const dt = makeDataTransferStub({
      "application/x-skynet-row": JSON.stringify(payload),
    });
    dispatchDragOverAt(flatMiddle, 100, 100, dt);
    dispatchDrop(flatMiddle, dt);

    // Row is not in any project section → clear is a no-op.
    expect(setSessionProjectSpy).not.toHaveBeenCalled();
    expect(setRelayRoomProjectSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10 — RDP row drop refused (D-08 defense-in-depth)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: RDP drop refused (D-08)", () => {
  it("Test 10: dropping an RDP row (rdpHostRow=true) on a project section is refused", () => {
    setSnapshot({
      projectSections: [
        { slug: "alpha", displayName: "Alpha", rows: [] },
      ],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );

    const section = container.querySelector('[data-testid="pv-project-section-alpha"]') as HTMLElement;
    const payload = {
      id: "rdp-1",
      rdpHostRow: true,
    };
    const dt = makeDataTransferStub({
      "application/x-skynet-row": JSON.stringify(payload),
    });
    dispatchDragOverAt(section, 200, 200, dt);
    dispatchDrop(section, dt);

    expect(setSessionProjectSpy).not.toHaveBeenCalled();
    expect(setRelayRoomProjectSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 11 (117-09 Task 1) — CreateProjectModal is wired to the header button
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: CreateProjectModal wire (117-09 Task 1)", () => {
  it("Test 11: clicking Create project button renders the real CreateProjectModal (data-testid='create-project-modal')", () => {
    const { getByLabelText, queryByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    // Real modal not visible before click.
    expect(queryByTestId("create-project-modal")).toBeNull();
    fireEvent.click(getByLabelText("Create project"));
    // Real modal now visible (data-testid matches CreateProjectModal.tsx).
    expect(queryByTestId("create-project-modal")).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 117-09 Task 2 — archive-project cascade + section context menu + new-conv wire
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: archive-project cascade (117-09 Task 2)", () => {
  // A9 — window.confirm spy is re-installed each test because the file-level
  // afterEach restores all mocks. Store the current spy in a let so tests
  // access the live instance.
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    confirmSpy = vi.spyOn(window, "confirm");
  });

  it("A9 Test 1 (D-29 verbatim warning): right-click header + click 'Archive project' shows the exact confirmation copy", () => {
    const hostA = makeHost("1", "hostA");
    const rowA = makeRow({ id: "in-alpha", host: hostA, targetTmuxSession: "wren" });
    setSnapshot({
      projectSections: [{ slug: "alpha", displayName: "Alpha", rows: [rowA] }],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];
    confirmSpy.mockReturnValue(false);

    const { container, getByText } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    const header = container.querySelector('[data-testid="pv-project-section-header-alpha"]') as HTMLElement;
    fireEvent.contextMenu(header);
    // Context menu appears with "Archive project" item.
    fireEvent.click(getByText("Archive project"));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(
      "About to archive this project AND all conversations inside it. Drag conversations out first if you want to keep any active.",
    );
  });

  it("A9 Test 2 (cascade fires N archiveIdentity + archiveProject after): 3 identity members → 3 archiveIdentity + 1 archiveProject", async () => {
    const hostA = makeHost("1", "hostA");
    const row1 = makeRow({ id: "r1", host: hostA, targetTmuxSession: "wren" });
    const row2 = makeRow({ id: "r2", host: hostA, targetTmuxSession: "sparrow" });
    const row3 = makeRow({ id: "r3", host: hostA, targetTmuxSession: "finch" });
    setSnapshot({
      projectSections: [
        { slug: "alpha", displayName: "Alpha", rows: [row1, row2, row3] },
      ],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];
    confirmSpy.mockReturnValue(true);

    const { container, getByText } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    const header = container.querySelector('[data-testid="pv-project-section-header-alpha"]') as HTMLElement;
    fireEvent.contextMenu(header);
    fireEvent.click(getByText("Archive project"));

    // Wait for the async cascade to settle.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Read the archiveIdentity spy from the vi.mock; expose via import.
    const { archiveIdentity } = await import("@/api/identity-archive-api");
    expect(archiveIdentity).toHaveBeenCalledTimes(3);
    expect(archiveProjectSpy).toHaveBeenCalledTimes(1);
    expect(archiveProjectSpy).toHaveBeenCalledWith(1, "alpha");
  });

  it("A9 Test 3 (partial failure): 1 archiveIdentity throws → archiveProject STILL fires; console.error logs", async () => {
    const hostA = makeHost("1", "hostA");
    const row1 = makeRow({ id: "r1", host: hostA, targetTmuxSession: "wren" });
    const row2 = makeRow({ id: "r2", host: hostA, targetTmuxSession: "sparrow" });
    setSnapshot({
      projectSections: [
        { slug: "alpha", displayName: "Alpha", rows: [row1, row2] },
      ],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];
    confirmSpy.mockReturnValue(true);

    const { archiveIdentity } = await import("@/api/identity-archive-api");
    // First call throws; second succeeds.
    (archiveIdentity as unknown as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async () => {
        throw new Error("cannot reach host");
      })
      .mockImplementationOnce(async () => ({ ok: true }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container, getByText } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    const header = container.querySelector('[data-testid="pv-project-section-header-alpha"]') as HTMLElement;
    fireEvent.contextMenu(header);
    fireEvent.click(getByText("Archive project"));

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // archiveProject STILL fires despite partial failure (Promise.allSettled semantics).
    expect(archiveProjectSpy).toHaveBeenCalledWith(1, "alpha");
    // Partial-failure logged.
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("A9 Test 3a (Fix 3 — mixed identity + relay-room cascade): BOTH archiveIdentity + setRelayRoomProject(null) fire before archiveProject", async () => {
    const hostA = makeHost("1", "hostA");
    const identityRow = makeRow({
      id: "identity-1",
      host: hostA,
      targetTmuxSession: "wren",
    });
    const relayRow = makeRow({
      id: "relay-1",
      host: undefined,
      targetTmuxSession: null,
      kind: "relay-room",
      roomId: "!abc:host",
    });
    setSnapshot({
      projectSections: [
        { slug: "alpha", displayName: "Alpha", rows: [identityRow, relayRow] },
      ],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];
    confirmSpy.mockReturnValue(true);

    const { archiveIdentity } = await import("@/api/identity-archive-api");

    const { container, getByText } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    const header = container.querySelector('[data-testid="pv-project-section-header-alpha"]') as HTMLElement;
    fireEvent.contextMenu(header);
    fireEvent.click(getByText("Archive project"));

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Both member spies fired exactly once.
    expect(archiveIdentity).toHaveBeenCalledTimes(1);
    expect(archiveIdentity).toHaveBeenCalledWith(1, "wren");
    expect(setRelayRoomProjectSpy).toHaveBeenCalledTimes(1);
    expect(setRelayRoomProjectSpy).toHaveBeenCalledWith(
      "!abc:host",
      "@user:matrix.example",
      null,
    );
    // Then archiveProject fired.
    expect(archiveProjectSpy).toHaveBeenCalledTimes(1);
    expect(archiveProjectSpy).toHaveBeenCalledWith(1, "alpha");
  });

  it("A9 Test 4 (cancel): user clicks Cancel in confirm → no cascade, no archiveProject", async () => {
    const hostA = makeHost("1", "hostA");
    const rowA = makeRow({ id: "r1", host: hostA, targetTmuxSession: "wren" });
    setSnapshot({
      projectSections: [{ slug: "alpha", displayName: "Alpha", rows: [rowA] }],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];
    confirmSpy.mockReturnValue(false);

    const { container, getByText } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    const header = container.querySelector('[data-testid="pv-project-section-header-alpha"]') as HTMLElement;
    fireEvent.contextMenu(header);
    fireEvent.click(getByText("Archive project"));

    const { archiveIdentity } = await import("@/api/identity-archive-api");
    expect(archiveIdentity).not.toHaveBeenCalled();
    expect(archiveProjectSpy).not.toHaveBeenCalled();
    expect(setRelayRoomProjectSpy).not.toHaveBeenCalled();
  });

  it("A9 Test 5 (empty project): 0 members → skip cascade, just archiveProject", async () => {
    setSnapshot({
      projectSections: [{ slug: "empty", displayName: "Empty", rows: [] }],
    });
    mockProjects = [
      { slug: "empty", displayName: "Empty", hostId: "1", hostname: "hostA", archived: false },
    ];
    confirmSpy.mockReturnValue(true);

    const { container, getByText } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    const header = container.querySelector('[data-testid="pv-project-section-header-empty"]') as HTMLElement;
    fireEvent.contextMenu(header);
    fireEvent.click(getByText("Archive project"));

    await new Promise((r) => setTimeout(r, 0));

    const { archiveIdentity } = await import("@/api/identity-archive-api");
    expect(archiveIdentity).not.toHaveBeenCalled();
    expect(setRelayRoomProjectSpy).not.toHaveBeenCalled();
    expect(archiveProjectSpy).toHaveBeenCalledTimes(1);
    expect(archiveProjectSpy).toHaveBeenCalledWith(1, "empty");
  });

  // Phase 117 M7 fix (2026-09-18): pre-fix, if projectsList did not
  // contain the slug the code fell back to defaultCreateProjectHostId —
  // a DIFFERENT host than the project actually lives on. That fallback
  // would silently archive a same-slug project on the wrong host or
  // fail silently. Correct behavior: log a warning and RETURN early
  // without firing archiveProject. This test proves the fix.
  it("A9 Test 5a (M7 fix): project missing from projectsList → NO archiveProject fires (defensive early-return, not host-fallback)", async () => {
    setSnapshot({
      projectSections: [
        { slug: "alpha", displayName: "Alpha", rows: [] },
      ],
    });
    // projectsList does NOT contain "alpha" — simulate a stale sidebar
    // where a project was archived on another client but the WS event
    // has not landed yet.
    mockProjects = [];
    confirmSpy.mockReturnValue(true);

    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    const { container, getByText } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    const header = container.querySelector(
      '[data-testid="pv-project-section-header-alpha"]',
    ) as HTMLElement;
    fireEvent.contextMenu(header);
    fireEvent.click(getByText("Archive project"));

    await new Promise((r) => setTimeout(r, 0));

    // M7 regression: archiveProject MUST NOT have fired — refusing to
    // fall back to defaultCreateProjectHostId when the project isn't
    // in the list.
    expect(archiveProjectSpy).not.toHaveBeenCalled();
    // Warning was logged with the reason.
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "archive_project_folder_move_skipped_no_host",
        slug: "alpha",
      }),
    );

    consoleWarnSpy.mockRestore();
  });

  it("A9 Test 6 (context menu items): right-click header shows BOTH 'Edit project file' and 'Archive project'", () => {
    setSnapshot({
      projectSections: [{ slug: "alpha", displayName: "Alpha", rows: [] }],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];

    const { container, queryByText } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    const header = container.querySelector('[data-testid="pv-project-section-header-alpha"]') as HTMLElement;
    fireEvent.contextMenu(header);

    expect(queryByText("Edit project file")).not.toBeNull();
    expect(queryByText("Archive project")).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A9 Test 9 (Task 2 panel wiring, revised M-F 2026-09-18) — SquarePen opens
// the NEW-AGENT dialog (NewSessionDialog) with a pending project slug, and
// the freshly-born identity gets setSessionProject called after onCreate.
// The pre-M-F wire (opening NewConversationModal for a relay-room-in-project)
// is retired — the relay-room wrapper's data attribute MUST NOT be set from
// this button.
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: new-conversation-in-project wire (M-F rewire)", () => {
  it("Test 9: SquarePen sets pending project slug on the new-session wrapper (NOT the relay-room wrapper)", () => {
    setSnapshot({
      projectSections: [{ slug: "alpha", displayName: "Alpha", rows: [] }],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    const squarePen = container.querySelector('[data-testid="pv-project-section-new-conv-alpha"]') as HTMLElement;
    expect(squarePen).not.toBeNull();
    fireEvent.click(squarePen);

    // NEW wire: the pending slug lands on the new-session dialog wrapper.
    const nsdWrapper = container.querySelector('[data-testid="pv-new-session-dialog-wrapper"]');
    expect(nsdWrapper).not.toBeNull();
    expect(nsdWrapper!.getAttribute("data-pending-project-slug")).toBe("alpha");

    // OLD wire must NOT have fired — the relay-room modal wrapper stays empty.
    const oldWrapper = container.querySelector('[data-testid="pv-new-conv-modal-wrapper"]');
    expect(oldWrapper).not.toBeNull();
    expect(oldWrapper!.getAttribute("data-pre-selected-project")).toBe("");
  });

  it("Test 9b: identity-birth onCreate fires setSessionProject(hostId, newborn identityKey, slug)", () => {
    setSnapshot({
      projectSections: [{ slug: "alpha", displayName: "Alpha", rows: [] }],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    const squarePen = container.querySelector('[data-testid="pv-project-section-new-conv-alpha"]') as HTMLElement;
    fireEvent.click(squarePen);

    // The mocked NewSessionDialog exposes a "fire birth" button that
    // synthesizes onCreate({identityMode:true, name:"wren", host:{id:"1"}, ...}).
    const fireBirth = container.querySelector('[data-testid="pv-mock-nsd-fire-birth"]') as HTMLElement;
    expect(fireBirth).not.toBeNull();
    fireEvent.click(fireBirth);

    // setSessionProject fired with the newborn identity's name + section slug.
    expect(setSessionProjectSpy).toHaveBeenCalledTimes(1);
    expect(setSessionProjectSpy).toHaveBeenCalledWith(1, "wren", "alpha");

    // The pending slug is cleared after onCreate; the wrapper's data-attr
    // reflects the reset.
    const nsdWrapper = container.querySelector('[data-testid="pv-new-session-dialog-wrapper"]');
    expect(nsdWrapper!.getAttribute("data-pending-project-slug")).toBe("");
  });

  it("Test 9c: identityMode=\"existing\" (clone) fires setSessionProject with opts.identityName", () => {
    setSnapshot({
      projectSections: [{ slug: "alpha", displayName: "Alpha", rows: [] }],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    fireEvent.click(container.querySelector('[data-testid="pv-project-section-new-conv-alpha"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-testid="pv-mock-nsd-fire-existing"]') as HTMLElement);

    expect(setSessionProjectSpy).toHaveBeenCalledTimes(1);
    expect(setSessionProjectSpy).toHaveBeenCalledWith(1, "vecto", "alpha");
  });

  it("Test 9d: identityMode=false (plain tmux session, no identity) does NOT fire setSessionProject", () => {
    setSnapshot({
      projectSections: [{ slug: "alpha", displayName: "Alpha", rows: [] }],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    fireEvent.click(container.querySelector('[data-testid="pv-project-section-new-conv-alpha"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-testid="pv-mock-nsd-fire-plain"]') as HTMLElement);

    // Plain tmux session has no identity to tag; the write must be skipped.
    expect(setSessionProjectSpy).not.toHaveBeenCalled();
  });

  // ─── M-H: refreshIdentities chains after setSessionProject ────────────────
  it("Test 9e (M-H): birth path chains refreshIdentities({key: hostId}) after setSessionProject resolves", async () => {
    setSnapshot({
      projectSections: [{ slug: "alpha", displayName: "Alpha", rows: [] }],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    fireEvent.click(container.querySelector('[data-testid="pv-project-section-new-conv-alpha"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-testid="pv-mock-nsd-fire-birth"]') as HTMLElement);

    // Flush the setSessionProject().then(refreshIdentities) microtask chain.
    await Promise.resolve();
    await Promise.resolve();

    expect(refreshIdentitiesSpy).toHaveBeenCalledTimes(1);
    // Extra-map names the newborn identity + its host so the backend fanout
    // is guaranteed to include the target host in the identityHosts wire
    // parameter (birth flow's own precedent — NewSessionDialog:832).
    expect(refreshIdentitiesSpy).toHaveBeenCalledWith({ wren: 1 });
  });

  it("Test 9f (M-H): plain path does NOT trigger refreshIdentities (no identity to refresh)", async () => {
    setSnapshot({
      projectSections: [{ slug: "alpha", displayName: "Alpha", rows: [] }],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    fireEvent.click(container.querySelector('[data-testid="pv-project-section-new-conv-alpha"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-testid="pv-mock-nsd-fire-plain"]') as HTMLElement);

    await Promise.resolve();
    await Promise.resolve();

    // No project write happened (Test 9d), so no refresh either.
    expect(refreshIdentitiesSpy).not.toHaveBeenCalled();
  });

  // ─── M-I: host tree filtered to project's host in project context ─────────
  it("Test 9g (M-I): opening dialog via SquarePen passes a SINGLE-host tree (picker auto-hides)", () => {
    // Simulate a multi-host fleet (2 hosts) so the picker would normally show.
    setSnapshot({
      projectSections: [{ slug: "alpha", displayName: "Alpha", rows: [] }],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];
    const multiHostTree: HostFolder = {
      name: "root",
      children: [makeHost("1", "hostA"), makeHost("2", "hostB")],
    };

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={multiHostTree}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );
    fireEvent.click(container.querySelector('[data-testid="pv-project-section-new-conv-alpha"]') as HTMLElement);

    // Panel-side filter: tree passed to NewSessionDialog carries only 1 child
    // (the project's home host), regardless of the full fleet size.
    const nsdMock = container.querySelector('[data-testid="pv-mock-new-session-dialog"]');
    expect(nsdMock).not.toBeNull();
    expect(nsdMock!.getAttribute("data-hosttree-child-count")).toBe("1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 12 — project sections rendered in selector order (regression guard)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: project sections preserve selector order", () => {
  it("Test 11: DOM order matches the derived selector's projectSections order", () => {
    setSnapshot({
      projectSections: [
        { slug: "aaa", displayName: "AAA", rows: [] },
        { slug: "mmm", displayName: "MMM", rows: [] },
        { slug: "zzz", displayName: "ZZZ", rows: [] },
      ],
    });
    mockProjects = [
      { slug: "aaa", displayName: "AAA", hostId: "1", hostname: "hostA", archived: false },
      { slug: "mmm", displayName: "MMM", hostId: "1", hostname: "hostA", archived: false },
      { slug: "zzz", displayName: "ZZZ", hostId: "1", hostname: "hostA", archived: false },
    ];

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );

    const aaa = container.querySelector('[data-testid="pv-project-section-aaa"]');
    const mmm = container.querySelector('[data-testid="pv-project-section-mmm"]');
    const zzz = container.querySelector('[data-testid="pv-project-section-zzz"]');
    expect(aaa).not.toBeNull();
    expect(mmm).not.toBeNull();
    expect(zzz).not.toBeNull();
    // Order: aaa → mmm → zzz.
    expect(aaa!.compareDocumentPosition(mmm!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mmm!.compareDocumentPosition(zzz!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M-J: flat-middle section header — every zone besides pinned-unassigned has
// a visual header so the boundary between (project section last-row) and
// (flat middle first-row) is unambiguous. Renders only when displayedMiddle
// has rows (empty middle keeps the drop-out-of-project wrapper but no label).
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: flat-middle section header (M-J)", () => {
  it("Test 12 (M-J): renders 'Other' header above flat middle when middle is non-empty", () => {
    const middleRow = makeRow({ id: "middle-1", label: "flat-1" });
    setSnapshot({
      middle: [middleRow],
    });

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );

    const header = container.querySelector('[data-testid="pv-flat-middle-section-header"]');
    expect(header).not.toBeNull();
    expect(header!.textContent).toMatch(/other/i);
  });

  it("Test 12b (M-J): header omitted when flat middle has no rows (drop-only wrapper case)", () => {
    // Wrapper still renders for the drop-out-of-project affordance, but no
    // rows means no label needed.
    setSnapshot({
      middle: [],
      projectSections: [{ slug: "alpha", displayName: "Alpha", rows: [] }],
    });
    mockProjects = [
      { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "hostA", archived: false },
    ];

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={HOST_TREE}
        onCreateSession={() => {}}
        onDeactivateRow={() => {}}
      />,
    );

    // Wrapper exists (drop target), header does NOT.
    expect(
      container.querySelector('[data-testid="pv-panel-flat-middle"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="pv-flat-middle-section-header"]'),
    ).toBeNull();
  });
});
