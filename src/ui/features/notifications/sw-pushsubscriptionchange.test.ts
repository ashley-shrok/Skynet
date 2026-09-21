/**
 * Fix pass M-9 tests for public/sw.js `pushsubscriptionchange` handler.
 *
 * The service worker script is not an ES module — it registers global
 * event handlers on `self`. To exercise the handler in Node, we read the
 * source, capture the handler function via a stub `self.addEventListener`,
 * then invoke it with a synthetic PushSubscriptionChangeEvent shape.
 *
 * Covers M-3's four failure modes (each was silently dropping the new
 * endpoint prior to the fix pass):
 *   1. POST returns 401/5xx → console.warn logged, no throw.
 *   2. fetch() throws → console.warn logged, no throw escapes waitUntil.
 *   3. event.oldSubscription is null → console.warn logged, no fetch call.
 *   4. BASE_PATH substitution non-root → URL correctly prefixed.
 *
 * Also asserts the M-4 notificationclick BASE_PATH prefix as a smoke.
 *
 * Why the raw-source approach: sw.js is not importable as a module (no
 * exports), and its handlers close over `BASE_PATH` set at the top of
 * the file — mocking that constant requires re-evaluating the source
 * with a substituted value.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Path to sw.js relative to repo root (same path served by express.static).
const SW_JS_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "public",
  "sw.js",
);

// ─── Handler-extraction helper ───────────────────────────────────────────────

interface SelfLike {
  addEventListener: (type: string, handler: (event: unknown) => void) => void;
  registration: {
    showNotification: ReturnType<typeof vi.fn>;
    pushManager: {
      subscribe: ReturnType<typeof vi.fn>;
    };
  };
  clients: {
    matchAll: ReturnType<typeof vi.fn>;
    openWindow: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
  };
  skipWaiting: ReturnType<typeof vi.fn>;
  location: { origin: string };
}

interface EvaluatedSw {
  handlers: Map<string, (event: unknown) => void>;
  self: SelfLike;
}

/**
 * Read sw.js from disk, substitute the BASE_PATH template placeholder,
 * evaluate in a sandbox with stubbed globals, and return the registered
 * handlers keyed by event type.
 *
 * The `__SKYNET_SW_BASE_PATH__` placeholder is preserved verbatim in the
 * source as of Phase 128; production substitutes it via a middleware
 * (out of scope of this fix pass). We do the substitution here so the
 * test can assert BASE_PATH-aware behavior.
 */
function evaluateSwWithBasePath(basePath: string): EvaluatedSw {
  const rawSource = readFileSync(SW_JS_PATH, "utf-8");
  const substituted = rawSource.replaceAll(
    "__SKYNET_SW_BASE_PATH__",
    basePath,
  );

  const handlers = new Map<string, (event: unknown) => void>();

  const selfStub: SelfLike = {
    addEventListener: (type, handler) => {
      handlers.set(type, handler);
    },
    registration: {
      showNotification: vi.fn(async () => {}),
      pushManager: {
        subscribe: vi.fn(),
      },
    },
    clients: {
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => {}),
      claim: vi.fn(async () => {}),
    },
    skipWaiting: vi.fn(async () => {}),
    location: { origin: "https://example.test" },
  };

  // Provide harmless stubs for the install/activate handlers so the
  // Function() eval doesn't blow up when they invoke caches / self.
  const cachesStub = {
    open: vi.fn(async () => ({
      addAll: vi.fn(async () => {}),
      put: vi.fn(async () => {}),
    })),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
    match: vi.fn(async () => null),
  };

  const btoaStub = (s: string) => Buffer.from(s, "binary").toString("base64");

  // Evaluate the substituted source inside a Function() body with
  // sandboxed globals injected via arguments. Not using node:vm because
  // vitest's transform pipeline can trip on it; Function-eval is
  // sufficient for handler extraction and keeps the test hermetic.
  const evaluator = new Function(
    "self",
    "caches",
    "btoa",
    "fetch",
    "console",
    substituted,
  );
  // fetch is set per-test via global.fetch — pass through.
  evaluator(
    selfStub,
    cachesStub,
    btoaStub,
    (...args: unknown[]) => (global.fetch as (...a: unknown[]) => unknown)(...args),
    console,
  );

  return { handlers, self: selfStub };
}

// ─── Test fixtures ───────────────────────────────────────────────────────────

function fakeSubscription(endpoint = "https://push.example/e/123") {
  const key = new Uint8Array([1, 2, 3, 4]);
  return {
    endpoint,
    getKey: (_name: string) => key.buffer,
  } as unknown as PushSubscription;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("sw.js pushsubscriptionchange handler (M-3 hardening)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    originalFetch = global.fetch;
  });

  afterEach(() => {
    warnSpy.mockRestore();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("Case 1 (M-3): POST returns 401 → warn logged, no throw", async () => {
    const { handlers, self } = evaluateSwWithBasePath("");
    self.registration.pushManager.subscribe = vi
      .fn()
      .mockResolvedValue(fakeSubscription());

    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
    })) as unknown as typeof global.fetch;

    const handler = handlers.get("pushsubscriptionchange");
    expect(handler).toBeTypeOf("function");

    // Capture the waitUntil promise so we can await the internal async work.
    let waitUntilPromise: Promise<unknown> | null = null;
    const event = {
      oldSubscription: {
        options: {
          applicationServerKey: new Uint8Array([9, 9, 9]),
        },
      },
      newSubscription: null,
      waitUntil: (p: Promise<unknown>) => {
        waitUntilPromise = p;
      },
    };

    handler!(event);
    expect(waitUntilPromise).not.toBeNull();
    await waitUntilPromise;

    // fetch was called once with the un-prefixed URL (BASE_PATH === "").
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // warn was logged with the POST-failure phrase.
    const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      warnCalls.some((s) => s.includes("pushsubscriptionchange POST failed")),
    ).toBe(true);
    expect(warnCalls.some((s) => s.includes("status=401"))).toBe(true);
  });

  it("Case 2 (M-3): fetch throws → warn logged, no throw escapes waitUntil", async () => {
    const { handlers, self } = evaluateSwWithBasePath("");
    self.registration.pushManager.subscribe = vi
      .fn()
      .mockResolvedValue(fakeSubscription());

    global.fetch = vi.fn(async () => {
      throw new Error("net::ERR_CONNECTION_REFUSED");
    }) as unknown as typeof global.fetch;

    let waitUntilPromise: Promise<unknown> | null = null;
    const event = {
      oldSubscription: {
        options: { applicationServerKey: new Uint8Array([9, 9, 9]) },
      },
      newSubscription: null,
      waitUntil: (p: Promise<unknown>) => {
        waitUntilPromise = p;
      },
    };

    const handler = handlers.get("pushsubscriptionchange");
    handler!(event);
    // MUST resolve, not reject — try/catch inside the handler absorbs.
    await expect(waitUntilPromise).resolves.toBeUndefined();

    const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      warnCalls.some((s) => s.includes("pushsubscriptionchange threw")),
    ).toBe(true);
    expect(
      warnCalls.some((s) => s.includes("ERR_CONNECTION_REFUSED")),
    ).toBe(true);
  });

  it("Case 3 (M-3): oldSubscription is null → warn logged, no fetch call, no throw", async () => {
    const { handlers, self } = evaluateSwWithBasePath("");
    self.registration.pushManager.subscribe = vi.fn();
    global.fetch = vi.fn() as unknown as typeof global.fetch;

    let waitUntilPromise: Promise<unknown> | null = null;
    const event = {
      oldSubscription: null,
      newSubscription: null,
      waitUntil: (p: Promise<unknown>) => {
        waitUntilPromise = p;
      },
    };

    const handler = handlers.get("pushsubscriptionchange");
    handler!(event);
    await expect(waitUntilPromise).resolves.toBeUndefined();

    // pushManager.subscribe MUST NOT be invoked without applicationServerKey.
    expect(self.registration.pushManager.subscribe).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      warnCalls.some((s) =>
        s.includes("null oldSubscription"),
      ),
    ).toBe(true);
  });

  it("Case 4 (M-3): BASE_PATH non-root → POST URL correctly prefixed", async () => {
    const { handlers, self } = evaluateSwWithBasePath("/skynet");
    self.registration.pushManager.subscribe = vi
      .fn()
      .mockResolvedValue(fakeSubscription());

    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 201,
    })) as unknown as typeof global.fetch;

    let waitUntilPromise: Promise<unknown> | null = null;
    const event = {
      oldSubscription: {
        options: { applicationServerKey: new Uint8Array([9, 9, 9]) },
      },
      newSubscription: null,
      waitUntil: (p: Promise<unknown>) => {
        waitUntilPromise = p;
      },
    };

    const handler = handlers.get("pushsubscriptionchange");
    handler!(event);
    await waitUntilPromise;

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [urlArg] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(urlArg).toBe("/skynet/push-subscriptions");
    // POST succeeded — no warn.
    const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      warnCalls.filter((s) => s.includes("pushsubscriptionchange")).length,
    ).toBe(0);
  });

  it("M-4 smoke: notificationclick targetUrl is prefixed with BASE_PATH", async () => {
    const { handlers, self } = evaluateSwWithBasePath("/skynet");
    const clientFocus = vi.fn(async () => {});
    const clientNavigate = vi.fn(async () => {});
    self.clients.matchAll = vi.fn(async () => [
      { focus: clientFocus, navigate: clientNavigate },
    ]);

    let waitUntilPromise: Promise<unknown> | null = null;
    const event = {
      notification: {
        close: vi.fn(),
        data: { roomId: "!room:server" },
      },
      waitUntil: (p: Promise<unknown>) => {
        waitUntilPromise = p;
      },
    };

    const handler = handlers.get("notificationclick");
    expect(handler).toBeTypeOf("function");
    handler!(event);
    await waitUntilPromise;

    expect(clientNavigate).toHaveBeenCalledTimes(1);
    const navUrl = clientNavigate.mock.calls[0][0];
    // encodeURIComponent preserves `!` (RFC 3986 unreserved sub-delim) but
    // encodes `:` → `%3A`. Both branches must be prefixed with BASE_PATH.
    expect(navUrl).toBe("/skynet/?openRoom=!room%3Aserver");
  });

  it("M-5 smoke: push handler showNotification is called WITHOUT a tag field", async () => {
    const { handlers, self } = evaluateSwWithBasePath("");

    let waitUntilPromise: Promise<unknown> | null = null;
    const event = {
      data: {
        json: () => ({
          title: "Fanny:",
          body: "hey",
          roomId: "!room:server",
          agentMxid: "@fanny:server",
        }),
      },
      waitUntil: (p: Promise<unknown>) => {
        waitUntilPromise = p;
      },
    };

    const handler = handlers.get("push");
    expect(handler).toBeTypeOf("function");
    handler!(event);
    await waitUntilPromise;

    expect(self.registration.showNotification).toHaveBeenCalledTimes(1);
    const [, opts] = (
      self.registration.showNotification as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    // The whole point of M-5: no tag → two messages in the same room
    // each get their own notification, no replace.
    expect(opts).not.toHaveProperty("tag");
    expect(opts).not.toHaveProperty("renotify");
    // Sanity: body + data still populated.
    expect(opts.body).toBe("hey");
    expect(opts.data).toEqual({
      roomId: "!room:server",
      agentMxid: "@fanny:server",
    });
  });
});
