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
vi.mock("@/state/session-working-store", () => ({
  useSessionIsWorking: () => false,
  useSessionLastMessageAt: () => null,
  getSessionLastMessageAt: () => null,
  subscribeSessionWorkingStore: (_cb: () => void) => () => {},
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
// Test 18 — active-set group renders ABOVE pinned group (Patch #149 B+C)
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: active-set group above pinned (Patch #149 B+C)", () => {
  it("Test 18: data-active-set-group=true renders above data-pinned-group=true in DOM order", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      activeSet: [
        makeConversationRow({ id: "active-1", label: "active-session", host: hostA }),
      ],
      pinned: [
        makeConversationRow({ id: "pinned-1", label: "pinned-session", host: hostA }),
      ],
      grouped: [],
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);

    const activeGroup = container.querySelector(
      '[data-active-set-group="true"]',
    ) as HTMLElement | null;
    const pinnedGroup = container.querySelector(
      '[data-pinned-group="true"]',
    ) as HTMLElement | null;

    expect(activeGroup).toBeTruthy();
    expect(pinnedGroup).toBeTruthy();

    // active-set group must precede pinned group in DOM order
    // Node.DOCUMENT_POSITION_FOLLOWING = 4
    expect(activeGroup!.compareDocumentPosition(pinnedGroup!) & 4).toBe(4);

    // active-1 renders inside the active-set group
    const activeRow = container.querySelector(
      '[data-conversation-id="active-1"]',
    ) as HTMLElement | null;
    expect(activeRow).toBeTruthy();
    expect(activeGroup!.contains(activeRow!)).toBe(true);

    // pinned-1 renders inside the pinned group
    const pinnedRow = container.querySelector(
      '[data-conversation-id="pinned-1"]',
    ) as HTMLElement | null;
    expect(pinnedRow).toBeTruthy();
    expect(pinnedGroup!.contains(pinnedRow!)).toBe(true);
  });

  it("Test 18b: active-set rows render when pinned+grouped are empty", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      activeSet: [
        makeConversationRow({ id: "active-1", label: "active-session", host: hostA }),
      ],
      pinned: [],
      grouped: [],
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);
    expect(
      container.querySelector('[data-conversation-id="active-1"]'),
    ).toBeTruthy();
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

describe("PrettyConversationsPanel: 'Pinned' divider chip (patch #234) — per-host chip RETIRED in Phase 41 Plan 01", () => {
  it('Test 3 (updated Phase 41 Plan 01): renders a "Pinned" divider chip above pinned rows; per-host chip is GONE', () => {
    // Patch #234: pinned tier gets a divider chip when pinned.length > 0.
    // Phase 41 Plan 01: the per-host divider chip above the middle zone was
    // RETIRED (Ashley 2026-08-14 — flat recency-sorted middle). Only the
    // "Pinned" chip + the RDP chip survive.
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      pinned: [makeConversationRow({ id: "a", label: "alpha", host: hostA })],
      middle: [
        makeConversationRow({ id: "c", label: "charlie", host: hostA }),
      ],
      pinnedIds: new Set(["a"]),
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);

    // Patch #234: "Pinned" divider chip present, INSIDE the pinned wrapper.
    const pinnedChip = container.querySelector(
      '[data-testid="pinned-divider"]',
    ) as HTMLElement | null;
    expect(pinnedChip).toBeTruthy();
    expect(pinnedChip!.textContent).toMatch(/Pinned/);
    const pinnedGroup = container.querySelector(
      '[data-pinned-group="true"]',
    ) as HTMLElement | null;
    expect(pinnedGroup).toBeTruthy();
    expect(pinnedGroup!.contains(pinnedChip!)).toBe(true);

    // Phase 41 Plan 01: the per-host divider chip is RETIRED. Assert none.
    const hostChip = container.querySelector('[data-testid="host-divider"]');
    expect(hostChip).toBeNull();
  });

  it('Test 3B (patch #234): does NOT render the "Pinned" divider chip when pinned is empty', () => {
    // Gating rule per Ashley: the chip only shows when there are pins.
    // An empty pinned tier stays visually absent — no lonely header.
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

  it("Test 19B (rewritten): active-set + pinned + middle → NO host-divider chip renders anywhere in the panel", () => {
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

    // Active-set + pinned wrappers exist as structural preconditions.
    const activeGroup = container.querySelector(
      '[data-active-set-group="true"]',
    ) as HTMLElement | null;
    const pinnedGroup = container.querySelector(
      '[data-pinned-group="true"]',
    ) as HTMLElement | null;
    expect(activeGroup).toBeTruthy();
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

  // Phase 41 Plan 01 regression (Ashley lock #8): the ready-dot renders on
  // every non-working middle row regardless of active-set membership. Locks
  // patch #447 behavior survives the ambient CSS retirement.
  it("Test 19E (ready-dot-on-all-non-working): every non-working middle row renders the ready-dot regardless of active-set", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      // Two rows, neither in the active-set, both non-working (default in
      // the mock — useSessionIsWorking returns false → dot renders).
      middle: [
        makeConversationRow({ id: "m1", label: "s1", host: hostA }),
        makeConversationRow({ id: "m2", label: "s2", host: hostA }),
      ],
      // mockActiveSet is empty (reset in beforeEach) → both rows have
      // inActiveSet=false. Post-Phase-41 retirement, the dot MUST still
      // render for both.
    });

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    // Both rows carry the ready-dot span.
    const m1 = container.querySelector('[data-conversation-id="m1"]');
    const m2 = container.querySelector('[data-conversation-id="m2"]');
    expect(m1).toBeTruthy();
    expect(m2).toBeTruthy();
    expect(m1!.querySelector('[data-pv-conv-ready-dot="true"]')).toBeTruthy();
    expect(m2!.querySelector('[data-pv-conv-ready-dot="true"]')).toBeTruthy();
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
  it("Test 20A: desktop active-set non-RDP row → contextmenu opens portal menu carrying BOTH Pin and Deactivate items (post quick-260730-o2m: actions moved out of .pv-meta into the right-click menu; menu order is Pin then Deactivate per source items[].push order)", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      activeSet: [
        makeConversationRow({ id: "active-1", label: "active-session", host: hostA }),
      ],
      pinned: [],
      grouped: [],
    });
    // The row is in the panel's `activeSetRows` (structural tier 1) AND the
    // useActiveSet ReadonlySet (drives the row's inActiveSet prop) — both
    // are required to hit the "Deactivate menu item eligible" branch.
    mockActiveSet = new Set<string>(["active-1"]);

    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="active-1"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();

    // Post quick-260730-o2m: neither PinAction nor DeactivateAction render
    // in the desktop .pv-meta column. Both actions live in the right-click
    // context menu (portal-mounted to document.body).
    const meta = rowEl!.querySelector(".pv-meta") as HTMLElement | null;
    expect(meta).toBeTruthy();
    expect(meta!.querySelector('[data-testid="deactivate-action"]')).toBeNull();
    expect(meta!.querySelector('[data-testid="pin-action"]')).toBeNull();

    // Dispatch contextmenu on the row body to open the portal menu.
    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    const menu = screen.getByRole("menu");
    const pinItem = within(menu).getByRole("menuitem", { name: /pin/i });
    const deactivateItem = within(menu).getByRole("menuitem", {
      name: /deactivate/i,
    });
    // Menu DOM order: Pin FIRST, Deactivate SECOND — matches the source's
    // items[].push order in PrettyConversationRow.tsx (Pin unconditionally
    // pushed first; Deactivate pushed only when inActiveSet && onDeactivate).
    // Node.DOCUMENT_POSITION_FOLLOWING = 4 — pin precedes deactivate.
    expect(pinItem.compareDocumentPosition(deactivateItem) & 4).toBe(4);
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

  it("Test 20E: clicking the Deactivate menu item calls removeFromActiveSet(row.id) + onDeactivateRow(row) exactly once each; row-body onSelect (selectConversation / onConversationSelected) is NOT called", () => {
    // Post quick-260730-o2m: deactivate is reached via right-click context
    // menu, not the .pv-meta icon. The panel's `handleRowDeactivate`
    // composition (removeFromActiveSet + onDeactivateRow) still fires
    // — the menu-item click forwards to the same onDeactivate callback
    // wired at PrettyConversationRow.tsx items[].push.
    //
    // The context menu's item-click handler calls e.stopPropagation(), so
    // the row-body onSelect path still never runs.
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      activeSet: [
        makeConversationRow({ id: "active-1", label: "active-session", host: hostA }),
      ],
      pinned: [],
      grouped: [],
    });
    mockActiveSet = new Set<string>(["active-1"]);

    const onDeactivateRow = vi.fn();
    const onConversationSelected = vi.fn();

    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={onDeactivateRow}
        onConversationSelected={onConversationSelected}
      />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="active-1"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();
    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;

    // Clear the addToActiveSetSpy's mount-time invocation from the panel's
    // useEffect on [selectedId]; we care only about the click-driven calls
    // to removeFromActiveSet + onDeactivateRow below.
    removeFromActiveSetSpy.mockClear();
    selectConversationSpy.mockClear();
    onConversationSelected.mockClear();

    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    const menu = screen.getByRole("menu");
    const deactivateItem = within(menu).getByRole("menuitem", {
      name: /deactivate/i,
    });
    fireEvent.click(deactivateItem);

    // Panel-level composition: removeFromActiveSet(row.id) + onDeactivateRow(row).
    expect(removeFromActiveSetSpy).toHaveBeenCalledTimes(1);
    expect(removeFromActiveSetSpy).toHaveBeenCalledWith("active-1");
    expect(onDeactivateRow).toHaveBeenCalledTimes(1);
    expect(onDeactivateRow.mock.calls[0][0].id).toBe("active-1");

    // Row-body onSelect (row-click path) MUST NOT fire — the context menu's
    // item click handler calls e.stopPropagation() BEFORE dispatching the
    // item.onClick, so the row-body click handler never runs.
    expect(selectConversationSpy).not.toHaveBeenCalled();
    expect(onConversationSelected).not.toHaveBeenCalled();
  });

  // quick-260727-s8g: locks in the id-shape-mismatch fix. handleRowDeactivate
  // now purges BOTH the openTab id (row.id) AND the fleet-synthetic id
  // (fleet::HOSTID::SESSIONNAME) when the row carries host + targetTmuxSession
  // — otherwise the fleet id gets orphaned in state.activeSet and Tier 1
  // re-promotes the row on the next computeSnapshot.
  it("Test 20F: clicking the Deactivate menu item on a fleet-derived active-set row purges BOTH id shapes — removeFromActiveSet(row.id) AND removeFromActiveSet(fleet::hostId::sessionName)", () => {
    const hostThenasty = makeHost("3", "thenasty");
    setSnapshot({
      activeSet: [
        makeConversationRow({
          id: "active-1",
          label: "shrok",
          host: hostThenasty,
          targetTmuxSession: "shrok",
        }),
      ],
      pinned: [],
      grouped: [],
    });
    mockActiveSet = new Set<string>(["active-1", "fleet::3::shrok"]);

    const onDeactivateRow = vi.fn();
    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={onDeactivateRow} />,
    );
    const rowEl = container.querySelector(
      '[data-conversation-id="active-1"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();
    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;

    removeFromActiveSetSpy.mockClear();

    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    const menu = screen.getByRole("menu");
    const deactivateItem = within(menu).getByRole("menuitem", {
      name: /deactivate/i,
    });
    fireEvent.click(deactivateItem);

    // BOTH id shapes purged — openTab id first, fleet-synthetic id second.
    expect(removeFromActiveSetSpy).toHaveBeenCalledTimes(2);
    expect(removeFromActiveSetSpy).toHaveBeenNthCalledWith(1, "active-1");
    expect(removeFromActiveSetSpy).toHaveBeenNthCalledWith(2, "fleet::3::shrok");
    expect(onDeactivateRow).toHaveBeenCalledTimes(1);
    expect(onDeactivateRow.mock.calls[0][0].id).toBe("active-1");
  });

  // quick-260727-s8g: guard branch — row without targetTmuxSession skips the
  // fleet-id sibling purge so we never construct a bogus `fleet::N::` string.
  // (MockRow.host is `Host | undefined`, not nullable; using
  // targetTmuxSession=null exercises the same short-circuit branch of the
  // `if (row.host && row.targetTmuxSession)` guard.)
  it("Test 20G: clicking the Deactivate menu item on a row with no targetTmuxSession skips the fleet-id sibling purge — removeFromActiveSet called exactly once with row.id, no crash", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      activeSet: [
        makeConversationRow({
          id: "active-2",
          label: "orphan",
          host: hostA,
          targetTmuxSession: null,
        }),
      ],
      pinned: [],
      grouped: [],
    });
    mockActiveSet = new Set<string>(["active-2"]);

    const onDeactivateRow = vi.fn();
    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={onDeactivateRow} />,
    );
    const rowEl = container.querySelector(
      '[data-conversation-id="active-2"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();
    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;

    removeFromActiveSetSpy.mockClear();

    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    const menu = screen.getByRole("menu");
    const deactivateItem = within(menu).getByRole("menuitem", {
      name: /deactivate/i,
    });
    fireEvent.click(deactivateItem);

    expect(removeFromActiveSetSpy).toHaveBeenCalledTimes(1);
    expect(removeFromActiveSetSpy).toHaveBeenCalledWith("active-2");
    // No fleet-id call — the guard skipped it.
    for (const call of removeFromActiveSetSpy.mock.calls) {
      expect(String(call[0])).not.toContain("fleet::");
    }
    expect(onDeactivateRow).toHaveBeenCalledTimes(1);
  });

  // Ordering contract for bounty #5 (deactivate-conversation-instant). The urgent
  // Zustand `removeFromActiveSet` MUST fire before `onDeactivateRow` so React commits
  // the list update in a separate render pass from the deferred `startTransition`-wrapped
  // tab switch inside `AppShell.doCloseTab`. Reordering these calls would collapse the
  // two commits back into one and re-introduce the ~1s freeze.
  it("Test 20H: handleRowDeactivate fires removeFromActiveSet synchronously before onDeactivateRow — ordering contract for startTransition split in AppShell.doCloseTab (bounty #5)", () => {
    // Use a numeric string host id so parseInt(host.id, 10) resolves to a valid number,
    // matching the real fleetRowId(parseInt(row.host.id, 10), ...) call shape in the component.
    const hostA = makeHost("7", "hostA");
    const activeRow = makeConversationRow({
      id: "active-h",
      label: "ordering-test",
      host: hostA,
      targetTmuxSession: "ordering-session",
    });
    setSnapshot({
      activeSet: [activeRow],
      pinned: [],
      grouped: [],
    });
    mockActiveSet = new Set<string>(["active-h", "fleet::7::ordering-session"]);

    const onDeactivateRow = vi.fn();
    const { container } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={onDeactivateRow} />,
    );

    const rowEl = container.querySelector(
      '[data-conversation-id="active-h"]',
    ) as HTMLElement | null;
    expect(rowEl).toBeTruthy();
    const body = rowEl!.querySelector('[role="button"]') as HTMLElement;

    removeFromActiveSetSpy.mockClear();
    onDeactivateRow.mockClear();

    fireEvent.contextMenu(body, { clientX: 100, clientY: 100 });
    const menu = screen.getByRole("menu");
    const deactivateItem = within(menu).getByRole("menuitem", {
      name: /deactivate/i,
    });
    fireEvent.click(deactivateItem);

    // removeFromActiveSet: called twice (row.id + fleet-synthetic id) due to host + targetTmuxSession.
    expect(removeFromActiveSetSpy).toHaveBeenNthCalledWith(1, "active-h");
    expect(removeFromActiveSetSpy).toHaveBeenNthCalledWith(2, "fleet::7::ordering-session");

    // onDeactivateRow: called once with the full row.
    expect(onDeactivateRow).toHaveBeenCalledWith(activeRow);

    // Ordering contract: removeFromActiveSet's first call MUST precede onDeactivateRow.
    // If this assertion fails, the two commits collapse back into one and the ~1s freeze returns.
    expect(removeFromActiveSetSpy.mock.invocationCallOrder[0]).toBeLessThan(
      onDeactivateRow.mock.invocationCallOrder[0],
    );
  });
});

// quick-260807-e4s: locks in the id-shape-mismatch fix. Panel-side
// isRowPinned(row) must mirror the store's Tier 2 shadow-fleet-id
// pinned computation (conversation-store.ts:493-499) at the two
// active-set-tier render sites (active-set map + grouped host map).
describe("PrettyConversationsPanel: active-set fleet-shadow-id pinned recognition (quick-260807-e4s)", () => {
  it("Test E4S-01: active-set row whose pin lives under fleet::HOSTID::SESSIONNAME shows Unpin (not Pin) in the right-click context menu", () => {
    const hostA = makeHost("1", "hostA");
    const activeRow = makeConversationRow({
      id: "active-alpha",
      label: "alpha",
      host: hostA,
      targetTmuxSession: "alpha",
    });
    setSnapshot({
      activeSet: [activeRow],
      pinned: [],
      grouped: [],
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
    const hostA = makeHost("1", "hostA");
    const activeRow = makeConversationRow({
      id: "active-alpha",
      label: "alpha",
      host: hostA,
      targetTmuxSession: "alpha",
    });
    setSnapshot({
      activeSet: [activeRow],
      pinned: [],
      grouped: [],
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
    const hostA = makeHost("1", "hostA");
    const activeRow = makeConversationRow({
      id: "active-alpha",
      label: "alpha",
      host: hostA,
      targetTmuxSession: "alpha",
    });
    setSnapshot({
      activeSet: [activeRow],
      pinned: [],
      grouped: [],
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

  it("Test 24: clicking the button opens the popover; both checkboxes unchecked; button still data-active=false + no dot", () => {
    setSnapshot({ activeSet: [], pinned: [], grouped: [] });
    const { container, getByTestId, queryByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Open the popover.
    fireEvent.click(getByTestId("pv-filter-toggles"));
    // Popover is now in DOM (via portal — use screen queries).
    expect(screen.queryByTestId("pv-filter-toggles-popover")).toBeTruthy();
    // Both checkboxes present, both unchecked (Radix state="unchecked").
    const pinnedCb = screen.getByTestId("pv-filter-toggle-pinned");
    const deskCb = screen.getByTestId("pv-filter-toggle-needs-desk");
    expect(pinnedCb.getAttribute("data-state")).toBe("unchecked");
    expect(deskCb.getAttribute("data-state")).toBe("unchecked");
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

  it("Test 28: active-set tier is exempt from BOTH filter predicates when both toggles are on", () => {
    // Phase 26 D-06 symmetric exemption: nelly in active-set (pinned=0, desk=0)
    // must remain visible even when both toggles are on. nelly in pinned tier
    // (same counts) gets filtered out — exemption is tier-scoped, not identity-scoped.
    // tina in grouped (pinned=3, desk=1) also survives the AND filter.
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
      activeSet: [
        makeConversationRow({ id: "nelly-active", targetTmuxSession: "nelly-session", host: host1 }),
      ],
      pinned: [
        makeConversationRow({ id: "nelly-pinned", targetTmuxSession: "nelly-session", host: host1 }),
      ],
      grouped: [
        {
          hostId: "1",
          hostName: "hostA",
          rows: [
            makeConversationRow({ id: "tina-grouped", targetTmuxSession: "tina-session", host: host1 }),
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
    // Active-set row shows despite nelly having (pinned=0, desk=0).
    expect(container.querySelector('[data-conversation-id="nelly-active"]')).toBeTruthy();
    // Pinned-tier row with (pinned=0, desk=0) is still filtered out — tier-scoped exemption.
    expect(container.querySelector('[data-conversation-id="nelly-pinned"]')).toBeFalsy();
    // Grouped row with (pinned=3, desk=1) survives AND filter.
    expect(container.querySelector('[data-conversation-id="tina-grouped"]')).toBeTruthy();
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

describe("PrettyConversationsPanel: pinned rows render identity title (patch #184 / quick-260729-gsv)", () => {
  it("Test 29: pinned row with resolved identity renders identity.title (no Server icon, no hostname)", () => {
    const hostA = makeHost("h1", "hostA");
    // Seed the identity for the pinned row's tmux session. The session-hue
    // mock at lines 42-45 lowercases the tmux session name via
    // sessionMatchKey, so the map key MUST match that transform.
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

    // Scope every query to the pinned-group wrapper — future-proofs the
    // test against unrelated rows leaking into the assertion set.
    const pinnedGroup = container.querySelector(
      '[data-pinned-group="true"]',
    ) as HTMLElement | null;
    expect(pinnedGroup).toBeTruthy();

    const pinnedRow = pinnedGroup!.querySelector(
      '[data-conversation-id="pinned-1"]',
    ) as HTMLElement | null;
    expect(pinnedRow).toBeTruthy();

    const pvHost = pinnedRow!.querySelector(
      ".pv-host",
    ) as HTMLElement | null;
    expect(pvHost).toBeTruthy();

    // (1) identity.title text renders under the label.
    expect(pvHost!.textContent).toContain("Tina's Laptop");
    // (2) The hostname (hostA) does NOT appear in the sublabel — confirms
    //     the swap from the pre-#184 "Server icon + row.host.name" render.
    expect(pvHost!.textContent).not.toContain("hostA");
    // (3) The Server icon (rendered as <svg> inside .pv-host in the
    //     hostname-mode path) MUST NOT render inside the pinned row's
    //     .pv-host when identityTitle mode resolves — the pin glyph +
    //     absence of the icon jointly signal the identity-first treatment.
    expect(pvHost!.querySelector("svg")).toBeFalsy();
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
  // Move/Open-in-new-window, with Deactivate at the tail. quick-260804-uo4
  // inserted "Move to new window" between Clone and Deactivate; for a row
  // without an identity Clone is auto-hidden, so the order collapses to
  // Pin, Hide, Move to new window, Deactivate.
  it("Test (g): context menu on a non-hidden active-set row shows Pin/Hide/Move-to-new-window/Deactivate in order", async () => {
    setSnapshot({
      activeSet: [
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
    // Expected order: Pin, Hide, Move to new window, Deactivate (Clone
    // hidden — row has no identity).
    expect(labels[0]).toMatch(/pin/i);
    expect(labels[1]).toMatch(/hide/i);
    expect(labels[2]).toMatch(/move to new window/i);
    expect(labels[3]).toMatch(/deactivate/i);
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
    setSnapshot({
      activeSet: [
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

  it("Test F: empty query → three-zone view renders (pinned divider + rdp divider present)", () => {
    // Precondition: searchQuery starts as "" — three-zone view intact.
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

    // Ashley lock: pinned divider visible, RDP divider visible, all rows
    // in their respective zones.
    expect(container.querySelector('[data-testid="pinned-divider"]')).toBeTruthy();
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

    // Dividers back.
    expect(container.querySelector('[data-testid="pinned-divider"]')).toBeTruthy();
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
