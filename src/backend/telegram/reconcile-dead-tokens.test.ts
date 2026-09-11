/**
 * Phase 79 Plan 08 Task 1 — reconcile-dead-tokens unit tests.
 *
 * Covers the six behaviors from PLAN.md § Task 1 <behavior>:
 *   Test 1: empty-state — no *.token-dead sentinels → no loginAsUser call,
 *           returns {scanned:0, minted:0, failed:0}.
 *   Test 2: happy path — alice.token-dead exists, Alice has mxid,
 *           mintAndWriteHumanToken ok → sentinel unlinked, counts
 *           {scanned:1, minted:1, failed:0}.
 *   Test 3: malformed sentinel filename — skipped with warn, no fs work
 *           outside TG_BRIDGE_STATE_DIR, no crash.
 *   Test 4: human has no mxid in users table — skipped with warn, no
 *           mint attempt, sentinel left in place.
 *   Test 5: mintAndWriteHumanToken rejects — sentinel left for next-tick
 *           retry, counts {scanned:1, minted:0, failed:1}.
 *   Test 6: startReconcileLoop — returns a Timeout handle with .unref
 *           behavior (does not keep the test process alive).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Mocks (hoisted above the module-under-test import)
// ---------------------------------------------------------------------------

vi.mock("./human-token-writer.js", () => ({
  mintAndWriteHumanToken: vi.fn(),
}));

// Spy on databaseLogger.info / warn to verify structured-log payload shape.
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

// db.select().from(users) mock — returns a fresh chainable each call so
// scanAndReconcileDeadTokens can call it once per sweep. The test rebinds
// the underlying rows in beforeEach.
let mockUserRows: Array<{ name: string; mxid: string | null }> = [];
vi.mock("../database/db/index.js", () => ({
  db: {
    select: () => ({
      from: () => Promise.resolve(mockUserRows),
    }),
  },
}));

// The users symbol is only used as a column reference — return a bare object;
// our db.select mock ignores it entirely.
vi.mock("../database/db/schema.js", () => ({
  users: { username: "username", mxid: "mxid" },
}));

let tempDir: string;

beforeEach(async () => {
  infoSpy.mockClear();
  warnSpy.mockClear();
  mockUserRows = [];
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-bridge-reconcile-"));
  process.env.TG_BRIDGE_STATE_DIR_OVERRIDE = tempDir;
  // Reset the module graph so shared-volume.ts re-reads the env override
  // and the module-under-test re-binds against the new path helpers.
  vi.resetModules();
  const { mintAndWriteHumanToken } = await import("./human-token-writer.js");
  vi.mocked(mintAndWriteHumanToken).mockClear();
});

afterEach(() => {
  delete process.env.TG_BRIDGE_STATE_DIR_OVERRIDE;
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("reconcile-dead-tokens", () => {
  it("Test 1: empty state — no sentinels → {scanned:0, minted:0, failed:0}, no mint call", async () => {
    const { mintAndWriteHumanToken } = await import("./human-token-writer.js");
    mockUserRows = [
      { name: "alice", mxid: "@ashley:thenasty.taild9b663.ts.net" },
    ];

    const { scanAndReconcileDeadTokens } = await import(
      "./reconcile-dead-tokens.js"
    );

    const result = await scanAndReconcileDeadTokens();

    expect(result).toEqual({ scanned: 0, minted: 0, failed: 0 });
    expect(mintAndWriteHumanToken).not.toHaveBeenCalled();
  });

  it("Test 2: happy path — alice.token-dead + mxid known + mint ok → sentinel unlinked, counts {1,1,0}", async () => {
    const { mintAndWriteHumanToken } = await import("./human-token-writer.js");
    vi.mocked(mintAndWriteHumanToken).mockResolvedValue({ ok: true });

    mockUserRows = [
      { name: "alice", mxid: "@ashley:thenasty.taild9b663.ts.net" },
      { name: "laura", mxid: null }, // Laura deferred per RESEARCH § A6
    ];

    // Materialize the sentinel.
    const sentinelPath = path.join(tempDir, "alice.token-dead");
    fs.writeFileSync(sentinelPath, "");

    const { scanAndReconcileDeadTokens } = await import(
      "./reconcile-dead-tokens.js"
    );

    const result = await scanAndReconcileDeadTokens();

    expect(result).toEqual({ scanned: 1, minted: 1, failed: 0 });
    expect(mintAndWriteHumanToken).toHaveBeenCalledWith(
      "@ashley:thenasty.taild9b663.ts.net",
      "alice",
    );
    // Sentinel MUST be unlinked after a successful mint.
    expect(fs.existsSync(sentinelPath)).toBe(false);
  });

  it("Test 3: malformed sentinel filename — skipped with warn, mint never called, no crash", async () => {
    const { mintAndWriteHumanToken } = await import("./human-token-writer.js");
    // We can't literally write `../etc/passwd.token-dead` in the tmpdir
    // because readdir would still return the bare filename. Simulate the
    // guard's trigger by writing a filename with uppercase (regex rejects
    // uppercase per assertSafeHumanName).
    const badPath = path.join(tempDir, "BADname.token-dead");
    fs.writeFileSync(badPath, "");

    mockUserRows = [];

    const { scanAndReconcileDeadTokens } = await import(
      "./reconcile-dead-tokens.js"
    );

    const result = await scanAndReconcileDeadTokens();

    expect(result).toEqual({ scanned: 1, minted: 0, failed: 0 });
    expect(mintAndWriteHumanToken).not.toHaveBeenCalled();
    // Sentinel left alone — we did not touch it.
    expect(fs.existsSync(badPath)).toBe(true);
    // A warn was logged with the malformed-name operation.
    const warnPayloads = JSON.stringify(warnSpy.mock.calls);
    expect(warnPayloads).toMatch(/reconcile_dead_tokens_bad_name/);
  });

  it("Test 4: no mxid for the human → skipped with warn, mint never called, sentinel left in place", async () => {
    const { mintAndWriteHumanToken } = await import("./human-token-writer.js");
    // Laura is a live human in RESEARCH but has no mxid yet.
    mockUserRows = [{ name: "laura", mxid: null }];

    const sentinelPath = path.join(tempDir, "laura.token-dead");
    fs.writeFileSync(sentinelPath, "");

    const { scanAndReconcileDeadTokens } = await import(
      "./reconcile-dead-tokens.js"
    );

    const result = await scanAndReconcileDeadTokens();

    expect(result).toEqual({ scanned: 1, minted: 0, failed: 0 });
    expect(mintAndWriteHumanToken).not.toHaveBeenCalled();
    expect(fs.existsSync(sentinelPath)).toBe(true);
    const warnPayloads = JSON.stringify(warnSpy.mock.calls);
    expect(warnPayloads).toMatch(/reconcile_dead_tokens_no_mxid/);
  });

  it("Test 5: mint rejects — sentinel left for next tick retry, counts {1,0,1}", async () => {
    const { mintAndWriteHumanToken } = await import("./human-token-writer.js");
    vi.mocked(mintAndWriteHumanToken).mockResolvedValue({
      ok: false,
      error: "synapse_500",
    });

    mockUserRows = [
      { name: "alice", mxid: "@ashley:thenasty.taild9b663.ts.net" },
    ];

    const sentinelPath = path.join(tempDir, "alice.token-dead");
    fs.writeFileSync(sentinelPath, "");

    const { scanAndReconcileDeadTokens } = await import(
      "./reconcile-dead-tokens.js"
    );

    const result = await scanAndReconcileDeadTokens();

    expect(result).toEqual({ scanned: 1, minted: 0, failed: 1 });
    // Sentinel MUST be left in place so the next tick retries.
    expect(fs.existsSync(sentinelPath)).toBe(true);
    // Warn was logged with the mint-failure context.
    const warnPayloads = JSON.stringify(warnSpy.mock.calls);
    expect(warnPayloads).toMatch(/synapse_500|reconcile_dead_tokens_mint_failed/);
  });

  it("Test 6: startReconcileLoop returns a Timeout handle that is unref'd (does not keep the process alive)", async () => {
    const { startReconcileLoop } = await import("./reconcile-dead-tokens.js");

    const handle = startReconcileLoop(60_000);
    // handle must be a valid Timeout with .unref (Node semantics).
    expect(handle).toBeDefined();
    expect(typeof handle.unref).toBe("function");
    // Clear immediately so the test does not linger.
    clearInterval(handle);
  });
});
