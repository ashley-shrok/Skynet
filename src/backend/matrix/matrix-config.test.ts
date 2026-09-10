/**
 * Phase 98 Plan 10 Task 1 — matrix-config unit tests.
 *
 * Ported from `src/backend/config/media-endpoints.test.ts`
 * (getMatrixHomeserverBase-specific cases). The STT_URL / TTS_URL /
 * TTS_STREAM_URL / VOICES_URL constant cases from the old test file
 * are INTENTIONALLY NOT ported — those exports were the Chatterbox
 * URL layer and have been deleted as part of D-Kill-list.
 *
 * getMatrixHomeserverBase's behavior is a byte-for-byte carry-over: it
 * still delegates to matrix-admin-creds-store; still returns null when
 * no admin creds row exists; still returns the stored `homeserverBase`
 * string otherwise; still typed Promise<string | null>.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// The module under test dynamic-imports matrix-admin-creds-store to avoid
// a static-import cycle (matrix-admin-creds-store transitively loads the
// database layer at module-load). We mock the store with vi.mock() so the
// dynamic import resolves to our fake without touching the real DB.
vi.mock("./matrix-admin-creds-store.js", () => ({
  getMatrixAdminCreds: vi.fn(),
}));

// Import AFTER vi.mock so the mock is in place before the module's
// dynamic import resolves.
import { getMatrixHomeserverBase } from "./matrix-config.js";
import { getMatrixAdminCreds } from "./matrix-admin-creds-store.js";

const mockedGetMatrixAdminCreds = vi.mocked(getMatrixAdminCreds);

describe("getMatrixHomeserverBase()", () => {
  beforeEach(() => {
    mockedGetMatrixAdminCreds.mockReset();
  });

  it("returns null when no admin creds row exists (fresh Skynet)", async () => {
    mockedGetMatrixAdminCreds.mockResolvedValueOnce(null);

    const base = await getMatrixHomeserverBase();

    expect(base).toBeNull();
    expect(mockedGetMatrixAdminCreds).toHaveBeenCalledTimes(1);
  });

  it("returns the stored homeserverBase when a row exists", async () => {
    mockedGetMatrixAdminCreds.mockResolvedValueOnce({
      homeserverBase: "http://100.113.23.63:8008",
      userId: "@skynet-admin:thenasty.taild9b663.ts.net",
      accessToken: "syt_dummy_token",
      password: "dummy-password",
    });

    const base = await getMatrixHomeserverBase();

    expect(base).toBe("http://100.113.23.63:8008");
    expect(mockedGetMatrixAdminCreds).toHaveBeenCalledTimes(1);
  });

  it("has the return type Promise<string | null> (compile-time check)", async () => {
    mockedGetMatrixAdminCreds.mockResolvedValueOnce(null);

    // If getMatrixHomeserverBase were typed differently (e.g. Promise<string>
    // or Promise<string | undefined>), this line would fail to compile.
    const _typecheck: string | null = await getMatrixHomeserverBase();

    expect(_typecheck).toBeNull();
  });
});
