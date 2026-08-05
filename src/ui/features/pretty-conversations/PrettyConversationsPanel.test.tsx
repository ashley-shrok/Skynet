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

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
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
let mockBountyCounts: ReadonlyMap<string, number> = new Map();

vi.mock("@/state/bounty-counts-store", () => ({
  useBountyCount: (identityKey: string | null, hostId: number | null) => {
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

type MockSnapshot = {
  activeSet: MockRow[];
  pinned: MockRow[];
  grouped: MockGroup[];
  selectedId: string | null;
  pinnedIds: ReadonlySet<string>;
  hiddenIds: ReadonlySet<string>;
};

let snapshot: MockSnapshot = {
  activeSet: [],
  pinned: [],
  grouped: [],
  selectedId: null,
  pinnedIds: new Set(),
  hiddenIds: new Set(),
};

function setSnapshot(next: Partial<MockSnapshot>): void {
  snapshot = {
    activeSet: next.activeSet ?? [],
    pinned: next.pinned ?? [],
    grouped: next.grouped ?? [],
    selectedId: next.selectedId ?? null,
    pinnedIds: next.pinnedIds ?? new Set(),
    hiddenIds: next.hiddenIds ?? new Set(),
  };
}

const selectConversationSpy = vi.fn();
const togglePinConversationSpy = vi.fn();
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
    grouped: snapshot.grouped,
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
  togglePinConversation: (id: string) => togglePinConversationSpy(id),
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

// Patch #137: PrettyConversationsPanel calls useSessionWorking(sessionKey)
// inside its per-row PrettyConversationRowLive micro-component. Mock
// returns null for every key so the ready-dot render condition is never
// satisfied — matches this test file's pre-patch-#137 behavior of never
// rendering a dot at any render site.
vi.mock("@/state/session-working-store", () => ({
  useSessionWorking: () => null,
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
    grouped: [],
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
  mockBountyCounts = new Map();
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

describe("PrettyConversationsPanel: 'Pinned' divider chip + per-host divider chip (patch #234 Test 3 rewrite)", () => {
  it('Test 3 (post-#234): renders a "Pinned" divider chip above pinned rows AND a per-host divider chip above the non-RDP grouped section', () => {
    // Contract change (patch #234): pinned tier now DOES get a divider
    // chip above it when pinned.length > 0, mirroring the RDP chip's
    // treatment (Pin glyph + uppercase muted label + gradient rule). The
    // previous "no 'Pinned' section header" lock (quick-260727-f9v) is
    // reversed by Ashley's request 2026-07-31.
    // The per-host divider chip above the non-RDP grouped section
    // (quick-260727-f9v) is preserved unchanged.
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      pinned: [makeConversationRow({ id: "a", label: "alpha", host: hostA })],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [
            makeConversationRow({ id: "c", label: "charlie", host: hostA }),
          ],
        },
      ],
      pinnedIds: new Set(["a"]),
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);

    // NEW (patch #234): "Pinned" divider chip present, INSIDE the
    // data-pinned-group wrapper (so intra-group spacing rules apply),
    // and its label text is "Pinned".
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

    // Preserved (quick-260727-f9v): the per-host divider chip above
    // hostA's non-RDP grouped section carries data-testid="host-divider"
    // AND data-host-id="h1" AND label text "hostA".
    const hostChip = container.querySelector(
      '[data-testid="host-divider"]',
    ) as HTMLElement | null;
    expect(hostChip).toBeTruthy();
    expect(hostChip!.getAttribute("data-host-id")).toBe("h1");
    expect(hostChip!.textContent).toMatch(/hostA/);
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

describe("PrettyConversationsPanel: per-host divider chips (quick-260727-f9v)", () => {
  it("Test 19A: two non-RDP host groups → two host-divider chips, each with its hostName + Server icon", () => {
    const hostA = makeHost("h1", "hostA");
    const hostB = makeHost("h2", "hostB");
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [makeConversationRow({ id: "c1", label: "s1", host: hostA })],
        },
        {
          hostId: "h2",
          hostName: "hostB",
          rows: [makeConversationRow({ id: "c2", label: "s2", host: hostB })],
        },
      ],
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);

    const chips = Array.from(
      container.querySelectorAll('[data-testid="host-divider"]'),
    ) as HTMLElement[];
    expect(chips.length).toBe(2);

    // One chip per host, labeled with its hostName. Test C's guard on
    // the load-bearing detail: each chip contains an svg (the Server
    // glyph) so the visual grouping affordance is present.
    const byId = new Map(
      chips.map((c) => [c.getAttribute("data-host-id"), c]),
    );
    expect(byId.get("h1")).toBeTruthy();
    expect(byId.get("h2")).toBeTruthy();
    expect(byId.get("h1")!.textContent).toMatch(/hostA/);
    expect(byId.get("h2")!.textContent).toMatch(/hostB/);
    expect(byId.get("h1")!.querySelector("svg")).toBeTruthy();
    expect(byId.get("h2")!.querySelector("svg")).toBeTruthy();
  });

  it("Test 19B: active-set + pinned + one non-RDP group → exactly ONE host-divider (only above the grouped host, NOT above active-set / pinned)", () => {
    const hostA = makeHost("h1", "hostA");
    setSnapshot({
      activeSet: [
        makeConversationRow({ id: "active-1", label: "active-session", host: hostA }),
      ],
      pinned: [
        makeConversationRow({ id: "pinned-1", label: "pinned-session", host: hostA }),
      ],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [makeConversationRow({ id: "c1", label: "charlie", host: hostA })],
        },
      ],
      pinnedIds: new Set(["pinned-1"]),
    });

    const { container } = render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);

    // Exactly one host-divider — only above the grouped host section.
    const chips = Array.from(
      container.querySelectorAll('[data-testid="host-divider"]'),
    ) as HTMLElement[];
    expect(chips.length).toBe(1);
    expect(chips[0].getAttribute("data-host-id")).toBe("h1");

    // Active-set and pinned wrappers exist as structural preconditions,
    // and NEITHER has a `host-divider` as an immediately-preceding
    // sibling (i.e. a chip does not render ABOVE those groups).
    const activeGroup = container.querySelector(
      '[data-active-set-group="true"]',
    ) as HTMLElement | null;
    const pinnedGroup = container.querySelector(
      '[data-pinned-group="true"]',
    ) as HTMLElement | null;
    expect(activeGroup).toBeTruthy();
    expect(pinnedGroup).toBeTruthy();
    // Neither's previousElementSibling is a chip.
    const activePrev = activeGroup!.previousElementSibling as HTMLElement | null;
    const pinnedPrev = pinnedGroup!.previousElementSibling as HTMLElement | null;
    expect(activePrev?.getAttribute("data-testid")).not.toBe("host-divider");
    expect(pinnedPrev?.getAttribute("data-testid")).not.toBe("host-divider");
  });

  it("Test 19C: non-RDP host group + __rdp__ sentinel group → BOTH host-divider AND rdp-divider render (new chip does NOT replace / duplicate the RDP chip)", () => {
    const hostA = makeHost("h1", "hostA");
    const rdpHost = makeHost("h2", "GIGAASHLEYPC", { enableRdp: true });
    setSnapshot({
      pinned: [],
      grouped: [
        {
          hostId: "h1",
          hostName: "hostA",
          rows: [makeConversationRow({ id: "c1", label: "s1", host: hostA })],
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

    const { container } = render(<PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />);

    // Both chips render side-by-side, one for each group type.
    const hostChips = container.querySelectorAll('[data-testid="host-divider"]');
    const rdpChips = container.querySelectorAll('[data-testid="rdp-divider"]');
    expect(hostChips.length).toBe(1);
    expect(rdpChips.length).toBe(1);
    // The host chip labels hostA (NOT the __rdp__ sentinel, which has
    // empty hostName and should never surface as a chip label).
    expect((hostChips[0] as HTMLElement).getAttribute("data-host-id")).toBe("h1");
    expect((hostChips[0] as HTMLElement).textContent).toMatch(/hostA/);
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
// Patch #167 — pinned-bounty filter
// ─────────────────────────────────────────────────────────────────────────────

// Patch #317 (2026-08-04): filter button intentionally hidden by wrapping
// `.pv-filter` in `{false && (...)}` per Ashley's temporary ask. These 6 tests
// exercise the filter's rendered chrome + click behavior, so they cannot run
// while the button is gated off. Flip .skip → runnable when the un-hide lands
// (bounty: filter-button-temp-hide-in-panel-header).
describe.skip("PrettyConversationsPanel: pinned-bounty filter (Patch #167)", () => {
  it("Test 23: filter button renders with data-active=false + aria-pressed=false by default", () => {
    setSnapshot({ activeSet: [], pinned: [], grouped: [] });
    const { getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    const btn = getByTestId("pv-filter-pinned-bounties");
    expect(btn.getAttribute("data-active")).toBe("false");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("Test 24: clicking the filter button flips data-active + aria-pressed to true", () => {
    setSnapshot({ activeSet: [], pinned: [], grouped: [] });
    const { getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    const btn = getByTestId("pv-filter-pinned-bounties");
    fireEvent.click(btn);
    expect(btn.getAttribute("data-active")).toBe("true");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(btn.getAttribute("data-active")).toBe("false");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("Test 25: filter=off shows all rows; filter=on hides rows whose identity has 0 pinned bounties", () => {
    // Two grouped rows, both under identities that resolve. Only "tina" has
    // any pinned bounties; "nelly" has 0. Filter=off shows both, filter=on
    // shows only the tina row.
    const host1 = makeHost("1", "hostA");
    mockIdentitiesByKey = new Map([
      ["tina-session", { identityKey: "tina" }],
      ["nelly-session", { identityKey: "nelly" }],
    ]);
    // Composite key format matches the store's real one:
    // `${identityKey}:${hostId ?? "local"}`. Host id 1 → "tina:1".
    mockBountyCounts = new Map([
      ["tina:1", 3],
      ["nelly:1", 0],
    ]);
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [
        {
          hostId: "1",
          hostName: "hostA",
          rows: [
            makeConversationRow({
              id: "tina-row",
              targetTmuxSession: "tina-session",
              host: host1,
            }),
            makeConversationRow({
              id: "nelly-row",
              targetTmuxSession: "nelly-session",
              host: host1,
            }),
          ],
        },
      ],
    });
    const { container, getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Filter off: both rows visible.
    expect(
      container.querySelector('[data-conversation-id="tina-row"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-conversation-id="nelly-row"]'),
    ).toBeTruthy();
    // Flip filter on.
    fireEvent.click(getByTestId("pv-filter-pinned-bounties"));
    // Filter on: only tina-row remains; nelly-row filtered out.
    expect(
      container.querySelector('[data-conversation-id="tina-row"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-conversation-id="nelly-row"]'),
    ).toBeFalsy();
  });

  it("Test 26: filter=on with no matching rows renders no rows (empty-state card retired 2026-08-02)", () => {
    // One row with no pinned bounties; identity resolves but count is 0.
    // Filter on → row filtered out → no rows render. No dedicated empty
    // card any more; the header chrome (SKYNET logo, filter, pencil, meter)
    // is affordance enough per Ashley 2026-08-02.
    const host1 = makeHost("1", "hostA");
    mockIdentitiesByKey = new Map([
      ["nelly-session", { identityKey: "nelly" }],
    ]);
    mockBountyCounts = new Map([["nelly:1", 0]]);
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [
        {
          hostId: "1",
          hostName: "hostA",
          rows: [
            makeConversationRow({
              id: "nelly-row",
              targetTmuxSession: "nelly-session",
              host: host1,
            }),
          ],
        },
      ],
    });
    const { container, getByTestId, queryByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Filter off: nelly-row is visible.
    expect(
      container.querySelector('[data-conversation-id="nelly-row"]'),
    ).toBeTruthy();
    // Flip filter on.
    fireEvent.click(getByTestId("pv-filter-pinned-bounties"));
    // Filter on with 0 matches: no rows render, no empty-state card.
    expect(
      container.querySelector('[data-conversation-id="nelly-row"]'),
    ).toBeFalsy();
    expect(queryByTestId("pretty-conversations-empty")).toBeNull();
  });

  it("Test 27: filter=on drops groups whose rows are ALL filtered out (no orphan host-divider chip)", () => {
    // Two groups: hostA (one nelly row, 0 pins) and hostB (one tina row, 3
    // pins). With filter on, hostA disappears entirely — no divider chip left
    // over.
    const hostA = makeHost("1", "hostA");
    const hostB = makeHost("2", "hostB");
    mockIdentitiesByKey = new Map([
      ["tina-session", { identityKey: "tina" }],
      ["nelly-session", { identityKey: "nelly" }],
    ]);
    mockBountyCounts = new Map([
      ["tina:2", 3],
      ["nelly:1", 0],
    ]);
    setSnapshot({
      activeSet: [],
      pinned: [],
      grouped: [
        {
          hostId: "1",
          hostName: "hostA",
          rows: [
            makeConversationRow({
              id: "nelly-row",
              targetTmuxSession: "nelly-session",
              host: hostA,
            }),
          ],
        },
        {
          hostId: "2",
          hostName: "hostB",
          rows: [
            makeConversationRow({
              id: "tina-row",
              targetTmuxSession: "tina-session",
              host: hostB,
            }),
          ],
        },
      ],
    });
    const { container, getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    fireEvent.click(getByTestId("pv-filter-pinned-bounties"));
    // hostA's divider should be gone (its only row was filtered out).
    const hostADivider = container.querySelector(
      '[data-testid="host-divider"][data-host-id="1"]',
    );
    expect(hostADivider).toBeFalsy();
    // hostB's divider stays.
    const hostBDivider = container.querySelector(
      '[data-testid="host-divider"][data-host-id="2"]',
    );
    expect(hostBDivider).toBeTruthy();
  });

  it("Test 28: filter=on always shows active-set rows regardless of pinned-bounty count", () => {
    // Ashley 2026-07-28: pinned-bounty filter exempts the active-set tier.
    // Active session with 0 pinned bounties (nelly) must remain visible when
    // the filter is on; a pinned-tier row with 0 pinned bounties (nelly, in
    // the pinned tier this time) still gets filtered out — the exemption is
    // scoped to the active-set tier, not "any row whose identity is active."
    const host1 = makeHost("1", "hostA");
    mockIdentitiesByKey = new Map([
      ["nelly-session", { identityKey: "nelly" }],
      ["tina-session", { identityKey: "tina" }],
    ]);
    mockBountyCounts = new Map([
      ["nelly:1", 0],
      ["tina:1", 3],
    ]);
    setSnapshot({
      activeSet: [
        makeConversationRow({
          id: "nelly-active",
          targetTmuxSession: "nelly-session",
          host: host1,
        }),
      ],
      pinned: [
        makeConversationRow({
          id: "nelly-pinned",
          targetTmuxSession: "nelly-session",
          host: host1,
        }),
      ],
      grouped: [
        {
          hostId: "1",
          hostName: "hostA",
          rows: [
            makeConversationRow({
              id: "tina-grouped",
              targetTmuxSession: "tina-session",
              host: host1,
            }),
          ],
        },
      ],
    });
    const { container, getByTestId } = render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    // Flip filter on.
    fireEvent.click(getByTestId("pv-filter-pinned-bounties"));
    // Active-set row shows despite nelly having 0 pinned bounties.
    expect(
      container.querySelector('[data-conversation-id="nelly-active"]'),
    ).toBeTruthy();
    // Pinned-tier row with 0 pinned bounties is still filtered out —
    // exemption is tier-scoped, not identity-scoped.
    expect(
      container.querySelector('[data-conversation-id="nelly-pinned"]'),
    ).toBeFalsy();
    // Grouped row with pins stays visible (unchanged behavior).
    expect(
      container.querySelector('[data-conversation-id="tina-grouped"]'),
    ).toBeTruthy();
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
  // unhideConversation(rowId) BEFORE togglePinConversation(rowId) when the
  // row is in hiddenIds. We trigger this via right-click → context menu → Pin
  // on a row in the grouped tier that is also in hiddenIds.
  it("Test (f): handleTogglePin on a hidden row calls unhideConversation THEN togglePinConversation", async () => {
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
      expect(togglePinConversationSpy).toHaveBeenCalledWith("row-to-pin-unhide");
    });

    // Verify call ORDER: unhide must come before togglePin.
    const unhideOrder = unhideConversationSpy.mock.invocationCallOrder[0];
    const togglePinOrder = togglePinConversationSpy.mock.invocationCallOrder[0];
    expect(unhideOrder).toBeLessThan(togglePinOrder);
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
