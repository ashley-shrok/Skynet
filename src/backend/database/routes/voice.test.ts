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
import { handleTranscribe, handleSpeak, handleListVoices, DEFAULT_VOICE, SPEAK_TEXT_MAX } from "./voice.js";

// ---------------------------------------------------------------------------
// Minimal Express mock (enough to drive the handler)
// ---------------------------------------------------------------------------

type MockRes = {
  _status: number;
  _body: unknown;
  _ended: boolean;
  _endedBuf: Buffer | undefined;
  _headers: Record<string, string>;
  status: (code: number) => MockRes;
  json: (body: unknown) => MockRes;
  end: (buf?: Buffer) => MockRes;
  set: (key: string, value: string) => MockRes;
};

function makeRes(): MockRes {
  const res: MockRes = {
    _status: 200,
    _body: undefined,
    _ended: false,
    _endedBuf: undefined,
    _headers: {},
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
    end(buf?: Buffer) {
      this._ended = true;
      if (buf !== undefined) this._endedBuf = buf;
      return this;
    },
    set(key: string, value: string) {
      this._headers[key] = value;
      return this;
    },
  };
  return res;
}

type MockReq = {
  file?: {
    buffer: Buffer;
    mimetype: string;
    originalname?: string;
  };
};

function makeReq(file?: MockReq["file"]): MockReq {
  return { file };
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
