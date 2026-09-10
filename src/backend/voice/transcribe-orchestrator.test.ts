import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Phase 100 Plan 03 — transcribe-orchestrator unit tests.
 *
 * All sibling modules are mocked via vi.hoisted + vi.mock. The real semaphore
 * (semaphore.ts) is NOT mocked — it is used as-is so Test 6 can verify the
 * N=5 concurrency ceiling end-to-end.
 *
 * Test cases mirror the 8 behaviors from 100-03-PLAN.md Task 2:
 *   1. Happy path — 3 chunks all succeed, stitchChunks called with correct offsets
 *   2. Single-chunk edge case — 1 boundary, transcribeBufferWithItems called once
 *   3. Retry on transient failure — chunk 2 fails first attempt, succeeds on retry
 *   4. Double failure → gap marker [...]
 *   5. AccessDenied propagates unchanged (not swallowed into [...]); Pitfall 5
 *   6. Semaphore respects N=5 concurrency ceiling
 *   7. Structured log op names emitted at correct points
 *   8. Chunk offset assignment — startOffsetSec matches boundary startSec
 */

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------

const {
  probeDurationMock,
  scanSilenceGapsMock,
  parseSilenceGapsMock,
  computeChunkBoundariesMock,
  sliceFlacMock,
  transcribeBufferWithItemsMock,
  stitchChunksMock,
  isAwsAccessDeniedMock,
  loggerInfoMock,
  loggerWarnMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  probeDurationMock: vi.fn(),
  scanSilenceGapsMock: vi.fn(),
  parseSilenceGapsMock: vi.fn(),
  computeChunkBoundariesMock: vi.fn(),
  sliceFlacMock: vi.fn(),
  transcribeBufferWithItemsMock: vi.fn(),
  stitchChunksMock: vi.fn(),
  isAwsAccessDeniedMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock sibling modules — all except semaphore.ts (real semaphore for Test 6)
// ---------------------------------------------------------------------------

vi.mock("./transcribe-adapter.js", () => ({
  transcribeBufferWithItems: transcribeBufferWithItemsMock,
}));

vi.mock("./audio-chunker.js", () => ({
  probeDuration: probeDurationMock,
  scanSilenceGaps: scanSilenceGapsMock,
  parseSilenceGaps: parseSilenceGapsMock,
  computeChunkBoundaries: computeChunkBoundariesMock,
  sliceFlac: sliceFlacMock,
}));

vi.mock("./word-stitcher.js", () => ({
  stitchChunks: stitchChunksMock,
}));

vi.mock("./aws-errors.js", () => ({
  isAwsAccessDenied: isAwsAccessDeniedMock,
}));

vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
  },
}));

// Import AFTER vi.mock so the orchestrator picks up mocked deps.
const { transcribeBufferChunked } = await import("./transcribe-orchestrator.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Factory matching the AccessDenied error shape from voice.test.ts lines 249–256 */
function makeAccessDeniedError(): Error {
  const err = new Error("User is not authorized to perform this action");
  (err as { name: string }).name = "AccessDeniedException";
  (err as { $metadata: { httpStatusCode: number } }).$metadata = {
    httpStatusCode: 403,
  };
  return err;
}

/** Build N fake ChunkBoundary objects: [{startSec: 0, endSec: 10.5}, ...] */
function makeBoundaries(n: number): Array<{ startSec: number; endSec: number }> {
  return Array.from({ length: n }, (_, i) => ({
    startSec: i * 8,
    endSec: i * 8 + 10.5,
  }));
}

// ---------------------------------------------------------------------------
// beforeEach — reset all mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // isAwsAccessDenied returns false by default (not an access-denied error)
  isAwsAccessDeniedMock.mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("transcribe-orchestrator — transcribeBufferChunked", () => {
  it("Test 1: happy path — 3 chunks all succeed, stitchChunks called with correct chunk offsets", async () => {
    // 24-second audio → 3 chunks
    probeDurationMock.mockResolvedValue(24);
    scanSilenceGapsMock.mockResolvedValue("silence_start: 7.5\nsilence_end: 8.1 | silence_duration: 0.6\nsilence_start: 15.5\nsilence_end: 16.1 | silence_duration: 0.6\n");
    parseSilenceGapsMock.mockReturnValue([
      { startSec: 7.5, endSec: 8.1, durationSec: 0.6 },
      { startSec: 15.5, endSec: 16.1, durationSec: 0.6 },
    ]);
    const boundaries = makeBoundaries(3);
    computeChunkBoundariesMock.mockReturnValue(boundaries);

    sliceFlacMock
      .mockResolvedValueOnce(Buffer.from("chunk0"))
      .mockResolvedValueOnce(Buffer.from("chunk1"))
      .mockResolvedValueOnce(Buffer.from("chunk2"));

    transcribeBufferWithItemsMock
      .mockResolvedValueOnce({ transcript: "hello", items: [] })
      .mockResolvedValueOnce({ transcript: "world", items: [] })
      .mockResolvedValueOnce({ transcript: "foo", items: [] });

    stitchChunksMock.mockReturnValue("stitched result");

    const result = await transcribeBufferChunked(Buffer.from("fake flac"), 16000);

    expect(result).toBe("stitched result");
    expect(transcribeBufferWithItemsMock).toHaveBeenCalledTimes(3);

    // stitchChunks called once with 3 ChunkResult items
    expect(stitchChunksMock).toHaveBeenCalledTimes(1);
    const [chunkResults] = stitchChunksMock.mock.calls[0] as [Array<{ startOffsetSec: number }>, ...unknown[]];
    expect(chunkResults).toHaveLength(3);
    // Offsets must match boundary startSec values
    expect(chunkResults[0].startOffsetSec).toBe(boundaries[0].startSec);
    expect(chunkResults[1].startOffsetSec).toBe(boundaries[1].startSec);
    expect(chunkResults[2].startOffsetSec).toBe(boundaries[2].startSec);
  });

  it("Test 2: single-chunk edge case — 1 boundary, transcribeBufferWithItems called once", async () => {
    probeDurationMock.mockResolvedValue(6);
    scanSilenceGapsMock.mockResolvedValue("");
    parseSilenceGapsMock.mockReturnValue([]);
    computeChunkBoundariesMock.mockReturnValue(makeBoundaries(1));
    sliceFlacMock.mockResolvedValueOnce(Buffer.from("single-chunk"));
    transcribeBufferWithItemsMock.mockResolvedValueOnce({
      transcript: "single transcript",
      items: [],
    });
    stitchChunksMock.mockReturnValue("single transcript");

    const result = await transcribeBufferChunked(Buffer.from("short flac"), 16000);
    expect(transcribeBufferWithItemsMock).toHaveBeenCalledTimes(1);
    expect(result).toBe("single transcript");
  });

  it("Test 3: retry on transient failure — chunk index 2 fails first, succeeds on retry", async () => {
    probeDurationMock.mockResolvedValue(40);
    scanSilenceGapsMock.mockResolvedValue("");
    parseSilenceGapsMock.mockReturnValue([]);
    computeChunkBoundariesMock.mockReturnValue(makeBoundaries(5));
    sliceFlacMock.mockResolvedValue(Buffer.from("chunk"));

    const transientErr = new Error("Network glitch");
    // Chunks 0, 1 succeed; chunk 2 fails then succeeds; chunks 3, 4 succeed
    transcribeBufferWithItemsMock
      .mockResolvedValueOnce({ transcript: "chunk0", items: [] }) // chunk 0
      .mockResolvedValueOnce({ transcript: "chunk1", items: [] }) // chunk 1
      .mockRejectedValueOnce(transientErr)                         // chunk 2 first attempt
      .mockResolvedValueOnce({ transcript: "chunk2retry", items: [] }) // chunk 2 retry
      .mockResolvedValueOnce({ transcript: "chunk3", items: [] }) // chunk 3
      .mockResolvedValueOnce({ transcript: "chunk4", items: [] }); // chunk 4

    stitchChunksMock.mockReturnValue("full stitched");

    await transcribeBufferChunked(Buffer.from("long flac"), 16000);

    // 5 initial + 1 retry = 6 total calls
    expect(transcribeBufferWithItemsMock).toHaveBeenCalledTimes(6);

    // Retry log emitted with chunkIndex (the index of the failing chunk)
    const retryCall = loggerWarnMock.mock.calls.find((args: unknown[]) => {
      const meta = args[1] as Record<string, unknown> | undefined;
      return meta?.operation === "voice_transcribe_chunk_retry";
    });
    expect(retryCall).toBeDefined();
    const retryMeta = retryCall![1] as Record<string, unknown>;
    expect(retryMeta.chunkIndex).toBeDefined();
  });

  it("Test 4: double failure → gap marker [...]", async () => {
    probeDurationMock.mockResolvedValue(40);
    scanSilenceGapsMock.mockResolvedValue("");
    parseSilenceGapsMock.mockReturnValue([]);
    const boundaries = makeBoundaries(5);
    computeChunkBoundariesMock.mockReturnValue(boundaries);
    sliceFlacMock.mockResolvedValue(Buffer.from("chunk"));

    const transientErr = new Error("Persistent network error");
    // chunk 3 fails both attempts; others succeed
    transcribeBufferWithItemsMock
      .mockResolvedValueOnce({ transcript: "c0", items: [] })
      .mockResolvedValueOnce({ transcript: "c1", items: [] })
      .mockResolvedValueOnce({ transcript: "c2", items: [] })
      .mockRejectedValueOnce(transientErr) // chunk 3 attempt 1
      .mockRejectedValueOnce(transientErr) // chunk 3 attempt 2 (retry)
      .mockResolvedValueOnce({ transcript: "c4", items: [] });

    stitchChunksMock.mockReturnValue("result with gap");

    await transcribeBufferChunked(Buffer.from("long flac"), 16000);

    // gap-failed log for chunk 3
    const gapCall = loggerWarnMock.mock.calls.find((args: unknown[]) => {
      const meta = args[1] as Record<string, unknown> | undefined;
      return meta?.operation === "voice_transcribe_chunk_failed_gap";
    });
    expect(gapCall).toBeDefined();
    const gapMeta = gapCall![1] as Record<string, unknown>;
    expect(gapMeta.chunkIndex).toBe(3);

    // stitchChunks must receive a ChunkResult with transcript "[...]" for chunk 3
    const [chunkResults] = stitchChunksMock.mock.calls[0] as [Array<{ transcript: string; items: unknown[] }>, ...unknown[]];
    expect(chunkResults[3].transcript).toBe("[...]");
    expect(chunkResults[3].items).toEqual([]);
  });

  it("Test 5: AccessDenied propagates unchanged — no retry, no [...]  (Pitfall 5)", async () => {
    probeDurationMock.mockResolvedValue(16);
    scanSilenceGapsMock.mockResolvedValue("");
    parseSilenceGapsMock.mockReturnValue([]);
    computeChunkBoundariesMock.mockReturnValue(makeBoundaries(2));
    sliceFlacMock.mockResolvedValue(Buffer.from("chunk"));

    const accessErr = makeAccessDeniedError();
    // Return true only for the AccessDenied error
    isAwsAccessDeniedMock.mockImplementation((e: unknown) => e === accessErr);

    // chunk 1 throws AccessDenied on first attempt
    transcribeBufferWithItemsMock
      .mockResolvedValueOnce({ transcript: "c0", items: [] })
      .mockRejectedValueOnce(accessErr);

    await expect(transcribeBufferChunked(Buffer.from("flac"), 16000)).rejects.toBe(
      accessErr,
    );

    // transcribeBufferWithItems called at most twice (no retry for chunk 1)
    const callCount = transcribeBufferWithItemsMock.mock.calls.length;
    // chunk 0 may succeed; chunk 1 fails with AccessDenied — no retry for chunk 1
    // Due to Promise.all semantics and semaphore ordering, we assert ≤ 2 calls
    expect(callCount).toBeLessThanOrEqual(2);

    // stitchChunks must NOT have been called
    expect(stitchChunksMock).not.toHaveBeenCalled();
  });

  it("Test 6: semaphore respects N=5 concurrency ceiling (8 chunks dispatched)", async () => {
    probeDurationMock.mockResolvedValue(64);
    scanSilenceGapsMock.mockResolvedValue("");
    parseSilenceGapsMock.mockReturnValue([]);
    computeChunkBoundariesMock.mockReturnValue(makeBoundaries(8));
    sliceFlacMock.mockResolvedValue(Buffer.from("chunk"));

    let pending = 0;
    let maxSeen = 0;

    transcribeBufferWithItemsMock.mockImplementation(async () => {
      pending++;
      if (pending > maxSeen) maxSeen = pending;
      // Yield the event loop so other tasks can run while we "wait"
      await new Promise<void>((resolve) => setImmediate(resolve));
      pending--;
      return { transcript: "ok", items: [] };
    });

    stitchChunksMock.mockReturnValue("all done");

    await transcribeBufferChunked(Buffer.from("long flac"), 16000);

    expect(maxSeen).toBe(5);
  });

  it("Test 7: structured log op names emitted at correct points", async () => {
    const n = 3;
    probeDurationMock.mockResolvedValue(24);
    scanSilenceGapsMock.mockResolvedValue("");
    parseSilenceGapsMock.mockReturnValue([]);
    computeChunkBoundariesMock.mockReturnValue(makeBoundaries(n));
    sliceFlacMock.mockResolvedValue(Buffer.from("chunk"));
    transcribeBufferWithItemsMock.mockResolvedValue({ transcript: "hi", items: [] });
    stitchChunksMock.mockReturnValue("hi hi hi");

    await transcribeBufferChunked(Buffer.from("flac"), 16000);

    const infoCalls = loggerInfoMock.mock.calls as Array<[string, Record<string, unknown>]>;

    const startLogs = infoCalls.filter(([, meta]) => meta?.operation === "voice_transcribe_chunk_start");
    expect(startLogs).toHaveLength(n);

    const okLogs = infoCalls.filter(([, meta]) => meta?.operation === "voice_transcribe_chunk_ok");
    expect(okLogs).toHaveLength(n);

    const stitchLogs = infoCalls.filter(([, meta]) => meta?.operation === "voice_transcribe_stitch_complete");
    expect(stitchLogs).toHaveLength(1);
    expect(stitchLogs[0][1].chunkCount).toBe(n);
    expect(typeof stitchLogs[0][1].textLen).toBe("number");
  });

  it("Test 8: chunk offset assignment — startOffsetSec matches boundary startSec", async () => {
    const boundaries = [
      { startSec: 0, endSec: 10.5 },
      { startSec: 8, endSec: 18.5 },
      { startSec: 16, endSec: 26.5 },
    ];
    probeDurationMock.mockResolvedValue(26);
    scanSilenceGapsMock.mockResolvedValue("");
    parseSilenceGapsMock.mockReturnValue([]);
    computeChunkBoundariesMock.mockReturnValue(boundaries);
    sliceFlacMock.mockResolvedValue(Buffer.from("chunk"));
    transcribeBufferWithItemsMock.mockResolvedValue({ transcript: "word", items: [] });
    stitchChunksMock.mockReturnValue("word word word");

    await transcribeBufferChunked(Buffer.from("flac"), 16000);

    const [chunkResults] = stitchChunksMock.mock.calls[0] as [Array<{ startOffsetSec: number; endOffsetSec: number }>, ...unknown[]];
    expect(chunkResults[0].startOffsetSec).toBe(0);
    expect(chunkResults[1].startOffsetSec).toBe(8);
    expect(chunkResults[2].startOffsetSec).toBe(16);
  });
});
