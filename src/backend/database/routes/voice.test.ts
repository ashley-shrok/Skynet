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
import { handleTranscribe } from "./voice.js";

// ---------------------------------------------------------------------------
// Minimal Express mock (enough to drive the handler)
// ---------------------------------------------------------------------------

type MockRes = {
  _status: number;
  _body: unknown;
  _ended: boolean;
  status: (code: number) => MockRes;
  json: (body: unknown) => MockRes;
  end: () => MockRes;
};

function makeRes(): MockRes {
  const res: MockRes = {
    _status: 200,
    _body: undefined,
    _ended: false,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
    end() {
      this._ended = true;
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
