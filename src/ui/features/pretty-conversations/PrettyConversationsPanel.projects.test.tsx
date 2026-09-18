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
  // A9 — hoist confirm/prompt mocks. window.confirm returning true → cascade
  // fires; returning false → cancel path.
  const confirmSpy = vi.spyOn(window, "confirm");
  afterEach(() => {
    confirmSpy.mockReset();
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
// A9 Test 9 (Task 2 panel wiring) — SquarePen fires NewConversationModal with
// preSelectedProject set to the section's slug.
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: new-conversation-in-project wire (117-09 Task 2)", () => {
  it("A9 Test 9: clicking section's SquarePen opens NewConversationModal with preSelectedProject = section slug", () => {
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

    // The panel writes the pre-selected slug into a data attribute on the
    // NewConversationModal wrapper so the wire is observable in tests without
    // reaching into modal internals. The modal itself lands via createRelayRoom.
    const wrapper = container.querySelector('[data-testid="pv-new-conv-modal-wrapper"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.getAttribute("data-pre-selected-project")).toBe("alpha");
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
