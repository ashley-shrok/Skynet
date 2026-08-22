// ─── Phase 47 Plan 03: fetch_older_range WS handler test suite ───────────────
//
// Drives `__handleFetchOlderRangeForTests` directly via the extracted-function
// test seam (mirrors the count-bounties.test.ts pattern at L47) rather than
// spinning up a real WebSocket server + ssh2. Mocks the Plan 01 range reader
// so we can inject line-batch fixtures + reject scenarios per test.
//
// Reader mock strategy: mock ONLY `readSessionFileRange` — do NOT mock
// `parseSessionLine` or the extracted `reshapeParsedLineToWireFrame` helper.
// The tests use REAL parse+reshape on fixture JSONL lines so the assertions
// verify actual wire-frame shapes (including the additive `line: number`
// field Plan 01 widened onto every per-turn wire type). Mocking parse would
// hide any parse/reshape drift between the streaming-tail path and the
// range-fetch path — the whole point of Plan 03 Hunk A is that both go
// through ONE shared function, and these tests verify that empirically.
//
// Wire-shape assertions target the LOCKED contract from Plan 01:
//   - Response frame type: "fetch_older_range_batch" (Phase 45 Test H
//     forbids the pre-Phase-45 short name; see PrettyView.hydration-cap
//     test for the LOCKED literal ban).
//   - Request payload type: "fetch_older_range" (same lock as above).
//   - Cursor: `beforeLine: number` (line-cursor, NOT eventId-cursor)
//   - Success shape: { type, messages, oldestLine, hasMore }
//   - Failure shape: { type, messages: [], oldestLine: 0, hasMore: false, error }
//
// Skip-frame filter policy (v2 refill, quick-260822-7no): if the first
// `readSessionFileRange` returns 20 lines with skips, the handler continues
// reading OLDER 20-line slices and accumulating non-skip wire frames until
// either the accumulator holds ≥20 non-skip frames OR the read cursor
// reaches startLine=1. Test 8 (rewritten) asserts the refill loop hits the
// 20-frame quota via a second read. Tests 9, 10, 11 lock the top-of-file,
// partial-refill, and first-slice-satisfies edge cases.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  FetchOlderRangeBatchEvent,
  MessageEvent as WireMessageEvent,
  MalformedLineEvent,
} from "../../ui/api/claude-session-api.js";

vi.mock("./session-file-range-reader.js", () => ({
  readSessionFileRange: vi.fn(),
}));

import { readSessionFileRange } from "./session-file-range-reader.js";
import { __handleFetchOlderRangeForTests } from "./claude-session-server.js";

// Typed shape for captured wire sends — every emit from the handler must
// match FetchOlderRangeBatchEvent per Plan 01's discriminated-union
// membership in ClaudeSessionServerEvent.
type SentFrame = FetchOlderRangeBatchEvent;

let sent: SentFrame[];
const wsStub = {
  send: vi.fn((raw: string) => {
    sent.push(JSON.parse(raw) as SentFrame);
  }),
};

beforeEach(() => {
  sent = [];
  wsStub.send.mockClear();
  vi.mocked(readSessionFileRange).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Line-fixture helpers ────────────────────────────────────────────────────
//
// These emit minimum-viable Claude-Code session-file JSONL turns that
// parseSessionLine (session-file-parser.ts:626) classifies as the intended
// `kind`. Sampled by reading session-file-parser.test.ts and matching
// the object shapes the parser recognizes.

/**
 * A well-formed user turn — parses to kind:"message" (role:"user"), reshapes
 * to wire `{ type: "message", role: "user", content, eventId, ts, line }`.
 */
function makeUserMessageLine(eventId: string, content: string): string {
  return JSON.stringify({
    type: "user",
    uuid: eventId,
    timestamp: "2026-08-20T00:00:00.000Z",
    message: {
      role: "user",
      content: content,
    },
  });
}

/**
 * A well-formed assistant turn — parses to kind:"message" (role:"assistant"),
 * reshapes to wire `{ type: "message", role: "assistant", content, eventId, ts, line }`.
 */
function makeAssistantMessageLine(eventId: string, content: string): string {
  return JSON.stringify({
    type: "assistant",
    uuid: eventId,
    timestamp: "2026-08-20T00:00:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: content }],
    },
  });
}

/**
 * A skip line — parseSessionLine returns kind:"skip" for `type: "system"`
 * (non-user/non-assistant), so the reshape helper returns null and the
 * handler filters it out of the accumulator (Test 9 policy lock: all-skip
 * range refills until startLine=1).
 */
function makeSkipLine(): string {
  return JSON.stringify({
    type: "system",
    uuid: "skip-uuid",
    content: "system-notice-ignored-by-parser",
  });
}

/**
 * A malformed line — parseSessionLine returns kind:"malformed", reshape
 * emits a `{ type: "malformed_line", bytes, eventId, ts, line }` wire frame
 * with `eventId` derived from a content-hash of the raw line.
 */
function makeMalformedLine(): string {
  return "{ not valid json"; // JSON.parse throws → kind:"malformed"
}

// ─── The handler-under-test's deps object (mirrors Plan 03 Hunk C signature) ─
const mockSshConn = { __label: "mock-ssh-conn" } as unknown as import("ssh2").Client;
const validDeps = {
  sshConn: mockSshConn,
  currentSessionFile: "/tmp/session.jsonl",
  currentHostId: 1,
};

// ─── Test suite ──────────────────────────────────────────────────────────────

describe("handleFetchOlderRange", () => {
  it("Test 1: well-formed request → single fetch_older_range_batch with parsed+reshaped messages, correct oldestLine, hasMore=true, line-number propagation", async () => {
    // Build 20 fixture lines representing lines 101..120 (client asked
    // beforeLine=121, count=20 → server slice = [101, 120] inclusive).
    const fixtureLines: string[] = [];
    for (let i = 0; i < 20; i++) {
      const eventId = `evt-${101 + i}`;
      fixtureLines.push(
        i % 2 === 0
          ? makeUserMessageLine(eventId, `user-msg-${101 + i}`)
          : makeAssistantMessageLine(eventId, `assistant-msg-${101 + i}`),
      );
    }
    vi.mocked(readSessionFileRange).mockResolvedValue({
      lines: fixtureLines,
      totalLines: 500,
    });

    await __handleFetchOlderRangeForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "fetch_older_range", beforeLine: 121, count: 20 },
      validDeps,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("fetch_older_range_batch");
    expect(sent[0].messages).toHaveLength(20);
    expect(sent[0].oldestLine).toBe(101);
    expect(sent[0].hasMore).toBe(true);
    expect(sent[0].error).toBeUndefined();

    // Reader was called with the correct clamped range args.
    const readerCalls = vi.mocked(readSessionFileRange).mock.calls;
    expect(readerCalls).toHaveLength(1);
    expect(readerCalls[0][1]).toBe("/tmp/session.jsonl"); // sessionFilePath
    expect(readerCalls[0][2]).toBe(101); // startLine
    expect(readerCalls[0][3]).toBe(20); // count

    // Line-number propagation: each reshaped frame's `line` field equals
    // its 1-indexed source line (101 + i). This is the assertion that
    // proves Hunk A + Hunk C wire the `line` argument through correctly.
    for (let i = 0; i < 20; i++) {
      const frame = sent[0].messages[i] as WireMessageEvent;
      expect(frame.type).toBe("message");
      expect(frame.line).toBe(101 + i);
    }
  });

  it("Test 2: missing sshConn OR missing currentSessionFile → error frame 'no active session'", async () => {
    // Sub-case A: sshConn === null.
    await __handleFetchOlderRangeForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "fetch_older_range", beforeLine: 100, count: 20 },
      { sshConn: null, currentSessionFile: "/tmp/x.jsonl", currentHostId: 1 },
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "fetch_older_range_batch",
      messages: [],
      oldestLine: 0,
      hasMore: false,
      error: "no active session",
    });
    expect(readSessionFileRange).not.toHaveBeenCalled();

    // Reset for sub-case B.
    sent = [];
    wsStub.send.mockClear();

    // Sub-case B: currentSessionFile === null.
    await __handleFetchOlderRangeForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "fetch_older_range", beforeLine: 100, count: 20 },
      { sshConn: mockSshConn, currentSessionFile: null, currentHostId: 1 },
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "fetch_older_range_batch",
      messages: [],
      oldestLine: 0,
      hasMore: false,
      error: "no active session",
    });
    expect(readSessionFileRange).not.toHaveBeenCalled();
  });

  it("Test 3: invalid beforeLine → error frame 'invalid beforeLine', reader NOT called", async () => {
    // Sub-case A: beforeLine is a string, not a number.
    await __handleFetchOlderRangeForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "fetch_older_range", beforeLine: "not-a-number", count: 20 } as unknown,
      validDeps,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].error).toMatch(/invalid beforeLine|invalid cursor/i);
    expect(sent[0].messages).toEqual([]);
    expect(sent[0].oldestLine).toBe(0);
    expect(sent[0].hasMore).toBe(false);
    expect(readSessionFileRange).not.toHaveBeenCalled();

    // Sub-case B: beforeLine === 0 (must be >= 1).
    sent = []; wsStub.send.mockClear();
    await __handleFetchOlderRangeForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "fetch_older_range", beforeLine: 0, count: 20 },
      validDeps,
    );
    expect(sent[0].error).toMatch(/invalid beforeLine|invalid cursor/i);
    expect(readSessionFileRange).not.toHaveBeenCalled();

    // Sub-case C: beforeLine negative.
    sent = []; wsStub.send.mockClear();
    await __handleFetchOlderRangeForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "fetch_older_range", beforeLine: -5, count: 20 },
      validDeps,
    );
    expect(sent[0].error).toMatch(/invalid beforeLine|invalid cursor/i);
    expect(readSessionFileRange).not.toHaveBeenCalled();
  });

  it("Test 4: count out of bounds (1,000,000) → error frame 'invalid count' (reject-not-clamp, matches Plan 01 reader-side 200-cap)", async () => {
    await __handleFetchOlderRangeForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "fetch_older_range", beforeLine: 500, count: 1_000_000 },
      validDeps,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].error).toMatch(/invalid count/i);
    expect(sent[0].messages).toEqual([]);
    expect(sent[0].oldestLine).toBe(0);
    expect(sent[0].hasMore).toBe(false);
    expect(readSessionFileRange).not.toHaveBeenCalled();
  });

  it("Test 5: cursor at start of file (beforeLine=15, count=20) → oldestLine=1, hasMore=false (client has reached beginning)", async () => {
    // Client asked beforeLine=15, count=20 → server clamps startLine to
    // max(1, 15-20) = 1 and rangeCount to min(20, 15-1) = 14. Reader
    // returns 14 lines representing lines 1-14.
    const fixtureLines: string[] = [];
    for (let i = 0; i < 14; i++) {
      fixtureLines.push(makeUserMessageLine(`evt-${1 + i}`, `msg-${1 + i}`));
    }
    vi.mocked(readSessionFileRange).mockResolvedValue({
      lines: fixtureLines,
      totalLines: 200,
    });

    await __handleFetchOlderRangeForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "fetch_older_range", beforeLine: 15, count: 20 },
      validDeps,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].oldestLine).toBe(1);
    expect(sent[0].hasMore).toBe(false); // reached start
    expect(sent[0].messages).toHaveLength(14);
    expect(sent[0].error).toBeUndefined();

    // Verify reader was called with clamped args.
    const readerCalls = vi.mocked(readSessionFileRange).mock.calls;
    expect(readerCalls).toHaveLength(1);
    expect(readerCalls[0][2]).toBe(1); // startLine clamped to 1
    expect(readerCalls[0][3]).toBe(14); // rangeCount = min(20, 15-1) = 14
  });

  it("Test 6: reader throws → handler catches, emits error frame, does NOT crash", async () => {
    vi.mocked(readSessionFileRange).mockRejectedValue(new Error("SSH exec timeout"));

    // The whole point of this test: the awaited call must NOT throw.
    // If handler propagates the reader's exception, this line throws
    // and vitest reports the test as failed. Handler must catch + emit.
    await expect(
      __handleFetchOlderRangeForTests(
        wsStub as unknown as import("ws").WebSocket,
        { type: "fetch_older_range", beforeLine: 100, count: 20 },
        validDeps,
      ),
    ).resolves.toBeUndefined();

    expect(sent).toHaveLength(1);
    expect(sent[0].error).toMatch(/SSH exec timeout|reader error|fetch failed/i);
    expect(sent[0].messages).toEqual([]);
    expect(sent[0].oldestLine).toBe(0);
    expect(sent[0].hasMore).toBe(false);
  });

  it("Test 7: malformed JSONL line inside range → reshaped as malformed_line variant at original position (chronological order preserved)", async () => {
    // Build 20 lines where index 5 is malformed. Handler must include
    // the malformed_line frame AT ITS ORIGINAL POSITION (index 5 in the
    // response messages array) — NOT append, NOT drop — because the
    // JSONL append-only-writer invariant means file-order = chronological
    // order, and the client's [...batch, ...prev] prepend depends on
    // chronological order.
    const fixtureLines: string[] = [];
    for (let i = 0; i < 20; i++) {
      if (i === 5) {
        fixtureLines.push(makeMalformedLine());
      } else {
        fixtureLines.push(makeUserMessageLine(`evt-${101 + i}`, `msg-${101 + i}`));
      }
    }
    vi.mocked(readSessionFileRange).mockResolvedValue({
      lines: fixtureLines,
      totalLines: 500,
    });

    await __handleFetchOlderRangeForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "fetch_older_range", beforeLine: 121, count: 20 },
      validDeps,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].messages).toHaveLength(20); // all 20 present (malformed included)

    // Position-5 frame is the malformed variant, carrying the source line 106.
    const malformedFrame = sent[0].messages[5] as MalformedLineEvent;
    expect(malformedFrame.type).toBe("malformed_line");
    expect(malformedFrame.line).toBe(106);
    expect(typeof malformedFrame.eventId).toBe("string");
    expect(malformedFrame.eventId.length).toBeGreaterThan(0);
    expect(typeof malformedFrame.bytes).toBe("number");

    // The other 19 positions are normal message frames at their correct lines.
    for (let i = 0; i < 20; i++) {
      if (i === 5) continue;
      const frame = sent[0].messages[i] as WireMessageEvent;
      expect(frame.type).toBe("message");
      expect(frame.line).toBe(101 + i);
    }
  });

  it("Test 8: skip frames inside range → refill loop reads next slice until accumulator holds 20 non-skip frames (v2 refill policy — quick-260822-7no)", async () => {
    // v2 policy: reader returns 20 lines with 3 skips at indices 3, 8, 15
    // on the FIRST call (startLine=101, count=20) → 17 message survivors.
    // Accumulator (17) < 20 AND currentBefore (101) > 1 → refill loop
    // reads batch 2 (startLine=81, count=20): 20 all-message lines.
    // After iteration 2 the accumulator is chronological oldest-first:
    //   [81..100, 101, 102, 103, 105, 106, 107, 108, 110, 111, 112, 113,
    //    114, 115, 117, 118, 119, 120]  ← length 37
    // Since accumulator.length (37) >= 20, loop exits.
    // messages = accumulator.slice(-20) → keeps the NEWEST 20 wire frames
    // (positions 17..36 = lines 98..120, contiguous with client cursor 121).
    // oldestLine = messages[0].line = 98 (first surviving frame's line
    // number, NOT lastStartLine — so client's next click seeks to a real
    // message, not a stretch of skips the reader would re-scan).
    // hasMore = oldestLine > 1 = true.
    // Reader is called exactly twice with the expected clamped args.
    const batch1Lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      if (i === 3 || i === 8 || i === 15) {
        batch1Lines.push(makeSkipLine());
      } else {
        batch1Lines.push(makeUserMessageLine(`evt-${101 + i}`, `msg-${101 + i}`));
      }
    }
    const batch2Lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      batch2Lines.push(makeUserMessageLine(`evt-${81 + i}`, `msg-${81 + i}`));
    }
    vi.mocked(readSessionFileRange)
      .mockResolvedValueOnce({ lines: batch1Lines, totalLines: 500 })
      .mockResolvedValueOnce({ lines: batch2Lines, totalLines: 500 });

    await __handleFetchOlderRangeForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "fetch_older_range", beforeLine: 121, count: 20 },
      validDeps,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("fetch_older_range_batch");
    expect(sent[0].messages).toHaveLength(20);
    // First surviving frame in newest-20 slice is line 98 (see accumulator
    // math in the comment above).
    expect(sent[0].oldestLine).toBe(98);
    expect(sent[0].hasMore).toBe(true);
    expect(sent[0].error).toBeUndefined();

    // Reader called exactly twice with the expected clamped args.
    const readerCalls = vi.mocked(readSessionFileRange).mock.calls;
    expect(readerCalls).toHaveLength(2);
    // Call 1: FIRST read (unchanged from v1) — startLine=101, count=20.
    expect(readerCalls[0][2]).toBe(101);
    expect(readerCalls[0][3]).toBe(20);
    // Call 2: refill iteration — startLine=81, count=20 (currentBefore=101 → nextStart=max(1,81)=81).
    expect(readerCalls[1][2]).toBe(81);
    expect(readerCalls[1][3]).toBe(20);

    // Every emitted frame is a message with contiguous line numbers 98..120
    // MINUS the two skip lines (109, 116) that fall within that window.
    // Skip at line 104 (index 3 of batch 1) is BEFORE line 98 so it does
    // not appear here. Expected line sequence in the emitted slice:
    //   98, 99, 100, 101, 102, 103, 105, 106, 107, 108, 110, 111, 112, 113,
    //   114, 115, 117, 118, 119, 120
    const expectedLines = [
      98, 99, 100, 101, 102, 103, 105, 106, 107, 108, 110, 111, 112, 113, 114,
      115, 117, 118, 119, 120,
    ];
    for (let i = 0; i < 20; i++) {
      const frame = sent[0].messages[i] as WireMessageEvent;
      expect(frame.type).toBe("message");
      expect(frame.line).toBe(expectedLines[i]);
    }
  });

  it("Test 9: all-skip file → refill until startLine=1, emit empty success (quick-260822-7no)", async () => {
    // Every read returns 20 skip lines → accumulator stays empty → refill
    // loop advances until nextStartLine hits 1. For beforeLine=101, count=20:
    //   FIRST read: startLine=81, count=20 (clamped in handler L1557-58)
    //   refill 1:   startLine=61, count=20
    //   refill 2:   startLine=41, count=20
    //   refill 3:   startLine=21, count=20
    //   refill 4:   startLine=1,  count=20 (nextStartLine=max(1,21-20)=1)
    // After iteration 5 currentBefore=1 → loop exits.
    // messages = [] (accumulator empty after slice), oldestLine = 1
    // (fallback = lastStartLine when accumulator empty), hasMore = false.
    const skipBatch = () => {
      const arr: string[] = [];
      for (let i = 0; i < 20; i++) arr.push(makeSkipLine());
      return { lines: arr, totalLines: 200 };
    };
    vi.mocked(readSessionFileRange)
      .mockResolvedValueOnce(skipBatch())
      .mockResolvedValueOnce(skipBatch())
      .mockResolvedValueOnce(skipBatch())
      .mockResolvedValueOnce(skipBatch())
      .mockResolvedValueOnce(skipBatch());

    await __handleFetchOlderRangeForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "fetch_older_range", beforeLine: 101, count: 20 },
      validDeps,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("fetch_older_range_batch");
    expect(sent[0].messages).toHaveLength(0);
    expect(sent[0].oldestLine).toBe(1);
    expect(sent[0].hasMore).toBe(false);
    expect(sent[0].error).toBeUndefined();

    // Reader called exactly 5 times with the expected refill sequence.
    const readerCalls = vi.mocked(readSessionFileRange).mock.calls;
    expect(readerCalls).toHaveLength(5);
    expect(readerCalls[0][2]).toBe(81); // FIRST read
    expect(readerCalls[1][2]).toBe(61);
    expect(readerCalls[2][2]).toBe(41);
    expect(readerCalls[3][2]).toBe(21);
    expect(readerCalls[4][2]).toBe(1); // last read clamps to 1
    expect(readerCalls[4][3]).toBe(20); // min(20, 21-1) = 20
  });

  it("Test 10: partial refill halts at top-of-file with fewer than 20 messages (quick-260822-7no)", async () => {
    // beforeLine=25, count=20.
    // FIRST read: startLine=max(1,25-20)=5, rangeCount=min(20,25-1)=20.
    //   Batch 1 (lines 5..24): 3 skips at indices 0 (line 5), 5 (line 10),
    //   10 (line 15) → 17 message survivors (lines 6..9, 11..14, 16..24).
    // Accumulator (17) < 20 AND currentBefore (5) > 1 → refill.
    // Refill 1: nextStartLine=max(1,5-20)=1, nextRangeCount=min(20,5-1)=4.
    //   Batch 2 (lines 1..4): 4 all-message lines.
    // After prepend accumulator = [1,2,3,4, 6,7,8,9,11,12,13,14,16,17,18,19,
    // 20,21,22,23,24] length 21. currentBefore = 1 → loop exits.
    // messages = accumulator.slice(-20) = positions 1..20 = [2,3,4, 6,7,8,9,
    //   11,12,13,14,16,17,18,19,20,21,22,23,24] length 20.
    // oldestLine = messages[0].line = 2. hasMore = 2 > 1 = true.
    const batch1Lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      if (i === 0 || i === 5 || i === 10) {
        batch1Lines.push(makeSkipLine());
      } else {
        batch1Lines.push(makeUserMessageLine(`evt-${5 + i}`, `msg-${5 + i}`));
      }
    }
    const batch2Lines: string[] = [];
    for (let i = 0; i < 4; i++) {
      batch2Lines.push(makeUserMessageLine(`evt-${1 + i}`, `msg-${1 + i}`));
    }
    vi.mocked(readSessionFileRange)
      .mockResolvedValueOnce({ lines: batch1Lines, totalLines: 24 })
      .mockResolvedValueOnce({ lines: batch2Lines, totalLines: 24 });

    await __handleFetchOlderRangeForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "fetch_older_range", beforeLine: 25, count: 20 },
      validDeps,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].messages).toHaveLength(20);
    expect(sent[0].oldestLine).toBe(2);
    expect(sent[0].hasMore).toBe(true);
    expect(sent[0].error).toBeUndefined();

    const readerCalls = vi.mocked(readSessionFileRange).mock.calls;
    expect(readerCalls).toHaveLength(2);
    expect(readerCalls[0][2]).toBe(5); // startLine
    expect(readerCalls[0][3]).toBe(20); // rangeCount
    expect(readerCalls[1][2]).toBe(1); // clamped to 1
    expect(readerCalls[1][3]).toBe(4); // min(20, 5-1) = 4

    // Verify exact line ordering matches the newest-20 slice math above.
    const expectedLines = [
      2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ];
    for (let i = 0; i < 20; i++) {
      const frame = sent[0].messages[i] as WireMessageEvent;
      expect(frame.type).toBe("message");
      expect(frame.line).toBe(expectedLines[i]);
    }
  });

  it("Test 11: 20 non-skip lines in FIRST slice → no refill, exactly one reader call (quick-260822-7no)", async () => {
    // Guards against the "always keep going" regression — the refill loop
    // MUST exit as soon as the accumulator hits 20 non-skip frames, even
    // when currentBefore > 1 (there are still older lines available).
    const fixtureLines: string[] = [];
    for (let i = 0; i < 20; i++) {
      fixtureLines.push(makeUserMessageLine(`evt-${101 + i}`, `msg-${101 + i}`));
    }
    vi.mocked(readSessionFileRange).mockResolvedValueOnce({
      lines: fixtureLines,
      totalLines: 500,
    });

    await __handleFetchOlderRangeForTests(
      wsStub as unknown as import("ws").WebSocket,
      { type: "fetch_older_range", beforeLine: 121, count: 20 },
      validDeps,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].messages).toHaveLength(20);
    expect(sent[0].oldestLine).toBe(101);
    expect(sent[0].hasMore).toBe(true);
    expect(sent[0].error).toBeUndefined();

    // Reader called exactly ONCE — no over-fetch.
    const readerCalls = vi.mocked(readSessionFileRange).mock.calls;
    expect(readerCalls).toHaveLength(1);
    expect(readerCalls[0][2]).toBe(101);
    expect(readerCalls[0][3]).toBe(20);
  });
});
