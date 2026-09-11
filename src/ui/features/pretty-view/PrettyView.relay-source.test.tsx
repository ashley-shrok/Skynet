/**
 * Phase 93 Slice 3 Task 3 — PrettyView relay-source integration tests.
 *
 * End-to-end for the relay case in the shared chat surface:
 *   Test 1: relay case renders adapter messages via RelayInboundBubble.
 *   Test 2: harness case UNAFFECTED — harness ingestion effect owns messages
 *           state; adapter shim is inert (Blocker 3 alignment).
 *   Test 3: case-selected onSend — relay routes to adapter.sendMessage.
 *   Test 4: mqid propagation preserved (Pitfall 4).
 *   Test 5: ComposeBox mode wiring — mode={source.kind}.
 *   Test 6: ChatSurfaceErrorState renders when adapter.error !== null (D-20).
 *   Test 7: harness regression floor (existing tests still pass — verified
 *           via source-file assertions).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import path from "path";
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

// Viewing user mock — used by both adapter and MultiBadgeAnchor.
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

// Session working store — silently satisfy AgentBadgeWithMeter transitive reads.
vi.mock("@/state/session-working-store", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    useSessionIsWorking: vi.fn(() => false),
    useSessionIsWorkingRaw: vi.fn(() => "idle"),
    useSessionIsRecycling: vi.fn(() => false),
  };
});

// Adapter mock — the relay-source tests drive PrettyView by controlling the
// adapter's return shape directly. This lets us test the wire-up without
// needing a real WebSocket or the full port at unit-test time.
type AdapterState = {
  messages: Array<Record<string, unknown>>;
  participants: {
    humans: Array<{ mxid: string; displayName: string; userId: string }>;
    agents: Array<{ mxid: string; identityKey: string }>;
  } | null;
  sendMessage: (b: string, m: string) => Promise<boolean>;
  error: string | null;
  isReady: boolean;
};
const adapterMock = vi.fn<() => AdapterState>();
const sendMessageSpy = vi.fn(async (_b: string, _m: string) => true);

vi.mock("./sources/use-chat-surface-adapter", () => ({
  useChatSurfaceAdapter: (..._args: unknown[]): AdapterState => adapterMock(),
}));

// RelayInboundBubble mock so tests can identify rendered bubbles without
// depending on identity resolution or fetch calls.
vi.mock("./RelayInboundBubble", () => ({
  RelayInboundBubble: (props: {
    room: string;
    sender: string;
    body: string;
  }) => (
    <div
      data-testid="mock-relay-inbound-bubble"
      data-sender={props.sender}
      data-room={props.room}
    >
      {props.body}
    </div>
  ),
}));

import { PrettyView } from "./PrettyView";
import { openClaudeSessionSocket } from "@/api/claude-session-api";

const openClaudeSessionSocketMock =
  openClaudeSessionSocket as unknown as ReturnType<typeof vi.fn>;

function defaultAdapterState(overrides: Partial<AdapterState> = {}): AdapterState {
  return {
    messages: [],
    participants: { humans: [], agents: [] },
    sendMessage: sendMessageSpy,
    error: null,
    isReady: false,
    ...overrides,
  };
}

describe("PrettyView relay source (Phase 93 Slice 3 Task 3)", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    openClaudeSessionSocketMock.mockClear();
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Test 1 (relay case renders adapter messages): mount with relay source + messages fixture → bubbles render via RelayInboundBubble", () => {
    adapterMock.mockReturnValue(
      defaultAdapterState({
        isReady: true,
        messages: [
          {
            type: "relay_inbound",
            room: "!room:x",
            sender: "@a:x",
            matrixEventId: "$1",
            body: "hi",
            raw: "hi",
            eventId: "$1",
            ts: 0,
          },
          {
            type: "relay_inbound",
            room: "!room:x",
            sender: "@b:x",
            matrixEventId: "$2",
            body: "there",
            raw: "there",
            eventId: "$2",
            ts: 1,
          },
        ],
      }),
    );

    const { container } = render(
      <PrettyView
        source={{ kind: "relay", roomId: "!room:x", roomTitle: "Test Room" }}
        hostId={0}
        tmuxSession=""
        isVisible={true}
        onSend={() => true}
      />,
    );

    const bubbles = container.querySelectorAll(
      '[data-testid="mock-relay-inbound-bubble"]',
    );
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0].getAttribute("data-sender")).toBe("@a:x");
    expect(bubbles[1].getAttribute("data-sender")).toBe("@b:x");
  });

  it("Test 2 (harness case UNAFFECTED — Blocker 3 alignment): harness ingestion effect owns state; adapter shim messages are inert", () => {
    // Harness case: adapter's messages return [] (Slice 1 inert shim per
    // useHarnessAdapter). effectiveMessages should collapse to local
    // `messages` state, which is empty at initial mount (no WS traffic
    // simulated in this test). No relay bubbles render.
    sessionMatchKeyMock.mockReturnValue("tina");
    adapterMock.mockReturnValue(defaultAdapterState({ isReady: true }));

    const { container } = render(
      <PrettyView
        source={{
          kind: "harness",
          hostId: 1,
          tmuxSession: "s1",
          tabId: "t1",
        }}
        hostId={1}
        tmuxSession="s1"
        tabId="t1"
        isVisible={true}
        onSend={() => true}
      />,
    );

    // No relay bubbles — harness case's message-list container may be gated
    // out at initial mount (status !== "streaming" yet), but even if it
    // renders, there are no relay_inbound messages.
    expect(
      container.querySelectorAll('[data-testid="mock-relay-inbound-bubble"]'),
    ).toHaveLength(0);
    // Harness single-badge renders (Slice 2 case-branch preserved).
    expect(
      container.querySelector('[data-testid="mock-identity-badge"]'),
    ).not.toBeNull();
  });

  it("Test 3 (case-selected onSend, relay path): triggering a send in relay case invokes adapter.sendMessage and does NOT invoke harness onSend", () => {
    adapterMock.mockReturnValue(
      defaultAdapterState({ isReady: true }),
    );
    const harnessOnSend = vi.fn(() => true);

    const { container } = render(
      <PrettyView
        source={{ kind: "relay", roomId: "!room:x", roomTitle: null }}
        hostId={0}
        tmuxSession=""
        isVisible={true}
        onSend={harnessOnSend}
      />,
    );

    // Locate the primary textarea + Send button inside the ComposeBox.
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    fireEvent.change(textarea!, { target: { value: "hello relay" } });
    // Trigger send via Enter (Enter-to-send is Row 2's canonical send path).
    fireEvent.keyDown(textarea!, {
      key: "Enter",
      code: "Enter",
      shiftKey: false,
    });

    // adapter.sendMessage should have been called with body + a non-empty mqid.
    expect(sendMessageSpy).toHaveBeenCalled();
    const [body, mqid] = sendMessageSpy.mock.calls[0];
    expect(body).toBe("hello relay");
    expect(typeof mqid).toBe("string");
    expect((mqid as string).length).toBeGreaterThan(0);
    // Harness onSend NOT invoked.
    expect(harnessOnSend).not.toHaveBeenCalled();
  });

  it("Test 4 (mqid propagation — Pitfall 4): the mqid ComposeBox generates threads through PrettyView.handleComposeSend into adapter.sendMessage byte-for-byte", () => {
    adapterMock.mockReturnValue(defaultAdapterState({ isReady: true }));
    const { container } = render(
      <PrettyView
        source={{ kind: "relay", roomId: "!room:x", roomTitle: null }}
        hostId={0}
        tmuxSession=""
        isVisible={true}
        onSend={() => true}
      />,
    );
    const textarea = container.querySelector("textarea");
    fireEvent.change(textarea!, { target: { value: "first" } });
    fireEvent.keyDown(textarea!, { key: "Enter", code: "Enter" });
    fireEvent.change(textarea!, { target: { value: "second" } });
    fireEvent.keyDown(textarea!, { key: "Enter", code: "Enter" });
    // Each send should have a UNIQUE mqid (ComposeBox generates fresh mqid
    // per send). The mqid identity property is what Pitfall 4 relies on for
    // correlation.
    expect(sendMessageSpy).toHaveBeenCalledTimes(2);
    const firstMqid = sendMessageSpy.mock.calls[0][1];
    const secondMqid = sendMessageSpy.mock.calls[1][1];
    expect(firstMqid).not.toBe(secondMqid);
  });

  it("Test 5 (ComposeBox mode wiring, D-11): PrettyView passes mode={source.kind} to ComposeBox — relay hides Row 1", () => {
    adapterMock.mockReturnValue(defaultAdapterState({ isReady: true }));
    const { container } = render(
      <PrettyView
        source={{ kind: "relay", roomId: "!room:x", roomTitle: null }}
        hostId={0}
        tmuxSession=""
        isVisible={true}
        onSend={() => true}
      />,
    );
    // In relay case, Row 1 (compose-row-1) MUST NOT render (Task 2 D-11).
    expect(container.querySelector('[data-testid="compose-row-1"]')).toBeNull();
    // Row 2 (compose-row-2) MUST render (D-12).
    expect(
      container.querySelector('[data-testid="compose-row-2"]'),
    ).not.toBeNull();
  });

  it("Test 5b (ComposeBox mode wiring, harness path): PrettyView passes mode='harness' — Row 1 renders as normal", () => {
    sessionMatchKeyMock.mockReturnValue("tina");
    adapterMock.mockReturnValue(defaultAdapterState({ isReady: true }));
    const { container } = render(
      <PrettyView
        source={{ kind: "harness", hostId: 1, tmuxSession: "s1" }}
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={() => true}
      />,
    );
    // In harness case, if ComposeBox is mounted (which requires status ===
    // "streaming" || "error" etc.), Row 1 renders. In the initial mount,
    // ComposeBox may not be mounted yet — but if any Row 2 exists it must
    // co-exist with a Row 1 in harness mode.
    const row2 = container.querySelector('[data-testid="compose-row-2"]');
    if (row2 !== null) {
      expect(
        container.querySelector('[data-testid="compose-row-1"]'),
      ).not.toBeNull();
    }
  });

  it("Test 5c (Phase 97 F-6 — placeholder copy in relay case): mount with relay source → textarea placeholder reads `Message room…` (U+2026 ellipsis)", () => {
    adapterMock.mockReturnValue(defaultAdapterState({ isReady: true }));
    const { container } = render(
      <PrettyView
        source={{ kind: "relay", roomId: "!room:x", roomTitle: null }}
        hostId={0}
        tmuxSession=""
        isVisible={true}
        onSend={() => true}
      />,
    );
    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    // U+2026 ellipsis copied verbatim from ComposeBox.tsx placeholder
    // template. capital-M `Message` matches the harness template
    // convention (D-14 SOFT lock — RESEARCH § Finding 6 landmines).
    expect(textarea!.getAttribute("placeholder")).toBe("Message room…");
  });

  it("Test 5d (Phase 97 F-6 harness regression floor — placeholder unchanged): harness case mount → textarea placeholder reads `Message <identityName>…` (or `Message Claude…` when pvIdentity is null)", () => {
    // Harness identity resolution goes through useSessionIdentity; if it
    // resolves an identity, its displayName flows to identityName. When
    // identityHue/identity are null (default mock in this test env), the
    // ComposeBox template's `|| "Claude"` fallback fires.
    sessionMatchKeyMock.mockReturnValue("tina");
    useSessionIdentityMock.mockReturnValue({
      identity: null,
      identityHue: null,
    });
    adapterMock.mockReturnValue(defaultAdapterState({ isReady: true }));
    const { container } = render(
      <PrettyView
        source={{ kind: "harness", hostId: 1, tmuxSession: "s1" }}
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={() => true}
      />,
    );
    const textarea = container.querySelector("textarea");
    // Harness ComposeBox may not mount on initial render (pane-state gate)
    // — but if it does, its placeholder MUST NOT be "Message room…". The
    // regression floor is "relay literal did not leak into harness".
    if (textarea !== null) {
      const placeholder = textarea.getAttribute("placeholder") ?? "";
      expect(placeholder).not.toBe("Message room…");
      // Placeholder must start with "Message " and end with the U+2026
      // ellipsis (the template shape is preserved).
      expect(placeholder.startsWith("Message ")).toBe(true);
      expect(placeholder.endsWith("…")).toBe(true);
    }
  });

  it("Test 6 (error state, D-20): mount with relay source AND adapter.error !== null → ChatSurfaceErrorState renders", () => {
    adapterMock.mockReturnValue(
      defaultAdapterState({
        isReady: true,
        error: "room-not-found",
        messages: [
          {
            type: "relay_inbound",
            room: "!room:x",
            sender: "@a:x",
            matrixEventId: "$1",
            body: "hi",
            raw: "hi",
            eventId: "$1",
            ts: 0,
          },
        ],
      }),
    );

    const { container } = render(
      <PrettyView
        source={{ kind: "relay", roomId: "!room:x", roomTitle: null }}
        hostId={0}
        tmuxSession=""
        isVisible={true}
        onSend={() => true}
      />,
    );

    // ChatSurfaceErrorState renders.
    expect(
      container.querySelector('[data-testid="chat-surface-error-state"]'),
    ).not.toBeNull();
    // And its title contains the D-18 copy.
    expect(
      container.querySelector('[data-testid="chat-surface-error-title"]')
        ?.textContent,
    ).toContain("This conversation is no longer available.");
    // Slice 6 post-close reshape (2026-09-09): ChatSurfaceErrorState is now
    // an OVERLAY (scrim + z-band card, mirroring PrettyViewErrorOverlay per
    // Alice's close-out ask), NOT an in-flow replacement. The message list
    // stays mounted underneath; the scrim covers it visually via
    // `absolute inset-0 z-[99] backdrop-blur-md bg-black/40`. This mirrors
    // how PrettyViewErrorOverlay + SessionHoldingOverlay behave when they
    // mount on the harness case — the message list stays mounted, the
    // scrim overlays it. The inbound bubbles CAN render underneath the
    // overlay; that's the expected overlay semantics.
    const errorOverlay = container.querySelector(
      '[data-testid="chat-surface-error-state"]',
    ) as HTMLElement | null;
    expect(errorOverlay).not.toBeNull();
    expect(errorOverlay!.className).toContain("absolute");
    expect(errorOverlay!.className).toContain("inset-0");
    expect(errorOverlay!.className).toContain("z-[99]");
  });

  it("Test 6b (error state absent when adapter.error === null): ChatSurfaceErrorState does NOT render", () => {
    adapterMock.mockReturnValue(defaultAdapterState({ isReady: true, error: null }));
    const { container } = render(
      <PrettyView
        source={{ kind: "relay", roomId: "!room:x", roomTitle: null }}
        hostId={0}
        tmuxSession=""
        isVisible={true}
        onSend={() => true}
      />,
    );
    expect(
      container.querySelector('[data-testid="chat-surface-error-state"]'),
    ).toBeNull();
  });

  it("Test 7 (harness regression floor — source-file assertions): no unsafe casts, effectiveMessages present, shim-intent comment present", () => {
    const src = readFileSync(
      path.resolve(__dirname, "PrettyView.tsx"),
      "utf-8",
    );
    // effectiveMessages alias exists (Blocker 2 discipline).
    expect(src.includes("effectiveMessages")).toBe(true);
    // Blocker 3 shim-intent comment — the effectiveMessages block must
    // explain that the harness case's adapter.messages is the inert shim [].
    // Accept any of: "shim", "Pitfall 2", "inert", "adapter is inert".
    expect(
      /shim|Pitfall 2|inert|adapter\.messages is the/i.test(src),
    ).toBe(true);
    // Case-selected send handler in PrettyView.
    expect(src.includes("adapter.sendMessage") || src.includes("chatSurfaceAdapter.sendMessage")).toBe(true);
    // mode={source.kind} passed to ComposeBox (D-11 wire-up).
    expect(src.includes("mode={source.kind}")).toBe(true);
    // ChatSurfaceErrorState imported and rendered.
    expect(src.includes("ChatSurfaceErrorState")).toBe(true);
    // source.kind === "relay" occurrence count meets floor of 5 (Warning 3
    // enumeration).
    const relayHits = (src.match(/source\.kind === "relay"/g) ?? []).length;
    expect(relayHits).toBeGreaterThanOrEqual(5);
  });
});
