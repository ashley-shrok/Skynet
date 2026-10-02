/**
 * Phase 144 Plan 02 Task 3 — ntfy-bootstrap tests.
 *
 * Tests exercise ensureSkynetPublisherUserExists from ntfy-bootstrap.ts —
 * a belt-and-suspenders safety net that attempts to create the ntfy admin
 * user at backend startup. The primary provisioning path is docker/ntfy/server.yml
 * from plan 01 task 1 (HC-1 clarification).
 *
 * Test coverage:
 *   NB-01: ensureSkynetPublisherUserExists uses getNtfyAdminUser() (NOT "skynet-publisher")
 *          and swallows 409 Conflict (user already exists — expected from server.yml)
 *   NB-02: ensureSkynetPublisherUserExists logs warning but does NOT throw on other errors
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Logger mock ───────────────────────────────────────────────────────────────
const mockWarn = vi.fn();
const mockInfo = vi.fn();
vi.mock("../utils/logger.js", () => ({
  databaseLogger: { warn: mockWarn, info: mockInfo, error: vi.fn() },
  systemLogger: { warn: mockWarn, info: mockInfo, error: vi.fn() },
}));

// ── ntfy-config mock ───────────────────────────────────────────────────────────
vi.mock("./ntfy-config.js", () => ({
  getNtfyAdminUser: () => "my-actual-admin-user",
  getNtfyAdminPassword: () => "my-actual-admin-pass",
  getNtfyInternalPublishUrl: () => "http://ntfy:2586",
  getNtfyPublishToken: () => "tk_testtoken",
  getNtfyBaseUrl: () => "https://example.com/ntfy",
  assertNtfyConfigAtBoot: vi.fn(),
}));

// ── ntfy-admin-client mock ────────────────────────────────────────────────────
const mockCreateNtfyUser = vi.fn();
vi.mock("./ntfy-admin-client.js", () => ({
  createNtfyUser: (...args: unknown[]) => mockCreateNtfyUser(...args),
  NtfyAdminError: class NtfyAdminError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "NtfyAdminError";
      this.status = status;
    }
  },
  deleteNtfyUser: vi.fn(),
  grantTopicReadAccess: vi.fn(),
  revokeTopicAccess: vi.fn(),
  mintUserToken: vi.fn(),
}));

describe("Phase 144-02 Task 3 — ntfy-bootstrap (NB-01..NB-02)", () => {
  beforeEach(() => {
    mockCreateNtfyUser.mockReset();
    mockWarn.mockReset();
    mockInfo.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("NB-01: ensureSkynetPublisherUserExists calls createNtfyUser with getNtfyAdminUser() (NOT 'skynet-publisher') and swallows 409 Conflict", async () => {
    // Normal case: server.yml already created the admin user → ntfy returns 409
    const { NtfyAdminError } = await import("./ntfy-admin-client.js");
    mockCreateNtfyUser.mockRejectedValue(new NtfyAdminError(409, "user already exists"));

    const { ensureSkynetPublisherUserExists } = await import("./ntfy-bootstrap.js");
    // Must NOT throw
    await expect(ensureSkynetPublisherUserExists()).resolves.toBeUndefined();

    // Must have called createNtfyUser with "my-actual-admin-user" (from getNtfyAdminUser())
    // NOT with the hardcoded string "skynet-publisher"
    expect(mockCreateNtfyUser).toHaveBeenCalledOnce();
    const [username] = mockCreateNtfyUser.mock.calls[0] as [string, string];
    expect(username).toBe("my-actual-admin-user");
    expect(username).not.toBe("skynet-publisher");

    // 409 should be logged as info (expected case), not warn
    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining("already exists"),
      expect.anything(),
    );
  });

  it("NB-01b: ensureSkynetPublisherUserExists resolves normally when createNtfyUser succeeds (fresh install)", async () => {
    mockCreateNtfyUser.mockResolvedValue(undefined);

    const { ensureSkynetPublisherUserExists } = await import("./ntfy-bootstrap.js");
    await expect(ensureSkynetPublisherUserExists()).resolves.toBeUndefined();
  });

  it("NB-02: ensureSkynetPublisherUserExists logs warning but does NOT throw on non-409 errors", async () => {
    const { NtfyAdminError } = await import("./ntfy-admin-client.js");
    mockCreateNtfyUser.mockRejectedValue(new NtfyAdminError(500, "internal server error"));

    const { ensureSkynetPublisherUserExists } = await import("./ntfy-bootstrap.js");
    // Must NOT throw — backend startup must not fail due to ntfy being slow
    await expect(ensureSkynetPublisherUserExists()).resolves.toBeUndefined();

    // Must log a warning
    expect(mockWarn).toHaveBeenCalledOnce();
  });

  it("NB-02b: ensureSkynetPublisherUserExists logs warning on network errors (ntfy slow to start)", async () => {
    mockCreateNtfyUser.mockRejectedValue(new Error("connection refused"));

    const { ensureSkynetPublisherUserExists } = await import("./ntfy-bootstrap.js");
    // Must NOT throw
    await expect(ensureSkynetPublisherUserExists()).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalledOnce();
  });
});
