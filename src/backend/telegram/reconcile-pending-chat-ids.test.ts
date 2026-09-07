/**
 * Phase 83 Plan 03 Task 2 — reconcile-pending-chat-ids unit tests.
 *
 * Covers RP-01 through RP-11 from PLAN.md § Task 2 <behavior>:
 *   RP-01: empty state — no *.pending-chat-id → no DB / rewrite calls
 *   RP-02: happy path — sentinel + DB row present → update + save + rewrite + unlink
 *   RP-03: malformed sentinel filename — guard fires, sentinel LEFT, warn logged
 *   RP-04: no DB row for identityKey — sentinel LEFT (race window), NOT counted as failed
 *   RP-05: bad chat_id contents (non-integer) — sentinel LEFT, counted failed
 *   RP-06: empty-after-trim chat_id — sentinel LEFT, counted failed
 *   RP-07: rewriteRegistryFromCurrentState returns {ok:false} — sentinel LEFT, counted failed
 *   RP-08: DatabaseSaveTrigger.forceSave rejects — continue past, rewrite + unlink still run
 *   RP-09: negative-integer chat_id (group chat, deferred in v1) — sentinel LEFT, counted failed
 *   RP-10: startReconcilePendingChatIdsLoop returns a .unref()'d Timeout
 *   RP-11: multi-sentinel one-pass — two rows both processed, both unlinked
 *
 * Mock strategy mirrors reconcile-dead-tokens.test.ts — same vi.mock hoist for
 * db / schema / DatabaseSaveTrigger / bridge-config-writer / logger / drizzle-orm,
 * same TG_BRIDGE_STATE_DIR_OVERRIDE + tmpdir setup, same afterEach cleanup.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Mocks (hoisted above the module-under-test import)
// ---------------------------------------------------------------------------

// databaseLogger spies — verify structured-log operation strings.
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

// DatabaseSaveTrigger — mocked forceSave, per-test override for reject case.
const forceSaveSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    forceSave: (...args: unknown[]) => forceSaveSpy(...args),
  },
}));

// rewriteRegistryFromCurrentState — per-test override for failure case.
const rewriteSpy = vi
  .fn()
  .mockResolvedValue({ ok: true, agentCount: 1, humanCount: 1 });
vi.mock("./bridge-config-writer.js", () => ({
  rewriteRegistryFromCurrentState: (...args: unknown[]) => rewriteSpy(...args),
}));

// db.select().from().where().limit() → resolves mockSelectRows for the current agent.
// db.update().set().where() → resolves undefined, tracked by updateSpy.
let mockSelectRowsByKey: Map<string, Array<{ identityKey: string }>> = new Map();
const updateSpy = vi.fn();
const selectWhereSpy = vi.fn();
vi.mock("../database/db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (whereArg: { col: string; val: string }) => {
          selectWhereSpy(whereArg);
          const rows = mockSelectRowsByKey.get(whereArg.val) || [];
          return {
            limit: () => Promise.resolve(rows),
          };
        },
      }),
    }),
    update: () => ({
      set: (setArg: unknown) => ({
        where: (whereArg: unknown) => {
          updateSpy(setArg, whereArg);
          return Promise.resolve();
        },
      }),
    }),
  },
}));

// Bare column references (mock db chain ignores structure).
vi.mock("../database/db/schema.js", () => ({
  telegramBotTokens: {
    identityKey: "identityKey",
    telegramChatId: "telegramChatId",
    updatedAt: "updatedAt",
  },
}));

// drizzle-orm eq — return a probe object the mocked db chain can pattern-match on.
vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: string) => ({ col, val }),
}));

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  infoSpy.mockClear();
  warnSpy.mockClear();
  forceSaveSpy.mockClear();
  forceSaveSpy.mockResolvedValue(undefined);
  rewriteSpy.mockClear();
  rewriteSpy.mockResolvedValue({ ok: true, agentCount: 1, humanCount: 1 });
  updateSpy.mockClear();
  selectWhereSpy.mockClear();
  mockSelectRowsByKey = new Map();

  tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tg-bridge-reconcile-pending-"),
  );
  process.env.TG_BRIDGE_STATE_DIR_OVERRIDE = tempDir;
  // Reset module graph so shared-volume.ts re-reads env override.
  vi.resetModules();
});

afterEach(() => {
  delete process.env.TG_BRIDGE_STATE_DIR_OVERRIDE;
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reconcile-pending-chat-ids", () => {
  it("RP-01: empty state — no sentinels → {0,0,0}, no DB / rewrite calls", async () => {
    const { scanAndReconcilePendingChatIds } = await import(
      "./reconcile-pending-chat-ids.js"
    );

    const result = await scanAndReconcilePendingChatIds();

    expect(result).toEqual({ scanned: 0, updated: 0, failed: 0 });
    expect(selectWhereSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(rewriteSpy).not.toHaveBeenCalled();
    expect(forceSaveSpy).not.toHaveBeenCalled();
  });

  it("RP-02: happy path — alexander.pending-chat-id + DB row present → update + save + rewrite + unlink", async () => {
    mockSelectRowsByKey.set("alexander", [{ identityKey: "alexander" }]);

    const sentinelPath = path.join(tempDir, "alexander.pending-chat-id");
    fs.writeFileSync(sentinelPath, "123456789");

    const { scanAndReconcilePendingChatIds } = await import(
      "./reconcile-pending-chat-ids.js"
    );

    const result = await scanAndReconcilePendingChatIds();

    expect(result).toEqual({ scanned: 1, updated: 1, failed: 0 });

    // db.update.set() called once with the parsed chat_id + updatedAt iso.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [setArg, whereArg] = updateSpy.mock.calls[0]!;
    expect(setArg).toMatchObject({ telegramChatId: "123456789" });
    expect((setArg as { updatedAt: string }).updatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
    expect(whereArg).toEqual({ col: "identityKey", val: "alexander" });

    // Save trigger invoked with the expected reason string.
    expect(forceSaveSpy).toHaveBeenCalledWith("reconcile-pending-chat-id");
    // Registry rewrite fired once (post-save).
    expect(rewriteSpy).toHaveBeenCalledTimes(1);
    // Sentinel unlinked.
    expect(fs.existsSync(sentinelPath)).toBe(false);
    // Info log with operation.
    const infoPayloads = JSON.stringify(infoSpy.mock.calls);
    expect(infoPayloads).toMatch(/reconcile_pending_chat_id_updated/);
  });

  it("RP-03: malformed sentinel filename — guard fires, sentinel LEFT, no DB / rewrite", async () => {
    // Uppercase triggers assertSafeHumanName rejection (regex is lowercase-only).
    const badPath = path.join(tempDir, "BADname.pending-chat-id");
    fs.writeFileSync(badPath, "42");

    const { scanAndReconcilePendingChatIds } = await import(
      "./reconcile-pending-chat-ids.js"
    );

    const result = await scanAndReconcilePendingChatIds();

    expect(result).toEqual({ scanned: 1, updated: 0, failed: 0 });
    // No DB queries — guard runs BEFORE any fs / DB op.
    expect(selectWhereSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(rewriteSpy).not.toHaveBeenCalled();
    // Sentinel LEFT in place (defense in depth — keeps anomaly visible).
    expect(fs.existsSync(badPath)).toBe(true);
    // Warn logged with the bad-name operation.
    const warnPayloads = JSON.stringify(warnSpy.mock.calls);
    expect(warnPayloads).toMatch(/reconcile_pending_chat_id_bad_name/);
  });

  it("RP-04: no DB row for identityKey — sentinel LEFT (race window), NOT counted as failed", async () => {
    // No mockSelectRowsByKey entry for 'ghost' → empty result.
    const sentinelPath = path.join(tempDir, "ghost.pending-chat-id");
    fs.writeFileSync(sentinelPath, "111");

    const { scanAndReconcilePendingChatIds } = await import(
      "./reconcile-pending-chat-ids.js"
    );

    const result = await scanAndReconcilePendingChatIds();

    // Race window semantics: not counted as failed; next tick will retry.
    expect(result).toEqual({ scanned: 1, updated: 0, failed: 0 });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(rewriteSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(sentinelPath)).toBe(true);
    const warnPayloads = JSON.stringify(warnSpy.mock.calls);
    expect(warnPayloads).toMatch(/reconcile_pending_chat_id_no_row/);
  });

  it("RP-05: bad chat_id contents (non-integer 'hello') — sentinel LEFT, counted failed", async () => {
    mockSelectRowsByKey.set("alexander", [{ identityKey: "alexander" }]);
    const sentinelPath = path.join(tempDir, "alexander.pending-chat-id");
    fs.writeFileSync(sentinelPath, "hello");

    const { scanAndReconcilePendingChatIds } = await import(
      "./reconcile-pending-chat-ids.js"
    );

    const result = await scanAndReconcilePendingChatIds();

    expect(result).toEqual({ scanned: 1, updated: 0, failed: 1 });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(rewriteSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(sentinelPath)).toBe(true);
    const warnPayloads = JSON.stringify(warnSpy.mock.calls);
    expect(warnPayloads).toMatch(/reconcile_pending_chat_id_bad_contents/);
  });

  it("RP-06: empty-after-trim chat_id ('   \\n') — sentinel LEFT, counted failed", async () => {
    mockSelectRowsByKey.set("alexander", [{ identityKey: "alexander" }]);
    const sentinelPath = path.join(tempDir, "alexander.pending-chat-id");
    fs.writeFileSync(sentinelPath, "   \n");

    const { scanAndReconcilePendingChatIds } = await import(
      "./reconcile-pending-chat-ids.js"
    );

    const result = await scanAndReconcilePendingChatIds();

    expect(result).toEqual({ scanned: 1, updated: 0, failed: 1 });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(sentinelPath)).toBe(true);
    const warnPayloads = JSON.stringify(warnSpy.mock.calls);
    expect(warnPayloads).toMatch(/reconcile_pending_chat_id_bad_contents/);
  });

  it("RP-07: rewriteRegistryFromCurrentState fails — sentinel LEFT for next-tick retry", async () => {
    mockSelectRowsByKey.set("alexander", [{ identityKey: "alexander" }]);
    rewriteSpy.mockResolvedValueOnce({ ok: false, error: "fs error" });

    const sentinelPath = path.join(tempDir, "alexander.pending-chat-id");
    fs.writeFileSync(sentinelPath, "123");

    const { scanAndReconcilePendingChatIds } = await import(
      "./reconcile-pending-chat-ids.js"
    );

    const result = await scanAndReconcilePendingChatIds();

    // DB update ran (idempotent — next tick's same-value UPDATE is a no-op).
    expect(updateSpy).toHaveBeenCalledTimes(1);
    // But rewrite failed → sentinel LEFT.
    expect(result).toEqual({ scanned: 1, updated: 0, failed: 1 });
    expect(fs.existsSync(sentinelPath)).toBe(true);
    const warnPayloads = JSON.stringify(warnSpy.mock.calls);
    expect(warnPayloads).toMatch(/reconcile_pending_chat_id_rewrite_failed/);
  });

  it("RP-08: forceSave rejects — continue past, rewrite + unlink still run, counted updated", async () => {
    mockSelectRowsByKey.set("alexander", [{ identityKey: "alexander" }]);
    forceSaveSpy.mockRejectedValueOnce(new Error("save boom"));

    const sentinelPath = path.join(tempDir, "alexander.pending-chat-id");
    fs.writeFileSync(sentinelPath, "999");

    const { scanAndReconcilePendingChatIds } = await import(
      "./reconcile-pending-chat-ids.js"
    );

    const result = await scanAndReconcilePendingChatIds();

    // forceSave failure is non-fatal (data is in RAM) — continue.
    expect(result).toEqual({ scanned: 1, updated: 1, failed: 0 });
    expect(rewriteSpy).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(sentinelPath)).toBe(false);
    const warnPayloads = JSON.stringify(warnSpy.mock.calls);
    expect(warnPayloads).toMatch(/reconcile_pending_chat_id_save_failed/);
  });

  it("RP-09: negative-integer chat_id ('-4567') — group chat deferred in v1, sentinel LEFT", async () => {
    mockSelectRowsByKey.set("alexander", [{ identityKey: "alexander" }]);
    const sentinelPath = path.join(tempDir, "alexander.pending-chat-id");
    fs.writeFileSync(sentinelPath, "-4567");

    const { scanAndReconcilePendingChatIds } = await import(
      "./reconcile-pending-chat-ids.js"
    );

    const result = await scanAndReconcilePendingChatIds();

    // Negative int fails POSITIVE_INT_RE — treated as bad contents.
    expect(result).toEqual({ scanned: 1, updated: 0, failed: 1 });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(sentinelPath)).toBe(true);
    const warnPayloads = JSON.stringify(warnSpy.mock.calls);
    expect(warnPayloads).toMatch(/reconcile_pending_chat_id_bad_contents/);
  });

  it("RP-10: startReconcilePendingChatIdsLoop returns a .unref()'d Timeout", async () => {
    const { startReconcilePendingChatIdsLoop } = await import(
      "./reconcile-pending-chat-ids.js"
    );

    const handle = startReconcilePendingChatIdsLoop(60_000);
    expect(handle).toBeDefined();
    expect(typeof handle.unref).toBe("function");
    // Clear immediately so the test does not linger.
    clearInterval(handle);
  });

  it("RP-11: multi-sentinel one-pass — alice + bob both processed, both unlinked, {2,2,0}", async () => {
    mockSelectRowsByKey.set("alice", [{ identityKey: "alice" }]);
    mockSelectRowsByKey.set("bob", [{ identityKey: "bob" }]);

    const aliceSentinel = path.join(tempDir, "alice.pending-chat-id");
    const bobSentinel = path.join(tempDir, "bob.pending-chat-id");
    fs.writeFileSync(aliceSentinel, "100");
    fs.writeFileSync(bobSentinel, "200");

    const { scanAndReconcilePendingChatIds } = await import(
      "./reconcile-pending-chat-ids.js"
    );

    const result = await scanAndReconcilePendingChatIds();

    expect(result).toEqual({ scanned: 2, updated: 2, failed: 0 });
    expect(updateSpy).toHaveBeenCalledTimes(2);
    // rewrite called TWICE — one per successful DB update (mirror
    // reconcile-dead-tokens; simplifies failure semantics at 30s cadence).
    expect(rewriteSpy).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(aliceSentinel)).toBe(false);
    expect(fs.existsSync(bobSentinel)).toBe(false);
  });
});
