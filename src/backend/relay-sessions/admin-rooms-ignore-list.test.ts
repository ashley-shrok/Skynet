/**
 * Phase 89 Plan 01 Task 3 — admin-rooms ignore-list tests.
 *
 * Covers the 5 behaviors from PLAN.md § Task 3:
 *   Test 1: isAdminRoom returns false on empty table.
 *   Test 2: after addAdminRoom, isAdminRoom returns true.
 *   Test 3: addAdminRoom is idempotent (INSERT OR IGNORE on PRIMARY KEY)
 *           — no throw, no duplicate row on second call.
 *   Test 4: listAdminRooms returns all admin room IDs from the table.
 *   Test 5: addAdminRoom calls DatabaseSaveTrigger.forceSave with a label
 *           prefixed "phase-89-" (crown-jewel invariant).
 *
 * Test infrastructure — same in-memory scaffolding pattern as
 * relay-room-sessions-store.test.ts (fresh better-sqlite3 per test via
 * beforeEach, vi.mock db.$client passthrough, forceSave spy, quiet logger).
 * The DDL is a byte-parallel copy of Task 1's admin_rooms schema.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Test-owned in-memory sqlite — replaced in beforeEach.
// ---------------------------------------------------------------------------

let sqliteInstance: Database.Database;

const ADMIN_ROOMS_DDL = `
  CREATE TABLE IF NOT EXISTS admin_rooms (
    room_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

// ---------------------------------------------------------------------------
// Mocks — hoisted before store import.
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

// ---------------------------------------------------------------------------
// Import module + trigger spy AFTER mocks.
// ---------------------------------------------------------------------------

import {
  isAdminRoom,
  addAdminRoom,
  listAdminRooms,
} from "./admin-rooms-ignore-list.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";

const forceSaveSpy = DatabaseSaveTrigger.forceSave as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  sqliteInstance?.close();
  sqliteInstance = new Database(":memory:");
  sqliteInstance.exec(ADMIN_ROOMS_DDL);

  forceSaveSpy.mockClear();
  forceSaveSpy.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("admin-rooms-ignore-list — isAdminRoom", () => {
  it("Test 1: returns false when the table is empty", async () => {
    const result = await isAdminRoom("!agents-registry:server");
    expect(result).toBe(false);
  });

  it("Test 2: returns true after addAdminRoom for that room", async () => {
    await addAdminRoom("!agents-registry:server");
    const result = await isAdminRoom("!agents-registry:server");
    expect(result).toBe(true);
  });

  it("Test 2b: returns false for a room OTHER than the one added", async () => {
    await addAdminRoom("!agents-registry:server");
    const result = await isAdminRoom("!some-user-room:server");
    expect(result).toBe(false);
  });
});

describe("admin-rooms-ignore-list — addAdminRoom", () => {
  it("Test 3: is idempotent — second call does not throw or create a duplicate row", async () => {
    await addAdminRoom("!agents-registry:server");
    await expect(
      addAdminRoom("!agents-registry:server"),
    ).resolves.toBeUndefined();

    const count = sqliteInstance
      .prepare("SELECT COUNT(*) as n FROM admin_rooms WHERE room_id = ?")
      .get("!agents-registry:server") as { n: number };
    expect(count.n).toBe(1);
  });
});

describe("admin-rooms-ignore-list — listAdminRooms", () => {
  it("Test 4: returns all admin room IDs from the table", async () => {
    await addAdminRoom("!agents-registry:server");
    await addAdminRoom("!humans-registry:server");

    const list = await listAdminRooms();
    expect(list).toHaveLength(2);
    expect(list).toContain("!agents-registry:server");
    expect(list).toContain("!humans-registry:server");
  });

  it("Test 4b: returns [] on empty table", async () => {
    const list = await listAdminRooms();
    expect(list).toEqual([]);
  });
});

describe("admin-rooms-ignore-list — persistence flush discipline", () => {
  it("Test 5: addAdminRoom calls forceSave with a phase-89-* label; isAdminRoom + listAdminRooms do NOT", async () => {
    await addAdminRoom("!agents-registry:server");
    expect(forceSaveSpy).toHaveBeenCalledTimes(1);
    expect(forceSaveSpy.mock.calls[0][0]).toMatch(/^phase-89-/);

    forceSaveSpy.mockClear();
    await isAdminRoom("!agents-registry:server");
    await listAdminRooms();
    expect(forceSaveSpy).not.toHaveBeenCalled();
  });

  it("Test 5b: if forceSave rejects, addAdminRoom still returns without throwing (log-and-swallow)", async () => {
    forceSaveSpy.mockRejectedValueOnce(new Error("disk gone"));

    await expect(
      addAdminRoom("!agents-registry:server"),
    ).resolves.toBeUndefined();

    // Row was still written to RAM despite the flush failure.
    const row = sqliteInstance
      .prepare("SELECT room_id FROM admin_rooms WHERE room_id = ?")
      .get("!agents-registry:server");
    expect(row).toBeDefined();
  });
});
