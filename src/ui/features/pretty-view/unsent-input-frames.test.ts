import { describe, expect, it, vi } from "vitest";
import {
  outboundByteLength,
  queuedOutboundBytes,
  selectUnsentFrames,
  trackOutboundBytes,
  type InputFrameRecord,
} from "./unsent-input-frames";

function fakeSocket(): WebSocket {
  const ws = Object.create(WebSocket.prototype) as WebSocket;
  Object.defineProperty(ws, "send", { value: vi.fn(), writable: true });
  return ws;
}

function record(ws: WebSocket, mqid: string, start: number): InputFrameRecord {
  return { mqid, text: mqid, skipTagNeutralize: false, ws, start };
}

describe("unsent-input-frames", () => {
  it("counts UTF-8 bytes, not string length", () => {
    expect(outboundByteLength("abc")).toBe(3);
    expect(outboundByteLength("é")).toBe(2);
    expect(outboundByteLength(new Uint8Array(7))).toBe(7);
  });

  it("counts every frame queued through the wrapped send and still sends it", () => {
    const ws = fakeSocket();
    const raw = ws.send;
    trackOutboundBytes(ws);
    ws.send("hello");
    ws.send(new Uint8Array(10));
    expect(raw).toHaveBeenCalledTimes(2);
    expect(queuedOutboundBytes(ws)).toBe(15);
  });

  it("selects only frames that start at or past the transmitted point", () => {
    const ws = fakeSocket();
    trackOutboundBytes(ws);
    ws.send("x".repeat(100)); // a — bytes 0..100
    ws.send("x".repeat(50)); //  b — bytes 100..150
    ws.send("x".repeat(30)); //  c — bytes 150..180
    const records = [record(ws, "c", 150), record(ws, "a", 0), record(ws, "b", 100)];
    // 60 bytes still buffered → transmission reached byte 120: b went partly, c never.
    expect(selectUnsentFrames(records, ws, 60).map((r) => r.mqid)).toEqual(["c"]);
    // 80 buffered → reached byte 100: b and c never left, oldest first.
    expect(selectUnsentFrames(records, ws, 80).map((r) => r.mqid)).toEqual(["b", "c"]);
    // Nothing buffered → everything went out.
    expect(selectUnsentFrames(records, ws, 0)).toEqual([]);
  });

  it("selects nothing for an untracked socket", () => {
    const ws = { send: vi.fn() } as unknown as WebSocket;
    trackOutboundBytes(ws);
    ws.send("x");
    expect(queuedOutboundBytes(ws)).toBe(0);
    expect(selectUnsentFrames([record(ws, "a", 0)], ws, 1)).toEqual([]);
  });

  it("ignores records from another socket", () => {
    const ws = fakeSocket();
    const other = fakeSocket();
    trackOutboundBytes(ws);
    trackOutboundBytes(other);
    ws.send("x".repeat(10));
    expect(selectUnsentFrames([record(other, "o", 0)], ws, 10)).toEqual([]);
  });
});
