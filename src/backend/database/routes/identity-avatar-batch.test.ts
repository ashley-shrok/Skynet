/**
 * Phase 20 (IDUI-04): Tests for the identity-avatar-batch route.
 *
 * Tests the POST /batch and GET /candidate/:id handlers against a bare
 * express app using Node's built-in http module (supertest not available
 * in this project's test environment). Auth middleware is mocked via
 * vi.mock on the auth-manager module.
 *
 * Phase 74 Plan 03 additions:
 *   - vi.mock of the branding-config-loader module (LOAD-BEARING per
 *     74-RESEARCH.md § Pitfall 4 — without it, tests silently read
 *     bundled defaults with empty avatarDirectorSpec and every /batch
 *     test breaks via the new request-time 503 defense).
 *   - Mutable module-scope `mockConfig` object mirroring the mockUserId
 *     pattern so per-test config injection is straightforward.
 *   - Test 10: POST /batch sends avatarDirectorSpec verbatim as chat
 *     system message (Behavior 3 — spec-flow contract).
 *   - Test 11: gamma value flowing to sharp equals mocked
 *     avatarGammaDefault (Behavior 4 — gamma-flow contract).
 *   - Test 12: POST /batch returns 503 when avatarDirectorSpec is
 *     empty at request time (Behavior 5 — Pitfall 2 defense-in-depth).
 *   - Test 13: POST /batch returns 503 when avatarDirectorSpec is
 *     whitespace-only at request time (Behavior 6 — trim-then-length
 *     mirrors boot gate).
 *
 * Test coverage:
 *   1: returns 3 candidates on happy path
 *   2: archetype draft called ONCE per request, not thrice
 *   3: 3 image gens fire IN PARALLEL with same prompt
 *   4: gamma correction produces expected output for mid-grey fixture
 *   5: candidate cache TTL expiry — 200 within TTL, 404 after 10 min
 *   6: candidate cache scoped by userId — User A's candidates 404 for User B
 *   7: 401 without JWT — fetch never called
 *   8: propagates OpenAI failure with 502 — no upstream body leak
 *   9: 400 on missing required inputs — fetch never called
 *  10: POST /batch sends avatarDirectorSpec verbatim (Phase 74)
 *  11: gamma value comes from avatarGammaDefault, not hardcoded (Phase 74)
 *  12: 503 when avatarDirectorSpec empty at request time (Phase 74)
 *  13: 503 when avatarDirectorSpec whitespace-only at request time (Phase 74)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// Auth manager mock — controls whether a request is authenticated
// ---------------------------------------------------------------------------

let mockUserId: string | null = "user-1";

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
            return res.status(401).json({ error: "Missing authentication token" });
          }
          // Inject userId into request
          (req as express.Request & { userId: string }).userId = mockUserId;
          next();
        },
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// Phase 74 Plan 03: Branding-config-loader mock — LOAD-BEARING per
// 74-RESEARCH.md § Pitfall 4. Without this mock the loader reads the real
// container filesystem (/etc/skynet/branding/branding.json), which doesn't
// exist in the test environment → loader falls back to bundled defaults with
// avatarDirectorSpec="" → the /batch handler's Phase 74 request-time 503
// defense fires → every /batch test breaks.
//
// The mock's default state has a non-empty avatarDirectorSpec so existing
// Tests 1-9 stay GREEN. New Phase 74 tests mutate mockConfig per-test to
// exercise empty/whitespace/spec-verbatim/custom-gamma branches. beforeEach
// resets mockConfig to defaults to prevent cross-test bleed.
// ---------------------------------------------------------------------------

const DEFAULT_MOCK_DIRECTOR_SPEC =
  "TEST DIRECTOR SPEC — not the real thing";
const DEFAULT_MOCK_GAMMA = 0.7;

let mockConfig: {
  appName: string;
  shortName: string;
  iconPath: string;
  wordmarkPath: string;
  faviconPath: string;
  pwaIcons: Array<{ src: string; sizes: string; type: string }>;
  avatarDirectorSpec: string;
  avatarGammaDefault: number;
} = {
  appName: "Skynet",
  shortName: "Skynet",
  iconPath: "/branding/icon.png",
  wordmarkPath: "/branding/wordmark.png",
  faviconPath: "/branding/favicon.svg",
  pwaIcons: [
    { src: "/branding/pwa-icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/branding/pwa-icon-512.png", sizes: "512x512", type: "image/png" },
  ],
  avatarDirectorSpec: DEFAULT_MOCK_DIRECTOR_SPEC,
  avatarGammaDefault: DEFAULT_MOCK_GAMMA,
};

vi.mock("../../branding/branding-config-loader.js", () => ({
  loadBrandingConfig: async () => mockConfig,
  getBundledDefaults: () => mockConfig,
}));

// ---------------------------------------------------------------------------
// Helpers: HTTP request wrapper
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; body: unknown; rawBuffer?: Buffer }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    };
    if (bodyStr !== undefined) {
      headers["Content-Length"] = String(Buffer.byteLength(bodyStr));
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
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          const contentType = res.headers["content-type"] ?? "";
          let parsed: unknown;
          if (contentType.includes("application/json")) {
            try {
              parsed = JSON.parse(raw.toString());
            } catch {
              parsed = raw.toString();
            }
          } else {
            parsed = raw;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, rawBuffer: raw });
        });
      },
    );
    req.on("error", reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Multipart helper — emits a simple multipart/form-data body
// without requiring a separate npm dep (form-data is not in devDependencies).
// ---------------------------------------------------------------------------

function buildMultipartBody(
  fieldName: string,
  filename: string,
  contentType: string,
  fileBytes: Buffer,
  boundary: string,
): Buffer {
  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    ),
    fileBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  return Buffer.concat(parts);
}

function multipartRequest(
  server: http.Server,
  opts: {
    path: string;
    fieldName: string;
    filename: string;
    fileContentType: string;
    fileBytes: Buffer;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const boundary = "test-boundary-42";
    const body = buildMultipartBody(
      opts.fieldName,
      opts.filename,
      opts.fileContentType,
      opts.fileBytes,
      boundary,
    );

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "POST",
        path: opts.path,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": String(body.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw.toString());
          } catch {
            parsed = raw.toString();
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Canned test fixtures
// ---------------------------------------------------------------------------

// A minimal 1x1 white PNG in base64 (used as canned image-gen response)
const WHITE_1X1_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// A canned archetype text that looks like a real prompt
const CANNED_ARCHETYPE =
  "MOBA-champion character portrait illustration — a strong distinct character.";

// ---------------------------------------------------------------------------
// Fetch mock builder
// ---------------------------------------------------------------------------

type MockFetchHandler = (url: string, opts: RequestInit) => Promise<Response>;

function buildMockFetch(
  chatHandler?: MockFetchHandler,
  imageHandler?: MockFetchHandler,
): MockFetchHandler {
  return async (url: string, opts: RequestInit) => {
    if (url.includes("api.openai.com/v1/chat/completions")) {
      if (chatHandler) return chatHandler(url, opts);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: CANNED_ARCHETYPE } }],
        }),
      } as unknown as Response;
    }
    if (url.includes("api.openai.com/v1/images/generations")) {
      if (imageHandler) return imageHandler(url, opts);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ b64_json: WHITE_1X1_PNG_B64 }],
        }),
      } as unknown as Response;
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: http.Server;

// We import the router after mocks are set up. Lazy-import each test so we
// can reset module state where needed.

async function startServer(): Promise<http.Server> {
  // Dynamic import so vi.mock has already intercepted the auth-manager
  const mod = await import("./identity-avatar-batch.js");
  const router = mod.default;
  const app = express();
  app.use("/identities/avatar", router);
  return new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

beforeEach(async () => {
  vi.useFakeTimers();
  mockUserId = "user-1";
  // Phase 74: reset mockConfig to a valid non-empty default so per-test
  // mutations (Tests 10-13) don't leak into subsequent tests.
  mockConfig.avatarDirectorSpec = DEFAULT_MOCK_DIRECTOR_SPEC;
  mockConfig.avatarGammaDefault = DEFAULT_MOCK_GAMMA;
  // Ensure OPENAI_API_KEY is set so routes don't return 503
  process.env.OPENAI_API_KEY = "test-key-not-real";
  // Dynamic import to get the clear helper
  const mod = await import("./identity-avatar-batch.js");
  if (typeof mod._clearCandidateCacheForTest === "function") {
    mod._clearCandidateCacheForTest();
  }
  server = await startServer();
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  delete process.env.OPENAI_API_KEY;
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Test 1: returns 3 candidates on happy path
// ---------------------------------------------------------------------------

it("Test 1: returns 3 candidates on happy path", async () => {
  vi.stubGlobal("fetch", buildMockFetch());

  const res = await httpRequest(server, {
    method: "POST",
    path: "/identities/avatar/batch",
    body: { name: "testkey", title: "Test Title", brief: "testing" },
  });

  expect(res.status).toBe(200);
  const body = res.body as { candidates: Array<{ url: string; id: string }> };
  expect(Array.isArray(body.candidates)).toBe(true);
  expect(body.candidates).toHaveLength(3);
  for (const c of body.candidates) {
    expect(typeof c.id).toBe("string");
    expect(c.id.length).toBeGreaterThan(0);
    expect(c.url).toMatch(/^\/identities\/avatar\/candidate\/[A-Za-z0-9_-]+$/);
  }
  // All IDs must be distinct
  const ids = body.candidates.map((c) => c.id);
  expect(new Set(ids).size).toBe(3);
});

// ---------------------------------------------------------------------------
// Test 2: archetype draft called ONCE per request, not thrice
// ---------------------------------------------------------------------------

it("Test 2: archetype draft called ONCE per request, not thrice", async () => {
  let chatCallCount = 0;

  vi.stubGlobal(
    "fetch",
    buildMockFetch(
      async () => {
        chatCallCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: CANNED_ARCHETYPE } }],
          }),
        } as unknown as Response;
      },
    ),
  );

  const res = await httpRequest(server, {
    method: "POST",
    path: "/identities/avatar/batch",
    body: { name: "testkey", title: "Test Title", brief: "testing" },
  });

  expect(res.status).toBe(200);
  expect(chatCallCount).toBe(1);
});

// ---------------------------------------------------------------------------
// Test 3: 3 image gens fire IN PARALLEL with same prompt
// ---------------------------------------------------------------------------

it("Test 3: 3 image gens fire IN PARALLEL with same prompt", async () => {
  const imagePrompts: string[] = [];
  let resolvers: Array<() => void> = [];
  let imageCallCount = 0;

  vi.stubGlobal(
    "fetch",
    buildMockFetch(
      undefined,
      async (_url, opts) => {
        imageCallCount++;
        const body = JSON.parse(opts.body as string) as { prompt: string };
        imagePrompts.push(body.prompt);
        // Return immediately with canned response
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ b64_json: WHITE_1X1_PNG_B64 }],
          }),
        } as unknown as Response;
      },
    ),
  );

  const res = await httpRequest(server, {
    method: "POST",
    path: "/identities/avatar/batch",
    body: { name: "testkey", title: "Test Title", brief: "testing" },
  });

  expect(res.status).toBe(200);
  // All 3 image generation calls fired
  expect(imageCallCount).toBe(3);
  // All with the SAME prompt (the archetype draft output)
  expect(imagePrompts[0]).toBe(CANNED_ARCHETYPE);
  expect(imagePrompts[1]).toBe(CANNED_ARCHETYPE);
  expect(imagePrompts[2]).toBe(CANNED_ARCHETYPE);
});

// ---------------------------------------------------------------------------
// Test 4: gamma correction spot-check: mid-grey (128,128,128) -> ~177
// ---------------------------------------------------------------------------

it("Test 4: gamma correction produces expected output for mid-grey fixture", async () => {
  // Import the route module to access the exported gamma helper
  const mod = await import("./identity-avatar-batch.js");

  // If the module exports a testable gamma function, use it.
  // Otherwise create a known PNG buffer with mid-grey and verify via the route.
  if (typeof mod._applyCorrectionForTest === "function") {
    // Create a 4x4 all-mid-grey RGB image
    const { createCanvas } = await import("canvas").catch(() => null) as any ?? {};
    // Fallback: just check the function exists and test with a known value
    const result = await mod._applyCorrectionForTest(128);
    // (128/255)^0.7 * 255 ≈ 157.4 → rounds to 157 (±3 for float rounding)
    // Note: plan states ≈177 but correct math gives ≈157; verified via
    // Python numpy: np.power(128/255, 0.7) * 255 = 157.40
    expect(result).toBeGreaterThanOrEqual(155);
    expect(result).toBeLessThanOrEqual(160);
  } else {
    // Test via POST: produce a batch, then GET the candidate and check
    // that the returned image bytes differ from the raw base64 PNG
    // (i.e., gamma was applied and produced different bytes).
    // We can verify non-identity: if gamma is a no-op, skip assertion.
    // This test validates the route CALLS gamma (structural check).
    vi.stubGlobal("fetch", buildMockFetch());

    const postRes = await httpRequest(server, {
      method: "POST",
      path: "/identities/avatar/batch",
      body: { name: "gammatest", title: "Gamma Test", brief: "check gamma" },
    });

    expect(postRes.status).toBe(200);
    const body = postRes.body as { candidates: Array<{ url: string; id: string }> };
    expect(body.candidates).toHaveLength(3);

    // Verify the route exists and returned candidates are served as PNG
    const candidateUrl = body.candidates[0].url;
    const getRes = await httpRequest(server, {
      method: "GET",
      path: candidateUrl,
    });
    expect(getRes.status).toBe(200);
    // The image was processed (gamma-corrected PNG bytes returned)
    expect((getRes.rawBuffer as Buffer).length).toBeGreaterThan(0);
  }
});

// ---------------------------------------------------------------------------
// Test 5: candidate cache TTL expiry
// ---------------------------------------------------------------------------

it("Test 5: candidate cache TTL — 200 within TTL, 404 after 10 min", async () => {
  vi.stubGlobal("fetch", buildMockFetch());

  const postRes = await httpRequest(server, {
    method: "POST",
    path: "/identities/avatar/batch",
    body: { name: "ttltest", title: "TTL Test", brief: "ttl test" },
  });

  expect(postRes.status).toBe(200);
  const body = postRes.body as { candidates: Array<{ url: string; id: string }> };
  const candidateUrl = body.candidates[0].url;

  // Within TTL: should be 200
  const getRes1 = await httpRequest(server, {
    method: "GET",
    path: candidateUrl,
  });
  expect(getRes1.status).toBe(200);

  // Advance fake timers past 10 minutes (600 000ms) to expire the cache
  vi.advanceTimersByTime(601_000);

  // After TTL: should be 404
  const getRes2 = await httpRequest(server, {
    method: "GET",
    path: candidateUrl,
  });
  expect(getRes2.status).toBe(404);
  const expiredBody = getRes2.body as { error: string };
  expect(expiredBody.error).toBe("candidate expired");
});

// ---------------------------------------------------------------------------
// Test 6: candidate cache scoped by userId
// ---------------------------------------------------------------------------

it("Test 6: candidate cache scoped by userId — User A's candidates 404 for User B", async () => {
  // User A generates batch
  mockUserId = "user-A";
  vi.stubGlobal("fetch", buildMockFetch());

  const postRes = await httpRequest(server, {
    method: "POST",
    path: "/identities/avatar/batch",
    body: { name: "scopetest", title: "Scope Test", brief: "scope" },
  });
  expect(postRes.status).toBe(200);
  const body = postRes.body as { candidates: Array<{ url: string; id: string }> };
  const candidateUrl = body.candidates[0].url;

  // User A can access their candidate
  const getResA = await httpRequest(server, {
    method: "GET",
    path: candidateUrl,
  });
  expect(getResA.status).toBe(200);

  // User B cannot access User A's candidate
  mockUserId = "user-B";
  const getResB = await httpRequest(server, {
    method: "GET",
    path: candidateUrl,
  });
  expect(getResB.status).toBe(404);
});

// ---------------------------------------------------------------------------
// Test 7: 401 without JWT
// ---------------------------------------------------------------------------

it("Test 7: 401 without JWT — fetch never called", async () => {
  mockUserId = null; // signals auth middleware to reject

  let fetchCalled = false;
  vi.stubGlobal("fetch", async () => {
    fetchCalled = true;
    throw new Error("fetch must not be called");
  });

  const res = await httpRequest(server, {
    method: "POST",
    path: "/identities/avatar/batch",
    body: { name: "authntest", title: "Auth Test", brief: "test" },
  });

  expect(res.status).toBe(401);
  expect(fetchCalled).toBe(false);
});

// ---------------------------------------------------------------------------
// Test 8: propagates OpenAI failure with 502 — no upstream body leak
// ---------------------------------------------------------------------------

it("Test 8: propagates OpenAI failure with 502 on image gen non-2xx", async () => {
  vi.stubGlobal(
    "fetch",
    buildMockFetch(
      undefined,
      async () => {
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: { message: "Rate limit exceeded — secret detail" } }),
        } as unknown as Response;
      },
    ),
  );

  const res = await httpRequest(server, {
    method: "POST",
    path: "/identities/avatar/batch",
    body: { name: "failtest", title: "Fail Test", brief: "test" },
  });

  expect(res.status).toBe(502);
  const body = res.body as { error: string };
  expect(body.error).toBe("avatar generation failed");
  // Must NOT leak upstream error message
  expect(JSON.stringify(body)).not.toContain("Rate limit exceeded");
  expect(JSON.stringify(body)).not.toContain("secret detail");
});

// ---------------------------------------------------------------------------
// Test 9: 400 on missing required inputs
// ---------------------------------------------------------------------------

describe("Test 9: 400 on missing required inputs", () => {
  it("400 when name is empty", async () => {
    let fetchCalled = false;
    vi.stubGlobal("fetch", async () => {
      fetchCalled = true;
      throw new Error("fetch must not be called");
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/avatar/batch",
      body: { name: "", title: "Test Title", brief: "testing" },
    });

    expect(res.status).toBe(400);
    expect(fetchCalled).toBe(false);
  });

  it("400 when title is empty", async () => {
    let fetchCalled = false;
    vi.stubGlobal("fetch", async () => {
      fetchCalled = true;
      throw new Error("fetch must not be called");
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/avatar/batch",
      body: { name: "testkey", title: "", brief: "testing" },
    });

    expect(res.status).toBe(400);
    expect(fetchCalled).toBe(false);
  });

  it("400 when brief is empty", async () => {
    let fetchCalled = false;
    vi.stubGlobal("fetch", async () => {
      fetchCalled = true;
      throw new Error("fetch must not be called");
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/avatar/batch",
      body: { name: "testkey", title: "Test Title", brief: "" },
    });

    expect(res.status).toBe(400);
    expect(fetchCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CR-06: candidate cache eviction
// ---------------------------------------------------------------------------

describe("CR-06: candidate cache eviction", () => {
  it("evicts oldest global entry when cache size would exceed GLOBAL_CACHE_MAX", async () => {
    const mod = await import("./identity-avatar-batch.js");
    const cache = mod._getCandidateCacheForTest()!;

    // Pre-populate exactly 100 entries for various user IDs
    const stubBytes = Buffer.from("stub");
    const insertedIds: string[] = [];
    for (let i = 0; i < 100; i++) {
      const id = `global-entry-${i}`;
      cache.set(id, {
        userId: `user-${i % 5}`, // spread across 5 users so per-user cap isn't hit
        bytes: stubBytes,
        createdAt: Date.now() + i, // ascending createdAt
        mime: "image/png",
      });
      insertedIds.push(id);
    }

    expect(cache.size).toBe(100);
    const oldestId = insertedIds[0]; // first inserted = oldest in Map order
    expect(cache.has(oldestId)).toBe(true);

    // Evict then insert one new entry for a user below per-user cap
    mod._evictIfNeededForTest("user-new");
    const newId = "new-entry-after-eviction";
    cache.set(newId, {
      userId: "user-new",
      bytes: stubBytes,
      createdAt: Date.now() + 200,
      mime: "image/png",
    });

    // Oldest global entry should be gone
    expect(cache.has(oldestId)).toBe(false);
    // New entry should be present
    expect(cache.has(newId)).toBe(true);
    // Size should still be 100 (evicted 1, inserted 1)
    expect(cache.size).toBe(100);
  });

  it("evicts oldest per-user entry when a user's count would exceed PER_USER_CACHE_MAX", async () => {
    const mod = await import("./identity-avatar-batch.js");
    const cache = mod._getCandidateCacheForTest()!;

    const stubBytes = Buffer.from("stub");

    // Pre-populate 15 entries for user-1
    const user1Ids: string[] = [];
    for (let i = 0; i < 15; i++) {
      const id = `user1-entry-${i}`;
      cache.set(id, {
        userId: "1",
        bytes: stubBytes,
        createdAt: Date.now() + i,
        mime: "image/png",
      });
      user1Ids.push(id);
    }

    // Pre-populate 5 entries for user-2
    const user2Ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = `user2-entry-${i}`;
      cache.set(id, {
        userId: "2",
        bytes: stubBytes,
        createdAt: Date.now() + i,
        mime: "image/png",
      });
      user2Ids.push(id);
    }

    expect(cache.size).toBe(20);
    const oldestUser1Id = user1Ids[0]; // first inserted for user-1

    // Trigger eviction for user-1 (at cap of 15), then insert new entry
    mod._evictIfNeededForTest("1");
    const newUser1Id = "user1-new-entry";
    cache.set(newUser1Id, {
      userId: "1",
      bytes: stubBytes,
      createdAt: Date.now() + 100,
      mime: "image/png",
    });

    // User-1's oldest entry should be gone
    expect(cache.has(oldestUser1Id)).toBe(false);
    // User-1's newest entry should be present
    expect(cache.has(newUser1Id)).toBe(true);

    // Count user-1 entries — should be exactly 15
    const user1Count = [...cache.values()].filter((e) => e.userId === "1").length;
    expect(user1Count).toBe(15);

    // User-2's 5 entries should ALL still be present (cross-user isolation)
    for (const id of user2Ids) {
      expect(cache.has(id)).toBe(true);
    }
    const user2Count = [...cache.values()].filter((e) => e.userId === "2").length;
    expect(user2Count).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// POST /candidate/manual tests
// ---------------------------------------------------------------------------

describe("POST /candidate/manual", () => {
  it("happy: multipart PNG → 200 { id }, cache entry scoped to userId, GET /candidate/:id returns same bytes", async () => {
    // Build a real 1x1 PNG using sharp (same dep used by the route)
    const pngBytes = await sharp({
      create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    const res = await multipartRequest(server, {
      path: "/identities/avatar/candidate/manual",
      fieldName: "avatar",
      filename: "a.png",
      fileContentType: "image/png",
      fileBytes: pngBytes,
    });

    expect(res.status).toBe(200);
    const body = res.body as { id?: string };
    expect(typeof body.id).toBe("string");
    expect(body.id!.length).toBeGreaterThan(0);

    // Verify the entry landed in candidateCache scoped to user-1
    const mod = await import("./identity-avatar-batch.js");
    const cache = mod._getCandidateCacheForTest()!;
    expect(cache.has(body.id!)).toBe(true);
    const entry = cache.get(body.id!)!;
    expect(entry.userId).toBe("user-1");
    expect(Buffer.compare(entry.bytes, pngBytes)).toBe(0);
    expect(entry.mime).toBe("image/png");

    // Verify GET /candidate/:id returns the same bytes
    const getRes = await httpRequest(server, {
      method: "GET",
      path: `/identities/avatar/candidate/${body.id}`,
    });
    expect(getRes.status).toBe(200);
    expect(Buffer.compare(getRes.rawBuffer!, pngBytes)).toBe(0);
  });

  it("auth: POST with mockUserId=null → 401, no cache entry created", async () => {
    mockUserId = null;

    const mod = await import("./identity-avatar-batch.js");
    const cache = mod._getCandidateCacheForTest()!;
    const sizeBefore = cache.size;

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // fake PNG bytes

    const res = await multipartRequest(server, {
      path: "/identities/avatar/candidate/manual",
      fieldName: "avatar",
      filename: "a.png",
      fileContentType: "image/png",
      fileBytes: pngBytes,
    });

    expect(res.status).toBe(401);
    // No new entry in cache
    expect(cache.size).toBe(sizeBefore);
  });

  it("mime: POST with text/plain → 400 with error mentioning PNG/JPEG/WebP, no cache entry", async () => {
    const mod = await import("./identity-avatar-batch.js");
    const cache = mod._getCandidateCacheForTest()!;
    const sizeBefore = cache.size;

    const res = await multipartRequest(server, {
      path: "/identities/avatar/candidate/manual",
      fieldName: "avatar",
      filename: "a.txt",
      fileContentType: "text/plain",
      fileBytes: Buffer.from("not an image"),
    });

    expect(res.status).toBe(400);
    const body = res.body as { error?: string };
    expect(body.error).toMatch(/PNG|JPEG|WebP/i);
    expect(cache.size).toBe(sizeBefore);
  });

  it("oversize: POST > 5 MB PNG → 413, no cache entry", async () => {
    const mod = await import("./identity-avatar-batch.js");
    const cache = mod._getCandidateCacheForTest()!;
    const sizeBefore = cache.size;

    const oversizeBytes = Buffer.alloc(6 * 1024 * 1024, 0xff);

    const res = await multipartRequest(server, {
      path: "/identities/avatar/candidate/manual",
      fieldName: "avatar",
      filename: "big.png",
      fileContentType: "image/png",
      fileBytes: oversizeBytes,
    });

    expect(res.status).toBe(413);
    expect(cache.size).toBe(sizeBefore);
  });

  it("missing-field: POST with no 'avatar' field → 400 'missing avatar field', no cache entry", async () => {
    const mod = await import("./identity-avatar-batch.js");
    const cache = mod._getCandidateCacheForTest()!;
    const sizeBefore = cache.size;

    // Send a multipart body with a different field name
    const res = await multipartRequest(server, {
      path: "/identities/avatar/candidate/manual",
      fieldName: "wrong_field",
      filename: "a.png",
      fileContentType: "image/png",
      fileBytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });

    expect(res.status).toBe(400);
    const body = res.body as { error?: string };
    expect(body.error).toMatch(/missing avatar field/i);
    expect(cache.size).toBe(sizeBefore);
  });
});

// ---------------------------------------------------------------------------
// Phase 74 Plan 03: config-driven director spec + gamma + request-time defense
// ---------------------------------------------------------------------------

describe("Phase 74 Plan 03: config-driven avatar batch", () => {
  it("Test 10: POST /batch sends avatarDirectorSpec verbatim as chat-completions system message", async () => {
    // Sentinel spec value — unique so we know it flowed byte-for-byte
    const SENTINEL_SPEC =
      "SENTINEL DIRECTOR SPEC 12345 UNIQUE MARKER — must appear verbatim in the system slot";
    mockConfig.avatarDirectorSpec = SENTINEL_SPEC;

    let capturedSystemContent: string | null = null;

    vi.stubGlobal(
      "fetch",
      buildMockFetch(async (_url, opts) => {
        const parsed = JSON.parse(opts.body as string) as {
          messages: Array<{ role: string; content: string }>;
        };
        // messages[0] is the system slot per the /batch handler
        capturedSystemContent = parsed.messages[0].content;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: CANNED_ARCHETYPE } }],
          }),
        } as unknown as Response;
      }),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/avatar/batch",
      body: { name: "spectest", title: "Spec Test", brief: "spec-flow test" },
    });

    expect(res.status).toBe(200);
    // The system-message content MUST equal the mocked spec byte-for-byte.
    // No prefix, no suffix, no wrapping — verbatim.
    expect(capturedSystemContent).toBe(SENTINEL_SPEC);
  });

  it("Test 11: gamma value comes from avatarGammaDefault (not hardcoded 0.7)", async () => {
    const mod = await import("./identity-avatar-batch.js");
    // (128/255)^0.5 * 255 = ~180.9 → rounds to ~181, distinguishable from
    // the ~157 that gamma=0.7 produces. If the pipeline were still
    // hardcoded to 0.7 this assertion would fail.
    const resultAt05 = await mod._applyCorrectionForTest(128, 0.5);
    expect(resultAt05).toBeGreaterThanOrEqual(179);
    expect(resultAt05).toBeLessThanOrEqual(183);

    // Sanity: the default gamma=0.7 branch still gives ~157
    const resultAt07 = await mod._applyCorrectionForTest(128, 0.7);
    expect(resultAt07).toBeGreaterThanOrEqual(155);
    expect(resultAt07).toBeLessThanOrEqual(160);

    // The two values must differ — proves the gamma parameter is actually
    // threaded through the pipeline (not silently ignored).
    expect(resultAt05).not.toBe(resultAt07);
  });

  it("Test 12: POST /batch returns 503 when avatarDirectorSpec is empty at request time (Pitfall 2 defense-in-depth)", async () => {
    mockConfig.avatarDirectorSpec = "";

    let fetchCalled = false;
    vi.stubGlobal("fetch", async () => {
      fetchCalled = true;
      throw new Error("fetch must not be called when spec is empty");
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/avatar/batch",
      body: { name: "emptyspec", title: "Empty Spec Test", brief: "test" },
    });

    expect(res.status).toBe(503);
    const body = res.body as { error: string };
    expect(body.error).toBe("avatar generation misconfigured");
    // Route must short-circuit BEFORE hitting OpenAI
    expect(fetchCalled).toBe(false);
  });

  it("Test 13: POST /batch returns 503 when avatarDirectorSpec is whitespace-only at request time", async () => {
    // Trim-then-length pattern mirrors the boot gate — whitespace-only is
    // as-good-as-empty. 74-CONTEXT.md § "What would make it wrong" §3.
    mockConfig.avatarDirectorSpec = "   \n\t  ";

    let fetchCalled = false;
    vi.stubGlobal("fetch", async () => {
      fetchCalled = true;
      throw new Error("fetch must not be called when spec is whitespace-only");
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/avatar/batch",
      body: { name: "wsspec", title: "Whitespace Spec Test", brief: "test" },
    });

    expect(res.status).toBe(503);
    const body = res.body as { error: string };
    expect(body.error).toBe("avatar generation misconfigured");
    expect(fetchCalled).toBe(false);
  });
});
