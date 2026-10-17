/**
 * Nested projects (shape-nested-projects-structure) — in-process tests that
 * drive the sidebar panel through the user paths: a sub-project renders inside
 * its parent above the parent's conversations, collapsing a parent hides the
 * subtree, the project menu's "New sub-project" and "Move to", dragging a
 * project header onto another project or the Projects header, archiving a
 * parent with its subtree, and project-name search revealing a subtree.
 *
 * Harness copied from PrettyConversationsPanel.projects.test.tsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  fireEvent,
  createEvent,
  cleanup,
  screen,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// jsdom does not implement ResizeObserver; stub it so Radix's DropdownMenu
// (used by RowKebabMenu, which backs the project section header's kebab)
// doesn't throw when the portal mounts.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// shape-sidebar-header-affordances: helper to open a project section header's
// kebab menu and click an item by name. Factored out because the old test
// pattern (fireEvent.contextMenu(header) + fireEvent.click(getByText(...)))
// no longer applies — right-click is retired on sidebar surfaces.
async function openProjectKebabAndClickItem(
  container: HTMLElement,
  slug: string,
  itemName: string,
): Promise<void> {
  const user = userEvent.setup();
  const trigger = container.querySelector(
    `[data-testid="pv-project-section-kebab-trigger-${slug}"]`,
  ) as HTMLElement | null;
  if (!trigger) {
    throw new Error(`kebab trigger not found for slug: ${slug}`);
  }
  await user.click(trigger);
  const item = screen.getByRole("menuitem", { name: itemName });
  await user.click(item);
}

// shape-sidebar-header-affordances task 6: helper to open a ROW's kebab menu
// (scoped to a specific row body) and click an item by name/regex. Parallel
// to openProjectKebabAndClickItem (which operates on section headers).
async function openRowKebabInBodyAndClickItem(
  body: HTMLElement,
  itemName: string | RegExp,
): Promise<void> {
  const user = userEvent.setup();
  const trigger = body.querySelector(
    '[data-testid="pv-row-kebab-trigger"]',
  ) as HTMLElement | null;
  if (!trigger) throw new Error("row kebab trigger not found in body");
  await user.click(trigger);
  const item = screen.getByRole("menuitem", { name: itemName });
  await user.click(item);
}

async function openRowKebabInBody(body: HTMLElement): Promise<HTMLElement> {
  const user = userEvent.setup();
  const trigger = body.querySelector(
    '[data-testid="pv-row-kebab-trigger"]',
  ) as HTMLElement | null;
  if (!trigger) throw new Error("row kebab trigger not found in body");
  await user.click(trigger);
  return screen.getByRole("menu");
}

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

const refreshIdentitiesSpy = vi.fn(async (_extra?: Record<string, number>) => true);

// Pin is offered only on identity rows; pin tests seed the identity here.
let mockIdentitiesByKey = new Map<string, { identityKey: string }>();
vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({
    byKey: mockIdentitiesByKey,
    byHostKey: new Map(),
    identities: [],
    loaded: true,
    refresh: async () => {},
  }),
  deriveDiskPinnedIds: () => [],
  buildIdentityHostsFromFleet: () => ({}),
  applyIdentityChange: () => {},
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
    hostId?: string;
    displayName: string;
    rows: MockRow[];
    parentKey?: string | null;
    depth?: number;
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
  parent?: string | null;
}[] = [];
const mergeProjectsForHostSpy = vi.fn();

const selectConversationSpy = vi.fn();
const addToActiveSetSpy = vi.fn();
const removeFromActiveSetSpy = vi.fn();
const pinConversationSpy = vi.fn();
const unpinConversationSpy = vi.fn();
const hydratePinnedIdsFromServerSpy = vi.fn();

let mockActiveSet: ReadonlySet<string> = new Set();
let mockFleetSessionsLoaded = true;

vi.mock("@/state/conversation-store", () => ({
  upsertFleetSession: () => {},
  patchRoomProjectAssignment: () => () => {},
  markPendingArchive: () => {},
  clearPendingArchive: () => {},
  removeFleetSession: () => {},
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
  getProjectsSnapshot: () => mockProjects,
  mergeProjectsForHost: (hostId: string, rows: unknown) =>
    mergeProjectsForHostSpy(hostId, rows),
  selectConversation: (id: string | null) => selectConversationSpy(id),
  pinConversation: (id: string) => pinConversationSpy(id),
  unpinConversation: (id: string) => unpinConversationSpy(id),
  addToActiveSet: (id: string) => addToActiveSetSpy(id),
  removeFromActiveSet: (id: string) => removeFromActiveSetSpy(id),
  fleetRowId: (hostId: number, sessionName: string) =>
    `fleet::${hostId}::${sessionName}`,
  hydratePinnedIdsFromServer: (ids: string[]) =>
    hydratePinnedIdsFromServerSpy(ids),
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
  (hostId: number, displayName: string, parent?: string | null) => Promise<{ ok: true; slug: string }>
>(async (_hostId, name) => ({
  ok: true as const,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
}));
const getArchivePreflightSpy = vi.fn(async (_hostId: number, _slug: string) => ({ hiddenSubProjects: 0 }));
const archiveProjectSpy = vi.fn<
  (hostId: number, slug: string) => Promise<{ ok: true }>
>(async () => ({ ok: true as const }));
const getProjectFileSpy = vi.fn<
  (hostId: number, slug: string) => Promise<{ markdown: string }>
>(async () => ({ markdown: "---\ndisplayName: Alpha\n---\n" }));
const updateProjectFileSpy = vi.fn<
  (hostId: number, slug: string, contents: string) => Promise<{ markdown: string }>
>(async (_h, _s, contents) => ({ markdown: contents }));
const setProjectParentSpy = vi.fn<
  (hostId: number, slug: string, parent: string | null) => Promise<{ ok: true }>
>(async () => ({ ok: true as const }));
vi.mock("@/api/project-list-api", () => ({
  createProject: (hostId: number, displayName: string, parent?: string | null) =>
    createProjectSpy(hostId, displayName, parent),
  setProjectParent: (hostId: number, slug: string, parent: string | null) =>
    setProjectParentSpy(hostId, slug, parent),
  archiveProject: (hostId: number, slug: string) =>
    archiveProjectSpy(hostId, slug),
  getArchivePreflight: (hostId: number, slug: string) =>
    getArchivePreflightSpy(hostId, slug),
  getProjectFile: (hostId: number, slug: string) =>
    getProjectFileSpy(hostId, slug),
  updateProjectFile: (hostId: number, slug: string, contents: string) =>
    updateProjectFileSpy(hostId, slug, contents),
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
  setIdentityPinned: vi.fn().mockResolvedValue(undefined),
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

// Phase 137 D-29: GlobalFilesModal retired — mock removed.

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
// synthetic-fire buttons carry testids that map 1:1 to the two
// NewSessionOnCreateOpts variants (identityMode false / true).
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
  mockIdentitiesByKey = new Map();
  cleanup();
  vi.clearAllMocks();
  setSnapshot({});
  mockCollapsed = new Set();
  mockProjects = [];
  mockActiveSet = new Set();
  mockFleetSessionsLoaded = true;
  localStorage.removeItem("pv-projects-section-collapsed");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixture: one host with a tree
//   SKYNET            rows: s-row
//     Design          rows: d-row
//       UI            (empty)
//     Ops             rows: o-row, room
//   Other             (empty)
// Sections arrive in tree order with resolved parentKey/depth, as the store
// emits them.
// ─────────────────────────────────────────────────────────────────────────────

const hostA = makeHost("1", "hostA");
const sRow = makeRow({ id: "s-row", label: "s-agent", host: hostA, targetTmuxSession: "s-agent" });
const dRow = makeRow({ id: "d-row", label: "d-agent", host: hostA, targetTmuxSession: "d-agent" });
const oRow = makeRow({ id: "o-row", label: "o-agent", host: hostA, targetTmuxSession: "o-agent" });
const roomRow = makeRow({
  id: "room-row",
  label: "ops-room",
  host: undefined,
  targetTmuxSession: null,
  kind: "relay-room",
  roomId: "!room:matrix.example",
  roomTitle: "ops-room",
});

function seedTree(): void {
  setSnapshot({
    projectSections: [
      { slug: "skynet", hostId: "1", displayName: "SKYNET", rows: [sRow], parentKey: null, depth: 0 },
      { slug: "design", hostId: "1", displayName: "Design", rows: [dRow], parentKey: "1::skynet", depth: 1 },
      { slug: "ui", hostId: "1", displayName: "UI", rows: [], parentKey: "1::design", depth: 2 },
      { slug: "ops", hostId: "1", displayName: "Ops", rows: [oRow, roomRow], parentKey: "1::skynet", depth: 1 },
      { slug: "other", hostId: "1", displayName: "Other", rows: [], parentKey: null, depth: 0 },
    ],
  });
  mockProjects = [
    { slug: "skynet", displayName: "SKYNET", hostId: "1", hostname: "hostA", archived: false, parent: null },
    { slug: "design", displayName: "Design", hostId: "1", hostname: "hostA", archived: false, parent: "skynet" },
    { slug: "ui", displayName: "UI", hostId: "1", hostname: "hostA", archived: false, parent: "design" },
    { slug: "ops", displayName: "Ops", hostId: "1", hostname: "hostA", archived: false, parent: "skynet" },
    { slug: "other", displayName: "Other", hostId: "1", hostname: "hostA", archived: false, parent: null },
  ];
}

function renderPanel(variant: "desktop" | "mobile" = "desktop") {
  return render(
    <PrettyConversationsPanel
      variant={variant}
      hostTree={HOST_TREE}
      onCreateSession={() => {}}
      onDeactivateRow={() => {}}
    />,
  );
}

const sectionEl = (c: HTMLElement, slug: string) =>
  c.querySelector(`[data-testid="pv-project-section-${slug}"]`) as HTMLElement | null;
const contentEl = (c: HTMLElement, slug: string) =>
  c.querySelector(`#pv-project-section-content-${slug}`) as HTMLElement | null;

async function openProjectMoveTo(container: HTMLElement, slug: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(
    container.querySelector(`[data-testid="pv-project-section-kebab-trigger-${slug}"]`) as HTMLElement,
  );
  await user.click(screen.getByRole("menuitem", { name: "Move to" }));
  const menus = await screen.findAllByRole("menu");
  return menus[menus.length - 1];
}

describe("nested projects: sidebar tree", () => {
  it("renders sub-projects inside their parent, above the parent's own conversations, at any depth", () => {
    seedTree();
    const { container } = renderPanel();
    const skynetContent = contentEl(container, "skynet")!;
    const design = sectionEl(container, "design")!;
    expect(skynetContent.contains(design)).toBe(true);
    expect(contentEl(container, "design")!.contains(sectionEl(container, "ui"))).toBe(true);
    expect(skynetContent.contains(sectionEl(container, "ops"))).toBe(true);
    // Other stays at top level.
    expect(skynetContent.contains(sectionEl(container, "other"))).toBe(false);
    // Sub-projects come before SKYNET's own row.
    const sRowEl = skynetContent.querySelector('[data-conversation-id="s-row"]')!;
    expect(sRowEl).not.toBeNull();
    expect(design.compareDocumentPosition(sRowEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The empty-state hint shows for a project with no rows AND no sub-projects only.
    expect(contentEl(container, "ui")!.textContent).toContain("Create a new conversation");
    expect(within(skynetContent).queryAllByTestId("pretty-conversations-project-empty")).toHaveLength(1);
  });

  it("collapsing a parent hides its whole subtree; siblings elsewhere stay", () => {
    seedTree();
    mockCollapsed = new Set(["skynet"]);
    const { container } = renderPanel();
    expect(sectionEl(container, "skynet")).not.toBeNull();
    expect(sectionEl(container, "design")).toBeNull();
    expect(sectionEl(container, "ui")).toBeNull();
    expect(sectionEl(container, "other")).not.toBeNull();
  });

  it("a section whose parent isn't present renders at top level", () => {
    setSnapshot({
      projectSections: [
        { slug: "orphan", hostId: "1", displayName: "Orphan", rows: [], parentKey: "1::gone", depth: 1 },
      ],
    });
    mockProjects = [
      { slug: "orphan", displayName: "Orphan", hostId: "1", hostname: "hostA", archived: false, parent: "gone" },
    ];
    const { container } = renderPanel();
    expect(sectionEl(container, "orphan")).not.toBeNull();
  });
});

describe("nested projects: project menu", () => {
  it("Move to lists Top level plus eligible parents, indented, without the project's own subtree", async () => {
    seedTree();
    const { container } = renderPanel();
    const menu = await openProjectMoveTo(container, "design");
    const labels = within(menu).getAllByRole("menuitem").map((el) => el.textContent?.trim());
    expect(labels).toEqual(["Top level", "SKYNET", "Ops", "Other"]);
    // Current parent carries the checkmark (an svg in the item).
    const skynetItem = within(menu).getByRole("menuitem", { name: "SKYNET" });
    expect(skynetItem.querySelector("svg")).not.toBeNull();
  });

  it("picking a project from Move to re-parents it (optimistic patch + write)", async () => {
    seedTree();
    const { container } = renderPanel();
    const menu = await openProjectMoveTo(container, "design");
    await userEvent.setup().click(within(menu).getByRole("menuitem", { name: "Other" }));
    expect(setProjectParentSpy).toHaveBeenCalledWith(1, "design", "other");
    const [hostId, rows] = mergeProjectsForHostSpy.mock.calls[0] as [string, Array<{ slug: string; parent?: string | null }>];
    expect(hostId).toBe("1");
    expect(rows.find((r) => r.slug === "design")?.parent).toBe("other");
  });

  it("Move to → Top level un-nests it", async () => {
    seedTree();
    const { container } = renderPanel();
    const menu = await openProjectMoveTo(container, "ui");
    await userEvent.setup().click(within(menu).getByRole("menuitem", { name: "Top level" }));
    expect(setProjectParentSpy).toHaveBeenCalledWith(1, "ui", null);
  });

  it("a failed move restores the previous list and says why", async () => {
    seedTree();
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    setProjectParentSpy.mockRejectedValueOnce(new Error("parent project not found"));
    // After the optimistic patch the store would show the new parent.
    mergeProjectsForHostSpy.mockImplementationOnce((_h: string, rows: typeof mockProjects) => {
      mockProjects = rows;
    });
    const { container } = renderPanel();
    const menu = await openProjectMoveTo(container, "design");
    await userEvent.setup().click(within(menu).getByRole("menuitem", { name: "Other" }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const lastRows = mergeProjectsForHostSpy.mock.calls.at(-1)![1] as Array<{ slug: string; parent?: string | null }>;
    expect(lastRows.find((r) => r.slug === "design")?.parent).toBe("skynet");
    expect(alertSpy.mock.calls[0][0]).toContain("parent project not found");
  });

  it("New sub-project creates the project inside the parent on the parent's host", async () => {
    seedTree();
    const { container } = renderPanel();
    await openProjectKebabAndClickItem(container, "skynet", "New sub-project");
    const dialog = await screen.findByTestId("create-project-modal");
    expect(within(dialog).getByText("New sub-project")).toBeTruthy();
    const user = userEvent.setup();
    await user.type(within(dialog).getByRole("textbox"), "Research");
    await user.click(within(dialog).getByRole("button", { name: /create/i }));
    await waitFor(() =>
      expect(createProjectSpy).toHaveBeenCalledWith(1, "Research", "skynet"),
    );
  });
});

describe("nested projects: archive takes the subtree", () => {
  it("confirm names the project and counts sub-projects, agents and rooms; folders move deepest first; every member handled", async () => {
    seedTree();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { archiveIdentity } = await import("@/api/identity-archive-api");
    const { container } = renderPanel();
    await openProjectKebabAndClickItem(container, "skynet", "Archive project");
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(confirmSpy).toHaveBeenCalledWith(
      'Archive "SKYNET"?\n\nThis also archives its 3 sub-projects and the 3 agents across them.\n\n1 relay room will move back to Conversations.\n\nThis can\'t be undone. Move conversations out first to keep them.',
    );
    await waitFor(() => expect(archiveProjectSpy).toHaveBeenCalledTimes(4));
    expect(archiveProjectSpy.mock.calls.map((c) => c[1])).toEqual(["ops", "ui", "design", "skynet"]);
    await waitFor(() => expect(archiveIdentity).toHaveBeenCalledTimes(3));
    expect(setRelayRoomProjectSpy).toHaveBeenCalledWith("!room:matrix.example", "@user:matrix.example", null);
    // Other is untouched.
    expect(archiveProjectSpy.mock.calls.some((c) => c[1] === "other")).toBe(false);
  });

  it("refuses up front when a sub-project inside is hidden from the user", async () => {
    seedTree();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    getArchivePreflightSpy.mockResolvedValueOnce({ hiddenSubProjects: 2 });
    const { container } = renderPanel();
    await openProjectKebabAndClickItem(container, "skynet", "Archive project");
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(getArchivePreflightSpy).toHaveBeenCalledWith(1, "skynet");
    expect(alertSpy.mock.calls[0][0]).toBe(
      'Can\'t archive "SKYNET": 2 sub-projects inside it are hidden from you. Nothing was archived.',
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(archiveProjectSpy).not.toHaveBeenCalled();
  });

  it("cancelling the confirm archives nothing", async () => {
    seedTree();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { container } = renderPanel();
    await openProjectKebabAndClickItem(container, "design", "Archive project");
    expect(archiveProjectSpy).not.toHaveBeenCalled();
  });

  it("a folder move failing part-way stops, archives only members of moved projects, and says so", async () => {
    seedTree();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const { archiveIdentity } = await import("@/api/identity-archive-api");
    // ops moves, ui fails.
    archiveProjectSpy
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("disk full"));
    const { container } = renderPanel();
    await openProjectKebabAndClickItem(container, "skynet", "Archive project");
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(archiveProjectSpy.mock.calls.map((c) => c[1])).toEqual(["ops", "ui"]);
    expect(alertSpy.mock.calls[0][0]).toContain("1 project beneath it was archived");
    // Only o-row (in ops) is archived; the room in ops is released.
    await waitFor(() => expect(archiveIdentity).toHaveBeenCalledTimes(1));
    expect(setRelayRoomProjectSpy).toHaveBeenCalledWith("!room:matrix.example", "@user:matrix.example", null);
  });
});

describe("nested projects: dragging a project header", () => {
  function dragHeader(container: HTMLElement, slug: string) {
    const dt = makeDataTransferStub();
    const header = container.querySelector(`[data-testid="pv-project-section-header-${slug}"]`) as HTMLElement;
    expect(header.getAttribute("draggable")).toBe("true");
    fireEvent.dragStart(header, { dataTransfer: dt });
    return dt;
  }

  it("dropping on another project nests it there", () => {
    seedTree();
    const { container } = renderPanel();
    const dt = dragHeader(container, "design");
    const other = sectionEl(container, "other")!;
    dispatchDragOverAt(other, 1, 1, dt);
    expect(container.querySelector('[data-testid="pv-project-drop-overlay-other"]')).not.toBeNull();
    dispatchDrop(other, dt);
    expect(setProjectParentSpy).toHaveBeenCalledWith(1, "design", "other");
  });

  it("its own subtree never lights up — not even the ancestor around it — and a drop there does nothing", () => {
    seedTree();
    const { container } = renderPanel();
    const dt = dragHeader(container, "design");
    const ui = sectionEl(container, "ui")!;
    dispatchDragOverAt(ui, 1, 1, dt);
    expect(container.querySelector('[data-testid="pv-project-drop-overlay-ui"]')).toBeNull();
    expect(container.querySelector('[data-testid="pv-project-drop-overlay-design"]')).toBeNull();
    expect(container.querySelector('[data-testid="pv-project-drop-overlay-skynet"]')).toBeNull();
    dispatchDrop(ui, dt);
    expect(setProjectParentSpy).not.toHaveBeenCalled();
  });

  it("moving from a lit ancestor into the dragged project's own subtree turns the ancestor's highlight off", () => {
    seedTree();
    const { container } = renderPanel();
    const dt = dragHeader(container, "design");
    dispatchDragOverAt(sectionEl(container, "skynet")!, 1, 1, dt);
    expect(container.querySelector('[data-testid="pv-project-drop-overlay-skynet"]')).not.toBeNull();
    dispatchDragOverAt(sectionEl(container, "ui")!, 1, 1, dt);
    expect(container.querySelector('[data-testid="pv-project-drop-overlay-skynet"]')).toBeNull();
  });

  it("dropping on the Projects header returns it to top level", () => {
    seedTree();
    const { container } = renderPanel();
    const dt = dragHeader(container, "ui");
    const superHeader = container.querySelector('[data-testid="pv-projects-super-header"]') as HTMLElement;
    dispatchDragOverAt(superHeader, 1, 1, dt);
    dispatchDrop(superHeader, dt);
    expect(setProjectParentSpy).toHaveBeenCalledWith(1, "ui", null);
  });

  it("a conversation dropped inside a sub-project lands in the innermost project", () => {
    seedTree();
    const { container } = renderPanel();
    const dt = makeDataTransferStub({
      "application/x-skynet-row": JSON.stringify({
        id: "s-row",
        host: { id: "1" },
        targetTmuxSession: "s-agent",
        identityKey: "s-agent",
      }),
    });
    const ui = sectionEl(container, "ui")!;
    dispatchDragOverAt(ui, 1, 1, dt);
    dispatchDrop(ui, dt);
    expect(setSessionProjectSpy).toHaveBeenCalledWith(1, "s-agent", "ui");
  });

  it("on a phone, project headers aren't draggable (Move to is the way)", () => {
    seedTree();
    const { container } = renderPanel("mobile");
    const header = container.querySelector('[data-testid="pv-project-section-header-design"]') as HTMLElement;
    expect(header.getAttribute("draggable")).toBeNull();
  });
});

describe("nested projects: conversation Move to mirrors the tree", () => {
  it("indents sub-projects in a conversation's Move to list", async () => {
    seedTree();
    setSnapshot({
      ...snapshot,
      middle: [makeRow({ id: "loose", label: "loose-agent", host: hostA, targetTmuxSession: "loose-agent" })],
    });
    const { container } = renderPanel();
    const loose = container.querySelector('[data-conversation-id="loose"]') as HTMLElement;
    const user = userEvent.setup();
    await user.click(loose.querySelector('[data-testid="pv-row-kebab-trigger"]') as HTMLElement);
    await user.click(screen.getByRole("menuitem", { name: "Move to" }));
    const ui = await screen.findByTestId("pv-row-kebab-item-move-to-ui");
    const skynet = screen.getByTestId("pv-row-kebab-item-move-to-skynet");
    const indentOf = (el: HTMLElement) =>
      parseInt((el.querySelector('span[style]') as HTMLElement | null)?.style.width ?? "0", 10);
    expect(indentOf(skynet)).toBe(0);
    expect(indentOf(ui)).toBe(24);
  });
});

describe("nested projects: search by project name", () => {
  it("a name match shows the project, its subtree and all their conversations, with ancestors as the path", () => {
    seedTree();
    const { container } = renderPanel();
    const input = container.querySelector('[data-testid="pv-sidebar-search-input"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "design" } });
    expect(sectionEl(container, "skynet")).not.toBeNull(); // path
    expect(sectionEl(container, "design")).not.toBeNull();
    expect(sectionEl(container, "ui")).not.toBeNull(); // subtree, though empty
    expect(sectionEl(container, "ops")).toBeNull();
    expect(sectionEl(container, "other")).toBeNull();
    expect(container.querySelector('[data-conversation-id="d-row"]')).not.toBeNull();
    // SKYNET is only the path — its own row doesn't match "design".
    expect(container.querySelector('[data-conversation-id="s-row"]')).toBeNull();
  });
});

describe("nested projects: getting out of a hand-edited loop from the menu", () => {
  it("a looped project (drawn at top level) can be cleared with Move to → Top level", async () => {
    // a ↔ b: both drawn at top level, both files name a parent.
    setSnapshot({
      projectSections: [
        { slug: "a", hostId: "1", displayName: "A", rows: [], parentKey: null, depth: 0 },
        { slug: "b", hostId: "1", displayName: "B", rows: [], parentKey: null, depth: 0 },
      ],
    });
    mockProjects = [
      { slug: "a", displayName: "A", hostId: "1", hostname: "hostA", archived: false, parent: "b" },
      { slug: "b", displayName: "B", hostId: "1", hostname: "hostA", archived: false, parent: "a" },
    ];
    const { container } = renderPanel("mobile");
    const menu = await openProjectMoveTo(container, "a");
    const top = within(menu).getByRole("menuitem", { name: "Top level" });
    // The file names b, so Top level is not the current place…
    expect(top.querySelector("svg")).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "B" }).querySelector("svg")).not.toBeNull();
    // …and choosing it clears the parent line.
    await userEvent.setup().click(top);
    expect(setProjectParentSpy).toHaveBeenCalledWith(1, "a", null);
  });

  it("a project whose parent is gone can be cleared with Top level too", async () => {
    setSnapshot({
      projectSections: [
        { slug: "orphan", hostId: "1", displayName: "Orphan", rows: [], parentKey: null, depth: 0 },
      ],
    });
    mockProjects = [
      { slug: "orphan", displayName: "Orphan", hostId: "1", hostname: "hostA", archived: false, parent: "gone" },
    ];
    const { container } = renderPanel();
    const menu = await openProjectMoveTo(container, "orphan");
    await userEvent.setup().click(within(menu).getByRole("menuitem", { name: "Top level" }));
    expect(setProjectParentSpy).toHaveBeenCalledWith(1, "orphan", null);
  });
});
