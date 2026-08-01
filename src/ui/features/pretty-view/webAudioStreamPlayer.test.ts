/**
 * Unit tests for webAudioStreamPlayer.ts — Web Audio API streaming player factory.
 *
 * Tests use a mocked AudioContext (via vi.stubGlobal) so they run in jsdom
 * without any real audio hardware. The mock records calls to createBuffer,
 * createBufferSource, source.start, source.stop, and exposes a way to
 * synthetically fire source.onended.
 *
 * Reference: 19-CONTEXT.md § Frontend player, § Cross-bubble Stop, § Error handling.
 * Phase 19, Plan 04 (patch #237).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWebAudioStreamPlayer } from "./webAudioStreamPlayer";

// ─── Mock AudioContext infrastructure ────────────────────────────────────────

interface MockSource {
  buffer: unknown;
  onended: (() => void) | null;
  _started: boolean;
  _startedAt: number;
  _stopped: boolean;
  connected: boolean;
  start(when: number): void;
  stop(): void;
  connect(dest: unknown): void;
}

interface MockAudioBuffer {
  channels: number;
  frames: number;
  sampleRate: number;
  _channelData: Float32Array[];
  getChannelData(ch: number): Float32Array;
  duration: number;
}

interface MockContext {
  currentTime: number;
  state: "running" | "closed";
  destination: object;
  sources: MockSource[];
  buffers: MockAudioBuffer[];
  createBuffer(ch: number, fr: number, sr: number): MockAudioBuffer;
  createBufferSource(): MockSource;
  close(): Promise<void>;
  _closed: boolean;
}

let mockCtx: MockContext;
let ctxInstances: MockContext[] = [];

function makeMockContext(): MockContext {
  const ctx: MockContext = {
    currentTime: 0,
    state: "running",
    destination: {},
    sources: [],
    buffers: [],
    _closed: false,

    createBuffer(ch: number, fr: number, sr: number): MockAudioBuffer {
      const channelData = Array.from({ length: ch }, () => new Float32Array(fr));
      const buf: MockAudioBuffer = {
        channels: ch,
        frames: fr,
        sampleRate: sr,
        _channelData: channelData,
        getChannelData(c: number) {
          return channelData[c];
        },
        get duration() {
          return sr > 0 ? fr / sr : 0;
        },
      };
      ctx.buffers.push(buf);
      return buf;
    },

    createBufferSource(): MockSource {
      const source: MockSource = {
        buffer: null,
        onended: null,
        _started: false,
        _startedAt: 0,
        _stopped: false,
        connected: false,
        start(when: number) {
          this._started = true;
          this._startedAt = when;
        },
        stop() {
          if (this._stopped) throw new DOMException("already stopped", "InvalidStateError");
          this._stopped = true;
        },
        connect(_dest: unknown) {
          this.connected = true;
        },
      };
      ctx.sources.push(source);
      return source;
    },

    close(): Promise<void> {
      ctx.state = "closed";
      ctx._closed = true;
      return Promise.resolve();
    },
  };
  return ctx;
}

beforeEach(() => {
  ctxInstances = [];
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        mockCtx = makeMockContext();
        ctxInstances.push(mockCtx);
        return mockCtx;
      }
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── Helper: build a valid RIFF WAV chunk (44-byte header + pcmBytes) ────────

function makeWavChunk(
  pcmBytes: Uint8Array,
  opts: { channels?: number; sampleRate?: number; bitDepth?: number } = {},
): Uint8Array {
  const { channels = 1, sampleRate = 24000, bitDepth = 16 } = opts;
  const buf = new Uint8Array(44 + pcmBytes.byteLength);
  const dv = new DataView(buf.buffer);
  // "RIFF"
  buf.set([0x52, 0x49, 0x46, 0x46], 0);
  dv.setUint32(4, 0xffffffff, true); // streaming sentinel
  // "WAVE"
  buf.set([0x57, 0x41, 0x56, 0x45], 8);
  // "fmt "
  buf.set([0x66, 0x6d, 0x74, 0x20], 12);
  dv.setUint32(16, 16, true); // fmt chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, (sampleRate * channels * bitDepth) / 8, true);
  dv.setUint16(32, (channels * bitDepth) / 8, true);
  dv.setUint16(34, bitDepth, true);
  // "data"
  buf.set([0x64, 0x61, 0x74, 0x61], 36);
  dv.setUint32(40, 0xffffffff, true); // streaming sentinel
  buf.set(pcmBytes, 44);
  return buf;
}

/** Build a mock Response with a ReadableStream containing the given chunks. */
function makeMockResponse(chunks: Uint8Array[], ok = true, status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "Content-Type": "audio/wav" },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createWebAudioStreamPlayer", () => {
  it("Test 1 — play() creates AudioBuffer + AudioBufferSourceNode for a single-chunk response", async () => {
    // 4 PCM bytes = 2 mono frames at 16-bit
    const pcm = new Uint8Array([0x00, 0x00, 0xff, 0x7f]);
    const chunk = makeWavChunk(pcm, { channels: 1, sampleRate: 24000, bitDepth: 16 });
    const player = createWebAudioStreamPlayer({});
    const response = makeMockResponse([chunk]);

    await player.play(response);

    expect(ctxInstances).toHaveLength(1);
    const ctx = ctxInstances[0];
    expect(ctx.buffers).toHaveLength(1);
    expect(ctx.buffers[0].channels).toBe(1);
    expect(ctx.buffers[0].frames).toBe(2);
    expect(ctx.buffers[0].sampleRate).toBe(24000);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]._started).toBe(true);
    expect(ctx.sources[0]._startedAt).toBeGreaterThanOrEqual(ctx.currentTime);
  });

  it("Test 2 — play() schedules multiple chunks with monotonically non-decreasing start times", async () => {
    // 3 chunks: first has header + PCM, next two are pure PCM
    const pcm = new Uint8Array([0x00, 0x00, 0xff, 0x7f]);
    const firstChunk = makeWavChunk(pcm);
    const secondChunk = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    const thirdChunk = new Uint8Array([0x00, 0x00, 0x00, 0x00]);

    const player = createWebAudioStreamPlayer({});
    const response = makeMockResponse([firstChunk, secondChunk, thirdChunk]);

    await player.play(response);

    const ctx = ctxInstances[0];
    expect(ctx.sources).toHaveLength(3);
    // Start times must be monotonically non-decreasing
    for (let i = 1; i < ctx.sources.length; i++) {
      expect(ctx.sources[i]._startedAt).toBeGreaterThanOrEqual(ctx.sources[i - 1]._startedAt);
    }
  });

  it("Test 3 — play() fires onEnded only after BOTH reader done AND all sources ended", async () => {
    const onEnded = vi.fn();
    const pcm = new Uint8Array([0x00, 0x00, 0xff, 0x7f]);
    const chunk = makeWavChunk(pcm);

    const player = createWebAudioStreamPlayer({ onEnded });
    const response = makeMockResponse([chunk]);

    // Reader is synchronous, so after play() returns, reader is done but
    // the source's onended has not fired yet (it fires asynchronously via AudioContext).
    await player.play(response);

    // At this point: reader done = true, but source.onended has NOT fired.
    // onEnded must NOT have been called yet.
    expect(onEnded).not.toHaveBeenCalled();

    // Now synthetically fire the source's onended callback.
    const ctx = ctxInstances[0];
    expect(ctx.sources).toHaveLength(1);
    ctx.sources[0].onended?.();

    // Now both conditions are met: onEnded should have fired exactly once.
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("Test 4 — stop() stops all sources, closes AudioContext, and is idempotent", async () => {
    const onEnded = vi.fn();
    const pcm = new Uint8Array([0x00, 0x00, 0xff, 0x7f, 0x00, 0x00, 0x00, 0x00]);
    const chunk = makeWavChunk(pcm);

    const player = createWebAudioStreamPlayer({ onEnded });
    const response = makeMockResponse([chunk]);

    await player.play(response);

    const ctx = ctxInstances[0];
    expect(ctx.sources.length).toBeGreaterThan(0);

    // Stop the player before onended fires.
    player.stop();

    // All sources must be stopped.
    for (const source of ctx.sources) {
      expect(source._stopped).toBe(true);
    }
    // AudioContext must be closed.
    expect(ctx._closed).toBe(true);

    // onEnded must NOT be called — stop() is an external teardown, not a natural end.
    expect(onEnded).not.toHaveBeenCalled();

    // Calling stop() again must be a no-op (idempotent — no throw, no double-close).
    expect(() => player.stop()).not.toThrow();
  });

  it("Test 5 — non-ok response fires onError and does NOT create an AudioContext", async () => {
    const onError = vi.fn();
    const player = createWebAudioStreamPlayer({ onError });
    const response = makeMockResponse([], false, 503);

    await player.play(response);

    // onError must have been called with an Error mentioning the status code.
    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0][0] as Error;
    expect(err.message).toMatch(/503/);

    // No AudioContext was created (resource-leak prevention).
    expect(ctxInstances).toHaveLength(0);
  });

  it("Test 6 — mid-stream reader error fires onError and stops all created sources", async () => {
    const onError = vi.fn();
    const pcm = new Uint8Array([0x00, 0x00, 0xff, 0x7f]);
    const firstChunk = makeWavChunk(pcm);

    // Simulate a mid-stream error by mocking the reader directly.
    // This avoids the unhandled-rejection warning that ReadableStream controller.error()
    // emits at the Node.js stream-internals level (a jsdom/Node.js quirk: the error
    // propagates both via reader.read() rejection AND as a separate uncaught promise).
    let readCount = 0;
    const fakeReader = {
      read(): Promise<{ done: boolean; value?: Uint8Array }> {
        readCount++;
        if (readCount === 1) {
          return Promise.resolve({ done: false, value: firstChunk });
        }
        // Second read: reject to simulate a network blip mid-stream.
        return Promise.reject(new Error("network blip"));
      },
      cancel(): Promise<void> {
        return Promise.resolve();
      },
      releaseLock(): void {},
    };

    // Build a mock response with a body that returns our fake reader.
    const fakeBody = {
      getReader(): typeof fakeReader {
        return fakeReader;
      },
    };
    const response = {
      ok: true,
      status: 200,
      body: fakeBody,
    } as unknown as Response;

    const player = createWebAudioStreamPlayer({ onError });
    await player.play(response).catch(() => {});

    // onError must have been called.
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toMatch(/network blip/);

    // All created sources must be stopped after teardown.
    if (ctxInstances.length > 0) {
      const ctx = ctxInstances[0];
      for (const source of ctx.sources) {
        expect(source._stopped).toBe(true);
      }
      // AudioContext must be closed.
      expect(ctx._closed).toBe(true);
    }
  });

  it("Test 7 — split header across chunks: player accumulates bytes before parsing", async () => {
    // Split the 44-byte header: first chunk has 20 bytes, second has remaining 24 + 4 PCM bytes.
    const fullChunk = makeWavChunk(new Uint8Array([0x00, 0x00, 0xff, 0x7f]));
    const firstPart = fullChunk.slice(0, 20);
    const secondPart = fullChunk.slice(20);

    const player = createWebAudioStreamPlayer({});
    const response = makeMockResponse([firstPart, secondPart]);

    await player.play(response);

    // Player must have correctly assembled the header and scheduled at least one source.
    expect(ctxInstances).toHaveLength(1);
    const ctx = ctxInstances[0];
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]._started).toBe(true);
    // Sample rate must be 24000 (from the assembled header).
    expect(ctx.buffers[0].sampleRate).toBe(24000);
  });

  it("Test 8 — chunks with odd PCM byte counts carry the trailing byte over (frame alignment regression, patch #238)", async () => {
    // Regression test for the patch #237 ship-day bug: HTTP chunked-transfer
    // chunks can arrive at arbitrary byte boundaries. When a chunk's PCM
    // portion has an odd byte count (mono 16-bit = 2 bytes/frame), the naive
    // decodePcmChunk floor-divides and drops the trailing byte. The next
    // chunk then starts on a misaligned byte, and every subsequent Int16
    // sample straddles two adjacent samples in the byte stream. Symptom:
    // audio starts clean, drifts into gibberish English, then into static.
    //
    // Fix: pcmRemainder carry-over in play(). This test proves the fix.
    //
    // Setup: 4 mono 16-bit samples across two chunks, with the first PCM
    // chunk containing an odd byte count (3 bytes). Values chosen to be
    // asymmetric so any misalignment produces obviously-wrong Float32 output.
    // Samples: 0x1122, 0x3344, 0x5566, 0x7788 (little-endian byte pairs:
    // 22 11, 44 33, 66 55, 88 77).
    const allPcm = new Uint8Array([0x22, 0x11, 0x44, 0x33, 0x66, 0x55, 0x88, 0x77]);
    // First chunk carries header + 3 PCM bytes (1.5 frames — half a sample trails).
    const first = makeWavChunk(allPcm.slice(0, 3));
    // Second chunk is pure PCM: the remaining 5 bytes.
    const second = allPcm.slice(3);

    const player = createWebAudioStreamPlayer({});
    const response = makeMockResponse([first, second]);

    await player.play(response);

    // Player must have decoded exactly 4 correctly-aligned Int16 samples.
    // If the misalignment bug is present, the second chunk starts on byte
    // 0x33 (the high byte of sample 0x3344), and the decoded Float32 values
    // will be garbage.
    expect(ctxInstances).toHaveLength(1);
    const ctx = ctxInstances[0];
    // Total frames scheduled must equal 4 (1 from first chunk + 3 from second).
    const totalFrames = ctx.buffers.reduce((sum, b) => sum + b.frames, 0);
    expect(totalFrames).toBe(4);
    // Concatenate decoded samples across all buffers and verify each Int16
    // was read at its correct byte offset. Expected values in Float32 = Int16 / 32768.
    const decoded: number[] = [];
    for (const buf of ctx.buffers) {
      const ch0 = buf._channelData[0];
      for (let i = 0; i < ch0.length; i++) decoded.push(ch0[i]);
    }
    // Little-endian Int16 reads: 0x1122 = 4386, 0x3344 = 13124, 0x5566 = 21862, 0x7788 = 30600.
    const expected = [0x1122, 0x3344, 0x5566, 0x7788].map((v) => v / 32768);
    for (let i = 0; i < 4; i++) {
      expect(decoded[i]).toBeCloseTo(expected[i], 5);
    }
  });
});
