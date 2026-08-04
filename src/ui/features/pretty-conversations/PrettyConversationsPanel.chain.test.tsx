// ─── PrettyConversationsPanel — chain wiring coverage (Phase 22 SRIC-05 Plan 22-05 Task 2)
//
// Tests 10-13 cover the panel-level orchestration that wires
// CreateRoleDialog's onChainToCreateIdentity callback into NewSessionDialog's
// initialHost + initialRole props (added in Task 1). Behavior spec:
//
//   Test 10: CreateRoleDialog fires onChainToCreateIdentity with {role, host}
//     → CreateRoleDialog closes, NewSessionDialog opens with those props
//     threaded through as initialHost + initialRole
//   Test 11: CreateRoleDialog closes without firing the chain callback (e.g.
//     user unchecked the checkbox) → NewSessionDialog does NOT open
//   Test 12: chain fires while NewSessionDialog is already open (edge; shouldn't
//     happen via UX but should not crash) → props threaded through, no crash
//   Test 13: NewSessionDialog closes → subsequent panel-triggered opens have
//     NO pre-fill (chainPrefill is cleared on close — regression gate)
//
// Approach: mock CreateRoleDialog + NewSessionDialog with lightweight fakes
// that expose their `open`, `initialHost`, `initialRole`, and the
// onChainToCreateIdentity callback via data-* attributes + a button we can
// click to fire the callback with a fixed payload. Keeps the test isolated
// from the real dialogs' internals (which are already covered in their own
// test files) and focused on the panel's wiring contract.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
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

// ─── Dialog fakes ────────────────────────────────────────────────────────────
// Track the most-recent props passed to each fake so tests can assert.

const nsdMockPropsRef: {
  open: boolean;
  initialHost: Host | null | undefined;
  initialRole: string | null | undefined;
  onClose?: () => void;
} = {
  open: false,
  initialHost: undefined,
  initialRole: undefined,
};

const crdMockPropsRef: {
  open: boolean;
  onClose?: () => void;
  onChainToCreateIdentity?: (opts: { role: string; host: Host }) => void;
} = {
  open: false,
};

vi.mock("@/sidebar/NewSessionDialog", () => ({
  NewSessionDialog: (props: {
    open: boolean;
    onClose: () => void;
    initialHost?: Host | null;
    initialRole?: string | null;
  }) => {
    nsdMockPropsRef.open = props.open;
    nsdMockPropsRef.initialHost = props.initialHost;
    nsdMockPropsRef.initialRole = props.initialRole;
    nsdMockPropsRef.onClose = props.onClose;
    if (!props.open) return null;
    return (
      <div
        data-testid="fake-new-session-dialog"
        data-open={String(props.open)}
        data-initial-host-id={props.initialHost?.id ?? ""}
        data-initial-host-name={props.initialHost?.name ?? ""}
        data-initial-role={props.initialRole ?? ""}
      >
        <button
          type="button"
          data-testid="fake-nsd-close"
          onClick={() => props.onClose()}
        >
          fake-nsd-close
        </button>
      </div>
    );
  },
}));

vi.mock("@/sidebar/CreateRoleDialog", () => ({
  CreateRoleDialog: (props: {
    open: boolean;
    onClose: () => void;
    onChainToCreateIdentity?: (opts: { role: string; host: Host }) => void;
  }) => {
    crdMockPropsRef.open = props.open;
    crdMockPropsRef.onClose = props.onClose;
    crdMockPropsRef.onChainToCreateIdentity = props.onChainToCreateIdentity;
    if (!props.open) return null;
    return (
      <div
        data-testid="fake-create-role-dialog"
        data-open={String(props.open)}
        data-chain-provided={String(props.onChainToCreateIdentity !== undefined)}
      >
        <button
          type="button"
          data-testid="fake-crd-close"
          onClick={() => props.onClose()}
        >
          fake-crd-close
        </button>
        <button
          type="button"
          data-testid="fake-crd-fire-chain"
          onClick={() => {
            props.onChainToCreateIdentity?.({
              role: "new-role",
              host: HOST_A,
            });
          }}
        >
          fake-crd-fire-chain
        </button>
      </div>
    );
  },
}));

// Also mock CloneAgentDialog so the panel doesn't crash on the mount
vi.mock("@/sidebar/CloneAgentDialog", () => ({
  CloneAgentDialog: () => null,
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

const HOST_A = makeHost("h1", "box-a");
const HOST_B = makeHost("h2", "box-b");

const TWO_HOST_TREE: HostFolder = {
  name: "root",
  children: [HOST_A, HOST_B],
};

beforeEach(() => {
  vi.clearAllMocks();
  nsdMockPropsRef.open = false;
  nsdMockPropsRef.initialHost = undefined;
  nsdMockPropsRef.initialRole = undefined;
  crdMockPropsRef.open = false;
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10: chain fires → CreateRoleDialog closes, NewSessionDialog opens with pre-fill
// ─────────────────────────────────────────────────────────────────────────────
describe("PrettyConversationsPanel chain: Test 10 — chain wires role+host into NewSessionDialog", () => {
  it("Test 10: CreateRoleDialog.onChainToCreateIdentity fires → CRD closes, NSD opens with initialHost + initialRole", () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={TWO_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    // Open CreateRoleDialog via the launcher button
    const newRoleBtn = screen.getByRole("button", { name: /new role/i });
    fireEvent.click(newRoleBtn);
    // CRD is now open
    expect(screen.getByTestId("fake-create-role-dialog")).toBeTruthy();
    // NSD is closed
    expect(screen.queryByTestId("fake-new-session-dialog")).toBeFalsy();
    // The panel should be passing a REAL callback (not undefined) to CRD's
    // onChainToCreateIdentity prop
    expect(crdMockPropsRef.onChainToCreateIdentity).toBeDefined();
    expect(typeof crdMockPropsRef.onChainToCreateIdentity).toBe("function");

    // Fire the chain callback (simulates a CRD submit with checkbox=true)
    act(() => {
      fireEvent.click(screen.getByTestId("fake-crd-fire-chain"));
    });

    // CreateRoleDialog closes; NewSessionDialog opens with pre-fill
    expect(screen.queryByTestId("fake-create-role-dialog")).toBeFalsy();
    const nsd = screen.getByTestId("fake-new-session-dialog");
    expect(nsd).toBeTruthy();
    expect(nsd.getAttribute("data-initial-host-id")).toBe("h1");
    expect(nsd.getAttribute("data-initial-host-name")).toBe("box-a");
    expect(nsd.getAttribute("data-initial-role")).toBe("new-role");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 11: CreateRoleDialog closes without chain → NewSessionDialog does NOT open
// ─────────────────────────────────────────────────────────────────────────────
describe("PrettyConversationsPanel chain: Test 11 — cancel path does not open NewSessionDialog", () => {
  it("Test 11: CRD closes without firing chain callback → NSD stays closed", () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={TWO_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    // Open CRD
    fireEvent.click(screen.getByRole("button", { name: /new role/i }));
    expect(screen.getByTestId("fake-create-role-dialog")).toBeTruthy();

    // Close CRD without firing the chain (simulates checkbox=false OR user
    // clicked Cancel OR outside-click dismiss)
    act(() => {
      fireEvent.click(screen.getByTestId("fake-crd-close"));
    });

    // CRD closes; NSD did NOT open
    expect(screen.queryByTestId("fake-create-role-dialog")).toBeFalsy();
    expect(screen.queryByTestId("fake-new-session-dialog")).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 12: chain fires while NSD already open (edge case — shouldn't crash)
// ─────────────────────────────────────────────────────────────────────────────
describe("PrettyConversationsPanel chain: Test 12 — chain overwrites when NSD already open (edge)", () => {
  it("Test 12: NSD opened via pencil, then CRD fires chain → NSD props update with pre-fill (no crash)", () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={TWO_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    // Open NSD via pencil
    const pencil = screen.getByRole("button", { name: /new agent/i });
    fireEvent.click(pencil);
    expect(screen.getByTestId("fake-new-session-dialog")).toBeTruthy();
    // Before chain fires, NSD has no pre-fill
    const nsdBefore = screen.getByTestId("fake-new-session-dialog");
    expect(nsdBefore.getAttribute("data-initial-host-id")).toBe("");
    expect(nsdBefore.getAttribute("data-initial-role")).toBe("");

    // Now open CRD too (in normal UX flow these are mutually exclusive, but
    // the panel state model must not crash if both wind up open)
    fireEvent.click(screen.getByRole("button", { name: /new role/i }));
    expect(screen.getByTestId("fake-create-role-dialog")).toBeTruthy();

    // Fire chain from CRD
    act(() => {
      fireEvent.click(screen.getByTestId("fake-crd-fire-chain"));
    });

    // CRD closed; NSD still open with pre-fill applied
    expect(screen.queryByTestId("fake-create-role-dialog")).toBeFalsy();
    const nsdAfter = screen.getByTestId("fake-new-session-dialog");
    expect(nsdAfter).toBeTruthy();
    expect(nsdAfter.getAttribute("data-initial-host-id")).toBe("h1");
    expect(nsdAfter.getAttribute("data-initial-role")).toBe("new-role");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 13: NSD close clears chainPrefill — next manual open has no pre-fill
// ─────────────────────────────────────────────────────────────────────────────
describe("PrettyConversationsPanel chain: Test 13 — chainPrefill cleared on NSD close (regression gate)", () => {
  it("Test 13: chain-open NSD, close NSD, reopen via pencil → no pre-fill on second open", () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={TWO_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );

    // Open CRD, fire chain → NSD opens with pre-fill
    fireEvent.click(screen.getByRole("button", { name: /new role/i }));
    act(() => {
      fireEvent.click(screen.getByTestId("fake-crd-fire-chain"));
    });
    const nsdFirst = screen.getByTestId("fake-new-session-dialog");
    expect(nsdFirst.getAttribute("data-initial-host-id")).toBe("h1");
    expect(nsdFirst.getAttribute("data-initial-role")).toBe("new-role");

    // Close NSD (simulates user finishing / cancelling the birth flow)
    act(() => {
      fireEvent.click(screen.getByTestId("fake-nsd-close"));
    });
    expect(screen.queryByTestId("fake-new-session-dialog")).toBeFalsy();

    // Reopen NSD via pencil — must have NO pre-fill (chainPrefill cleared)
    const pencil = screen.getByRole("button", { name: /new agent/i });
    fireEvent.click(pencil);
    const nsdSecond = screen.getByTestId("fake-new-session-dialog");
    expect(nsdSecond).toBeTruthy();
    // data-initial-host-id is empty ("" when initialHost is null/undefined)
    expect(nsdSecond.getAttribute("data-initial-host-id")).toBe("");
    expect(nsdSecond.getAttribute("data-initial-role")).toBe("");
  });
});

// Silence unused-variable warning for HOST_B (used indirectly via TWO_HOST_TREE
// but not directly referenced in assertions)
void HOST_B;
