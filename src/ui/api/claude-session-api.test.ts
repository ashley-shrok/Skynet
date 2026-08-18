// ─── claude-session-api — sendFetchOlder + isFetchOlderBatchEvent (Phase 43 Plan 05) ─
//
// Runtime-helper coverage for the two small additions Plan 43-05 layers on top
// of Plan 43-03's wire types (`FetchOlderPayload`, `FetchOlderBatchEvent`).
//
//   sendFetchOlder(ws, payload)
//     - happy path: OPEN socket → single ws.send(JSON.stringify(payload)) + return true
//     - readyState gate: CONNECTING/CLOSED → no ws.send + return false
//
//   isFetchOlderBatchEvent(x)
//     - true cases: minimal empty-frames shape, populated frames + reachedBeginning,
//       and empty frames with a server-supplied `error` field (per Phase 43 CONTEXT
//       § "Fetch failure handling" — the server ALWAYS emits an event, error-shape
//       included, so the client can clear its loading indicator; the guard MUST
//       narrow on this shape or PrettyView's onmessage switch cannot handle it)
//     - false cases: null / undefined / string / wrong-type / missing frames /
//       non-array frames
//
// Runs under the frontend jsdom project (see vitest.config.ts:39-46 → include:
// "src/ui/**/*.test.{ts,tsx}"). Uses the global jsdom `WebSocket` constant for
// its readyState numeric constants (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED).

import { describe, it, expect, vi } from "vitest";
import type { FetchOlderPayload } from "./claude-session-api.js";
import {
  sendFetchOlder,
  isFetchOlderBatchEvent,
} from "./claude-session-api.js";

// Minimal ws stub — sendFetchOlder only reads `readyState` and calls `send`.
// Not a full WebSocket; the helper's declared param type is WebSocket so we
// double-cast through unknown at each call site.
type SendMock = ReturnType<typeof vi.fn>;
type WsStub = { readyState: number; send: SendMock };

function makeWs(readyState: number): WsStub {
  return { readyState, send: vi.fn() };
}

describe("sendFetchOlder", () => {
  it("OPEN socket: calls ws.send exactly once with JSON.stringify(payload) and returns true", () => {
    const ws = makeWs(WebSocket.OPEN);
    const payload: FetchOlderPayload = {
      type: "fetch_older",
      anchorEventId: "evt-100",
      count: 50,
    };

    const result = sendFetchOlder(ws as unknown as WebSocket, payload);

    expect(result).toBe(true);
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify(payload));
  });

  it("CONNECTING socket: does NOT call ws.send and returns false", () => {
    const ws = makeWs(WebSocket.CONNECTING);
    const payload: FetchOlderPayload = {
      type: "fetch_older",
      anchorEventId: "evt-200",
      count: 25,
    };

    const result = sendFetchOlder(ws as unknown as WebSocket, payload);

    expect(result).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("CLOSED socket: does NOT call ws.send and returns false", () => {
    const ws = makeWs(WebSocket.CLOSED);
    const payload: FetchOlderPayload = {
      type: "fetch_older",
      anchorEventId: "evt-300",
      count: 10,
    };

    const result = sendFetchOlder(ws as unknown as WebSocket, payload);

    expect(result).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("CLOSING socket: does NOT call ws.send and returns false", () => {
    const ws = makeWs(WebSocket.CLOSING);
    const payload: FetchOlderPayload = {
      type: "fetch_older",
      anchorEventId: "evt-400",
      count: 5,
    };

    const result = sendFetchOlder(ws as unknown as WebSocket, payload);

    expect(result).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("ws.send throws (mid-close): returns false and does not re-throw", () => {
    const ws: WsStub = {
      readyState: WebSocket.OPEN,
      send: vi.fn(() => {
        throw new Error("socket closed");
      }),
    };
    const payload: FetchOlderPayload = {
      type: "fetch_older",
      anchorEventId: "evt-500",
      count: 50,
    };

    const result = sendFetchOlder(ws as unknown as WebSocket, payload);

    expect(result).toBe(false);
    // send was still invoked (the throw is what forces the false return)
    expect(ws.send).toHaveBeenCalledTimes(1);
  });
});

describe("isFetchOlderBatchEvent", () => {
  // ─── true cases ─────────────────────────────────────────────────────────
  it("returns true for minimal shape: type + empty frames array", () => {
    expect(isFetchOlderBatchEvent({ type: "fetch_older_batch", frames: [] })).toBe(true);
  });

  it("returns true for populated frames + reachedBeginning", () => {
    expect(
      isFetchOlderBatchEvent({
        type: "fetch_older_batch",
        frames: [{}, {}],
        reachedBeginning: true,
      }),
    ).toBe(true);
  });

  it("returns true for empty frames + error field (server-signalled failure path)", () => {
    // Per Phase 43 CONTEXT.md § "Fetch failure handling" the server always emits
    // a fetch_older_batch event, error-shape included, so the client can clear
    // its loading indicator. The guard MUST narrow on this shape.
    expect(
      isFetchOlderBatchEvent({
        type: "fetch_older_batch",
        frames: [],
        error: "no session",
      }),
    ).toBe(true);
  });

  // ─── false cases ────────────────────────────────────────────────────────
  it("returns false for null", () => {
    expect(isFetchOlderBatchEvent(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isFetchOlderBatchEvent(undefined)).toBe(false);
  });

  it("returns false for a string", () => {
    expect(isFetchOlderBatchEvent("fetch_older_batch")).toBe(false);
  });

  it("returns false for a wrong-type object", () => {
    expect(isFetchOlderBatchEvent({ type: "message" })).toBe(false);
  });

  it("returns false when type matches but frames is missing", () => {
    expect(isFetchOlderBatchEvent({ type: "fetch_older_batch" })).toBe(false);
  });

  it("returns false when frames is present but not an array", () => {
    expect(
      isFetchOlderBatchEvent({ type: "fetch_older_batch", frames: "not-array" }),
    ).toBe(false);
  });
});
