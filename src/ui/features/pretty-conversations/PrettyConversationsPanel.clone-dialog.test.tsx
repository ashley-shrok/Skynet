// ─── PrettyConversationsPanel — "create new agent under this role" wiring coverage
//
// Phase 80: replaces the Phase 22 SRIC-03 clone-dialog wiring suite. The
// standalone clone dialog was deleted; the row context-menu action (label
// rebranded from 'Clone' to 'Spawn under this role', then rewritten again
// to "create new agent under this role" in bounty 260908-h78) now routes
// through the unified NewSessionDialog via the existing chain-hook mechanism
// (initialHost + initialRole props — same path CreateRoleDialog uses).
//
// These tests assert the PANEL wiring:
//   Test 1: clicking the row context-menu item invokes onClone → panel seeds
//           NewSessionDialog with initialHost === row.host + initialRole ===
//           identity.role.
//   Test 2: NewSessionDialog `open` prop flips from false → true after the
//           entry-point is invoked.
//   Test 3 (A3 lock): the task/brief field is NOT prefilled — the panel does
//           NOT pass initialBrief (initialBrief prop is null/undefined so the
//           dialog's field-seed effect leaves the brief empty).
//   Test 4: panel forwards initialRole as a seed (no lock/readonly prop) →
//           picker stays editable (shape-clone-modal-ux-pass In-4 contract).
//
// Sibling test file kept for isolation; same pattern as
// PrettyConversationsPanel.new-role-button.test.tsx.

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

// Seed one identity so the "create new agent under this role" menu-item guard passes
// on any row whose targetTmuxSession matches this key. `role` must be
// non-null — handleRowClone in Phase 80 gates on identity.role (there's no
// role to spawn under if the source identity is roleless).
const stubIdentity: Identity = {
  identityKey: "tina",
  displayName: "tina",
  title: "Fleet Operator",
  colorHue: 128,
  voice: "Elena.wav",
  role: "operator",
  avatarMime: "image/png",
  avatarUrl: "/identities/tina/avatar?hostId=5",
  avatarEtag: "etag-1",
  coordinator: false,
};

vi.mock("@/state/identities-store", () => ({
  useIdentities: () => ({
    byKey: new Map([[stubIdentity.identityKey, stubIdentity]]),
    identities: [stubIdentity],
    loaded: true,
    refresh: async () => {},
  }),
  refreshIdentities: async () => {},
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

// Seed one conversation row so the panel renders a PrettyConversationRow
// we can right-click.
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
  pinConversationRemote: () => {},
  hideConversation: () => {},
  unhideConversation: () => {},
  hydrateHiddenIdsFromServer: () => {},
  updateFleetSessions: () => {},
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
  subscribeSessionWorkingStore: (_cb: () => void) => () => {},
  useSessionAiTitle: () => null,
  getSessionWorkingSnapshot: () => new Map(),
  useSessionIsDormant: () => false,
  useSessionIsRecycling: () => false,
}));

vi.mock("@/state/session-queue-pending-store", () => ({
  useSessionQueuePending: () => null,
}));

// ─── NewSessionDialog spy mock ───────────────────────────────────────────────
// Capture the props the panel passes so we can assert:
//   - initialHost === stubHost (referentially equal — panel forwards row.host by ref)
//   - initialRole === stubIdentity.role
//   - initialBrief is null (A3 lock: task NOT inherited)
//   - open flips from false → true after invocation
//
// Rendered as a <div data-testid> that mirrors the interesting props as data
// attributes so tests can screen-read the value without needing a spy hook.

const newSessionDialogSpy = vi.fn();

vi.mock("@/sidebar/NewSessionDialog", () => ({
  NewSessionDialog: (props: {
    open: boolean;
    onClose: () => void;
    hostTree: unknown;
    onCreate: (opts: unknown) => void;
    initialHost?: Host | null;
    initialRole?: string | null;
    initialBrief?: string | null;
  }) => {
    newSessionDialogSpy(props);
    return (
      <div
        data-testid="new-session-dialog-mock"
        data-open={String(props.open)}
        data-initial-host-id={props.initialHost ? props.initialHost.id : ""}
        data-initial-role={props.initialRole ?? ""}
        data-initial-brief={
          props.initialBrief === null || props.initialBrief === undefined
            ? "<null>"
            : props.initialBrief
        }
      />
    );
  },
}));

// CreateRoleDialog is mounted alongside NewSessionDialog in the panel; stub
// it out so its render doesn't pull deps we don't care about here.
vi.mock("@/sidebar/CreateRoleDialog", () => ({
  CreateRoleDialog: () => null,
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
  newSessionDialogSpy.mockClear();
});

describe("PrettyConversationsPanel: 'create new agent under this role' wiring (Phase 80 / bounty 260908-h78)", () => {
  it("Test 1: right-click row → 'create new agent under this role' menu item → NewSessionDialog receives initialHost + initialRole seeded from row", () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    // Initial mount: dialog is present but closed with no seed
    const dialogMock = screen.getByTestId("new-session-dialog-mock");
    expect(dialogMock.getAttribute("data-open")).toBe("false");
    expect(dialogMock.getAttribute("data-initial-host-id")).toBe("");
    expect(dialogMock.getAttribute("data-initial-role")).toBe("");

    // Right-click the row body to open the context menu
    const rowWrapper = document.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    expect(rowWrapper).toBeTruthy();
    const rowBody = rowWrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(rowBody, { clientX: 100, clientY: 100 });

    // "create new agent under this role" menu item should be present (formerly 'Clone', then 'Spawn under this role')
    const spawnItem = screen.getByRole("menuitem", {
      name: "Create new agent under this role",
    });
    expect(spawnItem).toBeTruthy();

    // Click the spawn item → panel opens NewSessionDialog with seeded props.
    fireEvent.click(spawnItem);

    // Re-read the dialog mock (it re-renders on state change)
    const dialogAfter = screen.getByTestId("new-session-dialog-mock");
    expect(dialogAfter.getAttribute("data-open")).toBe("true");
    expect(dialogAfter.getAttribute("data-initial-host-id")).toBe("5");
    expect(dialogAfter.getAttribute("data-initial-role")).toBe("operator");

    // Confirm the spy captured a call with the row's host BY REFERENCE
    // (panel forwards row.host through chainPrefill.host without cloning).
    const opened = newSessionDialogSpy.mock.calls
      .map((c) => c[0] as { open: boolean; initialHost?: Host | null })
      .find((p) => p.open === true);
    expect(opened).toBeTruthy();
    expect(opened!.initialHost).toBe(stubHost); // referentially equal
  });

  it("Test 2: NewSessionDialog open prop flips false → true after the spawn-under-role entry-point is invoked", () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    // Baseline: first render passes open=false.
    const firstProps = newSessionDialogSpy.mock.calls[0][0] as { open: boolean };
    expect(firstProps.open).toBe(false);

    // Invoke: right-click → click spawn item.
    const rowWrapper = document.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const rowBody = rowWrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(rowBody, { clientX: 100, clientY: 100 });
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Create new agent under this role" }),
    );

    // After invocation: the most-recent render passed open=true.
    const propHistory = newSessionDialogSpy.mock.calls.map(
      (c) => c[0] as { open: boolean },
    );
    const openedAtLeastOnce = propHistory.some((p) => p.open === true);
    expect(openedAtLeastOnce).toBe(true);
  });

  it("Test 3 (A3 lock): the task/brief field is NOT prefilled — initialBrief stays null when the entry-point is the spawn-under-role path", () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    // Invoke the entry-point.
    const rowWrapper = document.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const rowBody = rowWrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(rowBody, { clientX: 100, clientY: 100 });
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Create new agent under this role" }),
    );

    // Assert the panel never passed a truthy initialBrief on any render where
    // the dialog is open. The panel builds chainPrefill with NO description
    // field on the spawn path, so initialBrief resolves to null via
    // `chainPrefill?.description ?? null` at the mount site.
    const openedRenderProps = newSessionDialogSpy.mock.calls
      .map((c) => c[0] as { open: boolean; initialBrief?: string | null })
      .filter((p) => p.open === true);
    expect(openedRenderProps.length).toBeGreaterThan(0);
    for (const p of openedRenderProps) {
      // initialBrief must be null (or undefined) — never a string.
      expect(p.initialBrief == null).toBe(true);
    }

    // Also assert via the rendered data-attribute on the mock — the sentinel
    // "<null>" is emitted when initialBrief was null-or-undefined.
    const dialogEl = screen.getByTestId("new-session-dialog-mock");
    expect(dialogEl.getAttribute("data-initial-brief")).toBe("<null>");
  });

  it("Test 4: panel forwards initialRole as a seed (no lock/readonly prop) → picker stays editable", () => {
    // Contract test for shape-clone-modal-ux-pass In-4 "picker remains editable".
    // NewSessionDialog's own role-dropdown suite
    // (NewSessionDialog.role-dropdown.test.tsx) proves that when initialRole is
    // set, selectedRole seeds to it but the <select> stays a plain, mutable
    // dropdown. This test locks the panel-side contract: we pass a SEED prop
    // (initialRole), never a lock/readonly/disabled prop.
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    const rowWrapper = document.querySelector(
      '[data-conversation-id="conv-1"]',
    ) as HTMLElement;
    const rowBody = rowWrapper.querySelector('[role="button"]') as HTMLElement;
    fireEvent.contextMenu(rowBody, { clientX: 10, clientY: 10 });
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Create new agent under this role" }),
    );

    expect(newSessionDialogSpy).toHaveBeenCalled();
    const lastProps = newSessionDialogSpy.mock.calls.at(-1)![0];
    expect(lastProps.initialRole).toBe(stubIdentity.role);

    // No lock prop: the panel MUST NOT be passing any prop that would signal
    // "role is fixed" to the dialog.
    for (const key of Object.keys(lastProps)) {
      expect(key).not.toMatch(/lock|readonly|disabled/i);
    }
  });
});
