/**
 * Phase 89 Plan 02 Task 4 — registry-rooms-backfill tests.
 *
 * Covers the 6 behaviors from PLAN.md § Task 4:
 *   Test 1: has_backfilled_registry_rooms='true' → returns { ok:true, skipped:true }
 *           immediately without enumerating.
 *   Test 2: enumerates humans from users.mxid + calls joinHumanToHumansRegistry
 *           for each; idempotent joins (Synapse joinRoom is idempotent).
 *   Test 3: enumerates agents via injected dep + calls joinAgentToAgentsRegistry
 *           for each; per-agent failure logs a warning and continues.
 *   Test 4: on successful backfill, writes has_backfilled_registry_rooms='true'
 *           + fires DatabaseSaveTrigger.forceSave('phase-89-backfill-complete').
 *   Test 5: settings gate stays sticky — a second call after Test 4 completes
 *           is a no-op via the gate (idempotent per D-12).
 *   Test 6: structured logging at each interaction boundary (start / enumerated /
 *           per-account join failure / complete).
 *
 * Test infrastructure — same pattern as registry-rooms.test.ts (fresh
 * better-sqlite3 per beforeEach, vi.mock db.$client passthrough, forceSave spy,
 * quiet logger, mocked registry-rooms module).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Test-owned in-memory sqlite — replaced in beforeEach.
// ---------------------------------------------------------------------------

let sqliteInstance: Database.Database;

// Byte-parallel to production DDL for the two tables the backfill reads/writes.
const BACKFILL_DDL = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    mxid TEXT
  );
`;

// ---------------------------------------------------------------------------
// Mocks — hoisted before module import.
// ---------------------------------------------------------------------------

vi.mock("../database/db/index.js", () => ({
  get db() {
    return { $client: sqliteInstance };
  },
}));

vi.mock("../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    forceSave: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./registry-rooms.js", () => ({
  ensureRegistryRoomsExist: vi.fn(),
  joinAgentToAgentsRegistry: vi.fn(),
  joinHumanToHumansRegistry: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import module + spies AFTER mocks.
// ---------------------------------------------------------------------------

import { runRegistryRoomsBackfill } from "./registry-rooms-backfill.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { databaseLogger } from "../utils/logger.js";
import {
  ensureRegistryRoomsExist,
  joinAgentToAgentsRegistry,
  joinHumanToHumansRegistry,
} from "./registry-rooms.js";

const forceSaveSpy = DatabaseSaveTrigger.forceSave as ReturnType<typeof vi.fn>;
const ensureSpy = ensureRegistryRoomsExist as unknown as ReturnType<typeof vi.fn>;
const joinAgentSpy = joinAgentToAgentsRegistry as unknown as ReturnType<
  typeof vi.fn
>;
const joinHumanSpy = joinHumanToHumansRegistry as unknown as ReturnType<
  typeof vi.fn
>;
const loggerInfoSpy = databaseLogger.info as ReturnType<typeof vi.fn>;
const loggerWarnSpy = databaseLogger.warn as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  sqliteInstance?.close();
  sqliteInstance = new Database(":memory:");
  sqliteInstance.exec(BACKFILL_DDL);

  forceSaveSpy.mockClear();
  forceSaveSpy.mockResolvedValue(undefined);
  ensureSpy.mockReset();
  joinAgentSpy.mockReset();
  joinHumanSpy.mockReset();
  loggerInfoSpy.mockClear();
  loggerWarnSpy.mockClear();

  // Default happy path: rooms already ensured.
  ensureSpy.mockResolvedValue({
    ok: true,
    agentsRoomId: "!agents:server",
    humansRoomId: "!humans:server",
  });
  joinAgentSpy.mockResolvedValue({ ok: true, roomId: "!agents:server" });
  joinHumanSpy.mockResolvedValue({ ok: true, roomId: "!humans:server" });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runRegistryRoomsBackfill — settings gate (D-12 idempotency)", () => {
  it("Test 1: has_backfilled_registry_rooms='true' → returns { ok:true, skipped:true } immediately", async () => {
    sqliteInstance
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run("has_backfilled_registry_rooms", "true");

    const result = await runRegistryRoomsBackfill();
    expect(result).toEqual({ ok: true, skipped: true });

    // Ensure it did NOT re-enumerate.
    expect(joinHumanSpy).not.toHaveBeenCalled();
    expect(joinAgentSpy).not.toHaveBeenCalled();
    expect(ensureSpy).not.toHaveBeenCalled();
  });

  it("Test 5: after successful backfill, a second call is a no-op via the gate", async () => {
    // Seed a human so the first call has work to do.
    sqliteInstance
      .prepare("INSERT INTO users (id, username, mxid) VALUES (?, ?, ?)")
      .run("u1", "alice", "@alice_human:server");

    const first = await runRegistryRoomsBackfill();
    expect(first.ok).toBe(true);
    // Gate flipped on.
    const gateAfter = sqliteInstance
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("has_backfilled_registry_rooms") as { value: string } | undefined;
    expect(gateAfter?.value).toBe("true");

    joinHumanSpy.mockClear();
    joinAgentSpy.mockClear();

    const second = await runRegistryRoomsBackfill();
    expect(second).toEqual({ ok: true, skipped: true });
    expect(joinHumanSpy).not.toHaveBeenCalled();
    expect(joinAgentSpy).not.toHaveBeenCalled();
  });
});

describe("runRegistryRoomsBackfill — humans enumeration", () => {
  it("Test 2: enumerates humans from users.mxid + joins each to humans registry (idempotent)", async () => {
    sqliteInstance
      .prepare("INSERT INTO users (id, username, mxid) VALUES (?, ?, ?)")
      .run("u1", "alice", "@alice_human:server");
    sqliteInstance
      .prepare("INSERT INTO users (id, username, mxid) VALUES (?, ?, ?)")
      .run("u2", "bob", "@bob_human:server");
    // NULL mxid — must NOT be joined.
    sqliteInstance
      .prepare("INSERT INTO users (id, username, mxid) VALUES (?, ?, ?)")
      .run("u3", "carol", null);
    // Empty-string mxid — must NOT be joined either (defense in depth).
    sqliteInstance
      .prepare("INSERT INTO users (id, username, mxid) VALUES (?, ?, ?)")
      .run("u4", "dave", "");

    const result = await runRegistryRoomsBackfill();
    expect(result.ok).toBe(true);
    if (result.ok && !("skipped" in result && result.skipped === true)) {
      expect(result.humansAttempted).toBe(2);
      expect(result.humansFailed).toBe(0);
    }

    // joinHumanToHumansRegistry called exactly twice with the two non-null mxids.
    expect(joinHumanSpy).toHaveBeenCalledTimes(2);
    const humansCalled = joinHumanSpy.mock.calls.map((c) => c[0]).sort();
    expect(humansCalled).toEqual([
      "@alice_human:server",
      "@bob_human:server",
    ]);
  });

  it("Test 2b: per-human join failure logs a warning and continues; humansFailed increments", async () => {
    sqliteInstance
      .prepare("INSERT INTO users (id, username, mxid) VALUES (?, ?, ?)")
      .run("u1", "alice", "@alice_human:server");
    sqliteInstance
      .prepare("INSERT INTO users (id, username, mxid) VALUES (?, ?, ?)")
      .run("u2", "bob", "@bob_human:server");

    joinHumanSpy
      .mockResolvedValueOnce({ ok: true, roomId: "!humans:server" })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        error: "registry_room_not_configured",
      });

    const result = await runRegistryRoomsBackfill();
    expect(result.ok).toBe(true);
    if (result.ok && !("skipped" in result && result.skipped === true)) {
      expect(result.humansAttempted).toBe(2);
      expect(result.humansFailed).toBe(1);
    }

    // Warning logged for the failure.
    const warnOps = loggerWarnSpy.mock.calls
      .map((c) => (c[1] && typeof c[1] === "object" ? (c[1] as any).operation : undefined))
      .filter((op) => typeof op === "string");
    expect(warnOps).toContain("registry_backfill_join_failed");
  });
});

describe("runRegistryRoomsBackfill — agents enumeration", () => {
  it("Test 3: enumerates agents via injected dep + joins each to agents registry", async () => {
    const mxids = [
      "@agent1:server",
      "@agent2:server",
      "@agent3:server",
    ];
    const enumerator = vi.fn().mockResolvedValue(mxids);

    const result = await runRegistryRoomsBackfill({
      enumerateAgentMxids: enumerator,
    });
    expect(result.ok).toBe(true);
    if (result.ok && !("skipped" in result && result.skipped === true)) {
      expect(result.agentsAttempted).toBe(3);
      expect(result.agentsFailed).toBe(0);
    }

    expect(enumerator).toHaveBeenCalledTimes(1);
    expect(joinAgentSpy).toHaveBeenCalledTimes(3);
    const calledMxids = joinAgentSpy.mock.calls.map((c) => c[0]).sort();
    expect(calledMxids).toEqual(mxids.sort());
  });

  it("Test 3b: per-agent join failure logs a warning and continues; agentsFailed increments", async () => {
    joinAgentSpy
      .mockResolvedValueOnce({ ok: true, roomId: "!agents:server" })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        error: "admin_api_proxy_error",
      });
    const enumerator = vi
      .fn()
      .mockResolvedValue(["@agent1:server", "@agent2:server"]);

    const result = await runRegistryRoomsBackfill({
      enumerateAgentMxids: enumerator,
    });
    expect(result.ok).toBe(true);
    if (result.ok && !("skipped" in result && result.skipped === true)) {
      expect(result.agentsAttempted).toBe(2);
      expect(result.agentsFailed).toBe(1);
    }

    const warnOps = loggerWarnSpy.mock.calls
      .map((c) => (c[1] && typeof c[1] === "object" ? (c[1] as any).operation : undefined))
      .filter((op) => typeof op === "string");
    expect(warnOps).toContain("registry_backfill_join_failed");
  });

  it("Test 3c: when no enumerator dep is provided, agents backfill is skipped (Plan 03 owns the enumerator wiring)", async () => {
    const result = await runRegistryRoomsBackfill();
    expect(result.ok).toBe(true);
    if (result.ok && !("skipped" in result && result.skipped === true)) {
      expect(result.agentsAttempted).toBe(0);
    }
    expect(joinAgentSpy).not.toHaveBeenCalled();
  });
});

describe("runRegistryRoomsBackfill — gate write + forceSave discipline", () => {
  it("Test 4: on successful completion, writes gate='true' + fires forceSave('phase-89-backfill-complete')", async () => {
    // Seed one human so the flow has real work to do.
    sqliteInstance
      .prepare("INSERT INTO users (id, username, mxid) VALUES (?, ?, ?)")
      .run("u1", "alice", "@alice_human:server");

    const result = await runRegistryRoomsBackfill();
    expect(result.ok).toBe(true);

    // Gate written.
    const gate = sqliteInstance
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("has_backfilled_registry_rooms") as { value: string } | undefined;
    expect(gate?.value).toBe("true");

    // forceSave fired with the phase-89-backfill-complete label.
    expect(forceSaveSpy).toHaveBeenCalled();
    const labels = forceSaveSpy.mock.calls.map((c) => c[0] as string);
    expect(labels).toContain("phase-89-backfill-complete");
  });

  it("Test 4b: if forceSave rejects, backfill still returns ok (log-and-swallow)", async () => {
    sqliteInstance
      .prepare("INSERT INTO users (id, username, mxid) VALUES (?, ?, ?)")
      .run("u1", "alice", "@alice_human:server");
    forceSaveSpy.mockRejectedValueOnce(new Error("disk full"));

    const result = await runRegistryRoomsBackfill();
    expect(result.ok).toBe(true);
    // Gate row still in RAM (write happened before the rejected forceSave).
    const gate = sqliteInstance
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("has_backfilled_registry_rooms") as { value: string } | undefined;
    expect(gate?.value).toBe("true");
  });

  it("Test 4c: ensureRegistryRoomsExist creds-missing → { ok:false, reason:'creds_missing' }, gate NOT flipped", async () => {
    ensureSpy.mockResolvedValueOnce({ ok: false, reason: "creds_missing" });

    const result = await runRegistryRoomsBackfill();
    expect(result).toEqual({ ok: false, reason: "creds_missing" });

    // Gate NOT flipped — next boot retries.
    const gate = sqliteInstance
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("has_backfilled_registry_rooms");
    expect(gate).toBeUndefined();
    expect(joinHumanSpy).not.toHaveBeenCalled();
    expect(joinAgentSpy).not.toHaveBeenCalled();
  });
});

describe("runRegistryRoomsBackfill — structured logging", () => {
  it("Test 6: logs at each interaction boundary (start / enumerated / complete)", async () => {
    sqliteInstance
      .prepare("INSERT INTO users (id, username, mxid) VALUES (?, ?, ?)")
      .run("u1", "alice", "@alice_human:server");

    await runRegistryRoomsBackfill({
      enumerateAgentMxids: vi.fn().mockResolvedValue(["@agent1:server"]),
    });

    const infoOps = loggerInfoSpy.mock.calls
      .map((c) => (c[1] && typeof c[1] === "object" ? (c[1] as any).operation : undefined))
      .filter((op) => typeof op === "string");
    expect(infoOps).toContain("registry_backfill_start");
    expect(infoOps).toContain("registry_backfill_enumerated");
    expect(infoOps).toContain("registry_backfill_complete");
  });
});
