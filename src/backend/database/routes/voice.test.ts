/**
 * Phase 109 plan 03 — voice route tests, rewired to Amazon Nova Sonic on Bedrock.
 *
 * Handler-level tests (no Express harness, no auth middleware — the auth gate
 * is verified by construction: the route wires authenticateJWT before multer
 * before the handler in voice.ts). Follows the handleConsoleLog pattern from
 * debug.test.ts.
 *
 * SDK strategy: `@aws-sdk/client-polly` is mocked at module level via
 * `vi.hoisted` + `vi.mock`. The Nova Sonic adapter (`nova-sonic-adapter.ts`)
 * and audio-transcode helper (`webmToPcm16k`) are each mocked as adapter
 * facades — the same pattern used by polly-adapter.test.ts (Plan 04). No real
 * AWS call is made from this file.
 *
 * NOT tested here (dropped or covered elsewhere):
 *   - Chatterbox-URL forwarding — dead; the old shared-constants module (Phase
 *     79 Plan 02) was deleted in Phase 98 Plan 10 alongside all its imports.
 *   - Chunked-path tests from the prior Phase (T1-T6) — deleted per D-CUTOVER (109-03);
 *     equivalent coverage lives in the rewritten handleTranscribe block below.
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
  transcribeNovaSonicMock,
} = vi.hoisted(() => ({
  pollyClientCtor: vi.fn(),
  synthesizeSpeechCmdCtor: vi.fn(),
  pollySendMock: vi.fn(),
  transcribeNovaSonicMock: vi.fn(),
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

// audio-transcode mock — stub webmToPcm16k so tests exercise the transcode
// plumbing in handleTranscribe without spawning real ffmpeg. padPcmToMinDuration
// is passed through as identity so route-level assertions on the buffer flowing
// into transcribeNovaSonic stay unchanged; its own unit tests cover the pad math.
vi.mock("../../voice/audio-transcode.js", () => ({
  webmToPcm16k: vi.fn(async (buf: Buffer) => buf),
  padPcmToMinDuration: vi.fn((buf: Buffer) => buf),
  MIN_PCM_DURATION_MS: 3000,
}));

// Nova Sonic adapter facade mock — matches the polly-adapter pattern.
// Route tests verify adapter call count + args; the adapter's own unit tests
// cover the Bedrock session protocol (nova-sonic-adapter.test.ts).
vi.mock("../../voice/nova-sonic-adapter.js", () => ({
  transcribeNovaSonic: transcribeNovaSonicMock,
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
  handleListVoices,
  SPEAK_TEXT_MAX,
} from "./voice.js";
import { clearVoiceListCache } from "../../voice/tts-provider.js";
import { TAIL_GUARD_FILLER } from "../../voice/tail-guard.js";
import { fetchSkillCatalog } from "../../voice/skill-catalog.js";
import { webmToPcm16k } from "../../voice/audio-transcode.js";
import { transcribeNovaSonic } from "../../voice/nova-sonic-adapter.js";
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
// Helpers: Polly Readables + error factories.
// -----------------------------------------------------------------------------

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
  synthesizeSpeechCmdCtor.mockClear();
  transcribeNovaSonicMock.mockReset();
  vi.mocked(webmToPcm16k).mockReset();
  vi.mocked(webmToPcm16k).mockImplementation(async (buf: Buffer) => buf);
  vi.mocked(fetchSkillCatalog).mockReset();
  clearVoiceListCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// handleTranscribe — happy path + disk-bank + slash-transform + 502/503 errors
// =============================================================================

describe("handleTranscribe (Amazon Nova Sonic on Bedrock)", () => {
  it("returns 200 with {text} from Nova Sonic when webm arrives (single path)", async () => {
    const audioBytes = Buffer.from("fake webm bytes");
    const req = makeReq({ buffer: audioBytes, mimetype: "audio/webm", size: audioBytes.length });
    const res = makeRes();

    transcribeNovaSonicMock.mockResolvedValueOnce("hello world");

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    expect((res._body as { text: string }).text).toBe("hello world");
    // Single path: webmToPcm16k called once, transcribeNovaSonic called once.
    expect(vi.mocked(webmToPcm16k)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(transcribeNovaSonic)).toHaveBeenCalledTimes(1);
    // transcribeNovaSonic receives the buffer returned by webmToPcm16k.
    const pcmBuf = await vi.mocked(webmToPcm16k).mock.results[0]?.value;
    expect(vi.mocked(transcribeNovaSonic)).toHaveBeenCalledWith(pcmBuf);
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

  it("disk-bank writes raw multipart bytes BEFORE any transcode (Pitfall 6 / D-14)", async () => {
    const audioBytes = Buffer.from("raw-webm-bytes-fixture");
    const req = makeReq({ buffer: audioBytes, mimetype: "audio/webm", size: audioBytes.length });
    const res = makeRes();

    transcribeNovaSonicMock.mockResolvedValueOnce("hello");

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

    // Call-ordering: mkdir was invoked BEFORE webmToPcm16k (bank-write kicks off first).
    const mkdirOrder = vi.mocked(fs.promises.mkdir).mock.invocationCallOrder[0];
    const transcodeOrder = vi.mocked(webmToPcm16k).mock.invocationCallOrder[0];
    expect(mkdirOrder).toBeLessThan(transcodeOrder);
  });

  it("returns 502 when webmToPcm16k throws", async () => {
    const audioBytes = Buffer.from("raw webm");
    const req = makeReq({ buffer: audioBytes, mimetype: "audio/webm", size: audioBytes.length });
    const res = makeRes();

    vi.mocked(webmToPcm16k).mockRejectedValueOnce(new Error("pcm transcode failed"));

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(502);
    const body = res._body as { error: string; status: number };
    expect(body.status).toBe(502);
    expect(typeof body.error).toBe("string");
  });

  it("returns 503 when Nova Sonic throws AccessDeniedException (T-109-03-01)", async () => {
    const audioBytes = Buffer.from("raw webm");
    const req = makeReq({ buffer: audioBytes, mimetype: "audio/webm", size: audioBytes.length });
    const res = makeRes();

    transcribeNovaSonicMock.mockRejectedValueOnce(makeAccessDeniedError());

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

    transcribeNovaSonicMock.mockResolvedValueOnce("slash gsd status");
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

    transcribeNovaSonicMock.mockResolvedValueOnce("hello world");

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

describe("handleTranscribe (STT_PROVIDER selection)", () => {
  const savedEnv = { ...process.env };
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...savedEnv };
  });

  async function transcribe(): Promise<MockRes> {
    const audioBytes = Buffer.from("fake webm bytes");
    const req = makeReq({ buffer: audioBytes, mimetype: "audio/webm", size: audioBytes.length });
    const res = makeRes();
    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );
    return res;
  }

  it("STT_PROVIDER=groq sends the raw upload over HTTP — no PCM transcode, no Bedrock", async () => {
    process.env.STT_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "gq-key";
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ text: "hi from groq" }), { status: 200 }));

    const res = await transcribe();

    expect(res._status).toBe(200);
    expect((res._body as { text: string }).text).toBe("hi from groq");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(webmToPcm16k)).not.toHaveBeenCalled();
    expect(vi.mocked(transcribeNovaSonic)).not.toHaveBeenCalled();
  });

  it("retries a 503 from an HTTP provider, then succeeds", async () => {
    process.env.STT_PROVIDER = "elevenlabs";
    process.env.ELEVENLABS_API_KEY = "el-key";
    fetchMock
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "second try" }), { status: 200 }));

    const res = await transcribe();

    expect(res._status).toBe(200);
    expect((res._body as { text: string }).text).toBe("second try");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("provider out of credits → 503 quota_exhausted with a plain message", async () => {
    process.env.STT_PROVIDER = "elevenlabs";
    process.env.ELEVENLABS_API_KEY = "el-key";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: { status: "quota_exceeded", message: "This request exceeds your quota of 10000." } }), { status: 401 }),
    );

    const res = await transcribe();

    expect(res._status).toBe(503);
    const body = res._body as { reason: string; message: string };
    expect(body.reason).toBe("quota_exhausted");
    expect(body.message).toBe("transcription quota exhausted — your audio was saved");
  });

  it("selected HTTP provider without its API key → 503 voice STT unavailable", async () => {
    process.env.STT_PROVIDER = "mistral";
    delete process.env.MISTRAL_API_KEY;

    const res = await transcribe();

    expect(res._status).toBe(503);
    expect((res._body as { error: string }).error).toBe("voice STT unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unknown STT_PROVIDER → 503, never a silent fallback to another provider", async () => {
    process.env.STT_PROVIDER = "nope";

    const res = await transcribe();

    expect(res._status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.mocked(transcribeNovaSonic)).not.toHaveBeenCalled();
  });
});

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

  it("skips a voice the active provider doesn't offer ('Elena.wav') and speaks the default — never a 400", async () => {
    const req = makeSpeakReq({ text: "hello", voice: "Elena.wav" });
    const res = makeRes();
    pollySendMock.mockResolvedValueOnce({ AudioStream: Readable.from([Buffer.alloc(10)]) });

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    expect(synthesizeSpeechCmdCtor.mock.calls[0]?.[0].VoiceId).toBe("Joanna");
  });

  it("returns 400 when a voice is malformed (non-string or over-long)", async () => {
    for (const body of [{ text: "hello", voice: 42 }, { text: "hello", voices: ["x".repeat(65)] }, { text: "hello", voices: "Joanna" }]) {
      const res = makeRes();
      await handleSpeak(
        makeSpeakReq(body) as unknown as import("express").Request,
        res as unknown as import("express").Response,
      );
      expect(res._status).toBe(400);
    }
    expect(pollySendMock).not.toHaveBeenCalled();
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

  it("uses Polly's default voice (Joanna) when no voice is sent", async () => {
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
    expect(cmdArgs.VoiceId).toBe("Joanna");
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

  it("speaks the first candidate Polly offers, skipping ones it doesn't (identity → role → fallback)", async () => {
    const req = makeSpeakReq({ text: "hello", voices: ["SAz9YHcvj6GT2YYXdXww", "marin", "Matthew", "Ruth"] });
    const res = makeRes();
    pollySendMock.mockResolvedValueOnce({ AudioStream: Readable.from([Buffer.alloc(4)]) });

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(res._status).toBe(200);
    expect(synthesizeSpeechCmdCtor.mock.calls[0]?.[0].VoiceId).toBe("Matthew");
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

  it("uses Polly's default voice (Joanna) when no voice is sent", async () => {
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
    expect(cmdArgs.VoiceId).toBe("Joanna");
  });
});


// =============================================================================
// TTS_PROVIDER selection — speak routes + GET /voices against the provider
// contract (tts-provider.ts). HTTP providers are exercised through a stubbed
// global fetch; Polly through the mocked SDK above.
// =============================================================================

describe("TTS_PROVIDER selection", () => {
  const savedEnv = { ...process.env };
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...savedEnv };
  });

  function pcmResponse(bytes = 8): Response {
    return new Response(new Uint8Array(bytes), { status: 200 });
  }

  async function speakStream(body: Record<string, unknown>): Promise<MockRes> {
    const res = makeRes();
    await handleSpeakStream(
      makeSpeakReq(body) as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    return res;
  }

  async function listVoices(): Promise<MockRes> {
    const res = makeRes();
    await handleListVoices(
      {} as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );
    return res;
  }

  function sentBody(callIndex = 0): Record<string, unknown> {
    return JSON.parse(String(fetchMock.mock.calls[callIndex]?.[1]?.body));
  }

  it("TTS_PROVIDER=openai: streams OpenAI PCM with a 24 kHz RIFF header, default voice marin, no Polly", async () => {
    process.env.TTS_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "oa-key";
    fetchMock.mockResolvedValueOnce(pcmResponse(6));

    const res = await speakStream({ text: "Hello there." });

    expect(res._status).toBe(200);
    expect(pollySendMock).not.toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/audio/speech");
    expect(sentBody()).toEqual({
      model: "gpt-4o-mini-tts",
      input: `Hello there. ${TAIL_GUARD_FILLER}`,
      voice: "marin",
      response_format: "pcm",
    });
    const header = Buffer.from(res._writes[0]);
    expect(header.readUInt32LE(24)).toBe(24000);
    expect(res._writes.slice(1).reduce((n, w) => n + w.length, 0)).toBe(6);
  });

  it("openai: a saved Polly voice is skipped for the next candidate the provider offers", async () => {
    process.env.TTS_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "oa-key";
    fetchMock.mockResolvedValueOnce(pcmResponse());

    await speakStream({ text: "Hi.", voices: ["Joanna", "nova"] });

    expect(sentBody().voice).toBe("nova");
  });

  it("TTS_MODEL and TTS_DEFAULT_VOICE override the provider's model and default voice", async () => {
    process.env.TTS_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "oa-key";
    process.env.TTS_MODEL = "tts-1-hd";
    process.env.TTS_DEFAULT_VOICE = "onyx";
    fetchMock.mockResolvedValueOnce(pcmResponse());

    await speakStream({ text: "Hi.", voices: ["Joanna"] });

    expect(sentBody()).toMatchObject({ model: "tts-1-hd", voice: "onyx", input: "Hi." });
  });

  describe("tail guard (gpt-4o-mini-tts drops final sentences)", () => {
    const SR = 24000;
    // Speech = 440 Hz tone; pause = digital silence.
    function synthPcm(segs: Array<["speech" | "pause", number]>): Uint8Array {
      const total = segs.reduce((n, [, s]) => n + Math.round(s * SR), 0);
      const buf = Buffer.alloc(total * 2);
      let i = 0;
      for (const [kind, s] of segs) {
        for (let k = 0; k < Math.round(s * SR); k++, i++) {
          buf.writeInt16LE(kind === "speech" ? Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / SR)) : 0, i * 2);
        }
      }
      return new Uint8Array(buf);
    }
    // The provider body arrives in several reads, odd-sized, like a real stream.
    function streamedResponse(bytes: Uint8Array): Response {
      const parts: Uint8Array[] = [];
      for (let off = 0; off < bytes.length; off += 4801) parts.push(bytes.subarray(off, off + 4801));
      return new Response(new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(p)); c.close(); } }), { status: 200 });
    }
    const streamedPcmBytes = (res: MockRes) => res._writes.slice(1).reduce((n, w) => n + w.length, 0);

    beforeEach(() => {
      process.env.TTS_PROVIDER = "openai";
      process.env.OPENAI_API_KEY = "oa-key";
    });

    it("cuts the filler off a short single-chunk message", async () => {
      fetchMock.mockResolvedValueOnce(streamedResponse(synthPcm([["speech", 2], ["pause", 0.5], ["speech", 4.5], ["pause", 0.3]])));
      const res = await speakStream({ text: "Want me to push?" });
      expect(streamedPcmBytes(res)).toBe(Math.round(2.15 * SR) * 2);
    });

    it("streams everything before the held-back tail and cuts the filler off a long message", async () => {
      fetchMock.mockResolvedValueOnce(streamedResponse(synthPcm([["speech", 14], ["pause", 0.5], ["speech", 4.5], ["pause", 0.3]])));
      const res = await speakStream({ text: "A long message. Want me to push?" });
      expect(res._writes.length).toBeGreaterThan(3);
      expect(streamedPcmBytes(res)).toBe(Math.round(14.15 * SR) * 2);
    });

    it("ends unpunctuated text with a period so the model pauses before the filler", async () => {
      fetchMock.mockResolvedValueOnce(streamedResponse(synthPcm([["speech", 8]])));
      await speakStream({ text: "Next step:" });
      expect(sentBody().input).toBe(`Next step:. ${TAIL_GUARD_FILLER}`);
      fetchMock.mockResolvedValueOnce(streamedResponse(synthPcm([["speech", 8]])));
      await speakStream({ text: 'He said "go."' });
      expect(sentBody(1).input).toBe(`He said "go." ${TAIL_GUARD_FILLER}`);
    });

    it("plays untrimmed when no pause fits the filler", async () => {
      const pcm = synthPcm([["speech", 8]]);
      fetchMock.mockResolvedValueOnce(streamedResponse(pcm));
      const res = await speakStream({ text: "Hi." });
      expect(streamedPcmBytes(res)).toBe(pcm.length);
    });

    it("cuts the filler on the non-streaming speak route too", async () => {
      fetchMock.mockResolvedValueOnce(streamedResponse(synthPcm([["speech", 2], ["pause", 0.5], ["speech", 4.5]])));
      const res = makeRes();
      await handleSpeak(
        makeSpeakReq({ text: "Sample." }) as unknown as import("express").Request,
        res as unknown as import("express").Response,
      );
      expect(sentBody().input).toBe(`Sample. ${TAIL_GUARD_FILLER}`);
      expect(res._endedBuf?.length).toBe(Math.round(2.15 * SR) * 2);
    });
  });

  it("splits long text at the active provider's own per-request limit", async () => {
    const sentence = `${"word ".repeat(379)}end.`; // 1899 chars
    const text = `${sentence} ${sentence}`; // 3799 chars: one OpenAI request, two Polly requests

    process.env.TTS_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "oa-key";
    fetchMock.mockImplementation(async () => pcmResponse());
    await speakStream({ text });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    delete process.env.TTS_PROVIDER;
    pollySendMock.mockImplementation(async () => ({ AudioStream: Readable.from([Buffer.alloc(4)]) }));
    await speakStream({ text });
    expect(pollySendMock).toHaveBeenCalledTimes(2);
  });

  it("unknown TTS_PROVIDER → 503 on speak and on the voice list, never a fallback provider", async () => {
    process.env.TTS_PROVIDER = "nope";

    const speakRes = await speakStream({ text: "Hi." });
    const listRes = await listVoices();

    expect(speakRes._status).toBe(503);
    expect((speakRes._body as { error: string }).error).toBe("voice TTS unavailable");
    expect(listRes._status).toBe(503);
    expect(pollySendMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("selected provider without its API key → 503, no request sent", async () => {
    process.env.TTS_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;

    const res = await speakStream({ text: "Hi." });

    expect(res._status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("provider rejecting the key (401) or out of credits (402) → 503 voice TTS unavailable", async () => {
    process.env.TTS_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "oa-key";
    for (const status of [401, 402]) {
      fetchMock.mockResolvedValueOnce(new Response("no", { status }));
      const res = await speakStream({ text: "Hi." });
      expect(res._status).toBe(503);
    }
  });

  it("out of credit (429 insufficient_quota) → 503 straight away, no retries", async () => {
    process.env.TTS_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "oa-key";
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429 }),
    );

    const res = await speakStream({ text: "Hi." });

    expect(res._status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("TTS_DEFAULT_VOICE from another provider → 503 on speak and on the voice list, nothing sent", async () => {
    process.env.TTS_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "oa-key";
    process.env.TTS_DEFAULT_VOICE = "Joanna";

    const speakRes = await speakStream({ text: "Hi." });
    const listRes = await listVoices();

    expect(speakRes._status).toBe(503);
    expect(listRes._status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries a 429 from the provider before any audio, then streams", async () => {
    process.env.TTS_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "oa-key";
    fetchMock
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(pcmResponse(4));

    const res = await speakStream({ text: "Hi." });

    expect(res._status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("elevenlabs: speaks a saved voice from the account list, 24 kHz PCM, default model", async () => {
    process.env.TTS_PROVIDER = "elevenlabs";
    process.env.ELEVENLABS_API_KEY = "el-key";
    fetchMock.mockImplementation(async (url) =>
      String(url).endsWith("/v1/voices")
        ? new Response(JSON.stringify({ voices: [{ voice_id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah - Mature" }] }), { status: 200 })
        : pcmResponse(),
    );

    const res = await speakStream({ text: "Hi.", voices: ["Joanna", "EXAVITQu4vr4xnSDxMaL"] });

    expect(res._status).toBe(200);
    const synthCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/text-to-speech/"));
    expect(String(synthCall?.[0])).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL/stream?output_format=pcm_24000",
    );
    expect(JSON.parse(String(synthCall?.[1]?.body))).toEqual({ text: "Hi.", model_id: "eleven_multilingual_v2" });
  });

  it("elevenlabs: a saved voice still speaks when the voice list can't be fetched", async () => {
    process.env.TTS_PROVIDER = "elevenlabs";
    process.env.ELEVENLABS_API_KEY = "el-key";
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/voices")) throw new TypeError("fetch failed");
      return pcmResponse();
    });

    const res = await speakStream({ text: "Hi.", voices: ["Joanna", "EXAVITQu4vr4xnSDxMaL"] });

    expect(res._status).toBe(200);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/text-to-speech/EXAVITQu4vr4xnSDxMaL/"))).toBe(true);
  });

  it("listener hangs up mid-message → no further chunks are requested from the provider", async () => {
    process.env.TTS_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "oa-key";
    const sentence = `${"word ".repeat(700)}end.`; // ~3504 chars → one chunk each
    const text = [sentence, sentence, sentence].join(" ");
    // Chunk 0's audio never finishes; chunk 1's prefetch answers normally.
    fetchMock
      .mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4)); } }), { status: 200 }))
      .mockImplementation(async () => pcmResponse());

    const listeners: Record<string, Array<() => void>> = {};
    const res = makeRes();
    res.once = (event: string, cb: unknown) => {
      (listeners[event] ??= []).push(cb as () => void);
      return res;
    };
    const done = handleSpeakStream(
      makeSpeakReq({ text }) as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(res._status).toBe(200);

    for (const cb of listeners.close ?? []) cb(); // the browser went away
    await done;

    expect(fetchMock).toHaveBeenCalledTimes(2); // chunk 0 + the one prefetch; chunk 2 never asked for
    expect(res._streamedEnded).toBe(false);
  });

  it("GET /voices: Polly's seven voices + Joanna default when TTS_PROVIDER is unset", async () => {
    delete process.env.TTS_PROVIDER;

    const res = await listVoices();

    expect(res._status).toBe(200);
    const body = res._body as { voices: { id: string; name: string }[]; defaultVoice: string; listError: boolean };
    expect(body.voices.map((v) => v.id)).toEqual(["Danielle", "Joanna", "Ruth", "Salli", "Tiffany", "Matthew", "Stephen"]);
    expect(body.defaultVoice).toBe("Joanna");
    expect(body.listError).toBe(false);
  });

  it("GET /voices: elevenlabs account voices with names split from descriptions; cached between calls", async () => {
    process.env.TTS_PROVIDER = "elevenlabs";
    process.env.ELEVENLABS_API_KEY = "el-key";
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          voices: [
            { voice_id: "SAz9YHcvj6GT2YYXdXww", name: "River - Relaxed, Neutral, Informative" },
            { voice_id: "wL82Y8r3Rj84NiLda6qb", name: "Arvis" },
          ],
        }),
        { status: 200 },
      ),
    );

    const res = await listVoices();
    await listVoices();

    expect(res._body).toMatchObject({
      voices: [
        { id: "SAz9YHcvj6GT2YYXdXww", name: "River", description: "Relaxed, Neutral, Informative" },
        { id: "wL82Y8r3Rj84NiLda6qb", name: "Arvis" },
      ],
      defaultVoice: "SAz9YHcvj6GT2YYXdXww",
      listError: false,
    });
    // Names for saved voices of any provider: the active list + every fixed list.
    const labels = (res._body as { labels: Record<string, string> }).labels;
    expect(labels).toMatchObject({ SAz9YHcvj6GT2YYXdXww: "River", Joanna: "Joanna", marin: "Marin" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("GET /voices: list down after a successful fetch → saved voices still named from the last known list", async () => {
    process.env.TTS_PROVIDER = "elevenlabs";
    process.env.ELEVENLABS_API_KEY = "el-key";
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ voices: [{ voice_id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah - Mature" }] }), { status: 200 }),
    );
    await listVoices();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10 * 60_000); // past the list TTL
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const res = await listVoices();

    expect(res._body).toMatchObject({ voices: [], listError: true, labels: { EXAVITQu4vr4xnSDxMaL: "Sarah" } });
  });

  it("GET /voices: list unreachable → 200 with listError so pickers keep showing the saved voice", async () => {
    process.env.TTS_PROVIDER = "elevenlabs";
    process.env.ELEVENLABS_API_KEY = "el-key";
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const res = await listVoices();

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ voices: [], defaultVoice: "SAz9YHcvj6GT2YYXdXww", listError: true });
    // Fixed-list providers can still be named; the account's own voices can't.
    const labels = (res._body as { labels: Record<string, string> }).labels;
    expect(labels.Joanna).toBe("Joanna");
    expect(labels.SAz9YHcvj6GT2YYXdXww).toBeUndefined();
  });
});
