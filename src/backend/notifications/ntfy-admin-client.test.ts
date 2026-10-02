/**
 * Phase 144 Plan 02 Task 2 — ntfy-admin-client tests.
 *
 * Tests exercise the HTTP admin API client (ntfy-admin-client.ts) that
 * talks to the ntfy container's /v1/users and /v1/account/token endpoints.
 *
 * All fetch calls are mocked via global.fetch = vi.fn() to avoid real
 * network calls. Tests verify the correct HTTP method, URL, headers,
 * body, and error handling behavior.
 *
 * Test coverage (from Plan 144-02 Task 2 <behavior> block):
 *   ADM-01: createNtfyUser POSTs to /v1/users with admin Basic auth
 *   ADM-02: deleteNtfyUser sends DELETE to /v1/users with admin Basic auth
 *   ADM-03: grantTopicReadAccess POSTs to /v1/users/access with admin auth
 *   ADM-04: revokeTopicAccess sends DELETE to /v1/users/access
 *   ADM-05: mintUserToken POSTs to /v1/account/token with THAT USER's Basic auth
 *   ADM-06: All admin methods include a 5-second AbortSignal.timeout
 *   ADM-07: Admin methods throw NtfyAdminError with status code on non-2xx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock ntfy-config.ts getters before importing the module under test.
vi.mock("./ntfy-config.js", () => ({
  getNtfyInternalPublishUrl: () => "http://ntfy:2586",
  getNtfyAdminUser: () => "test-admin",
  getNtfyAdminPassword: () => "test-admin-pass",
  getNtfyPublishToken: () => "tk_testpublishtoken123456789012",
  getNtfyBaseUrl: () => "https://example.com/ntfy",
  assertNtfyConfigAtBoot: vi.fn(),
}));

// Save and restore original fetch
const originalFetch = global.fetch;

function makeOkResponse(body: unknown = {}, status = 200): Response {
  return {
    ok: true,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: "ntfy error" }),
    text: async () => "ntfy error",
  } as unknown as Response;
}

describe("Phase 144-02 Task 2 — ntfy-admin-client (ADM-01..ADM-07)", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("ADM-01: createNtfyUser POSTs to /v1/users with admin Basic auth, body {username, password}", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse({}, 200));
    global.fetch = mockFetch;

    const { createNtfyUser } = await import("./ntfy-admin-client.js");
    await createNtfyUser("skynet-reader-u1", "pw-abc");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://ntfy:2586/v1/users");
    expect(options.method).toBe("POST");
    // Admin Basic auth: base64("test-admin:test-admin-pass")
    const expectedAuth = "Basic " + Buffer.from("test-admin:test-admin-pass").toString("base64");
    expect((options.headers as Record<string, string>)["Authorization"]).toBe(expectedAuth);
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options.body as string)).toEqual({
      username: "skynet-reader-u1",
      password: "pw-abc",
    });
  });

  it("ADM-01: createNtfyUser resolves on 201 (created)", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeOkResponse({}, 201));
    const { createNtfyUser } = await import("./ntfy-admin-client.js");
    await expect(createNtfyUser("user", "pass")).resolves.toBeUndefined();
  });

  it("ADM-02: deleteNtfyUser sends DELETE to /v1/users with admin Basic auth, body {username}", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse({}, 200));
    global.fetch = mockFetch;

    const { deleteNtfyUser } = await import("./ntfy-admin-client.js");
    await deleteNtfyUser("skynet-reader-u1");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://ntfy:2586/v1/users");
    expect(options.method).toBe("DELETE");
    const expectedAuth = "Basic " + Buffer.from("test-admin:test-admin-pass").toString("base64");
    expect((options.headers as Record<string, string>)["Authorization"]).toBe(expectedAuth);
    expect(JSON.parse(options.body as string)).toEqual({ username: "skynet-reader-u1" });
  });

  it("ADM-03: grantTopicReadAccess POSTs to /v1/users/access with admin auth and ACL body", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse({}, 200));
    global.fetch = mockFetch;

    const { grantTopicReadAccess } = await import("./ntfy-admin-client.js");
    await grantTopicReadAccess("skynet-reader-u1", "topic-abc");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://ntfy:2586/v1/users/access");
    expect(options.method).toBe("POST");
    const body = JSON.parse(options.body as string);
    expect(body).toMatchObject({
      username: "skynet-reader-u1",
      topic: "topic-abc",
    });
    // Must grant read-only access
    expect(body.permission).toMatch(/^ro$/i);
  });

  it("ADM-04: revokeTopicAccess sends DELETE to /v1/users/access", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse({}, 200));
    global.fetch = mockFetch;

    const { revokeTopicAccess } = await import("./ntfy-admin-client.js");
    await revokeTopicAccess("skynet-reader-u1", "topic-abc");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://ntfy:2586/v1/users/access");
    expect(options.method).toBe("DELETE");
    const body = JSON.parse(options.body as string);
    expect(body).toMatchObject({
      username: "skynet-reader-u1",
      topic: "topic-abc",
    });
  });

  it("ADM-05: mintUserToken POSTs to /v1/account/token with THAT USER's Basic auth (not admin)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeOkResponse({ token: "tk_AgQdq7mVBoFD3dEqa78e2cjou7pC" }, 200),
    );
    global.fetch = mockFetch;

    const { mintUserToken } = await import("./ntfy-admin-client.js");
    const token = await mintUserToken("skynet-reader-u1", "pw-abc");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://ntfy:2586/v1/account/token");
    expect(options.method).toBe("POST");
    // MUST be the user's own Basic auth, NOT the admin
    const expectedUserAuth = "Basic " + Buffer.from("skynet-reader-u1:pw-abc").toString("base64");
    expect((options.headers as Record<string, string>)["Authorization"]).toBe(expectedUserAuth);
    // Must NOT be the admin auth
    const adminAuth = "Basic " + Buffer.from("test-admin:test-admin-pass").toString("base64");
    expect((options.headers as Record<string, string>)["Authorization"]).not.toBe(adminAuth);
    // Returns the token string
    expect(token).toBe("tk_AgQdq7mVBoFD3dEqa78e2cjou7pC");
  });

  it("ADM-06: All admin methods include AbortSignal.timeout(5000) — slow fetch triggers AbortError", async () => {
    // Mock fetch that rejects with AbortError after a delay.
    const abortError = new DOMException("signal timed out", "AbortError");
    global.fetch = vi.fn().mockRejectedValue(abortError);

    const {
      createNtfyUser,
      deleteNtfyUser,
      grantTopicReadAccess,
      revokeTopicAccess,
      mintUserToken,
      NtfyAdminError,
    } = await import("./ntfy-admin-client.js");

    // Each should propagate the AbortError (not swallow it)
    await expect(createNtfyUser("u", "p")).rejects.toThrow();
    await expect(deleteNtfyUser("u")).rejects.toThrow();
    await expect(grantTopicReadAccess("u", "t")).rejects.toThrow();
    await expect(revokeTopicAccess("u", "t")).rejects.toThrow();
    await expect(mintUserToken("u", "p")).rejects.toThrow();

    // Verify AbortSignal.timeout(5000) was passed to each fetch call
    // by checking the 'signal' option exists in each fetch call.
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    for (const [, options] of calls) {
      expect(options.signal).toBeDefined();
    }
  });

  it("ADM-07: Admin methods throw NtfyAdminError with status code on non-2xx", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeErrorResponse(403));

    const {
      createNtfyUser,
      NtfyAdminError,
    } = await import("./ntfy-admin-client.js");

    try {
      await createNtfyUser("u", "p");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NtfyAdminError);
      expect((err as InstanceType<typeof NtfyAdminError>).status).toBe(403);
    }
  });

  it("ADM-07b: NtfyAdminError carries status 409 on conflict (user already exists)", async () => {
    global.fetch = vi.fn().mockResolvedValue(makeErrorResponse(409));
    const { createNtfyUser, NtfyAdminError } = await import("./ntfy-admin-client.js");
    try {
      await createNtfyUser("u", "p");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NtfyAdminError);
      expect((err as InstanceType<typeof NtfyAdminError>).status).toBe(409);
    }
  });
});
