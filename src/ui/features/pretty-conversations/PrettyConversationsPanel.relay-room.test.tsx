/**
 * Phase 90 Plan 07 Task 3 — Sidebar row-click widening for kind='relay-room'.
 *
 * BLOCKER #3 fix: the ACTUAL row-click handler lives at
 *   src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx L980-1003
 *   (`handleRowSelect`)
 * NOT at src/ui/sidebar/PrettyConversationsPanel.tsx (which does not exist)
 * and does NOT go through openSessionInTree (which is a split-tree DROP
 * handler at AppShell.tsx L1663, unrelated to normal row-click).
 *
 * Behaviors covered here (PrettyConversationsPanel-side):
 *   Test 1 (regression): kind harness/undefined row → selectConversation +
 *     onConversationSelected UNCHANGED. No new branch intercepts.
 *   Test 2 (NEW): kind 'relay-room' row with roomId → onRelayRoomRowClick
 *     with the row + onConversationSelected(row.id). Default selectConversation
 *     path NOT taken. Priority: after rdpHostRow + fleetOnly, before default.
 *   Test 3 (defensive): kind 'relay-room' row with roomId missing → console.warn
 *     + fall through to default selectConversation path.
 *   Test 5 (integration): rendered mixed list; harness click fires
 *     selectConversation; relay-room click fires onRelayRoomRowClick with
 *     kind + roomId + roomTitle carried on the row.
 *
 * Behaviors covered in PrettyConversationsPanel.test.tsx (existing file):
 *   Test 12/13/14/15 — existing rdp/fleetOnly/plain/onConversationSelected
 *   regression coverage stays green (verified via full-file run in a
 *   separate step).
 *
 * AppShell-side behaviors (Test 4/6) are integration-verified separately
 * by extracting the click-wire callback shape here via a spy'd
 * onRelayRoomRowClick — the AppShell wiring itself is a config-heavy
 * orchestration file with no direct test file (grep for AppShell.test.tsx).
 * The gate on AppShell code is grep-based in the plan's acceptance criteria
 * (sessionKind: "relay-room" appears in AppShell.tsx; onRelayRoomRowClick=
 * wired at the invocation site) — enforced by executor-time grep.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";
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
}));

let mockBountyCounts: ReadonlyMap<string, { pinnedCount: number; needsDeskCount: number }> = new Map();

vi.mock("@/state/bounty-counts-store", () => ({
  useBountyCounts: () => undefined,
  useAllBountyCounts: () => mockBountyCounts,
  bountyCountsCompositeKey: (identityKey: string, hostId: number | null) =>
    `${identityKey}:${hostId ?? "local"}`,
  startBountyCountPoller: () => () => {},
}));

// Phase 104 Plan 02 — trapped-work-store (inert stub — panel mounts poller)
vi.mock("@/state/trapped-work-store", () => ({
  useTrappedWork: () => undefined,
  useAllTrappedWork: () => new Map(),
  trappedWorkCompositeKey: (identityKey: string, hostId: number | null) =>
    `${identityKey}:${hostId ?? "local"}`,
  startTrappedWorkPoller: () => () => {},
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

// ─── conversation-store mock (mirrors the shape used by the main test file) ─
type MockRow = {
  id: string;
  type: string;
  label: string;
  host?: Host | undefined;
  targetTmuxSession: string | null;
  fleetOnly?: boolean;
  rdpHostRow?: boolean;
  // Phase 90 Plan 07 Task 3: kind + relay-room fields on the row shape.
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

function setSnapshot(next: Partial<MockSnapshot>): void {
  snapshot = {
    activeSet: next.activeSet ?? [],
    pinned: next.pinned ?? [],
    middle: next.middle ?? [],
    rdpGroup: next.rdpGroup ?? null,
    selectedId: next.selectedId ?? null,
    pinnedIds: next.pinnedIds ?? new Set(),
    hiddenIds: next.hiddenIds ?? new Set(),
  };
}

const selectConversationSpy = vi.fn();
const addToActiveSetSpy = vi.fn();
const removeFromActiveSetSpy = vi.fn();
const pinConversationSpy = vi.fn();
const unpinConversationSpy = vi.fn();
const hideConversationSpy = vi.fn();
const unhideConversationSpy = vi.fn();
const hydratePinnedIdsFromServerSpy = vi.fn();
const hydrateHiddenIdsFromServerSpy = vi.fn();

let mockActiveSet: ReadonlySet<string> = new Set();
let mockFleetSessionsLoaded = false;

vi.mock("@/state/conversation-store", () => ({
  useConversations: () => ({
    activeSet: snapshot.activeSet,
    pinned: snapshot.pinned,
    middle: snapshot.middle,
    rdpGroup: snapshot.rdpGroup,
  }),
  useSelectedConversationId: () => snapshot.selectedId,
  usePinnedIds: () => snapshot.pinnedIds,
  useHiddenIds: () => snapshot.hiddenIds,
  useActiveSet: () => mockActiveSet,
  useFleetSessionsLoaded: () => mockFleetSessionsLoaded,
  selectConversation: (id: string | null) => selectConversationSpy(id),
  pinConversation: (id: string) => pinConversationSpy(id),
  unpinConversation: (id: string) => unpinConversationSpy(id),
  addToActiveSet: (id: string) => addToActiveSetSpy(id),
  removeFromActiveSet: (id: string) => removeFromActiveSetSpy(id),
  fleetRowId: (hostId: number, sessionName: string) =>
    `fleet::${hostId}::${sessionName}`,
  hydratePinnedIdsFromServer: (ids: string[]) =>
    hydratePinnedIdsFromServerSpy(ids),
  hideConversation: (id: string) => hideConversationSpy(id),
  unhideConversation: (id: string) => unhideConversationSpy(id),
  hydrateHiddenIdsFromServer: (ids: string[]) =>
    hydrateHiddenIdsFromServerSpy(ids),
}));

vi.mock("@/api/user-preferences-api", () => ({
  getPinnedIds: vi.fn().mockResolvedValue([]),
  putPinnedIds: vi.fn().mockResolvedValue([]),
  getHiddenIds: vi.fn().mockResolvedValue([]),
  putHiddenIds: vi.fn().mockResolvedValue([]),
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

vi.mock("@/features/pretty-view/GlobalFilesModal", () => ({
  default: (props: { open: boolean }) =>
    props.open ? <div data-testid="global-files-modal-stub" /> : null,
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  setSnapshot({});
  mockActiveSet = new Set();
  mockFleetSessionsLoaded = false;
  mockBountyCounts = new Map();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 (regression) — harness/undefined row → selectConversation unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: row-click routing (harness regression)", () => {
  it("Test 1a: clicking a row with kind='harness' fires selectConversation + onConversationSelected (no new branch intercepts)", () => {
    const hostA = makeHost("h1", "hostA");
    const harnessRow = makeConversationRow({
      id: "harness-1",
      label: "tina",
      host: hostA,
      kind: "harness",
    });
    setSnapshot({
      middle: [harnessRow],
    });
    const onConversationSelected = vi.fn();
    const onRelayRoomRowClick = vi.fn();
    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onConversationSelected={onConversationSelected}
        onRelayRoomRowClick={onRelayRoomRowClick}
        onDeactivateRow={() => {}}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="harness-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(body);
    expect(selectConversationSpy).toHaveBeenCalledTimes(1);
    expect(selectConversationSpy).toHaveBeenCalledWith("harness-1");
    expect(onConversationSelected).toHaveBeenCalledWith("harness-1");
    expect(onRelayRoomRowClick).not.toHaveBeenCalled();
  });

  it("Test 1b: clicking a row with undefined kind (backward-compat) → selectConversation (no relay-room branch fires)", () => {
    const hostA = makeHost("h1", "hostA");
    const legacyRow = makeConversationRow({
      id: "legacy-1",
      label: "legacy",
      host: hostA,
      // no kind field at all
    });
    setSnapshot({ middle: [legacyRow] });
    const onRelayRoomRowClick = vi.fn();
    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onRelayRoomRowClick={onRelayRoomRowClick}
        onDeactivateRow={() => {}}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="legacy-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(body);
    expect(selectConversationSpy).toHaveBeenCalledTimes(1);
    expect(selectConversationSpy).toHaveBeenCalledWith("legacy-1");
    expect(onRelayRoomRowClick).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 (NEW) — relay-room row with roomId → onRelayRoomRowClick
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: row-click routing (relay-room)", () => {
  it("Test 2: clicking a relay-room row with roomId → onRelayRoomRowClick(row) + onConversationSelected(row.id); default selectConversation NOT taken", () => {
    const hostA = makeHost("h1", "hostA");
    const relayRow = makeConversationRow({
      id: "relay-1",
      label: "Design room",
      host: hostA,
      kind: "relay-room",
      roomId: "!abc:matrix.example",
      roomTitle: "Design room",
    });
    setSnapshot({ middle: [relayRow] });
    const onRelayRoomRowClick = vi.fn();
    const onConversationSelected = vi.fn();
    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onRelayRoomRowClick={onRelayRoomRowClick}
        onConversationSelected={onConversationSelected}
        onDeactivateRow={() => {}}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="relay-1"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(body);
    expect(onRelayRoomRowClick).toHaveBeenCalledTimes(1);
    const rowArg = onRelayRoomRowClick.mock.calls[0][0];
    expect(rowArg.id).toBe("relay-1");
    expect(rowArg.kind).toBe("relay-room");
    expect(rowArg.roomId).toBe("!abc:matrix.example");
    expect(rowArg.roomTitle).toBe("Design room");
    expect(onConversationSelected).toHaveBeenCalledWith("relay-1");
    // Default selectConversation NOT called.
    expect(selectConversationSpy).not.toHaveBeenCalled();
  });

  it("Test 2b: relay-room row + no onRelayRoomRowClick prop supplied → falls through to selectConversation (defensive, matches existing rdpHostRow/fleetOnly semantics)", () => {
    const hostA = makeHost("h1", "hostA");
    const relayRow = makeConversationRow({
      id: "relay-nop",
      label: "Room",
      host: hostA,
      kind: "relay-room",
      roomId: "!nop:matrix.example",
      roomTitle: "Room",
    });
    setSnapshot({ middle: [relayRow] });
    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        // onRelayRoomRowClick omitted
        onDeactivateRow={() => {}}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="relay-nop"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(body);
    // With no callback, the branch does not trigger — matches rdpHostRow/
    // fleetOnly semantics (they also fall through to selectConversation
    // when the callback is omitted; see handleRowSelect L991-1000).
    expect(selectConversationSpy).toHaveBeenCalledTimes(1);
    expect(selectConversationSpy).toHaveBeenCalledWith("relay-nop");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 (defensive) — kind='relay-room' but roomId missing
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: row-click routing (relay-room defensive)", () => {
  it("Test 3: kind='relay-room' + roomId missing → console.warn + fall through to selectConversation", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hostA = makeHost("h1", "hostA");
    const relayNoRoomId = makeConversationRow({
      id: "relay-broken",
      label: "broken",
      host: hostA,
      kind: "relay-room",
      // roomId omitted!
      roomTitle: "broken",
    });
    setSnapshot({ middle: [relayNoRoomId] });
    const onRelayRoomRowClick = vi.fn();
    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onRelayRoomRowClick={onRelayRoomRowClick}
        onDeactivateRow={() => {}}
      />,
    );
    const wrapper = container.querySelector(
      '[data-conversation-id="relay-broken"]',
    ) as HTMLElement;
    const body = wrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(body);
    // Warn fired with the exact message.
    const matching = warnSpy.mock.calls.find((call) => {
      const [msg, payload] = call;
      return (
        msg === "relay-room row missing roomId" &&
        payload &&
        typeof payload === "object" &&
        (payload as { rowId?: string }).rowId === "relay-broken"
      );
    });
    expect(matching).toBeDefined();
    // Callback NOT fired (fall through).
    expect(onRelayRoomRowClick).not.toHaveBeenCalled();
    // Default path taken.
    expect(selectConversationSpy).toHaveBeenCalledTimes(1);
    expect(selectConversationSpy).toHaveBeenCalledWith("relay-broken");
    warnSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 (integration) — mixed list: harness row + relay-room row
// ─────────────────────────────────────────────────────────────────────────────

describe("PrettyConversationsPanel: mixed harness + relay-room row list", () => {
  it("Test 5: rendered mixed list — harness row click → selectConversation; relay-room click → onRelayRoomRowClick with kind + roomId + roomTitle", () => {
    const hostA = makeHost("h1", "hostA");
    const harnessRow = makeConversationRow({
      id: "harness-mix",
      label: "harness",
      host: hostA,
      kind: "harness",
    });
    const relayRow = makeConversationRow({
      id: "relay-mix",
      label: "Design room",
      host: hostA,
      kind: "relay-room",
      roomId: "!mix:matrix.example",
      roomTitle: "Design room",
    });
    setSnapshot({ middle: [harnessRow, relayRow] });
    const onRelayRoomRowClick = vi.fn();
    const onConversationSelected = vi.fn();
    const { container } = render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onRelayRoomRowClick={onRelayRoomRowClick}
        onConversationSelected={onConversationSelected}
        onDeactivateRow={() => {}}
      />,
    );
    // Click harness first.
    const harnessBody = (
      container.querySelector(
        '[data-conversation-id="harness-mix"]',
      ) as HTMLElement
    ).querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(harnessBody);
    expect(selectConversationSpy).toHaveBeenCalledWith("harness-mix");
    expect(onConversationSelected).toHaveBeenCalledWith("harness-mix");
    expect(onRelayRoomRowClick).not.toHaveBeenCalled();

    // Click relay-room row.
    const relayBody = (
      container.querySelector('[data-conversation-id="relay-mix"]') as HTMLElement
    ).querySelector('[role="button"]') as HTMLElement;
    fireEvent.click(relayBody);
    expect(onRelayRoomRowClick).toHaveBeenCalledTimes(1);
    const rowArg = onRelayRoomRowClick.mock.calls[0][0];
    expect(rowArg.id).toBe("relay-mix");
    expect(rowArg.kind).toBe("relay-room");
    expect(rowArg.roomId).toBe("!mix:matrix.example");
    expect(rowArg.roomTitle).toBe("Design room");
    // onConversationSelected fires for BOTH clicks.
    expect(onConversationSelected).toHaveBeenCalledTimes(2);
    // selectConversation fires for the harness click ONLY (not the relay-room click).
    expect(selectConversationSpy).toHaveBeenCalledTimes(1);
  });
});
