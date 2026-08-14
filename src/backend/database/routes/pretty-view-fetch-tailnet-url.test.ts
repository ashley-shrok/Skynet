/**
 * Phase 40 Plan 40-01: Tests for POST /pretty-view/fetch-tailnet-url.
 *
 * SSRF-hardened proxy for agent-served tailnet URLs (id-skill's `python3 -m
 * http.server` pattern → http://100.x.y.z:PORT/filename).
 *
 * Coverage matrix (per plan tasks Test 1-10):
 *   1. URL validation matrix — 400 on all invalid URLs (localhost, private
 *      ranges, link-local, https, path traversal, double slash, trailing slash,
 *      file://, non-string url, missing url)
 *   2. URL validation matrix — 200 on valid CGNAT URLs (100.64.0.0/10 range,
 *      including edge cases 100.64.0.1 / 100.100.100.100 / 100.127.255.254)
 *   3. Happy path: base64 payload + classification (isTextByExt true → sniff skipped)
 *   4. Extensionless-but-text: isTextByExt=false, isTextByBytes computed via sniff
 *   5. Upstream non-2xx → 502 { error: "upstream {status}" }
 *   6. Upstream oversized (>2 MB) → 413 { error: "file exceeds max size" }
 *   7. AbortError (timeout) → 504 { error: "fetch timeout" }
 *   8. Directory-listing HTML spoof for non-.html URL → 502 { error: "upstream html content-type mismatch" }
 *   9. Auth: middleware wired — 401 when mockUserId=null
 *   10. Body-schema: non-object body → 400 { error: "invalid body" }
 *
 * Test harness mirrors global-files-read-write.test.ts (bare Express app +
 * node:http, no supertest dep).
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth-manager mock (mirrors global-files-read-write.test.ts pattern L46-66)
// ---------------------------------------------------------------------------

let mockUserId: string | null = "1";

vi.mock("../../utils/auth-manager.js", () => {
  const AuthManager = {
    getInstance: () => ({
      createAuthMiddleware: () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          if (mockUserId === null) {
            return res.status(401).json({ error: "Unauthorized" });
          }
          (req as express.Request & { userId: string }).userId = mockUserId;
          next();
        },
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// Logger mock (silence sshLogger during tests)
// ---------------------------------------------------------------------------

vi.mock("../../utils/logger.js", () => ({
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  databaseLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// HTTP helper (mirrors global-files-read-write.test.ts pattern L126-172)
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined) {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(opts.body));
    }
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          let body: unknown;
          try { body = JSON.parse(data); } catch { body = data; }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// fetch mock — installed per-test via vi.stubGlobal
// ---------------------------------------------------------------------------

function makeFetchResponse(opts: {
  ok?: boolean;
  status?: number;
  contentType?: string | null;
  body?: Uint8Array | string;
  aborted?: boolean;
}): Response {
  const status = opts.status ?? (opts.ok ? 200 : 500);
  const ok = opts.ok ?? (status >= 200 && status < 300);
  const bodyBytes =
    typeof opts.body === "string"
      ? new TextEncoder().encode(opts.body)
      : (opts.body ?? new Uint8Array());
  const headers = new Headers();
  if (opts.contentType) headers.set("content-type", opts.contentType);
  return {
    ok,
    status,
    headers,
    arrayBuffer: async () =>
      bodyBytes.buffer.slice(bodyBytes.byteOffset, bodyBytes.byteOffset + bodyBytes.byteLength),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Import the router (after mocks are declared)
// ---------------------------------------------------------------------------

const { default: router } = await import("./pretty-view-fetch-tailnet-url.js");

let server: http.Server;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "1";
  originalFetch = globalThis.fetch;

  const app = express();
  app.use("/pretty-view", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Test 1: URL validation matrix — 400 on invalid URLs
// ---------------------------------------------------------------------------

describe("POST /pretty-view/fetch-tailnet-url — URL validation (400 on invalid)", () => {
  const invalidUrls: Array<{ label: string; body: unknown; expectedError?: string }> = [
    { label: "127.0.0.1", body: { url: "http://127.0.0.1:8000/f" } },
    { label: "localhost", body: { url: "http://localhost:8000/f" } },
    { label: "10.x private", body: { url: "http://10.0.0.1:8000/f" } },
    { label: "192.168.x private", body: { url: "http://192.168.1.5:8000/f" } },
    { label: "169.254.x link-local", body: { url: "http://169.254.1.1:8000/f" } },
    { label: "https scheme (not id-skill pattern)", body: { url: "https://100.64.0.1:8000/f" } },
    { label: "path traversal '..'", body: { url: "http://100.64.0.1:8000/../etc/passwd" } },
    { label: "double slash '//' in path", body: { url: "http://100.64.0.1:8000/f//g" } },
    { label: "trailing slash (empty filename)", body: { url: "http://100.64.0.1:8000/" } },
    { label: "file:// scheme", body: { url: "file:///etc/passwd" }, expectedError: "invalid tailnet URL" },
    { label: "non-string url (number)", body: { url: 42 }, expectedError: "invalid body" },
    { label: "missing url", body: {}, expectedError: "invalid body" },
  ];

  for (const { label, body, expectedError } of invalidUrls) {
    it(`Test 1 (${label}) → 400`, async () => {
      // globalThis.fetch should NOT be called for any of these — install a spy
      // that throws so accidental calls surface.
      globalThis.fetch = vi.fn(async () => {
        throw new Error("fetch should not fire on invalid URL");
      }) as unknown as typeof globalThis.fetch;

      const res = await httpRequest(server, {
        method: "POST",
        path: "/pretty-view/fetch-tailnet-url",
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      const errBody = res.body as { error?: string };
      if (expectedError) {
        expect(errBody.error).toBe(expectedError);
      } else {
        expect(errBody.error).toBeDefined();
      }
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  }
});

// ---------------------------------------------------------------------------
// Test 2: URL validation matrix — valid CGNAT URLs pass through
// ---------------------------------------------------------------------------

describe("POST /pretty-view/fetch-tailnet-url — URL validation (accept CGNAT)", () => {
  const validUrls: string[] = [
    "http://100.64.0.1:8000/notes.md",
    "http://100.100.100.100:65535/file.json",
    "http://100.127.255.254:1/f",
  ];

  for (const url of validUrls) {
    it(`Test 2 (${url}) → 200 (upstream mocked)`, async () => {
      globalThis.fetch = vi.fn(async () =>
        makeFetchResponse({
          ok: true,
          status: 200,
          contentType: "text/plain",
          body: "ok",
        }),
      ) as unknown as typeof globalThis.fetch;

      const res = await httpRequest(server, {
        method: "POST",
        path: "/pretty-view/fetch-tailnet-url",
        body: JSON.stringify({ url }),
      });
      expect(res.status).toBe(200);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  }
});

// ---------------------------------------------------------------------------
// Test 3: happy path — payload + classification shape
// ---------------------------------------------------------------------------

describe("POST /pretty-view/fetch-tailnet-url — happy path", () => {
  it("Test 3: returns base64 body + classification for .md file (isTextByExt=true, sniff skipped)", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeFetchResponse({
        ok: true,
        status: 200,
        contentType: "text/plain",
        body: "hello world",
      }),
    ) as unknown as typeof globalThis.fetch;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-tailnet-url",
      body: JSON.stringify({ url: "http://100.64.0.1:8000/notes.md" }),
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      contentBase64: string;
      sizeBytes: number;
      contentType: string | null;
      extension: string | null;
      filename: string;
      isTextByExt: boolean;
      isTextByBytes?: boolean;
    };
    expect(body.contentBase64).toBe(Buffer.from("hello world").toString("base64"));
    expect(body.sizeBytes).toBe(11);
    expect(body.contentType).toBe("text/plain");
    expect(body.extension).toBe("md");
    expect(body.filename).toBe("notes.md");
    expect(body.isTextByExt).toBe(true);
    expect(body.isTextByBytes).toBeUndefined();
  });

  it("Test 4: extensionless-but-text → isTextByExt=false, isTextByBytes=true (sniff runs)", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeFetchResponse({
        ok: true,
        status: 200,
        contentType: "text/plain",
        body: "print('hi')\n",
      }),
    ) as unknown as typeof globalThis.fetch;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-tailnet-url",
      body: JSON.stringify({ url: "http://100.64.0.1:8000/myscript" }),
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      extension: string | null;
      filename: string;
      isTextByExt: boolean;
      isTextByBytes?: boolean;
    };
    expect(body.extension).toBeNull();
    expect(body.filename).toBe("myscript");
    expect(body.isTextByExt).toBe(false);
    expect(body.isTextByBytes).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 5-8: upstream failure modes
// ---------------------------------------------------------------------------

describe("POST /pretty-view/fetch-tailnet-url — upstream failure modes", () => {
  it("Test 5: upstream non-2xx → 502 with upstream {status}", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeFetchResponse({ ok: false, status: 503 }),
    ) as unknown as typeof globalThis.fetch;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-tailnet-url",
      body: JSON.stringify({ url: "http://100.64.0.1:8000/f.md" }),
    });
    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toBe("upstream 503");
  });

  it("Test 6: upstream body > 2 MB → 413 with 'file exceeds max size'", async () => {
    const oversized = new Uint8Array(2_100_000); // > 2_000_000 cap
    // Fill with 'a' so it's not empty; classification is irrelevant here.
    oversized.fill(0x61);
    globalThis.fetch = vi.fn(async () =>
      makeFetchResponse({
        ok: true,
        status: 200,
        contentType: "text/plain",
        body: oversized,
      }),
    ) as unknown as typeof globalThis.fetch;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-tailnet-url",
      body: JSON.stringify({ url: "http://100.64.0.1:8000/big.md" }),
    });
    expect(res.status).toBe(413);
    expect((res.body as { error: string }).error).toBe("file exceeds max size");
  });

  it("Test 7: fetch AbortError → 504 with 'fetch timeout'", async () => {
    // Simulate what an AbortController-cancelled fetch throws.
    globalThis.fetch = vi.fn(async () => {
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof globalThis.fetch;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-tailnet-url",
      body: JSON.stringify({ url: "http://100.64.0.1:8000/f.md" }),
    });
    expect(res.status).toBe(504);
    expect((res.body as { error: string }).error).toBe("fetch timeout");
  });

  it("Test 8: directory-listing HTML spoof on non-.html URL → 502 'upstream html content-type mismatch'", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeFetchResponse({
        ok: true,
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "<html><body>directory listing</body></html>",
      }),
    ) as unknown as typeof globalThis.fetch;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-tailnet-url",
      body: JSON.stringify({ url: "http://100.64.0.1:8000/notes.md" }),
    });
    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toBe("upstream html content-type mismatch");
  });
});

// ---------------------------------------------------------------------------
// Test 9: auth wiring — 401 when middleware rejects
// ---------------------------------------------------------------------------

describe("POST /pretty-view/fetch-tailnet-url — auth", () => {
  it("Test 9: unauthenticated request → 401 (middleware wired)", async () => {
    mockUserId = null; // force auth middleware to reject
    // fetch should NOT be called; install a fail-loud spy.
    globalThis.fetch = vi.fn(async () => {
      throw new Error("fetch should not fire on 401");
    }) as unknown as typeof globalThis.fetch;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-tailnet-url",
      body: JSON.stringify({ url: "http://100.64.0.1:8000/notes.md" }),
    });
    expect(res.status).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 10: body-schema — non-object body → 400 "invalid body"
// ---------------------------------------------------------------------------

describe("POST /pretty-view/fetch-tailnet-url — body schema", () => {
  it("Test 10a: JSON array body (non-object) → 400 { error: 'invalid body' } from handler", async () => {
    // JSON arrays parse cleanly (express.json in strict mode accepts them);
    // our handler's Array.isArray(body) branch rejects with our structured error.
    globalThis.fetch = vi.fn(async () => {
      throw new Error("fetch should not fire on invalid body");
    }) as unknown as typeof globalThis.fetch;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-tailnet-url",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ url: "http://100.64.0.1:8000/f.md" }]),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("invalid body");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("Test 10b: raw JSON string body → 400 (express.json strict-mode reject)", async () => {
    // The default strict mode of express.json() rejects top-level JSON
    // primitives (strings, numbers, booleans) at parse time with a 400 before
    // our handler runs — this is a middleware-level defense that satisfies the
    // "reject non-object body at 400" contract even without our own guard.
    globalThis.fetch = vi.fn(async () => {
      throw new Error("fetch should not fire on invalid body");
    }) as unknown as typeof globalThis.fetch;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/pretty-view/fetch-tailnet-url",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify("some string"),
    });
    expect(res.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
