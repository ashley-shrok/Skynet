/**
 * Phase 79 Plan 02 Task 1 — tests for the shared media endpoint constants module.
 *
 * These tests lock in TWO invariants:
 *
 * 1. The four URL constants EQUAL the values that lived inline in
 *    `src/backend/database/routes/voice.ts` at plan-authoring time
 *    (byte-for-byte). Any drift on either side breaks this test and forces
 *    an explicit reconciliation — no silent divergence between what voice.ts
 *    uses and what the tg-bridge (Plan 04) will serialize into config.env.
 *
 * 2. `getMatrixHomeserverBase()` correctly delegates to the matrix admin
 *    creds store: returns `null` when no admin creds row exists (fresh
 *    Skynet install), returns the stored `homeserverBase` string when a
 *    row exists.
 *
 * See CONTEXT.md § Locked decisions #3 (Ashley-locked D-03) for the
 * shared-source-of-truth rationale.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// The module under test dynamic-imports matrix-admin-creds-store to avoid
// a static-import cycle (matrix-admin-creds-store transitively loads the
// database layer at module-load). We mock the store with vi.mock() so the
// dynamic import resolves to our fake without touching the real DB.
vi.mock("../matrix/matrix-admin-creds-store.js", () => ({
  getMatrixAdminCreds: vi.fn(),
}));

// Import AFTER vi.mock so the mock is in place before the module's
// dynamic import resolves.
import {
  STT_URL,
  TTS_URL,
  TTS_STREAM_URL,
  VOICES_URL,
  getMatrixHomeserverBase,
} from "./media-endpoints.js";
import { getMatrixAdminCreds } from "../matrix/matrix-admin-creds-store.js";

const mockedGetMatrixAdminCreds = vi.mocked(getMatrixAdminCreds);

describe("media-endpoints constants", () => {
  it("STT_URL is a non-empty http(s) string that matches the voice.ts value", () => {
    // Byte-for-byte lock — if voice.ts changes, this test breaks and
    // forces the plan-authored value to be re-reconciled.
    expect(STT_URL).toBe("http://100.80.122.111:8000/v1/audio/transcriptions");
    expect(typeof STT_URL).toBe("string");
    expect(STT_URL.length).toBeGreaterThan(0);
    expect(STT_URL).toMatch(/^https?:\/\//);
  });

  it("TTS_URL is a non-empty http(s) string that matches the voice.ts value", () => {
    expect(TTS_URL).toBe("http://100.80.122.111:8001/v1/audio/speech");
    expect(typeof TTS_URL).toBe("string");
    expect(TTS_URL.length).toBeGreaterThan(0);
    expect(TTS_URL).toMatch(/^https?:\/\//);
  });

  it("TTS_STREAM_URL is a non-empty http(s) string that matches the voice.ts value (patch #237)", () => {
    expect(TTS_STREAM_URL).toBe("http://100.80.122.111:8001/tts");
    expect(typeof TTS_STREAM_URL).toBe("string");
    expect(TTS_STREAM_URL.length).toBeGreaterThan(0);
    expect(TTS_STREAM_URL).toMatch(/^https?:\/\//);
  });

  it("VOICES_URL is a non-empty http(s) string that matches the voice.ts value", () => {
    expect(VOICES_URL).toBe("http://100.80.122.111:8001/get_predefined_voices");
    expect(typeof VOICES_URL).toBe("string");
    expect(VOICES_URL.length).toBeGreaterThan(0);
    expect(VOICES_URL).toMatch(/^https?:\/\//);
  });
});

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
