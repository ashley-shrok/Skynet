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
import { render, fireEvent, screen } from "@testing-library/react";
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
  useBountyCount: () => undefined,
  useAllBountyCounts: () => new Map(),
  bountyCountsCompositeKey: (identityKey: string, hostId: number | null) =>
    `${identityKey}:${hostId ?? "local"}`,
  startBountyCountPoller: () => () => {},
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

vi.mock("@/state/conversation-store", () => ({
  useConversations: () => ({ activeSet: [], pinned: [], grouped: [] }),
  useSelectedConversationId: () => null,
  usePinnedIds: () => new Set(),
  useHiddenIds: () => new Set(),
  useActiveSet: () => new Set(),
  useFleetSessionsLoaded: () => false,
  selectConversation: () => {},
  togglePinConversation: () => {},
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

vi.mock("@/state/session-working-store", () => ({
  useSessionWorking: () => null,
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

describe("PrettyConversationsPanel: + New role button", () => {
  it("Test 21a: renders a `New role` button in the header when onCreateSession is wired", () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    const newRoleBtn = screen.getByRole("button", { name: /new role/i });
    expect(newRoleBtn).toBeTruthy();
  });

  it("Test 21b: `New role` button is absent when onCreateSession is undefined (same gate as pencil)", () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        onDeactivateRow={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: /new role/i })).toBeNull();
  });

  it("Test 21c: clicking `New role` opens CreateRoleDialog", () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    // Dialog is not open before click
    const dialogsBefore = document.querySelectorAll('[role="dialog"]');
    // NewSessionDialog might be present but closed. CreateRoleDialog must not
    // be present at all. Both dialogs live behind shadcn's Dialog wrapper which
    // does NOT render into the DOM when `open=false`, so dialogsBefore is 0.
    expect(dialogsBefore.length).toBe(0);

    const newRoleBtn = screen.getByRole("button", { name: /new role/i });
    fireEvent.click(newRoleBtn);

    // CreateRoleDialog is now rendered — look for its distinctive title text
    // "Create a role" (or similar — asserted loosely so the dialog renderer
    // can pick a title string that fits its style guide).
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog).toBeTruthy();
    // Look for the chain checkbox — unique to CreateRoleDialog vs NewSessionDialog.
    expect(dialog!.textContent).toMatch(/then create an identity/i);
  });
});
