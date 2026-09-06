/**
 * Phase 80 Plan 01 — unit tests for the vetted-pool loader.
 *
 * Byte-shape mirror of src/backend/branding/branding-config-loader.test.ts:
 * `vi.mock("node:fs")` lets us feed synthetic file contents to `readFileSync`
 * without touching the real filesystem. Module-scope memoization inside
 * `pool-loader.ts` is defeated per-test via `vi.resetModules()` +
 * dynamic `await import()` in `beforeEach`.
 *
 * The loader NEVER throws — every failure branch (ENOENT, JSON.parse SyntaxError,
 * shape mismatch, non-string entries) must return `[]` safely. ENOENT is silent
 * (no `sshLogger.error`) because a missing pool.json is expected for legacy
 * deploys shipped before the Dockerfile COPY landed on the target box. All
 * other failure branches log via `sshLogger.error` — asserted per test.
 *
 * Threat register mapping:
 *   - T-80-01-02 (DoS: loader throws → cascading 500s) — asserted by every
 *     failure-branch test that also awaits the promise resolution.
 *   - T-80-01-03 (DoS: repeated disk reads) — asserted by the memoization test.
 *   - T-80-01-04 (Info Disclosure: log body includes raw JSON) — asserted by
 *     the malformed-JSON test that inspects the sshLogger.error call args.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Per-test controls for the synchronous readFileSync mock. `payload` is the
// string returned on read; `error` (if set) is thrown instead. `callCount`
// is the invocation counter used by the memoization test.
const fsState: {
  payload: string | undefined;
  error: NodeJS.ErrnoException | null;
  callCount: number;
} = {
  payload: undefined,
  error: null,
  callCount: 0,
};

vi.mock("node:fs", () => {
  return {
    readFileSync: () => {
      fsState.callCount += 1;
      if (fsState.error) throw fsState.error;
      return fsState.payload ?? "";
    },
  };
});

// Capture sshLogger.error calls per test.
const loggerErrorCalls: Array<[string, unknown]> = [];

vi.mock("../utils/logger.js", () => ({
  sshLogger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (msg: string, ctx: unknown) => {
      loggerErrorCalls.push([msg, ctx]);
    },
  },
  systemLogger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function enoent(): NodeJS.ErrnoException {
  const e = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
  e.code = "ENOENT";
  return e;
}

async function importLoader() {
  // Fresh module import so `cachedPool` starts as `null` in every test.
  vi.resetModules();
  return await import("./pool-loader.js");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("pool-loader", () => {
  beforeEach(() => {
    fsState.payload = undefined;
    fsState.error = null;
    fsState.callCount = 0;
    loggerErrorCalls.length = 0;
  });

  it("exports POOL_FILENAME as 'pool.json'", async () => {
    const mod = await importLoader();
    expect(mod.POOL_FILENAME).toBe("pool.json");
  });

  it("happy path: returns names array from valid pool.json", async () => {
    fsState.payload = JSON.stringify({
      names: ["Willow", "Cinder", "Aster"],
    });
    const { getVettedPool } = await importLoader();
    expect(getVettedPool()).toEqual(["Willow", "Cinder", "Aster"]);
    expect(loggerErrorCalls).toHaveLength(0);
  });

  it("ENOENT (missing file): returns [] silently, no error log", async () => {
    fsState.error = enoent();
    const { getVettedPool } = await importLoader();
    expect(getVettedPool()).toEqual([]);
    // ENOENT is expected for legacy deploys — MUST NOT log (silent per D-01
    // graceful-fallback semantic).
    expect(loggerErrorCalls).toHaveLength(0);
  });

  it("malformed JSON (SyntaxError): returns [] and logs error once", async () => {
    fsState.payload = "{ not valid json";
    const { getVettedPool } = await importLoader();
    expect(getVettedPool()).toEqual([]);
    expect(loggerErrorCalls).toHaveLength(1);
    // T-80-01-04: log payload MUST NOT include the raw file body.
    const [, ctx] = loggerErrorCalls[0];
    expect(JSON.stringify(ctx)).not.toContain("{ not valid json");
  });

  it("shape invalid (top-level not object): returns [] and logs error", async () => {
    fsState.payload = JSON.stringify(["Willow", "Cinder"]);
    const { getVettedPool } = await importLoader();
    expect(getVettedPool()).toEqual([]);
    expect(loggerErrorCalls).toHaveLength(1);
  });

  it("shape invalid (names not array): returns [] and logs error", async () => {
    fsState.payload = JSON.stringify({ names: "Willow" });
    const { getVettedPool } = await importLoader();
    expect(getVettedPool()).toEqual([]);
    expect(loggerErrorCalls).toHaveLength(1);
  });

  it("names contains non-string entries: returns [] and logs error", async () => {
    fsState.payload = JSON.stringify({ names: ["Willow", 42, "Cinder"] });
    const { getVettedPool } = await importLoader();
    expect(getVettedPool()).toEqual([]);
    expect(loggerErrorCalls).toHaveLength(1);
  });

  it("names contains empty-string entries: returns [] and logs error", async () => {
    fsState.payload = JSON.stringify({ names: ["Willow", "", "Cinder"] });
    const { getVettedPool } = await importLoader();
    expect(getVettedPool()).toEqual([]);
    expect(loggerErrorCalls).toHaveLength(1);
  });

  it("memoization: two consecutive calls invoke readFileSync exactly once", async () => {
    fsState.payload = JSON.stringify({ names: ["Willow", "Cinder"] });
    const { getVettedPool } = await importLoader();
    const first = getVettedPool();
    // Change the underlying file payload — memoization means this MUST NOT
    // reach the caller.
    fsState.payload = JSON.stringify({ names: ["ChangedAtRuntime"] });
    const second = getVettedPool();
    expect(first).toEqual(["Willow", "Cinder"]);
    expect(second).toEqual(["Willow", "Cinder"]);
    expect(fsState.callCount).toBe(1);
  });

  it("memoization caches empty array on ENOENT: second call does not re-read", async () => {
    fsState.error = enoent();
    const { getVettedPool } = await importLoader();
    expect(getVettedPool()).toEqual([]);
    // Second call: even if the file magically appears, cached [] wins until
    // the container restarts.
    fsState.error = null;
    fsState.payload = JSON.stringify({ names: ["Willow"] });
    expect(getVettedPool()).toEqual([]);
    expect(fsState.callCount).toBe(1);
  });

  it("never throws on non-ENOENT filesystem errors", async () => {
    const eaccess = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
    eaccess.code = "EACCES";
    fsState.error = eaccess;
    const { getVettedPool } = await importLoader();
    // Must not throw; must return safe default; must log.
    expect(() => getVettedPool()).not.toThrow();
    expect(getVettedPool()).toEqual([]);
    expect(loggerErrorCalls.length).toBeGreaterThanOrEqual(1);
  });
});
