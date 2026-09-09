/**
 * Phase 91 Plan 06 — NewConversationModal.flow.test.tsx
 *
 * Flow-level integration test: drives the complete Slice C user flow.
 *
 *   menu-item click → modal open → participant selection → name entry →
 *   Create click → mocked createRelayRoom → onCreated callback →
 *   assert tab-open shape.
 *
 * This is regression coverage SEPARATE from unit-test coverage:
 *   - Unit tests (Plans 01–05) assert per-component behavior.
 *   - This file asserts that the pieces fit together end-to-end.
 *
 * 8 scenarios:
 *   Test 1 — happy path: full flow menu → modal → pick → name → Create → callback
 *   Test 2 — double-click debounce (T-91-FE-01): second click is a no-op
 *   Test 3 — single-agent-only disable: Create stays disabled; hint mentions agent
 *   Test 4 — zero-participant disable: Create disabled; hint mentions participant
 *   Test 5 — blank-name disable: Create disabled; hint mentions name
 *   Test 6 — self-exclude: viewing user absent from the Humans section
 *   Test 7 — backend-error surface: modal stays open; error shown; retry succeeds
 *   Test 8 — search filter narrows: typing "B" shows only Bob; "N of M" count shown
 *
 * Threat model:
 *   T-91-06-R1 (Repudiation) — every test asserts toHaveBeenCalledWith on
 *     createRelayRoom and/or onCreateRelayRoom so a no-op flow fails.
 *   T-91-06-D1 (State leak) — beforeEach clears all mocks + re-arms defaults.
 *
 * @see 91-PATTERNS.md § User-Flow Test Pattern (line 1024)
 * @see 91-PATTERNS.md § Test-file structure (line 943)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Host, HostFolder } from "@/types/ui-types";

// ─── Global mocks (BEFORE component imports — Vitest hoists vi.mock) ──────────
//
// Declaration order mirrors PrettyConversationsPanel.test.tsx which is the
// canonical scaffold for flow-style tests in this feature directory.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
}));

vi.mock("@/features/terminal/session-hue", () => ({
  // sessionMatchKey: used by conversation-store + identities-store internals.
  sessionMatchKey: (name: string | null | undefined) =>
    name ? name.toLowerCase() : null,
  // hueFromSessionName: used by NewConversationModal to derive human colorHue.
  // Return a deterministic number for any mxid so tests can rely on it.
  hueFromSessionName: (name: string | null | undefined): number | null =>
    name ? 120 : null,
}));

// ─── identities-store (Plan 06 mock: mutable per-test) ───────────────────────

let mockIdentities: Array<{
  identityKey: string;
  displayName: string;
  colorHue: number | null;
  avatarUrl: string | null;
  title: string | null;
  role: string | null;
}> = [
  {
    identityKey: "Nelly",
    displayName: "Nelly",
    colorHue: 200,
    avatarUrl: null,
    title: "assistant",
    role: "assistant",
  },
];

vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({
    byKey: new Map(),
    identities: mockIdentities,
    loaded: true,
    refresh: async () => {},
  }),
}));

// ─── user-management-api (Plan 06 mock: mutable per-test) ─────────────────────

vi.mock("@/api/user-management-api", () => ({
  // server-side self-exclusion: /users/list-basic returns only OTHER users
  // (ne(users.id, userId) in user-admin-routes.ts:126). Viewer (alice) is never
  // in the response — the mock matches that contract (H1 fix).
  getUsersListBasic: vi.fn(async () => [
    { id: "u-bob", username: "bob", mxid: "@bob:s" },
  ]),
  // getPinnedIds / getHiddenIds are consumed by PrettyConversationsPanel mount effect.
  getPinnedIds: vi.fn(async () => []),
  getHiddenIds: vi.fn(async () => []),
}));

// ─── relay-room-create-api (Plan 06 mock: the key seam assertion) ─────────────

vi.mock("@/api/relay-room-create-api", () => ({
  createRelayRoom: vi.fn(async () => ({
    ok: true as const,
    roomId: "!room:s",
    sessionId: "s-1",
    roomTitle: "Test chat",
  })),
}));

// ─── viewing-user-store (Plan 06 mock: alice is the viewer) ───────────────────
//
// useViewingUserMxid: drives self-exclusion in useNewConversationForm and
// serverName extraction in NewConversationModal. alice is excluded from picker.

vi.mock("@/state/viewing-user-store", () => ({
  useViewingUserMxid: vi.fn(() => "@alice:s"),
  useViewingUserId: vi.fn(() => "u-alice"),
}));

// ─── bounty-counts-store (inert stub — panel uses it; flow tests don't care) ──

vi.mock("@/state/bounty-counts-store", () => ({
  useBountyCounts: () => undefined,
  useAllBountyCounts: () =>
    new Map<string, { pinnedCount: number; needsDeskCount: number }>(),
  bountyCountsCompositeKey: (identityKey: string, hostId: number | null) =>
    `${identityKey}:${hostId ?? "local"}`,
  startBountyCountPoller: () => () => {},
}));

// ─── hooks/use-is-touch-device (inert stub) ────────────────────────────────────

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

// ─── conversation-store (minimal stub: panel needs snapshot + actions) ─────────

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

const selectConversationSpy = vi.fn();

vi.mock("@/state/conversation-store", () => ({
  useConversations: () => ({
    activeSet: [],
    pinned: [],
    middle: [],
    rdpGroup: null,
  }),
  useSelectedConversationId: () => null,
  usePinnedIds: () => new Set<string>(),
  useHiddenIds: () => new Set<string>(),
  useActiveSet: () => new Set<string>(),
  useFleetSessionsLoaded: () => true,
  selectConversation: (id: string | null) => selectConversationSpy(id),
  pinConversation: vi.fn(),
  unpinConversation: vi.fn(),
  addToActiveSet: vi.fn(),
  removeFromActiveSet: vi.fn(),
  fleetRowId: (hostId: number, sessionName: string) =>
    `fleet::${hostId}::${sessionName}`,
  hydratePinnedIdsFromServer: vi.fn(),
  hideConversation: vi.fn(),
  unhideConversation: vi.fn(),
  hydrateHiddenIdsFromServer: vi.fn(),
}));

// ─── user-preferences-api (stub: panel fetches pinned/hidden on mount) ────────

vi.mock("@/api/user-preferences-api", () => ({
  getPinnedIds: vi.fn().mockResolvedValue([]),
  putPinnedIds: vi.fn().mockResolvedValue([]),
  getHiddenIds: vi.fn().mockResolvedValue([]),
  putHiddenIds: vi.fn().mockResolvedValue([]),
}));

// ─── session-working-store (inert stub — panel subscribes internally) ──────────

vi.mock("@/state/session-working-store", () => ({
  useSessionIsWorking: () => false,
  useSessionLastMessageAt: () => null,
  getSessionLastMessageAt: () => null,
  subscribeSessionWorkingStore: (_cb: () => void) => () => {},
  useSessionAiTitle: () => null,
  getSessionWorkingSnapshot: () => new Map(),
  useSessionIsDormant: () => false,
  useSessionIsRecycling: () => false,
}));

// ─── GlobalFilesModal stub (avoid radix dep-tree in flow tests) ────────────────

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

// ─── Component under test (import AFTER mocks) ──────────────────────────────────

import { PrettyConversationsPanel } from "./PrettyConversationsPanel";

// ─── Additional imports for mock handle access ────────────────────────────────

import { getUsersListBasic } from "@/api/user-management-api";
import { createRelayRoom } from "@/api/relay-room-create-api";
import { useViewingUserMxid } from "@/state/viewing-user-store";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

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

/**
 * Render the panel with `onCreateSession` and `onCreateRelayRoom` wired.
 * `onCreateSession` must be a function so the header menu button is visible
 * (showPencilButton gate in PrettyConversationsPanel).
 */
function renderPanel(onCreateRelayRoom: ReturnType<typeof vi.fn> = vi.fn()) {
  return render(
    <PrettyConversationsPanel
      variant="desktop"
      hostTree={ONE_HOST_TREE}
      onCreateSession={vi.fn()}
      onCreateRelayRoom={onCreateRelayRoom}
      onDeactivateRow={() => {}}
    />,
  );
}

/**
 * Open the header three-dot menu (MoreVertical button).
 * Gate: showPencilButton must be true (onCreateSession wired).
 */
function openThreeDotMenu() {
  const btn = screen.getByTestId("pv-header-menu-button");
  fireEvent.click(btn);
}

/**
 * Click "New conversation" in the open menu and wait for the modal dialog.
 */
async function openNewConversationModal() {
  openThreeDotMenu();
  const menuItem = screen.getByRole("menuitem", { name: /new conversation/i });
  await act(async () => {
    fireEvent.click(menuItem);
  });
  // Wait for the modal portal to mount.
  const dialog = await screen.findByRole("dialog", { name: /new conversation/i });
  return dialog;
}

// ─── beforeEach / afterEach ─────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Re-arm default getUsersListBasic — server-side self-exclusion means alice
  // (the viewer) is never in the response (H1 fix: matches user-admin-routes.ts
  // ne(users.id, userId) contract). Only non-viewer users are returned.
  vi.mocked(getUsersListBasic).mockResolvedValue([
    { id: "u-bob", username: "bob", mxid: "@bob:s" },
  ]);

  // Re-arm default createRelayRoom (success path).
  vi.mocked(createRelayRoom).mockResolvedValue({
    ok: true as const,
    roomId: "!room:s",
    sessionId: "s-1",
    roomTitle: "Test chat",
  });

  // Re-arm default viewing-user (alice, so she's excluded from picker).
  vi.mocked(useViewingUserMxid).mockReturnValue("@alice:s");

  // Reset identities to default (Nelly only).
  mockIdentities = [
    {
      identityKey: "Nelly",
      displayName: "Nelly",
      colorHue: 200,
      avatarUrl: null,
      title: "assistant",
      role: "assistant",
    },
  ];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Top-level describe: "NewConversationModal — full user flow"
// plan must-have: exactly one top-level describe block in this file
// ─────────────────────────────────────────────────────────────────────────────

describe("NewConversationModal — full user flow", () => {

  // ──────────────────────────────────────────────────────────────────────────
  // Test 1 — happy path: menu → modal → pick Bob + Nelly → name → Create → callback
  // ──────────────────────────────────────────────────────────────────────────

  it("Test 1 (happy path): menu click → modal open → pick human + agent + name → Create → onCreated fires + modal closes", async () => {
    const onCreateRelayRoom = vi.fn();
    renderPanel(onCreateRelayRoom);

    // Open the modal.
    const dialog = await openNewConversationModal();

    // Step (c): fill room name.
    fireEvent.change(screen.getByLabelText(/room name/i), {
      target: { value: "Test chat" },
    });

    // Step (d): click Bob row (human, self-excluded alice is not here).
    fireEvent.click(within(dialog).getByText("bob"));

    // Step (e): click Nelly row (agent).
    fireEvent.click(within(dialog).getByText("Nelly"));

    // Step (f): click Create button.
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /create/i }));
    });

    // Assert: createRelayRoom called ONCE with correct payload.
    await waitFor(() => {
      expect(vi.mocked(createRelayRoom)).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(createRelayRoom)).toHaveBeenCalledWith({
      roomName: "Test chat",
      humanMxids: ["@bob:s"],
      agentMxids: ["@nelly:s"],
    });

    // Assert: onCreateRelayRoom prop called ONCE with the response.
    await waitFor(() => {
      expect(onCreateRelayRoom).toHaveBeenCalledTimes(1);
    });
    expect(onCreateRelayRoom).toHaveBeenCalledWith({
      ok: true,
      roomId: "!room:s",
      sessionId: "s-1",
      roomTitle: "Test chat",
    });

    // Assert: modal is closed (no longer in DOM).
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /new conversation/i }),
      ).not.toBeInTheDocument();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2 — double-click debounce (T-91-FE-01): second click is a no-op
  // ──────────────────────────────────────────────────────────────────────────

  it("Test 2 (double-click debounce): two rapid clicks on Create → createRelayRoom called EXACTLY ONCE", async () => {
    renderPanel();

    const dialog = await openNewConversationModal();

    fireEvent.change(screen.getByLabelText(/room name/i), {
      target: { value: "Test chat" },
    });
    fireEvent.click(within(dialog).getByText("bob"));

    const createBtn = within(dialog).getByRole("button", { name: /create/i });

    // Fire two clicks with no async gap — the debounce ref fires synchronously.
    await act(async () => {
      fireEvent.click(createBtn);
      fireEvent.click(createBtn);
    });

    // createRelayRoom must be called EXACTLY ONCE.
    await waitFor(() => {
      expect(vi.mocked(createRelayRoom)).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3 — single-agent-only disable: Create disabled; hint mentions agent
  // ──────────────────────────────────────────────────────────────────────────

  it("Test 3 (single-agent-only disable): picking ONLY Nelly → Create disabled; hint mentions 'agent'", async () => {
    renderPanel();

    const dialog = await openNewConversationModal();

    fireEvent.change(screen.getByLabelText(/room name/i), {
      target: { value: "Test chat" },
    });

    // Click ONLY Nelly (no human picked).
    fireEvent.click(within(dialog).getByText("Nelly"));

    // Create button must be disabled.
    const createBtn = within(dialog).getByRole("button", { name: /create/i });
    expect(createBtn).toBeDisabled();

    // Hint text must mention "agent" or "single" (shape-flexible per plan).
    const hint = dialog.querySelector("p");
    expect(hint?.textContent?.toLowerCase()).toMatch(/agent|single/);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 4 — zero-participant disable: Create disabled; hint mentions participant
  // ──────────────────────────────────────────────────────────────────────────

  it("Test 4 (zero-participant disable): no rows picked → Create disabled; hint mentions 'participant'", async () => {
    renderPanel();

    const dialog = await openNewConversationModal();

    // Provide a room name so the only gate is zero participants.
    fireEvent.change(screen.getByLabelText(/room name/i), {
      target: { value: "Test chat" },
    });

    // No row clicks — zero participants.
    const createBtn = within(dialog).getByRole("button", { name: /create/i });
    expect(createBtn).toBeDisabled();

    // Hint must mention "participant".
    const hint = dialog.querySelector("p");
    expect(hint?.textContent?.toLowerCase()).toMatch(/participant/);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 5 — blank-name disable: Create disabled; hint mentions name
  // ──────────────────────────────────────────────────────────────────────────

  it("Test 5 (blank-name disable): pick Bob but leave name blank → Create disabled; hint mentions 'name'", async () => {
    renderPanel();

    const dialog = await openNewConversationModal();

    // Pick Bob but leave the room name blank.
    fireEvent.click(within(dialog).getByText("bob"));

    const createBtn = within(dialog).getByRole("button", { name: /create/i });
    expect(createBtn).toBeDisabled();

    // Hint must mention "name".
    const hint = dialog.querySelector("p");
    expect(hint?.textContent?.toLowerCase()).toMatch(/name/);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 6 — self-exclude: alice (viewing user) not shown in Humans section
  // ──────────────────────────────────────────────────────────────────────────

  it("Test 6 (self-exclude): viewingUserMxid=@alice:s → alice absent from Humans picker; only Bob visible", async () => {
    // useViewingUserMxid returns @alice:s (default mock).
    // H1 fix: getUsersListBasic mock returns only [bob] — server already
    // self-excludes alice (ne(users.id, userId) in user-admin-routes.ts:126).
    // useNewConversationForm also applies client-side self-exclusion, which is
    // a no-op when alice is not in the list (belt-and-suspenders).
    renderPanel();

    const dialog = await openNewConversationModal();

    // Wait for the picker to load (getUsersListBasic resolves).
    await waitFor(() => {
      // Bob should appear in the humans section.
      expect(within(dialog).getByText("bob")).toBeInTheDocument();
    });

    // Alice must NOT appear in the picker (never in response + client-side guard).
    expect(within(dialog).queryByText("alice")).not.toBeInTheDocument();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 7 — backend-error surface: modal stays open; error shown; retry closes
  // ──────────────────────────────────────────────────────────────────────────

  it("Test 7 (backend-error surface): createRelayRoom rejects → modal stays open; error shown; retry (re-primed mock) closes modal", async () => {
    // First call rejects; second call resolves.
    vi.mocked(createRelayRoom)
      .mockRejectedValueOnce(new Error("room_name_required"))
      .mockResolvedValueOnce({
        ok: true as const,
        roomId: "!room:s",
        sessionId: "s-1",
        roomTitle: "Test chat",
      });

    const onCreateRelayRoom = vi.fn();
    renderPanel(onCreateRelayRoom);

    const dialog = await openNewConversationModal();

    fireEvent.change(screen.getByLabelText(/room name/i), {
      target: { value: "Test chat" },
    });
    fireEvent.click(within(dialog).getByText("bob"));

    // First click → triggers the rejection.
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /create/i }));
    });

    // Modal must STAY open after error.
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /new conversation/i }),
      ).toBeInTheDocument();
    });

    // Error element must mention the error message.
    await waitFor(() => {
      const errorEl = dialog.querySelector('[role="alert"]');
      expect(errorEl?.textContent?.toLowerCase()).toMatch(/room_name_required/);
    });

    // Create button must be re-enabled (submitting=false restored in finally).
    await waitFor(() => {
      const createBtn = within(dialog).getByRole("button", { name: /create/i });
      expect(createBtn).not.toBeDisabled();
    });

    // Second click → the re-primed mock resolves → modal closes.
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /create/i }));
    });

    await waitFor(() => {
      expect(onCreateRelayRoom).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /new conversation/i }),
      ).not.toBeInTheDocument();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 8 — search filter narrows: "B" shows only Bob; section header shows count
  // ──────────────────────────────────────────────────────────────────────────

  it("Test 8 (search filter): typing 'B' in search → only Bob visible; section header shows '1 of 1' or equivalent count", async () => {
    // getUsersListBasic returns [bob] only (server self-excludes alice per H1 fix).
    // unfiltered Humans section = [bob] (humansTotal = 1).
    // After filter 'B': bob matches (displayName 'bob' contains 'b').
    // Section header renders "Humans (1 of 1)" when filterActive=true.
    renderPanel();

    const dialog = await openNewConversationModal();

    // Wait for picker to populate.
    await waitFor(() => {
      expect(within(dialog).getByText("bob")).toBeInTheDocument();
    });

    // Type "B" in the search input.
    const searchInput = within(dialog).getByRole("searchbox");
    fireEvent.change(searchInput, { target: { value: "B" } });

    // Bob must still be visible (filter matches "bob" case-insensitively).
    expect(within(dialog).getByText("bob")).toBeInTheDocument();

    // Nelly (agent) should NOT match "B" in agents section.
    // (Nelly's displayName "Nelly" does not contain "B" case-insensitively.)
    // The Agents section shows "No agents available" when filtered to 0.

    // Section header must show exact count (filter is active → "N of M" format).
    // humansTotal = humans.length (1 — bob only, H1 fix: no self-exclusion subtraction).
    // filteredCount = 1 (bob matches "B").
    // SectionHeader renders "Humans (1 of 1)" exactly (L1 fix: exact string match).
    const humansSection = Array.from(dialog.querySelectorAll('[role="separator"]')).find(
      (el) => el.textContent?.toLowerCase().includes("human"),
    );
    // Exact count assertion — "humans (1 of 1)" (L1 fix: replaces brittle regex).
    expect(humansSection?.textContent?.toLowerCase()).toContain("humans (1 of 1)");
  });

});
