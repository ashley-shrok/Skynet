// ─── PrettyConversationsPanel — `+ New role` button coverage (Phase 22 SRIC-04 Plan 22-04 Task 2)
//
// Test 21 (from the plan's <behavior> spec): PrettyConversationsPanel renders
// a `+ New role` button in the header, positioned next to the existing
// pencil-icon `+ New agent` button. Clicking opens CreateRoleDialog. The
// button is only rendered when `onCreateSession` prop is wired (gates on the
// same `showPencilButton` predicate as the existing pencil).
//
// Kept as a sibling test file (not appended to PrettyConversationsPanel.test.tsx)
// so the new-role button surface stays isolated from the 25+ pre-existing tests
// in the main suite — matches the sibling-file pattern from Plan 22-02 Task 4
// (NewSessionDialog.role-dropdown.test.tsx) and Plan 22-01 Task 1
// (identity-artifact-reader.two-step.test.tsx).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, within } from "@testing-library/react";
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

vi.mock("@/state/bounty-counts-store", () => ({
  useBountyCounts: () => undefined,
  useAllBountyCounts: () => new Map(),
  bountyCountsCompositeKey: (identityKey: string, hostId: number | null) =>
    `${identityKey}:${hostId ?? "local"}`,
  startBountyCountPoller: () => () => {},
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

vi.mock("@/state/conversation-store", () => ({
  // Phase 41 Plan 01: three-zone shape — `middle` + `rdpGroup` replace `grouped`.
  useConversations: () => ({ activeSet: [], pinned: [], middle: [], rdpGroup: null }),
  useSelectedConversationId: () => null,
  usePinnedIds: () => new Set(),
  useHiddenIds: () => new Set(),
  useActiveSet: () => new Set(),
  useFleetSessionsLoaded: () => false,
  selectConversation: () => {},
  pinConversation: () => {},
  unpinConversation: () => {},
  addToActiveSet: () => {},
  removeFromActiveSet: () => {},
  fleetRowId: (hostId: number, sessionName: string) =>
    `fleet::${hostId}::${sessionName}`,
  hydratePinnedIdsFromServer: () => {},
  hideConversation: () => {},
  unhideConversation: () => {},
  hydrateHiddenIdsFromServer: () => {},
}));

vi.mock("@/api/user-preferences-api", () => ({
  getPinnedIds: vi.fn().mockResolvedValue([]),
  putPinnedIds: vi.fn().mockResolvedValue([]),
  getHiddenIds: vi.fn().mockResolvedValue([]),
  putHiddenIds: vi.fn().mockResolvedValue([]),
}));

// Phase 41 Plan 03: conversation-store now imports subscribeSessionWorkingStore
// + getSessionLastMessageAt at module init to bridge the working-store's
// lastMessageAt cache into row derivation. Both stubbed as no-ops here so
// module init does not throw when this test file mocks the working-store.
vi.mock("@/state/session-working-store", () => ({
  useSessionIsWorking: () => false,
  useSessionLastMessageAt: () => null,
  getSessionLastMessageAt: () => null,
  subscribeSessionWorkingStore: (_cb: () => void) => () => {},
  // Phase 47 Plan 04: PrettyConversationRowLive subscribes to the aiTitle
  // axis via useSessionAiTitle (Plan 47-03 chokepoint). Returns null so
  // the threaded prop stays null in this new-role-button suite (which
  // doesn't exercise the ai-title surface).
  useSessionAiTitle: () => null,
  // Phase 52 Plan 03 (plan-checker B-2 fix): Panel.tsx now imports
  // getSessionWorkingSnapshot + useSessionIsDormant. Without these
  // stubs every existing test throws TypeError on render.
  getSessionWorkingSnapshot: () => new Map(),
  useSessionIsDormant: () => false,
}));

// Phase 23 (GEFM-01): mock GlobalFilesModal so this test suite does not pull in
// the full modal dep tree. The modal is open=false in every test here.
vi.mock("@/features/pretty-view/GlobalFilesModal", () => ({
  default: (props: { open: boolean }) => (props.open ? <div data-testid="global-files-modal-stub" /> : null),
}));

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

// Phase 23 (GEFM-01): helper to open the header menu and click a named item.
function openMenuAndClickItem(itemNamePattern: RegExp) {
  const menuBtn = screen.getByTestId("pv-header-menu-button");
  fireEvent.click(menuBtn);
  const menu = screen.getByRole("menu");
  const item = within(menu).getByRole("menuitem", { name: itemNamePattern });
  fireEvent.click(item);
}

describe("PrettyConversationsPanel: + New role button (Phase 23 GEFM-01 repoint)", () => {
  it("Test 21a (repoint): 'New role' is a menu item in the MoreVertical dropdown when onCreateSession is wired", () => {
    // Phase 23: the `+ New role` button is no longer a standalone header button.
    // It lives as the second item in the MoreVertical menu (after "New agent").
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    // Open the menu first
    fireEvent.click(screen.getByTestId("pv-header-menu-button"));
    const menu = screen.getByRole("menu");
    // "New role" item is present in the menu
    expect(within(menu).getByRole("menuitem", { name: /new role/i })).toBeTruthy();
  });

  it("Test 21b (repoint): the MoreVertical menu button (and thus 'New role') is absent when onCreateSession is undefined", () => {
    // Phase 23: showPencilButton gate applies to the whole menu button, not individual items.
    // When onCreateSession is undefined, the menu button does not render → no menu → no items.
    render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
      />,
    );

    expect(screen.queryByTestId("pv-header-menu-button")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Test 21c (repoint): clicking 'New role' from the menu opens CreateRoleDialog", () => {
    // Phase 23: the flow is: click menu button → click "New role" → CreateRoleDialog opens.
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    // Dialog is not open before click
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(0);

    // Open menu and click "New role"
    openMenuAndClickItem(/new role/i);

    // CreateRoleDialog is now rendered — look for its distinctive content.
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog).toBeTruthy();
    // Look for the chain checkbox — unique to CreateRoleDialog vs NewSessionDialog.
    expect(dialog!.textContent).toMatch(/then create an agent with this role/i);
  });
});
