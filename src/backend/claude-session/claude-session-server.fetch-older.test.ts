// ─── fetch_older WS handler — Phase 43 Plan 43-04 ────────────────────
//
// Direct __handleFetchOlderForTests coverage exercising the extracted
// handler's full decision matrix. Mirrors the mock-and-drive shape of
// claude-session-server.count-bounties.test.ts + .role-file.test.ts.
//
// The handler under test resolves anchorEventId → line via
// `resolveEventIdToLine`, computes the [startLine, endLine] window as
// `[max(1, anchorLine - count), anchorLine - 1]`, calls
// `readSessionFileRange` for the slice, and emits ONE
// `{ type: "fetch_older_batch", frames, reachedBeginning?, error? }` frame
// through `ws.send`.
//
// Test map (Task 1 <behavior>):
//   1. happy path — resolver 200, count 50 → range(150,199), 3 frames back
//   2. anchor-not-found — resolver null → NO range call, error frame
//   3. invalid anchorEventId ("" / missing / non-string) → NEITHER call, error
//   4. invalid count (0, -1, 100000) → NEITHER call, error
//   5. startLine clamps at 1 → reachedBeginning: true
//   6. readSessionFileRange returns null → error "read-failed"
//   7. no sshConn OR no currentSessionFile → error "no-session", no exec
//   8. handler throws internally → error frame, never bubbles

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./session-file-range.js", () => ({
  resolveEventIdToLine: vi.fn(),
  readSessionFileRange: vi.fn(),
}));

import {
  resolveEventIdToLine,
  readSessionFileRange,
} from "./session-file-range.js";
import { __handleFetchOlderForTests } from "./claude-session-server.js";

// ──────────────────────────────────────────────────────────────────────
// Wire types + ws stub (mirror the count-bounties / role-file shape)
// ──────────────────────────────────────────────────────────────────────

type FetchOlderBatchMsg = {
  type: "fetch_older_batch";
  frames: unknown[];
  reachedBeginning?: boolean;
  error?: string;
};

let sent: FetchOlderBatchMsg[];
const wsStub = {
  send: vi.fn((raw: string) => {
    sent.push(JSON.parse(raw) as FetchOlderBatchMsg);
  }),
};

// A sentinel "conn" we can === against — the handler never actually calls
// anything on it because both range helpers are mocked.
const fakeConn = { __label: "sess-conn" } as unknown as import("ssh2").Client;

beforeEach(() => {
  sent = [];
  wsStub.send.mockClear();
  vi.mocked(resolveEventIdToLine).mockReset();
  vi.mocked(readSessionFileRange).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────

describe("handleFetchOlder", () => {
  it("test 1: happy path — resolves anchor, reads range, emits fetch_older_batch with frames", async () => {
    vi.mocked(resolveEventIdToLine).mockResolvedValue(200);
    // Three fake emission frames — shape doesn't matter for this test, the
    // handler forwards them as `frames` verbatim.
    const fakeFrames = [
      { kind: "message", eventId: "e-150" },
      { kind: "message", eventId: "e-151" },
      { kind: "image", eventId: "e-152" },
    ];
    vi.mocked(readSessionFileRange).mockResolvedValue(
      fakeFrames as never,
    );

    await __handleFetchOlderForTests({
      ws: wsStub as unknown as import("ws").WebSocket,
      msg: { type: "fetch_older", anchorEventId: "evt-100", count: 50 },
      sshConn: fakeConn,
      currentSessionFile: "/tmp/sess.jsonl",
    });

    // resolveEventIdToLine called with (fakeConn, path, eventId)
    expect(resolveEventIdToLine).toHaveBeenCalledTimes(1);
    expect(resolveEventIdToLine).toHaveBeenCalledWith(
      fakeConn,
      "/tmp/sess.jsonl",
      "evt-100",
    );

    // readSessionFileRange called with (fakeConn, path, 150, 199)
    // startLine = max(1, 200 - 50) = 150; endLine = 200 - 1 = 199
    expect(readSessionFileRange).toHaveBeenCalledTimes(1);
    expect(readSessionFileRange).toHaveBeenCalledWith(
      fakeConn,
      "/tmp/sess.jsonl",
      150,
      199,
    );

    // ws.send received exactly one fetch_older_batch frame
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("fetch_older_batch");
    expect(sent[0].frames).toEqual(fakeFrames);
    // reachedBeginning is false when startLine > 1
    expect(sent[0].reachedBeginning).toBe(false);
    expect(sent[0].error).toBeUndefined();
  });

  it("test 2: anchor-not-found — resolver returns null, NO range read, error frame", async () => {
    vi.mocked(resolveEventIdToLine).mockResolvedValue(null);

    await __handleFetchOlderForTests({
      ws: wsStub as unknown as import("ws").WebSocket,
      msg: { type: "fetch_older", anchorEventId: "evt-missing", count: 50 },
      sshConn: fakeConn,
      currentSessionFile: "/tmp/sess.jsonl",
    });

    expect(resolveEventIdToLine).toHaveBeenCalledTimes(1);
    // Range read MUST NOT fire if anchor is unresolved.
    expect(readSessionFileRange).not.toHaveBeenCalled();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "fetch_older_batch",
      frames: [],
      error: "anchor-not-found",
    });
  });

  it("test 3a: invalid anchorEventId (empty string) rejects without exec", async () => {
    await __handleFetchOlderForTests({
      ws: wsStub as unknown as import("ws").WebSocket,
      msg: { type: "fetch_older", anchorEventId: "", count: 50 },
      sshConn: fakeConn,
      currentSessionFile: "/tmp/sess.jsonl",
    });

    expect(resolveEventIdToLine).not.toHaveBeenCalled();
    expect(readSessionFileRange).not.toHaveBeenCalled();

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("fetch_older_batch");
    expect(sent[0].frames).toEqual([]);
    expect(sent[0].error).toBeTruthy();
    expect(typeof sent[0].error).toBe("string");
  });

  it("test 3b: invalid anchorEventId (missing field) rejects without exec", async () => {
    await __handleFetchOlderForTests({
      ws: wsStub as unknown as import("ws").WebSocket,
      msg: { type: "fetch_older", count: 50 },
      sshConn: fakeConn,
      currentSessionFile: "/tmp/sess.jsonl",
    });

    expect(resolveEventIdToLine).not.toHaveBeenCalled();
    expect(readSessionFileRange).not.toHaveBeenCalled();
    expect(sent[0].type).toBe("fetch_older_batch");
    expect(sent[0].error).toBeTruthy();
  });

  it("test 3c: invalid anchorEventId (non-string) rejects without exec", async () => {
    await __handleFetchOlderForTests({
      ws: wsStub as unknown as import("ws").WebSocket,
      msg: { type: "fetch_older", anchorEventId: 12345, count: 50 },
      sshConn: fakeConn,
      currentSessionFile: "/tmp/sess.jsonl",
    });

    expect(resolveEventIdToLine).not.toHaveBeenCalled();
    expect(readSessionFileRange).not.toHaveBeenCalled();
    expect(sent[0].type).toBe("fetch_older_batch");
    expect(sent[0].error).toBeTruthy();
  });

  it("test 4a: invalid count (0) rejects without exec", async () => {
    await __handleFetchOlderForTests({
      ws: wsStub as unknown as import("ws").WebSocket,
      msg: { type: "fetch_older", anchorEventId: "evt-100", count: 0 },
      sshConn: fakeConn,
      currentSessionFile: "/tmp/sess.jsonl",
    });
    expect(resolveEventIdToLine).not.toHaveBeenCalled();
    expect(readSessionFileRange).not.toHaveBeenCalled();
    expect(sent[0].type).toBe("fetch_older_batch");
    expect(sent[0].error).toBeTruthy();
  });

  it("test 4b: invalid count (-1) rejects without exec", async () => {
    await __handleFetchOlderForTests({
      ws: wsStub as unknown as import("ws").WebSocket,
      msg: { type: "fetch_older", anchorEventId: "evt-100", count: -1 },
      sshConn: fakeConn,
      currentSessionFile: "/tmp/sess.jsonl",
    });
    expect(resolveEventIdToLine).not.toHaveBeenCalled();
    expect(readSessionFileRange).not.toHaveBeenCalled();
    expect(sent[0].error).toBeTruthy();
  });

  it("test 4c: invalid count (100000, over cap) rejects without exec", async () => {
    await __handleFetchOlderForTests({
      ws: wsStub as unknown as import("ws").WebSocket,
      msg: { type: "fetch_older", anchorEventId: "evt-100", count: 100000 },
      sshConn: fakeConn,
      currentSessionFile: "/tmp/sess.jsonl",
    });
    expect(resolveEventIdToLine).not.toHaveBeenCalled();
    expect(readSessionFileRange).not.toHaveBeenCalled();
    expect(sent[0].error).toBeTruthy();
  });

  it("test 5: startLine clamps at 1 → reachedBeginning: true", async () => {
    // Anchor at line 30, count 50 → startLine = max(1, 30-50) = 1;
    // endLine = 29.
    vi.mocked(resolveEventIdToLine).mockResolvedValue(30);
    vi.mocked(readSessionFileRange).mockResolvedValue([
      { kind: "message", eventId: "e-1" },
    ] as never);

    await __handleFetchOlderForTests({
      ws: wsStub as unknown as import("ws").WebSocket,
      msg: { type: "fetch_older", anchorEventId: "evt-30", count: 50 },
      sshConn: fakeConn,
      currentSessionFile: "/tmp/sess.jsonl",
    });

    expect(readSessionFileRange).toHaveBeenCalledWith(
      fakeConn,
      "/tmp/sess.jsonl",
      1,
      29,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("fetch_older_batch");
    expect(sent[0].reachedBeginning).toBe(true);
    expect(sent[0].error).toBeUndefined();
  });

  it("test 6: readSessionFileRange returns null → error 'read-failed'", async () => {
    vi.mocked(resolveEventIdToLine).mockResolvedValue(200);
    vi.mocked(readSessionFileRange).mockResolvedValue(null);

    await __handleFetchOlderForTests({
      ws: wsStub as unknown as import("ws").WebSocket,
      msg: { type: "fetch_older", anchorEventId: "evt-100", count: 50 },
      sshConn: fakeConn,
      currentSessionFile: "/tmp/sess.jsonl",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "fetch_older_batch",
      frames: [],
      error: "read-failed",
    });
  });

  it("test 7a: sshConn null → error 'no-session', no exec", async () => {
    await __handleFetchOlderForTests({
      ws: wsStub as unknown as import("ws").WebSocket,
      msg: { type: "fetch_older", anchorEventId: "evt-100", count: 50 },
      sshConn: null,
      currentSessionFile: "/tmp/sess.jsonl",
    });
    expect(resolveEventIdToLine).not.toHaveBeenCalled();
    expect(readSessionFileRange).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "fetch_older_batch",
      frames: [],
      error: "no-session",
    });
  });

  it("test 7b: currentSessionFile null → error 'no-session', no exec", async () => {
    await __handleFetchOlderForTests({
      ws: wsStub as unknown as import("ws").WebSocket,
      msg: { type: "fetch_older", anchorEventId: "evt-100", count: 50 },
      sshConn: fakeConn,
      currentSessionFile: null,
    });
    expect(resolveEventIdToLine).not.toHaveBeenCalled();
    expect(readSessionFileRange).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "fetch_older_batch",
      frames: [],
      error: "no-session",
    });
  });

  it("test 8: handler-thrown resolver → error 'handler-threw', never bubbles", async () => {
    vi.mocked(resolveEventIdToLine).mockImplementation(() => {
      throw new Error("simulated internal blowup");
    });

    // MUST NOT throw upward — the handler catches everything.
    await expect(
      __handleFetchOlderForTests({
        ws: wsStub as unknown as import("ws").WebSocket,
        msg: { type: "fetch_older", anchorEventId: "evt-100", count: 50 },
        sshConn: fakeConn,
        currentSessionFile: "/tmp/sess.jsonl",
      }),
    ).resolves.toBeUndefined();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "fetch_older_batch",
      frames: [],
      error: "handler-threw",
    });
  });
});
