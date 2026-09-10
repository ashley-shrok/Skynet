import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

/**
 * Phase 98 plan 04 — audio-transcode unit tests with mocked child_process.spawn.
 *
 * Real ffmpeg is NEVER invoked from unit tests — the `spawn` from
 * `node:child_process` is mocked to return a synthetic child-process
 * emitter that we drive from test bodies (emit chunk data on stdout,
 * emit close(0) for success, close(N) or error for failure paths).
 *
 * Assertion targets (from 98-04-PLAN.md § Task 4 <behavior>):
 *   1. webmToOggOpus spawns ffmpeg with the exact remux arg list
 *      (`-i pipe:0 -c:a copy -f ogg pipe:1`).
 *   2. webmToFlac spawns ffmpeg with the exact full-transcode fallback
 *      arg list (`-i pipe:0 -ar 16000 -ac 1 -f flac pipe:1`).
 *   3. Both feed the input buffer to stdin via `.end(buf)`.
 *   4. Both resolve to `Buffer.concat(stdout chunks)` on close code 0.
 *   5. Both reject on non-zero close code with an error including stderr text.
 *   6. Both reject on spawn 'error' event (e.g., ENOENT if ffmpeg is
 *      missing from the container — Pitfall 7 ship-blocker).
 *
 * Integration-lite testing against real ffmpeg + a real WebM sample from
 * `samples/clips/` is deliberately OUT OF SCOPE for this plan — Plan 06's
 * handleTranscribe integration path + Plan 01's ffmpeg-in-Dockerfile
 * coverage subsumes it.
 */

/**
 * Fake child_process object that mimics enough of the Node ChildProcess
 * shape for the transcode wrapper: stdin.end(buf), stdout/stderr data
 * events, and the top-level 'close' + 'error' events.
 */
class FakeStdin extends EventEmitter {
  end = vi.fn();
}

class FakeChildProcess extends EventEmitter {
  stdin = new FakeStdin();
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

// Import AFTER vi.mock so the transcode module picks up the mocked spawn.
const { webmToOggOpus, webmToFlac } = await import("./audio-transcode.js");

describe("audio-transcode.webmToOggOpus — success path", () => {
  let fake: FakeChildProcess;

  beforeEach(() => {
    fake = new FakeChildProcess();
    spawnMock.mockReset();
    spawnMock.mockReturnValueOnce(fake);
  });

  it("spawns ffmpeg with the exact remux arg list", async () => {
    const input = Buffer.from([0xa, 0xb, 0xc]);
    const promise = webmToOggOpus(input);
    // Drive the fake process — emit data + close(0) so the promise resolves.
    fake.stdout.emit("data", Buffer.from([0x1, 0x2]));
    fake.emit("close", 0);
    await promise;

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, args] = spawnMock.mock.calls[0];
    expect(bin).toBe("ffmpeg");
    expect(args).toEqual([
      "-i",
      "pipe:0",
      "-c:a",
      "copy",
      "-f",
      "ogg",
      "pipe:1",
    ]);
  });

  it("feeds the input buffer to stdin via .end(buf)", async () => {
    const input = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const promise = webmToOggOpus(input);
    fake.stdout.emit("data", Buffer.from([0]));
    fake.emit("close", 0);
    await promise;
    expect(fake.stdin.end).toHaveBeenCalledTimes(1);
    expect(fake.stdin.end).toHaveBeenCalledWith(input);
  });

  it("resolves to Buffer.concat(stdout chunks) on close code 0", async () => {
    const promise = webmToOggOpus(Buffer.from([1]));
    fake.stdout.emit("data", Buffer.from([0xaa, 0xbb]));
    fake.stdout.emit("data", Buffer.from([0xcc]));
    fake.emit("close", 0);
    const result = await promise;
    expect(result).toBeInstanceOf(Buffer);
    expect(result.equals(Buffer.from([0xaa, 0xbb, 0xcc]))).toBe(true);
  });
});

describe("audio-transcode.webmToOggOpus — failure paths", () => {
  let fake: FakeChildProcess;

  beforeEach(() => {
    fake = new FakeChildProcess();
    spawnMock.mockReset();
    spawnMock.mockReturnValueOnce(fake);
  });

  it("rejects with error including stderr text on non-zero exit", async () => {
    const promise = webmToOggOpus(Buffer.from([0]));
    fake.stderr.emit("data", Buffer.from("ffmpeg: invalid input"));
    fake.emit("close", 1);
    await expect(promise).rejects.toThrow(/ffmpeg: invalid input/);
    await expect(promise).rejects.toThrow(/1/);
  });

  it("rejects when the spawn emits an 'error' event (e.g., ENOENT when ffmpeg missing)", async () => {
    const promise = webmToOggOpus(Buffer.from([0]));
    const spawnErr = new Error("spawn ffmpeg ENOENT");
    fake.emit("error", spawnErr);
    await expect(promise).rejects.toBe(spawnErr);
  });
});

describe("audio-transcode.webmToFlac — fallback full-transcode path", () => {
  let fake: FakeChildProcess;

  beforeEach(() => {
    fake = new FakeChildProcess();
    spawnMock.mockReset();
    spawnMock.mockReturnValueOnce(fake);
  });

  it("spawns ffmpeg with the exact full-transcode arg list", async () => {
    const promise = webmToFlac(Buffer.from([0]));
    fake.stdout.emit("data", Buffer.from([0xff]));
    fake.emit("close", 0);
    await promise;

    const [bin, args] = spawnMock.mock.calls[0];
    expect(bin).toBe("ffmpeg");
    expect(args).toEqual([
      "-i",
      "pipe:0",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "flac",
      "pipe:1",
    ]);
  });

  it("resolves to Buffer.concat(stdout chunks) on close code 0", async () => {
    const promise = webmToFlac(Buffer.from([0]));
    fake.stdout.emit("data", Buffer.from([0x11, 0x22, 0x33]));
    fake.emit("close", 0);
    const result = await promise;
    expect(result.equals(Buffer.from([0x11, 0x22, 0x33]))).toBe(true);
  });

  it("rejects with error including stderr text on non-zero exit", async () => {
    const promise = webmToFlac(Buffer.from([0]));
    fake.stderr.emit("data", Buffer.from("flac encoder failed"));
    fake.emit("close", 2);
    await expect(promise).rejects.toThrow(/flac encoder failed/);
  });
});
