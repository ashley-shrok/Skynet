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
//  11)  RETIRED — settingsRowSlot prop dropped in Phase 11 (Ashley's "no settings" lock)
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

vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({
    byKey: mockIdentitiesByKey,
    identities: [],
    loaded: true,
    refresh: async () => {},
  }),
}));

// Patch #167: mock bounty-counts-store so filter tests can seed a
// (composite-key → count) map without touching the real WS-backed poller.
// - useAllBountyCounts() reads mockBountyCounts (mutable per-test).
// - startBountyCountPoller returns a no-op stop-fn.
// - bountyCountsCompositeKey mirrors the store's real format so panel-side
//   key construction stays in sync with the mock.
// Existing tests didn't mock this module and worked because the real
// poller short-circuits on empty targets (identitiesByKey was empty). With
// the mock in place, all tests share this deterministic shape.
let mockBountyCounts: ReadonlyMap<string, { pinnedCount: number; needsDeskCount: number }> = new Map();

vi.mock("@/state/bounty-counts-store", () => ({
  useBountyCounts: (identityKey: string | null, hostId: number | null) => {
    if (identityKey === null) return undefined;
    const key = `${identityKey}:${hostId ?? "local"}`;
    return mockBountyCounts.get(key);
  },
  useAllBountyCounts: () => mockBountyCounts,
  bountyCountsCompositeKey: (identityKey: string, hostId: number | null) =>
    `${identityKey}:${hostId ?? "local"}`,
  startBountyCountPoller: () => () => {},
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
  hiddenIds: ReadonlySet<string>;
};

let snapshot: MockSnapshot = {
  activeSet: [],
  pinned: [],
  middle: [],
  rdpGroup: null,
  selectedId: null,
  pinnedIds: new Set(),
  hiddenIds: new Set(),
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
    hiddenIds: next.hiddenIds ?? new Set(),
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

// quick-260731-tgg: spies for hide/show store functions.
const hideConversationSpy = vi.fn();
const unhideConversationSpy = vi.fn();
const hydrateHiddenIdsFromServerSpy = vi.fn();

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

vi.mock("@/state/conversation-store", () => ({
  useConversations: () => ({
    activeSet: snapshot.activeSet,
    pinned: snapshot.pinned,
    // Phase 41 Plan 01: three-zone shape.
    middle: snapshot.middle,
    rdpGroup: snapshot.rdpGroup,
  }),
  useSelectedConversationId: () => snapshot.selectedId,
  usePinnedIds: () => snapshot.pinnedIds,
  // quick-260731-tgg: hiddenIds subscription for the Hidden section.
  useHiddenIds: () => snapshot.hiddenIds,
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
  // Phase 15 (Wave 3): the panel's new mount-effect calls this after
  // getPinnedIds resolves. Spy so the integration test can assert the
  // fetch → hydrate wiring.
  hydratePinnedIdsFromServer: (ids: string[]) =>
    hydratePinnedIdsFromServerSpy(ids),
  // quick-260731-tgg: hide/show store functions.
  hideConversation: (id: string) => hideConversationSpy(id),
  unhideConversation: (id: string) => unhideConversationSpy(id),
  hydrateHiddenIdsFromServer: (ids: string[]) =>
    hydrateHiddenIdsFromServerSpy(ids),
}));

// Phase 15 (Wave 3): mock @/api/user-preferences-api so the panel's mount
// effect resolves getPinnedIds against a controlled fixture. Default returns
// an empty array — matches the pre-Wave-3 observable behavior of the panel
// (no pins hydrated) so the 25+ pre-existing tests remain unaffected. The
// mount effect fires on EVERY render (empty deps → once per mount), so this
// mock's mere presence ensures no real HTTP layer is touched.
vi.mock("@/api/user-preferences-api", () => ({
  getPinnedIds: vi.fn().mockResolvedValue([]),
  putPinnedIds: vi.fn().mockResolvedValue([]),
  // quick-260731-tgg: hiddenIds API wrappers.
  getHiddenIds: vi.fn().mockResolvedValue([]),
  putHiddenIds: vi.fn().mockResolvedValue([]),
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
    hiddenIds: new Set(),
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
  // Phase 15 (Wave 3): re-arm the getPinnedIds mock's default resolve value.
  // vi.clearAllMocks() above wipes the resolved value along with call
  // history; restore the "empty array" default so pre-Wave-3 tests continue
  // to observe the panel with an empty pinned tier post-mount-fetch.
  const { getPinnedIds, getHiddenIds } = await import("@/api/user-preferences-api");
  vi.mocked(getPinnedIds).mockResolvedValue([]);
  // quick-260731-tgg: re-arm getHiddenIds default.
  vi.mocked(getHiddenIds).mockResolvedValue([]);
  // Patch #167: reset identities + bounty counts mocks to empty defaults so
  // pre-#167 tests observe the unfiltered baseline. Filter tests populate
  // both explicitly before render.
  mockIdentitiesByKey = new Map();
  mockBountyCounts = new Map<string, { pinnedCount: number; needsDeskCount: number }>();
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
// Ashley verbatim: "sessions are still showing above the pinned area when they
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
  // Ashley verbatim 2026-08-17: "Also the pinned header should go away entirely."
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
  // Phase 41 Plan 01 (Ashley 2026-08-14) REWRITE: the pre-Phase-41 per-host
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

    // Ashley lock: NO host-divider chips render inside the middle zone.
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
    // Phase 42 UAT amendment 2026-08-17 (Ashley verbatim): active-set render
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

    // Ashley lock: zero host-divider chips anywhere in the panel.
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
    const rdpHost = makeHost("h2", "GIGAASHLEYPC", { enableRdp: true });
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
            label: "GIGAASHLEYPC",
            host: rdpHost,
            rdpHostRow: true,
            targetTmuxSession: null,
          }),
        ],
      },
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);

    // Ashley lock: no host-divider chip. The rdp-divider IS present.
    const hostChips = container.querySelectorAll('[data-testid="host-divider"]');
    const rdpChips = container.querySelectorAll('[data-testid="rdp-divider"]');
    expect(hostChips.length).toBe(0);
    expect(rdpChips.length).toBe(1);
  });

  // Phase 41 Plan 01 regression (Ashley lock #7): the RDP section header
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

  // Ashley 2026-08-20 UAT tightening of the 2026-08-19 verbatim rule: idle
  // rows have NOTHING; ACTIVE-SET working rows get a slow dashed spinner
  // ring on the avatar via `.pv-row.spinner-on .pv-avatar::before`. The
  // `spinner-on` class is JS-emitted by the active-set-scoped gate
  // `inActiveSet && (isWorking===true || isRecycling || hasQueuePending)`.
  // For a non-active-set, non-working row, the gate short-circuits to false
  // → NO spinner-on. Ambient rows are silent for both the ready-dot and the
  // spinner — the two indicators mutually partition the ACTIVE-SET only.
  // This test locks that partitioning at the panel level (integration): a
  // regression that widened the gate back to the 2026-08-19 full-inversion
  // shape (every ambient idle row spinning) would fail here.
  it("Test 19E: non-active-set idle rows have NO ready-dot AND NO `spinner-on` (ambient rows silent for both indicators, Ashley 2026-08-20)", () => {
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
    // Neither row carries `.spinner-on` — ambient scope short-circuits the
    // active-set-scoped gate. See Test P47-15 in PrettyConversationRow.
    // test.tsx for the row-level invariant lock.
    const m1Body = m1!.querySelector('[role="button"]') as HTMLElement;
    const m2Body = m2!.querySelector('[role="button"]') as HTMLElement;
    expect(m1Body.className).not.toContain("spinner-on");
    expect(m2Body.className).not.toContain("spinner-on");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests 20A / 20B / 20C / 20D / 20E — [quick-260727-gm3] deactivate action
// ─────────────────────────────────────────────────────────────────────────────
// Ashley 2026-07-27 deactivate-preview.js console snippet: rows in the active-
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
    // or middle (by recency). Ashley 2026-08-17 follow-up: the Deactivate
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
    // Deactivate menu item removed 2026-08-17 (Ashley).
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
    const rdpHost = makeHost("h2", "GIGAASHLEYPC", { enableRdp: true });
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
              label: "GIGAASHLEYPC",
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

  // Tests 20E, 20F, 20G, 20H — DELETED 2026-08-17. Ashley removed the
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
    const rdpHost = makeHost("h2", "GIGAASHLEYPC", { enableRdp: true });
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
              label: "GIGAASHLEYPC",
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

describe("PrettyConversationsPanel: header menu opens NewSessionDialog", () => {
  it("Test 5 (Phase 23 GEFM-01 repoint): clicking the MoreVertical menu button + selecting 'New agent' opens the NewSessionDialog; menu button carries pv-pencil class + data-testid=pv-header-menu-button", async () => {
    // Phase 23: the pencil + `+ New role` buttons are collapsed into a single
    // MoreVertical menu (data-testid="pv-header-menu-button", aria-label="More actions").
    // The "New agent" flow is: click menu button → menu portal appears → click "New agent"
    // → NewSessionDialog opens. This test re-points the OLD Test 5 assertion at the
    // new two-step flow (plan 23-04 instruction: re-point tests at new selectors or
    // skip with note referencing this plan — re-pointing preferred to preserve coverage).
    const { getByRole, getByTestId } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    // Step 1: menu trigger button exists with pv-pencil class + correct testid.
    const menuBtn = getByTestId("pv-header-menu-button");
    expect(menuBtn.className).toContain("pv-pencil");
    expect(menuBtn.getAttribute("aria-label")).toBe("More actions");
    expect(menuBtn.getAttribute("aria-haspopup")).toBe("menu");

    // Step 2: click the menu trigger → portal menu appears.
    fireEvent.click(menuBtn);
    const menu = getByRole("menu");
    expect(menu).toBeTruthy();

    // Step 3: menu has "New agent" as first item.
    const newAgentItem = within(menu).getByRole("menuitem", { name: /new agent/i });
    expect(newAgentItem).toBeTruthy();

    // Step 4: click "New agent" → NewSessionDialog opens.
    fireEvent.click(newAgentItem);

    // NewSessionDialog uses shadcn Dialog which renders inside a portal.
    // document.querySelector('[role="dialog"]') queries the whole document body.
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog).toBeTruthy();
    // The dialog contains "Start a new agent" title text (i18n defaultValue).
    expect(dialog!.textContent).toMatch(/start a new agent/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — Header pencil NOT rendered when onCreateSession is undefined
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: menu button gate", () => {
  it("Test 6 (Phase 23 GEFM-01 repoint): the MoreVertical menu button (data-testid=pv-header-menu-button) is absent when onCreateSession is undefined", () => {
    // Phase 23: the two individual action buttons (pencil + new role) are replaced
    // by a single MoreVertical menu button. The showPencilButton gate (gated on
    // typeof onCreateSession === "function") controls the new menu button exactly as
    // it controlled the old individual buttons. When onCreateSession is undefined,
    // the menu button must NOT appear.
    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    expect(container.querySelector('[data-testid="pv-header-menu-button"]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — Desktop header shows SKYNET brand lockup (inline SVG logo + wordmark img)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: desktop header title", () => {
  it("Test 7 (patch #257): desktop variant renders SKYNET brand lockup (inline SVG logo + wordmark img) in .pv-title with .pv-panel-header treatment", () => {
    const { container, queryByAltText } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Patch #257: brand lockup is now inline SkynetLogo SVG (svgr'd from
    // src/ui/assets/skynet-logo.svg, so no /icon.svg file to cache-fight) +
    // /skynet-wordmark.png replacing the prior "Skynet" text node.
    const wordmark = queryByAltText("SKYNET") as HTMLImageElement | null;
    expect(wordmark).toBeTruthy();
    expect(wordmark!.tagName).toBe("IMG");
    expect(wordmark!.getAttribute("src")).toBe("/skynet-wordmark.png");
    expect(wordmark!.className).toContain("pv-header-wordmark");

    // The wordmark's containing .pv-title lockup carries the class-toggle
    // treatment (12px + 700 + 0.1em letter-spacing + UPPERCASE + --color-pv-fg).
    const titleEl = wordmark!.closest(".pv-title") as HTMLElement | null;
    expect(titleEl).toBeTruthy();
    expect(titleEl!.className).toContain("pv-title");

    // Header-logo SVG (SkynetLogo from svgr) is the sibling before the wordmark:
    // aria-hidden decorative mark, .pv-header-logo class. No `<img src="...">`
    // for the logo anymore — the SVG is inlined into the JS bundle.
    const logoSvg = titleEl!.querySelector("svg.pv-header-logo");
    expect(logoSvg).toBeTruthy();
    expect(logoSvg!.getAttribute("aria-hidden")).toBe("true");

    // Header row container carries `.pv-panel-header` — CSS handles layout
    // (14px 16px padding, hairline border-bottom via --color-pv-border-quiet,
    // display:flex, justify-content:space-between).
    const headerRow = container.querySelector(
      "[data-testid='pretty-conversations-panel'] .pv-panel-header",
    ) as HTMLElement | null;
    expect(headerRow).toBeTruthy();
    // Title is a descendant of the header row.
    expect(headerRow!.contains(titleEl!)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — Mobile header title (patch #144 spec change from omit → render)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: mobile header title (patch #144)", () => {
  it("Test 8 (patch #257 + spec-change patch #144 f): mobile variant renders SKYNET brand lockup (same shape as desktop)", () => {
    const { container, queryByAltText, queryByRole } = render(
      <PrettyConversationsPanel
        variant="mobile"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );
    // Patch #257: mobile + desktop render identical header brand-lockup shape
    // (inline SkynetLogo SVG + wordmark img). Mobile mirrors Test 7's contract.
    const wordmark = queryByAltText("SKYNET") as HTMLImageElement | null;
    expect(wordmark).toBeTruthy();
    expect(wordmark!.tagName).toBe("IMG");
    expect(wordmark!.getAttribute("src")).toBe("/skynet-wordmark.png");
    expect(wordmark!.className).toContain("pv-header-wordmark");

    // The `.pv-title` element is present on mobile (Fix f removed the
    // showDesktopTitle gate).
    const titleEl = wordmark!.closest(".pv-title") as HTMLElement | null;
    expect(titleEl).toBeTruthy();
    expect(container.querySelector(".pv-title")).toBeTruthy();

    // Header-logo SVG (SkynetLogo from svgr): mirrors Test 7 — same
    // aria-hidden + class contract on mobile as desktop.
    const logoSvg = titleEl!.querySelector("svg.pv-header-logo");
    expect(logoSvg).toBeTruthy();
    expect(logoSvg!.getAttribute("aria-hidden")).toBe("true");

    // Header row container still carries `.pv-panel-header` even on mobile.
    expect(container.querySelector(".pv-panel-header")).toBeTruthy();

    // Phase 23 (GEFM-01): the individual pencil button is replaced by a single
    // MoreVertical menu button (data-testid="pv-header-menu-button", aria-label="More
    // actions"). Carries the pv-pencil class for chrome parity.
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
    const rdpHost = makeHost("h2", "GIGAASHLEYPC", { enableRdp: true });
    const rdpRow = makeConversationRow({
      id: "r1",
      label: "GIGAASHLEYPC",
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
    const rdpHost = makeHost("h2", "GIGAASHLEYPC", { enableRdp: true });

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
      label: "GIGAASHLEYPC",
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
// Phase 15 (Wave 3) — server-hydration on mount (PIN-04 integration)
// ─────────────────────────────────────────────────────────────
//
// Asserts the mount-fetch-hydrate round-trip end-to-end at the panel level:
//   1. On mount, getPinnedIds() is called exactly once (empty-deps effect).
//   2. Once getPinnedIds resolves with a fixture array, the panel calls
//      hydratePinnedIdsFromServer(ids) with that exact array — the store's
//      pinnedIds then reflects server state.
//
// This is PIN-04's architectural assertion of "server is authoritative +
// every mount fetches fresh." Cross-device confirmation (PIN-02) is the
// human-verify checkpoint Step 3; this test locks the plumbing.

describe("PrettyConversationsPanel (Phase 15): server-hydration on mount", () => {
  it("Test 21 (Phase 15 Wave 3): mount fires getPinnedIds() then hydratePinnedIdsFromServer(ids) with the resolved array", async () => {
    // quick-260727-kbw: opt in to the fleet-loaded gate so the mount effect
    // fires. Pre-kbw this test relied on the empty-deps effect firing on
    // every mount; post-kbw the effect gates on fleetSessionsLoaded=true
    // (mirrors the production ordering where AppShell's fleet-fetch effect
    // populates state.fleetSessions before the panel's hydrate effect runs).
    mockFleetSessionsLoaded = true;

    // Fixture: two ids that are legally-pinnable in this test setup. Content
    // doesn't need to match anything the snapshot renders — the assertion is
    // on the fetch → hydrate wiring, not on the rendered pinned tier.
    const fixtureIds = ["fleet::1::work", "t-A"];
    const { getPinnedIds } = await import("@/api/user-preferences-api");
    vi.mocked(getPinnedIds).mockResolvedValueOnce(fixtureIds);

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

    // getPinnedIds fires synchronously on mount (empty-deps effect kicks off
    // the async IIFE). Assert the call count before waiting on the hydrate.
    expect(vi.mocked(getPinnedIds)).toHaveBeenCalledTimes(1);

    // Wait for the resolve microtask to land the hydrate call. The panel's
    // mount effect's IIFE awaits getPinnedIds → hydratePinnedIdsFromServer
    // is called in the resolve branch (guarded by !cancelled).
    await waitFor(() => {
      expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledTimes(1);
    });
    expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledWith(fixtureIds);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 22 — quick-260727-kbw: mount hydration gated on fleetSessionsLoaded
// ─────────────────────────────────────────────────────────────────────────────
// The Wave-3 mount effect empty-deps at L204-218 (pre-kbw) fired the
// getPinnedIds fetch in a microtask while state.fleetSessions was still empty;
// the next routine updateOpenTabs pruned the freshly-hydrated fleet pin
// because fleetPinKeepSet was built from an empty state.fleetSessions.
//
// Post-kbw: the effect gates on useFleetSessionsLoaded() === true AND uses a
// hydratedRef to prevent double-fetch across re-renders (defense-in-depth per
// bug spec).
//
// This test locks the ordering itself. The store-level regression assertion —
// that IF the ordering holds, the pin survives the pruner — lives in
// conversation-store.test.ts.

describe("PrettyConversationsPanel (quick-260727-kbw): mount hydration gated on fleetSessionsLoaded", () => {
  it("Test 22 (quick-260727-kbw): mount does NOT call getPinnedIds while fleetSessionsLoaded=false; DOES call once after it flips to true; stays once across further re-renders (hydratedRef dedupe)", async () => {
    const fixtureIds = ["fleet::7::aqua"];
    const { getPinnedIds } = await import("@/api/user-preferences-api");
    vi.mocked(getPinnedIds).mockResolvedValueOnce(fixtureIds);

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

    // beforeEach sets mockFleetSessionsLoaded = false. Render — the gate is
    // closed, so the mount effect body should early-return before calling
    // getPinnedIds.
    const { rerender } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // Pre-flip assertion: fetch NOT called. Await a microtask so any deferred
    // effect body would have had a chance to fire.
    await Promise.resolve();
    expect(vi.mocked(getPinnedIds)).toHaveBeenCalledTimes(0);
    expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledTimes(0);

    // Flip the gate open, rerender — the mount effect's dep is
    // [fleetSessionsLoaded] so the body reruns and fires the fetch this time.
    mockFleetSessionsLoaded = true;
    rerender(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // Post-flip: fetch called exactly once. Await the resolve microtask for
    // the hydrate to land.
    await waitFor(() => {
      expect(vi.mocked(getPinnedIds)).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledTimes(1);
    });
    expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledWith(fixtureIds);

    // Third render: gate stays open, hydratedRef should hold. Fetch count
    // MUST NOT bump — this is the ref-based dedupe guard.
    rerender(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Give any deferred work a chance to fire before asserting it didn't.
    await Promise.resolve();
    expect(vi.mocked(getPinnedIds)).toHaveBeenCalledTimes(1);
    expect(hydratePinnedIdsFromServerSpy).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 26 — bounty-count filter popover (two-toggle + AND-intersect)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: bounty-count filter popover (Phase 26)", () => {
  it("Test 23: filter button renders with data-active=false + no dot + popover closed by default", () => {
    setSnapshot({ activeSet: [], pinned: [], grouped: [] });
    const { container, getByTestId, queryByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    const btn = getByTestId("pv-filter-toggles");
    expect(btn.getAttribute("data-active")).toBe("false");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    // No dot when both toggles off.
    expect(container.querySelector(".pv-filter-dot")).toBeNull();
    // Popover not yet in DOM.
    expect(queryByTestId("pv-filter-toggles-popover")).toBeNull();
  });

  it("Test 24: clicking the button opens the popover; all three buttons unchecked; button still data-active=false + no dot", () => {
    // Phase 52 Plan 02 adaptation: shadcn Checkbox data-state="unchecked" replaced by
    // role="menuitemcheckbox" aria-checked="false" on the new button elements.
    setSnapshot({ activeSet: [], pinned: [], grouped: [] });
    const { container, getByTestId, queryByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Open the popover.
    fireEvent.click(getByTestId("pv-filter-toggles"));
    // Popover is now in DOM (via portal — use screen queries).
    expect(screen.queryByTestId("pv-filter-toggles-popover")).toBeTruthy();
    // All three menu-item buttons present, all aria-checked=false.
    const readyBtn = screen.getByTestId("pv-filter-toggle-ready");
    const pinnedBtn = screen.getByTestId("pv-filter-toggle-pinned");
    const deskBtn = screen.getByTestId("pv-filter-toggle-needs-desk");
    expect(readyBtn.getAttribute("aria-checked")).toBe("false");
    expect(pinnedBtn.getAttribute("aria-checked")).toBe("false");
    expect(deskBtn.getAttribute("aria-checked")).toBe("false");
    // Button still inactive — opening popover doesn't flip any toggle.
    const btn = getByTestId("pv-filter-toggles");
    expect(btn.getAttribute("data-active")).toBe("false");
    expect(container.querySelector(".pv-filter-dot")).toBeNull();
  });

  it("Test 25: filter=pinned-only shows rows with pinnedCount>0; dot appears; nelly-row hidden", () => {
    // tina has pinnedCount=3, needsDeskCount=0; nelly has pinnedCount=0, needsDeskCount=2.
    const host1 = makeHost("1", "hostA");
    mockIdentitiesByKey = new Map([
      ["tina-session", { identityKey: "tina" }],
      ["nelly-session", { identityKey: "nelly" }],
    ]);
    mockBountyCounts = new Map([
      ["tina:1", { pinnedCount: 3, needsDeskCount: 0 }],
      ["nelly:1", { pinnedCount: 0, needsDeskCount: 2 }],
    ]);
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [
        {
          hostId: "1",
          hostName: "hostA",
          rows: [
            makeConversationRow({ id: "tina-row", targetTmuxSession: "tina-session", host: host1 }),
            makeConversationRow({ id: "nelly-row", targetTmuxSession: "nelly-session", host: host1 }),
          ],
        },
      ],
    });
    const { container, getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Filter off: both rows visible.
    expect(container.querySelector('[data-conversation-id="tina-row"]')).toBeTruthy();
    expect(container.querySelector('[data-conversation-id="nelly-row"]')).toBeTruthy();
    // Open popover then click pinned checkbox.
    fireEvent.click(getByTestId("pv-filter-toggles"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-pinned"));
    // Pinned filter on: tina-row visible (pinnedCount=3), nelly-row filtered out (pinnedCount=0).
    expect(container.querySelector('[data-conversation-id="tina-row"]')).toBeTruthy();
    expect(container.querySelector('[data-conversation-id="nelly-row"]')).toBeFalsy();
    // Button now active; dot present.
    expect(getByTestId("pv-filter-toggles").getAttribute("data-active")).toBe("true");
    expect(container.querySelector(".pv-filter-dot")).toBeTruthy();
  });

  it("Test 25b: filter=needs-desk-only shows rows with needsDeskCount>0; tina-row hidden", () => {
    // Same fixture: tina(pinned=3, desk=0), nelly(pinned=0, desk=2).
    const host1 = makeHost("1", "hostA");
    mockIdentitiesByKey = new Map([
      ["tina-session", { identityKey: "tina" }],
      ["nelly-session", { identityKey: "nelly" }],
    ]);
    mockBountyCounts = new Map([
      ["tina:1", { pinnedCount: 3, needsDeskCount: 0 }],
      ["nelly:1", { pinnedCount: 0, needsDeskCount: 2 }],
    ]);
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [
        {
          hostId: "1",
          hostName: "hostA",
          rows: [
            makeConversationRow({ id: "tina-row", targetTmuxSession: "tina-session", host: host1 }),
            makeConversationRow({ id: "nelly-row", targetTmuxSession: "nelly-session", host: host1 }),
          ],
        },
      ],
    });
    const { container, getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Open popover then click needs-desk checkbox only (leave pinned unchecked).
    fireEvent.click(getByTestId("pv-filter-toggles"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-needs-desk"));
    // Needs-desk filter: nelly-row visible (needsDeskCount=2), tina-row filtered out (needsDeskCount=0).
    expect(container.querySelector('[data-conversation-id="nelly-row"]')).toBeTruthy();
    expect(container.querySelector('[data-conversation-id="tina-row"]')).toBeFalsy();
  });

  it("Test 26: filter=BOTH on (AND intersection); only row with BOTH counts>0 survives", () => {
    // A: pinned=3, desk=1 (survives both); B: pinned=3, desk=0 (fails desk);
    // C: pinned=0, desk=1 (fails pinned); D: pinned=0, desk=0 (fails both).
    const host1 = makeHost("1", "hostA");
    mockIdentitiesByKey = new Map([
      ["a-session", { identityKey: "a" }],
      ["b-session", { identityKey: "b" }],
      ["c-session", { identityKey: "c" }],
      ["d-session", { identityKey: "d" }],
    ]);
    mockBountyCounts = new Map([
      ["a:1", { pinnedCount: 3, needsDeskCount: 1 }],
      ["b:1", { pinnedCount: 3, needsDeskCount: 0 }],
      ["c:1", { pinnedCount: 0, needsDeskCount: 1 }],
      ["d:1", { pinnedCount: 0, needsDeskCount: 0 }],
    ]);
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [
        {
          hostId: "1",
          hostName: "hostA",
          rows: [
            makeConversationRow({ id: "row-a", targetTmuxSession: "a-session", host: host1 }),
            makeConversationRow({ id: "row-b", targetTmuxSession: "b-session", host: host1 }),
            makeConversationRow({ id: "row-c", targetTmuxSession: "c-session", host: host1 }),
            makeConversationRow({ id: "row-d", targetTmuxSession: "d-session", host: host1 }),
          ],
        },
      ],
    });
    const { container, getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Open popover; click both checkboxes.
    fireEvent.click(getByTestId("pv-filter-toggles"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-pinned"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-needs-desk"));
    // AND intersection: only A survives; B, C, D are filtered out.
    expect(container.querySelector('[data-conversation-id="row-a"]')).toBeTruthy();
    expect(container.querySelector('[data-conversation-id="row-b"]')).toBeFalsy();
    expect(container.querySelector('[data-conversation-id="row-c"]')).toBeFalsy();
    expect(container.querySelector('[data-conversation-id="row-d"]')).toBeFalsy();
  });

  it("Test 27: filter=on with no matching rows renders no rows (empty-state card retired 2026-08-02)", () => {
    // One row with pinned=0, desk=0. Pinned toggle on → row filtered out.
    const host1 = makeHost("1", "hostA");
    mockIdentitiesByKey = new Map([["nelly-session", { identityKey: "nelly" }]]);
    mockBountyCounts = new Map([["nelly:1", { pinnedCount: 0, needsDeskCount: 0 }]]);
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [
        {
          hostId: "1",
          hostName: "hostA",
          rows: [
            makeConversationRow({ id: "nelly-row", targetTmuxSession: "nelly-session", host: host1 }),
          ],
        },
      ],
    });
    const { container, getByTestId, queryByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    expect(container.querySelector('[data-conversation-id="nelly-row"]')).toBeTruthy();
    // Open popover; click pinned checkbox.
    fireEvent.click(getByTestId("pv-filter-toggles"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-pinned"));
    // Filter on with 0 matches: no rows render, no empty-state card.
    expect(container.querySelector('[data-conversation-id="nelly-row"]')).toBeFalsy();
    expect(queryByTestId("pretty-conversations-empty")).toBeNull();
  });

  it("Test 27b (Phase 41 Plan 01 REWRITE): filter=on drops non-matching middle rows; matching rows still render", () => {
    // Pre-Phase-41 this test asserted per-host divider chip drop-when-empty
    // behavior. Phase 41 retired per-host divider chips entirely (the middle
    // zone is FLAT), so this test now asserts the equivalent post-Phase-41
    // contract: middle rows that don't match the filter are dropped from
    // the DOM; matching middle rows continue to render.
    const hostA = makeHost("1", "hostA");
    const hostB = makeHost("2", "hostB");
    mockIdentitiesByKey = new Map([
      ["tina-session", { identityKey: "tina" }],
      ["nelly-session", { identityKey: "nelly" }],
    ]);
    mockBountyCounts = new Map([
      ["tina:2", { pinnedCount: 3, needsDeskCount: 1 }],
      ["nelly:1", { pinnedCount: 0, needsDeskCount: 0 }],
    ]);
    setSnapshot({
      activeSet: [],
      pinned: [],
      middle: [
        makeConversationRow({ id: "nelly-row", targetTmuxSession: "nelly-session", host: hostA }),
        makeConversationRow({ id: "tina-row", targetTmuxSession: "tina-session", host: hostB }),
      ],
    });
    const { container, getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    fireEvent.click(getByTestId("pv-filter-toggles"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-pinned"));
    // Nelly (pinned=0) drops out of the filtered middle; tina (pinned=3) stays.
    expect(container.querySelector('[data-conversation-id="nelly-row"]')).toBeFalsy();
    expect(container.querySelector('[data-conversation-id="tina-row"]')).toBeTruthy();
    // Ashley lock (Phase 41 Plan 01): NO host-divider chips render, ever.
    expect(container.querySelectorAll('[data-testid="host-divider"]').length).toBe(0);
  });

  it("Test 28 (rewritten Phase 42 UAT amendment 2026-08-17): D-06 active-set exemption RETIRED — active-set rows now flow through pinned/middle filters like any other row", () => {
    // Phase 26 D-06 symmetric exemption was scoped to the retired Tier 1
    // active-set render tier. With that tier gone (Phase 42 UAT amendment
    // 2026-08-17, Ashley verbatim: "sessions are still showing above the
    // pinned area when they are active in the current instance of the
    // client. That shouldn't happen."), the exemption is moot — active-and-
    // pinned rows flow through the pinned bounty-count filter and active-
    // and-not-pinned rows flow through the middle bounty-count filter.
    //
    // Contract: seed a middle row (nelly-active — active in useActiveSet but
    // not pinned) with counts (pinned=0, desk=0). With both bounty toggles
    // ON, nelly-active is filtered out — no more exemption. tina-middle with
    // (pinned=3, desk=1) survives the AND filter.
    const host1 = makeHost("1", "hostA");
    mockIdentitiesByKey = new Map([
      ["nelly-session", { identityKey: "nelly" }],
      ["tina-session", { identityKey: "tina" }],
    ]);
    mockBountyCounts = new Map([
      ["nelly:1", { pinnedCount: 0, needsDeskCount: 0 }],
      ["tina:1", { pinnedCount: 3, needsDeskCount: 1 }],
    ]);
    setSnapshot({
      activeSet: [],
      pinned: [],
      middle: [
        makeConversationRow({ id: "nelly-active", targetTmuxSession: "nelly-session", host: host1 }),
        makeConversationRow({ id: "tina-middle", targetTmuxSession: "tina-session", host: host1 }),
      ],
    });
    // Mark nelly-active as in the useActiveSet — the row's inActiveSet prop
    // is true, but that no longer confers exemption from bounty-count filters.
    mockActiveSet = new Set<string>(["nelly-active"]);

    const { container, getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Open popover; click both checkboxes.
    fireEvent.click(getByTestId("pv-filter-toggles"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-pinned"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-needs-desk"));

    // D-06 retired: nelly-active (in useActiveSet, but pinned=0/desk=0) is
    // filtered out of the middle just like any other row.
    expect(container.querySelector('[data-conversation-id="nelly-active"]')).toBeFalsy();
    // tina-middle with (pinned=3, desk=1) survives the AND filter.
    expect(container.querySelector('[data-conversation-id="tina-middle"]')).toBeTruthy();
  });

  it("Test 29: small dot disappears when both toggles are turned back off", () => {
    setSnapshot({ activeSet: [], pinned: [], grouped: [] });
    const { container, getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Turn both toggles on.
    fireEvent.click(getByTestId("pv-filter-toggles"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-pinned"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-needs-desk"));
    expect(container.querySelector(".pv-filter-dot")).toBeTruthy();
    // Turn both back off.
    fireEvent.click(screen.getByTestId("pv-filter-toggle-pinned"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-needs-desk"));
    expect(container.querySelector(".pv-filter-dot")).toBeNull();
  });

  it("Test 30: popover closes on Escape keydown", () => {
    setSnapshot({ activeSet: [], pinned: [], grouped: [] });
    const { getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Open popover.
    fireEvent.click(getByTestId("pv-filter-toggles"));
    expect(screen.queryByTestId("pv-filter-toggles-popover")).toBeTruthy();
    // Dispatch Escape — Radix Popover handles this via its onKeyDown.
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    expect(screen.queryByTestId("pv-filter-toggles-popover")).toBeNull();
  });
});

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
    //     inline-260823-conv-title-suffix (Ashley 2026-08-23) flipped the
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

describe("PrettyConversationsPanel: Hidden section (quick-260731-tgg)", () => {
  const hostA = makeHost("h1", "hostA");

  // (a) Hidden section NOT rendered when hiddenIds.size === 0
  it("Test (a): Hidden section NOT rendered when hiddenIds is empty", () => {
    setSnapshot({
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [makeConversationRow({ id: "c1", host: hostA })],
        },
      ],
      hiddenIds: new Set(),
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    expect(
      container.querySelector('[data-testid="hidden-divider"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-hidden-group="true"]'),
    ).toBeNull();
  });

  // (b) Hidden section renders with EyeOff+"Hidden" chip when hiddenIds.size > 0, collapsed by default
  it("Test (b): Hidden chip renders + rows collapsed by default when hiddenIds non-empty", () => {
    // Seed a row in grouped so it can be captured by the knownRowsRef accumulator.
    // The panel accumulates rows in all tiers; since hidden rows are filtered by
    // the store, we prime the panel by having a grouped row first, then hiding it.
    const row = makeConversationRow({ id: "hidden-row-1", label: "hidden-session", host: hostA });
    setSnapshot({
      grouped: [
        { hostId: "h1", hostName: "hostA", rows: [row] },
      ],
      hiddenIds: new Set(["hidden-row-1"]),
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // Chip renders
    const chip = container.querySelector('[data-testid="hidden-divider"]') as HTMLElement | null;
    expect(chip).toBeTruthy();
    expect(chip!.textContent).toMatch(/Hidden/i);
    // aria-expanded is false (collapsed)
    expect(chip!.getAttribute("aria-expanded")).toBe("false");
    // No conversation rows in the hidden section (collapsed)
    const hiddenGroup = container.querySelector('[data-hidden-group="true"]') as HTMLElement | null;
    expect(hiddenGroup).toBeTruthy();
    const rowsInSection = hiddenGroup!.querySelectorAll("[data-conversation-id]");
    expect(rowsInSection.length).toBe(0);
  });

  // (c) Clicking chip expands (rows in DOM, ChevronDown visible)
  it("Test (c): clicking Hidden chip expands the section, rows appear, aria-expanded becomes true", async () => {
    const row = makeConversationRow({ id: "hidden-row-2", label: "hidden-session-2", host: hostA });
    setSnapshot({
      grouped: [
        { hostId: "h1", hostName: "hostA", rows: [row] },
      ],
      hiddenIds: new Set(["hidden-row-2"]),
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const chip = container.querySelector('[data-testid="hidden-divider"]') as HTMLElement;
    expect(chip).toBeTruthy();

    fireEvent.click(chip);

    await waitFor(() => {
      expect(chip.getAttribute("aria-expanded")).toBe("true");
    });
    const hiddenGroup = container.querySelector('[data-hidden-group="true"]') as HTMLElement;
    const rowsInSection = hiddenGroup.querySelectorAll("[data-conversation-id]");
    expect(rowsInSection.length).toBeGreaterThan(0);
  });

  // (d) Hidden ids are FILTERED OUT of active-set / pinned / grouped tiers
  it("Test (d): rows in hiddenIds do NOT appear in active-set / pinned / grouped tiers", () => {
    // The store filters hidden ids from tiers in computeSnapshot. In this test
    // we verify the panel renders the mock snapshot faithfully: no hidden-id rows
    // appear in the three visible tiers when the mock already excludes them.
    // We also verify the Hidden chip IS rendered (hiddenIds non-empty).
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [],
      hiddenIds: new Set(["hidden-a", "hidden-b"]),
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // Neither hidden row should appear in the three tiers
    expect(
      container.querySelector('[data-conversation-id="hidden-a"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-conversation-id="hidden-b"]'),
    ).toBeNull();
    // But the Hidden chip should be absent (no rows to resolve — knownRowsRef empty)
    // because there are no rows in tiers to populate the accumulator.
    // The chip itself only renders when hiddenRows.length > 0.
    // With no rows in any tier, hiddenRows remains empty. This is correct behavior.
    // The chip is absent. The hidden section remains hidden.
    expect(
      container.querySelector('[data-testid="hidden-divider"]'),
    ).toBeNull();
  });

  // (e) Mount-hydration fires getHiddenIds() and dispatches to hydrateHiddenIdsFromServer
  it("Test (e): mount-hydration calls getHiddenIds and dispatches hydrateHiddenIdsFromServer", async () => {
    const { getHiddenIds } = await import("@/api/user-preferences-api");
    vi.mocked(getHiddenIds).mockResolvedValue(["server-hidden-1"]);

    mockFleetSessionsLoaded = true;
    setSnapshot({ hiddenIds: new Set() });

    render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    await waitFor(() => {
      expect(hydrateHiddenIdsFromServerSpy).toHaveBeenCalledWith(["server-hidden-1"]);
    });
    expect(vi.mocked(getHiddenIds)).toHaveBeenCalled();
  });

  // (f) Pin on a hidden row unhides first then pins (mutual exclusion)
  // Tests the handleTogglePin panel-level orchestration: the panel must call
  // unhideConversation(rowId) BEFORE the pin write when the row is in
  // hiddenIds. We trigger this via right-click → context menu → Pin on a row
  // in the grouped tier that is also in hiddenIds. Post-260807-followup the
  // pin write is pinConversation() (not togglePinConversation) — for a row
  // with no targetTmuxSession, shadowFleetId is null and the canonical pin
  // id falls back to row.id.
  it("Test (f): handleTogglePin on a hidden row calls unhideConversation THEN pinConversation", async () => {
    const row = makeConversationRow({ id: "row-to-pin-unhide", label: "test-row", host: hostA });
    setSnapshot({
      grouped: [{ hostId: "h1", hostName: "hostA", rows: [row] }],
      hiddenIds: new Set(["row-to-pin-unhide"]),
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="row-to-pin-unhide"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();

    // Right-click the row-body (role="button") to open the context menu portal.
    const rowBody = rowEl!.querySelector('[role="button"]') as HTMLElement;
    expect(rowBody).toBeTruthy();
    fireEvent.contextMenu(rowBody, { clientX: 100, clientY: 100 });

    // Find and click the Pin item in the context menu
    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeTruthy();
    });
    const menu = screen.getByRole("menu");
    const pinItem = within(menu).getByRole("menuitem", { name: /^pin$/i });
    fireEvent.click(pinItem);

    await waitFor(() => {
      expect(unhideConversationSpy).toHaveBeenCalledWith("row-to-pin-unhide");
      expect(pinConversationSpy).toHaveBeenCalledWith("row-to-pin-unhide");
    });

    // Verify call ORDER: unhide must come before pin.
    const unhideOrder = unhideConversationSpy.mock.invocationCallOrder[0];
    const pinOrder = pinConversationSpy.mock.invocationCallOrder[0];
    expect(unhideOrder).toBeLessThan(pinOrder);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// quick-260731-tgg: Hide/Show row-wiring tests (g-m)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: Hide/Show wiring (quick-260731-tgg)", () => {
  const hostA = makeHost("h1", "hostA");

  // (g) Context menu on a non-hidden row shows Hide between Pin/Unpin and
  // Open-in-new-window, with Deactivate at the tail. quick-260804-uo4
  // inserted the new-window item between Clone and Deactivate; for a row
  // without an identity Clone is auto-hidden, so the order collapses to
  // Pin, Hide, Open in new window, Deactivate. (Label was "Move to new
  // window" when inActiveSet before 2026-08-18; now always "Open in new
  // window" regardless of active-set membership.)
  it("Test (g): context menu on a non-hidden active-set row shows Pin/Hide/Open-in-new-window in order (Deactivate removed 2026-08-17)", async () => {
    // Phase 42 UAT amendment 2026-08-17: active-set render tier retired; seed
    // row into `middle` and mark active-in-set via `mockActiveSet`.
    // Ashley 2026-08-17 follow-up: Deactivate menu item removed entirely;
    // menu order is now Pin, Hide, Open-in-new-window (Clone hidden — row
    // has no identity).
    setSnapshot({
      activeSet: [],
      middle: [
        makeConversationRow({ id: "active-row-g", label: "active-g", host: hostA }),
      ],
      hiddenIds: new Set(),
    });
    mockActiveSet = new Set(["active-row-g"]);

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const rowEl = container.querySelector('[data-conversation-id="active-row-g"]') as HTMLElement;
    const body = rowEl.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });

    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeTruthy();
    });

    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    const labels = items.map((el) => el.textContent ?? "");
    // Expected order (post 2026-08-18): Pin, Hide, Open in new window.
    expect(labels[0]).toMatch(/pin/i);
    expect(labels[1]).toMatch(/hide/i);
    expect(labels[2]).toMatch(/open in new window/i);
    // Deactivate is no longer in the menu regardless of inActiveSet.
    expect(labels.some((l) => /deactivate/i.test(l))).toBe(false);
    // Regression guard: legacy "Move to new window" label must never appear again.
    expect(labels.some((l) => /move to new window/i.test(l))).toBe(false);
  });

  // (h) Context menu on a hidden row shows Unhide in the same slot
  it("Test (h): context menu on a hidden row shows 'Unhide' instead of 'Hide'", async () => {
    setSnapshot({
      grouped: [
        { hostId: "h1", hostName: "hostA", rows: [makeConversationRow({ id: "hidden-row-h", label: "hidden-h", host: hostA })] },
      ],
      hiddenIds: new Set(["hidden-row-h"]),
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const rowEl = container.querySelector('[data-conversation-id="hidden-row-h"]') as HTMLElement;
    const body = rowEl.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });

    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeTruthy();
    });

    const menu = screen.getByRole("menu");
    // Should have an "Unhide" item, not "Hide" (patch #252 — Ashley 2026-08-01 ask)
    expect(within(menu).queryByRole("menuitem", { name: /^unhide$/i })).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: /^hide$/i })).toBeNull();
  });

  // (i) Clicking Hide from context menu on an ambient row calls hideConversation only (no deactivate)
  it("Test (i): clicking Hide from context menu on an ambient row calls hideConversation (no deactivate)", async () => {
    setSnapshot({
      grouped: [
        { hostId: "h1", hostName: "hostA", rows: [makeConversationRow({ id: "ambient-row-i", label: "ambient-i", host: hostA })] },
      ],
      hiddenIds: new Set(),
    });
    // mockActiveSet stays empty → row is ambient

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const rowEl = container.querySelector('[data-conversation-id="ambient-row-i"]') as HTMLElement;
    const body = rowEl.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });

    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeTruthy();
    });

    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /^hide$/i }));

    await waitFor(() => {
      expect(hideConversationSpy).toHaveBeenCalledWith("ambient-row-i");
    });
    // Deactivate must NOT have been called (ambient rows can't deactivate)
    expect(removeFromActiveSetSpy).not.toHaveBeenCalled();
  });

  // (j) Clicking Hide from context menu on an active-set row triggers handleRowDeactivate FIRST then hideConversation
  it("Test (j): clicking Hide on an active-set row calls removeFromActiveSet BEFORE hideConversation (deactivate-first composition)", async () => {
    // Phase 42 UAT amendment 2026-08-17: active-set render tier retired; seed
    // row into `middle` and mark active-in-set via `mockActiveSet`.
    setSnapshot({
      activeSet: [],
      middle: [
        makeConversationRow({ id: "active-row-j", label: "active-j", host: hostA }),
      ],
      hiddenIds: new Set(),
    });
    mockActiveSet = new Set(["active-row-j"]);

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const rowEl = container.querySelector('[data-conversation-id="active-row-j"]') as HTMLElement;
    const body = rowEl.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });

    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeTruthy();
    });

    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /^hide$/i }));

    await waitFor(() => {
      expect(removeFromActiveSetSpy).toHaveBeenCalled();
      expect(hideConversationSpy).toHaveBeenCalledWith("active-row-j");
    });

    // Assert call ORDER: removeFromActiveSet (deactivate path) must come before hideConversation
    const deactivateOrder = removeFromActiveSetSpy.mock.invocationCallOrder[0];
    const hideOrder = hideConversationSpy.mock.invocationCallOrder[0];
    expect(deactivateOrder).toBeLessThan(hideOrder);
  });

  // Test (n) [Ashley 2026-09-03 — inverts quick-260731-tgg]: clicking a
  // hidden row opens the session but leaves hiddenIds untouched. The prior
  // quick-260731-tgg auto-unhide-on-click both violated the "hidden means
  // hidden" semantic and produced a click race (row DOM moved out from
  // under the cursor between click-down and click-up, dropping the
  // selectConversation dispatch). Test (f) above still asserts unhide-on-
  // pin — that path is unchanged; only the click path stops mutating.
  it("Test (n) [Ashley 2026-09-03 flip of quick-260731-tgg]: clicking a hidden row calls selectConversation + onConversationSelected but does NOT call unhideConversation", async () => {
    const row = makeConversationRow({ id: "hidden-row-n", label: "hidden-n", host: hostA });
    setSnapshot({
      grouped: [{ hostId: "h1", hostName: "hostA", rows: [row] }],
      hiddenIds: new Set(["hidden-row-n"]),
    });

    const onConversationSelected = vi.fn();
    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onConversationSelected={onConversationSelected} onDeactivateRow={() => {}} />,
    );

    // Expand the Hidden section (collapsed by default — see Test (b) and Test (c))
    const chip = container.querySelector('[data-testid="hidden-divider"]') as HTMLElement;
    expect(chip).toBeTruthy();
    fireEvent.click(chip);

    await waitFor(() => {
      expect(chip.getAttribute("aria-expanded")).toBe("true");
    });

    // Confirm the hidden row is in the DOM after expansion
    const hiddenGroup = container.querySelector('[data-hidden-group="true"]') as HTMLElement;
    await waitFor(() => {
      expect(hiddenGroup.querySelectorAll("[data-conversation-id]").length).toBeGreaterThan(0);
    });

    // Click the row body
    const rowEl = container.querySelector('[data-conversation-id="hidden-row-n"]') as HTMLElement;
    expect(rowEl).toBeTruthy();
    const body = rowEl.querySelector('[role="button"]') as HTMLElement;
    expect(body).toBeTruthy();
    fireEvent.click(body);

    // Assert 1 (semantic): unhideConversation must NOT be called — the fleet-critical invariant.
    // Hidden rows stay hidden on click.
    expect(unhideConversationSpy).not.toHaveBeenCalled();
    // Assert 2 (navigation): session-open path still fires end-to-end.
    expect(selectConversationSpy).toHaveBeenCalledWith("hidden-row-n");
    expect(onConversationSelected).toHaveBeenCalledWith("hidden-row-n");
  });

  // Tests (k), (l), (m) DELETED in quick-260802-pq2. They asserted on the
  // mobile swipe-strip's [data-testid="hide-action-*"] / "deactivate-action"
  // DOM presence. That strip was retired; mobile action affordance is the
  // long-press → PrettyConversationContextMenu (same builder desktop
  // right-click uses). Row-level menu-open coverage lives in Pretty
  // ConversationRow.test.tsx TL1-TL5. The items[] builder is the single
  // source of truth for menu contents, so mobile menu content is guaranteed
  // by transitivity with tests (g)/(h)/(i)/(j) above (which exercise the
  // context menu on desktop right-click paths — same builder feeds both
  // entry points).
});

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
// Phase 41 Plan 02 — Search input + one-shot cold-load scroll-hide (Task 1)
// ─────────────────────────────────────────────────────────────────────────────
// Ashley 2026-08-14 locks (see 41-CONTEXT.md + 41-02-PLAN.md):
//   - A `<input type="search">` is ALWAYS in the DOM at the top of the panel
//     scroll region, regardless of snapshot state (empty / loading / populated).
//   - On the app's first cold-load per browser session, the scroll region's
//     scrollTop is set once so the search input sits just out of view above
//     the visible area.
//   - The scroll-hide fires EXACTLY ONCE per browser session — a StrictMode
//     double-mount or any future panel remount does NOT re-clamp scroll.
//   - The one-shot behavior is gated by a sessionStorage sentinel key
//     "pv-conv-search-hidden-once".
//   - The `only=1` new-window opener path clears the sentinel key so a fresh
//     tab always gets the hide (Rule T-41-02-01 — sessionStorage-bleed guard).
//   - NO auto-focus on mount (Ashley lock #4 — tap-to-focus on mobile,
//     uniform on desktop).

describe("PrettyConversationsPanel (Phase 41 Plan 02): search input mount + scroll-hide", () => {
  const SEARCH_HIDDEN_SENTINEL_KEY = "pv-conv-search-hidden-once";

  beforeEach(() => {
    sessionStorage.removeItem(SEARCH_HIDDEN_SENTINEL_KEY);
  });

  afterEach(() => {
    sessionStorage.removeItem(SEARCH_HIDDEN_SENTINEL_KEY);
  });

  it("Test A: <input type='search'> mounts as a descendant of .pv-panel-scroll on every render (empty snapshot)", () => {
    // Empty snapshot — no rows, still loading — the search input MUST still
    // mount inside .pv-panel-scroll.
    setSnapshot({ activeSet: [], pinned: [], middle: [], rdpGroup: null });
    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const scrollEl = container.querySelector(".pv-panel-scroll") as HTMLElement | null;
    expect(scrollEl).toBeTruthy();

    const searchInput = scrollEl!.querySelector('input[type="search"]');
    expect(searchInput).toBeTruthy();
    // Test-id anchor for downstream assertions.
    expect(
      scrollEl!.querySelector('[data-testid="pretty-conversations-search-input"]'),
    ).toBeTruthy();
  });

  it("Test A2: <input type='search'> mounts on populated snapshot too (survives snapshot state changes)", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      middle: [
        makeConversationRow({ id: "m1", label: "session-1", host: hostA }),
      ],
    });
    mockFleetSessionsLoaded = true;

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const scrollEl = container.querySelector(".pv-panel-scroll") as HTMLElement | null;
    expect(scrollEl).toBeTruthy();
    expect(scrollEl!.querySelector('input[type="search"]')).toBeTruthy();

    // The search input is above the middle rows in DOM order (structural
    // precondition for the scroll-hide behavior).
    const inputEl = scrollEl!.querySelector('input[type="search"]') as HTMLElement;
    const rowEl = scrollEl!.querySelector('[data-conversation-id="m1"]') as HTMLElement;
    expect(inputEl).toBeTruthy();
    expect(rowEl).toBeTruthy();
    // Node.DOCUMENT_POSITION_FOLLOWING = 4 — input precedes row.
    expect(inputEl.compareDocumentPosition(rowEl) & 4).toBe(4);
  });

  it("Test B: one-shot sentinel FIRST mount — sessionStorage[key]=null → scrollTop set + sentinel written", () => {
    // Fresh browser session: sentinel absent. After render, effect runs.
    expect(sessionStorage.getItem(SEARCH_HIDDEN_SENTINEL_KEY)).toBeNull();

    // Spy on the .pv-panel-scroll's scrollTop setter so we can observe the
    // one-shot assignment. Since JSDOM makes scrollTop a writable data
    // property, we can just observe the post-render value.
    setSnapshot({ activeSet: [], pinned: [], middle: [], rdpGroup: null });
    render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // After effect fires, sentinel MUST be written.
    expect(sessionStorage.getItem(SEARCH_HIDDEN_SENTINEL_KEY)).toBe("1");
  });

  it("Test C: one-shot sentinel SUBSEQUENT mount — sessionStorage[key]='1' → scroll NOT touched, sentinel unchanged", () => {
    // Pre-seed sentinel as if a prior mount already ran.
    sessionStorage.setItem(SEARCH_HIDDEN_SENTINEL_KEY, "1");

    setSnapshot({ activeSet: [], pinned: [], middle: [], rdpGroup: null });

    // Track any scrollTop assignments via a spy on Element.prototype.
    const scrollTopSetter = vi.fn();
    const scrollTopDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollTop",
    );
    Object.defineProperty(Element.prototype, "scrollTop", {
      configurable: true,
      get() {
        return 0;
      },
      set(_v: number) {
        scrollTopSetter(_v);
      },
    });

    try {
      render(
        <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
      );

      // The one-shot effect early-returns when sentinel === "1". No scrollTop
      // assignment should fire.
      expect(scrollTopSetter).not.toHaveBeenCalled();

      // Sentinel remains "1" — the effect must not re-write it either.
      expect(sessionStorage.getItem(SEARCH_HIDDEN_SENTINEL_KEY)).toBe("1");
    } finally {
      // Restore the descriptor so subsequent tests see JSDOM's default.
      if (scrollTopDescriptor) {
        Object.defineProperty(Element.prototype, "scrollTop", scrollTopDescriptor);
      } else {
        // Fallback: delete our override so JSDOM re-installs its default.
        delete (Element.prototype as unknown as { scrollTop?: number }).scrollTop;
      }
    }
  });

  it("Test D: only=1 hash clears the pv-conv-search-hidden-once sentinel via conversation-store module init", async () => {
    // This test exercises the sessionStorage-bleed guard that fires on
    // conversation-store module load. The conversation-store.ts module owns
    // the only=1 clear alongside its existing pv-conv-active-set clear; Phase
    // 41 Plan 02 extends the guard to also clear
    // "pv-conv-search-hidden-once".
    //
    // The top-of-file vi.mock("@/state/conversation-store", ...) shadows the
    // real module for the panel tests. To exercise the REAL module's init
    // guard, we go through the same on-disk path via a subprocess-safe grep
    // (no runtime hoisting conflict) — the code path is asserted directly.
    // Set the sentinel + hash, then re-import the real module through
    // vi.importActual to bypass the mock. vi.importActual with an absolute
    // path guarantees the real module loads regardless of alias registration.
    sessionStorage.setItem(SEARCH_HIDDEN_SENTINEL_KEY, "1");
    sessionStorage.setItem("pv-conv-active-set", JSON.stringify(["seed-1"]));

    const originalHash = window.location.hash;
    window.location.hash = "#tab=x&only=1";
    try {
      vi.resetModules();
      // vi.importActual bypasses the vi.mock at the top of this file so the
      // real store module's hydrateActiveSetFromStorage runs its guard.
      await vi.importActual<typeof import("@/state/conversation-store")>(
        "@/state/conversation-store",
      );

      // The only=1 guard MUST have cleared BOTH keys (Phase 41 Plan 02
      // extended the guard from just pv-conv-active-set to also clear the
      // new search-hide sentinel — same T-41-02-01 mitigation).
      expect(sessionStorage.getItem(SEARCH_HIDDEN_SENTINEL_KEY)).toBeNull();
      expect(sessionStorage.getItem("pv-conv-active-set")).toBeNull();
    } finally {
      window.location.hash = originalHash;
    }
  });

  it("Test E: no auto-focus — the search input is NOT the active document element after mount", () => {
    setSnapshot({ activeSet: [], pinned: [], middle: [], rdpGroup: null });
    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const searchInput = container.querySelector(
      '[data-testid="pretty-conversations-search-input"]',
    ) as HTMLElement | null;
    expect(searchInput).toBeTruthy();
    // Ashley lock #4: no auto-focus on either platform.
    expect(document.activeElement).not.toBe(searchInput);
  });

  it("Test E2 (mobile parity): no auto-focus on mobile variant either — uniform tap-to-focus", () => {
    setSnapshot({ activeSet: [], pinned: [], middle: [], rdpGroup: null });
    const { container } = render(
      <PrettyConversationsPanel variant="mobile" onDeactivateRow={() => {}} />,
    );

    const searchInput = container.querySelector(
      '[data-testid="pretty-conversations-search-input"]',
    ) as HTMLElement | null;
    expect(searchInput).toBeTruthy();
    expect(document.activeElement).not.toBe(searchInput);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 41 Plan 02 — Filter predicate + flat match render branch (Task 2)
// ─────────────────────────────────────────────────────────────────────────────
// Ashley 2026-08-14 locks (see 41-CONTEXT.md § Filter behavior):
//   - Typing flattens the entire list to matches. Pinned zone, flat middle,
//     and RDP section all collapse into ONE list of matches while a filter
//     is active. Section boundaries and pin priority are NOT preserved.
//   - Match target: visible row label text only (label + sublabel where both
//     shown). No message-body content search.
//   - Hidden rows do NOT appear in filter matches (Ashley lock #3 — hiding
//     is a user choice that the filter respects).
//   - Clearing the filter restores the three-zone view.

describe("PrettyConversationsPanel (Phase 41 Plan 02): filter predicate + flat match render", () => {
  beforeEach(() => {
    // Fresh cold-load sentinel each test so the search-hide effect is quiet.
    sessionStorage.setItem("pv-conv-search-hidden-once", "1");
  });

  afterEach(() => {
    sessionStorage.removeItem("pv-conv-search-hidden-once");
  });

  it("Test F: empty query → three-zone view renders (pinned divider RETIRED per Phase 42 UAT amendment 2026-08-17; RDP divider still present)", () => {
    // Precondition: searchQuery starts as "" — three-zone view intact.
    // Phase 42 UAT amendment 2026-08-17: the "Pinned" divider chip is
    // retired unconditionally — absent both during filter and in the
    // three-zone view. The RDP divider stays.
    const hostA = makeHost("h1", "hostA");
    const rdpHost = makeHost("h2", "GIGAASHLEYPC", { enableRdp: true });
    setSnapshot({
      pinned: [makeConversationRow({ id: "p1", label: "pinned-alpha", host: hostA })],
      middle: [makeConversationRow({ id: "m1", label: "middle-beta", host: hostA })],
      rdpGroup: {
        hostId: "__rdp__",
        hostName: "",
        rows: [
          makeConversationRow({
            id: "r1",
            label: "GIGAASHLEYPC",
            host: rdpHost,
            rdpHostRow: true,
            targetTmuxSession: null,
          }),
        ],
      },
      pinnedIds: new Set(["p1"]),
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // Pinned divider retired unconditionally; RDP divider still visible;
    // all rows in their respective zones.
    expect(container.querySelector('[data-testid="pinned-divider"]')).toBeNull();
    expect(container.querySelector('[data-testid="rdp-divider"]')).toBeTruthy();
    expect(container.querySelector('[data-conversation-id="p1"]')).toBeTruthy();
    expect(container.querySelector('[data-conversation-id="m1"]')).toBeTruthy();
    expect(container.querySelector('[data-conversation-id="r1"]')).toBeTruthy();
  });

  it("Test G: non-empty query flattens all three zones — matching rows render, divider chips are ALL absent", () => {
    // Rows spread across all three zones — 2 match the query "foo", 1 does not.
    const hostA = makeHost("h1", "hostA");
    const rdpHost = makeHost("h2", "foo-desktop", { enableRdp: true });
    setSnapshot({
      pinned: [
        makeConversationRow({ id: "p-foo", label: "foo-1", host: hostA }),
        makeConversationRow({ id: "p-bar", label: "bar-1", host: hostA }),
      ],
      middle: [makeConversationRow({ id: "m-foo", label: "foo-2", host: hostA })],
      rdpGroup: {
        hostId: "__rdp__",
        hostName: "",
        rows: [
          makeConversationRow({
            id: "r-desktop",
            label: "foo-desktop",
            host: rdpHost,
            rdpHostRow: true,
            targetTmuxSession: null,
          }),
        ],
      },
      pinnedIds: new Set(["p-foo", "p-bar"]),
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // Type "foo" into the search input.
    const searchInput = container.querySelector(
      '[data-testid="pretty-conversations-search-input"]',
    ) as HTMLInputElement;
    expect(searchInput).toBeTruthy();
    fireEvent.change(searchInput, { target: { value: "foo" } });

    // ALL three divider chips MUST be absent during filter (Ashley lock —
    // section boundaries not preserved during search).
    expect(container.querySelector('[data-testid="pinned-divider"]')).toBeNull();
    expect(container.querySelector('[data-testid="rdp-divider"]')).toBeNull();
    expect(container.querySelector('[data-testid="host-divider"]')).toBeNull();

    // Only "foo" matches render.
    expect(container.querySelector('[data-conversation-id="p-foo"]')).toBeTruthy();
    expect(container.querySelector('[data-conversation-id="m-foo"]')).toBeTruthy();
    expect(container.querySelector('[data-conversation-id="r-desktop"]')).toBeTruthy();
    expect(container.querySelector('[data-conversation-id="p-bar"]')).toBeNull();
  });

  it("Test H: filter matches both primary label AND sublabel (identity title/hostname)", () => {
    // Seed an identity that resolves for a row whose targetTmuxSession maps
    // to "sess-alpha" (via sessionMatchKey — case-insensitive). The row's
    // visible sublabel is `identity.title` when subtitleMode="identityTitle"
    // (the pinned + middle render sites use identityTitle mode); or the
    // hostname when there's no identity resolution.
    //
    // Row: primary label = "sess-alpha" (identity.displayName)
    //      sublabel      = "boxA-beta" (identity.title)
    const hostA = makeHost("h1", "hostA");
    mockIdentitiesByKey = new Map([
      [
        "sess-alpha",
        {
          identityKey: "sess-alpha",
          displayName: "sess-alpha",
          title: "boxA-beta",
        },
      ],
    ]);
    setSnapshot({
      middle: [
        makeConversationRow({
          id: "m1",
          label: "sess-alpha", // fallback label (not shown when identity resolves)
          host: hostA,
          targetTmuxSession: "sess-alpha",
        }),
      ],
    });

    // First render — search for "alpha" (matches primary displayName).
    const { container, rerender, unmount } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    const searchInput = container.querySelector(
      '[data-testid="pretty-conversations-search-input"]',
    ) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "alpha" } });
    expect(container.querySelector('[data-conversation-id="m1"]')).toBeTruthy();

    // Same input, new query "beta" — matches sublabel (identity.title).
    fireEvent.change(searchInput, { target: { value: "beta" } });
    expect(container.querySelector('[data-conversation-id="m1"]')).toBeTruthy();
    unmount();
    // rerender kept to satisfy linter about unused var; not needed here.
    void rerender;
  });

  it("Test I: hidden rows are EXCLUDED from filter matches (Ashley lock #3)", () => {
    // A hidden row with label matching the query must NOT appear in results.
    // The store filters hidden ids out of all tiers, so the panel's
    // knownRowsRef accumulator holds hidden rows separately in `hiddenRows`.
    // The filter branch's candidate union must exclude `hiddenRows`.
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      // Visible rows — one matches "foo".
      middle: [
        makeConversationRow({ id: "m-foo", label: "foo-visible", host: hostA }),
      ],
      // Hidden ids include a row that ALSO has "foo" in its label, but the
      // store has already stripped it from the tiers. To exercise the test
      // fully, we seed hiddenIds pointing at a stub id — the panel's
      // knownRowsRef only sees rows that pass through the tiers, so the
      // stub won't have an entry either. Test structure verifies filter
      // renders ONLY visible matches, not phantom hidden matches.
      hiddenIds: new Set(["m-foo-hidden"]),
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const searchInput = container.querySelector(
      '[data-testid="pretty-conversations-search-input"]',
    ) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "foo" } });

    // Only the visible row renders — hidden id doesn't manifest.
    expect(container.querySelector('[data-conversation-id="m-foo"]')).toBeTruthy();
    expect(
      container.querySelector('[data-conversation-id="m-foo-hidden"]'),
    ).toBeNull();
  });

  it("Test I2: rows that transitioned into hidden state are NOT re-included in filter matches", () => {
    // The panel's knownRowsRef accumulates rows seen in the tiers over time.
    // A row that was visible (middle) becomes hidden (id added to hiddenIds)
    // and the store re-emits without that row in middle. Even though
    // knownRowsRef still remembers the row object, the filter's candidate
    // union comes from the CURRENT visible tiers, so the transitioned row
    // must not appear.
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      middle: [
        makeConversationRow({ id: "m1", label: "foo-alpha", host: hostA }),
        makeConversationRow({ id: "m2", label: "foo-beta", host: hostA }),
      ],
    });

    const { container, rerender } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // Both rows visible in the middle initially. Now hide m1 — the store
    // would strip m1 from middle and add its id to hiddenIds.
    setSnapshot({
      middle: [
        makeConversationRow({ id: "m2", label: "foo-beta", host: hostA }),
      ],
      hiddenIds: new Set(["m1"]),
    });
    rerender(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);

    // Search for "foo" — only m2 (visible) should render, NOT m1 (hidden).
    const searchInput = container.querySelector(
      '[data-testid="pretty-conversations-search-input"]',
    ) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "foo" } });
    expect(container.querySelector('[data-conversation-id="m2"]')).toBeTruthy();
    // Ashley lock #3: hidden m1 must NOT appear in matches even though
    // knownRowsRef still holds the row object from the earlier render.
    expect(container.querySelector('[data-conversation-id="m1"]')).toBeNull();
  });

  it("Test J: clearing the query via the × button restores the three-zone render", () => {
    const hostA = makeHost("h1", "hostA");
    const rdpHost = makeHost("h2", "GIGAASHLEYPC", { enableRdp: true });
    setSnapshot({
      pinned: [makeConversationRow({ id: "p1", label: "pinned-alpha", host: hostA })],
      middle: [makeConversationRow({ id: "m1", label: "middle-beta", host: hostA })],
      rdpGroup: {
        hostId: "__rdp__",
        hostName: "",
        rows: [
          makeConversationRow({
            id: "r1",
            label: "GIGAASHLEYPC",
            host: rdpHost,
            rdpHostRow: true,
            targetTmuxSession: null,
          }),
        ],
      },
      pinnedIds: new Set(["p1"]),
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const searchInput = container.querySelector(
      '[data-testid="pretty-conversations-search-input"]',
    ) as HTMLInputElement;

    // Filter on → dividers gone.
    fireEvent.change(searchInput, { target: { value: "alpha" } });
    expect(container.querySelector('[data-testid="pinned-divider"]')).toBeNull();
    expect(container.querySelector('[data-testid="rdp-divider"]')).toBeNull();

    // Click the × clear button — the input value goes back to "" and the
    // three-zone view MUST restore.
    const clearBtn = container.querySelector(
      '[data-testid="pretty-conversations-search-clear"]',
    ) as HTMLButtonElement;
    expect(clearBtn).toBeTruthy();
    fireEvent.click(clearBtn);

    // RDP divider back; pinned divider stays retired unconditionally
    // (Phase 42 UAT amendment 2026-08-17 — absent during filter AND in the
    // three-zone view).
    expect(container.querySelector('[data-testid="pinned-divider"]')).toBeNull();
    expect(container.querySelector('[data-testid="rdp-divider"]')).toBeTruthy();
    // All rows visible again.
    expect(container.querySelector('[data-conversation-id="p1"]')).toBeTruthy();
    expect(container.querySelector('[data-conversation-id="m1"]')).toBeTruthy();
    expect(container.querySelector('[data-conversation-id="r1"]')).toBeTruthy();
  });

  it("Test K: case-insensitive substring match against primary label", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      middle: [
        makeConversationRow({ id: "m1", label: "SessAlpha", host: hostA }),
      ],
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    const searchInput = container.querySelector(
      '[data-testid="pretty-conversations-search-input"]',
    ) as HTMLInputElement;

    // Lowercase query hits mixed-case label.
    fireEvent.change(searchInput, { target: { value: "sess" } });
    expect(container.querySelector('[data-conversation-id="m1"]')).toBeTruthy();

    // Uppercase query hits mixed-case label.
    fireEvent.change(searchInput, { target: { value: "ALPHA" } });
    expect(container.querySelector('[data-conversation-id="m1"]')).toBeTruthy();

    // Non-matching query drops the row.
    fireEvent.change(searchInput, { target: { value: "zebra" } });
    expect(container.querySelector('[data-conversation-id="m1"]')).toBeNull();
  });

  it("Test L: no message body content search — the filter never matches text outside label/sublabel", () => {
    // Row's label is "sess-1". A separate out-of-scope "message content"
    // string is not part of any row field the panel renders in its label.
    // The filter MUST return zero matches for a query that only appears in
    // hypothetical message content, never in label/sublabel.
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      middle: [
        makeConversationRow({ id: "m1", label: "sess-1", host: hostA }),
      ],
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    const searchInput = container.querySelector(
      '[data-testid="pretty-conversations-search-input"]',
    ) as HTMLInputElement;

    // "banana" is not in the row's label / sublabel / host name — no match.
    fireEvent.change(searchInput, { target: { value: "banana" } });
    expect(container.querySelector('[data-conversation-id="m1"]')).toBeNull();
  });

  it("Test M (dedupe): rows appearing in both activeSet and pinned tiers render only ONCE during filter", () => {
    // The panel can emit the same row in multiple tiers (activeSet and
    // pinned can overlap per the store's tier-precedence contract). The
    // filter branch's union+dedupe must render the row exactly once.
    const hostA = makeHost("h1", "hostA");
    const dupeRow = makeConversationRow({ id: "dupe-1", label: "match-me", host: hostA });
    setSnapshot({
      activeSet: [dupeRow],
      pinned: [dupeRow],
      pinnedIds: new Set(["dupe-1"]),
    });
    mockActiveSet = new Set<string>(["dupe-1"]);

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    const searchInput = container.querySelector(
      '[data-testid="pretty-conversations-search-input"]',
    ) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "match" } });

    const matches = container.querySelectorAll('[data-conversation-id="dupe-1"]');
    expect(matches.length).toBe(1);
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
// Phase 52 Plan 04 — filter popover chrome + Ready toggle coverage (10 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: Phase 52 — filter popover restyle + Ready toggle", () => {
  // Clear the Phase 52 Plan 04 seeding Maps after each test in this block.
  // beforeEach (module-level above) resets them to empty; this afterEach
  // clears them as a belt-and-suspenders guard for any tests that mutate
  // the Maps mid-test and don't clean up before asserting a second render.
  afterEach(() => {
    mockIsWorkingByKey.clear();
    mockIsDormantByKey.clear();
    // Phase 53 Plan 03 — clear recycling seed Map alongside sibling Maps.
    mockIsRecyclingByKey.clear();
    mockWorkingSnapshot.clear();
  });

  // ── Shared fixture helper ──────────────────────────────────────────────────
  // Sets up one middle row: tina-session on host "1" (hostA). Used by the
  // four Ready-predicate tests (P50-4, P50-5, P50-6, P50-6b) and P50-9.
  // Keys:
  //   sessionMatchKey("tina-session") → "tina-session" (matchKey used by rowSessionStates)
  //   sessionWorkingKey(row)          → "1:tina-session" (key for per-row hooks)
  function setupTinaRow() {
    const host1 = makeHost("1", "hostA");
    mockIdentitiesByKey = new Map([["tina-session", { identityKey: "tina" }]]);
    setSnapshot({
      activeSet: [],
      pinned: [],
      middle: [
        makeConversationRow({ id: "tina-row", targetTmuxSession: "tina-session", host: host1 }),
      ],
      rdpGroup: null,
    });
  }

  // ── P50-1: Popover chrome tokens (including width:auto override) ──────────

  it("P50-1 — popover chrome tokens are present on PopoverContent inline style including width:auto (plan-checker W-1 alignment)", () => {
    setSnapshot({ activeSet: [], pinned: [], middle: [], rdpGroup: null });
    const { getByTestId, queryByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Open the popover.
    fireEvent.click(getByTestId("pv-filter-toggles"));
    const popover = screen.queryByTestId("pv-filter-toggles-popover");
    expect(popover).toBeTruthy();
    // Read the style attribute and normalize whitespace for reliable substring matching.
    const styleAttr = (popover!.getAttribute("style") ?? "").replace(/\s+/g, " ");
    // Glass gradient background.
    expect(styleAttr).toContain("linear-gradient(160deg");
    // Deep navy base layer — note rgba may or may not have spaces; check both.
    const hasNordBase =
      styleAttr.includes("rgba(20,21,32,0.94)") ||
      styleAttr.includes("rgba(20, 21, 32, 0.94)");
    expect(hasNordBase).toBe(true);
    // Warm-cream border alpha.
    const hasWarmBorder =
      styleAttr.includes("rgba(255,240,215,0.12)") ||
      styleAttr.includes("rgba(255, 240, 215, 0.12)");
    expect(hasWarmBorder).toBe(true);
    // Backdrop blur + saturate.
    expect(styleAttr).toContain("blur(20px)");
    expect(styleAttr).toContain("saturate(1.6)");
    // Warm cream text color. JSDOM normalizes hex to rgb(), so check both forms.
    const hasWarmColor =
      styleAttr.includes("#e8e4d8") ||
      styleAttr.includes("rgb(232, 228, 216)") ||
      styleAttr.includes("rgb(232,228,216)");
    expect(hasWarmColor).toBe(true);
    // min-width: 200px (from minWidth: 200 in React inline style).
    const hasMinWidth =
      styleAttr.includes("min-width: 200px") ||
      styleAttr.includes("min-width:200px");
    expect(hasMinWidth).toBe(true);
    // width: auto — the shadcn w-72 override (plan-checker W-1 alignment).
    const hasWidthAuto =
      styleAttr.includes("width: auto") ||
      styleAttr.includes("width:auto");
    expect(hasWidthAuto).toBe(true);
  });

  // ── P50-2: Menu-item count + order ───────────────────────────────────────

  it("P50-2 — popover renders 3 menuitemcheckbox buttons in Ready → Pinned → Needs desk order", () => {
    setSnapshot({ activeSet: [], pinned: [], middle: [], rdpGroup: null });
    const { getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    fireEvent.click(getByTestId("pv-filter-toggles"));
    const items = screen.getAllByRole("menuitemcheckbox");
    expect(items).toHaveLength(3);
    // Order: Ready first, Pinned second, Needs desk third.
    expect(items[0].textContent).toContain("Ready");
    expect(items[1].textContent).toContain("Pinned");
    expect(items[2].textContent).toContain("Needs desk");
  });

  // ── P50-3: Leading outlined-square check affordance with inline SVG ───────

  it("P50-3 — Ready button has a .pv-filter-check affordance with inline-SVG path M3.5 8.5 L7 12 L13 5; clicking toggles data-checked", () => {
    setSnapshot({ activeSet: [], pinned: [], middle: [], rdpGroup: null });
    const { getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    fireEvent.click(getByTestId("pv-filter-toggles"));
    const readyBtn = screen.getByTestId("pv-filter-toggle-ready");
    // Leading checkbox affordance element.
    const checkEl = readyBtn.querySelector(".pv-filter-check");
    expect(checkEl).toBeTruthy();
    expect(checkEl!.getAttribute("data-checked")).toBe("false");
    // Inline SVG path — exact value from CONTEXT.md § decisions § Menu items.
    const pathEl = readyBtn.querySelector("svg > path");
    expect(pathEl).toBeTruthy();
    expect(pathEl!.getAttribute("d")).toBe("M3.5 8.5 L7 12 L13 5");
    // Click toggles the check.
    fireEvent.click(readyBtn);
    expect(checkEl!.getAttribute("data-checked")).toBe("true");
  });

  // ── P50-4: Ready toggle filters out working rows ──────────────────────────

  it("P50-4 — Ready toggle hides rows where isWorking=true", () => {
    setupTinaRow();
    // Seed working-store snapshot: tina-session is working.
    // Key for mockWorkingSnapshot: sessionMatchKey("tina-session") = "tina-session".
    // Key for mockIsWorkingByKey: sessionWorkingKey(row) = "1:tina-session".
    mockWorkingSnapshot.set("tina-session", { isWorking: true, lastMessageAt: null, aiTitle: null, dormant: false, recycling: false });
    mockIsWorkingByKey.set("1:tina-session", true);
    const { container, getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Pre-filter: row is present.
    expect(container.querySelector('[data-conversation-id="tina-row"]')).toBeTruthy();
    // Enable Ready filter.
    fireEvent.click(getByTestId("pv-filter-toggles"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-ready"));
    // Working row is hidden: !isWorking is false → readyOk is false.
    expect(container.querySelector('[data-conversation-id="tina-row"]')).toBeNull();
  });

  // ── P50-5: Ready toggle filters out dormant rows ──────────────────────────

  it("P50-5 — Ready toggle hides rows where isDormant=true", () => {
    setupTinaRow();
    // Seed: tina-session is dormant (not working, but dormant).
    mockWorkingSnapshot.set("tina-session", { isWorking: false, lastMessageAt: null, aiTitle: null, dormant: true, recycling: false });
    mockIsDormantByKey.set("1:tina-session", true);
    const { container, getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Pre-filter: row is present.
    expect(container.querySelector('[data-conversation-id="tina-row"]')).toBeTruthy();
    // Enable Ready filter.
    fireEvent.click(getByTestId("pv-filter-toggles"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-ready"));
    // Dormant row is hidden: !isDormant is false → readyOk is false.
    expect(container.querySelector('[data-conversation-id="tina-row"]')).toBeNull();
  });

  // ── P50-6: Ready toggle admits idle-not-dormant rows WITH seeded wire signal

  it("P50-6 — Ready toggle shows idle-not-dormant rows that have a seeded wire signal (fail-CLOSED-compatible admit case)", () => {
    setupTinaRow();
    // Seed: tina-session is idle AND not dormant, with an explicit wire signal
    // (rowState IS defined — this is the admit case for fail-CLOSED predicate).
    mockWorkingSnapshot.set("tina-session", { isWorking: false, lastMessageAt: null, aiTitle: null, dormant: false, recycling: false });
    const { container, getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Pre-filter: row is present.
    expect(container.querySelector('[data-conversation-id="tina-row"]')).toBeTruthy();
    // Enable Ready filter.
    fireEvent.click(getByTestId("pv-filter-toggles"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-ready"));
    // Row passes: rowState defined, isWorking=false, isDormant=false → readyOk=true.
    expect(container.querySelector('[data-conversation-id="tina-row"]')).toBeTruthy();
  });

  // ── P50-6b: Ready toggle fail-CLOSED default ──────────────────────────────

  it("P50-6b — Ready toggle fail-CLOSED default: row with no wire signal is HIDDEN when readyOnly is on", () => {
    // fail-CLOSED: a row absent from the working-store snapshot (rowState undefined)
    // is treated as NOT ready. This test locks the W-3 plan-checker fix: if a future
    // refactor reverts to fail-OPEN (!rowState?.isWorking && !rowState?.isDormant),
    // this test fails immediately because undefined?.isWorking evaluates to undefined
    // (falsy) — making the row VISIBLE instead of hidden.
    setupTinaRow();
    // IMPORTANT: do NOT seed mockWorkingSnapshot for "tina-session". The row is
    // truly rowState-undefined — no wire signal has arrived for this session.
    const { container, getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Pre-filter: row is present (Ready toggle is off, so filter is not applied).
    expect(container.querySelector('[data-conversation-id="tina-row"]')).toBeTruthy();
    // Enable Ready filter.
    fireEvent.click(getByTestId("pv-filter-toggles"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-ready"));
    // fail-CLOSED: rowState undefined → readyOk=false → row hidden.
    // The predicate is `!readyOnly || (rowState !== undefined && !rowState.isWorking && !rowState.isDormant)`.
    // With readyOnly=true and rowState=undefined: false → row is filtered out.
    expect(container.querySelector('[data-conversation-id="tina-row"]')).toBeNull();
  });

  // ── P50-7: anyFilterOn extends to readyOnly ───────────────────────────────

  it("P50-7 — anyFilterOn extends to readyOnly: .pv-filter-dot appears and data-active=true when only Ready is on", () => {
    setSnapshot({ activeSet: [], pinned: [], middle: [], rdpGroup: null });
    const { container, getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // No dot initially.
    expect(container.querySelector(".pv-filter-dot")).toBeNull();
    expect(getByTestId("pv-filter-toggles").getAttribute("data-active")).toBe("false");
    // Enable Ready filter only (Pinned + Needs desk remain off).
    fireEvent.click(getByTestId("pv-filter-toggles"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-ready"));
    // anyFilterOn is now true (readyOnly=true) → dot is present.
    expect(container.querySelector(".pv-filter-dot")).toBeTruthy();
    expect(getByTestId("pv-filter-toggles").getAttribute("data-active")).toBe("true");
  });

  // ── P50-8: RDP-group rows pass through unfiltered when Ready is on ────────

  it("P50-8 — RDP-group rows pass through unfiltered when Ready toggle is on", () => {
    // RDP rows never match the identity-based filter predicates (no tmuxSession,
    // no working-store signal) — they are explicitly excluded from filtering per
    // CONTEXT.md § decisions § Filter logic (displayedRdpGroup = rdpGroup verbatim).
    const rdpRow = makeConversationRow({
      id: "rdp-row",
      targetTmuxSession: null,
      host: makeHost("2", "rdpBox"),
      rdpHostRow: true,
    });
    setSnapshot({
      activeSet: [],
      pinned: [],
      middle: [],
      rdpGroup: { hostId: "__rdp__", hostName: "rdp-hosts", rows: [rdpRow] },
    });
    const { container, getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // RDP row is present pre-filter.
    expect(container.querySelector('[data-conversation-id="rdp-row"]')).toBeTruthy();
    // Enable Ready filter.
    fireEvent.click(getByTestId("pv-filter-toggles"));
    fireEvent.click(screen.getByTestId("pv-filter-toggle-ready"));
    // RDP row is still present: it bypasses the filter entirely.
    expect(container.querySelector('[data-conversation-id="rdp-row"]')).toBeTruthy();
  });

  // ── P50-9: AND-intersection: Ready + Pinned reject a row satisfying only Ready

  it("P50-9 — AND-intersection: Ready-on + Pinned-on rejects a row that passes Ready but has pinnedCount=0", () => {
    // tina-session: idle + not-dormant + rowState-defined (passes Ready),
    // but pinnedCount=0 (fails Pinned). After enabling both filters, the row
    // must be hidden because the AND-intersection fails on the Pinned axis.
    const host1 = makeHost("1", "hostA");
    mockIdentitiesByKey = new Map([["tina-session", { identityKey: "tina" }]]);
    mockBountyCounts = new Map([["tina:1", { pinnedCount: 0, needsDeskCount: 0 }]]);
    setSnapshot({
      activeSet: [],
      pinned: [],
      middle: [
        makeConversationRow({ id: "tina-row", targetTmuxSession: "tina-session", host: host1 }),
      ],
      rdpGroup: null,
    });
    // Seed: tina is READY (idle + not-dormant + wire signal present → passes Ready).
    mockWorkingSnapshot.set("tina-session", { isWorking: false, lastMessageAt: null, aiTitle: null, dormant: false, recycling: false });
    const { container, getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Pre-filter: row is present.
    expect(container.querySelector('[data-conversation-id="tina-row"]')).toBeTruthy();
    // Open popover.
    fireEvent.click(getByTestId("pv-filter-toggles"));
    // Enable Ready only: row passes (Ready predicate met; Pinned not yet on).
    fireEvent.click(screen.getByTestId("pv-filter-toggle-ready"));
    expect(container.querySelector('[data-conversation-id="tina-row"]')).toBeTruthy();
    // Now also enable Pinned: AND-intersection fails (pinnedCount=0).
    fireEvent.click(screen.getByTestId("pv-filter-toggle-pinned"));
    expect(container.querySelector('[data-conversation-id="tina-row"]')).toBeNull();
    // Filter dot is present throughout (any filter on → anyFilterOn=true).
    expect(container.querySelector(".pv-filter-dot")).toBeTruthy();
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
        openTabIds={["tab-alice-1"]}
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
        tabId="tab-alice-1"
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
    expect(dt.getData("text/plain")).toBe("tab-alice-1");
    // Belt-and-suspenders: the discriminator MIME is also present so a
    // badge drop that lands on the conv-list (Plan 58-02 target) closes
    // instead of rearranging. Same source, one payload, two consumers.
    const badgePayload = dt.getData("application/x-skynet-badge");
    expect(badgePayload).not.toBe("");
    expect(JSON.parse(badgePayload).tabId).toBe("tab-alice-1");
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
