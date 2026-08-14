/**
 * Patch #155: backend voice/transcribe route tests.
 *
 * Tests exercise handleTranscribe() at the function level (no Express harness,
 * no auth middleware) — following the handleConsoleLog pattern in debug.test.ts.
 * The auth gate is verified by construction: the route wires authenticateJWT
 * before multer before the handler, same as identities.ts and compose-drafts.ts.
 *
 * STT fetch is mocked via vi.stubGlobal("fetch", ...) per test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Phase 34: mock the SSH fetcher so the STT-route slash-transform tests can
// inject arbitrary catalog Sets without spinning up SSH. The matcher
// (slashCommandTransform) is intentionally NOT mocked — it's a pure function
// and we want to assert the real transformed output.
vi.mock("../../voice/skill-catalog.js", () => ({
  fetchSkillCatalog: vi.fn(),
  DEFAULT_SKILL_CATALOG_TIMEOUT_MS: 10_000,
}));

// Disk-bank tests: mock node:fs so handleTranscribe's fire-and-forget
// bank-write is intercepted without touching the real filesystem.
// We use importActual to preserve all real fs methods and only override
// promises.writeFile and promises.mkdir with vi.fn() spies.
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

import { handleTranscribe, handleSpeak, handleListVoices, handleSpeakStream, DEFAULT_VOICE, SPEAK_TEXT_MAX } from "./voice.js";
import { fetchSkillCatalog } from "../../voice/skill-catalog.js";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Minimal Express mock (enough to drive the handler)
// ---------------------------------------------------------------------------

type MockRes = {
  _status: number;
  _body: unknown;
  _ended: boolean;
  _endedBuf: Buffer | undefined;
  _headers: Record<string, string>;
  // Streaming path extensions (Task SD-SJ tests)
  _writes: Uint8Array[];
  _streamedEnded: boolean;
  status: (code: number) => MockRes;
  json: (body: unknown) => MockRes;
  end: (buf?: Buffer | Uint8Array) => MockRes;
  set: (key: string, value: string) => MockRes;
  setHeader: (key: string, value: string) => MockRes;
  write: (chunk: Buffer | Uint8Array) => boolean;
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
        if (buf instanceof Uint8Array) {
          this._writes.push(buf);
          this._endedBuf = Buffer.from(buf);
        } else {
          this._endedBuf = buf;
        }
      }
      return this;
    },
    set(key: string, value: string) {
      this._headers[key] = value;
      return this;
    },
    setHeader(key: string, value: string) {
      this._headers[key] = value;
      return this;
    },
    write(chunk: Buffer | Uint8Array) {
      this._writes.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
      return true;
    },
    on(_event: string, _cb: unknown) {
      return this;
    },
    once(_event: string, _cb: unknown) {
      return this;
    },
    emit(_event: string, ..._args: unknown[]) {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeTtsFetchResponse(
  status: number,
  wavBytes: Uint8Array = new Uint8Array([82, 73, 70, 70]),
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "audio/wav" },
    arrayBuffer: async () => wavBytes.buffer as ArrayBuffer,
    json: async () => ({}),
  } as unknown as Response;
}

function makeSpeakReq(body: Record<string, unknown>): { body: Record<string, unknown> } {
  return { body };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  // Reset fs.promises spies so tests are isolated (disk-bank tests)
  vi.mocked(fs.promises.writeFile).mockClear();
  vi.mocked(fs.promises.mkdir).mockClear();
  vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);
  vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleTranscribe", () => {
  it("Test 1: returns HTTP 200 with STT {text} verbatim when multipart file is present and STT returns 200", async () => {
    const fileBuffer = Buffer.from("fake audio bytes");
    const req = makeReq({ buffer: fileBuffer, mimetype: "audio/webm" });
    const res = makeRes();

    vi.stubGlobal("fetch", async (_url: string, _opts: RequestInit) => {
      return makeFetchResponse(200, { text: "hello world" });
    });

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    expect((res._body as { text: string }).text).toBe("hello world");
  });

  it("Test 2: returns HTTP 500 with {error, status} when STT returns HTTP 500", async () => {
    const req = makeReq({ buffer: Buffer.from("bytes"), mimetype: "audio/mp4" });
    const res = makeRes();

    vi.stubGlobal("fetch", async () => {
      return makeFetchResponse(500, { detail: "internal server error" });
    });

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(500);
    const body = res._body as { error: string; status: number };
    expect(body.status).toBe(500);
    expect(typeof body.error).toBe("string");
  });

  it("Test 3: returns HTTP 503 with {error, status: 503} when STT returns HTTP 503 (preserves STT status code)", async () => {
    const req = makeReq({ buffer: Buffer.from("bytes"), mimetype: "audio/wav" });
    const res = makeRes();

    vi.stubGlobal("fetch", async () => {
      return makeFetchResponse(503, { detail: "service unavailable" });
    });

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(503);
    const body = res._body as { error: string; status: number };
    expect(body.status).toBe(503);
    expect(typeof body.error).toBe("string");
  });

  it("Test 4: the body forwarded to STT contains the exact bytes from req.file.buffer under field name 'file'", async () => {
    const expectedBytes = Buffer.from("exact audio bytes abc123");
    const req = makeReq({ buffer: expectedBytes, mimetype: "audio/webm" });
    const res = makeRes();

    let capturedFormData: FormData | null = null;

    vi.stubGlobal("fetch", async (_url: string, opts: RequestInit) => {
      capturedFormData = opts.body as FormData;
      return makeFetchResponse(200, { text: "multipart passthrough ok" });
    });

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(capturedFormData).not.toBeNull();
    // Verify the FormData has the 'file' entry
    const fd = capturedFormData as FormData;
    const fileEntry = fd.get("file");
    expect(fileEntry).not.toBeNull();
    // The file entry should be a Blob/File with the correct bytes
    const blob = fileEntry as Blob;
    const arrBuf = await blob.arrayBuffer();
    const actualBytes = Buffer.from(arrBuf);
    expect(actualBytes).toEqual(expectedBytes);
  });

  it("Test 5: returns HTTP 400 with {error: 'missing file field'} when req.file is undefined", async () => {
    const req = makeReq(undefined); // no file
    const res = makeRes();

    vi.stubGlobal("fetch", async () => {
      throw new Error("fetch should not be called");
    });

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
    const body = res._body as { error: string };
    expect(body.error).toBe("missing file field");
  });

  it("Test 6: returns HTTP 504 with {error: 'STT timeout', status: 504} when fetch throws AbortError", async () => {
    const req = makeReq({ buffer: Buffer.from("bytes"), mimetype: "audio/mp4" });
    const res = makeRes();

    vi.stubGlobal("fetch", async () => {
      const err = new DOMException("The operation was aborted", "AbortError");
      throw err;
    });

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(504);
    const body = res._body as { error: string; status: number };
    expect(body.error).toBe("STT timeout");
    expect(body.status).toBe(504);
  });

  it("Test bank-write-1: writes audio buffer to disk before issuing STT fetch, with expected filename shape", async () => {
    const audioBytes = Buffer.from("audio-bytes-fixture");
    const req = makeReq({ buffer: audioBytes, mimetype: "audio/mp4", size: 19 });
    const res = makeRes();

    const fetchMock = vi.fn(async () => makeFetchResponse(200, { text: "hello" }));
    vi.stubGlobal("fetch", fetchMock);

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    // Give the fire-and-forget chain a chance to settle (Promise microtask flushes)
    await Promise.resolve();
    await Promise.resolve();

    // writeFile was called exactly once
    expect(vi.mocked(fs.promises.writeFile)).toHaveBeenCalledTimes(1);

    // First arg (path) matches expected filename shape
    const callArgs = vi.mocked(fs.promises.writeFile).mock.calls[0];
    const writtenPath = callArgs[0] as string;
    expect(writtenPath).toMatch(/^.*\/\d{8}T\d{6}Z-(anon|\d+)-19\.mp4$/);

    // Second arg is the audio buffer
    const writtenData = callArgs[1] as Buffer;
    expect(Buffer.isBuffer(writtenData)).toBe(true);
    expect(writtenData.equals(audioBytes)).toBe(true);

    // Call-order: the bank-write pipeline is kicked off (mkdir invoked) BEFORE the STT fetch.
    // The void-prefixed chain evaluates mkdir() synchronously; writeFile runs in the .then()
    // microtask which settles after handleTranscribe awaits fetch, so we check mkdir order.
    const mkdirCallOrder = vi.mocked(fs.promises.mkdir).mock.invocationCallOrder[0];
    const fetchCallOrder = fetchMock.mock.invocationCallOrder[0];
    expect(mkdirCallOrder).toBeLessThan(fetchCallOrder);

    // Response is still the normal STT result
    expect(res._status).toBe(200);
    expect((res._body as { text: string }).text).toBe("hello");
  });

  it("Test bank-write-2: bank-write rejection does not affect STT response (best-effort)", async () => {
    const req = makeReq({ buffer: Buffer.from("bytes"), mimetype: "audio/mp4", size: 5 });
    const res = makeRes();

    // Make writeFile reject to simulate disk error
    vi.mocked(fs.promises.writeFile).mockRejectedValueOnce(new Error("EACCES: permission denied"));

    vi.stubGlobal("fetch", async () => makeFetchResponse(200, { text: "still works" }));

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    // Give the .catch() a chance to run (Promise microtask flush)
    await Promise.resolve();
    await Promise.resolve();

    // handleTranscribe returned normally — the write rejection was swallowed
    expect(res._status).toBe(200);
    expect((res._body as { text: string }).text).toBe("still works");
  });
});

// ---------------------------------------------------------------------------
// handleTranscribe — Phase 34 slash-command transform tests (SD-P34-01..06)
// Wire-in of the server-side "slash <skill>" wake-word + skill-catalog match.
// The pure matcher (slashCommandTransform.ts) runs for real; only the SSH
// fetcher (fetchSkillCatalog) is mocked so we can inject arbitrary catalogs.
// ---------------------------------------------------------------------------

describe("handleTranscribe — Phase 34 slash-command transform", () => {
  const mockedFetchSkillCatalog = fetchSkillCatalog as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockedFetchSkillCatalog.mockReset();
  });

  it("Test SD-P34-01: transform SKIPPED when hostId form field is absent — raw transcript returned", async () => {
    const req = makeReq({ buffer: Buffer.from("bytes"), mimetype: "audio/webm" }, {});
    const res = makeRes();

    vi.stubGlobal("fetch", async () => makeFetchResponse(200, { text: "slash gsd status" }));

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    expect((res._body as { text: string }).text).toBe("slash gsd status");
    expect(mockedFetchSkillCatalog).not.toHaveBeenCalled();
  });

  it("Test SD-P34-02: transform SKIPPED when wake-word regex misses — fetchSkillCatalog NOT called", async () => {
    const req = makeReq(
      { buffer: Buffer.from("bytes"), mimetype: "audio/webm" },
      { hostId: "1" },
    );
    (req as unknown as { userId: string }).userId = "user-1";
    const res = makeRes();

    vi.stubGlobal("fetch", async () => makeFetchResponse(200, { text: "hello world" }));

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    expect((res._body as { text: string }).text).toBe("hello world");
    expect(mockedFetchSkillCatalog).not.toHaveBeenCalled();
  });

  it("Test SD-P34-03: wake-word HIT + catalog HIT → transformed text returned", async () => {
    const req = makeReq(
      { buffer: Buffer.from("bytes"), mimetype: "audio/webm" },
      { hostId: "42" },
    );
    (req as unknown as { userId: string }).userId = "user-1";
    const res = makeRes();

    vi.stubGlobal("fetch", async () => makeFetchResponse(200, { text: "slash gsd status" }));
    mockedFetchSkillCatalog.mockResolvedValue(new Set(["gsd", "bounty"]));

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    expect((res._body as { text: string }).text).toBe("/gsd status");
    expect(mockedFetchSkillCatalog).toHaveBeenCalledTimes(1);
    expect(mockedFetchSkillCatalog).toHaveBeenCalledWith(42, "user-1", 10_000);
  });

  it("Test SD-P34-04: wake-word HIT + empty catalog (fail-open) → raw transcript returned", async () => {
    const req = makeReq(
      { buffer: Buffer.from("bytes"), mimetype: "audio/webm" },
      { hostId: "42" },
    );
    (req as unknown as { userId: string }).userId = "user-1";
    const res = makeRes();

    vi.stubGlobal("fetch", async () => makeFetchResponse(200, { text: "slash gsd status" }));
    mockedFetchSkillCatalog.mockResolvedValue(new Set<string>());

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    expect((res._body as { text: string }).text).toBe("slash gsd status");
  });

  it("Test SD-P34-05: fetchSkillCatalog THROWS (defensive — should never happen per contract) → raw transcript returned via outer try/catch", async () => {
    const req = makeReq(
      { buffer: Buffer.from("bytes"), mimetype: "audio/webm" },
      { hostId: "42" },
    );
    (req as unknown as { userId: string }).userId = "user-1";
    const res = makeRes();

    vi.stubGlobal("fetch", async () => makeFetchResponse(200, { text: "slash gsd status" }));
    mockedFetchSkillCatalog.mockRejectedValue(new Error("boom"));

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    expect((res._body as { text: string }).text).toBe("slash gsd status");
  });

  it("Test SD-P34-06: hostId non-numeric ('abc') → transform SKIPPED, raw transcript returned", async () => {
    const req = makeReq(
      { buffer: Buffer.from("bytes"), mimetype: "audio/webm" },
      { hostId: "abc" },
    );
    (req as unknown as { userId: string }).userId = "user-1";
    const res = makeRes();

    vi.stubGlobal("fetch", async () => makeFetchResponse(200, { text: "slash gsd status" }));

    await handleTranscribe(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    expect((res._body as { text: string }).text).toBe("slash gsd status");
    expect(mockedFetchSkillCatalog).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleSpeak tests (patch #223 — behaviors A-H)
// ---------------------------------------------------------------------------

describe("handleSpeak", () => {
  it("Test A: returns 400 when body.text is missing", async () => {
    const req = makeSpeakReq({});
    const res = makeRes();
    vi.stubGlobal("fetch", async () => { throw new Error("should not be called"); });

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
    const body = res._body as { error: string };
    expect(typeof body.error).toBe("string");
  });

  it("Test A2: returns 400 when body.text is empty string", async () => {
    const req = makeSpeakReq({ text: "" });
    const res = makeRes();
    vi.stubGlobal("fetch", async () => { throw new Error("should not be called"); });

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
  });

  it("Test B: returns 400 when body.text length exceeds SPEAK_TEXT_MAX", async () => {
    const req = makeSpeakReq({ text: "a".repeat(SPEAK_TEXT_MAX + 1) });
    const res = makeRes();
    vi.stubGlobal("fetch", async () => { throw new Error("should not be called"); });

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
    const body = res._body as { error: string };
    expect(typeof body.error).toBe("string");
  });

  it("Test C: returns 400 when body.voice is invalid (does not match regex)", async () => {
    const req = makeSpeakReq({ text: "hello", voice: "invalid-voice.mp3" });
    const res = makeRes();
    vi.stubGlobal("fetch", async () => { throw new Error("should not be called"); });

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
    const body = res._body as { error: string };
    expect(typeof body.error).toBe("string");
  });

  it("Test D: returns 200 with audio/wav bytes when Chatterbox returns 200", async () => {
    const wavBytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
    const req = makeSpeakReq({ text: "Hello world" });
    const res = makeRes();
    vi.stubGlobal("fetch", async () => makeTtsFetchResponse(200, wavBytes));

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    expect(res._headers["Content-Type"]).toBe("audio/wav");
    expect(res._ended).toBe(true);
    expect(res._endedBuf).toBeDefined();
    expect(Buffer.from(res._endedBuf!)).toEqual(Buffer.from(wavBytes));
  });

  it("Test E: when body.voice is omitted, fetch body JSON uses DEFAULT_VOICE", async () => {
    const req = makeSpeakReq({ text: "Hello" });
    const res = makeRes();
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", async (_url: string, opts: RequestInit) => {
      capturedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
      return makeTtsFetchResponse(200);
    });

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.voice).toBe(DEFAULT_VOICE);
  });

  it("Test F: when body.voice is provided and valid, fetch body JSON uses that voice", async () => {
    const req = makeSpeakReq({ text: "Hello", voice: "Marcus.wav" });
    const res = makeRes();
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", async (_url: string, opts: RequestInit) => {
      capturedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
      return makeTtsFetchResponse(200);
    });

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.voice).toBe("Marcus.wav");
  });

  it("Test G: upstream non-2xx returns res.status(upstream.status).json with error shape (no body leak)", async () => {
    const req = makeSpeakReq({ text: "Hello" });
    const res = makeRes();
    vi.stubGlobal("fetch", async () => makeTtsFetchResponse(503));

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(503);
    const body = res._body as { error: string; status: number };
    expect(body.status).toBe(503);
    expect(typeof body.error).toBe("string");
  });

  it("Test H: fetch throwing AbortError returns 504 {error:'TTS timeout', status:504}", async () => {
    const req = makeSpeakReq({ text: "Hello" });
    const res = makeRes();
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });

    await handleSpeak(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(504);
    const body = res._body as { error: string; status: number };
    expect(body.error).toBe("TTS timeout");
    expect(body.status).toBe(504);
  });
});

// ---------------------------------------------------------------------------
// handleListVoices tests (patch #223 — behaviors I-K)
// ---------------------------------------------------------------------------

describe("handleListVoices", () => {
  it("Test I: returns upstream JSON array verbatim on 200", async () => {
    const voiceList = [
      { display_name: "Elena", filename: "Elena.wav" },
      { display_name: "Marcus", filename: "Marcus.wav" },
    ];
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => voiceList,
    }));

    const req = {} as import("express").Request;
    const res = makeRes();

    await handleListVoices(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(200);
    expect(res._body).toEqual(voiceList);
  });

  it("Test J: upstream non-2xx returns {error, status} with upstream status code", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 503,
      json: async () => ({ detail: "unavailable" }),
    }));

    const req = {} as import("express").Request;
    const res = makeRes();

    await handleListVoices(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(503);
    const body = res._body as { error: string; status: number };
    expect(body.status).toBe(503);
    expect(typeof body.error).toBe("string");
  });

  it("Test K: AbortError returns 504 {error:'voices timeout', status:504}", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });

    const req = {} as import("express").Request;
    const res = makeRes();

    await handleListVoices(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(504);
    const body = res._body as { error: string; status: number };
    expect(body.error).toBe("voices timeout");
    expect(body.status).toBe(504);
  });
});

// ---------------------------------------------------------------------------
// Helper for streaming tests
// ---------------------------------------------------------------------------

function makeStreamingTtsResponse(status: number, chunks: Uint8Array[] = []): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    headers: { get: () => "audio/wav" },
    json: async () => ({}),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// handleSpeakStream tests (patch #237 — behaviors SA through SJ)
// ---------------------------------------------------------------------------

describe("handleSpeakStream", () => {
  // Override the top-level fake timers for this describe block because
  // ReadableStream microtask scheduling requires real timers to work in-process.
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("Test SA: returns 400 when body.text is missing", async () => {
    const req = makeSpeakReq({});
    const res = makeRes();
    vi.stubGlobal("fetch", async () => { throw new Error("should not be called"); });

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
    const body = res._body as { error: string };
    expect(typeof body.error).toBe("string");
  });

  it("Test SA2: returns 400 when body.text is empty string", async () => {
    const req = makeSpeakReq({ text: "" });
    const res = makeRes();
    vi.stubGlobal("fetch", async () => { throw new Error("should not be called"); });

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
  });

  it("Test SB: returns 400 when body.text length exceeds SPEAK_TEXT_MAX", async () => {
    const req = makeSpeakReq({ text: "a".repeat(SPEAK_TEXT_MAX + 1) });
    const res = makeRes();
    vi.stubGlobal("fetch", async () => { throw new Error("should not be called"); });

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
    const body = res._body as { error: string };
    expect(typeof body.error).toBe("string");
  });

  it("Test SC: returns 400 when body.voice is invalid (does not match regex)", async () => {
    const req = makeSpeakReq({ text: "hello", voice: "invalid-voice.mp3" });
    const res = makeRes();
    vi.stubGlobal("fetch", async () => { throw new Error("should not be called"); });

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(400);
    const body = res._body as { error: string };
    expect(typeof body.error).toBe("string");
  });

  it("Test SD: happy path pipes chunks through, sets Content-Type audio/wav + X-Accel-Buffering no", async () => {
    const chunk1 = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]); // RIFF...
    const chunk2 = new Uint8Array([5, 6, 7, 8]);
    const req = makeSpeakReq({ text: "Hello world" });
    const res = makeRes();
    vi.stubGlobal("fetch", async () => makeStreamingTtsResponse(200, [chunk1, chunk2]));

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    // Give the pipe a tick to drain the ReadableStream chunks
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(res._status).toBe(200);
    expect(res._headers["Content-Type"]).toBe("audio/wav");
    expect(res._headers["X-Accel-Buffering"]).toBe("no");
    expect(res._writes.length).toBeGreaterThanOrEqual(1);

    // Concatenate all writes and verify they equal the input chunks
    const totalLen = res._writes.reduce((acc, w) => acc + w.length, 0);
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const w of res._writes) {
      combined.set(w, offset);
      offset += w.length;
    }
    const expected = new Uint8Array([...chunk1, ...chunk2]);
    expect(combined).toEqual(expected);

    expect(res._streamedEnded).toBe(true);
  });

  it("Test SE: Chatterbox request body matches locked schema when voice omitted", async () => {
    const req = makeSpeakReq({ text: "Hello" });
    const res = makeRes();
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", async (_url: string, opts: RequestInit) => {
      capturedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
      return makeStreamingTtsResponse(200, [new Uint8Array([1, 2, 3])]);
    });

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.text).toBe("Hello");
    expect(capturedBody!.voice_mode).toBe("predefined");
    expect(capturedBody!.predefined_voice_id).toBe("Elena.wav"); // DEFAULT_VOICE
    expect(capturedBody!.stream).toBe(true);
    expect(capturedBody!.split_text).toBe(true);
    expect(capturedBody!.chunk_size).toBe(80);
  });

  it("Test SF: when body.voice is provided, predefined_voice_id equals that voice (not DEFAULT_VOICE)", async () => {
    const req = makeSpeakReq({ text: "Hello", voice: "Marcus.wav" });
    const res = makeRes();
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", async (_url: string, opts: RequestInit) => {
      capturedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
      return makeStreamingTtsResponse(200, [new Uint8Array([1, 2, 3])]);
    });

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.predefined_voice_id).toBe("Marcus.wav");
    expect(capturedBody!.predefined_voice_id).not.toBe(DEFAULT_VOICE);
  });

  it("Test SG: upstream non-2xx returns {error:'TTS stream non-2xx', status} without piping body (T-16-03 analog)", async () => {
    const req = makeSpeakReq({ text: "Hello" });
    const res = makeRes();
    vi.stubGlobal("fetch", async () => makeStreamingTtsResponse(503, []));

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(503);
    const body = res._body as { error: string; status: number };
    expect(body.error).toBe("TTS stream non-2xx");
    expect(body.status).toBe(503);
    // Upstream body was NOT piped — T-19-04 no-body-leak
    expect(res._writes.length).toBe(0);
  });

  it("Test SH: fetch throwing AbortError returns 504 {error:'TTS stream timeout', status:504}", async () => {
    const req = makeSpeakReq({ text: "Hello" });
    const res = makeRes();
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(504);
    const body = res._body as { error: string; status: number };
    expect(body.error).toBe("TTS stream timeout");
    expect(body.status).toBe(504);
  });

  it("Test SI: fetch throwing generic Error returns 502 {error:'TTS stream proxy error', status:502}", async () => {
    const req = makeSpeakReq({ text: "Hello" });
    const res = makeRes();
    vi.stubGlobal("fetch", async () => {
      throw new Error("upstream socket closed");
    });

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(res._status).toBe(502);
    const body = res._body as { error: string; status: number };
    expect(body.error).toBe("TTS stream proxy error");
    expect(body.status).toBe(502);
  });

  it("Test SJ: fetch URL used is exactly http://100.80.122.111:8001/tts (not /v1/audio/speech)", async () => {
    const req = makeSpeakReq({ text: "Hello" });
    const res = makeRes();
    let capturedUrl: string | null = null;
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrl = url;
      return makeStreamingTtsResponse(200, [new Uint8Array([1, 2, 3])]);
    });

    await handleSpeakStream(
      req as unknown as import("express").Request,
      res as unknown as import("express").Response,
    );

    expect(capturedUrl).toBe("http://100.80.122.111:8001/tts");
    expect(capturedUrl).not.toContain("/v1/audio/speech");
  });
});
