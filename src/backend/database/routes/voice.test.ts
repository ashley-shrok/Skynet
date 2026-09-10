/**
 * Phase 98 plan 06 — voice route tests, rewritten to consume AWS SDK adapters.
 *
 * Handler-level tests (no Express harness, no auth middleware — the auth gate
 * is verified by construction: the route wires authenticateJWT before multer
 * before the handler in voice.ts). Follows the handleConsoleLog pattern from
 * debug.test.ts.
 *
 * SDK strategy: `@aws-sdk/client-polly` and `@aws-sdk/client-transcribe-streaming`
 * are mocked at module level via `vi.hoisted` + `vi.mock` — the same pattern
 * used by polly-adapter.test.ts + transcribe-adapter.test.ts (Plan 04). No real
 * AWS call is made from this file. audio-transcode.ts is mocked so its ffmpeg
 * spawn is replaced by pass-through stub buffers (per-test overrides trigger
 * the FLAC fallback path).
 *
 * NOT tested here (dropped or covered elsewhere):
 *   - `handleListVoices` — deleted entirely per D-Claude's-discretion 2026-09-10.
 *   - Chatterbox-URL forwarding — dead; the old shared-constants module (Phase
 *     79 Plan 02) was deleted in Phase 98 Plan 10 alongside all its imports.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Readable } from "node:stream";

// -----------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock factory calls that reference them.
// -----------------------------------------------------------------------------

const {
  pollyClientCtor,
  synthesizeSpeechCmdCtor,
  pollySendMock,
  transcribeClientCtor,
  startStreamCmdCtor,
  transcribeSendMock,
} = vi.hoisted(() => ({
  pollyClientCtor: vi.fn(),
  synthesizeSpeechCmdCtor: vi.fn(),
  pollySendMock: vi.fn(),
  transcribeClientCtor: vi.fn(),
  startStreamCmdCtor: vi.fn(),
  transcribeSendMock: vi.fn(),
}));

// AWS SDK mocks — function-ctor pattern so `new PollyClient(...)` works.
vi.mock("@aws-sdk/client-polly", () => {
  function PollyClient(this: unknown, cfg: unknown) {
    pollyClientCtor(cfg);
    (this as { send: unknown }).send = pollySendMock;
  }
  function SynthesizeSpeechCommand(this: unknown, input: unknown) {
    synthesizeSpeechCmdCtor(input);
    (this as { input: unknown }).input = input;
  }
  return { PollyClient, SynthesizeSpeechCommand };
});

vi.mock("@aws-sdk/client-transcribe-streaming", () => {
  function TranscribeStreamingClient(this: unknown, cfg: unknown) {
    transcribeClientCtor(cfg);
    (this as { send: unknown }).send = transcribeSendMock;
  }
  function StartStreamTranscriptionCommand(this: unknown, input: unknown) {
    startStreamCmdCtor(input);
    (this as { input: unknown }).input = input;
  }
  return { TranscribeStreamingClient, StartStreamTranscriptionCommand };
});

// audio-transcode mock — stub webmToFlac so tests exercise the transcode
// plumbing in handleTranscribe without spawning real ffmpeg.
vi.mock("../../voice/audio-transcode.js", () => ({
  webmToFlac: vi.fn(async (buf: Buffer) => buf),
}));

// Skill-catalog fetcher stub — same reason as before (avoid SSH round-trip).
vi.mock("../../voice/skill-catalog.js", () => ({
  fetchSkillCatalog: vi.fn(),
  DEFAULT_SKILL_CATALOG_TIMEOUT_MS: 10_000,
}));

// node:fs mock preserved so handleTranscribe's fire-and-forget disk-bank
// write is intercepted (not touching the real filesystem).
vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      promises: {
        ...actual.promises,
        writeFile: vi.fn(async () => undefined),
        mkdir: vi.fn(async () => undefined),
      },
    },
    promises: {
      ...actual.promises,
      writeFile: vi.fn(async () => undefined),
      mkdir: vi.fn(async () => undefined),
    },
  };
});

// -----------------------------------------------------------------------------
// Imports AFTER vi.mock so the handler picks up mocked SDKs.
// -----------------------------------------------------------------------------

import {
  handleTranscribe,
  handleSpeak,
  handleSpeakStream,
  DEFAULT_VOICE,
  SPEAK_TEXT_MAX,
} from "./voice.js";
import { fetchSkillCatalog } from "../../voice/skill-catalog.js";
import { webmToFlac } from "../../voice/audio-transcode.js";
import fs from "node:fs";

// -----------------------------------------------------------------------------
// Minimal Express req/res mocks — same shape as prior test file.
// -----------------------------------------------------------------------------

type MockRes = {
  _status: number;
  _body: unknown;
  _ended: boolean;
  _endedBuf: Buffer | undefined;
  _headers: Record<string, string>;
  _writes: Uint8Array[];
  _streamedEnded: boolean;
  _destroyed: boolean;
  status: (code: number) => MockRes;
  json: (body: unknown) => MockRes;
  end: (buf?: Buffer | Uint8Array) => MockRes;
  set: (key: string, value: string) => MockRes;
  setHeader: (key: string, value: string) => MockRes;
  write: (chunk: Buffer | Uint8Array) => boolean;
  destroy: () => void;
  on: (event: string, cb: unknown) => MockRes;
  once: (event: string, cb: unknown) => MockRes;
  emit: (event: string, ...args: unknown[]) => boolean;
};

function makeRes(): MockRes {
  const res: MockRes = {
    _status: 200,
    _body: undefined,
    _ended: false,
    _endedBuf: undefined,
    _headers: {},
    _writes: [],
    _streamedEnded: false,
    _destroyed: false,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
    end(buf?: Buffer | Uint8Array) {
      this._ended = true;
      this._streamedEnded = true;
      if (buf !== undefined) {
        if (buf instanceof Uint8Array && !Buffer.isBuffer(buf)) {
          this._writes.push(buf);
          this._endedBuf = Buffer.from(buf);
        } else {
          this._writes.push(buf as Uint8Array);
          this._endedBuf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
        }
      }
      return this;
    },
    set(key, value) {
      this._headers[key] = value;
      return this;
    },
    setHeader(key, value) {
      this._headers[key] = value;
      return this;
    },
    write(chunk) {
      this._writes.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
      return true;
    },
    destroy() {
      this._destroyed = true;
    },
    on() {
      return this;
    },
    once() {
      return this;
    },
    emit() {
      return true;
    },
  };
  return res;
}

type MockReq = {
  file?: {
    buffer: Buffer;
    mimetype: string;
    originalname?: string;
    size?: number;
  };
  body?: Record<string, unknown>;
};

function makeReq(file?: MockReq["file"], body?: Record<string, unknown>): MockReq {
  return { file, body };
}

function makeSpeakReq(body: Record<string, unknown>): { body: Record<string, unknown> } {
  return { body };
}

// -----------------------------------------------------------------------------
// Helpers: fake Transcribe result streams + Polly Readables.
// -----------------------------------------------------------------------------

function fakeTranscriptStream(
  results: Array<{ IsPartial: boolean; transcript: string }>,
): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const r of results) {
        yield {
          TranscriptEvent: {
            Transcript: {
              Results: [
                {
                  IsPartial: r.IsPartial,
                  Alternatives: [{ Transcript: r.transcript }],
                },
              ],
            },
          },
        };
      }
    },
  };
}

function makeAccessDeniedError(): Error {
  const err = new Error("User is not authorized to perform this action");
  (err as { name: string }).name = "AccessDeniedException";
  (err as { $metadata: { httpStatusCode: number } }).$metadata = {
    httpStatusCode: 403,
  };
  return err;
}

// -----------------------------------------------------------------------------
// Setup / teardown
// -----------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(fs.promises.writeFile).mockClear();
  vi.mocked(fs.promises.mkdir).mockClear();
  vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);
  vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
  pollySendMock.mockReset();
  transcribeSendMock.mockReset();
  synthesizeSpeechCmdCtor.mockClear();
  startStreamCmdCtor.mockClear();
  vi.mocked(webmToFlac).mockReset();
  vi.mocked(webmToFlac).mockImplementation(async (buf: Buffer) => buf);
  vi.mocked(fetchSkillCatalog).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// handleTranscribe — happy path + disk-bank + slash-transform + fallback + AccessDenied
// =============================================================================

describe("handleTranscribe (AWS Transcribe streaming)", () => {
  it("returns 200 with {text} from Transcribe when webm arrives (flac default path)", async () => {
    const audioBytes = Buffer.from("fake webm bytes");
    const req = makeReq({ buffer: audioBytes, mimetype: "audio/webm", size: audioBytes.length });
    const res = makeRes();

    transcribeSendMock.mockResolvedValueOnce({
      TranscriptResultStream: fakeTranscriptStream([
        { IsPartial: false, transcript: "hello world" },
      ]),
    });

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    expect((res._body as { text: string }).text).toBe("hello world");
    expect(vi.mocked(webmToFlac)).toHaveBeenCalledTimes(1);
    const cmdArgs = startStreamCmdCtor.mock.calls[0]?.[0];
    expect(cmdArgs.MediaEncoding).toBe("flac");
    expect(cmdArgs.MediaSampleRateHertz).toBe(16000);
  });

  it("returns 400 when req.file is missing", async () => {
    const req = makeReq(undefined);
    const res = makeRes();

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toBe("missing file field");
  });

  it("disk-bank writes raw multipart bytes BEFORE any transcode (Pitfall 6)", async () => {
    const audioBytes = Buffer.from("raw-webm-bytes-fixture");
    const req = makeReq({ buffer: audioBytes, mimetype: "audio/webm", size: audioBytes.length });
    const res = makeRes();

    transcribeSendMock.mockResolvedValueOnce({
      TranscriptResultStream: fakeTranscriptStream([
        { IsPartial: false, transcript: "hello" },
      ]),
    });

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    // Let fire-and-forget microtasks settle:
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(fs.promises.writeFile)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(fs.promises.writeFile).mock.calls[0];
    const writtenPath = call[0] as string;
    // filename shape (timestamp-userId-size-rand.ext): rand tail prevents
    // silent overwrite on concurrent same-user same-size uploads (M3 fix
    // from Phase 98 unbiased code review).
    expect(writtenPath).toMatch(/^.*\/\d{8}T\d{6}Z-(anon|\d+)-\d+-[a-z0-9]{1,6}\.webm$/);
    // Bank-written bytes ARE the RAW multipart bytes, not the transcoded output:
    const writtenData = call[1] as Buffer;
    expect(Buffer.isBuffer(writtenData)).toBe(true);
    expect(writtenData.equals(audioBytes)).toBe(true);

    // Call-ordering: mkdir was invoked BEFORE webmToFlac (bank-write kicks off first).
    const mkdirOrder = vi.mocked(fs.promises.mkdir).mock.invocationCallOrder[0];
    const transcodeOrder = vi.mocked(webmToFlac).mock.invocationCallOrder[0];
    expect(mkdirOrder).toBeLessThan(transcodeOrder);
  });

  it("returns 502 when webmToFlac throws", async () => {
    const audioBytes = Buffer.from("raw webm");
    const req = makeReq({ buffer: audioBytes, mimetype: "audio/webm", size: audioBytes.length });
    const res = makeRes();

    vi.mocked(webmToFlac).mockRejectedValueOnce(new Error("flac transcode failed"));

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(502);
    const body = res._body as { error: string; status: number };
    expect(body.status).toBe(502);
    expect(typeof body.error).toBe("string");
  });

  it("returns 503 when Transcribe throws AccessDeniedException (P98-OFF-01)", async () => {
    const audioBytes = Buffer.from("raw webm");
    const req = makeReq({ buffer: audioBytes, mimetype: "audio/webm", size: audioBytes.length });
    const res = makeRes();

    transcribeSendMock.mockRejectedValueOnce(makeAccessDeniedError());

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(503);
    const body = res._body as { error: string; status: number };
    expect(body.error).toBe("voice STT unavailable");
    expect(body.status).toBe(503);
  });

  it("preserves slash-command transform: wake-word HIT + catalog HIT → transformed text returned", async () => {
    const audioBytes = Buffer.from("bytes");
    const req = makeReq(
      { buffer: audioBytes, mimetype: "audio/webm", size: audioBytes.length },
      { hostId: "42" },
    );
    (req as unknown as { userId: string }).userId = "user-1";
    const res = makeRes();

    transcribeSendMock.mockResolvedValueOnce({
      TranscriptResultStream: fakeTranscriptStream([
        { IsPartial: false, transcript: "slash gsd status" },
      ]),
    });
    vi.mocked(fetchSkillCatalog).mockResolvedValue(new Set(["gsd", "bounty"]));

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    expect((res._body as { text: string }).text).toBe("/gsd status");
    expect(vi.mocked(fetchSkillCatalog)).toHaveBeenCalledWith(42, "user-1", 10_000);
  });

  it("preserves slash-command transform: wake-word MISS → raw transcript returned, catalog NOT fetched", async () => {
    const audioBytes = Buffer.from("bytes");
    const req = makeReq(
      { buffer: audioBytes, mimetype: "audio/webm", size: audioBytes.length },
      { hostId: "1" },
    );
    (req as unknown as { userId: string }).userId = "user-1";
    const res = makeRes();

    transcribeSendMock.mockResolvedValueOnce({
      TranscriptResultStream: fakeTranscriptStream([
        { IsPartial: false, transcript: "hello world" },
      ]),
    });

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    expect((res._body as { text: string }).text).toBe("hello world");
    expect(vi.mocked(fetchSkillCatalog)).not.toHaveBeenCalled();
  });
});

// =============================================================================
// handleSpeak — validation + RIFF-header dataSize + AccessDenied
// =============================================================================

describe("handleSpeak (AWS Polly SynthesizeSpeech, non-streaming)", () => {
  it("returns 400 when body.text is missing", async () => {
    const req = makeSpeakReq({});
    const res = makeRes();

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
    expect(typeof (res._body as { error: string }).error).toBe("string");
  });

  it("returns 400 when body.text is empty string", async () => {
    const req = makeSpeakReq({ text: "" });
    const res = makeRes();

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
  });

  it("returns 400 when body.text length exceeds SPEAK_TEXT_MAX", async () => {
    const req = makeSpeakReq({ text: "a".repeat(SPEAK_TEXT_MAX + 1) });
    const res = makeRes();

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
  });

  it("returns 400 when body.voice is the old Chatterbox shape (e.g. 'Elena.wav')", async () => {
    const req = makeSpeakReq({ text: "hello", voice: "Elena.wav" });
    const res = makeRes();

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
  });

  it("returns 400 when body.voice is not in the Polly whitelist ('NotAVoice')", async () => {
    const req = makeSpeakReq({ text: "hello", voice: "NotAVoice" });
    const res = makeRes();

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
  });

  it("accepts a valid Polly voice ID ('Joanna') and returns 200", async () => {
    const pcmBytes = Buffer.alloc(3200); // 3200 bytes of zeros
    const req = makeSpeakReq({ text: "hello", voice: "Joanna" });
    const res = makeRes();
    pollySendMock.mockResolvedValueOnce({
      AudioStream: Readable.from([pcmBytes]),
    });

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    // Verify VoiceId passed through:
    const cmdArgs = synthesizeSpeechCmdCtor.mock.calls[0]?.[0];
    expect(cmdArgs.VoiceId).toBe("Joanna");
  });

  it("uses DEFAULT_VOICE when body.voice is omitted (DEFAULT_VOICE is a Polly ID, not '.wav')", async () => {
    const pcmBytes = Buffer.alloc(100);
    const req = makeSpeakReq({ text: "hello" });
    const res = makeRes();
    pollySendMock.mockResolvedValueOnce({
      AudioStream: Readable.from([pcmBytes]),
    });

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    const cmdArgs = synthesizeSpeechCmdCtor.mock.calls[0]?.[0];
    expect(cmdArgs.VoiceId).toBe(DEFAULT_VOICE);
    expect(DEFAULT_VOICE).not.toMatch(/\.wav$/);
  });

  it("prepends RIFF header with dataSize = pcmBuf.length (byte-accurate, NOT 0xFFFFFFFF sentinel)", async () => {
    const pcmSize = 3200;
    const pcmBytes = Buffer.alloc(pcmSize); // deterministic byte count
    const req = makeSpeakReq({ text: "hello", voice: "Joanna" });
    const res = makeRes();
    pollySendMock.mockResolvedValueOnce({
      AudioStream: Readable.from([pcmBytes]),
    });

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    expect(res._headers["Content-Type"]).toBe("audio/wav");

    // Reassemble the full response body from _writes (may include header + pcm as separate frames):
    const totalLen = res._writes.reduce((acc, w) => acc + w.length, 0);
    const body = Buffer.alloc(totalLen);
    let offset = 0;
    for (const w of res._writes) {
      body.set(w, offset);
      offset += w.length;
    }
    // RIFF header is the first 44 bytes:
    expect(body.length).toBe(44 + pcmSize);
    // Byte-accurate dataSize (bytes 40-43 LE uint32):
    expect(body.readUInt32LE(40)).toBe(pcmSize);
    // Byte-accurate RIFF chunk size (bytes 4-7 LE uint32) = dataSize + 36:
    expect(body.readUInt32LE(4)).toBe(pcmSize + 36);
    // Sanity: NOT the 0xFFFFFFFF sentinel.
    expect(body.readUInt32LE(40)).not.toBe(0xffffffff);
  });

  it("returns 503 when Polly throws AccessDeniedException (P98-OFF-01)", async () => {
    const req = makeSpeakReq({ text: "hello", voice: "Joanna" });
    const res = makeRes();
    pollySendMock.mockRejectedValueOnce(makeAccessDeniedError());

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(503);
    const body = res._body as { error: string; status: number };
    expect(body.error).toBe("voice TTS unavailable");
    expect(body.status).toBe(503);
  });

  it("returns 502 when Polly throws a generic (non-AccessDenied) error", async () => {
    const req = makeSpeakReq({ text: "hello", voice: "Joanna" });
    const res = makeRes();
    pollySendMock.mockRejectedValueOnce(new Error("network down"));

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(502);
  });
});

// =============================================================================
// handleSpeakStream — validation + chunk-and-stitch orchestration + AccessDenied
// =============================================================================

describe("handleSpeakStream (AWS Polly, streaming with chunk-and-stitch)", () => {
  it("returns 400 when body.text is missing", async () => {
    const req = makeSpeakReq({});
    const res = makeRes();

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
  });

  it("returns 400 when body.text is empty string", async () => {
    const req = makeSpeakReq({ text: "" });
    const res = makeRes();

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
  });

  it("returns 400 when body.text length exceeds SPEAK_TEXT_MAX", async () => {
    const req = makeSpeakReq({ text: "a".repeat(SPEAK_TEXT_MAX + 1) });
    const res = makeRes();

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
  });

  it("returns 400 when body.voice is old Chatterbox shape ('Elena.wav')", async () => {
    const req = makeSpeakReq({ text: "hello", voice: "Elena.wav" });
    const res = makeRes();

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
  });

  it("short text (single chunk) — sets audio/wav + X-Accel-Buffering headers and pipes PCM bytes with RIFF prefix", async () => {
    const pcmBytes = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const req = makeSpeakReq({ text: "Hello.", voice: "Joanna" });
    const res = makeRes();
    pollySendMock.mockResolvedValueOnce({
      AudioStream: Readable.from([pcmBytes]),
    });

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    // Allow the pipe to drain:
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(res._status).toBe(200);
    expect(res._headers["Content-Type"]).toBe("audio/wav");
    expect(res._headers["X-Accel-Buffering"]).toBe("no");
    // First write is the 44-byte RIFF header:
    expect(res._writes[0].length).toBe(44);
    // Subsequent writes contain the PCM bytes:
    const totalPcmWritten = res._writes
      .slice(1)
      .reduce((acc, w) => acc + w.length, 0);
    expect(totalPcmWritten).toBe(pcmBytes.length);
    // Exactly one Polly SynthesizeSpeech call (single chunk):
    expect(pollySendMock).toHaveBeenCalledTimes(1);
    // Voice passed through:
    const cmdArgs = synthesizeSpeechCmdCtor.mock.calls[0]?.[0];
    expect(cmdArgs.VoiceId).toBe("Joanna");
  });

  it("returns 503 when Polly throws AccessDeniedException BEFORE any bytes flushed", async () => {
    const req = makeSpeakReq({ text: "Hello.", voice: "Joanna" });
    const res = makeRes();
    pollySendMock.mockRejectedValueOnce(makeAccessDeniedError());

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(503);
    const body = res._body as { error: string; status: number };
    expect(body.error).toBe("voice TTS unavailable");
    expect(body.status).toBe(503);
    expect(res._destroyed).toBe(false);
  });

  it("uses DEFAULT_VOICE (Polly ID, not '.wav') when body.voice is omitted", async () => {
    const pcmBytes = Buffer.from([1, 2]);
    const req = makeSpeakReq({ text: "hi." });
    const res = makeRes();
    pollySendMock.mockResolvedValueOnce({
      AudioStream: Readable.from([pcmBytes]),
    });

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    await new Promise<void>((resolve) => setImmediate(resolve));

    const cmdArgs = synthesizeSpeechCmdCtor.mock.calls[0]?.[0];
    expect(cmdArgs.VoiceId).toBe(DEFAULT_VOICE);
    expect(DEFAULT_VOICE).not.toMatch(/\.wav$/);
  });
});
