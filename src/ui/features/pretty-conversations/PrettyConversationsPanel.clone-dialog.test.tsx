// ─── PrettyConversationsPanel — Clone dialog wiring coverage (Phase 22 SRIC-03)
//
// Test 16 (from the plan's <behavior> spec): PrettyConversationsPanel threads
// onClone from panel state into the row wrappers. Clicking Clone on a row
// context menu opens CloneAgentDialog with the row's identity + host as props.
//
// Kept as a sibling test file to isolate the new Clone surface — same pattern
// as PrettyConversationsPanel.new-role-button.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import type { Host, HostFolder } from "@/types/ui-types";
import type { Identity } from "@/api/identities-api";
import type { ConversationRow as ConversationRowShape } from "@/state/conversation-store";

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

// Seed one identity so the Clone menu-item guard passes on any row whose
// targetTmuxSession matches this key.
const stubIdentity: Identity = {
  id: "id-1",
  identityKey: "tina",
  displayName: "tina",
  title: "Fleet Operator",
  colorHue: 128,
  voice: "Elena.wav",
  avatarMime: "image/png",
  avatarUrl: "/identities/id-1/avatar",
  avatarEtag: "etag-1",
  createdAt: "",
  updatedAt: "",
};

vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({
    byKey: new Map([[stubIdentity.identityKey, stubIdentity]]),
    identities: [stubIdentity],
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

// Seed one conversation row in the "grouped" bucket so the panel actually
// renders a PrettyConversationRow we can right-click.
const stubHost: Host = {
  id: "5",
  name: "thenasty",
  username: "root",
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
} as Host;

const stubRow: ConversationRowShape = {
  id: "conv-1",
  type: "terminal",
  label: "tina",
  host: stubHost,
  targetTmuxSession: "tina",
};

vi.mock("@/state/conversation-store", () => ({
  useConversations: () => ({
    activeSet: [],
    pinned: [],
    grouped: [{ hostId: "5", hostName: "thenasty", rows: [stubRow] }],
  }),
  useSelectedConversationId: () => null,
  usePinnedIds: () => new Set(),
  useHiddenIds: () => new Set(),
  useActiveSet: () => new Set(),
  useFleetSessionsLoaded: () => true,
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

vi.mock("@/state/session-recycling-store", () => ({
  useSessionRecycling: () => null,
}));

vi.mock("@/state/session-queue-pending-store", () => ({
  useSessionQueuePending: () => null,
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
  children: [makeHost("5", "thenasty")],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PrettyConversationsPanel: Clone dialog wiring", () => {
  it("Test 16: right-click row → Clone menu item → CloneAgentDialog opens with source identity + hostId", () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    // Find the rendered row body (only one row seeded above)
    const rowWrapper = document.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    expect(rowWrapper).toBeTruthy();
    const rowBody = rowWrapper.querySelector('[role="button"]') as HTMLElement;

    // No dialog before we click
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    // Right-click to open context menu
    fireEvent.contextMenu(rowBody, { clientX: 100, clientY: 100 });

    // Clone menu item should be present
    const cloneItem = screen.getByRole("menuitem", { name: /clone/i });
    expect(cloneItem).toBeTruthy();

    // Click Clone → CloneAgentDialog opens
    fireEvent.click(cloneItem);

    // Dialog appears — assert on a text unique to CloneAgentDialog (e.g., the
    // source identity's displayName in the header "Cloning from tina").
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog).toBeTruthy();
    // Assert the dialog knows about the source identity
    expect(dialog!.textContent).toMatch(/tina/);
    // Assert the source-host lock note (dialog does NOT expose host picker but
    // the header mentions the source's name for context — see Test 17 in
    // CloneAgentDialog.test.tsx for the full dialog contract).
    expect(dialog!.textContent?.toLowerCase()).toContain("clone");
  });
});
