// ─── PrettyConversationsPanel — Clone dialog wiring coverage (Phase 22 SRIC-03)
//
// Test 16 (from the plan's <behavior> spec): PrettyConversationsPanel threads
// onClone from panel state into the row wrappers. Clicking Clone on a row
// context menu opens CloneAgentDialog with the row's identity + host as props.
//
// Kept as a sibling test file to isolate the new Clone surface — same pattern
// as PrettyConversationsPanel.new-role-button.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";
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
  useBountyCounts: () => undefined,
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
    // Phase 41 Plan 01: three-zone shape — flat `middle` + nullable `rdpGroup`
    // replace the retired `grouped: HostGroup[]`. Seed the single stubRow into
    // the flat middle so the panel renders it and downstream row-click wiring
    // (the actual thing this test suite exercises via ContextMenu → Clone) works.
    middle: [stubRow],
    rdpGroup: null,
  }),
  useSelectedConversationId: () => null,
  usePinnedIds: () => new Set(),
  useHiddenIds: () => new Set(),
  useActiveSet: () => new Set(),
  useFleetSessionsLoaded: () => true,
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
  // Phase 47 Plan 04: PrettyConversationRowLive now subscribes to the
  // working-store's aiTitle axis (Plan 47-03 chokepoint). Returns null
  // for every key so the threaded aiTitle prop stays null in this
  // clone-dialog suite (Plan 47-05 owns the visual render; this suite
  // does not exercise the ai-title surface).
  useSessionAiTitle: () => null,
  // Phase 52 Plan 03 (plan-checker B-2 fix): Panel.tsx now imports
  // getSessionWorkingSnapshot + useSessionIsDormant. Without these
  // stubs every existing test throws TypeError on render.
  getSessionWorkingSnapshot: () => new Map(),
  useSessionIsDormant: () => false,
  // Phase 53 Plan 03: Panel.tsx now imports useSessionIsRecycling from the
  // working-store (retired client-side recycling bridge deleted). Without this
  // stub every render throws TypeError.
  useSessionIsRecycling: () => false,
}));
// Phase 53 Plan 03 — the retired recycling bridge mock was removed here
// (the store no longer exists; Panel now uses useSessionIsRecycling above).

vi.mock("@/state/session-queue-pending-store", () => ({
  useSessionQueuePending: () => null,
}));

// quick-260806-bz7: mock the identities-api surface so CloneAgentDialog can
// actually submit inside jsdom without pulling the real network. Mirrors
// CloneAgentDialog.test.tsx's pattern. Kept module-top so vi.mock hoists it.
const mockCloneIdentity = vi.fn();
const mockPostGenerateAvatarBatch = vi.fn();

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    cloneIdentity: (...args: unknown[]) => mockCloneIdentity(...args),
    postGenerateAvatarBatch: (...args: unknown[]) =>
      mockPostGenerateAvatarBatch(...args),
  };
});

// Mock VoicePicker to a simple <input> so the dialog renders in jsdom without
// pulling the real picker (which fetches voices over the network).
vi.mock("@/features/pretty-view/pickers/VoicePicker", () => ({
  VoicePicker: (props: {
    value: string;
    onChange: (v: string) => void;
    id?: string;
    ariaLabel?: string;
    disabled?: boolean;
  }) => (
    <input
      data-testid="voice-picker-mock"
      id={props.id}
      aria-label={props.ariaLabel ?? "Voice"}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      disabled={props.disabled}
    />
  ),
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
  // Seed the mock clone response so a successful submit resolves with a
  // fresh Identity whose identityKey doubles as the tmux session name.
  mockCloneIdentity.mockResolvedValue({
    id: "new-id",
    identityKey: "tina-2",
    displayName: "tina-2",
    title: "Fleet Operator",
    colorHue: 128,
    voice: "Elena.wav",
    avatarMime: "image/png",
    avatarUrl: "/identities/new-id/avatar",
    avatarEtag: "e",
    createdAt: "",
    updatedAt: "",
  });
  mockPostGenerateAvatarBatch.mockResolvedValue([]);
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

  it("Test 16b (quick-260806-bz7): successful clone fires panel's onCreateSession with identityMode:'existing' opts BEFORE onClose", async () => {
    const onCreateSessionMock = vi.fn();
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={onCreateSessionMock}
        onDeactivateRow={() => {}}
      />,
    );

    // Right-click row → open context menu → click Clone
    const rowWrapper = document.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const rowBody = rowWrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(rowBody, { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByRole("menuitem", { name: /clone/i }));

    // Dialog opens — fill the name and click Create.
    // (Title is pre-filled from source's title; path defaults to "~".)
    fireEvent.change(screen.getByLabelText(/^name/i), {
      target: { value: "tina-2" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /clone|submit|create/i }),
    );

    // cloneIdentity resolves → dialog fires onCreateSession → onClose.
    await waitFor(() => expect(mockCloneIdentity).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(onCreateSessionMock).toHaveBeenCalledTimes(1),
    );

    // The panel forwarded its onCreateSession by reference and the dialog
    // called it with the widened identityMode:"existing" opts shape derived
    // from the mock resolved Identity. `host` must be the stubHost the panel
    // captured off row.host (referentially equal — same object reference).
    expect(onCreateSessionMock).toHaveBeenCalledWith({
      host: stubHost,
      sessionName: "tina-2",
      path: "~/",
      identityMode: "existing",
      identityName: "tina-2",
      identityId: "new-id",
    });
  });
});
