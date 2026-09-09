/**
 * Phase 89 Plan 01 Task 2 — relay-room-sessions store tests.
 *
 * Covers the 8 behaviors from PLAN.md § Task 2:
 *   Test 1: materializeRelayRoomSession inserts a row (state='active',
 *           fresh UUID id, last_activity_at NULL until refresh).
 *   Test 2: materializeRelayRoomSession called twice for same (user, room)
 *           is a no-op (ON CONFLICT DO NOTHING) — does NOT create a duplicate
 *           row, does NOT throw.
 *   Test 3: markRelayRoomSessionInactive flips state='inactive', preserves
 *           the row (NOT DELETE) per D-03.
 *   Test 4: After Test 3, listActiveRelayRoomSessions returns [].
 *   Test 5: reactivateRelayRoomSession flips the inactive row back to
 *           'active' and refreshes updated_at (per D-03 — same row flips,
 *           not a new insert).
 *   Test 6: refreshRelayRoomLastActivity sets last_activity_at.
 *   Test 7: Every mutating primitive calls DatabaseSaveTrigger.forceSave
 *           with a label prefixed "phase-89-" (crown-jewel invariant).
 *   Test 8: If forceSave rejects, the primitive still returns without
 *           throwing (log-and-swallow per host-autostart-routes.ts:173-181).
 *
 * Test infrastructure — mirrors the telegram/tokens-store.test.ts pattern:
 *   - Fresh in-memory better-sqlite3 per test via beforeEach.
 *   - vi.mock("../database/db/index.js") swaps `db` for an object whose
 *     `$client` points at the real in-memory sqlite (the store uses
 *     `db.$client.prepare(...)` directly).
 *   - vi.mock DatabaseSaveTrigger.forceSave to spy on call args + simulate
 *     rejection for Test 8.
 *   - vi.mock the logger for quiet output.
 *
 * The DDL below is a byte-parallel copy of the Task 1 schema (matches
 * index.phase89-schema.test.ts's local scaffolding — three sites stay
 * locked together by convention per Phase 43/85 byte-parallel discipline).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Test-owned in-memory sqlite — replaced in beforeEach.
// ---------------------------------------------------------------------------

let sqliteInstance: Database.Database;

const RELAY_ROOM_SESSIONS_DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS relay_room_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    room_title TEXT,
    state TEXT NOT NULL,
    last_activity_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS relay_room_sessions_user_room_uidx
    ON relay_room_sessions(user_id, room_id);
`;

// ---------------------------------------------------------------------------
// Mocks — hoisted before store import.
// ---------------------------------------------------------------------------

vi.mock("../database/db/index.js", () => ({
  get db() {
    // Store module reads db.$client.prepare(...) — expose that shape.
    return { $client: sqliteInstance };
  },
}));

vi.mock("../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    forceSave: vi.fn().mockResolvedValue(undefined),
    triggerSave: vi.fn().mockResolvedValue(undefined),
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
// Import store + trigger spy AFTER mocks.
// ---------------------------------------------------------------------------

import {
  materializeRelayRoomSession,
  markRelayRoomSessionInactive,
  reactivateRelayRoomSession,
  listActiveRelayRoomSessions,
  refreshRelayRoomLastActivity,
} from "./relay-room-sessions-store.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";

const forceSaveSpy = DatabaseSaveTrigger.forceSave as ReturnType<typeof vi.fn>;
const triggerSaveSpy = DatabaseSaveTrigger.triggerSave as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Test setup — fresh DB + seeded user per test.
// ---------------------------------------------------------------------------

beforeEach(() => {
  sqliteInstance?.close();
  sqliteInstance = new Database(":memory:");
  sqliteInstance.exec("PRAGMA foreign_keys = ON");
  sqliteInstance.exec(RELAY_ROOM_SESSIONS_DDL);
  sqliteInstance
    .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
    .run("user-A", "alice");

  forceSaveSpy.mockClear();
  forceSaveSpy.mockResolvedValue(undefined);
  triggerSaveSpy.mockClear();
  triggerSaveSpy.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Row = {
  id: string;
  user_id: string;
  room_id: string;
  room_title: string | null;
  state: string;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
};

function selectRow(userId: string, roomId: string): Row | undefined {
  return sqliteInstance
    .prepare(
      "SELECT * FROM relay_room_sessions WHERE user_id = ? AND room_id = ?",
    )
    .get(userId, roomId) as Row | undefined;
}

function countRows(userId: string, roomId: string): number {
  const row = sqliteInstance
    .prepare(
      "SELECT COUNT(*) as n FROM relay_room_sessions WHERE user_id = ? AND room_id = ?",
    )
    .get(userId, roomId) as { n: number };
  return row.n;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("relay-room-sessions-store — materializeRelayRoomSession", () => {
  it("Test 1: inserts a row with state='active', fresh UUID id, last_activity_at NULL", async () => {
    await materializeRelayRoomSession("user-A", "!room1:server", "Room 1");

    const row = selectRow("user-A", "!room1:server");
    expect(row).toBeDefined();
    expect(row!.user_id).toBe("user-A");
    expect(row!.room_id).toBe("!room1:server");
    expect(row!.room_title).toBe("Room 1");
    expect(row!.state).toBe("active");
    expect(row!.last_activity_at).toBeNull();
    // UUID v4 format check — sanity that it's not empty / not the room id.
    expect(row!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("Test 2: called twice is idempotent — no duplicate row, no throw (ON CONFLICT DO NOTHING)", async () => {
    await materializeRelayRoomSession("user-A", "!room1:server", "Room 1");
    await expect(
      materializeRelayRoomSession("user-A", "!room1:server", "Room 1"),
    ).resolves.toBeUndefined();

    expect(countRows("user-A", "!room1:server")).toBe(1);
  });
});

describe("relay-room-sessions-store — markRelayRoomSessionInactive", () => {
  it("Test 3: flips state='inactive', preserves the row (NOT DELETE)", async () => {
    await materializeRelayRoomSession("user-A", "!room1:server", "Room 1");
    await markRelayRoomSessionInactive("user-A", "!room1:server");

    const row = selectRow("user-A", "!room1:server");
    expect(row).toBeDefined();
    expect(row!.state).toBe("inactive");
    expect(countRows("user-A", "!room1:server")).toBe(1);
  });
});

describe("relay-room-sessions-store — listActiveRelayRoomSessions", () => {
  it("Test 4: after markRelayRoomSessionInactive, listActive returns []", async () => {
    await materializeRelayRoomSession("user-A", "!room1:server", "Room 1");
    await markRelayRoomSessionInactive("user-A", "!room1:server");

    const list = await listActiveRelayRoomSessions("user-A");
    expect(list).toEqual([]);
  });

  it("Test 4b: listActive returns active rows with camelCase shape", async () => {
    await materializeRelayRoomSession("user-A", "!room1:server", "Room 1");
    await materializeRelayRoomSession("user-A", "!room2:server", "Room 2");
    await materializeRelayRoomSession("user-A", "!room3:server", null);

    const list = await listActiveRelayRoomSessions("user-A");
    expect(list).toHaveLength(3);
    // Shape check: camelCase field names (per store signature).
    const first = list[0];
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("roomId");
    expect(first).toHaveProperty("roomTitle");
    expect(first).toHaveProperty("lastActivityAt");
    expect(first).toHaveProperty("createdAt");
    expect(first).toHaveProperty("updatedAt");
    // roomTitle NULL survives as `null`.
    const nullTitle = list.find((r) => r.roomId === "!room3:server");
    expect(nullTitle?.roomTitle).toBeNull();
  });
});

describe("relay-room-sessions-store — reactivateRelayRoomSession", () => {
  it("Test 5: flips the inactive row back to 'active' (same row, updated_at bumped) per D-03", async () => {
    await materializeRelayRoomSession("user-A", "!room1:server", "Room 1");
    const originalRow = selectRow("user-A", "!room1:server")!;
    const originalId = originalRow.id;

    await markRelayRoomSessionInactive("user-A", "!room1:server");

    // Sleep 1s so CURRENT_TIMESTAMP granularity (seconds) advances between
    // updates — SQLite CURRENT_TIMESTAMP has 1-second resolution, so a
    // sub-second gap would leave updated_at unchanged.
    await new Promise((r) => setTimeout(r, 1100));

    await reactivateRelayRoomSession("user-A", "!room1:server");

    const row = selectRow("user-A", "!room1:server");
    expect(row).toBeDefined();
    expect(row!.id).toBe(originalId); // same row (D-03)
    expect(row!.state).toBe("active");
    expect(row!.updated_at >= originalRow.updated_at).toBe(true);

    // listActive again shows the row (state filter kicks back in).
    const list = await listActiveRelayRoomSessions("user-A");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(originalId);
  }, 10_000);
});

describe("relay-room-sessions-store — refreshRelayRoomLastActivity", () => {
  it("Test 6: updates last_activity_at to the provided ISO timestamp", async () => {
    await materializeRelayRoomSession("user-A", "!room1:server", "Room 1");
    await refreshRelayRoomLastActivity(
      "user-A",
      "!room1:server",
      "2026-09-08T12:00:00Z",
    );

    const row = selectRow("user-A", "!room1:server");
    expect(row!.last_activity_at).toBe("2026-09-08T12:00:00Z");
  });
});

describe("relay-room-sessions-store — persistence flush discipline", () => {
  it("Test 7: crown-jewel primitives use forceSave; refreshLastActivity uses triggerSave (hotfix — disk sat)", async () => {
    await materializeRelayRoomSession("user-A", "!room1:server", "Room 1");
    await markRelayRoomSessionInactive("user-A", "!room1:server");
    await reactivateRelayRoomSession("user-A", "!room1:server");
    await refreshRelayRoomLastActivity(
      "user-A",
      "!room1:server",
      "2026-09-08T12:00:00Z",
    );

    // Three crown-jewel primitives (materialize / markInactive / reactivate)
    // still use forceSave — they mutate row lifecycle state that must not be
    // lost across container restart.
    expect(forceSaveSpy).toHaveBeenCalledTimes(3);
    for (const call of forceSaveSpy.mock.calls) {
      expect(call[0]).toMatch(/^phase-89-/);
    }

    // refreshRelayRoomLastActivity uses debounced triggerSave — called on
    // every observation tick per user per room; forceSave here saturated
    // disk at t1000 immediately after the arc-close deploy 2026-09-09.
    // last_activity_at is ephemeral (regenerates from Matrix admin API on
    // next 10s tick), so debounced flush is correct.
    expect(triggerSaveSpy).toHaveBeenCalledTimes(1);
    expect(triggerSaveSpy.mock.calls[0][0]).toMatch(/^phase-89-/);

    // Read-only primitive does NOT trigger any save.
    forceSaveSpy.mockClear();
    triggerSaveSpy.mockClear();
    await listActiveRelayRoomSessions("user-A");
    expect(forceSaveSpy).not.toHaveBeenCalled();
    expect(triggerSaveSpy).not.toHaveBeenCalled();
  });

  it("Test 8: if forceSave rejects, the primitive still returns without throwing (log-and-swallow)", async () => {
    forceSaveSpy.mockRejectedValueOnce(new Error("disk gone"));

    await expect(
      materializeRelayRoomSession("user-A", "!room1:server", "Room 1"),
    ).resolves.toBeUndefined();

    // Row was still written to RAM despite the flush failure.
    const row = selectRow("user-A", "!room1:server");
    expect(row).toBeDefined();
    expect(row!.state).toBe("active");
  });
});
