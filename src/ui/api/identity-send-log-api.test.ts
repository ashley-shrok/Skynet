/**
 * Phase 85 Plan 06 Task 2 — stampIdentitySendLog tests.
 *
 * Contract under test:
 *   stampIdentitySendLog(identityName: string, ts?: number): void
 *   - Fires POST /identity-send-log/stamp via authApi.post
 *   - Body: { identityName, ts: ts ?? Date.now() }
 *   - NEVER propagates errors (attempts count per D-05 — network failure
 *     must not gate the caller's send flow)
 *   - Skips the POST on null/empty identityName (defense-in-depth guard)
 *
 * Mocking strategy mirrors editable-file-api.test.ts: vi.mock @/main-axios
 * at module scope, drive authApi.post per test via mockResolvedValue /
 * mockRejectedValue.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mock (hoisted — precedes any import of the mocked module) ───────

vi.mock("@/main-axios", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    authApi: {
      post: vi.fn(),
    },
  };
});

// ── Late imports (after mocks are registered) ──────────────────────────────

import { stampIdentitySendLog } from "./identity-send-log-api";
import { authApi } from "@/main-axios";

describe("stampIdentitySendLog — fire-and-forget POST /identity-send-log/stamp", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: resolve to a benign 204-shaped response.
    (authApi.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 204,
      data: undefined,
    });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("Test 1: fires POST with body { identityName, ts: ~Date.now() } when ts omitted", () => {
    const before = Date.now();
    stampIdentitySendLog("ivy");
    const after = Date.now();

    expect(authApi.post).toHaveBeenCalledTimes(1);
    const [url, body] = (authApi.post as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { identityName: string; ts: number },
    ];
    expect(url).toBe("/identity-send-log/stamp");
    expect(body.identityName).toBe("ivy");
    expect(typeof body.ts).toBe("number");
    expect(body.ts).toBeGreaterThanOrEqual(before);
    expect(body.ts).toBeLessThanOrEqual(after);
  });

  it("Test 2: forwards explicit ts verbatim to POST body", () => {
    stampIdentitySendLog("ivy", 1234567890000);

    expect(authApi.post).toHaveBeenCalledTimes(1);
    expect(authApi.post).toHaveBeenCalledWith("/identity-send-log/stamp", {
      identityName: "ivy",
      ts: 1234567890000,
    });
  });

  it("Test 3: does NOT throw when authApi.post rejects with a network error", async () => {
    (authApi.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network unreachable"),
    );

    expect(() => stampIdentitySendLog("ivy")).not.toThrow();
    // The POST was still fired (rejection is captured by inner .catch).
    expect(authApi.post).toHaveBeenCalledTimes(1);
    expect(authApi.post).toHaveBeenCalledWith("/identity-send-log/stamp", {
      identityName: "ivy",
      ts: expect.any(Number),
    });

    // Give the microtask queue a beat so the .catch handler runs before
    // the test ends (otherwise vitest can log an unhandled-rejection warning).
    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalled();
  });

  it("Test 4: does NOT throw when authApi.post rejects with a 500-shaped error", async () => {
    (authApi.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 500, data: { error: "failed to stamp send log" } },
      message: "Request failed with status code 500",
    });

    expect(() => stampIdentitySendLog("ivy", 42)).not.toThrow();
    expect(authApi.post).toHaveBeenCalledTimes(1);
    expect(authApi.post).toHaveBeenCalledWith("/identity-send-log/stamp", {
      identityName: "ivy",
      ts: 42,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalled();
  });

  it("Test 5: skips POST + warns when identityName is empty string or null", () => {
    stampIdentitySendLog("");
    expect(authApi.post).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockClear();

    // Simulate the null/undefined case (call-site fail-safe — TypeScript
    // wouldn't allow this at compile time, but the runtime guard still
    // protects against JS callers or props typing gaps).
    stampIdentitySendLog(null as unknown as string);
    expect(authApi.post).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});
