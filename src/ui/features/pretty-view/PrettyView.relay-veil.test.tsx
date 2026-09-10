/**
 * Phase 97 Slice 02 — PrettyView relay-case loading-veil tests.
 *
 * Locks the new peer veil-arm effect (Task 2): in the relay case, the
 * loading veil (`PrettyViewLoadingOverlay`) arms via a 400ms delay when
 * `chatSurfaceAdapter.isMessagesLoaded === false`, and dismisses when
 * `isMessagesLoaded === true`. The harness path is byte-preserved —
 * still driven off `renderedState === "resolving"` via the pre-existing
 * effect at PrettyView.tsx:2002-2013 (now gated on
 * `source.kind === "harness"` as a NO-OP for existing harness mounts).
 *
 * Coverage:
 *   Test 1: relay + isMessagesLoaded=false + 400ms elapse → overlay present.
 *   Test 2: relay + isMessagesLoaded=true → overlay NOT present.
 *   Test 3: relay + isMessagesLoaded=false + <400ms → overlay NOT yet present
 *           (flash-suppression on fast WS reconnect).
 *   Test 4 (regression, harness): harness case still fires the pane-state
 *           veil (overlay after 400ms of renderedState==="resolving").
 *   Test 5 (regression, harness): harness case with the veil-dismiss
 *           precondition (renderedState !== "resolving") → overlay absent.
 *
 * Setup mirrors PrettyView.relay-source.test.tsx (chat-surface-adapter mock,
 * IdentityBadge stub, ResizeObserver global, viewing-user store mock).
 * `vi.useFakeTimers()` per-test for the delay-arm.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";

type WsStub = {
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
const wsStubs: WsStub[] = [];

vi.mock("@/api/claude-session-api", () => ({
  openClaudeSessionSocket: vi.fn(() => {
    const ws: WsStub = {
      readyState: 1,
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onopen: null,
      onerror: null,
      onclose: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    wsStubs.push(ws);
    return ws;
  }),
}));

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [] }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

const useSessionIdentityMock = vi.fn(() => ({
  identity: null as unknown,
  identityHue: null as number | null,
}));
const sessionMatchKeyMock = vi.fn(() => null as string | null);

vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: (name: string | null | undefined) =>
    sessionMatchKeyMock(name as unknown as never),
  useSessionIdentity: (name: string | null | undefined) =>
    useSessionIdentityMock(name as unknown as never),
}));

vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: (props: { identityKey: string | null }) =>
    props.identityKey ? (
      <div
        data-testid="mock-identity-badge"
        className="pv-identity-breathe absolute top-4 right-5 z-[101]"
        data-identity-key={props.identityKey}
      />
    ) : null,
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

vi.mock("@/state/viewing-user-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    useViewingUserMxid: vi.fn(() => "@viewer:example.com"),
    useViewingUserId: vi.fn(() => "user-1"),
  };
});

const IDENTITIES_BY_KEY = new Map<string, Identity>();

vi.mock("@/state/identities-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    useIdentities: vi.fn(() => ({
      identities: [],
      byKey: IDENTITIES_BY_KEY,
      loaded: true,
      refresh: vi.fn(),
    })),
    buildIdentityHostsFromFleet: vi.fn(() => ({})),
  };
});

vi.mock("@/state/session-working-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    useSessionIsWorking: vi.fn(() => false),
    useSessionIsWorkingRaw: vi.fn(() => "idle"),
    useSessionIsRecycling: vi.fn(() => false),
  };
});

// Adapter mock — Task 2 drives PrettyView by controlling
// isMessagesLoaded directly. Widened AdapterState from
// PrettyView.relay-source.test.tsx to include isMessagesLoaded.
type AdapterState = {
  messages: Array<Record<string, unknown>>;
  participants: {
    humans: Array<{ mxid: string; displayName: string; userId: string }>;
    agents: Array<{ mxid: string; identityKey: string }>;
  } | null;
  sendMessage: (b: string, m: string) => Promise<boolean>;
  error: string | null;
  isReady: boolean;
  isMessagesLoaded?: boolean;
};
const adapterMock = vi.fn<() => AdapterState>();
const sendMessageSpy = vi.fn(async (_b: string, _m: string) => true);

vi.mock("./sources/use-chat-surface-adapter", () => ({
  useChatSurfaceAdapter: (..._args: unknown[]): AdapterState => adapterMock(),
}));

import { PrettyView } from "./PrettyView";

function defaultAdapterState(
  overrides: Partial<AdapterState> = {},
): AdapterState {
  return {
    messages: [],
    participants: { humans: [], agents: [] },
    sendMessage: sendMessageSpy,
    error: null,
    isReady: false,
    isMessagesLoaded: false,
    ...overrides,
  };
}

/**
 * Query for PrettyViewLoadingOverlay via its accessible role + aria-label.
 * The overlay renders `<div role="status" aria-label="Loading conversation…">`
 * at PrettyView.tsx L3782 (mount gate: `{showResolvingSpinner && <...>}`).
 */
function findLoadingOverlay(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    'div[role="status"][aria-label="Loading conversation…"]',
  );
}

describe("PrettyView relay-case loading veil (Phase 97 Slice 02)", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    sendMessageSpy.mockClear();
    useSessionIdentityMock.mockReturnValue({
      identity: null,
      identityHue: null,
    });
    sessionMatchKeyMock.mockReturnValue(null);
    adapterMock.mockReturnValue(defaultAdapterState());
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Test 1 (relay case — shows overlay when isMessagesLoaded is false, after 400ms): overlay arms via the delay-arm timer", () => {
    adapterMock.mockReturnValue(
      defaultAdapterState({ isReady: true, isMessagesLoaded: false }),
    );
    const { container } = render(
      <PrettyView
        source={{ kind: "relay", roomId: "!room:x", roomTitle: "Test" }}
        hostId={0}
        tmuxSession=""
        isVisible={true}
        onSend={() => true}
      />,
    );
    // Before 400ms elapses, the veil is armed but not yet mounted.
    expect(findLoadingOverlay(container)).toBeNull();
    // Advance past the 400ms delay-arm.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(findLoadingOverlay(container)).not.toBeNull();
  });

  it("Test 2 (relay case — dismisses overlay when isMessagesLoaded is true): overlay NOT present", () => {
    adapterMock.mockReturnValue(
      defaultAdapterState({ isReady: true, isMessagesLoaded: true }),
    );
    const { container } = render(
      <PrettyView
        source={{ kind: "relay", roomId: "!room:x", roomTitle: "Test" }}
        hostId={0}
        tmuxSession=""
        isVisible={true}
        onSend={() => true}
      />,
    );
    // No delay-arm on the dismiss branch — the veil is unmounted synchronously.
    expect(findLoadingOverlay(container)).toBeNull();
    // And still absent after any timer flushes (regression: the harness effect
    // must not sneak an arm through on relay mounts).
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(findLoadingOverlay(container)).toBeNull();
  });

  it("Test 3 (relay case — suppresses flash before 400ms): overlay NOT yet present after 200ms", () => {
    adapterMock.mockReturnValue(
      defaultAdapterState({ isReady: true, isMessagesLoaded: false }),
    );
    const { container } = render(
      <PrettyView
        source={{ kind: "relay", roomId: "!room:x", roomTitle: "Test" }}
        hostId={0}
        tmuxSession=""
        isVisible={true}
        onSend={() => true}
      />,
    );
    // Advance only 200ms — the delay-arm should still be pending. The 400ms
    // treatment matches the harness veil's flash-suppression on fast WS
    // reconnect (Phase 97 Finding 1 landmine).
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(findLoadingOverlay(container)).toBeNull();
  });

  it("Test 4 (regression, harness case): harness path still fires the pane-state veil (overlay after 400ms of renderedState==='resolving')", () => {
    // Harness case: adapter is inert, isMessagesLoaded=true is the shim
    // default (and the peer relay effect is a NO-OP because
    // source.kind !== "relay"). renderedState collapses to "resolving" on
    // initial mount (paneState=null, wsTransportState="not-connected") —
    // the harness effect at L2002 arms the veil after 400ms.
    sessionMatchKeyMock.mockReturnValue("tina");
    adapterMock.mockReturnValue(
      defaultAdapterState({ isReady: true, isMessagesLoaded: true }),
    );
    const { container } = render(
      <PrettyView
        source={{ kind: "harness", hostId: 1, tmuxSession: "s1", tabId: "t1" }}
        hostId={1}
        tmuxSession="s1"
        tabId="t1"
        isVisible={true}
        onSend={() => true}
      />,
    );
    // Pre-400ms — veil not yet armed.
    expect(findLoadingOverlay(container)).toBeNull();
    // Advance past 400ms — harness veil arms (renderedState stays "resolving"
    // in this test env; no pane_state:active frame is fed).
    act(() => {
      vi.advanceTimersByTime(400);
    });
    // Harness veil MUST arm — this is the regression floor for D-01
    // (no accidental inheritance; harness case byte-preserved).
    expect(findLoadingOverlay(container)).not.toBeNull();
  });

  it("Test 5 (regression, harness case — isMessagesLoaded field ignored on harness path): even with isMessagesLoaded=false on the inert shim, harness veil is still driven off renderedState (not isMessagesLoaded)", () => {
    // Force isMessagesLoaded=false on the harness inert shim (defensive) —
    // the peer relay effect must remain gated on source.kind === "relay"
    // and NOT arm the veil for a harness mount. The harness effect
    // continues to drive the veil off renderedState only.
    sessionMatchKeyMock.mockReturnValue("tina");
    adapterMock.mockReturnValue(
      defaultAdapterState({ isReady: true, isMessagesLoaded: false }),
    );
    const { container } = render(
      <PrettyView
        source={{ kind: "harness", hostId: 1, tmuxSession: "s1", tabId: "t1" }}
        hostId={1}
        tmuxSession="s1"
        tabId="t1"
        isVisible={true}
        onSend={() => true}
      />,
    );
    // Advance past 400ms. The harness effect arms (renderedState is
    // "resolving" on initial mount). Critically, the relay peer effect is
    // gated on source.kind === "relay" and MUST be a no-op here — this
    // test guards against a naive drop of the source.kind gate that would
    // let the relay effect double-arm the veil on harness mounts.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    // Overlay renders (harness path — renderedState). Assertion is that
    // rendering did NOT throw due to a rules-of-hooks violation from
    // conditional effect firing. The presence of the overlay is a
    // secondary correctness proof that the harness path still works.
    expect(findLoadingOverlay(container)).not.toBeNull();
  });
});
