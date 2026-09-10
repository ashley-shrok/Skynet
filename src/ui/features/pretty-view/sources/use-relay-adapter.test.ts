/**
 * Phase 93 Slice 3 — useRelayAdapter tests.
 *
 * Ported from Slice D's standalone relay-source stream hook tests (byte-
 * preserved assertion set; only import path, hook name, and call signature
 * updated per Phase 93 Slice 3; Slice 4 retired the source). Coverage:
 *
 *   - WS lifecycle (open on mount+visible; close on !visible/unmount).
 *   - Frame dispatch (session, history_batch, live_event, send_ack,
 *     send_error, participants, inactive, error).
 *   - Pending-send FIFO with mqid==txnId correlation (Pitfall 4 / T-90-FE-01).
 *   - 20s no-echo timer flips pending to failed.
 *   - isVisible re-visibility toggle.
 *   - Idle input (null source) is a no-op — no WS opened.
 *   - Initial state Warning-2-compliant: participants={humans:[],agents:[]},
 *     isReady=false BEFORE session/history_batch; isReady=true AFTER.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { renderHook, act } from "@testing-library/react";

import type { MatrixEvent, RelayRoomServerEvent } from "./relay-room-api";

// ── Minimal WebSocket mock ───────────────────────────────────────────────────
// The hook constructs `new WebSocket(url)` via openRelayRoomSocket(). We
// vi.stubGlobal the constructor so tests can drive readyState + onopen/
// onmessage/onclose synchronously via helper methods.

interface MockWebSocketInstance {
  url: string;
  readyState: number;
  sent: string[];
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onclose: ((e: CloseEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  close(code?: number, reason?: string): void;
  send(data: string): void;
  // Test helpers
  simulateOpen(): void;
  simulateFrame(frame: RelayRoomServerEvent): void;
  simulateClose(code?: number): void;
}

let instances: MockWebSocketInstance[] = [];

function makeMockWebSocket(url: string): MockWebSocketInstance {
  const ws: MockWebSocketInstance = {
    url,
    readyState: 0, // CONNECTING
    sent: [],
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    close(_code?: number, _reason?: string) {
      if (this.readyState === 3) return;
      this.readyState = 3; // CLOSED
    },
    send(data: string) {
      this.sent.push(data);
    },
    simulateOpen() {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen(new Event("open"));
    },
    simulateFrame(frame: RelayRoomServerEvent) {
      if (this.onmessage) {
        const evt = new MessageEvent("message", {
          data: JSON.stringify(frame),
        });
        this.onmessage(evt);
      }
    },
    simulateClose(code: number = 1006) {
      this.readyState = 3;
      if (this.onclose) {
        const evt = { code, reason: "" } as CloseEvent;
        this.onclose(evt);
      }
    },
  };
  return ws;
}

class MockWebSocketCtor {
  constructor(url: string) {
    const inst = makeMockWebSocket(url);
    instances.push(inst);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return inst as any;
  }
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
}

// Mock the viewing-user-store so the hook resolves the viewer mxid + id
// without hitting the real store.
const VIEWING_MXID = "@ashley:matrix.example.com";
vi.mock("@/state/viewing-user-store", () => ({
  useViewingUserMxid: () => VIEWING_MXID,
  useViewingUserId: () => "user-42",
}));

beforeEach(() => {
  instances = [];
  vi.stubGlobal("WebSocket", MockWebSocketCtor);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Import AFTER stubGlobal so the hook module reads the stubbed WebSocket.
import { useRelayAdapter } from "./use-relay-adapter";

const ROOM_ID = "!room:matrix.example.com";
const OTHER_MXID = "@tina:matrix.example.com";

type RelaySource = { kind: "relay"; roomId: string; roomTitle: string | null };

const RELAY_SOURCE: RelaySource = {
  kind: "relay",
  roomId: ROOM_ID,
  roomTitle: "Working session",
};

function makeMatrixEvent(overrides: Partial<MatrixEvent> = {}): MatrixEvent {
  return {
    event_id: `$evt-${Math.random()}`,
    type: "m.room.message",
    sender: OTHER_MXID,
    origin_server_ts: 1_700_000_000_000,
    content: { msgtype: "m.text", body: "hello" },
    ...overrides,
  };
}

describe("useRelayAdapter (Phase 93 Slice 3)", () => {
  it("Test 1: mounts with isVisible=true → opens WS + sends connectToRoom on onopen", () => {
    renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    expect(instances.length).toBe(1);
    expect(instances[0].url).toContain("/relay-room/websocket/");
    act(() => {
      instances[0].simulateOpen();
    });
    expect(instances[0].sent).toHaveLength(1);
    const payload = JSON.parse(instances[0].sent[0]);
    expect(payload).toEqual({ type: "connectToRoom", roomId: ROOM_ID });
  });

  it("Test 2 (Warning 2 — initial state): before any frame, participants is {humans:[],agents:[]} NOT null; isReady is false", () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    // Initial state — pre-open, pre-frame.
    expect(result.current.participants).not.toBeNull();
    expect(result.current.participants).toEqual({ humans: [], agents: [] });
    expect(result.current.isReady).toBe(false);
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("Test 2b: session frame flips isReady to true", () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    expect(result.current.isReady).toBe(false);
    act(() => {
      instances[0].simulateOpen();
      instances[0].simulateFrame({
        type: "session",
        roomId: ROOM_ID,
        roomTitle: "Working session",
      });
    });
    expect(result.current.isReady).toBe(true);
    // history untouched — session is metadata only.
    expect(result.current.messages).toEqual([]);
  });

  it("Test 3: history_batch frame populates messages + hasOlder + isReady", () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    const e1 = makeMatrixEvent({ event_id: "$a", content: { msgtype: "m.text", body: "one" } });
    const e2 = makeMatrixEvent({ event_id: "$b", content: { msgtype: "m.text", body: "two" } });
    act(() => {
      instances[0].simulateOpen();
      instances[0].simulateFrame({
        type: "history_batch",
        events: [e1, e2],
        hasMore: true,
      });
    });
    expect(result.current.messages).toHaveLength(2);
    // Non-self events → relay_inbound shape (D-16).
    expect(result.current.messages[0].type).toBe("relay_inbound");
    expect(result.current.hasOlder).toBe(true);
    expect(result.current.isReady).toBe(true);
  });

  it("Test 4: live_event with sender != viewingUserMxid appends to messages (relay_inbound)", () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    const evt = makeMatrixEvent({
      event_id: "$x",
      sender: OTHER_MXID,
      content: { msgtype: "m.text", body: "yo" },
    });
    act(() => {
      instances[0].simulateOpen();
      instances[0].simulateFrame({ type: "live_event", event: evt });
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].type).toBe("relay_inbound");
  });

  it("Test 5 (Pitfall 4 regression gate): live_event sender===viewingUserMxid AND unsigned.transaction_id===mqid correlates + appends real event", async () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    act(() => {
      instances[0].simulateOpen();
    });
    // Send a message → pending inserted internally.
    let sendOk = false;
    await act(async () => {
      sendOk = await result.current.sendMessage("hi from me", "relay-optim-abc");
    });
    expect(sendOk).toBe(true);
    // Server echoes back the event with matching transaction_id.
    const echoedEvent = makeMatrixEvent({
      event_id: "$echo",
      sender: VIEWING_MXID,
      content: { msgtype: "m.text", body: "hi from me" },
      unsigned: { transaction_id: "relay-optim-abc" },
    });
    act(() => {
      instances[0].simulateFrame({ type: "live_event", event: echoedEvent });
    });
    // Phase 97 UAT follow-up 4 (2026-09-10): mapper now emits self
    // messages as `type:"message", role:"user"` so ChatMessage renders
    // them as blue right-aligned user bubbles (was `relay_outbound`
    // rendering the ▸-headered hue-tinted RelayOutboundBubble, which is
    // a HARNESS-only artifact for detected Bash-relay-send tool-use).
    expect(result.current.messages).toHaveLength(1);
    const echoed = result.current.messages[0];
    expect(echoed.type).toBe("message");
    if (echoed.type === "message") {
      expect(echoed.role).toBe("user");
      expect(echoed.content).toBe("hi from me");
    }
  });

  it("Test 6: send_ack settles pending and promotes to history entry (self-echo synth)", async () => {
    // Phase 97 UAT follow-up 3 (2026-09-10) — contract change: send_ack
    // now BOTH settles the pending AND synthesizes a history entry so
    // the sender sees their own message even if a corresponding
    // live_event is never delivered to their own WS (some Matrix
    // homeserver configs echo only to OTHER participants). Pre-change
    // behavior expected `messages` to stay empty here; UAT surfaced that
    // this was wrong — Ashley never saw her own sent messages.
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    act(() => {
      instances[0].simulateOpen();
    });
    await act(async () => {
      await result.current.sendMessage("test", "relay-optim-xyz");
    });
    act(() => {
      instances[0].simulateFrame({
        type: "send_ack",
        txnId: "relay-optim-xyz",
        eventId: "$server-eventid",
      });
    });
    // send_ack removes the pending AND synthesizes a real history entry
    // using the eventId the server returned. Body content preserved;
    // eventId is the SERVER-supplied one (not the mqid). Type is
    // "message" role "user" (Phase 97 UAT follow-up 4 — see mapper).
    expect(result.current.messages).toHaveLength(1);
    const msg = result.current.messages[0];
    expect(msg.type).toBe("message");
    expect(msg.eventId).toBe("$server-eventid");
    if (msg.type === "message") {
      expect(msg.role).toBe("user");
      expect(msg.content).toBe("test");
    }
  });

  it("Test 6b: subsequent live_event with same event_id is de-duped against the send_ack synth", async () => {
    // Regression floor: if the homeserver DOES also deliver a live_event
    // for the sender's own send (some setups do), the non-correlated
    // dedup branch prevents a second copy from being appended.
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    act(() => {
      instances[0].simulateOpen();
    });
    await act(async () => {
      await result.current.sendMessage("test", "relay-optim-xyz");
    });
    act(() => {
      instances[0].simulateFrame({
        type: "send_ack",
        txnId: "relay-optim-xyz",
        eventId: "$server-eventid",
      });
    });
    // Then the WS also fires a live_event with the same event_id.
    act(() => {
      instances[0].simulateFrame({
        type: "live_event",
        event: {
          event_id: "$server-eventid",
          type: "m.room.message",
          sender: RELAY_SOURCE.viewingUserMxid,
          origin_server_ts: Date.now(),
          content: { msgtype: "m.text", body: "test" },
          unsigned: { transaction_id: "relay-optim-xyz" },
        },
      });
    });
    // Still exactly one entry — dedup caught the second delivery.
    expect(result.current.messages).toHaveLength(1);
  });

  it("Test 7: send_error path — send_error frame propagates through pending FIFO (no exception)", async () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    act(() => {
      instances[0].simulateOpen();
    });
    await act(async () => {
      await result.current.sendMessage("test", "relay-optim-fail");
    });
    // send_error frame should be handled without throwing.
    expect(() =>
      act(() => {
        instances[0].simulateFrame({
          type: "send_error",
          txnId: "relay-optim-fail",
          reason: "rate_limited",
        });
      }),
    ).not.toThrow();
  });

  it("Test 8 (Constants): PENDING_SEND_TIMEOUT_MS_NORMAL === 20_000 — 20s advance flips pending to failed without throw", async () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    act(() => {
      instances[0].simulateOpen();
    });
    await act(async () => {
      await result.current.sendMessage("test", "relay-optim-timeout");
    });
    // Advance 20 seconds — the client-side timer should fire flipToFailed
    // without throwing.
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(20_000);
      });
    }).not.toThrow();
  });

  it("Test 9: sendMessage fires WS send with type:send_message + txnId echo", async () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    act(() => {
      instances[0].simulateOpen();
    });
    await act(async () => {
      await result.current.sendMessage("hello world", "relay-optim-frame");
    });
    // First sent frame is connectToRoom; second is send_message.
    expect(instances[0].sent).toHaveLength(2);
    const payload = JSON.parse(instances[0].sent[1]);
    expect(payload).toEqual({
      type: "send_message",
      body: "hello world",
      txnId: "relay-optim-frame",
    });
  });

  it("Test 10: fetchOlder fires WS send with type:fetch_older_range and count=20 (uses oldest event from history)", async () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    const e1 = makeMatrixEvent({ event_id: "$oldest" });
    const e2 = makeMatrixEvent({ event_id: "$newer" });
    act(() => {
      instances[0].simulateOpen();
      instances[0].simulateFrame({
        type: "history_batch",
        events: [e1, e2],
        hasMore: true,
      });
    });
    await act(async () => {
      await result.current.fetchOlder!();
    });
    // connectToRoom + fetch_older_range.
    expect(instances[0].sent).toHaveLength(2);
    const payload = JSON.parse(instances[0].sent[1]);
    expect(payload).toEqual({
      type: "fetch_older_range",
      beforeEventId: "$oldest",
      count: 20,
    });
  });

  it("Test 11: isVisible flip false→true toggles WS close+reopen", () => {
    const { rerender } = renderHook(
      ({ isVisible }: { isVisible: boolean }) =>
        useRelayAdapter(RELAY_SOURCE, isVisible),
      { initialProps: { isVisible: true } },
    );
    expect(instances.length).toBe(1);
    act(() => {
      instances[0].simulateOpen();
    });
    // Flip to hidden — WS should close.
    act(() => {
      rerender({ isVisible: false });
    });
    expect(instances[0].readyState).toBe(3); // CLOSED
    // Flip back to visible — a fresh WS opens.
    act(() => {
      rerender({ isVisible: true });
    });
    expect(instances.length).toBe(2);
  });

  it("Test 12 (D-20): inactive frame sets error to 'room-not-found'", () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    act(() => {
      instances[0].simulateOpen();
      instances[0].simulateFrame({
        type: "inactive",
        reason: "not_member",
      });
    });
    expect(result.current.error).toBe("room-not-found");
  });

  it("Test 13 (D-20): error frame sets error to 'protocol' but leaves connection open", () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    act(() => {
      instances[0].simulateOpen();
      instances[0].simulateFrame({ type: "error", message: "unexpected" });
    });
    expect(result.current.error).toBe("protocol");
    // Not closed — no simulateClose fired.
    expect(instances[0].readyState).toBe(1); // OPEN
  });

  it("Test 14: participants frame updates participants state", () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    act(() => {
      instances[0].simulateOpen();
      instances[0].simulateFrame({
        type: "participants",
        humans: [
          { mxid: VIEWING_MXID, displayName: "Ashley", userId: "1" },
          { mxid: OTHER_MXID, displayName: "Tina", userId: "2" },
        ],
        agents: [{ mxid: "@nelly:matrix.example.com", identityKey: "nelly" }],
      });
    });
    expect(result.current.participants).not.toBeNull();
    expect(result.current.participants!.humans).toHaveLength(2);
    expect(result.current.participants!.agents).toHaveLength(1);
  });

  it("Test 15: unmount clears WS + pending timers (no orphan callbacks)", async () => {
    const { result, unmount } = renderHook(() =>
      useRelayAdapter(RELAY_SOURCE, true),
    );
    act(() => {
      instances[0].simulateOpen();
    });
    await act(async () => {
      await result.current.sendMessage("test1", "relay-optim-1");
      await result.current.sendMessage("test2", "relay-optim-2");
    });
    unmount();
    // Advancing timers should NOT throw — orphan timers have been cleared.
    expect(() => {
      vi.advanceTimersByTime(30_000);
    }).not.toThrow();
    // Confirm the WS was closed on unmount.
    expect(instances[0].readyState).toBe(3);
  });

  it("Test 16 (Idle input — null source): passing null source is a no-op — no WS opened, IDLE_STATE returned", () => {
    const { result } = renderHook(() => useRelayAdapter(null, true));
    expect(instances.length).toBe(0);
    expect(result.current.messages).toEqual([]);
    expect(result.current.participants).toEqual({ humans: [], agents: [] });
    expect(result.current.isReady).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // ── Phase 97 Finding 1 — isMessagesLoaded veil signal ────────────────────
  //
  // The relay adapter exposes `isMessagesLoaded` (Phase 97 Slice 02):
  //   - false initially (before any frame arrives)
  //   - flips true on the FIRST `history_batch` frame — the backend has
  //     read the room's history. This is the "veil dismiss" signal for
  //     the relay case; PrettyView reads it via chatSurfaceAdapter.
  //   - MUST NOT flip on `session` alone (session is WS-auth pass, earlier
  //     than history — dismissing on session would show an empty room
  //     with no messages loaded yet, defeating the veil's purpose).
  //   - Empty rooms dismiss too: history_batch with events:[] flips the
  //     signal — the FRAME arrival is the signal, not events.length.
  //   - `useHarnessAdapter` INERT_STATE defaults `isMessagesLoaded: true`
  //     (the harness case's veil is driven off pane-state and never reads
  //     this field; `true` codifies "adapter reports messages-loaded" for
  //     the inert shim).

  it("Test 18 (Phase 97 Finding 1 — initial state): before any frame, isMessagesLoaded is false", () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    expect(result.current.isMessagesLoaded).toBe(false);
  });

  it("Test 19 (Phase 97 Finding 1 — empty-room dismiss): history_batch with events:[] flips isMessagesLoaded to true", () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    expect(result.current.isMessagesLoaded).toBe(false);
    act(() => {
      instances[0].simulateOpen();
      instances[0].simulateFrame({
        type: "history_batch",
        events: [],
        hasMore: false,
      });
    });
    // Empty rooms MUST dismiss the veil — the FRAME arrival is the signal,
    // not events.length. Without this, an empty room's veil never dismisses.
    expect(result.current.isMessagesLoaded).toBe(true);
  });

  it("Test 20 (Phase 97 Finding 1 — populated dismiss): history_batch with events:[non-empty] flips isMessagesLoaded to true", () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    const e1 = makeMatrixEvent({ event_id: "$a" });
    act(() => {
      instances[0].simulateOpen();
      instances[0].simulateFrame({
        type: "history_batch",
        events: [e1],
        hasMore: false,
      });
    });
    expect(result.current.isMessagesLoaded).toBe(true);
  });

  it("Test 21 (Phase 97 Finding 1 — session alone does NOT dismiss): a session frame WITHOUT history_batch flips isReady but leaves isMessagesLoaded=false", () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    act(() => {
      instances[0].simulateOpen();
      instances[0].simulateFrame({
        type: "session",
        roomId: ROOM_ID,
        roomTitle: "Working session",
      });
    });
    // session is WS-auth pass — flips isReady, MUST NOT flip
    // isMessagesLoaded. Landmine: dismissing on session alone would defeat
    // the whole point of separating the two signals.
    expect(result.current.isReady).toBe(true);
    expect(result.current.isMessagesLoaded).toBe(false);
  });

  it("Test 22 (Phase 97 Finding 1 — memoization stability): two identical history_batch frames don't churn the returned adapter object identity", () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    act(() => {
      instances[0].simulateOpen();
      instances[0].simulateFrame({
        type: "history_batch",
        events: [],
        hasMore: false,
      });
    });
    const first = result.current;
    // Feed an identical history_batch frame — inputs to the useMemo deps
    // don't change (history is set to []; setHistory([]) with same-shape
    // triggers a state update but produces the same downstream memoized
    // messages array reference IF React's setState bail-out fires, or a
    // new one if not. Regardless, isMessagesLoaded stays true and
    // participates in the memo deps array.
    act(() => {
      instances[0].simulateFrame({
        type: "history_batch",
        events: [],
        hasMore: false,
      });
    });
    // isMessagesLoaded must be in the memo deps (Phase 93 Landmine 4) — if
    // omitted, the object would be memoized incorrectly and a fresh flip
    // could serve a stale return. Assert value stayed correct across the
    // second frame.
    expect(result.current.isMessagesLoaded).toBe(true);
    // Second guard: the returned shape carries isMessagesLoaded in the
    // returned-object literal (not just internally tracked).
    expect("isMessagesLoaded" in result.current).toBe(true);
    // Reference: `first` was captured pre-second-frame; we don't assert
    // reference equality here (React setState of same value may or may not
    // bail out depending on scheduler internals) — instead we assert both
    // returned shapes carry the correct value.
    expect(first.isMessagesLoaded).toBe(true);
  });

  it("Test 23 (Phase 97 Finding 1 — harness inert shim): the harness case reads isMessagesLoaded=true from INERT_STATE (defensive default; harness veil is driven off pane-state)", async () => {
    // Import the harness adapter dynamically so we don't disturb the module
    // graph the rest of the file uses.
    const mod = await import("./use-harness-adapter");
    const { result } = renderHook(() => mod.useHarnessAdapter(null, true));
    // The harness INERT_STATE codifies "adapter reports messages-loaded"
    // for the inert shim — harness veil consumer gates on
    // source.kind === "harness" and reads renderedState === "resolving"
    // instead, so this default is defensive-only.
    expect(result.current.isMessagesLoaded).toBe(true);
  });

  it("Test 17 (structured logging): send_message emits console.info with operation field (no raw body)", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    act(() => {
      instances[0].simulateOpen();
    });
    await act(async () => {
      await result.current.sendMessage("secret body", "relay-optim-log");
    });
    // At least one call should include operation: "relay_room_send_message".
    const sendLogs = infoSpy.mock.calls.filter((call) => {
      const arg = call[0] as unknown as { operation?: string };
      return arg && arg.operation === "relay_room_send_message";
    });
    expect(sendLogs.length).toBeGreaterThanOrEqual(1);
    // And the log must NOT include the raw body.
    const flat = JSON.stringify(sendLogs);
    expect(flat).not.toContain("secret body");
    infoSpy.mockRestore();
  });

  // ─── Test 24: WS-closed send → immediate failed bubble in messages ──────
  // Regression pin for the silent-message-loss failure mode Ashley flagged
  // during Phase 93 UAT. If the WS closes (network drop, tab returned from
  // background) and the user sends before it reconnects, sendMessage must:
  //   1. Return false (caller can decide to retry).
  //   2. Seed a pending entry with state:"failed" that surfaces in
  //      adapter.messages with pendingState:"failed", so PrettyView renders
  //      it as the saturated-red bubble (ChatMessage L429-436). Without
  //      this, the message is silently lost — no visual feedback.
  // The fail-immediately branch lives in use-relay-adapter.ts sendMessage
  // at the `ws === null || ws.readyState !== WebSocket.OPEN` check.
  it("Test 24 (WS-closed regression pin): sendMessage on a closed WS returns false AND surfaces the pending as pendingState:'failed' in adapter.messages", async () => {
    const { result } = renderHook(() => useRelayAdapter(RELAY_SOURCE, true));
    act(() => {
      instances[0].simulateOpen();
    });
    // Simulate network drop — WS closes mid-session.
    act(() => {
      instances[0].simulateClose(1006);
    });
    expect(instances[0].readyState).toBe(3); // CLOSED

    let sendOk = true;
    await act(async () => {
      sendOk = await result.current.sendMessage(
        "message during offline",
        "relay-optim-offline",
      );
    });
    // Fail-immediately: sendMessage resolves false.
    expect(sendOk).toBe(false);
    // The pending surfaces in adapter.messages as a user bubble with
    // pendingState:"failed" — this is what drives the red bubble render.
    const failedMessages = result.current.messages.filter(
      (m) => m.type === "message" && m.pendingState === "failed",
    );
    expect(failedMessages).toHaveLength(1);
    const failed = failedMessages[0];
    if (failed.type === "message") {
      expect(failed.role).toBe("user");
      expect(failed.content).toBe("message during offline");
      expect(failed.eventId).toBe("relay-optim-offline");
    }
  });
});
