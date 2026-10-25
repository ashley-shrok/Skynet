// "Confirm it's you": a 403 REAUTH_REQUIRED opens the confirm box, and the
// original request goes again once — only once — after the user confirms.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

const kitConfirmIdentity = vi.fn();
vi.mock("@/components/kit/dialogs", () => ({
  kitConfirmIdentity: (...args: unknown[]) => kitConfirmIdentity(...args),
}));

import { createApiInstance } from "./main-axios";
import type { AxiosInstance } from "axios";

const reauth = (totpRequired: boolean) => [
  403,
  { error: "Confirm it's you to continue.", code: "REAUTH_REQUIRED", totpRequired },
];

describe("confirm-it's-you interceptor", () => {
  let instance: AxiosInstance;
  let mock: MockAdapter;

  beforeEach(() => {
    instance = createApiInstance("http://test.local", "TEST");
    mock = new MockAdapter(instance, { onNoMatch: "throwException" });
    kitConfirmIdentity.mockReset();
  });

  afterEach(() => {
    mock.restore();
  });

  it("asks, then re-sends the original request once confirmed", async () => {
    mock
      .onPatch("/users/session-timeout")
      .replyOnce(...(reauth(true) as [number, unknown]))
      .onPatch("/users/session-timeout")
      .replyOnce(200, { timeoutHours: 48 });
    kitConfirmIdentity.mockResolvedValue(true);

    const res = await instance.patch("/users/session-timeout", { timeoutHours: 48 });

    expect(res.data).toEqual({ timeoutHours: 48 });
    expect(kitConfirmIdentity).toHaveBeenCalledTimes(1);
    expect(kitConfirmIdentity.mock.calls[0][0].needsCode).toBe(true);
    expect(mock.history.patch).toHaveLength(2);
    expect(JSON.parse(mock.history.patch[1].data)).toEqual({ timeoutHours: 48 });
  });

  it("passes on the refusal when the user cancels", async () => {
    mock.onPost("/users/make-admin").reply(...(reauth(false) as [number, unknown]));
    kitConfirmIdentity.mockResolvedValue(false);

    await expect(instance.post("/users/make-admin", { userId: "u" })).rejects.toMatchObject({
      response: { status: 403 },
    });
    expect(kitConfirmIdentity.mock.calls[0][0].needsCode).toBe(false);
    expect(mock.history.post).toHaveLength(1);
  });

  it("asks only once per request, even if the server refuses again", async () => {
    mock.onPost("/users/api-keys").reply(...(reauth(true) as [number, unknown]));
    kitConfirmIdentity.mockResolvedValue(true);

    await expect(instance.post("/users/api-keys", {})).rejects.toMatchObject({
      response: { status: 403 },
    });
    expect(kitConfirmIdentity).toHaveBeenCalledTimes(1);
    expect(mock.history.post).toHaveLength(2);
  });

  it("leaves other 403s alone", async () => {
    mock.onPost("/users/api-keys").reply(403, {
      error: "Access keys can't do it.",
      code: "REAUTH_UNAVAILABLE",
    });
    await expect(instance.post("/users/api-keys", {})).rejects.toMatchObject({
      response: { status: 403 },
    });
    expect(kitConfirmIdentity).not.toHaveBeenCalled();
  });
});
