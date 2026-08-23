// ─── main-axios.test.ts — RED tests for axios retry interceptor (Phase 54-01) ─
//
// TDD RED: These tests import computeBackoffMs, isRetryable, and createApiInstance
// from ./main-axios. computeBackoffMs and isRetryable do NOT exist yet in that
// module — this causes the test run to fail at the import/resolution stage, which
// IS the intended RED state.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AxiosError, AxiosRequestConfig } from "axios";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";

// ─── Mocks (declare BEFORE importing the module under test) ──────────────────

vi.mock("@/lib/db-health-monitor", () => {
  const reportDatabaseSuccess = vi.fn();
  const reportDatabaseError = vi.fn();
  const reportSessionExpired = vi.fn();
  const isDegraded = vi.fn().mockReturnValue(false);
  return {
    dbHealthMonitor: {
      reportDatabaseSuccess,
      reportDatabaseError,
      reportSessionExpired,
      isDegraded,
      on: vi.fn(),
      off: vi.fn(),
    },
  };
});

vi.mock("@/lib/frontend-logger", () => {
  const mockLogger = {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
    requestStart: vi.fn(),
    requestSuccess: vi.fn(),
    requestError: vi.fn(),
    networkError: vi.fn(),
    authError: vi.fn(),
  };
  return {
    apiLogger: mockLogger,
    authLogger: mockLogger,
    sshLogger: mockLogger,
    tunnelLogger: mockLogger,
    fileLogger: mockLogger,
    statsLogger: mockLogger,
    systemLogger: mockLogger,
    dashboardLogger: mockLogger,
  };
});

// Mock browser APIs not available in jsdom
vi.mock("@/lib/base-path", () => ({
  getBasePath: vi.fn().mockReturnValue(""),
}));

vi.mock("@/lib/electron", () => ({
  isElectron: vi.fn().mockReturnValue(false),
}));

vi.mock("@/shell/TabContext", () => ({
  clearSkynetSessionStorage: vi.fn(),
}));

// Stub sonner toast to avoid import errors in jsdom
vi.mock("sonner", () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// ─── Import module under test AFTER mocks ────────────────────────────────────
// computeBackoffMs and isRetryable do NOT exist yet — this is intentionally RED.
import {
  computeBackoffMs,
  isRetryable,
  createApiInstance,
} from "./main-axios";

import { dbHealthMonitor } from "@/lib/db-health-monitor";
import { apiLogger } from "@/lib/frontend-logger";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: computeBackoffMs (full-jitter shape)
// ─────────────────────────────────────────────────────────────────────────────

describe("computeBackoffMs (full-jitter shape)", () => {
  it("attempt=1: 100 samples all fall in [0, 600)", () => {
    // attempt=1 → range [0, 300 * 2^1) = [0, 600)
    for (let i = 0; i < 100; i++) {
      const ms = computeBackoffMs(1);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThan(600);
    }
  });

  it("attempt=2: 100 samples all fall in [0, 1200)", () => {
    // attempt=2 → range [0, 300 * 2^2) = [0, 1200)
    for (let i = 0; i < 100; i++) {
      const ms = computeBackoffMs(2);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThan(1200);
    }
  });

  it("attempt=1: mean of 500 samples is in [200, 400] proving uniform distribution not clumped", () => {
    // Full-jitter uniform [0, 600) → mean ≈ 300 (midpoint)
    let sum = 0;
    for (let i = 0; i < 500; i++) {
      sum += computeBackoffMs(1);
    }
    const mean = sum / 500;
    expect(mean).toBeGreaterThan(200);
    expect(mean).toBeLessThan(400);
  });

  it("attempt=2: mean of 500 samples is in [500, 700] proving uniform distribution not clumped", () => {
    // Full-jitter uniform [0, 1200) → mean ≈ 600 (midpoint)
    let sum = 0;
    for (let i = 0; i < 500; i++) {
      sum += computeBackoffMs(2);
    }
    const mean = sum / 500;
    expect(mean).toBeGreaterThan(500);
    expect(mean).toBeLessThan(700);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: isRetryable (classification tree)
// ─────────────────────────────────────────────────────────────────────────────

function makeError(overrides: {
  code?: string;
  status?: number;
  response?: unknown;
  method?: string;
}): AxiosError {
  const error = new Error("test error") as AxiosError;
  error.isAxiosError = true;
  error.code = overrides.code;
  if (overrides.status !== undefined || overrides.response !== undefined) {
    error.response = (overrides.response ?? {
      status: overrides.status,
      data: {},
      headers: {},
      config: {} as AxiosRequestConfig,
      statusText: "Error",
    }) as AxiosError["response"];
    if (error.response && overrides.status !== undefined) {
      (error.response as { status: number }).status = overrides.status;
    }
  } else {
    error.response = undefined;
  }
  return error;
}

function makeConfig(overrides: {
  method?: string;
  __noRetry?: boolean;
  __silentRetry?: boolean;
}): AxiosRequestConfig & { __noRetry?: boolean; __silentRetry?: boolean } {
  return {
    method: overrides.method ?? "GET",
    url: "/test",
    __noRetry: overrides.__noRetry,
    __silentRetry: overrides.__silentRetry,
  };
}

describe("isRetryable (classification tree)", () => {
  // ─── GET + network errors ─────────────────────────────────────────────────

  it("GET + ECONNREFUSED → true", () => {
    const error = makeError({ code: "ECONNREFUSED" });
    const config = makeConfig({ method: "GET" });
    expect(isRetryable(error, config)).toBe(true);
  });

  it("GET + ERR_NETWORK with response=undefined → true", () => {
    const error = makeError({ code: "ERR_NETWORK" });
    // response is undefined (connection-level failure)
    expect(error.response).toBeUndefined();
    const config = makeConfig({ method: "GET" });
    expect(isRetryable(error, config)).toBe(true);
  });

  it("GET + ETIMEDOUT → true", () => {
    const error = makeError({ code: "ETIMEDOUT" });
    const config = makeConfig({ method: "GET" });
    expect(isRetryable(error, config)).toBe(true);
  });

  // ─── GET + 5xx status ────────────────────────────────────────────────────

  it("GET + 502 status → true", () => {
    const error = makeError({ status: 502 });
    const config = makeConfig({ method: "GET" });
    expect(isRetryable(error, config)).toBe(true);
  });

  it("GET + 503 status → true", () => {
    const error = makeError({ status: 503 });
    const config = makeConfig({ method: "GET" });
    expect(isRetryable(error, config)).toBe(true);
  });

  it("GET + 504 status → true", () => {
    const error = makeError({ status: 504 });
    const config = makeConfig({ method: "GET" });
    expect(isRetryable(error, config)).toBe(true);
  });

  // ─── GET + non-retryable 5xx ──────────────────────────────────────────────

  it("GET + 500 status → false", () => {
    // 500 is a server bug, no transient shape
    const error = makeError({ status: 500 });
    const config = makeConfig({ method: "GET" });
    expect(isRetryable(error, config)).toBe(false);
  });

  it("GET + 501 status → false", () => {
    // not implemented, no transient shape
    const error = makeError({ status: 501 });
    const config = makeConfig({ method: "GET" });
    expect(isRetryable(error, config)).toBe(false);
  });

  // ─── GET + 4xx — never retry ─────────────────────────────────────────────

  it("GET + 401 status → false", () => {
    // 4xx never retries
    const error = makeError({ status: 401 });
    const config = makeConfig({ method: "GET" });
    expect(isRetryable(error, config)).toBe(false);
  });

  it("GET + 400 status → false", () => {
    const error = makeError({ status: 400 });
    const config = makeConfig({ method: "GET" });
    expect(isRetryable(error, config)).toBe(false);
  });

  it("GET + 403 status → false", () => {
    const error = makeError({ status: 403 });
    const config = makeConfig({ method: "GET" });
    expect(isRetryable(error, config)).toBe(false);
  });

  it("GET + 404 status → false", () => {
    const error = makeError({ status: 404 });
    const config = makeConfig({ method: "GET" });
    expect(isRetryable(error, config)).toBe(false);
  });

  it("GET + 409 status → false", () => {
    const error = makeError({ status: 409 });
    const config = makeConfig({ method: "GET" });
    expect(isRetryable(error, config)).toBe(false);
  });

  it("GET + 422 status → false", () => {
    const error = makeError({ status: 422 });
    const config = makeConfig({ method: "GET" });
    expect(isRetryable(error, config)).toBe(false);
  });

  it("GET + 429 status → false", () => {
    const error = makeError({ status: 429 });
    const config = makeConfig({ method: "GET" });
    expect(isRetryable(error, config)).toBe(false);
  });

  // ─── POST idempotency safeguard — 5xx must NOT retry ─────────────────────

  it("POST + 502 status → false", () => {
    // idempotency safeguard — server may have processed
    const error = makeError({ status: 502 });
    const config = makeConfig({ method: "POST" });
    expect(isRetryable(error, config)).toBe(false);
  });

  it("POST + 503 status → false", () => {
    const error = makeError({ status: 503 });
    const config = makeConfig({ method: "POST" });
    expect(isRetryable(error, config)).toBe(false);
  });

  it("POST + 504 status → false", () => {
    const error = makeError({ status: 504 });
    const config = makeConfig({ method: "POST" });
    expect(isRetryable(error, config)).toBe(false);
  });

  // ─── POST + connection-never-established — safe to retry ─────────────────

  it("POST + ECONNREFUSED → true", () => {
    // connection never established, safe to retry
    const error = makeError({ code: "ECONNREFUSED" });
    const config = makeConfig({ method: "POST" });
    expect(isRetryable(error, config)).toBe(true);
  });

  it("POST + ERR_NETWORK with response=undefined → true", () => {
    const error = makeError({ code: "ERR_NETWORK" });
    expect(error.response).toBeUndefined();
    const config = makeConfig({ method: "POST" });
    expect(isRetryable(error, config)).toBe(true);
  });

  // ─── Other non-idempotent methods ─────────────────────────────────────────

  it("PUT + 502 → false", () => {
    const error = makeError({ status: 502 });
    const config = makeConfig({ method: "PUT" });
    expect(isRetryable(error, config)).toBe(false);
  });

  it("PATCH + 502 → false", () => {
    const error = makeError({ status: 502 });
    const config = makeConfig({ method: "PATCH" });
    expect(isRetryable(error, config)).toBe(false);
  });

  it("DELETE + 502 → false", () => {
    const error = makeError({ status: 502 });
    const config = makeConfig({ method: "DELETE" });
    expect(isRetryable(error, config)).toBe(false);
  });

  it("DELETE + ECONNREFUSED → true", () => {
    const error = makeError({ code: "ECONNREFUSED" });
    const config = makeConfig({ method: "DELETE" });
    expect(isRetryable(error, config)).toBe(true);
  });

  // ─── HEAD and OPTIONS treated as GET ──────────────────────────────────────

  it("HEAD + 502 → true", () => {
    // treated as GET
    const error = makeError({ status: 502 });
    const config = makeConfig({ method: "HEAD" });
    expect(isRetryable(error, config)).toBe(true);
  });

  it("OPTIONS + 502 → true", () => {
    // treated as GET
    const error = makeError({ status: 502 });
    const config = makeConfig({ method: "OPTIONS" });
    expect(isRetryable(error, config)).toBe(true);
  });

  // ─── Escape hatches ───────────────────────────────────────────────────────

  it("config.__noRetry === true → false regardless of error", () => {
    // escape hatch
    const error = makeError({ code: "ECONNREFUSED" });
    const config = makeConfig({ method: "GET", __noRetry: true });
    expect(isRetryable(error, config)).toBe(false);
  });

  it("config.__silentRetry === true → false regardless of error", () => {
    // don't double-retry
    const error = makeError({ code: "ECONNREFUSED" });
    const config = makeConfig({ method: "GET", __silentRetry: true });
    expect(isRetryable(error, config)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: retry interceptor integration
// ─────────────────────────────────────────────────────────────────────────────

describe("retry interceptor integration", () => {
  let mock: MockAdapter;
  let instance: ReturnType<typeof axios.create>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress fake timers for integration tests unless specifically needed
    // createApiInstance needs to call document APIs; set up minimal stubs
    if (typeof document === "undefined") {
      return;
    }
    // Create an axios instance via the factory
    // Note: createApiInstance will be exported by Task 2
    instance = createApiInstance("http://test.local", "TEST");
    mock = new MockAdapter(instance, { onNoMatch: "throwException" });
  });

  afterEach(() => {
    mock?.restore();
    vi.useRealTimers();
  });

  it("GET that fails ECONNREFUSED twice then succeeds returns 200 after 3 total attempts", async () => {
    // Use fake timers to avoid actual delays
    vi.useFakeTimers();

    const econnError = new Error("connect ECONNREFUSED") as Error & {
      code: string;
    };
    econnError.code = "ECONNREFUSED";

    let callCount = 0;
    mock.onGet("/data").reply(() => {
      callCount++;
      if (callCount < 3) {
        return [0, null, {}]; // network error (status 0 = network failure in mock-adapter)
      }
      return [200, { ok: true }];
    });

    // Wrap with fake timer advancement
    const requestPromise = instance.get("/data");
    // Advance timers to skip backoff delays
    await vi.runAllTimersAsync();
    const response = await requestPromise;

    expect(response.status).toBe(200);
    expect(callCount).toBe(3);
  });

  it("GET that fails 502 all 3 attempts rejects with the last error and calls dbHealthMonitor.reportDatabaseError", async () => {
    vi.useFakeTimers();

    let callCount = 0;
    mock.onGet("/data").reply(() => {
      callCount++;
      return [502, { error: "Bad Gateway" }];
    });

    const requestPromise = instance.get("/data");
    await vi.runAllTimersAsync();

    await expect(requestPromise).rejects.toThrow();
    expect(callCount).toBe(3);
    // reportDatabaseError called once (after all retries exhausted)
    expect(dbHealthMonitor.reportDatabaseError).toHaveBeenCalledTimes(1);
  });

  it("successful retry (attempt 2 succeeds after attempt 1 ECONNREFUSED) calls dbHealthMonitor.reportDatabaseSuccess", async () => {
    vi.useFakeTimers();

    let callCount = 0;
    mock.onGet("/data").reply(() => {
      callCount++;
      if (callCount === 1) {
        return [0, null]; // network error first attempt
      }
      return [200, { ok: true }];
    });

    const requestPromise = instance.get("/data");
    await vi.runAllTimersAsync();
    const response = await requestPromise;

    expect(response.status).toBe(200);
    expect(dbHealthMonitor.reportDatabaseSuccess).toHaveBeenCalled();
  });

  it("401 SESSION_EXPIRED reaches reportSessionExpired on FIRST attempt with zero retry delay", async () => {
    const start = Date.now();

    mock.onGet("/protected").reply(401, {
      code: "SESSION_EXPIRED",
      error: "Session has expired",
    });

    await expect(instance.get("/protected")).rejects.toBeDefined();

    const elapsed = Date.now() - start;
    // No backoff sleep — must complete in < 50ms
    expect(elapsed).toBeLessThan(50);
    // reportSessionExpired called once
    expect(dbHealthMonitor.reportSessionExpired).toHaveBeenCalledTimes(1);
    // mock called exactly once (no retry)
    expect(mock.history.get.length).toBe(1);
  });

  it("POST that fails 502 rejects on first attempt without retry (idempotency safeguard)", async () => {
    vi.useFakeTimers();

    let callCount = 0;
    mock.onPost("/action").reply(() => {
      callCount++;
      return [502, { error: "Bad Gateway" }];
    });

    const requestPromise = instance.post("/action", { data: "test" });
    await vi.runAllTimersAsync();

    await expect(requestPromise).rejects.toBeDefined();
    // POST + 502 → no retry → only called once
    expect(callCount).toBe(1);
  });

  it("POST that fails ECONNREFUSED retries up to cap (connection never established)", async () => {
    vi.useFakeTimers();

    let callCount = 0;
    mock.onPost("/action").reply(() => {
      callCount++;
      return [0, null]; // network error (connection never established)
    });

    const requestPromise = instance.post("/action", { data: "test" });
    await vi.runAllTimersAsync();

    await expect(requestPromise).rejects.toBeDefined();
    // POST + ECONNREFUSED → retries up to 3 attempts
    expect(callCount).toBe(3);
  });

  it("config.__noRetry: true suppresses retry even on ECONNREFUSED GET", async () => {
    vi.useFakeTimers();

    let callCount = 0;
    mock.onGet("/data").reply(() => {
      callCount++;
      return [0, null]; // network error
    });

    const requestPromise = instance.get("/data", {
      __noRetry: true,
    } as AxiosRequestConfig & { __noRetry?: boolean });
    await vi.runAllTimersAsync();

    await expect(requestPromise).rejects.toBeDefined();
    // __noRetry → mock called exactly once
    expect(callCount).toBe(1);
  });

  it("every retry attempt emits a structured log line via the resolved logger", async () => {
    vi.useFakeTimers();

    let callCount = 0;
    mock.onGet("/data").reply(() => {
      callCount++;
      return [502, { error: "Bad Gateway" }];
    });

    const requestPromise = instance.get("/data");
    await vi.runAllTimersAsync();
    await expect(requestPromise).rejects.toBeDefined();

    // After 3 attempts (2 retries), there should be 2 per-attempt warn calls
    // with http_retry_attempt and 1 retries_exhausted call
    const warnCalls = vi.mocked(apiLogger.warn).mock.calls;
    const retryAttemptLogs = warnCalls.filter(
      (call) => call[0] === "http_retry_attempt",
    );
    expect(retryAttemptLogs.length).toBeGreaterThanOrEqual(1);
    // Verify the structure of the retry log
    const firstRetryLog = retryAttemptLogs[0];
    const context = firstRetryLog[1] as Record<string, unknown>;
    expect(context).toHaveProperty("requestId");
    expect(context).toHaveProperty("method");
    expect(context).toHaveProperty("url");
    expect(context).toHaveProperty("attempt");
    expect(context).toHaveProperty("delayMs");
    expect(context).toHaveProperty("errorCode");
    expect(context).toHaveProperty("errorMessage");
  });

  it("final give-up emits summary log line with attempts=3 and finalErrorCode", async () => {
    vi.useFakeTimers();

    let callCount = 0;
    mock.onGet("/data").reply(() => {
      callCount++;
      return [502, { error: "Bad Gateway" }];
    });

    const requestPromise = instance.get("/data");
    await vi.runAllTimersAsync();
    await expect(requestPromise).rejects.toBeDefined();

    expect(callCount).toBe(3);

    // Should have a retries_exhausted log with attempts=3
    const warnCalls = vi.mocked(apiLogger.warn).mock.calls;
    const exhaustedLog = warnCalls.find(
      (call) => call[0] === "retries_exhausted",
    );
    expect(exhaustedLog).toBeDefined();
    const exhaustedContext = exhaustedLog![1] as Record<string, unknown>;
    expect(exhaustedContext.attempts).toBe(3);
    expect(exhaustedContext).toHaveProperty("finalErrorCode");
  });
});
