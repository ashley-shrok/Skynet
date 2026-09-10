import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

/**
 * Phase 100 plan 01 — audio-chunker unit tests with mocked child_process.spawn.
 *
 * Real ffmpeg/ffprobe are NEVER invoked — spawn is mocked to return a
 * synthetic FakeChildProcess. For sliceFlac we also mock runFfmpeg's internal
 * spawn (via the same node:child_process mock) because sliceFlac delegates
 * to runFfmpeg which calls spawn internally.
 *
 * Test matrix (from 100-01-PLAN.md § Task 2 <behavior>):
 *   sliceFlac:             Test 1 (exact argv), Test 2 (.toFixed(3) formatting)
 *   scanSilenceGaps:       Test 1 (argv + resolve on close 0), Test 2 (reject non-zero)
 *   probeDuration:         Test 1 (ffprobe argv + parse float), Test 2 (reject non-numeric)
 *   parseSilenceGaps:      Test 1 (2 pairs), Test 2 (unpaired trailing start),
 *                          Test 3 (empty / no silence lines)
 *   computeChunkBoundaries: Test 1 (silence-aware cut), Test 2 (fixed-window fallback),
 *                          Test 3 (last-chunk terminator), Test 4 (total coverage),
 *                          Test 5 (minimum-chunk guard / merge)
 */

/**
 * Fake child_process object mirroring the FakeChildProcess pattern from
 * audio-transcode.test.ts (lines 34-38).
 */
class FakeChildProcess extends EventEmitter {
  stdin = { end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

// Import AFTER vi.mock so the chunker module picks up the mocked spawn
// (and runFfmpeg in audio-transcode also picks up the same mock).
const { sliceFlac, scanSilenceGaps, probeDuration, parseSilenceGaps, computeChunkBoundaries } =
  await import("./audio-chunker.js");

// ---------------------------------------------------------------------------
// sliceFlac tests
// ---------------------------------------------------------------------------

describe("audio-chunker.sliceFlac", () => {
  let fake: FakeChildProcess;

  beforeEach(() => {
    fake = new FakeChildProcess();
    spawnMock.mockReset();
    spawnMock.mockReturnValueOnce(fake);
  });

  it("Test 1: spawns ffmpeg with exact argv (-f flac before -i pipe:0, -ss, -t)", async () => {
    const buf = Buffer.from([0xa]);
    const promise = sliceFlac(buf, 2.5, 8.0);
    fake.stdout.emit("data", Buffer.from([0x1]));
    fake.emit("close", 0);
    await promise;

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(bin).toBe("ffmpeg");
    expect(args).toEqual([
      "-f",
      "flac",
      "-i",
      "pipe:0",
      "-ss",
      "2.500",
      "-t",
      "8.000",
      "-f",
      "flac",
      "pipe:1",
    ]);
  });

  it("Test 2: startSec and durationSec are formatted with .toFixed(3)", async () => {
    const buf = Buffer.from([0xa]);
    const promise = sliceFlac(buf, 2, 8);
    fake.stdout.emit("data", Buffer.from([0x1]));
    fake.emit("close", 0);
    await promise;

    const args = spawnMock.mock.calls[0][1] as string[];
    const ssIdx = args.indexOf("-ss");
    const tIdx = args.indexOf("-t");
    expect(args[ssIdx + 1]).toBe("2.000");
    expect(args[tIdx + 1]).toBe("8.000");
  });
});

// ---------------------------------------------------------------------------
// scanSilenceGaps tests
// ---------------------------------------------------------------------------

describe("audio-chunker.scanSilenceGaps", () => {
  let fake: FakeChildProcess;

  beforeEach(() => {
    fake = new FakeChildProcess();
    spawnMock.mockReset();
    spawnMock.mockReturnValueOnce(fake);
  });

  it("Test 1: spawns ffmpeg with silencedetect argv and resolves with stderr on close 0", async () => {
    const buf = Buffer.from([0xb]);
    const promise = scanSilenceGaps(buf);

    const stderrText =
      "[silencedetect @ 0x] silence_start: 5\n" +
      "[silencedetect @ 0x] silence_end: 5.40006 | silence_duration: 0.400062\n";

    fake.stderr.emit("data", Buffer.from(stderrText));
    fake.emit("close", 0);
    const result = await promise;

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(bin).toBe("ffmpeg");
    expect(args).toEqual([
      "-f",
      "flac",
      "-i",
      "pipe:0",
      "-af",
      "silencedetect=n=-40dB:d=0.2",
      "-f",
      "null",
      "-",
    ]);
    expect(result).toBe(stderrText);
  });

  it("Test 2: rejects on non-zero close code with stderr in error message", async () => {
    const buf = Buffer.from([0xb]);
    const promise = scanSilenceGaps(buf);

    fake.stderr.emit("data", Buffer.from("some error"));
    fake.emit("close", 1);

    await expect(promise).rejects.toThrow(/1/);
    await expect(promise).rejects.toThrow(/some error/);
  });
});

// ---------------------------------------------------------------------------
// probeDuration tests
// ---------------------------------------------------------------------------

describe("audio-chunker.probeDuration", () => {
  let fake: FakeChildProcess;

  beforeEach(() => {
    fake = new FakeChildProcess();
    spawnMock.mockReset();
    spawnMock.mockReturnValueOnce(fake);
  });

  it("Test 1: spawns ffprobe with exact argv and parses stdout float", async () => {
    const buf = Buffer.from([0xc]);
    const promise = probeDuration(buf);

    fake.stdout.emit("data", Buffer.from("8.000000\n"));
    fake.emit("close", 0);
    const result = await promise;

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(bin).toBe("ffprobe");
    expect(args).toEqual([
      "-f",
      "flac",
      "-i",
      "pipe:0",
      "-v",
      "quiet",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
    ]);
    expect(result).toBe(8);
  });

  it("Test 2: rejects when stdout is not a parseable float", async () => {
    const buf = Buffer.from([0xc]);
    const promise = probeDuration(buf);

    fake.stdout.emit("data", Buffer.from("N/A\n"));
    fake.emit("close", 0);

    await expect(promise).rejects.toThrow(/non-numeric/);
  });
});

// ---------------------------------------------------------------------------
// parseSilenceGaps tests (pure function — no spawn mock needed)
// ---------------------------------------------------------------------------

describe("audio-chunker.parseSilenceGaps", () => {
  it("Test 1: extracts 2 fully-closed silence gap pairs from stderr", () => {
    const stderr =
      "[silencedetect @ 0x] silence_start: 5\n" +
      "[silencedetect @ 0x] silence_end: 5.40006 | silence_duration: 0.400062\n" +
      "[silencedetect @ 0x] silence_start: 12.4\n" +
      "[silencedetect @ 0x] silence_end: 12.7001 | silence_duration: 0.300063\n";

    const gaps = parseSilenceGaps(stderr);

    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toEqual({ startSec: 5, endSec: 5.40006, durationSec: 0.400062 });
    expect(gaps[1]).toEqual({ startSec: 12.4, endSec: 12.7001, durationSec: 0.300063 });
  });

  it("Test 2: discards unpaired trailing silence_start (audio ends in silence)", () => {
    const stderr =
      "[silencedetect @ 0x] silence_start: 5\n" +
      "[silencedetect @ 0x] silence_end: 5.40006 | silence_duration: 0.400062\n" +
      "[silencedetect @ 0x] silence_start: 30.5\n"; // trailing unpaired — discard

    const gaps = parseSilenceGaps(stderr);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].startSec).toBe(5);
  });

  it("Test 3: returns empty array when stderr contains no silence lines", () => {
    const stderr = "ffmpeg version 6.1.1\nInput #0, flac\n";
    const gaps = parseSilenceGaps(stderr);
    expect(gaps).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeChunkBoundaries tests (pure function — no spawn mock needed)
// ---------------------------------------------------------------------------

describe("audio-chunker.computeChunkBoundaries", () => {
  it("Test 1: silence-aware — cuts at silence gap midpoint when gap is near target", () => {
    // Silence gap at [7.5, 8.1] with targetChunkSec=8, overlapSec=2.5
    const gaps: Array<{ startSec: number; endSec: number; durationSec: number }> = [
      { startSec: 7.5, endSec: 8.1, durationSec: 0.6 },
    ];
    const boundaries = computeChunkBoundaries(20, gaps, 8, 2.5);

    // First cut: cursor=0, targetEnd=8, gap midpoint = (7.5+8.1)/2 = 7.8
    // endSec = 7.8 + 2.5 = 10.3
    expect(boundaries[0].startSec).toBe(0);
    expect(boundaries[0].endSec).toBeCloseTo(10.3, 5);
  });

  it("Test 2: fixed-window fallback — no silence gap produces cut at targetEnd", () => {
    const boundaries = computeChunkBoundaries(20, [], 8, 2.5);

    // First cut: cursor=0, targetEnd=8, no gap → cutAt=8, endSec = 8 + 2.5 = 10.5
    expect(boundaries[0].startSec).toBe(0);
    expect(boundaries[0].endSec).toBeCloseTo(10.5, 5);
  });

  it("Test 3: last-chunk terminator — final chunk endSec = totalDurationSec + overlapSec", () => {
    const boundaries = computeChunkBoundaries(20, [], 8, 2.5);
    const last = boundaries[boundaries.length - 1];

    // Last chunk endSec should be totalDuration + overlapSec = 20 + 2.5 = 22.5
    expect(last.endSec).toBeCloseTo(22.5, 5);
  });

  it("Test 4: total coverage — boundaries cover [0, totalDurationSec] with no gap", () => {
    // totalDuration=20, targetChunkSec=8, overlapSec=2.5, no silence
    // Expected cuts: 0→8→16, last chunk from 16 to 22.5
    const boundaries = computeChunkBoundaries(20, [], 8, 2.5);

    expect(boundaries.length).toBeGreaterThanOrEqual(2);
    expect(boundaries[0].startSec).toBe(0);

    // Verify the last boundary covers to the end.
    const last = boundaries[boundaries.length - 1];
    expect(last.endSec).toBeCloseTo(20 + 2.5, 5);

    // Verify each boundary's startSec matches the previous cutAt (no gaps between chunks).
    for (let i = 1; i < boundaries.length; i++) {
      // The previous endSec includes overlap; previous cutAt = prev.endSec - overlapSec
      const prevCutAt = boundaries[i - 1].endSec - 2.5;
      expect(boundaries[i].startSec).toBeCloseTo(prevCutAt, 5);
    }
  });

  it("Test 5: minimum-chunk guard — trailing chunk < minChunkSec merges into previous", () => {
    // totalDuration=9.5, targetChunkSec=8, overlapSec=2.5, minChunkSec=1.0
    // Without guard: chunk 0 [0, 10.5], then remaining cursor=8, totalDuration=9.5
    // → trailing audio length = 9.5 - 8 = 1.5s BUT if we set duration=8.8:
    // cursor after cut=8, remaining=0.8 < minChunkSec=1.0 → merge
    const boundaries = computeChunkBoundaries(8.8, [], 8, 2.5, 1.0);

    // The trailing chunk (8→8.8) is 0.8 s < 1.0 minChunkSec.
    // It should be merged into the first chunk, producing a single boundary.
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].startSec).toBe(0);
    expect(boundaries[0].endSec).toBeCloseTo(8.8 + 2.5, 5);
  });
});
