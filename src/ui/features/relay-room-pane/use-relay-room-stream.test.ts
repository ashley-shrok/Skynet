/**
 * Phase 90 Plan 06 Task 1 — useRelayRoomStream tests.
 *
 * The hook owns the relay-room pane's WS lifecycle (open on mount + visible;
 * close on !visible/unmount; reconnect with linear-with-cap backoff), dispatches
 * all 8 server frames (session, history_batch, live_event, send_ack,
 * send_error, participants, error, inactive), and drives the D-16
 * pending-send FIFO with mqid==txnId correlation (Pitfall 4 / T-90-FE-01).
 *
 * Key regression gates:
 *   - Test 5 (T-90-FE-01): live_event with sender===viewingUserMxid AND
 *     unsigned.transaction_id===<pending mqid> → pending removed + real event
 *     appended. NO duplicate bubble.
 *   - Test 11 (WS lifecycle): visibility flip closes+re-opens WS.
 *   - Test 15 (cleanup): unmount clears every pending timer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

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
      // The runtime WebSocket fires onclose async; we invoke sync in tests via
      // simulateClose(). close() by itself does NOT fire onclose here — tests
      // that want the onclose path invoke simulateClose(1000).
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
    // Return the instance (JS constructor semantics: `new C()` returns the
    // returned object if it's a non-primitive).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return inst as any;
  }
  // Static constants used by the hook (WebSocket.OPEN et al).
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
}

beforeEach(() => {
  instances = [];
  vi.stubGlobal("WebSocket", MockWebSocketCtor);
  vi.useFakeTimers();
  // Ensure window.location has a host + protocol for openRelayRoomSocket.
  // jsdom provides a default (http://localhost/), so no override needed.
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Import AFTER stubGlobal so the hook module reads the stubbed WebSocket.
import { useRelayRoomStream } from "./use-relay-room-stream";

const ROOM_ID = "!room:matrix.example.com";
const VIEWING_MXID = "@ashley:matrix.example.com";
const OTHER_MXID = "@tina:matrix.example.com";

function baseOpts(overrides: Record<string, unknown> = {}) {
  return {
    userId: 42,
    roomId: ROOM_ID,
    viewingUserMxid: VIEWING_MXID,
    isVisible: true,
    ...overrides,
  };
}

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

describe("useRelayRoomStream (Phase 90 Plan 06 Task 1)", () => {
  it("Test 1: mounts with isVisible=true → opens WS + sends connectToRoom on onopen", () => {
    renderHook(() => useRelayRoomStream(baseOpts()));
    expect(instances.length).toBe(1);
    expect(instances[0].url).toContain("/relay-room/websocket/");
    // Fire onopen — hook should push the connectToRoom frame.
    act(() => {
      instances[0].simulateOpen();
    });
    expect(instances[0].sent).toHaveLength(1);
    const payload = JSON.parse(instances[0].sent[0]);
    expect(payload).toEqual({ type: "connectToRoom", roomId: ROOM_ID });
  });

  it("Test 2: session frame is stored without side effect on history", () => {
    const { result } = renderHook(() => useRelayRoomStream(baseOpts()));
    act(() => {
      instances[0].simulateOpen();
      instances[0].simulateFrame({
        type: "session",
        roomId: ROOM_ID,
        roomTitle: "Working session",
      });
    });
    expect(result.current.history).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("Test 3: history_batch frame populates history + hasOlder", () => {
    const { result } = renderHook(() => useRelayRoomStream(baseOpts()));
    const e1 = makeMatrixEvent({ event_id: "$a" });
    const e2 = makeMatrixEvent({ event_id: "$b" });
    act(() => {
      instances[0].simulateOpen();
      instances[0].simulateFrame({
        type: "history_batch",
        events: [e1, e2],
        hasMore: true,
      });
    });
    expect(result.current.history).toEqual([e1, e2]);
    expect(result.current.hasOlder).toBe(true);
  });

  it("Test 4: live_event with sender != viewingUserMxid appends to history", () => {
    const { result } = renderHook(() => useRelayRoomStream(baseOpts()));
    const evt = makeMatrixEvent({ event_id: "$x", sender: OTHER_MXID });
    act(() => {
      instances[0].simulateOpen();
      instances[0].simulateFrame({ type: "live_event", event: evt });
    });
    expect(result.current.history).toEqual([evt]);
  });

  it("Test 5 (T-90-FE-01 regression gate): live_event sender===viewingUserMxid AND unsigned.transaction_id===mqid removes pending + appends real event", () => {
    const { result } = renderHook(() => useRelayRoomStream(baseOpts()));
    act(() => {
      instances[0].simulateOpen();
    });
    // Send a message → pending inserted.
    act(() => {
      result.current.sendMessage("hi from me", "relay-optim-abc");
    });
    expect(result.current.pendingSends).toHaveLength(1);
    expect(result.current.pendingSends[0].mqid).toBe("relay-optim-abc");
    expect(result.current.pendingSends[0].state).toBe("sending");
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
    // Pending removed, real event in history — exactly ONE bubble.
    expect(result.current.pendingSends).toHaveLength(0);
    expect(result.current.history).toEqual([echoedEvent]);
  });

  it("Test 6: send_ack settles the pending entry (removes it if not already removed)", () => {
    const { result } = renderHook(() => useRelayRoomStream(baseOpts()));
    act(() => {
      instances[0].simulateOpen();
      result.current.sendMessage("test", "relay-optim-xyz");
    });
    expect(result.current.pendingSends).toHaveLength(1);
    act(() => {
      instances[0].simulateFrame({
        type: "send_ack",
        txnId: "relay-optim-xyz",
        eventId: "$server-eventid",
      });
    });
    // send_ack removes the pending (redundant with live_event echo but safe).
    expect(result.current.pendingSends).toHaveLength(0);
  });

  it("Test 7: send_error flips the matching pending to state:failed", () => {
    const { result } = renderHook(() => useRelayRoomStream(baseOpts()));
    act(() => {
      instances[0].simulateOpen();
      result.current.sendMessage("test", "relay-optim-fail");
    });
    act(() => {
      instances[0].simulateFrame({
        type: "send_error",
        txnId: "relay-optim-fail",
        reason: "rate_limited",
      });
    });
    expect(result.current.pendingSends).toHaveLength(1);
    expect(result.current.pendingSends[0].state).toBe("failed");
  });

  it("Test 8: 20s elapsed → pending flips to failed via client timer (PENDING_SEND_TIMEOUT_MS_NORMAL)", () => {
    const { result } = renderHook(() => useRelayRoomStream(baseOpts()));
    act(() => {
      instances[0].simulateOpen();
      result.current.sendMessage("test", "relay-optim-timeout");
    });
    expect(result.current.pendingSends[0].state).toBe("sending");
    // Advance 20 seconds — the client-side timer should fire flipToFailed.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(result.current.pendingSends[0].state).toBe("failed");
  });

  it("Test 9: sendMessage fires WS send with type:send_message + inserts pending entry", () => {
    const { result } = renderHook(() => useRelayRoomStream(baseOpts()));
    act(() => {
      instances[0].simulateOpen();
    });
    act(() => {
      result.current.sendMessage("hello world", "relay-optim-frame");
    });
    // First sent frame is connectToRoom; second is send_message.
    expect(instances[0].sent).toHaveLength(2);
    const payload = JSON.parse(instances[0].sent[1]);
    expect(payload).toEqual({
      type: "send_message",
      body: "hello world",
      txnId: "relay-optim-frame",
    });
    expect(result.current.pendingSends).toHaveLength(1);
    expect(result.current.pendingSends[0].content).toBe("hello world");
  });

  it("Test 10: fetchOlder fires WS send with type:fetch_older_range and count=20", () => {
    const { result } = renderHook(() => useRelayRoomStream(baseOpts()));
    act(() => {
      instances[0].simulateOpen();
    });
    act(() => {
      result.current.fetchOlder("$oldest-event-id");
    });
    // connectToRoom + fetch_older_range.
    expect(instances[0].sent).toHaveLength(2);
    const payload = JSON.parse(instances[0].sent[1]);
    expect(payload).toEqual({
      type: "fetch_older_range",
      beforeEventId: "$oldest-event-id",
      count: 20,
    });
  });

  it("Test 11: isVisible flip false→true toggles WS close+reopen", () => {
    const { rerender } = renderHook(
      ({ isVisible }: { isVisible: boolean }) =>
        useRelayRoomStream(baseOpts({ isVisible })),
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

  it("Test 12: inactive frame sets error to 'room-not-found'", () => {
    const { result } = renderHook(() => useRelayRoomStream(baseOpts()));
    act(() => {
      instances[0].simulateOpen();
      instances[0].simulateFrame({
        type: "inactive",
        reason: "not_member",
      });
    });
    expect(result.current.error).toBe("room-not-found");
  });

  it("Test 13: error frame sets error to 'protocol' but leaves connection open", () => {
    const { result } = renderHook(() => useRelayRoomStream(baseOpts()));
    act(() => {
      instances[0].simulateOpen();
      instances[0].simulateFrame({ type: "error", message: "unexpected" });
    });
    expect(result.current.error).toBe("protocol");
    // Not closed — no simulateClose fired.
    expect(instances[0].readyState).toBe(1); // OPEN
  });

  it("Test 14: participants frame updates hook's participants state", () => {
    const { result } = renderHook(() => useRelayRoomStream(baseOpts()));
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
    expect(result.current.participants?.humans).toHaveLength(2);
    expect(result.current.participants?.agents).toHaveLength(1);
  });

  it("Test 15: unmount clears all pending timers (no orphan callbacks)", () => {
    const { result, unmount } = renderHook(() =>
      useRelayRoomStream(baseOpts()),
    );
    act(() => {
      instances[0].simulateOpen();
      result.current.sendMessage("test1", "relay-optim-1");
      result.current.sendMessage("test2", "relay-optim-2");
    });
    expect(result.current.pendingSends).toHaveLength(2);
    // Unmount — the hook's cleanup should clear both timers so advancing
    // timers past 20s does not throw against a torn-down component.
    unmount();
    // Advancing timers should NOT throw — orphan timers have been cleared.
    expect(() => {
      vi.advanceTimersByTime(30_000);
    }).not.toThrow();
    // Confirm the WS was closed on unmount.
    expect(instances[0].readyState).toBe(3);
  });
});
