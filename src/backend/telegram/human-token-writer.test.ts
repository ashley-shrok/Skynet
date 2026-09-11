/**
 * Phase 79 Plan 04 Task 1 — human-token-writer unit tests.
 *
 * Covers the four behaviors from PLAN.md § Task 1 <behavior>:
 *   Test 1: happy path — loginAsUser ok → atomic .tmp+rename → mode 0600 →
 *           file contents equal accessToken (no trailing newline).
 *   Test 2: loginAsUser rejected → NO fs write, returns {ok:false, error}.
 *   Test 3: assertSafeHumanName guard rejects `../etc/passwd` and never
 *           touches disk.
 *   Test 4: NEVER logs the Matrix access token value.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// vitest hoists vi.mock() calls above the imports; the mock is set up
// before the module under test loads.
vi.mock("../matrix/matrix-admin-client.js", () => ({
  loginAsUser: vi.fn(),
}));

// Spy on databaseLogger.info / warn to (a) verify structured-log payload
// shape and (b) grep captured payloads for the token value.
const infoSpy = vi.fn();
const warnSpy = vi.fn();
vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    info: (...args: unknown[]) => infoSpy(...args),
    warn: (...args: unknown[]) => warnSpy(...args),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

let tempDir: string;

beforeEach(async () => {
  infoSpy.mockClear();
  warnSpy.mockClear();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-bridge-hti-"));
  process.env.TG_BRIDGE_STATE_DIR_OVERRIDE = tempDir;
  // Reset module cache so shared-volume.ts re-reads the env var, and the
  // writer module re-binds against the new path helpers. Then clear the
  // loginAsUser mock's per-call history (vi.resetModules alone does not
  // reset the mock's call log — that survives across tests and would
  // pollute the "never called" assertion in Test 3).
  vi.resetModules();
  const { loginAsUser } = await import("../matrix/matrix-admin-client.js");
  vi.mocked(loginAsUser).mockClear();
});

afterEach(() => {
  delete process.env.TG_BRIDGE_STATE_DIR_OVERRIDE;
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("human-token-writer", () => {
  it("Test 1: happy path — writes token 0600 with no trailing newline, cleans up .tmp", async () => {
    const { loginAsUser } = await import("../matrix/matrix-admin-client.js");
    vi.mocked(loginAsUser).mockResolvedValue({
      ok: true,
      accessToken: "MOCKTOKEN_ashley_1234",
    });

    const { mintAndWriteHumanToken } = await import("./human-token-writer.js");

    const result = await mintAndWriteHumanToken(
      "@ashley:thenasty.taild9b663.ts.net",
      "alice",
    );

    expect(result).toEqual({ ok: true });
    expect(loginAsUser).toHaveBeenCalledWith(
      "@ashley:thenasty.taild9b663.ts.net",
    );

    const tokenFile = path.join(tempDir, "alice.token");
    expect(fs.existsSync(tokenFile)).toBe(true);

    const contents = fs.readFileSync(tokenFile, "utf8");
    expect(contents).toBe("MOCKTOKEN_ashley_1234"); // no trailing newline
    expect(contents.endsWith("\n")).toBe(false);

    // Mode 0o600 — strip file-type bits with & 0o777.
    const mode = fs.statSync(tokenFile).mode & 0o777;
    expect(mode).toBe(0o600);

    // .tmp cleaned up by rename.
    expect(fs.existsSync(`${tokenFile}.tmp`)).toBe(false);
  });

  it("Test 2: loginAsUser rejected — no fs write, returns {ok:false, error}", async () => {
    const { loginAsUser } = await import("../matrix/matrix-admin-client.js");
    vi.mocked(loginAsUser).mockResolvedValue({
      ok: false,
      status: 401,
      error: "creds_missing",
    });

    const { mintAndWriteHumanToken } = await import("./human-token-writer.js");

    const result = await mintAndWriteHumanToken(
      "@ashley:thenasty.taild9b663.ts.net",
      "alice",
    );

    expect(result).toEqual({ ok: false, error: "creds_missing" });
    expect(fs.existsSync(path.join(tempDir, "alice.token"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "alice.token.tmp"))).toBe(false);
    // A warn should have been logged with the failure context.
    expect(warnSpy).toHaveBeenCalled();
  });

  it("Test 3: assertSafeHumanName guard rejects traversal; no fs write; loginAsUser never called", async () => {
    const { loginAsUser } = await import("../matrix/matrix-admin-client.js");
    vi.mocked(loginAsUser).mockResolvedValue({
      ok: true,
      accessToken: "should-never-reach-disk",
    });

    const { mintAndWriteHumanToken } = await import("./human-token-writer.js");

    await expect(
      mintAndWriteHumanToken("@x:y.z", "../etc/passwd"),
    ).rejects.toThrow(/humanName failed shared-volume path guard/);

    // No file materialized anywhere.
    expect(fs.readdirSync(tempDir)).toHaveLength(0);
    // loginAsUser was never invoked — the guard fires before the fetch.
    expect(loginAsUser).not.toHaveBeenCalled();
  });

  it("Test 4: NEVER logs the Matrix access token value in any log payload", async () => {
    const { loginAsUser } = await import("../matrix/matrix-admin-client.js");
    const SECRET_TOKEN =
      "SUPER_SECRET_MATRIX_TOKEN_DO_NOT_LEAK_9f8e7d6c5b4a";
    vi.mocked(loginAsUser).mockResolvedValue({
      ok: true,
      accessToken: SECRET_TOKEN,
    });

    const { mintAndWriteHumanToken } = await import("./human-token-writer.js");

    await mintAndWriteHumanToken(
      "@ashley:thenasty.taild9b663.ts.net",
      "alice",
    );

    // Serialize every captured log call and grep for the token substring.
    const allLogPayloads = JSON.stringify([
      ...infoSpy.mock.calls,
      ...warnSpy.mock.calls,
    ]);
    expect(allLogPayloads).not.toContain(SECRET_TOKEN);
    expect(allLogPayloads).not.toContain(
      "SUPER_SECRET_MATRIX_TOKEN_DO_NOT_LEAK",
    );
  });
});
