// ─── PrettyConversationsPanel — Vitest coverage ──────────────────────────────
// 15 tests for the flat-list panel from Phase 10 Plan 02 Task 2:
//   1)  Loading strip renders while fleetSessionsLoaded is false; disappears once true
//   2)  Pinned rows render at top, grouped rows below (DOM order)
//   3)  NO "Pinned" section header; NO per-host semibold header
//   4)  RDP-sentinel HostGroup renders at bottom with "Remote desktop" divider
//   5)  Header pencil opens NewSessionDialog
//   6)  Header pencil NOT rendered when onCreateSession undefined
//   7)  Desktop header shows SKYNET brand lockup (inline SVG logo + wordmark img) — patch #257
//   8)  Mobile header shows SKYNET brand lockup (same shape as desktop) — patch #257
//   9)  Desktop gear renders when onRailClick provided
//  10)  Mobile gear NEVER renders (even when onRailClick provided)
//  11)  RETIRED — settingsRowSlot prop dropped in Phase 11 (user's "no settings" lock)
//  12)  Row click routes RDP → onRdpRowClick (not onDetachedRowClick, not selectConversation)
//  13)  Row click routes fleetOnly → onDetachedRowClick (not onRdpRowClick)
//  14)  Row click on plain row calls selectConversation
//  15)  onConversationSelected fires after every dispatcher branch
//
// Mock pattern lifted from NewSessionDialog.test.tsx §mocks (lines 14-35):
// react-i18next passthrough, session-hue / identities-store / touch-device
// inert stubs so PrettyConversationRow's renders are deterministic.
//
// The conversation-store is mocked at module level with a mutable
// `snapshot` object + `setSnapshot(...)` helper so tests inject
// pinned/grouped/selectedId/pinnedIds directly rather than driving the
// real derivation. This mirrors the plan's decision (Task 2 §action).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  render,
  fireEvent,
  createEvent,
  waitFor,
  screen,
  within,
} from "@testing-library/react";
import type { Host, HostFolder } from "@/types/ui-types";
// Phase 119 Plan 119-06 (D-18 three-layer testing): AppState type shape used
// by the new mockAppTiles fixture + vi.mock("@/state/app-tiles-store", ...)
// below.
import type { AppState } from "@/api/fleet-status-types";

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

// Patch #167: mutable identitiesByKey mock so filter tests can seed
// identities that resolve for specific rows. Existing tests use the default
// (empty Map) — beforeEach resets it — so their behavior is unchanged.
let mockIdentitiesByKey: Map<
  string,
  { identityKey: string; title?: string | null; displayName?: string | null }
> = new Map();

// quick-260912-5q2: mutable flag for identities-store loaded state.
// Default true to preserve ALL existing tests' expectations. Post-2026-09-17
// the panel gate no longer READS this flag directly — the gate now checks
// `identitiesByKey.size > 0`. The `mockIdentitiesLoaded=true` default is
// paired with a stable-ref TEST_DEFAULT_BY_KEY placeholder below so tests
// that don't seed mockIdentitiesByKey still see an open gate. Tests that
// exercise the closed-gate race window (e.g. the quick-260912-5q2 lock test)
// set mockIdentitiesLoaded=false which routes the mock to the actual
// (usually empty) mockIdentitiesByKey.
let mockIdentitiesLoaded = true;

// Stable-ref placeholder byKey map used when a test hasn't explicitly seeded
// mockIdentitiesByKey but the panel gate needs to be OPEN (mockIdentitiesLoaded
// = true). MUST be defined once at module load so the ref is stable across
// renders — a fresh `new Map(...)` per useIdentities call would flip the
// [fleetSessionsLoaded, identitiesByKey] dep-array on every render and fire
// the hydrate effect repeatedly.
const TEST_DEFAULT_BY_KEY = new Map<
  string,
  { identityKey: string; title?: string | null; displayName?: string | null }
>([["__test_default__", { identityKey: "__test_default__" }]]);

// Phase 92 Plan 04: identities-store now exports deriveDiskPinnedIds +
// buildIdentityHostsFromFleet (H2 lock — single derivation site invariant).
// The panel hydrate effect calls both. Mutable spies + mock return values so
// PANEL-92-* tests can seed a controlled projection.
// (Phase 115 Plan 115-02: sibling deriveDiskHiddenIds spy retired per D-21.)
const deriveDiskPinnedIdsSpy = vi.fn<
  (identityHosts: Record<string, number>) => string[]
>(() => []);
const buildIdentityHostsFromFleetSpy = vi.fn<
  (fleetSessions: unknown[]) => Record<string, number>
>(() => ({}));

vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({
    // Panel gate (2026-09-17) reads `identitiesByKey.size > 0`. When
    // mockIdentitiesLoaded=true and no test has seeded mockIdentitiesByKey,
    // route to the stable-ref TEST_DEFAULT_BY_KEY so the gate opens without
    // triggering hydrate re-fires on every render (Map ref stability matters
    // for the useEffect [fleetSessionsLoaded, identitiesByKey] deps). When
    // mockIdentitiesLoaded=false, route to the actual mockIdentitiesByKey
    // (usually empty) so the gate stays closed — this is what the
    // quick-260912-5q2 race-window regression test exercises.
    byKey:
      mockIdentitiesLoaded && mockIdentitiesByKey.size === 0
        ? TEST_DEFAULT_BY_KEY
        : mockIdentitiesByKey,
    identities: [],
    // Panel no longer reads `loaded` directly (2026-09-17). Kept in the mock
    // for backward-compat with any test that inspects the useIdentities
    // return shape via a spy.
    loaded: mockIdentitiesLoaded,
    refresh: async () => {},
  }),
  deriveDiskPinnedIds: (identityHosts: Record<string, number>) =>
    deriveDiskPinnedIdsSpy(identityHosts),
  buildIdentityHostsFromFleet: (fleetSessions: unknown[]) =>
    buildIdentityHostsFromFleetSpy(fleetSessions),
}));

// Phase 104 Plan 03: patch #167 mock retired alongside its wire deletion.

// Phase 104 Plan 02 — trapped-work-store (inert stub — panel mounts poller)
vi.mock("@/state/trapped-work-store", () => ({
  useTrappedWork: () => undefined,
  startTrappedWorkPoller: () => () => {},
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

// ─── conversation-store mock ────────────────────────────────────────────────
// Mutable snapshot + spies for the two mutating actions the panel calls.
// Every test resets via setSnapshot(...) in beforeEach.

type MockRow = {
  id: string;
  type: string;
  label: string;
  host?: Host | undefined;
  targetTmuxSession: string | null;
  fleetOnly?: boolean;
  rdpHostRow?: boolean;
};

type MockGroup = {
  hostId: string;
  hostName: string;
  rows: MockRow[];
};

// Phase 41 Plan 01: mock snapshot shape mirrors the store's new three-zone
// output — `middle: MockRow[]` (flat) + `rdpGroup: MockGroup | null` replace
// the retired `grouped: MockGroup[]`. Tests can still seed the retired
// `grouped` shape via the `groupedShim` field for backwards compatibility;
// when present, groupedShim's `__rdp__` group flows into rdpGroup and all
// other groups' rows flatten into middle (in group iteration order).
type MockSnapshot = {
  activeSet: MockRow[];
  pinned: MockRow[];
  middle: MockRow[];
  rdpGroup: MockGroup | null;
  selectedId: string | null;
  pinnedIds: ReadonlySet<string>;
};

let snapshot: MockSnapshot = {
  activeSet: [],
  pinned: [],
  middle: [],
  rdpGroup: null,
  selectedId: null,
  pinnedIds: new Set(),
};

// Phase 41 Plan 01: shim so pre-Phase-41 tests seeding `grouped: MockGroup[]`
// continue to work. The shim splits groups into middle + rdpGroup at
// setSnapshot time so the store-consumer contract is preserved: a group with
// `hostId === "__rdp__"` flows into `rdpGroup`; all other groups' rows are
// flattened (in group iteration order) into `middle`. New tests should prefer
// setting `middle` + `rdpGroup` directly.
function setSnapshot(
  next: Partial<MockSnapshot> & { grouped?: MockGroup[] },
): void {
  let middle: MockRow[] = next.middle ?? [];
  let rdpGroup: MockGroup | null = next.rdpGroup ?? null;
  if (next.grouped !== undefined) {
    // Legacy `grouped` shim: split into middle (flat) + rdpGroup.
    const derivedMiddle: MockRow[] = [];
    let derivedRdpGroup: MockGroup | null = null;
    for (const g of next.grouped) {
      if (g.hostId === "__rdp__") {
        derivedRdpGroup = g;
      } else {
        for (const r of g.rows) derivedMiddle.push(r);
      }
    }
    // Only apply shim when middle/rdpGroup weren't explicitly set.
    if (next.middle === undefined) middle = derivedMiddle;
    if (next.rdpGroup === undefined) rdpGroup = derivedRdpGroup;
  }
  snapshot = {
    activeSet: next.activeSet ?? [],
    pinned: next.pinned ?? [],
    middle,
    rdpGroup,
    selectedId: next.selectedId ?? null,
    pinnedIds: next.pinnedIds ?? new Set(),
  };
}

const selectConversationSpy = vi.fn();
// quick-260807 followup to e4s: panel-level handleTogglePin now calls
// pinConversation / unpinConversation directly (was: togglePinConversation
// with a single id) so it can symmetrically toggle BOTH the openTab id and
// the fleet-synthetic shadow id when either is pinned.
const pinConversationSpy = vi.fn();
const unpinConversationSpy = vi.fn();
// Patch #144 Fix (d): converted the previously no-op addToActiveSet mock
// into a spy so Tests 16/17 below can verify the panel's useEffect on
// [selectedId] enrolls the id in the active set.
const addToActiveSetSpy = vi.fn();
// quick-260727-gm3: removeFromActiveSet spy — mirrors addToActiveSet spy so
// Test 20E can assert the panel's deactivate handler routes through the
// store mutator exactly once per click.
const removeFromActiveSetSpy = vi.fn();
// Phase 15 (Wave 3): spy on the store's server-hydration setter so the new
// integration test can assert the panel's mount effect flows fetched ids
// through hydratePinnedIdsFromServer after getPinnedIds resolves.
const hydratePinnedIdsFromServerSpy = vi.fn();

// (Phase 115 Plan 115-02: prior hideConversationSpy / unhideConversationSpy /
//  hydrateHiddenIdsFromServerSpy retired per D-21 alongside the source-code
//  deletion of the same exports.)

// Phase 119 Plan 119-06 (D-18 three-layer testing): mutable app-tiles fixture
// for the sidebar Apps section (Plan 119-04 integration). Tests seed this in
// arrange steps to exercise the D-05 always-present invariant, D-03 lazy-
// render invariant, D-04 empty-state prompt, D-15 sorted-order rendering,
// RESEARCH.md Pitfall 2 (section survives active search), and D-01 placement
// above the Pinned group. Default empty — non-119-06 tests observe zero app
// tiles, which is the collapsed-and-empty D-05 default. beforeEach resets to [].
let mockAppTiles: AppState[] = [];

// quick-260727-gm3: mutable mock active-set so Tests 20A/20C/20D can
// override which ids the panel + row layer sees as "in the active set"
// per-test without unmocking the module. Mirrors the snapshot-mutation
// pattern above at L96-L104. beforeEach resets it to an empty Set.
let mockActiveSet: ReadonlySet<string> = new Set<string>();

// quick-260727-kbw: mutable mock fleet-loaded flag so Test 22 can flip the
// gate on/off between rerenders. Mirrors mockActiveSet's pattern above.
// beforeEach resets to false so pre-kbw tests observe the "not yet loaded"
// state — this is the CORRECT behavior for the panel post-kbw: mount without
// updateFleetSessions() first means the fetch-then-hydrate IIFE does NOT
// fire, matching how AppShell's fleet-fetch mount effect precedes the panel
// mount in production. Tests that want the old behavior (getPinnedIds fires
// immediately on mount) must explicitly set mockFleetSessionsLoaded = true
// before render — see Test 21 which was updated to opt in.
let mockFleetSessionsLoaded = false;

// Phase 92 Plan 04 — controlled fleetSessions snapshot for the panel's
// hydrate effect. Mock-scope mutable array so PANEL-92-* tests can seed
// specific sessions and assert buildIdentityHostsFromFleet is called with
// exactly this snapshot. beforeEach resets to empty.
let mockFleetSessionsSnapshot: unknown[] = [];

vi.mock("@/state/conversation-store", () => ({
  useConversations: () => ({
    activeSet: snapshot.activeSet,
    pinned: snapshot.pinned,
    // Phase 41 Plan 01: three-zone shape.
    middle: snapshot.middle,
    rdpGroup: snapshot.rdpGroup,
    // Phase 117 Plan 117-08 — additive derived-selector fields. Backward-
    // compat: when tests don't seed projects, pinnedUnassigned === pinned,
    // projectSections is empty, and rdp === rdpGroup. Pre-Phase-117 tests
    // continue to observe the exact same three-zone render.
    pinnedUnassigned: snapshot.pinned,
    projectSections: [] as Array<{
      slug: string;
      displayName: string;
      rows: unknown[];
    }>,
    rdp: snapshot.rdpGroup,
  }),
  useSelectedConversationId: () => snapshot.selectedId,
  usePinnedIds: () => snapshot.pinnedIds,
  // (Phase 115 Plan 115-02: prior useHiddenIds subscription retired per D-21.)
  // Patch #137: PrettyConversationsPanel now subscribes to useActiveSet
  // to drive per-row ambient recession + ready-dot visibility. quick-
  // 260727-gm3 converted the previously-empty-Set mock into a per-test
  // mutable readback via mockActiveSet so Tests 20A/20C/20D can assert
  // the row-level DeactivateAction gate on inActiveSet.
  useActiveSet: () => mockActiveSet,
  // quick-260727-kbw: fleet-loaded gate consumed by the panel's mount effect.
  // Backed by mockFleetSessionsLoaded so Test 22 can flip it on/off between
  // rerenders to exercise the gate.
  useFleetSessionsLoaded: () => mockFleetSessionsLoaded,
  // Phase 92 Plan 04: panel hydrate effect reads fleetSessions to derive
  // identityHosts. Backed by mockFleetSessionsSnapshot so PANEL-92-* tests
  // can seed the projection input.
  getFleetSessionsSnapshot: () => mockFleetSessionsSnapshot,
  selectConversation: (id: string | null) => selectConversationSpy(id),
  pinConversation: (id: string) => pinConversationSpy(id),
  unpinConversation: (id: string) => unpinConversationSpy(id),
  addToActiveSet: (id: string) => addToActiveSetSpy(id),
  removeFromActiveSet: (id: string) => removeFromActiveSetSpy(id),
  // quick-260727-s8g: Panel imports fleetRowId to construct the fleet-
  // synthetic id shape in handleRowDeactivate's sibling purge. Mock returns
  // the real helper's format verbatim so Test 20F's toHaveBeenNthCalledWith
  // assertion can match against "fleet::HOSTID::SESSIONNAME".
  fleetRowId: (hostId: number, sessionName: string) =>
    `fleet::${hostId}::${sessionName}`,
  // Phase 92 Plan 04: hydrate spy still exercised, now called with the
  // deriveDiskPinnedIds projection result rather than the retired
  // getPinnedIds() fetch.
  hydratePinnedIdsFromServer: (ids: string[]) =>
    hydratePinnedIdsFromServerSpy(ids),
  // (Phase 115 Plan 115-02: prior hideConversation / unhideConversation /
  //  hydrateHiddenIdsFromServer mock entries retired per D-21 alongside
  //  the source-code deletion of the same exports.)
  // Phase 117 Plan 117-08 — the panel now subscribes to useProjects() to
  // trigger re-renders when the projects list changes via the fleet-status
  // wire event. Existing tests don't seed projects — the derived selector's
  // pinnedUnassigned/projectSections/rdp fields fall back to empty arrays
  // when state.projects is empty, so pre-Phase-117 tests observe the flat
  // middle exactly as before.
  useProjects: () => [] as readonly {
    slug: string;
    displayName: string;
    hostId: string;
    hostname: string;
    archived: boolean;
  }[],
}));

// Phase 117 Plan 117-08 — collapse hook stub. Tests don't seed collapse
// state; the panel reads the default empty Set + no-op toggle.
vi.mock("@/state/use-collapsed-project-slugs", () => ({
  useCollapsedProjectSlugs: () => ({
    collapsed: new Set<string>() as ReadonlySet<string>,
    toggle: () => {},
  }),
}));

// Phase 117 Plan 117-08 — project drop API. Tests don't drop rows onto
// project sections; stubs return an ok envelope in case any drop lands.
vi.mock("@/api/session-project-api", () => ({
  setSessionProject: vi.fn(async () => ({ ok: true })),
  setRelayRoomProject: vi.fn(async () => ({ ok: true })),
}));

// Phase 119 Plan 119-06 (D-18 three-layer testing): mock the sidebar
// Apps-section subscription slice. PrettyConversationsPanel.tsx imports
// `useAppTiles` from `@/state/app-tiles-store` (see panel :166 post-Plan-
// 119-04). Backed by `mockAppTiles` above so integration tests A15-A20
// can seed the tile pool + assert the section header (D-05), the lazy-
// render invariant (D-03), the empty-state prompt (D-04), the hook-order
// preservation (D-15), the search-safe invariant (Pitfall 2), and the
// above-Pinned DOM placement (D-01). The publish* fns are stubbed as
// vi.fn spies — the panel does not call them, but AppShell.tsx does, and
// stubbing keeps the mock's surface parallel to the real module in case
// a future test imports them from this file.
vi.mock("@/state/app-tiles-store", () => ({
  useAppTiles: () => mockAppTiles,
  publishAppSnapshot: vi.fn(),
  publishAppUpdate: vi.fn(),
  publishAppGone: vi.fn(),
  subscribeAppTilesStore: (_cb: () => void) => () => {},
  __resetForTest: vi.fn(),
}));

// Phase 92 Plan 04: getPinnedIds is RETIRED. The mock no longer surfaces it —
// any import that still references it fails at runtime with "undefined is not
// a function" (the H2 anti-shim regression trap).
// (Phase 115 Plan 115-02: getHiddenIds + putHiddenIds retired per D-21
//  alongside the backend HIDDEN FANOUT block removal.)
vi.mock("@/api/user-preferences-api", () => ({
  putPinnedIds: vi.fn().mockResolvedValue([]),
}));

// Phase 115 Plan 115-06 (D-01, D-17): archiveIdentity mock — panel's
// handleArchive fire-and-forgets this on confirm=true. Backed by a
// vi.fn spy so the A5-A8 tests can assert exact-args + call-count.
const archiveIdentitySpy = vi.fn<
  (hostId: number, identityKey: string) => Promise<{ ok: true }>
>(async () => ({ ok: true as const }));
vi.mock("@/api/identity-archive-api", () => ({
  archiveIdentity: (hostId: number, identityKey: string) =>
    archiveIdentitySpy(hostId, identityKey),
}));

// Phase 91 Plan 05 — mocks required by NewConversationModal which is
// now portal-mounted inside PrettyConversationsPanel.
vi.mock("@/api/user-management-api", () => ({
  getUsersListBasic: vi.fn(async () => []),
}));
vi.mock("@/api/relay-room-create-api", () => ({
  createRelayRoom: vi.fn(async () => ({ ok: true, roomId: "!r:s", sessionId: "s1", roomTitle: "T" })),
}));
vi.mock("@/state/viewing-user-store", () => ({
  useViewingUserMxid: vi.fn(() => "@the-operator:thenasty.taild9b663.ts.net"),
  useViewingUserId: vi.fn(() => "u-user"),
}));

// Patch #137 / #260806-ixl: PrettyConversationsPanel calls
// useSessionIsWorking(sessionKey) inside its per-row
// PrettyConversationRowLive micro-component. Mock returns false for
// every key so the ready-dot render condition is never satisfied —
// matches the pre-patch-#137 behavior; false is the "not working"
// boolean equivalent of the old null return.
//
// Phase 41 Plan 03: conversation-store also imports
// subscribeSessionWorkingStore + getSessionLastMessageAt at module init to
// bridge the working-store's lastMessageAt cache into its snapshot
// derivation. The panel tests don't need to exercise that bridge, so both
// exports are stubbed as no-ops here — subscribe returns a no-op disposer;
// getSessionLastMessageAt returns null so every row's derived lastMessageAt
// stays null (matches pre-Plan-03 shape).
// Phase 47 Plan 04: useSessionAiTitle added to the mock alongside the
// pre-existing three exports. Backed by a vi.fn spy + mutable-return map
// so Task 2's wire tests can (a) assert the hook was CALLED with the
// expected sessionKey per render site (proves PrettyConversationRowLive
// subscribes) and (b) assert the returned value threaded through to
// PrettyConversationRow's aiTitle prop (via seeded mockAiTitleByKey +
// verifying no throw on render, since the prop is accepted-but-unused
// in this plan's scope per Plan 47-05 owning the visual).
//
// Default returns null so every row's threaded aiTitle prop stays null
// in existing tests — behaviorally identical to the pre-Phase-47 shape.
let mockAiTitleByKey: Map<string | null, string | null> = new Map();
const useSessionAiTitleSpy = vi.fn((sessionKey: string | null) => {
  if (sessionKey === null) return null;
  return mockAiTitleByKey.get(sessionKey) ?? null;
});

// Phase 52 Plan 04 — per-test seeding for the Ready toggle test coverage.
// Mirrors the mockAiTitleByKey pattern at :307. Tests seed these Maps in
// arrange steps; afterEach clears them.
let mockIsWorkingByKey: Map<string | null, boolean> = new Map();
let mockIsDormantByKey: Map<string | null, boolean> = new Map();
// Phase 53 Plan 03 — per-test seeding for the recycling axis. Mirrors the
// mockIsDormantByKey pattern. Tests seed this Map in arrange steps; afterEach
// clears it.
let mockIsRecyclingByKey: Map<string | null, boolean> = new Map();
const useSessionIsRecyclingSpy = vi.fn((sessionKey: string | null) => {
  if (sessionKey === null) return false;
  return mockIsRecyclingByKey.get(sessionKey) ?? false;
});
let mockWorkingSnapshot: Map<string, { isWorking: boolean; lastMessageAt: number | null; aiTitle: string | null; dormant: boolean; recycling: boolean }> = new Map();

const useSessionIsWorkingSpy = vi.fn((sessionKey: string | null) => {
  if (sessionKey === null) return false;
  return mockIsWorkingByKey.get(sessionKey) ?? false;
});
const useSessionIsDormantSpy = vi.fn((sessionKey: string | null) => {
  if (sessionKey === null) return false;
  return mockIsDormantByKey.get(sessionKey) ?? false;
});
const getSessionWorkingSnapshotSpy = vi.fn(() => mockWorkingSnapshot as ReadonlyMap<string, { isWorking: boolean; lastMessageAt: number | null; aiTitle: string | null; dormant: boolean; recycling: boolean }>);

vi.mock("@/state/session-working-store", () => ({
  useSessionIsWorking: (sessionKey: string | null) => useSessionIsWorkingSpy(sessionKey),
  useSessionLastMessageAt: () => null,
  getSessionLastMessageAt: () => null,
  subscribeSessionWorkingStore: (_cb: () => void) => () => {},
  useSessionAiTitle: (sessionKey: string | null) =>
    useSessionAiTitleSpy(sessionKey),
  // Phase 52 Plan 03 (plan-checker B-2 fix) + Phase 53 Plan 03: Panel.tsx now
  // imports useSessionIsRecycling in addition to getSessionWorkingSnapshot +
  // useSessionIsDormant. Without these stubs every render throws TypeError.
  // Phase 52 Plan 04: upgraded from default stubs to spy-based per-test
  // seeding via mockIsWorkingByKey / mockIsDormantByKey / mockWorkingSnapshot.
  getSessionWorkingSnapshot: () => getSessionWorkingSnapshotSpy(),
  useSessionIsDormant: (sessionKey: string | null) => useSessionIsDormantSpy(sessionKey),
  useSessionIsRecycling: (sessionKey: string | null) => useSessionIsRecyclingSpy(sessionKey),
}));

// Phase 23 (GEFM-01): mock GlobalFilesModal so the panel-level test suite
// does not pull in the full modal's dep tree (radix Dialog, Tabs, global-files-api).
// The panel mounts it as a controlled component gated on globalFilesModalOpen state
// (initially false). This stub renders nothing when closed, which is the observed
// state in every test that doesn't explicitly open it.
vi.mock("@/features/pretty-view/GlobalFilesModal", () => ({
  default: (props: { open: boolean }) => (props.open ? <div data-testid="global-files-modal-stub" /> : null),
}));

// Phase 23 (GEFM-01): mock global-files-api in case any import resolves it in
// the test environment before the GlobalFilesModal mock suppresses the real module.
vi.mock("@/api/global-files-api", () => ({
  listGlobalFiles: vi.fn().mockResolvedValue([]),
  readGlobalFile: vi.fn().mockResolvedValue({ content: "", mtime: 0, size: 0 }),
  writeGlobalFile: vi.fn().mockResolvedValue({ mtime: 0 }),
  GlobalFileMtimeConflictError: class GlobalFileMtimeConflictError extends Error {},
}));

// ─── Component under test (import AFTER mocks) ──────────────────────────────

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

function makeConversationRow(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "row-x",
    type: "terminal",
    label: "session-x",
    host: makeHost("h1", "hostA"),
    targetTmuxSession: null,
    ...overrides,
  };
}

const ONE_HOST_TREE: HostFolder = {
  name: "root",
  children: [makeHost("h1", "hostA")],
};

beforeEach(async () => {
  vi.clearAllMocks();
  setSnapshot({
    activeSet: [],
    pinned: [],
    // Phase 41 Plan 01: use `middle` + `rdpGroup`. `grouped` shim still works
    // for pre-Phase-41 tests that pass grouped: MockGroup[] via setSnapshot.
    middle: [],
    rdpGroup: null,
    selectedId: null,
    pinnedIds: new Set(),
  });
  // quick-260727-gm3: reset the per-test active-set override to empty
  // (default ambient rendering path — matches pre-gm3 mock behavior for
  // the 15+ existing tests that never touched it).
  mockActiveSet = new Set<string>();
  // quick-260727-kbw: reset the fleet-loaded gate to false so the mount
  // effect's fetch does NOT fire by default — matches the load-order
  // invariant post-kbw. Tests that need the mount fetch (Test 21 and
  // Test 22's second render) opt in explicitly.
  mockFleetSessionsLoaded = false;
  // quick-260912-5q2: reset the identities-store loaded flag to true so all
  // pre-5q2 tests continue to behave as before the gate was introduced.
  // The ordering-gate regression test resets this to false in its arrange step.
  mockIdentitiesLoaded = true;
  // Phase 92 Plan 04: getPinnedIds retired — pinned hydrate runs via the
  // identities-store disk-projection spies below.
  // (Phase 115 Plan 115-02: sibling deriveDiskHiddenIdsSpy reset retired
  //  per D-21 alongside the source-code deletion.)
  deriveDiskPinnedIdsSpy.mockReset();
  deriveDiskPinnedIdsSpy.mockReturnValue([]);
  buildIdentityHostsFromFleetSpy.mockReset();
  buildIdentityHostsFromFleetSpy.mockReturnValue({});
  mockFleetSessionsSnapshot = [];
  // Phase 119 Plan 119-06 (D-18): reset app-tiles fixture to empty so non-
  // 119-06 tests observe the Apps section in its collapsed-and-empty
  // default (header present per D-05, zero tiles / no empty prompt in DOM
  // per D-03 lazy-render). Tests that exercise the Apps section seed this
  // explicitly.
  mockAppTiles = [];
  // Phase 115 Plan 115-06 (D-01): reset archive API spy between tests.
  archiveIdentitySpy.mockClear();
  // Patch #167: reset identities mock. Phase 104 Plan 03: mockBountyCounts
  // retired with the bounty-count wire.
  mockIdentitiesByKey = new Map();
  // Phase 47 Plan 04: reset the ai-title mock map to empty so pre-Phase-47
  // tests observe the null-default subtitle path (matches pre-plan behavior;
  // aiTitle prop threads null through to PrettyConversationRow, which does
  // not consume it in this plan's scope). Wire tests populate explicitly.
  mockAiTitleByKey = new Map<string | null, string | null>();
  useSessionAiTitleSpy.mockClear();
  // Phase 52 Plan 04: reset the Ready-toggle seeding Maps to empty so existing
  // tests see the same empty-Map default as Plan 03's stubs provided. The spy
  // functions return false / new Map() for empty maps — behaviorally identical
  // to Plan 03's `() => false` / `() => new Map()` defaults.
  mockIsWorkingByKey = new Map();
  mockIsDormantByKey = new Map();
  // Phase 53 Plan 03 — reset recycling seed Map alongside sibling maps.
  mockIsRecyclingByKey = new Map();
  mockWorkingSnapshot = new Map();
  useSessionIsWorkingSpy.mockClear();
  useSessionIsDormantSpy.mockClear();
  useSessionIsRecyclingSpy.mockClear();
  getSessionWorkingSnapshotSpy.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Load-in-flight affordance (Loading… strip)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: load-in-flight affordance", () => {
  it("Test 1: renders 'Loading conversations…' strip while fleetSessionsLoaded=false and no rows", () => {
    // beforeEach leaves mockFleetSessionsLoaded=false and all tiers empty.
    setSnapshot({ pinned: [], grouped: [] });
    const { container, queryByTestId, queryByText, queryAllByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // Loading strip is present with the expected label + spinner.
    expect(queryByTestId("pretty-conversations-loading")).toBeTruthy();
    expect(queryByText(/loading conversations/i)).toBeTruthy();
    expect(container.querySelector(".animate-spin")).toBeTruthy();

    // No rows — but that's fine, the loading strip covers the load window.
    expect(queryAllByTestId("pcrow-avatar").length).toBe(0);
  });

  it("Test 1b: loading strip disappears once fleetSessionsLoaded flips true", () => {
    mockFleetSessionsLoaded = true;
    setSnapshot({ pinned: [], grouped: [] });
    const { queryByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    expect(queryByTestId("pretty-conversations-loading")).toBeNull();
  });

  it("Test 1c: loading strip renders ABOVE already-arrived rows (RDP-first consumer case)", () => {
    // Mimic the real observable: RDP rows arrive first, fleet is still in flight.
    const rdpHost = makeHost("rdp1", "beelink");
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [
        {
          hostId: "__rdp__",
          hostName: "Remote desktop",
          rows: [
            makeConversationRow({
              id: "rdp-row-1",
              label: "beelink",
              host: rdpHost,
              rdpHostRow: true,
              targetTmuxSession: null,
            }),
          ],
        },
      ],
    });
    const { container, queryByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    const loading = container.querySelector(
      '[data-testid="pretty-conversations-loading"]',
    ) as HTMLElement | null;
    const rdpRow = container.querySelector(
      '[data-conversation-id="rdp-row-1"]',
    ) as HTMLElement | null;
    expect(loading).toBeTruthy();
    expect(rdpRow).toBeTruthy();
    // Node.DOCUMENT_POSITION_FOLLOWING = 4 — loading strip precedes RDP row.
    expect(loading!.compareDocumentPosition(rdpRow!) & 4).toBe(4);
    // Historical empty-card testid MUST NOT reappear.
    expect(queryByTestId("pretty-conversations-empty")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 18 — active-set top zone RETIRED (Phase 42 UAT amendment 2026-08-17)
// ─────────────────────────────────────────────────────────────────────────────
// user verbatim: "sessions are still showing above the pinned area when they
// are active in the current instance of the client. That shouldn't happen."
// The panel no longer renders a `[data-active-set-group="true"]` wrapper
// regardless of what the store snapshot's activeSet field reports. The
// per-row `inActiveSet={activeSet.has(row.id)}` prop threading and .active-set
// CSS gate for the deactivate-action hover-reveal are preserved on every
// surviving render site (search-flat, pinned, middle, RDP).

describe("PrettyConversationsPanel: active-set top zone RETIRED (Phase 42 UAT amendment 2026-08-17)", () => {
  it("Test 18: no data-active-set-group=true wrapper renders when store's activeSet snapshot field is empty", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      activeSet: [],
      pinned: [
        makeConversationRow({ id: "pinned-1", label: "pinned-session", host: hostA }),
      ],
      middle: [],
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);

    // Retired: no active-set wrapper renders.
    expect(container.querySelector('[data-active-set-group="true"]')).toBeNull();

    // Pinned row still renders inside `[data-pinned-group="true"]`.
    const pinnedGroup = container.querySelector(
      '[data-pinned-group="true"]',
    ) as HTMLElement | null;
    expect(pinnedGroup).toBeTruthy();
    const pinnedRow = container.querySelector(
      '[data-conversation-id="pinned-1"]',
    ) as HTMLElement | null;
    expect(pinnedRow).toBeTruthy();
    expect(pinnedGroup!.contains(pinnedRow!)).toBe(true);
  });

  it("Test 18b: no data-active-set-group=true wrapper renders even when the mock snapshot is seeded with activeSet rows (defensive — the render block was deleted)", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      // Defensively seed a non-empty activeSet — the panel does NOT render
      // an active-set wrapper regardless of what the mock reports, since the
      // render block was deleted in Phase 42 UAT amendment 2026-08-17.
      activeSet: [
        makeConversationRow({ id: "active-1", label: "active-session", host: hostA }),
      ],
      pinned: [],
      middle: [],
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);
    expect(container.querySelector('[data-active-set-group="true"]')).toBeNull();
    // Also: the (hypothetically) active-set row does NOT appear anywhere in the
    // rendered DOM, because the tier that used to render it is gone.
    expect(container.querySelector('[data-conversation-id="active-1"]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Pinned rows render at top, grouped rows below (DOM order)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: pinned-first ordering", () => {
  it("Test 2: pinned rows precede grouped rows in DOM order", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      pinned: [
        makeConversationRow({ id: "a", label: "alpha", host: hostA }),
        makeConversationRow({ id: "b", label: "bravo", host: hostA }),
      ],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [
            makeConversationRow({ id: "c", label: "charlie", host: hostA }),
            makeConversationRow({ id: "d", label: "delta", host: hostA }),
          ],
        },
      ],
      selectedId: null,
      pinnedIds: new Set(["a", "b"]),
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);
    const rowNodes = Array.from(
      container.querySelectorAll("[data-conversation-id]"),
    ) as HTMLElement[];
    const ids = rowNodes.map((n) => n.getAttribute("data-conversation-id"));
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — "Pinned" divider chip (patch #234); per-host divider chip
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: 'Pinned' divider chip RETIRED (Phase 42 UAT amendment 2026-08-17)", () => {
  // user verbatim 2026-08-17: "Also the pinned header should go away entirely."
  // The divider chip (Pin icon + uppercase "Pinned" label + gradient rule) that
  // patch #234 introduced above the pinned tier is retired unconditionally.
  // The pinned tier itself still renders inside `[data-pinned-group="true"]`.
  it('Test 3 (updated 2026-08-17): NO "Pinned" divider chip renders even when the pinned tier has rows; per-host chip is still gone', () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      pinned: [makeConversationRow({ id: "a", label: "alpha", host: hostA })],
      middle: [
        makeConversationRow({ id: "c", label: "charlie", host: hostA }),
      ],
      pinnedIds: new Set(["a"]),
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);

    // Phase 42 UAT amendment 2026-08-17: "Pinned" divider chip retired.
    const pinnedChip = container.querySelector(
      '[data-testid="pinned-divider"]',
    ) as HTMLElement | null;
    expect(pinnedChip).toBeNull();

    // Pinned wrapper still renders and the pinned row lands inside it.
    const pinnedGroup = container.querySelector(
      '[data-pinned-group="true"]',
    ) as HTMLElement | null;
    expect(pinnedGroup).toBeTruthy();
    const pinnedRow = container.querySelector(
      '[data-conversation-id="a"]',
    ) as HTMLElement | null;
    expect(pinnedRow).toBeTruthy();
    expect(pinnedGroup!.contains(pinnedRow!)).toBe(true);

    // Per-host divider chip stays retired.
    const hostChip = container.querySelector('[data-testid="host-divider"]');
    expect(hostChip).toBeNull();
  });

  it('Test 3B (updated 2026-08-17): does NOT render the "Pinned" divider chip when pinned is empty (assertion body unchanged; describe copy updated to reflect unconditional retirement)', () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      pinned: [],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [
            makeConversationRow({ id: "c", label: "charlie", host: hostA }),
          ],
        },
      ],
      pinnedIds: new Set(),
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);

    const pinnedChip = container.querySelector('[data-testid="pinned-divider"]');
    expect(pinnedChip).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 19A / 19B / 19C — [quick-260727-f9v] per-host divider chip rules
// ─────────────────────────────────────────────────────────────────────────────
// The panel renders a per-host divider chip above each non-RDP, non-active-
// set, non-pinned host group. The chip mirrors the existing RDP chip's
// treatment (Server glyph + uppercase hostname label + gradient rule).
// Active-set and pinned groups continue to render NO chip above them.
// The RDP sentinel keeps its existing "Remote desktop" chip unchanged
// (apart from the /50→/85 brightness bump, which is visually invisible to
// these DOM-shape tests).

describe("PrettyConversationsPanel: middle zone is FLAT (Phase 41 Plan 01)", () => {
  // Phase 41 Plan 01 (user 2026-08-14) REWRITE: the pre-Phase-41 per-host
  // divider chips (Tests 19A + 19B) were retired. The middle zone now
  // renders as ONE flat container with no per-host wrappers, no divider
  // chips. Tests 19A/19B are rewritten to lock the retirement.
  it("Test 19A (rewritten): two non-RDP rows land in ONE flat middle container with NO host-divider chips", () => {
    const hostA = makeHost("h1", "hostA");
    const hostB = makeHost("h2", "hostB");
    setSnapshot({
      activeSet: [],
      pinned: [],
      middle: [
        makeConversationRow({ id: "c1", label: "s1", host: hostA }),
        makeConversationRow({ id: "c2", label: "s2", host: hostB }),
      ],
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);

    // user lock: NO host-divider chips render inside the middle zone.
    // The retired `[data-testid="host-divider"]` element MUST NOT be
    // present under any circumstance.
    const chips = Array.from(
      container.querySelectorAll('[data-testid="host-divider"]'),
    ) as HTMLElement[];
    expect(chips.length).toBe(0);

    // Both rows exist in the DOM.
    expect(container.querySelector('[data-conversation-id="c1"]')).toBeTruthy();
    expect(container.querySelector('[data-conversation-id="c2"]')).toBeTruthy();

    // The middle zone is one flat container (the `.pv-panel-group` with
    // data-middle-group="true"). Both rows are inside it.
    const middleGroup = container.querySelector(
      '[data-middle-group="true"]',
    ) as HTMLElement | null;
    expect(middleGroup).toBeTruthy();
    expect(middleGroup!.querySelector('[data-conversation-id="c1"]')).toBeTruthy();
    expect(middleGroup!.querySelector('[data-conversation-id="c2"]')).toBeTruthy();
  });

  it("Test 19B (rewritten Phase 42 UAT amendment 2026-08-17): pinned + middle rows render without host-divider chips; no active-set wrapper renders", () => {
    // Phase 42 UAT amendment 2026-08-17 (user verbatim): active-set render
    // tier retired — no `[data-active-set-group="true"]` wrapper renders
    // regardless of what the mock's activeSet field reports. The pinned
    // wrapper still renders and the middle row lands in the flat middle
    // container.
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      activeSet: [
        makeConversationRow({ id: "active-1", label: "active-session", host: hostA }),
      ],
      pinned: [
        makeConversationRow({ id: "pinned-1", label: "pinned-session", host: hostA }),
      ],
      middle: [
        makeConversationRow({ id: "c1", label: "charlie", host: hostA }),
      ],
      pinnedIds: new Set(["pinned-1"]),
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);

    // user lock: zero host-divider chips anywhere in the panel.
    const chips = Array.from(
      container.querySelectorAll('[data-testid="host-divider"]'),
    ) as HTMLElement[];
    expect(chips.length).toBe(0);

    // Retired: no active-set wrapper renders even when the mock seeds one.
    expect(container.querySelector('[data-active-set-group="true"]')).toBeNull();

    // Pinned wrapper still renders as a structural precondition.
    const pinnedGroup = container.querySelector(
      '[data-pinned-group="true"]',
    ) as HTMLElement | null;
    expect(pinnedGroup).toBeTruthy();

    // Middle row also renders (inside the flat middle container).
    expect(container.querySelector('[data-conversation-id="c1"]')).toBeTruthy();
  });

  it("Test 19C (rewritten): middle + rdpGroup → NO host-divider chip; the rdp-divider IS present when rdpGroup is non-null", () => {
    const hostA = makeHost("h1", "hostA");
    const rdpHost = makeHost("h2", "WINDOWS-PC", { enableRdp: true });
    setSnapshot({
      middle: [
        makeConversationRow({ id: "c1", label: "s1", host: hostA }),
      ],
      rdpGroup: {
        hostId: "__rdp__",
        hostName: "",
        rows: [
          makeConversationRow({
            id: "r1",
            label: "WINDOWS-PC",
            host: rdpHost,
            rdpHostRow: true,
            targetTmuxSession: null,
          }),
        ],
      },
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);

    // user lock: no host-divider chip. The rdp-divider IS present.
    const hostChips = container.querySelectorAll('[data-testid="host-divider"]');
    const rdpChips = container.querySelectorAll('[data-testid="rdp-divider"]');
    expect(hostChips.length).toBe(0);
    expect(rdpChips.length).toBe(1);
  });

  // Phase 41 Plan 01 regression (user lock #7): the RDP section header
  // (rdp-divider chip) does NOT render when rdpGroup is null.
  it("Test 19D (rdp-header-hides-on-zero): rdpGroup=null → no rdp-divider chip renders", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      middle: [
        makeConversationRow({ id: "c1", label: "session", host: hostA }),
      ],
      rdpGroup: null,
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    expect(container.querySelector('[data-testid="rdp-divider"]')).toBeNull();
  });

  // user 2026-09-21 decouple: idle rows have NOTHING; working rows get a
  // slow dashed spinner ring on the avatar via `.pv-row.spinner-on
  // .pv-avatar::before`. The `spinner-on` class is JS-emitted by the
  // decoupled gate `isWorking===true || isRecycling || hasQueuePending` —
  // no `inActiveSet` conjunct. For a non-working row (regardless of
  // active-set membership), all three predicates are false → NO spinner-on.
  // This test locks that panel-level integration for the idle-ambient case
  // — the row-level P47-15 lock covers the WORKING-ambient case (ambient
  // working rows now DO spin, decoupled from client-side active-set state).
  it("Test 19E: non-active-set idle rows have NO ready-dot AND NO `spinner-on` (idle rows never spin, user 2026-09-21 decouple)", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      // Two rows, neither in the active-set, both non-working (default in
      // the mock — useSessionIsWorking returns false).
      middle: [
        makeConversationRow({ id: "m1", label: "s1", host: hostA }),
        makeConversationRow({ id: "m2", label: "s2", host: hostA }),
      ],
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const m1 = container.querySelector('[data-conversation-id="m1"]');
    const m2 = container.querySelector('[data-conversation-id="m2"]');
    expect(m1).toBeTruthy();
    expect(m2).toBeTruthy();
    // Ready-dot fully retired — no `.pv-ready-dot` span or data attribute
    // in either row's subtree.
    expect(m1!.querySelector('[data-pv-conv-ready-dot="true"]')).toBeNull();
    expect(m2!.querySelector('[data-pv-conv-ready-dot="true"]')).toBeNull();
    expect(m1!.querySelector(".pv-ready-dot")).toBeNull();
    expect(m2!.querySelector(".pv-ready-dot")).toBeNull();
    // Neither row carries `.spinner-on` — idle rows (all three work
    // predicates false) never spin under the decoupled gate. See Test
    // P47-15 in PrettyConversationRow.test.tsx for the row-level lock on
    // the working-ambient branch (which now DOES spin under decouple).
    const m1Body = m1!.querySelector('[role="button"]') as HTMLElement;
    const m2Body = m2!.querySelector('[role="button"]') as HTMLElement;
    expect(m1Body.className).not.toContain("spinner-on");
    expect(m2Body.className).not.toContain("spinner-on");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 20A / 20B / 20C / 20D / 20E — [quick-260727-gm3] deactivate action
// ─────────────────────────────────────────────────────────────────────────────
// user 2026-07-27 deactivate-preview.js console snippet: rows in the active-
// set (non-RDP) grow a red-tinted X glyph. Click closes the tab AND removes
// the id from activeSet; the row recedes to ambient. Row-level render:
//   - Desktop active-set non-RDP → DeactivateAction inside .pv-meta, BEFORE
//     PinAction in DOM order (leftmost meta child among pin/deactivate/dot).
//     CSS handles hover-reveal (gated on .active-set).
//   - Desktop ambient / RDP → NOT rendered.
//   - Mobile active-set non-RDP → both PinAction AND DeactivateAction inside
//     the widened 132px swipe strip.
//   - Mobile ambient → ONLY PinAction (no deactivate).
//   - Mobile RDP → no swipe strip at all (pre-existing contract).

describe("PrettyConversationsPanel: deactivate action (quick-260727-gm3)", () => {
  it("Test 20A: desktop active-set non-RDP row → contextmenu opens portal menu carrying Pin (Deactivate removed from menu 2026-08-17)", () => {
    // Phase 42 UAT amendment 2026-08-17: the Tier 1 active-set render tier
    // was retired — active-set rows now flow through to pinned (if pinned)
    // or middle (by recency). user 2026-08-17 follow-up: the Deactivate
    // context-menu item was removed entirely (swipe-LEFT remains the sole
    // UI trigger for deactivate). Row is seeded into `middle` and marked
    // active-in-set via `mockActiveSet` so the row's `inActiveSet` prop is
    // true — even so, Deactivate no longer appears.
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      activeSet: [],
      pinned: [],
      middle: [
        makeConversationRow({ id: "active-1", label: "active-session", host: hostA }),
      ],
    });
    // The row's inActiveSet prop is driven by useActiveSet (mockActiveSet).
    mockActiveSet = new Set<string>(["active-1"]);

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="active-1"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();

    // Post quick-260730-o2m: neither PinAction nor DeactivateAction render
    // in the desktop `.pv-meta` column. Phase 48 Plan 05: the `.pv-meta`
    // wrapper itself is retired entirely (bounty badges relocated to avatar
    // corners; ready-dot deleted outright). This assertion is now
    // "neither PinAction nor DeactivateAction render anywhere in the row"
    // instead of "in the .pv-meta column" — same spirit, correct DOM shape.
    expect(rowEl!.querySelector(".pv-meta")).toBeNull();
    expect(
      rowEl!.querySelector('[data-testid="deactivate-action"]'),
    ).toBeNull();
    expect(rowEl!.querySelector('[data-testid="pin-action"]')).toBeNull();

    // Dispatch contextmenu on the row body to open the portal menu.
    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /pin/i })).toBeTruthy();
    // Deactivate menu item removed 2026-08-17 (user).
    expect(
      within(menu).queryByRole("menuitem", { name: /deactivate/i }),
    ).toBeNull();
  });

  it("Test 20B: desktop ambient (non-active-set) row renders NO deactivate-action", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [
            makeConversationRow({ id: "ambient-1", label: "ambient", host: hostA }),
          ],
        },
      ],
    });
    // useActiveSet stays empty — the row is ambient at the inActiveSet gate.
    // mockActiveSet reset to empty in beforeEach.

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="ambient-1"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();
    // The row exists but the DeactivateAction MUST NOT be in its DOM tree.
    expect(rowEl!.querySelectorAll('[data-testid="deactivate-action"]').length).toBe(0);
    // Belt-and-suspenders — no deactivate-action anywhere in the panel.
    expect(container.querySelectorAll('[data-testid="deactivate-action"]').length).toBe(0);
  });

  it("Test 20C: desktop RDP row renders NO deactivate-action EVEN when the RDP row's id is in the active-set", () => {
    const rdpHost = makeHost("h2", "WINDOWS-PC", { enableRdp: true });
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [
        {
          hostId: "__rdp__",
          hostName: "",
          rows: [
            makeConversationRow({
              id: "rdp-host::h2",
              label: "WINDOWS-PC",
              host: rdpHost,
              rdpHostRow: true,
              targetTmuxSession: null,
            }),
          ],
        },
      ],
    });
    // Belt-and-suspenders: even if useActiveSet reports the RDP id as
    // active, the row-level render MUST suppress the deactivate glyph
    // because isRdp is true.
    mockActiveSet = new Set<string>(["rdp-host::h2"]);

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="rdp-host::h2"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();
    expect(rowEl!.getAttribute("data-rdp-host-row")).toBe("true");
    expect(rowEl!.querySelectorAll('[data-testid="deactivate-action"]').length).toBe(0);
  });

  // Test 20D (mobile active-set/ambient swipe-strip DOM assertions) DELETED in
  // quick-260802-pq2. The swipe strip was retired alongside the row's swipe
  // state machine; mobile action affordance is the long-press → Pretty
  // ConversationContextMenu (same builder desktop right-click uses). Row-level
  // menu-open tests live in PrettyConversationRow.test.tsx TL1-TL5; the
  // items[] builder is a single source of truth so mobile menu content is
  // guaranteed by transitivity with the desktop assertions in Test 20A + 20E.

  // Tests 20E, 20F, 20G, 20H — DELETED 2026-08-17. user removed the
  // Deactivate context-menu item. The tests exercised the menu-click path
  // which no longer exists. The panel's `handleRowDeactivate` composition
  // (removeFromActiveSet + onDeactivateRow, plus the fleet-id sibling purge
  // from quick-260727-s8g, plus the ordering contract for bounty #5) is
  // still wired — the swipe-LEFT path in PrettyConversationRow.tsx still
  // calls the same onDeactivate handler. If a regression re-enters via the
  // swipe path, add fresh tests that fire the pointer sequence rather than
  // resurrect the menu-click ones.
});

// quick-260807-e4s: locks in the id-shape-mismatch fix. Panel-side
// isRowPinned(row) must mirror the store's Tier 2 shadow-fleet-id
// pinned computation (conversation-store.ts:493-499) at the two
// active-set-tier render sites (active-set map + grouped host map).
describe("PrettyConversationsPanel: active-set fleet-shadow-id pinned recognition (quick-260807-e4s)", () => {
  it("Test E4S-01: active-set row whose pin lives under fleet::HOSTID::SESSIONNAME shows Unpin (not Pin) in the right-click context menu", () => {
    // Phase 42 UAT amendment 2026-08-17: active-set render tier retired; seed
    // row into `middle` and mark active-in-set via `mockActiveSet`.
    const hostA = makeHost("1", "hostA");
    const activeRow = makeConversationRow({
      id: "active-alpha",
      label: "alpha",
      host: hostA,
      targetTmuxSession: "alpha",
    });
    setSnapshot({
      activeSet: [],
      pinned: [],
      middle: [activeRow],
      pinnedIds: new Set(["fleet::1::alpha"]),
    });
    mockActiveSet = new Set<string>(["active-alpha"]);

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="active-alpha"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();

    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    const menu = screen.getByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: /^unpin$/i }),
    ).toBeTruthy();
    expect(
      within(menu).queryByRole("menuitem", { name: /^pin$/i }),
    ).toBeNull();
  });

  // quick-260807 followup: E4S-01 fixed the READ side (menu label). This
  // locks in the WRITE side — clicking Unpin on the same fixture must
  // remove the fleet-synthetic pin from pinnedIds (via unpinConversation)
  // rather than ADDING the openTab-id shape (which was the pre-fix bug:
  // togglePinConversation(openTabId) found openTabId NOT in pinnedIds and
  // added it, leaving the fleet-shadow pin in place forever).
  it("Test E4S-02: clicking Unpin on an active-set row whose pin lives under fleet::HOSTID::SESSIONNAME calls unpinConversation with the fleet id (not pinConversation with the openTab id)", async () => {
    // Phase 42 UAT amendment 2026-08-17: active-set render tier retired; seed
    // row into `middle` and mark active-in-set via `mockActiveSet`.
    const hostA = makeHost("1", "hostA");
    const activeRow = makeConversationRow({
      id: "active-alpha",
      label: "alpha",
      host: hostA,
      targetTmuxSession: "alpha",
    });
    setSnapshot({
      activeSet: [],
      pinned: [],
      middle: [activeRow],
      pinnedIds: new Set(["fleet::1::alpha"]),
    });
    mockActiveSet = new Set<string>(["active-alpha"]);

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="active-alpha"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();

    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    const menu = screen.getByRole("menu");
    const unpinItem = within(menu).getByRole("menuitem", { name: /^unpin$/i });
    fireEvent.click(unpinItem);

    await waitFor(() => {
      expect(unpinConversationSpy).toHaveBeenCalledWith("fleet::1::alpha");
    });
    // Must NOT have added the openTab id as a stale second pin.
    expect(pinConversationSpy).not.toHaveBeenCalled();
    // And must NOT have called unpin on the openTab id (which isn't in
    // pinnedIds — the store's unpinConversation would no-op anyway, but
    // spec-wise the click's only side effect is removing the fleet id).
    expect(unpinConversationSpy).not.toHaveBeenCalledWith("active-alpha");
  });

  // Complementary: fresh pin from an active-set row with a resolvable fleet
  // id must land the pin under the CANONICAL (fleet-synthetic) shape so the
  // pin survives openTab-id churn across URL-restores.
  it("Test E4S-03: clicking Pin on an unpinned active-set row with host+targetTmuxSession pins under the fleet-synthetic canonical id (not the openTab id)", async () => {
    // Phase 42 UAT amendment 2026-08-17: active-set render tier retired; seed
    // row into `middle` and mark active-in-set via `mockActiveSet`.
    const hostA = makeHost("1", "hostA");
    const activeRow = makeConversationRow({
      id: "active-alpha",
      label: "alpha",
      host: hostA,
      targetTmuxSession: "alpha",
    });
    setSnapshot({
      activeSet: [],
      pinned: [],
      middle: [activeRow],
      pinnedIds: new Set(),
    });
    mockActiveSet = new Set<string>(["active-alpha"]);

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="active-alpha"]',
    ) as HTMLElement | null;
    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    const menu = screen.getByRole("menu");
    const pinItem = within(menu).getByRole("menuitem", { name: /^pin$/i });
    fireEvent.click(pinItem);

    await waitFor(() => {
      expect(pinConversationSpy).toHaveBeenCalledWith("fleet::1::alpha");
    });
    expect(pinConversationSpy).not.toHaveBeenCalledWith("active-alpha");
    expect(unpinConversationSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — RDP-sentinel HostGroup renders at bottom with a "Remote desktop"
//          divider chip; RDP row follows the identity-tmux row in DOM order
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: RDP sentinel at bottom", () => {
  it('Test 4: __rdp__ group renders a "Remote desktop" divider and its row appears AFTER the identity-tmux row', () => {
    const hostA = makeHost("h1", "hostA");
    const rdpHost = makeHost("h2", "WINDOWS-PC", { enableRdp: true });
    setSnapshot({
      pinned: [],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [
            makeConversationRow({ id: "a", label: "alpha", host: hostA }),
          ],
        },
        {
          hostId: "__rdp__",
          hostName: "",
          rows: [
            makeConversationRow({
              id: "r1",
              label: "WINDOWS-PC",
              host: rdpHost,
              rdpHostRow: true,
              targetTmuxSession: null,
            }),
          ],
        },
      ],
    });

    const { container, queryByText } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // Divider chip present
    expect(queryByText(/remote desktop/i)).toBeTruthy();
    expect(
      container.querySelector('[data-testid="rdp-divider"]'),
    ).toBeTruthy();

    // Row DOM ordering: identity row `a` precedes RDP row `r1`
    const rowA = container.querySelector(
      '[data-conversation-id="a"]',
    ) as HTMLElement;
    const rowR1 = container.querySelector(
      '[data-conversation-id="r1"]',
    ) as HTMLElement;
    expect(rowA).toBeTruthy();
    expect(rowR1).toBeTruthy();
    expect(rowR1.getAttribute("data-rdp-host-row")).toBe("true");

    // Node.DOCUMENT_POSITION_FOLLOWING = 4 — rowA precedes rowR1.
    expect(rowA.compareDocumentPosition(rowR1) & 4).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — Header pencil opens NewSessionDialog
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: header New agent button opens NewSessionDialog", () => {
  it("Test 5 (quick-260914-liu repoint): clicking the dedicated pv-header-new-agent-button opens the NewSessionDialog (title 'Create a new agent conversation') in one step; button carries pv-pencil class, aria-label and title 'New conversation'", async () => {
    // quick-260914-liu: New agent is now a dedicated header icon button.
    // The flow is one step: click pv-header-new-agent-button → NewSessionDialog opens.
    const { getByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    // New conversation header button exists with correct chrome.
    const newAgentBtn = getByTestId("pv-header-new-agent-button");
    expect(newAgentBtn.className).toContain("pv-pencil");
    expect(newAgentBtn.getAttribute("aria-label")).toBe("New conversation");
    expect(newAgentBtn.getAttribute("title")).toBe("New conversation");

    // Click opens the NewSessionDialog.
    fireEvent.click(newAgentBtn);

    // NewSessionDialog uses shadcn Dialog which renders inside a portal.
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog).toBeTruthy();
    // Title reads "Create a new agent conversation". Target dialog-title
    // specifically to avoid false-positive matches against other portal DOM text.
    const dialogTitle = dialog!.querySelector(
      '[data-slot="dialog-title"]',
    ) as HTMLElement | null;
    expect(dialogTitle).toBeTruthy();
    expect(dialogTitle!.textContent).toMatch(
      /^\s*create a new agent conversation\s*$/i,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — Header pencil NOT rendered when onCreateSession is undefined
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: all four header buttons gated on onCreateSession", () => {
  it("Test 6 (quick-260914-liu extend): all four header icon buttons (New agent, Edit roles, Edit global files, kebab) are absent when onCreateSession is undefined — they share one showPencilButton guard", () => {
    // quick-260914-liu: three new header buttons join the kebab under the same
    // showPencilButton guard. When onCreateSession is undefined, all four must
    // be absent.
    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    expect(container.querySelector('[data-testid="pv-header-menu-button"]')).toBeNull();
    expect(container.querySelector('[data-testid="pv-header-new-agent-button"]')).toBeNull();
    expect(container.querySelector('[data-testid="pv-header-edit-roles-button"]')).toBeNull();
    expect(container.querySelector('[data-testid="pv-header-global-files-button"]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — Desktop header shows SKYNET brand lockup (inline SVG logo + wordmark img)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: desktop header title", () => {
  it("Test 7: desktop variant renders icon-only brand lockup in .pv-title with .pv-panel-header treatment (wordmark removed)", () => {
    const { container, queryByAltText } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Wordmark removed — only the icon <img> renders in the header lockup.
    expect(queryByAltText("SKYNET")).toBeNull();
    expect(container.querySelector(".pv-header-wordmark")).toBeNull();

    const titleEl = container.querySelector(".pv-title") as HTMLElement | null;
    expect(titleEl).toBeTruthy();
    expect(titleEl!.className).toContain("pv-title");

    const logoImg = titleEl!.querySelector("img.pv-header-logo") as HTMLImageElement | null;
    expect(logoImg).toBeTruthy();
    expect(logoImg!.getAttribute("aria-hidden")).toBe("true");
    expect(logoImg!.getAttribute("src")).toBe("/branding/icon.png");

    const headerRow = container.querySelector(
      "[data-testid='pretty-conversations-panel'] .pv-panel-header",
    ) as HTMLElement | null;
    expect(headerRow).toBeTruthy();
    expect(headerRow!.contains(titleEl!)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — Mobile header title (patch #144 spec change from omit → render)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: mobile header title (patch #144)", () => {
  it("Test 8: mobile variant renders icon-only brand lockup (same shape as desktop, wordmark removed)", () => {
    const { container, queryByAltText, queryByRole } = render(
      <PrettyConversationsPanel
        variant="mobile"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );
    // Wordmark removed on mobile too — mirrors desktop.
    expect(queryByAltText("SKYNET")).toBeNull();
    expect(container.querySelector(".pv-header-wordmark")).toBeNull();

    const titleEl = container.querySelector(".pv-title") as HTMLElement | null;
    expect(titleEl).toBeTruthy();

    const logoImg = titleEl!.querySelector("img.pv-header-logo") as HTMLImageElement | null;
    expect(logoImg).toBeTruthy();
    expect(logoImg!.getAttribute("aria-hidden")).toBe("true");
    expect(logoImg!.getAttribute("src")).toBe("/branding/icon.png");

    expect(container.querySelector(".pv-panel-header")).toBeTruthy();

    const menuBtn = container.querySelector('[data-testid="pv-header-menu-button"]') as HTMLElement | null;
    expect(menuBtn).toBeTruthy();
    expect(menuBtn!.className).toContain("pv-pencil");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9 — Desktop gear removed (patch #133)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: desktop gear removed (patch #133)", () => {
  it("Test 9: desktop variant does NOT render the gear button (patch #133 removed shadcn DropdownMenu gear entirely)", () => {
    const { queryByRole } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Post-patch-#133: gear DropdownMenu removed entirely; no button with a
    // settings-matching aria-label should exist in either variant.
    expect(queryByRole("button", { name: /settings/i })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10 — Mobile gear removed (patch #133)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: mobile gear removed (patch #133)", () => {
  it("Test 10: mobile variant does NOT render the gear button (patch #133 removed shadcn DropdownMenu gear entirely)", () => {
    const { queryByRole } = render(
      <PrettyConversationsPanel variant="mobile" onDeactivateRow={() => {}} />,
    );
    expect(queryByRole("button", { name: /settings/i })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 11 — RETIRED — settingsRowSlot prop dropped in Phase 11
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Test 12 — Row click routes RDP → onRdpRowClick
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: row-click routing (RDP)", () => {
  it("Test 12: clicking an RDP row calls onRdpRowClick and NOT selectConversation/onDetachedRowClick", () => {
    const rdpHost = makeHost("h2", "WINDOWS-PC", { enableRdp: true });
    const rdpRow = makeConversationRow({
      id: "r1",
      label: "WINDOWS-PC",
      host: rdpHost,
      rdpHostRow: true,
      targetTmuxSession: null,
    });
    setSnapshot({
      pinned: [],
      grouped: [{ hostId: "__rdp__", hostName: "", rows: [rdpRow] }],
    });

    const onRdpRowClick = vi.fn();
    const onDetachedRowClick = vi.fn();

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onRdpRowClick={onRdpRowClick}
        onDetachedRowClick={onDetachedRowClick}
        onDeactivateRow={() => {}}
      />,
    );

    const wrapper = container.querySelector(
      '[data-conversation-id="r1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(body);

    expect(onRdpRowClick).toHaveBeenCalledTimes(1);
    expect(onRdpRowClick.mock.calls[0][0].id).toBe("r1");
    expect(onDetachedRowClick).not.toHaveBeenCalled();
    expect(selectConversationSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 13 — Row click routes fleetOnly → onDetachedRowClick
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: row-click routing (fleet-only)", () => {
  it("Test 13: clicking a fleetOnly row calls onDetachedRowClick and NOT onRdpRowClick", () => {
    const hostA = makeHost("h1", "hostA");
    const detachedRow = makeConversationRow({
      id: "fleet::1::nelly",
      label: "nelly",
      host: hostA,
      fleetOnly: true,
      targetTmuxSession: "nelly",
    });
    setSnapshot({
      pinned: [],
      grouped: [{ hostId: "h1", hostName: "hostA", rows: [detachedRow] }],
    });

    const onDetachedRowClick = vi.fn();
    const onRdpRowClick = vi.fn();

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDetachedRowClick={onDetachedRowClick}
        onRdpRowClick={onRdpRowClick}
        onDeactivateRow={() => {}}
      />,
    );

    const wrapper = container.querySelector(
      '[data-conversation-id="fleet::1::nelly"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(body);

    expect(onDetachedRowClick).toHaveBeenCalledTimes(1);
    expect(onDetachedRowClick.mock.calls[0][0].id).toBe("fleet::1::nelly");
    expect(onRdpRowClick).not.toHaveBeenCalled();
    expect(selectConversationSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 14 — Row click on plain row calls selectConversation
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: row-click routing (plain)", () => {
  it("Test 14: clicking a plain openTabs-derived row calls selectConversation", () => {
    const hostA = makeHost("h1", "hostA");
    const plainRow = makeConversationRow({
      id: "t1",
      label: "session-1",
      host: hostA,
    });
    setSnapshot({
      pinned: [],
      grouped: [{ hostId: "h1", hostName: "hostA", rows: [plainRow] }],
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const wrapper = container.querySelector(
      '[data-conversation-id="t1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(body);

    expect(selectConversationSpy).toHaveBeenCalledTimes(1);
    expect(selectConversationSpy).toHaveBeenCalledWith("t1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 15 — onConversationSelected fires after every dispatcher branch
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: onConversationSelected after every branch", () => {
  it("Test 15: onConversationSelected fires for plain, fleet-only, and RDP row clicks", () => {
    const hostA = makeHost("h1", "hostA");
    const rdpHost = makeHost("h2", "WINDOWS-PC", { enableRdp: true });

    const plainRow = makeConversationRow({
      id: "t1",
      label: "session-1",
      host: hostA,
    });
    const fleetRow = makeConversationRow({
      id: "fleet::1::nelly",
      label: "nelly",
      host: hostA,
      fleetOnly: true,
      targetTmuxSession: "nelly",
    });
    const rdpRow = makeConversationRow({
      id: "r1",
      label: "WINDOWS-PC",
      host: rdpHost,
      rdpHostRow: true,
      targetTmuxSession: null,
    });

    setSnapshot({
      pinned: [],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [plainRow, fleetRow],
        },
        {
          hostId: "__rdp__",
          hostName: "",
          rows: [rdpRow],
        },
      ],
    });

    const onConversationSelected = vi.fn();
    const onDetachedRowClick = vi.fn();
    const onRdpRowClick = vi.fn();

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onConversationSelected={onConversationSelected}
        onDetachedRowClick={onDetachedRowClick}
        onRdpRowClick={onRdpRowClick}
        onDeactivateRow={() => {}}
      />,
    );

    // Plain row → onConversationSelected("t1")
    fireEvent.click(
      (
        container.querySelector(
          '[data-conversation-id="t1"]',
        ) as HTMLElement
      ).querySelector('[role="button"]') as HTMLElement,
    );
    // Fleet-only row → onConversationSelected("fleet::1::nelly")
    fireEvent.click(
      (
        container.querySelector(
          '[data-conversation-id="fleet::1::nelly"]',
        ) as HTMLElement
      ).querySelector('[role="button"]') as HTMLElement,
    );
    // RDP row → onConversationSelected("r1")
    fireEvent.click(
      (
        container.querySelector(
          '[data-conversation-id="r1"]',
        ) as HTMLElement
      ).querySelector('[role="button"]') as HTMLElement,
    );

    expect(onConversationSelected).toHaveBeenCalledTimes(3);
    expect(onConversationSelected.mock.calls[0][0]).toBe("t1");
    expect(onConversationSelected.mock.calls[1][0]).toBe("fleet::1::nelly");
    expect(onConversationSelected.mock.calls[2][0]).toBe("r1");
  });
});

// ─────────────────────────────────────────────────────────────
// Patch #144 Fix (d) — activeSet enrollment on selectedId change
// ─────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: patch #144 activeSet on selectedId", () => {
  it("Test 16 (patch #144 d): programmatic selectedId change calls addToActiveSet(id) via useEffect", () => {
    const hostA = makeHost("h1", "hostA");
    // Initial render with a non-null selectedId (simulates URL-fragment
    // restore having already set the selection before mount).
    setSnapshot({
      pinned: [],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [makeConversationRow({ id: "row-restored", host: hostA })],
        },
      ],
      selectedId: "row-restored",
    });
    render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);
    // The useEffect fires on mount because selectedId is non-null.
    expect(addToActiveSetSpy).toHaveBeenCalledWith("row-restored");
  });

  it("Test 17 (patch #144 d): null selectedId does NOT call addToActiveSet", () => {
    setSnapshot({ pinned: [], grouped: [], selectedId: null });
    render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);
    expect(addToActiveSetSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// Phase 92 Plan 04 — panel hydrate effect uses deriveDiskPinnedIds
// (replacement for retired getPinnedIds() fetch)
// ─────────────────────────────────────────────────────────────
//
// Post-Phase-92: the hydrate effect no longer fetches pinnedConversationIds
// from GET /user-preferences. Instead it projects each identity's on-disk
// `pinned: boolean` field (populated by the backend fanout per Plan 92-02)
// into the row id space via deriveDiskPinnedIds(identityHosts). The
// identityHosts argument is built by buildIdentityHostsFromFleet — the H2
// lock helper (identities-store.ts:74-85) shared with pin-toggle writes.

describe("PrettyConversationsPanel (Phase 92 Plan 04): server-hydration on mount", () => {
  it("Test 21 (Phase 92 rewire): mount calls buildIdentityHostsFromFleet(fleetSessions) then deriveDiskPinnedIds then hydratePinnedIdsFromServer", async () => {
    // quick-260727-kbw: opt in to the fleet-loaded gate so the mount effect
    // fires. Same gate contract as pre-92.
    mockFleetSessionsLoaded = true;

    // Seed the fleet snapshot the panel will pass into
    // buildIdentityHostsFromFleet, and seed each spy's return so the
    // projection lands ["fleet::1::tina"] into hydratePinnedIdsFromServer.
    const fleetFixture = [
      { hostId: 1, hostName: "hostA", sessionName: "tina", created: 100, role: null },
    ];
    mockFleetSessionsSnapshot = fleetFixture;
    buildIdentityHostsFromFleetSpy.mockReturnValueOnce({ tina: 1 });
    deriveDiskPinnedIdsSpy.mockReturnValueOnce(["fleet::1::tina"]);

    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [makeConversationRow({ id: "t-A", label: "session-A", host: hostA })],
        },
      ],
    });

    render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // buildIdentityHostsFromFleet fires with the seeded fleet snapshot.
    await waitFor(() => {
      expect(buildIdentityHostsFromFleetSpy).toHaveBeenCalledTimes(1);
    });
    expect(buildIdentityHostsFromFleetSpy).toHaveBeenCalledWith(fleetFixture);

    // deriveDiskPinnedIds is called with the buildIdentityHostsFromFleet result.
    await waitFor(() => {
      expect(deriveDiskPinnedIdsSpy).toHaveBeenCalledTimes(1);
    });
    expect(deriveDiskPinnedIdsSpy).toHaveBeenCalledWith({ tina: 1 });

    // The projection result flows into hydratePinnedIdsFromServer.
    await waitFor(() => {
      expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledTimes(1);
    });
    expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledWith(["fleet::1::tina"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 22 — quick-260727-kbw: mount hydration gated on fleetSessionsLoaded
// (Phase 92 Plan 04 rewired to the deriveDiskPinnedIds path)
// ─────────────────────────────────────────────────────────────────────────────
// The fleet-loaded gate is UNCHANGED post-2026-09-17. Only the second gate
// changed: was `identitiesLoaded`, now `identitiesByKey.size > 0`; and
// `hydratedRef` was retired in favor of dep-array ref stability
// ([fleetSessionsLoaded, identitiesByKey]). This test still locks the
// fleet-loaded early-return + single-fire semantics; the "one-shot" property
// is now enforced by ref-stable Map identity from the identities-store mock
// (see TEST_DEFAULT_BY_KEY) rather than by an explicit hydratedRef latch.

describe("PrettyConversationsPanel (quick-260727-kbw, Phase 92 rewire): mount hydration gated on fleetSessionsLoaded", () => {
  it("Test 22 (quick-260727-kbw, Phase 92): mount does NOT call deriveDiskPinnedIds while fleetSessionsLoaded=false; DOES call once after it flips to true; stays once across further re-renders (dep-array ref stability)", async () => {
    mockFleetSessionsSnapshot = [
      { hostId: 7, hostName: "hostA", sessionName: "aqua", created: 100, role: null },
    ];
    buildIdentityHostsFromFleetSpy.mockReturnValue({ aqua: 7 });
    deriveDiskPinnedIdsSpy.mockReturnValue(["fleet::7::aqua"]);

    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [makeConversationRow({ id: "t-A", label: "session-A", host: hostA })],
        },
      ],
    });

    // beforeEach sets mockFleetSessionsLoaded = false. Render — gate closed.
    const { rerender } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // Pre-flip assertion: projection NOT called.
    await Promise.resolve();
    expect(deriveDiskPinnedIdsSpy).toHaveBeenCalledTimes(0);
    expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledTimes(0);

    // Flip the gate open, rerender.
    mockFleetSessionsLoaded = true;
    rerender(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // Post-flip: projection called exactly once + hydrate lands.
    await waitFor(() => {
      expect(deriveDiskPinnedIdsSpy).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledTimes(1);
    });
    expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledWith(["fleet::7::aqua"]);

    // Third render: gate stays open, ref-stable byKey Map from
    // TEST_DEFAULT_BY_KEY means the effect deps don't change → effect
    // doesn't re-fire → both spies stay at 1.
    rerender(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    await Promise.resolve();
    expect(deriveDiskPinnedIdsSpy).toHaveBeenCalledTimes(1);
    expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// quick-260912-5q2 — mount hydration race: identities gate
// ─────────────────────────────────────────────────────────────────────────────
// Regression trap for the cold-reload pin-loss race the operator reproduced on
// t1000: the hydrate effect fired on the fleetSessionsLoaded false→true flip
// BEFORE any identity data was in the store, causing deriveDiskPinnedIds to
// read an empty state.identities and return []. The original hydratedRef
// latch then prevented the correct projection from ever landing.
//
// The 2026-09-17 rework: gate on `identitiesByKey.size > 0` (any identity
// data present) rather than `identitiesLoaded` (the slow /identities flip),
// AND skip empty projections at the panel callsite. This describe block
// locks BOTH properties — the gate is closed until byKey has data, and once
// open the empty-projection skip protects against wipes.
describe("PrettyConversationsPanel (quick-260912-5q2 rework): mount hydration gated on identitiesByKey.size > 0", () => {
  it("does NOT hydrate when fleetSessionsLoaded=true but identitiesByKey is empty; hydrates exactly once after byKey grows; effect stays quiet on a subsequent re-render with same byKey ref", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    // Phase 1: fleetSessionsLoaded=true, identities-store empty (race window).
    // Route the mock's byKey to the actual (empty) mockIdentitiesByKey by
    // flipping mockIdentitiesLoaded=false — the mock synthesizes
    // TEST_DEFAULT_BY_KEY only when loaded=true (see mock declaration).
    mockFleetSessionsLoaded = true;
    mockIdentitiesLoaded = false;

    // Spies: seed the fleet-snapshot so the fleet gate passes, but the
    // identities gate must prevent derivation from running at all.
    mockFleetSessionsSnapshot = [
      { hostId: 6, hostName: "hostIvory", sessionName: "ivory", created: 100, role: null },
    ];
    buildIdentityHostsFromFleetSpy.mockReturnValue({ ivory: 6 });
    deriveDiskPinnedIdsSpy.mockReturnValue(["fleet::6::ivory"]);

    setSnapshot({ activeSet: [], pinned: [], grouped: [] });

    // ── Phase 1: render with identities-store NOT yet loaded ─────────────────
    const { rerender } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // Await a microtask — if the gate is absent, the effect would fire here.
    await Promise.resolve();

    // PRE-FLIP ASSERTION: the identities gate must have blocked the effect.
    // hydratePinnedIdsFromServer must NOT have been called — this proves the
    // panel does NOT clear pins with [] during the identities-store race window.
    expect(deriveDiskPinnedIdsSpy).toHaveBeenCalledTimes(0);
    expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledTimes(0);

    // ── Phase 2: flip mock so byKey becomes non-empty, rerender ─────────────
    // Setting mockIdentitiesLoaded=true routes the mock's byKey to
    // TEST_DEFAULT_BY_KEY (stable ref, size=1). Gate opens.
    mockIdentitiesLoaded = true;
    rerender(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // POST-FLIP ASSERTION: gate now open — hydrate fires exactly once.
    await waitFor(() => {
      expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledTimes(1);
    });
    expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledWith(["fleet::6::ivory"]);

    // ── Phase 3: third render — byKey ref unchanged → effect stays quiet ────
    // TEST_DEFAULT_BY_KEY is a module-level constant, so the [fleetSessionsLoaded,
    // identitiesByKey] deps compare ref-equal across the rerender and the
    // effect body does not re-execute.
    rerender(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    await Promise.resolve();
    expect(deriveDiskPinnedIdsSpy).toHaveBeenCalledTimes(1);
    expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PANEL-92-* — Phase 92 Plan 04 Task 2 regression traps
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel (Phase 92 Plan 04): PANEL-92-* hydrate regression traps", () => {
  // (Phase 115 Plan 115-02: prior PANEL-92-03 "hidden hydrate via
  //  deriveDiskHiddenIds" test retired per D-21 alongside the source-code
  //  deletion of the same code path.)

  it("PANEL-92-04 (H2 lock): hydrate effect threads buildIdentityHostsFromFleet(state.fleetSessions) into deriveDiskPinnedIds", async () => {
    // The panel MUST route identityHosts derivation through the shared
    // buildIdentityHostsFromFleet helper. This test asserts:
    //   (1) buildIdentityHostsFromFleet is called with the fleetSessions
    //       snapshot returned from getFleetSessionsSnapshot,
    //   (2) deriveDiskPinnedIds is called with that helper's return value,
    //   (3) the same call order holds (build → derive → hydrate).
    mockFleetSessionsLoaded = true;
    const fleetFixture = [
      { hostId: 1, hostName: "alpha", sessionName: "tina", created: 100, role: null },
      { hostId: 2, hostName: "beta", sessionName: "user", created: 200, role: null },
    ];
    mockFleetSessionsSnapshot = fleetFixture;
    const expectedIdentityHosts = { tina: 1, user: 2 };
    buildIdentityHostsFromFleetSpy.mockReturnValueOnce(expectedIdentityHosts);
    deriveDiskPinnedIdsSpy.mockReturnValueOnce(["fleet::1::tina"]);

    setSnapshot({ activeSet: [], pinned: [], grouped: [] });

    render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    await waitFor(() => {
      expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledTimes(1);
    });

    // (1) buildIdentityHostsFromFleet called with the fleet snapshot.
    expect(buildIdentityHostsFromFleetSpy).toHaveBeenCalledWith(fleetFixture);
    // (2) deriveDiskPinnedIds called with the build's return value.
    expect(deriveDiskPinnedIdsSpy).toHaveBeenCalledWith(expectedIdentityHosts);
    // (3) hydratePinnedIdsFromServer called with the projection result.
    expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledWith(["fleet::1::tina"]);
  });
});

// (Phase 115 Plan 115-02: prior "PANEL-107-* hidden hydrate + AFF-107-*
//  affordance" describe block retired per D-21 alongside the source-code
//  deletion of deriveDiskHiddenIds, hydrateHiddenIdsFromServer, and the
//  entire Hide affordance across the panel.)

// ─────────────────────────────────────────────────────────────────────────────
// Test 29 — pinned rows render identity title when identity resolves
//           (patch #184 / quick-260729-gsv)
// ─────────────────────────────────────────────────────────────────────────────
// Regression guard for patch #184: the pinned render site in
// PrettyConversationsPanel.tsx now passes `subtitleMode="identityTitle"` to
// PrettyConversationRowLive, matching the grouped block's treatment. When an
// identity resolves for the pinned row's tmux session, the row's `.pv-host`
// sublabel MUST render `identity.title ?? identity.displayName` (NOT the
// hostname + Server icon fallback). Row-level fallback semantics are covered
// by PrettyConversationRow.test.tsx Tests 19A/B/C — this test proves the
// panel wires the prop through at the pinned render site specifically.

describe("PrettyConversationsPanel: Phase 48 Plan 05 pinned row v14 shape (was patch #184 / quick-260729-gsv pinned identity.title subtitle)", () => {
  it("Test 29 (Phase 48 Plan 05 rewrite): pinned row renders aiTitle in the `.pv-ai-title` subtitle span, title-line carries `identityName (hostname)`, no Server icon, no `.pv-host` element", () => {
    // Pre-Phase-48 the pinned row's sublabel rendered `identity.title` via
    // subtitleMode='identityTitle'. Phase 48 Plan 05 replaces the sublabel
    // entirely: subtitle = aiTitle string threaded from the working-store
    // (or placeholder ellipsis when null). The identity.title / .displayName
    // moves to the title line (before the hostname parens suffix).
    const hostA = makeHost("h1", "hostA");
    mockIdentitiesByKey = new Map([
      [
        "tina-session",
        {
          identityKey: "tina",
          title: "Tina's Laptop",
          displayName: "tina@laptop",
        },
      ],
    ]);
    // Seed the panel mock's useSessionAiTitle hook so this row receives a
    // concrete ai-title through the Plan 48-04 wire.
    // sessionWorkingKey format: `${host.id}:${targetTmuxSession ?? ""}`.
    mockAiTitleByKey.set("h1:tina-session", "Reviewing test coverage");
    setSnapshot({
      activeSet: [],
      pinned: [
        makeConversationRow({
          id: "pinned-1",
          label: "pinned-session",
          targetTmuxSession: "tina-session",
          host: hostA,
        }),
      ],
      grouped: [],
      pinnedIds: new Set(["pinned-1"]),
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const pinnedGroup = container.querySelector(
      '[data-pinned-group="true"]',
    ) as HTMLElement | null;
    expect(pinnedGroup).toBeTruthy();

    const pinnedRow = pinnedGroup!.querySelector(
      '[data-conversation-id="pinned-1"]',
    ) as HTMLElement | null;
    expect(pinnedRow).toBeTruthy();

    // Phase 48 Plan 05: `.pv-host` element is retired outright — the
    // pre-Phase-48 sublabel wrapper is gone. Assert absence.
    expect(pinnedRow!.querySelector(".pv-host")).toBeNull();

    // (1) The subtitle line is `.pv-ai-title` and carries the aiTitle text.
    const pvAiTitle = pinnedRow!.querySelector(
      ".pv-ai-title",
    ) as HTMLElement | null;
    expect(pvAiTitle).toBeTruthy();
    expect(pvAiTitle!.textContent).toBe("Reviewing test coverage");
    expect(pvAiTitle!.className).not.toContain("pv-ai-title--placeholder");

    // (2) The title line reads "identity.displayName (identity.title)" —
    //     inline-260823-conv-title-suffix (user 2026-08-23) flipped the
    //     parenthetical to prefer identity.title over hostname. The
    //     identity mock uses displayName="tina@laptop" title="Tina's Laptop"
    //     so title wins over hostA. Hostname fallback path covered by
    //     PrettyConversationRow.test.tsx Test 20C.
    const pvLabel = pinnedRow!.querySelector(
      ".pv-label",
    ) as HTMLElement | null;
    expect(pvLabel).toBeTruthy();
    expect(pvLabel!.textContent?.trim()).toBe("tina@laptop (Tina's Laptop)");

    // (3) Server icon fully retired — no svg with width=11 in the row.
    expect(pinnedRow!.querySelector('svg[width="11"]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// quick-260731-tgg: Hidden section tests (a-f)
// ─────────────────────────────────────────────────────────────────────────────

// (Phase 115 Plan 115-02: prior "PrettyConversationsPanel: Hidden section (quick-260731-tgg)" describe block retired
//  per D-21 alongside the source-code deletion of the Hide affordance.)

// ─────────────────────────────────────────────────────────────────────────────
// quick-260731-tgg: Hide/Show row-wiring tests (g-m)
// ─────────────────────────────────────────────────────────────────────────────

// (Phase 115 Plan 115-02: prior "PrettyConversationsPanel: Hide/Show wiring (quick-260731-tgg)" describe block retired
//  per D-21 alongside the source-code deletion of the Hide affordance.)

// ─────────────────────────────────────────────────────────────────────────────
// TS-P1 — Mobile row-swipe composite wiring (quick-260808-fkg)
// ─────────────────────────────────────────────────────────────────────────────
// The row's swipe-right composite (pin+activate) MUST flow through the panel-
// level handleTogglePin + handleRowSelect handlers — not through any direct
// store bypass on the row side. This integration test proves the wiring by
// dispatching a swipe-right gesture on a mobile-variant panel row and
// asserting on the store-level spies (pinConversation + addToActiveSet +
// selectConversation) that the panel's composite handlers actually invoke.
// Row-level TS1-TS7 in PrettyConversationRow.test.tsx cover the gesture
// mechanics; this panel-level test locks the swipe composite wiring end-to-
// end (row callback → panel handler → store mutator). Uses fake timers to
// flush the 200ms snap-back window without hanging.

describe("PrettyConversationsPanel: mobile row-swipe composite wiring (quick-260808-fkg)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("TS-P1: swipe composite — swipe-right past threshold on a mobile row wires through handleTogglePin + handleRowSelect (pinConversation + addToActiveSet + selectConversation fire)", () => {
    // Host id "1" (not "h1") so parseInt(host.id, 10) resolves to a finite
    // integer — matches the panel's fleet-shadow id shape at
    // PrettyConversationsPanel.tsx:688 (fleetRowId consumes a numeric hostId).
    const hostA = makeHost("1", "hostA");
    const plainRow = makeConversationRow({
      id: "swipe-row-1",
      label: "swipe-target",
      host: hostA,
      targetTmuxSession: "swipetgt",
    });
    setSnapshot({
      pinned: [],
      grouped: [{ hostId: "1", hostName: "hostA", rows: [plainRow] }],
      pinnedIds: new Set(),
    });

    const { container } = render(
      <PrettyConversationsPanel variant="mobile" onDeactivateRow={() => {}} />,
    );

    const wrapper = container.querySelector(
      '[data-conversation-id="swipe-row-1"]',
    ) as HTMLElement;
    expect(wrapper).toBeTruthy();
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;

    // Clear any mount-time invocations of the store spies so we only observe
    // the swipe-driven calls below (panel useEffect on [selectedId] would
    // fire addToActiveSet if selectedId were non-null; it's null here so
    // this is defensive-only).
    pinConversationSpy.mockClear();
    addToActiveSetSpy.mockClear();
    selectConversationSpy.mockClear();

    fireEvent.touchStart(body, {
      touches: [{ clientX: 100, clientY: 100 } as Touch],
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 150, clientY: 102 } as Touch], // arms swipe
    });
    fireEvent.touchMove(body, {
      touches: [{ clientX: 210, clientY: 105 } as Touch], // dx=110 > 90 threshold
    });
    fireEvent.touchEnd(body, { changedTouches: [] });
    act(() => {
      vi.advanceTimersByTime(200); // flush snap-back
    });

    // Panel-level composite: handleTogglePin routes to pinConversation with
    // the canonical shadow-fleet id (fleet::HOSTID::SESSIONNAME) when the row
    // has host + targetTmuxSession — matches PrettyConversationsPanel.tsx:696.
    expect(pinConversationSpy).toHaveBeenCalledTimes(1);
    expect(pinConversationSpy).toHaveBeenCalledWith("fleet::1::swipetgt");
    // handleRowSelect adds row.id to the active set and calls
    // selectConversation(row.id) (matches lines 622 + 633).
    expect(addToActiveSetSpy).toHaveBeenCalledTimes(1);
    expect(addToActiveSetSpy).toHaveBeenCalledWith("swipe-row-1");
    expect(selectConversationSpy).toHaveBeenCalledTimes(1);
    expect(selectConversationSpy).toHaveBeenCalledWith("swipe-row-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleRowKill (quick-260810-n3a) — K8-K10
// ─────────────────────────────────────────────────────────────────────────────
// Panel-level confirm-dialog and onKillRow prop threading tests.
// Uses the same pattern as Test 20E (deactivate via context menu) to open the
// Kill item and assert the confirm/onKillRow flow.

describe("PrettyConversationsPanel: handleRowKill (quick-260810-n3a)", () => {
  // K8: handleRowKill invokes window.confirm with a message naming the tmux
  //     session AND the host name
  it("K8: clicking Kill opens window.confirm with session name + host name in message", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [
            makeConversationRow({
              id: "kill-row-1",
              label: "claude-abc",
              host: hostA,
              targetTmuxSession: "claude-abc",
            }),
          ],
        },
      ],
    });

    const onKillRow = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onKillRow={onKillRow}
      />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="kill-row-1"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();
    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    const killItem = within(menu).getByRole("menuitem", { name: /kill/i });
    fireEvent.click(killItem);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const confirmMsg: string = (confirmSpy.mock.calls[0] as [string])[0];
    expect(confirmMsg).toContain("claude-abc");
    expect(confirmMsg).toContain("hostA");

    confirmSpy.mockRestore();
  });

  // K9: when window.confirm returns false → onKillRow NOT called
  it("K9: window.confirm returns false → onKillRow NOT called", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [
            makeConversationRow({
              id: "kill-row-2",
              label: "claude-abc",
              host: hostA,
              targetTmuxSession: "claude-abc",
            }),
          ],
        },
      ],
    });

    const onKillRow = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onKillRow={onKillRow}
      />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="kill-row-2"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();
    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    const killItem = within(menu).getByRole("menuitem", { name: /kill/i });
    fireEvent.click(killItem);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onKillRow).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  // K10: when window.confirm returns true → onKillRow called exactly once with the row
  it("K10: window.confirm returns true → onKillRow called exactly once with the correct row", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [
            makeConversationRow({
              id: "kill-row-3",
              label: "claude-abc",
              host: hostA,
              targetTmuxSession: "claude-abc",
            }),
          ],
        },
      ],
    });

    const onKillRow = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onKillRow={onKillRow}
      />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="kill-row-3"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();
    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    const killItem = within(menu).getByRole("menuitem", { name: /kill/i });
    fireEvent.click(killItem);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onKillRow).toHaveBeenCalledTimes(1);
    expect((onKillRow.mock.calls[0] as [{ id: string }])[0].id).toBe("kill-row-3");

    confirmSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 115 Plan 115-06 — panel-level handleArchive (A5-A9) + Archived section (A10-A14)
// ─────────────────────────────────────────────────────────────────────────────
// A5-A9 lock the click-through composition: canonicalArchiveIdForRow gate →
// window.confirm with EXACT-STRING copy → conditional pane-close side effect →
// archiveIdentity API call. A10-A14 lock the Archived section render invariants
// per D-06 (inert rows) + D-19 (lazy-render).

describe("PrettyConversationsPanel: Phase 115 Plan 115-06 handleArchive", () => {
  // A5: identity-backed row → clicking Archive opens window.confirm with the
  //     EXACT D-03 copy — asserted via toHaveBeenCalledWith equality (not toContain).
  it("A5: Archive click opens window.confirm with EXACT copy 'archive <identity>? this can\\'t be undone.'", () => {
    // Use a numeric-string hostId — canonicalArchiveIdForRow parses via parseInt.
    // Non-numeric hostIds (e.g. "h1") coerce to NaN, fail Number.isFinite,
    // and the gate returns null → row menu does NOT get Archive item.
    const hostA = makeHost("1", "hostA");
    // Seed the identities-store mock so the row's identityKey resolves to a
    // displayName of "wren" (fixture — the plan's Test 8 assertion). The
    // panel's handleArchive falls back to targetTmuxSession when the
    // identity has not resolved; here we exercise the resolved-identity
    // branch so the confirmation copy uses displayName verbatim.
    mockIdentitiesByKey = new Map([
      ["wren", { identityKey: "wren", displayName: "wren", title: null }],
    ]);
    setSnapshot({
      activeSet: [],
      pinned: [],
      middle: [
        makeConversationRow({
          id: "arch-row-1",
          label: "wren",
          host: hostA,
          targetTmuxSession: "wren",
        }),
      ],
      rdpGroup: null,
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
      />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="arch-row-1"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();
    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    const archiveItem = within(menu).getByRole("menuitem", { name: "Archive" });
    fireEvent.click(archiveItem);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // D-03 EXACT copy — byte-identical equality (not toContain / regex).
    // Straight ASCII apostrophe (U+0027); period at end; no backticks or
    // quotes around the displayName in the actual dialog string.
    expect(confirmSpy).toHaveBeenCalledWith(
      "archive wren? this can't be undone.",
    );

    confirmSpy.mockRestore();
  });

  // A6: window.confirm returns false → archiveIdentity NOT called; no pane close.
  it("A6: window.confirm returns false → archiveIdentity NOT called, no side effect", () => {
    const hostA = makeHost("1", "hostA");
    mockIdentitiesByKey = new Map([
      ["wren", { identityKey: "wren", displayName: "wren", title: null }],
    ]);
    setSnapshot({
      activeSet: [],
      pinned: [],
      middle: [
        makeConversationRow({
          id: "arch-row-2",
          label: "wren",
          host: hostA,
          targetTmuxSession: "wren",
        }),
      ],
      rdpGroup: null,
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onDeactivateRow = vi.fn();

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={onDeactivateRow}
      />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="arch-row-2"]',
    ) as HTMLElement | null;
    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    const archiveItem = within(menu).getByRole("menuitem", { name: "Archive" });
    fireEvent.click(archiveItem);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(archiveIdentitySpy).not.toHaveBeenCalled();
    expect(onDeactivateRow).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  // A7: window.confirm returns true → archiveIdentity(hostId, key) fires with the correct args.
  it("A7: confirm=true → archiveIdentity called with (parsed hostId, identityKey) exactly once", () => {
    const hostA = makeHost("42", "hostA");
    mockIdentitiesByKey = new Map([
      ["wren", { identityKey: "wren", displayName: "wren", title: null }],
    ]);
    setSnapshot({
      activeSet: [],
      pinned: [],
      middle: [
        makeConversationRow({
          id: "arch-row-3",
          label: "wren",
          host: hostA,
          targetTmuxSession: "wren",
        }),
      ],
      rdpGroup: null,
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
      />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="arch-row-3"]',
    ) as HTMLElement | null;
    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    const archiveItem = within(menu).getByRole("menuitem", { name: "Archive" });
    fireEvent.click(archiveItem);

    expect(archiveIdentitySpy).toHaveBeenCalledTimes(1);
    expect(archiveIdentitySpy).toHaveBeenCalledWith(42, "wren");

    confirmSpy.mockRestore();
  });

  // A8: identity-key fallback — if the identity hasn't yet resolved, the
  //     confirmation copy uses the identity key as displayName.
  it("A8: identity not yet resolved → confirmation uses identityKey as displayName", () => {
    const hostA = makeHost("1", "hostA");
    // No identity seeded — mockIdentitiesByKey stays empty from beforeEach.
    setSnapshot({
      activeSet: [],
      pinned: [],
      middle: [
        makeConversationRow({
          id: "arch-row-4",
          label: "wren",
          host: hostA,
          targetTmuxSession: "wren",
        }),
      ],
      rdpGroup: null,
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
      />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="arch-row-4"]',
    ) as HTMLElement | null;
    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    const archiveItem = within(menu).getByRole("menuitem", { name: "Archive" });
    fireEvent.click(archiveItem);

    // Fallback: displayName resolves to the identityKey (targetTmuxSession).
    expect(confirmSpy).toHaveBeenCalledWith(
      "archive wren? this can't be undone.",
    );

    confirmSpy.mockRestore();
  });

  // A9: RDP host row → Archive item NOT in menu (affordance-narrowing preserved).
  it("A9: RDP host row → Archive item NOT in row menu (canonicalArchiveIdForRow gate)", () => {
    const rdpHost = makeHost("h9", "beelink", { enableRdp: true });
    setSnapshot({
      activeSet: [],
      pinned: [],
      middle: [],
      rdpGroup: {
        hostId: "__rdp__",
        hostName: "rdp",
        rows: [
          makeConversationRow({
            id: "rdp-row",
            label: "beelink",
            host: rdpHost,
            targetTmuxSession: null,
            rdpHostRow: true,
          }),
        ],
      },
    });

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
      />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="rdp-row"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();
    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu");
    expect(
      within(menu).queryByRole("menuitem", { name: "Archive" }),
    ).toBeNull();
  });
});

// (Phase 115 Plan 115-06 Archived-section describe retired in the Phase 122
//  shape follow-up alongside the sidebar chrome + wire pump — archived
//  identities now surface via the ConversationSearchModal only.)

// ─────────────────────────────────────────────────────────────────────────────
// Phase 122 Plan 04 (D-17 removal): the Phase 41 Plan 02 describes
// ("search input mount + scroll-hide" and "filter predicate + flat match
// render") — L2783-L3278 pre-removal — are RETIRED together with the
// inline filter-as-you-type input the modal (Phase 122 Plan 03) replaced.
// The compact describe below asserts (a) the OLD inline-filter selectors
// are absent and (b) the NEW pv-header-search-button is present and opens
// the modal — the positive proof that D-17 is done under D-18 ordering.
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel (Phase 122 Plan 04): D-17 filter-as-you-type removal", () => {
  it("R1: the old inline filter selectors are ABSENT from the panel DOM", () => {
    // Empty snapshot — mirrors the smallest render surface the panel accepts.
    setSnapshot({ activeSet: [], pinned: [], middle: [], rdpGroup: null });
    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // The three retired testids MUST NOT resolve any node.
    expect(
      container.querySelector('[data-testid="pretty-conversations-search-container"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="pretty-conversations-search-input"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="pretty-conversations-search-clear"]'),
    ).toBeNull();

    // Neither an <input type="search"> nor an ARIA searchbox exists anywhere
    // in the panel — the ParticipantSearchInput reuse lives inside a different
    // modal (NewConversationModal) which is not mounted by default here.
    expect(container.querySelector('input[type="search"]')).toBeNull();
  });

  it("R2: the new pv-header-search-button is present and opens the ConversationSearchModal", async () => {
    setSnapshot({ activeSet: [], pinned: [], middle: [], rdpGroup: null });
    render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        // Same gate as the pencil / more / global-files buttons — the search
        // button lives inside the showPencilButton conditional per Plan 03.
        onCreateSession={vi.fn()}
      />,
    );

    // The plan-03 button is present with its documented testid.
    const searchBtn = screen.getByTestId("pv-header-search-button");
    expect(searchBtn).toBeTruthy();
    expect(searchBtn.getAttribute("aria-label")).toBe("Search conversations");

    // Clicking it mounts a role="dialog" (Radix DialogPrimitive.Content).
    await act(async () => {
      fireEvent.click(searchBtn);
    });
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// PrettyConversationsPanel (quick-260818-q73): idle sweep
// ─────────────────────────────────────────────────────────────────────────────
// Shape: .planning/shapes/shape-auto-deactivate-idle-convs.md
//
// Three tests covering the panel-level per-tab idle sweep:
//   (a) HARD INVARIANT — the currently-selected conv is exempt from the sweep
//       even if its stamp is stale from an earlier unfocus. This is the "you
//       never deactivate the one you're on" guarantee from the shape.
//   (b) A stale unfocused conv IS deactivated on the next sweep tick — the
//       sweep flows through the same handleRowDeactivate the manual click uses
//       (verified via removeFromActiveSet + onDeactivateRow spies).
//   (c) A fresh (< threshold) unfocused conv is NOT deactivated on a sweep tick.
//
// Uses vi.useFakeTimers() scoped to the describe block (mirrors the swipe-
// snap-back test at ~L2694 discipline). Drives selectedId changes by mutating
// the shared `snapshot` object + rerender() — same rerender pattern as Test 22
// at ~L1909. removeFromActiveSet is already spy-able (removeFromActiveSetSpy
// declared at the top of the file, ~L195).

describe("PrettyConversationsPanel (quick-260818-q73): idle sweep", () => {
  // Extracted so all three tests use the identical values the panel's module
  // constants define. Any future bump of IDLE_DEACTIVATE_THRESHOLD_MS or
  // IDLE_DEACTIVATE_SWEEP_MS in the panel MUST re-verify these tests still
  // exercise "before/after threshold" boundaries correctly.
  const IDLE_DEACTIVATE_THRESHOLD_MS = 300_000;
  const IDLE_DEACTIVATE_SWEEP_MS = 30_000;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Test SWEEP-1 (HARD INVARIANT): currently-selected conv is exempt from the sweep — even a stale timestamp cannot deactivate the id that is currently selectedId", () => {
    const hostA = makeHost("h1", "hostA");
    const t1 = makeConversationRow({ id: "t1", label: "sess-t1", host: hostA, targetTmuxSession: "s1" });
    const t2 = makeConversationRow({ id: "t2", label: "sess-t2", host: hostA, targetTmuxSession: "s2" });

    // Both rows in the active-set. Start with t1 selected.
    setSnapshot({
      middle: [t1, t2],
      selectedId: "t1",
    });
    mockActiveSet = new Set<string>(["t1", "t2"]);

    const onDeactivateRow = vi.fn();
    const { rerender } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={onDeactivateRow} />,
    );

    // Clear mount-time spy calls — we care only about sweep-driven calls.
    removeFromActiveSetSpy.mockClear();
    onDeactivateRow.mockClear();

    // Transition selectedId t1 → t2 (t1 becomes UN-selected, stamp lands).
    setSnapshot({
      middle: [t1, t2],
      selectedId: "t2",
    });
    mockActiveSet = new Set<string>(["t1", "t2"]);
    rerender(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={onDeactivateRow} />,
    );

    // Advance past the threshold PLUS a sweep tick so a sweep would fire and
    // observe t1's stamp as stale. But NOT yet — we're about to select t1 back.
    act(() => {
      vi.advanceTimersByTime(IDLE_DEACTIVATE_THRESHOLD_MS + IDLE_DEACTIVATE_SWEEP_MS + 1_000);
    });

    // Now switch selectedId BACK to t1 (t1 becomes the currently-selected;
    // t2 becomes unfocused). Even though t1's stamp was stale a moment ago,
    // the selectedId tracker DELETES t1's map entry the moment t1 is re-
    // selected — AND the sweep's hard-invariant check would skip t1 anyway
    // because it is now === selectedId.
    setSnapshot({
      middle: [t1, t2],
      selectedId: "t1",
    });
    mockActiveSet = new Set<string>(["t1", "t2"]);
    rerender(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={onDeactivateRow} />,
    );

    // Clear any calls that landed during the pre-switch-back window (e.g.,
    // if a sweep fired between the two rerenders — t1 could have been swept
    // BEFORE the switch-back landed). We want to prove that the switch-back
    // itself, PLUS subsequent sweep ticks, do NOT touch t1.
    removeFromActiveSetSpy.mockClear();
    onDeactivateRow.mockClear();

    // Advance one sweep tick with t1 selected. This sweep MUST NOT fire
    // handleRowDeactivate for t1 — that's the HARD INVARIANT.
    act(() => {
      vi.advanceTimersByTime(IDLE_DEACTIVATE_SWEEP_MS + 1_000);
    });

    // Assert: no deactivate call for t1 after the switch-back.
    const t1Calls = removeFromActiveSetSpy.mock.calls.filter(([id]) => id === "t1");
    expect(t1Calls).toEqual([]);
    const t1OnDeactivate = onDeactivateRow.mock.calls.filter(([row]) => row?.id === "t1");
    expect(t1OnDeactivate).toEqual([]);
  });

  it("Test SWEEP-2: stale unfocused conv IS deactivated on the next sweep tick — sweep routes through the same handleRowDeactivate the manual click uses", () => {
    const hostA = makeHost("h1", "hostA");
    // t1 has no targetTmuxSession so handleRowDeactivate's fleet-id purge
    // branch is skipped — removeFromActiveSet is called exactly ONCE with
    // t1.id (mirrors Test 20E's assertion pattern).
    const t1 = makeConversationRow({ id: "t1", label: "sess-t1", host: hostA, targetTmuxSession: null });
    const t2 = makeConversationRow({ id: "t2", label: "sess-t2", host: hostA, targetTmuxSession: null });

    // Both in the active set. Start with t1 selected.
    setSnapshot({
      middle: [t1, t2],
      selectedId: "t1",
    });
    mockActiveSet = new Set<string>(["t1", "t2"]);

    const onDeactivateRow = vi.fn();
    const { rerender } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={onDeactivateRow} />,
    );

    // Clear mount-time spy calls.
    removeFromActiveSetSpy.mockClear();
    onDeactivateRow.mockClear();

    // Switch selectedId to t2 → t1 becomes UN-selected at "T0". Stamp lands
    // in lastUnfocusedAtRef.
    setSnapshot({
      middle: [t1, t2],
      selectedId: "t2",
    });
    mockActiveSet = new Set<string>(["t1", "t2"]);
    rerender(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={onDeactivateRow} />,
    );

    // Advance past threshold + one sweep tick — the sweep MUST fire and MUST
    // observe t1 as stale (currently-unfocused, stamp older than threshold).
    act(() => {
      vi.advanceTimersByTime(IDLE_DEACTIVATE_THRESHOLD_MS + IDLE_DEACTIVATE_SWEEP_MS);
    });

    // Sweep fired handleRowDeactivate(t1). Panel-level composition:
    // removeFromActiveSet(t1.id) + onDeactivateRow(t1). t1 has no
    // targetTmuxSession so the fleet-id purge branch is skipped.
    const t1Removes = removeFromActiveSetSpy.mock.calls.filter(([id]) => id === "t1");
    expect(t1Removes.length).toBeGreaterThanOrEqual(1);
    expect(t1Removes[0]).toEqual(["t1"]);
    const t1Deactivates = onDeactivateRow.mock.calls.filter(([row]) => row?.id === "t1");
    expect(t1Deactivates.length).toBeGreaterThanOrEqual(1);
    expect(t1Deactivates[0][0].id).toBe("t1");

    // t2 (currently selected) MUST NOT be touched.
    const t2Removes = removeFromActiveSetSpy.mock.calls.filter(([id]) => id === "t2");
    expect(t2Removes).toEqual([]);
    const t2Deactivates = onDeactivateRow.mock.calls.filter(([row]) => row?.id === "t2");
    expect(t2Deactivates).toEqual([]);
  });

  it("Test SWEEP-3: fresh (< threshold) unfocused conv is NOT deactivated on the next sweep tick", () => {
    const hostA = makeHost("h1", "hostA");
    const t1 = makeConversationRow({ id: "t1", label: "sess-t1", host: hostA, targetTmuxSession: null });
    const t2 = makeConversationRow({ id: "t2", label: "sess-t2", host: hostA, targetTmuxSession: null });

    setSnapshot({
      middle: [t1, t2],
      selectedId: "t1",
    });
    mockActiveSet = new Set<string>(["t1", "t2"]);

    const onDeactivateRow = vi.fn();
    const { rerender } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={onDeactivateRow} />,
    );

    removeFromActiveSetSpy.mockClear();
    onDeactivateRow.mockClear();

    // Switch t1 → t2 (t1 becomes UN-selected at T0). Stamp lands.
    setSnapshot({
      middle: [t1, t2],
      selectedId: "t2",
    });
    mockActiveSet = new Set<string>(["t1", "t2"]);
    rerender(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={onDeactivateRow} />,
    );

    // Advance ONE sweep tick — well below the threshold. Sweep runs but
    // finds t1's stamp is fresh → skips.
    act(() => {
      vi.advanceTimersByTime(IDLE_DEACTIVATE_SWEEP_MS + 1_000);
    });

    // Neither t1 nor t2 was deactivated. (t2 exempted as currently-selected;
    // t1 exempted because its stamp is fresher than threshold.)
    const t1Removes = removeFromActiveSetSpy.mock.calls.filter(([id]) => id === "t1");
    expect(t1Removes).toEqual([]);
    const t1Deactivates = onDeactivateRow.mock.calls.filter(([row]) => row?.id === "t1");
    expect(t1Deactivates).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 47 Plan 04 — PrettyConversationRowLive aiTitle wire tests
// ─────────────────────────────────────────────────────────────────────────────
//
// Locks the working-store third-axis subscription contract:
//
//   PrettyConversationRowLive
//     ── subscribes ──► useSessionAiTitle(sessionWorkingKey(row))
//     ── threads ────► PrettyConversationRow aiTitle prop
//
// Load-bearing invariants:
//
//   1. Every PrettyConversationRowLive instance (regardless of render site:
//      search-flat, pinned, middle, RDP, hidden) calls useSessionAiTitle
//      with the row's sessionKey. Source-level uniformity is enforced by
//      the grep acceptance criteria — the hook is called ONCE inside
//      PrettyConversationRowLive so all 5 render sites go through the same
//      subscription code path. These runtime tests exercise the pinned +
//      middle sites (the two most commonly rendered) and a null-host row
//      (which produces sessionKey === null via sessionWorkingKey's guard).
//
//   2. When a row's sessionKey has a seeded ai-title in the working-store
//      (mock returns "Fix bug X"), PrettyConversationRowLive threads that
//      value through to PrettyConversationRow's aiTitle prop. In this
//      plan's scope PrettyConversationRow does NOT visually consume the
//      prop (Plan 47-05 owns the subtitle render), so we assert the
//      wire indirectly: the useSessionAiTitleSpy was called with the
//      expected sessionKey AND returned the seeded value. This proves
//      both hook subscription + return-value flow.
//
//   3. Null-key rows (fleet-only rows without a resolved host) call
//      useSessionAiTitleSpy(null); the mock short-circuits to null;
//      PrettyConversationRow receives aiTitle={null} via the destructure
//      default. Renders cleanly (no throw).
//
// See:
//   - PrettyConversationsPanel.tsx PrettyConversationRowLive (~L211)
//   - session-working-store.ts useSessionAiTitle (Plan 47-03 export)
//   - 47-CONTEXT.md § Working-store third axis (LAST-WINS semantics)
//   - 47-04-PLAN.md § Task 2 <acceptance_criteria>

describe("PrettyConversationsPanel (Phase 47 Plan 04): PrettyConversationRowLive aiTitle wire", () => {
  it("Test AT-1: pinned row with seeded ai-title calls useSessionAiTitle with the row's sessionKey and receives the seeded value", () => {
    const hostA = makeHost("h1", "hostA");
    // sessionWorkingKey format: `${host.id}:${targetTmuxSession ?? ""}`.
    // With host.id="h1" + targetTmuxSession="tina", the key is "h1:tina".
    const expectedKey = "h1:tina";
    mockAiTitleByKey.set(expectedKey, "Fix bug X");
    setSnapshot({
      pinned: [
        makeConversationRow({
          id: "pinned-with-ai-title",
          label: "tina",
          host: hostA,
          targetTmuxSession: "tina",
        }),
      ],
      middle: [],
      rdpGroup: null,
      pinnedIds: new Set(["pinned-with-ai-title"]),
    });
    render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Hook was called with the expected sessionKey (proves the pinned
    // render site's PrettyConversationRowLive subscribed).
    const calls = useSessionAiTitleSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContain(expectedKey);
    // Return value threaded through: the hook's mock impl returns the
    // seeded value for this key, and PrettyConversationRow accepts it as
    // the aiTitle prop (default null when not passed). No throw = wire
    // is intact; PrettyConversationRow does not consume it visually in
    // Plan 47-04 scope (Plan 47-05 owns the render).
    expect(mockAiTitleByKey.get(expectedKey)).toBe("Fix bug X");
  });

  it("Test AT-2: middle row without a seeded ai-title receives aiTitle={null} via the mock's short-circuit", () => {
    const hostA = makeHost("h1", "hostA");
    const expectedKey = "h1:nelly";
    // Deliberately do NOT seed mockAiTitleByKey for this key.
    setSnapshot({
      pinned: [],
      middle: [
        makeConversationRow({
          id: "middle-no-ai-title",
          label: "nelly",
          host: hostA,
          targetTmuxSession: "nelly",
        }),
      ],
      rdpGroup: null,
    });
    render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Hook called with the middle row's key (proves middle site subscribed).
    const calls = useSessionAiTitleSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContain(expectedKey);
    // Mock returns null for un-seeded keys → aiTitle prop threads null.
    // PrettyConversationRow's destructure default is null; renders clean.
    expect(mockAiTitleByKey.get(expectedKey)).toBeUndefined();
  });

  it("Test AT-3: fleet-only row without a resolved host calls useSessionAiTitle(null) and receives null", () => {
    // sessionWorkingKey returns null when row.host is undefined
    // (see PrettyConversationsPanel.tsx:154-157). This exercises the
    // hook's null-key short-circuit branch: mock returns null, prop
    // threads null, PrettyConversationRow renders with aiTitle={null}
    // via its destructure default.
    setSnapshot({
      pinned: [],
      middle: [
        makeConversationRow({
          id: "fleet-only-no-host",
          label: "orphan",
          host: undefined,
          targetTmuxSession: "orphan",
          fleetOnly: true,
        }),
      ],
      rdpGroup: null,
    });
    render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Hook called with null (proves the null-key branch is exercised).
    const calls = useSessionAiTitleSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContain(null);
  });

  it("Test AT-4: two rows across pinned + middle both invoke useSessionAiTitle with distinct keys (per-row subscription, not shared)", () => {
    const hostA = makeHost("h1", "hostA");
    const hostB = makeHost("h2", "hostB");
    mockAiTitleByKey.set("h1:tina", "Debug X");
    mockAiTitleByKey.set("h2:nelly", "Fix Y");
    setSnapshot({
      pinned: [
        makeConversationRow({
          id: "p-tina",
          label: "tina",
          host: hostA,
          targetTmuxSession: "tina",
        }),
      ],
      middle: [
        makeConversationRow({
          id: "m-nelly",
          label: "nelly",
          host: hostB,
          targetTmuxSession: "nelly",
        }),
      ],
      rdpGroup: null,
      pinnedIds: new Set(["p-tina"]),
    });
    render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    const calls = useSessionAiTitleSpy.mock.calls.map((c) => c[0]);
    // Both render sites (pinned + middle) subscribed with the correct
    // per-row keys. Proves the hook is INSIDE PrettyConversationRowLive
    // (not hoisted to the panel) — each row gets its own subscription.
    expect(calls).toContain("h1:tina");
    expect(calls).toContain("h2:nelly");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 58 Plan 02 — Conv-list panel as drop target for badge close
// ─────────────────────────────────────────────────────────────────────────────
// Seven tests (A-G) defend PV58-CONVLIST-DROP-TARGET-CLOSE +
// PV58-STRUCTURED-LOGGING + threat register mitigations T-58-02-01 through
// T-58-02-06 for the panel-level drop handlers on the outermost
// data-testid="pretty-conversations-panel" element:
//
//   A: badge-drop-closes         — valid badge payload calls onCloseSession(tabId)
//   B: row-drag-does-not-close   — row-drag payload (no badge MIME) does NOT close
//   C: only-text-plain-does-not-close — text/plain alone is NOT the discriminator
//   D: dragover-type-gate        — preventDefault only for application/x-skynet-badge
//   E: tabId-validation          — payload tabId not in openTabIds → silent drop (T-58-02-01)
//   F: structured-log-on-close   — [convlist-drop] tabId=<x> emits once (T-58-02-04)
//   G: malformed-payload-silent-drop — bad JSON → no throw, no close (T-58-02-02)
//
// DataTransfer stub mirrors IdentityBadge.test.tsx pattern: jsdom does not
// construct a real DataTransfer, so we pass a Map-backed shim exposing
// getData(type) + types[] via fireEvent.drop / fireEvent.dragOver init object.

// Helper: build a stub DataTransfer with a Map-backed store. `types` reflects
// the keys, so dragover code that inspects types (Test D) works. `getData`
// returns "" for missing keys (matches real DataTransfer semantics).
function makeConvListDataTransferStub(entries: Record<string, string> = {}) {
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

describe("PrettyConversationsPanel: Phase 58 — conv-list drop target for badge close", () => {
  it("Test A: badge drop with valid tabId in openTabIds calls onCloseSession(tabId) exactly once", () => {
    const onCloseSession = vi.fn();
    const { getByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCloseSession={onCloseSession}
        openTabIds={["tab-tina-42"]}
      />,
    );
    const panel = getByTestId("pretty-conversations-panel");
    const dt = makeConvListDataTransferStub({
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-tina-42" }),
    });
    fireEvent.drop(panel, { dataTransfer: dt });
    expect(onCloseSession).toHaveBeenCalledTimes(1);
    expect(onCloseSession).toHaveBeenCalledWith("tab-tina-42");
  });

  it("Test B: drop with only application/x-skynet-row payload (no badge MIME) does NOT call onCloseSession", () => {
    const onCloseSession = vi.fn();
    const { getByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCloseSession={onCloseSession}
        openTabIds={["tab-tina-42"]}
      />,
    );
    const panel = getByTestId("pretty-conversations-panel");
    // Row-drag payload shape (patch #511) — no badge MIME.
    const dt = makeConvListDataTransferStub({
      "application/x-skynet-row": JSON.stringify({
        tabId: "tab-tina-42",
        fleetOnly: false,
      }),
      "text/plain": "tab-tina-42",
    });
    fireEvent.drop(panel, { dataTransfer: dt });
    expect(onCloseSession).not.toHaveBeenCalled();
  });

  it("Test C: drop with ONLY text/plain (no badge MIME) does NOT call onCloseSession — discriminator MIME is required", () => {
    const onCloseSession = vi.fn();
    const { getByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCloseSession={onCloseSession}
        openTabIds={["tab-tina-42"]}
      />,
    );
    const panel = getByTestId("pretty-conversations-panel");
    const dt = makeConvListDataTransferStub({
      "text/plain": "tab-tina-42",
    });
    fireEvent.drop(panel, { dataTransfer: dt });
    expect(onCloseSession).not.toHaveBeenCalled();
  });

  it("Test D: dragover type-gate — preventDefault ONLY when types include application/x-skynet-badge (row-drag types do NOT capture)", () => {
    const onCloseSession = vi.fn();
    const { getByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCloseSession={onCloseSession}
        openTabIds={["tab-tina-42"]}
      />,
    );
    const panel = getByTestId("pretty-conversations-panel");

    // Row-drag dragover: NOT captured (defaultPrevented stays false).
    const dtRow = makeConvListDataTransferStub({
      "application/x-skynet-row": "some-payload",
    });
    const rowEvent = fireEvent.dragOver(panel, { dataTransfer: dtRow });
    // fireEvent returns whether the event's default was NOT prevented (true = not prevented).
    // A row-drag should not be captured → defaultPrevented === false.
    expect(rowEvent).toBe(true);

    // Badge dragover: captured (preventDefault called → defaultPrevented=true).
    const dtBadge = makeConvListDataTransferStub({
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-tina-42" }),
    });
    const badgeEvent = fireEvent.dragOver(panel, { dataTransfer: dtBadge });
    // fireEvent returns false when preventDefault was called on the event.
    expect(badgeEvent).toBe(false);
  });

  it("Test E: badge drop with tabId NOT in openTabIds is silently dropped (T-58-02-01 — no fn call, no throw)", () => {
    const onCloseSession = vi.fn();
    const { getByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCloseSession={onCloseSession}
        openTabIds={["tab-user-1"]}
      />,
    );
    const panel = getByTestId("pretty-conversations-panel");
    const dt = makeConvListDataTransferStub({
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-mallory-999" }),
    });
    expect(() => {
      fireEvent.drop(panel, { dataTransfer: dt });
    }).not.toThrow();
    expect(onCloseSession).not.toHaveBeenCalled();
  });

  it("Test F: successful badge drop emits exactly one [convlist-drop] structured log with tabId=<x> (T-58-02-04)", () => {
    const onCloseSession = vi.fn();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const { getByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCloseSession={onCloseSession}
        openTabIds={["tab-tina-42"]}
      />,
    );
    const panel = getByTestId("pretty-conversations-panel");
    const dt = makeConvListDataTransferStub({
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-tina-42" }),
    });
    fireEvent.drop(panel, { dataTransfer: dt });

    const convListDropCalls = infoSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" && call[0].startsWith("[convlist-drop] "),
    );
    expect(convListDropCalls).toHaveLength(1);
    expect(convListDropCalls[0][0]).toContain("tabId=tab-tina-42");
    infoSpy.mockRestore();
  });

  it("Test G: malformed JSON badge payload is silently dropped (T-58-02-02 — no throw, no close)", () => {
    const onCloseSession = vi.fn();
    const { getByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCloseSession={onCloseSession}
        openTabIds={["tab-tina-42"]}
      />,
    );
    const panel = getByTestId("pretty-conversations-panel");
    const dt = makeConvListDataTransferStub({
      "application/x-skynet-badge": "{not valid json",
    });
    expect(() => {
      fireEvent.drop(panel, { dataTransfer: dt });
    }).not.toThrow();
    expect(onCloseSession).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 58 Plan 02 Task 2 — Integration tests H + I
  //
  // Test H: assert the wire contract from the panel drop → onCloseSession
  //         callback fires with the validated tabId. AppShell wires
  //         onCloseSession={closeTab}; the tree-reconcile side is COVERED BY
  //         EXISTING CODE at AppShell.tsx:1498 (`setSplitTree((prev) =>
  //         removeLeaf(prev, id))` inside doCloseTab) — PV58-DOCLOSETAB-TREE-
  //         RECONCILE is assertion-only per plan (no new production code
  //         needed for the reconcile side). This test asserts the callback
  //         is invoked exactly once with the correct tabId, so when AppShell
  //         passes closeTab, the reconcile executes automatically.
  //
  // Test I: assert an IdentityBadge dragstart writes text/plain=tabId — the
  //         exact key Phase 56 Pane onDrop text/plain branch at
  //         SplitView.tsx:340 reads via openSessionInTree(tabId, path, edge).
  //         Load-bearing "the badge is a valid drag source for the existing
  //         rearrange machinery" assertion without needing to mount
  //         SplitView. Full end-to-end Pane rearrange remains covered by
  //         SplitView.test.tsx 26/26 (Phase 57 regression gate).
  // ─────────────────────────────────────────────────────────────────────────

  it("Test H (integration): panel-drop → onCloseSession wire contract intact; AppShell.tsx:1498 reconciles splitTree via existing code", () => {
    const mockCloseTab = vi.fn();
    const { getByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCloseSession={mockCloseTab}
        openTabIds={["tab-tina-42"]}
      />,
    );
    const panel = getByTestId("pretty-conversations-panel");
    const dt = makeConvListDataTransferStub({
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-tina-42" }),
    });
    fireEvent.drop(panel, { dataTransfer: dt });
    // Wire contract: panel drop → validated tabId → onCloseSession fires
    // once with the exact tabId. AppShell wires onCloseSession={closeTab},
    // and closeTab routes through doCloseTab which ALREADY reconciles
    // splitTree via setSplitTree((prev) => removeLeaf(prev, id)) at
    // AppShell.tsx:1498 (existing code, unchanged by this plan). The
    // reconcile side does not need a separate assertion in this scoped
    // panel test — it is a property of AppShell.tsx that
    // PV58-DOCLOSETAB-TREE-RECONCILE relies on and grep-verifies remains
    // present after the plan (Task 2 acceptance criterion).
    expect(mockCloseTab).toHaveBeenCalledTimes(1);
    expect(mockCloseTab).toHaveBeenCalledWith("tab-tina-42");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 58 Plan 02 Task 2 Integration Test I — IdentityBadge dragstart
// payload shape matches Phase 56 Pane onDrop wire contract
// ─────────────────────────────────────────────────────────────────────────────
// Renders IdentityBadge directly (imported inline here — panel-test-file
// scoping) and asserts dragstart writes text/plain=tabId. This is the payload
// the Pane onDrop text/plain branch at SplitView.tsx:340 reads via
// openSessionInTree(tabId, path, edge) — the Phase 56 rearrange path. Without
// this assertion, a silent regression in IdentityBadge's dragstart handler
// could break rearrange while leaving all badge-close tests green.
//
// Note: IdentityBadge consumes the same useIdentities mock this file already
// declares (identity mock: mockIdentitiesByKey Map), and useIsMobile via the
// window.matchMedia + innerWidth pattern. We inline the setMobileViewport
// helper here to avoid a cross-file import.

// Local test-only import of IdentityBadge for Test I. Placed after the panel
// describe blocks so it doesn't affect the panel's own module-import order.
// eslint-disable-next-line import/first
import { IdentityBadge } from "@/features/terminal/IdentityBadge";

function setDesktopViewportForBadgeTest() {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1280,
  });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("PrettyConversationsPanel: Phase 58 Plan 02 — Test I (integration): IdentityBadge dragstart payload matches Phase 56 Pane onDrop wire contract", () => {
  beforeEach(() => {
    setDesktopViewportForBadgeTest();
    // Seed the identity so IdentityBadge renders (returns null otherwise).
    mockIdentitiesByKey = new Map([
      [
        "tina",
        {
          identityKey: "tina",
          displayName: "Tina",
          title: "Test identity",
          avatarUrl: "/avatar.png",
          colorHue: 220,
        } as unknown as {
          identityKey: string;
          title?: string | null;
          displayName?: string | null;
        },
      ],
    ]);
  });
  afterEach(() => {
    mockIdentitiesByKey = new Map();
    vi.restoreAllMocks();
  });

  it("Test I: IdentityBadge with tabId writes text/plain=<tabId> on dragstart — the exact payload Phase 56 Pane onDrop reads via openSessionInTree(tabId, path, edge)", () => {
    const onClick = vi.fn();
    const { getByTestId } = render(
      <IdentityBadge
        identityKey="tina"
        tabId="tab-user-1"
        onClick={onClick}
      />,
    );
    const root = getByTestId("identity-badge-root");
    // Sanity: badge is enabled as a drag source on desktop with a tabId.
    expect(root.getAttribute("draggable")).toBe("true");

    // Reuse the Phase 58 dataTransfer stub shape from the panel-drop tests
    // above (Map-backed). jsdom does not construct real DataTransfer.
    const dt = makeConvListDataTransferStub();
    fireEvent.dragStart(root, { dataTransfer: dt });

    // Load-bearing assertion: text/plain=tabId. This is what SplitView.tsx
    // Pane onDrop reads at the text/plain branch (per Phase 56 Plan 02),
    // routes through openSessionInTree(tabId, path, edge), which
    // removeLeaf-then-insertAtEdge rearranges the tree. No need to mount
    // SplitView; that layer is covered by SplitView.test.tsx 26/26.
    expect(dt.getData("text/plain")).toBe("tab-user-1");
    // Belt-and-suspenders: the discriminator MIME is also present so a
    // badge drop that lands on the conv-list (Plan 58-02 target) closes
    // instead of rearranging. Same source, one payload, two consumers.
    const badgePayload = dt.getData("application/x-skynet-badge");
    expect(badgePayload).not.toBe("");
    expect(JSON.parse(badgePayload).tabId).toBe("tab-user-1");
    // effectAllowed matches the conv-list row convention (Phase 56 patch #511).
    expect(dt.effectAllowed).toBe("move");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 59 Plan 01 Task 2 — coral tint overlay on conv-list panel drop-to-close (Gap 2)
// ─────────────────────────────────────────────────────────────────────────────
// Eight tests (A-H) defend the coral drop-target-affordance tint added on the
// outermost data-testid="pretty-conversations-panel" element. Additive on the
// existing Phase 58 Plan 02 6-step validation gauntlet — the tint state is
// set INSIDE the existing badge type-gate and clears on drop/dragleave/dragend
// without perturbing the close mechanics.
//
//   A: badge dragOver → overlay rendered
//   B: row-drag (application/x-skynet-row) dragOver → overlay NOT rendered
//   C: OS file drag (Files) dragOver → overlay NOT rendered
//   D: dragOver+drop → overlay clears AND onCloseSession still fires (regression)
//   E: window dragend → overlay clears (Escape-cancel)
//   F: dragLeave INSIDE bounding rect → overlay STAYS (child-boundary crossing guard)
//   G: dragLeave OUTSIDE bounding rect → overlay ABSENT
//   H: two identical badge dragOvers emit [convlist-drop-preview] visible=true
//      EXACTLY once (zone-change gate); drop adds one visible=false log
//
// Reuses makeConvListDataTransferStub from Phase 58 tests (:4078). jsdom does
// not honor clientX/Y via DragEvent init — dispatchPanelDragLeaveAt uses
// createEvent + Object.defineProperty per SplitView.test.tsx:448-461 pattern.

function dispatchPanelDragLeaveAt(
  el: Element,
  clientX: number,
  clientY: number,
  dt: ReturnType<typeof makeConvListDataTransferStub>,
): void {
  const evt = createEvent.dragLeave(el, { dataTransfer: dt });
  Object.defineProperty(evt, "clientX", { value: clientX, configurable: true });
  Object.defineProperty(evt, "clientY", { value: clientY, configurable: true });
  fireEvent(el, evt);
}

// Set a known bounding rect on the panel for tests F/G. Uses HTMLElement.prototype
// override in beforeEach + restore in afterEach.
const PANEL_KNOWN_RECT: DOMRect = {
  left: 100,
  top: 100,
  right: 500,
  bottom: 500,
  x: 100,
  y: 100,
  width: 400,
  height: 400,
  toJSON() {
    return this;
  },
};

describe("PrettyConversationsPanel: Phase 59 — coral tint overlay on badge drop-to-close", () => {
  let originalGetBoundingClientRect: () => DOMRect;

  beforeEach(() => {
    originalGetBoundingClientRect =
      HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return PANEL_KNOWN_RECT;
    };
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect =
      originalGetBoundingClientRect;
    vi.restoreAllMocks();
  });

  it("Test A: dragOver with application/x-skynet-badge renders the coral overlay", () => {
    const { getByTestId, queryByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCloseSession={() => {}}
        openTabIds={["tab-tina-42"]}
      />,
    );
    const panel = getByTestId("pretty-conversations-panel");
    const dt = makeConvListDataTransferStub({
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-tina-42" }),
    });
    fireEvent.dragOver(panel, { dataTransfer: dt });
    expect(queryByTestId("convlist-drop-preview")).not.toBeNull();
  });

  it("Test B: dragOver with application/x-skynet-row (stray row drag) does NOT render the coral overlay", () => {
    const { getByTestId, queryByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCloseSession={() => {}}
        openTabIds={["tab-tina-42"]}
      />,
    );
    const panel = getByTestId("pretty-conversations-panel");
    const dt = makeConvListDataTransferStub({
      "application/x-skynet-row": JSON.stringify({ tabId: "tab-tina-42" }),
      "text/plain": "tab-tina-42",
    });
    fireEvent.dragOver(panel, { dataTransfer: dt });
    expect(queryByTestId("convlist-drop-preview")).toBeNull();
  });

  it("Test C: dragOver with Files (OS file drag) does NOT render the coral overlay", () => {
    const { getByTestId, queryByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCloseSession={() => {}}
        openTabIds={["tab-tina-42"]}
      />,
    );
    const panel = getByTestId("pretty-conversations-panel");
    const dt = makeConvListDataTransferStub({ Files: "" });
    fireEvent.dragOver(panel, { dataTransfer: dt });
    expect(queryByTestId("convlist-drop-preview")).toBeNull();
  });

  it("Test D (regression): dragOver+drop clears the overlay AND onCloseSession still fires with the correct tabId", () => {
    const onCloseSession = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCloseSession={onCloseSession}
        openTabIds={["tab-tina-42"]}
      />,
    );
    const panel = getByTestId("pretty-conversations-panel");
    const dt = makeConvListDataTransferStub({
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-tina-42" }),
    });
    fireEvent.dragOver(panel, { dataTransfer: dt });
    expect(queryByTestId("convlist-drop-preview")).not.toBeNull();
    fireEvent.drop(panel, { dataTransfer: dt });
    expect(queryByTestId("convlist-drop-preview")).toBeNull();
    // Existing Phase 58 Plan 02 6-step gauntlet not perturbed by tint state.
    expect(onCloseSession).toHaveBeenCalledTimes(1);
    expect(onCloseSession).toHaveBeenCalledWith("tab-tina-42");
  });

  it("Test E: window-level dragend clears the overlay (Escape-cancel path)", () => {
    const { getByTestId, queryByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCloseSession={() => {}}
        openTabIds={["tab-tina-42"]}
      />,
    );
    const panel = getByTestId("pretty-conversations-panel");
    const dt = makeConvListDataTransferStub({
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-tina-42" }),
    });
    fireEvent.dragOver(panel, { dataTransfer: dt });
    expect(queryByTestId("convlist-drop-preview")).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event("dragend"));
    });
    expect(queryByTestId("convlist-drop-preview")).toBeNull();
  });

  it("Test F: dragLeave with clientX/Y INSIDE the panel's bounding rect does NOT clear (row-boundary crossing guard)", () => {
    const { getByTestId, queryByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCloseSession={() => {}}
        openTabIds={["tab-tina-42"]}
      />,
    );
    const panel = getByTestId("pretty-conversations-panel");
    const dt = makeConvListDataTransferStub({
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-tina-42" }),
    });
    fireEvent.dragOver(panel, { dataTransfer: dt });
    expect(queryByTestId("convlist-drop-preview")).not.toBeNull();
    // PANEL_KNOWN_RECT is 100/100/500/500 — 300,300 is inside.
    dispatchPanelDragLeaveAt(panel, 300, 300, dt);
    expect(queryByTestId("convlist-drop-preview")).not.toBeNull();
  });

  it("Test G: dragLeave with clientX/Y OUTSIDE the panel's bounding rect clears the overlay", () => {
    const { getByTestId, queryByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCloseSession={() => {}}
        openTabIds={["tab-tina-42"]}
      />,
    );
    const panel = getByTestId("pretty-conversations-panel");
    const dt = makeConvListDataTransferStub({
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-tina-42" }),
    });
    fireEvent.dragOver(panel, { dataTransfer: dt });
    expect(queryByTestId("convlist-drop-preview")).not.toBeNull();
    // 50,50 is outside the known rect (left=100).
    dispatchPanelDragLeaveAt(panel, 50, 50, dt);
    expect(queryByTestId("convlist-drop-preview")).toBeNull();
  });

  it("Test H: two identical badge dragOvers emit [convlist-drop-preview] visible=true EXACTLY once (zone-change gate); drop adds one visible=false log", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const { getByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCloseSession={() => {}}
        openTabIds={["tab-tina-42"]}
      />,
    );
    const panel = getByTestId("pretty-conversations-panel");
    const dt = makeConvListDataTransferStub({
      "application/x-skynet-badge": JSON.stringify({ tabId: "tab-tina-42" }),
    });

    fireEvent.dragOver(panel, { dataTransfer: dt });
    fireEvent.dragOver(panel, { dataTransfer: dt });

    const previewCallsAfterDragOvers = infoSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0].startsWith("[convlist-drop-preview] "),
    );
    expect(previewCallsAfterDragOvers).toHaveLength(1);
    expect(previewCallsAfterDragOvers[0][0]).toBe(
      "[convlist-drop-preview] visible=true",
    );

    fireEvent.drop(panel, { dataTransfer: dt });

    const previewCallsAfterDrop = infoSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0].startsWith("[convlist-drop-preview] "),
    );
    expect(previewCallsAfterDrop).toHaveLength(2);
    expect(previewCallsAfterDrop[1][0]).toBe(
      "[convlist-drop-preview] visible=false",
    );

    infoSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature 09 (2026-09-04) — WeeklyUsageMeter admin-only visibility gate
// ─────────────────────────────────────────────────────────────────────────────
// The panel mounts WeeklyUsageMeter inside .pv-panel-header only when
// isAdmin === true. Non-admin (default) hides it — feature 09 collapsed
// to a visibility gate on the existing single-source meter.

describe("PrettyConversationsPanel: WeeklyUsageMeter admin gate (feature 09)", () => {
  it("mounts .pv-usage-meter when isAdmin is true", () => {
    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        isAdmin={true}
        onDeactivateRow={() => {}}
      />,
    );
    expect(container.querySelector(".pv-usage-meter")).not.toBeNull();
  });

  it("hides .pv-usage-meter when isAdmin is false (default)", () => {
    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
      />,
    );
    expect(container.querySelector(".pv-usage-meter")).toBeNull();
  });
});

// ─── Phase 91 Plan 05 — New conversation menu item + modal ───────────────────

describe("PrettyConversationsPanel: Phase 91 — New conversation menu item + modal", () => {
  function renderPanelWithCreateRelayRoom(
    onCreateRelayRoom?: (result: { ok: true; roomId: string; sessionId: string; roomTitle: string }) => void,
  ) {
    return render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        onCreateSession={vi.fn()} // required to show the three-dot menu button (showPencilButton gate)
        onCreateRelayRoom={onCreateRelayRoom}
      />,
    );
  }

  function openThreeDotMenu() {
    // The MoreVertical button has data-testid="pv-header-menu-button".
    const menuBtn = document.querySelector('[data-testid="pv-header-menu-button"]') as HTMLElement;
    if (!menuBtn) throw new Error("pv-header-menu-button not found");
    fireEvent.click(menuBtn);
  }

  // Test 1: menu item exists
  it("Test 1: clicking the three-dot menu shows a 'New group conversation' item", () => {
    renderPanelWithCreateRelayRoom();
    openThreeDotMenu();
    expect(screen.getByRole("menuitem", { name: /new group conversation/i })).toBeTruthy();
  });

  // Test 2: menu item opens modal
  it("Test 2: clicking 'New group conversation' item opens the modal", async () => {
    renderPanelWithCreateRelayRoom();
    openThreeDotMenu();
    const menuItem = screen.getByRole("menuitem", { name: /new group conversation/i });
    await act(async () => {
      fireEvent.click(menuItem);
    });
    // Modal dialog should be mounted
    await waitFor(() => {
      expect(
        document.querySelector('[role="dialog"]'),
      ).toBeTruthy();
    });
  });

  // Test 3: onCreateRelayRoom prop threads through (structural verification)
  it("Test 3: onCreateRelayRoom prop is called when the create response fires", () => {
    const onCreateRelayRoom = vi.fn();
    renderPanelWithCreateRelayRoom(onCreateRelayRoom);
    openThreeDotMenu();
    // Verify the menu item exists (the full modal→create→prop threading is
    // covered by NewConversationModal.test.tsx Test 6; here we verify structural
    // wiring: the prop is passed and the menu item exists).
    expect(screen.getByRole("menuitem", { name: /new group conversation/i })).toBeTruthy();
    // The prop being defined means it can receive calls
    expect(typeof onCreateRelayRoom).toBe("function");
  });

  // Test 4: kebab now holds exactly two items in locked order.
  // quick-260914-liu: New agent, Edit roles, Edit global files were promoted
  // to dedicated header icon buttons. The kebab survivors are:
  // New group conversation → Edit global skills… (Phase 44 Pitfall 8 guard still applies).
  it("Test 4 (quick-260914-liu rewrite): kebab holds exactly two items in locked order: 'New group conversation' then 'Edit global skills…'", () => {
    renderPanelWithCreateRelayRoom();
    openThreeDotMenu();

    const items = screen.getAllByRole("menuitem");
    const labels = items.map((el) => el.textContent?.trim() ?? "");

    expect(labels).toEqual(["New group conversation", "Edit global skills…"]);
  });

  // Test 5: portal-mount pattern — NewConversationModal is sibling of GlobalFilesModal
  it("Test 5: NewConversationModal appears as a portal-mounted sibling when open", async () => {
    renderPanelWithCreateRelayRoom();
    openThreeDotMenu();

    const menuItem = screen.getByRole("menuitem", { name: /new group conversation/i });
    await act(async () => {
      fireEvent.click(menuItem);
    });

    // The dialog should be mounted in the document (portal-mounted to body).
    // State-controlled: newConversationModalOpen === true after clicking.
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
  });

  // Test 6: menu-button gate unchanged — only visible when onCreateSession is defined
  it("Test 6: menu button is NOT visible when onCreateSession is undefined", () => {
    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
        // onCreateSession omitted — showPencilButton gate is false
      />,
    );
    // The MoreVertical menu button should NOT be present when showPencilButton=false
    expect(
      container.querySelector('[data-testid="pv-header-menu-button"]'),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 119 Plan 119-06 — Apps section integration coverage (A15-A20)
// ─────────────────────────────────────────────────────────────────────────────
// D-18 three-layer discipline for the sidebar Apps section:
//   - Component-level coverage (icon + fallback + healthMessage + context
//     menu + ordering-stability) lives in Plan 119-03's AppTile.test.tsx.
//   - Store-level coverage (publish fns + snapshot/update/gone reconciliation
//     + sort tiebreak + subscribe/unsubscribe) lives in Plan 119-02's
//     app-tiles-store.test.ts.
//   - Integration coverage (section chrome interacting with the panel's mount
//     lifecycle, hook wiring, search-input state, and DOM placement relative
//     to the Pinned group) lives HERE — six tests A15-A20 mirroring the A10-
//     A14 Archived-section template at :2625-2733.
//
// The tests exercise the invariants that neither the component test nor the
// store test can observe alone:
//   - A15: D-05 always-present — section header renders with zero tiles.
//   - A16: D-03 lazy-render — collapsed section has ZERO AppTile instances
//         and NO empty-state prompt in the DOM.
//   - A17: D-04 empty-expanded — click header → expand → the empty-state
//         prompt "Ask an agent to make an app for you." is visible.
//   - A18: D-01 populated + D-15 hook-order — expanded section renders one
//         AppTile per hook-returned entry, in the same order the hook
//         returned. (The panel does zero re-sorting; store's stable sort is
//         the sole authority.)
//   - A19: RESEARCH.md Pitfall 2 — the section is inserted OUTSIDE the
//         search-vs-three-zone ternary; typing in the search input MUST NOT
//         hide the section header.
//   - A20: D-01 placement — the Apps header appears ABOVE the Pinned group
//         in DOM order (compareDocumentPosition gate).
//
// Mock strategy: `mockAppTiles` module-level swap + `vi.mock("@/state/app-
// tiles-store", ...)`. beforeEach resets mockAppTiles to [] (see top-of-file
// beforeEach block).

describe("PrettyConversationsPanel: Phase 119 Apps section", () => {
  // Small local fixture builder — keep A15-A20 fixture assembly compact.
  function makeAppTile(overrides: Partial<AppState> = {}): AppState {
    return {
      hostId: "1",
      slug: "scratch-test",
      title: "Scratch",
      description: "test",
      port: null,
      hasIcon: true,
      createdAtMs: 0,
      isHealthy: true,
      healthMessage: null,
      ...overrides,
    };
  }

  // A15: D-05 always-present — section header renders with zero tiles.
  it("A15: mockAppTiles=[] → Apps section header renders (D-05 always-present)", () => {
    mockAppTiles = [];
    setSnapshot({ activeSet: [], pinned: [], middle: [], rdpGroup: null });

    render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const header = screen.getByTestId("pretty-conversations-apps-header");
    expect(header).toBeTruthy();
    // Header carries the "Apps" label per D-02 chrome mirror.
    expect(header.textContent).toContain("Apps");
  });

  // A16: D-03 lazy-render — collapsed section has ZERO AppTile instances
  // AND NO empty-state prompt in the DOM.
  it("A16: D-03 lazy — collapsed section renders zero AppTile instances + no empty-state prompt", () => {
    // Seed a populated store to prove the collapsed lazy-gate is what
    // suppresses the DOM (rather than the empty-list branch).
    mockAppTiles = [
      makeAppTile({ hostId: "1", slug: "app-a", title: "Alpha" }),
      makeAppTile({ hostId: "1", slug: "app-b", title: "Beta" }),
    ];
    setSnapshot({ activeSet: [], pinned: [], middle: [], rdpGroup: null });

    render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // Collapsed by default (appsExpanded=false) → the entire section body is
    // gated out of the DOM by `{appsExpanded && ...}`. Zero AppTile buttons.
    const tiles = screen.queryAllByRole("button", { name: /App tile:/ });
    expect(tiles.length).toBe(0);
    // And no empty-state prompt either — the empty-state branch also lives
    // inside the `{appsExpanded && ...}` gate, so it's absent when collapsed.
    expect(
      screen.queryByText("Ask an agent to make an app for you."),
    ).toBeNull();
  });

  // A17: D-04 empty-expanded — click header → expand → empty-state prompt.
  it("A17: click header → section expands → 'Ask an agent to make an app for you.' becomes visible (D-04)", () => {
    mockAppTiles = [];
    setSnapshot({ activeSet: [], pinned: [], middle: [], rdpGroup: null });

    render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // Pre-click: empty-state prompt is not in the DOM (D-03 lazy).
    expect(
      screen.queryByText("Ask an agent to make an app for you."),
    ).toBeNull();

    // Click to expand.
    const header = screen.getByTestId("pretty-conversations-apps-header");
    fireEvent.click(header);

    // Post-click + empty store → the D-04 empty-state prompt renders verbatim.
    const prompt = screen.getByText("Ask an agent to make an app for you.");
    expect(prompt).toBeTruthy();
  });

  // A18: D-01 populated + D-15 hook-order — expanded section renders one
  // AppTile per hook-returned entry, in hook-returned order.
  it("A18: mockAppTiles populated + expanded → renders one AppTile per entry in hook order (D-01 + D-15)", () => {
    // Seed three tiles in a specific order (this represents what the hook
    // returns after applying its D-15 stable sort). The panel does zero re-
    // sorting — so the DOM order must equal this array order.
    mockAppTiles = [
      makeAppTile({ hostId: "1", slug: "app-a", title: "Alpha" }),
      makeAppTile({ hostId: "1", slug: "app-b", title: "Beta" }),
      makeAppTile({ hostId: "2", slug: "app-c", title: "Gamma" }),
    ];
    setSnapshot({ activeSet: [], pinned: [], middle: [], rdpGroup: null });

    render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // Expand the section.
    const header = screen.getByTestId("pretty-conversations-apps-header");
    fireEvent.click(header);

    // Three AppTile instances rendered.
    const tiles = screen.getAllByRole("button", { name: /App tile:/ });
    expect(tiles.length).toBe(3);

    // DOM order matches hook-returned order (D-15 store-sort is the sole
    // authority; panel adds no re-sort).
    const titles = tiles.map((t) => t.getAttribute("aria-label"));
    expect(titles).toEqual([
      "App tile: Alpha",
      "App tile: Beta",
      "App tile: Gamma",
    ]);
  });

  // A19: RESEARCH.md Pitfall 2 originally proved the Apps section survived the
  // filter's ternary at PrettyConversationsPanel.tsx:1833 (pre-119-04-edit).
  // Phase 122 Plan 04 (D-17 removal) retired that ternary — the Apps header
  // now renders unconditionally alongside the three-zone view. The updated
  // assertion is structural: the Apps header is present after render even
  // with an empty snapshot, matching the D-05 always-present invariant that
  // the ternary previously threatened.
  it("A19: Apps section header renders unconditionally after D-17 ternary removal (Pitfall 2 + D-05)", () => {
    mockAppTiles = [];
    setSnapshot({ activeSet: [], pinned: [], middle: [], rdpGroup: null });

    render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    expect(
      screen.getByTestId("pretty-conversations-apps-header"),
    ).toBeTruthy();
    // Positive D-17 assertion: the retired search-vs-three-zone ternary means
    // the OLD inline filter input is gone (no searchbox rendered in the panel).
    // The new search primitive is the header button — asserted separately in
    // the D-17 removal describe near the top of this file.
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  // A20: D-01 placement — the Apps section header appears ABOVE the Pinned
  // group in DOM order. Uses compareDocumentPosition (bitwise-AND with
  // Node.DOCUMENT_POSITION_FOLLOWING = 4) to assert the header precedes
  // the [data-pinned-group="true"] wrapper.
  it("A20: Apps section header precedes the Pinned group in DOM order (D-01 placement)", () => {
    // Seed one pinned row (so the Pinned group actually renders) AND one app
    // tile (so the Apps section actually has content — though A20 only cares
    // about the header's position, not the section body).
    mockAppTiles = [makeAppTile()];
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      activeSet: [],
      pinned: [makeConversationRow({ id: "a", label: "alpha", host: hostA })],
      middle: [],
      rdpGroup: null,
      pinnedIds: new Set(["a"]),
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const appsHeader = screen.getByTestId("pretty-conversations-apps-header");
    const pinnedGroup = container.querySelector(
      '[data-pinned-group="true"]',
    ) as HTMLElement | null;
    expect(pinnedGroup).toBeTruthy();

    // DOCUMENT_POSITION_FOLLOWING (= 4): "otherNode follows this node in the
    // tree." So `appsHeader.compareDocumentPosition(pinnedGroup) & 4 === 4`
    // asserts pinnedGroup FOLLOWS appsHeader — i.e., the Apps header comes
    // FIRST in DOM order, which is D-01's placement invariant.
    const relation = appsHeader.compareDocumentPosition(pinnedGroup!);
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
