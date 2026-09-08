/**
 * Phase 89 Plan 02 Task 2 — registry-rooms module tests.
 *
 * Covers the 8 behaviors from PLAN.md § Task 2:
 *   Test 1: ensureRegistryRoomsExist with no admin creds returns
 *           { ok:false, reason:"creds_missing" } and does NOT throw.
 *   Test 2: ensureRegistryRoomsExist on fresh install (neither settings row
 *           present) calls createRoom TWICE, persists both room_ids to
 *           settings, and calls addAdminRoom for each returned room_id.
 *   Test 3: ensureRegistryRoomsExist when both settings rows already exist
 *           is a no-op that returns { ok:true, agentsRoomId, humansRoomId }
 *           — does NOT call createRoom again (idempotent boot-safe).
 *   Test 4: getAgentsRegistryRoomId returns the stored room_id, or null when
 *           the settings row is absent.
 *   Test 5: joinAgentToAgentsRegistry reads the stored agents room_id and
 *           calls joinRoom(roomId, agentMxid); returns joinRoom result verbatim.
 *   Test 6: joinAgentToAgentsRegistry when the settings row is absent
 *           returns { ok:false, status:500, error:"registry_room_not_configured" }
 *           — does NOT throw.
 *   Test 7: joinHumanToHumansRegistry mirrors Test 5/6 for the humans room.
 *   Test 8: ensureRegistryRoomsExist logs structured entries at each
 *           interaction boundary (creds-missing, create-room fire, addAdminRoom
 *           fire) via databaseLogger.
 *
 * Test infrastructure — same scaffolding pattern as admin-rooms-ignore-list.test.ts
 * (fresh better-sqlite3 per test via beforeEach, vi.mock db.$client passthrough,
 * forceSave spy, quiet logger, mocked matrix-admin-client + admin-rooms-ignore-list).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Test-owned in-memory sqlite — replaced in beforeEach.
// ---------------------------------------------------------------------------

let sqliteInstance: Database.Database;

// Byte-parallel to production settings table (raw DDL from db/index.ts L170-173).
const SETTINGS_DDL = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
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

vi.mock("../matrix/matrix-admin-client.js", () => ({
  createRoom: vi.fn(),
  joinRoom: vi.fn(),
}));

vi.mock("../matrix/matrix-admin-creds-store.js", () => ({
  getMatrixAdminCreds: vi.fn(),
}));

vi.mock("./admin-rooms-ignore-list.js", () => ({
  addAdminRoom: vi.fn().mockResolvedValue(undefined),
  isAdminRoom: vi.fn().mockResolvedValue(true),
}));

// ---------------------------------------------------------------------------
// Import module + trigger spies AFTER mocks.
// ---------------------------------------------------------------------------

import {
  ensureRegistryRoomsExist,
  joinAgentToAgentsRegistry,
  joinHumanToHumansRegistry,
  getAgentsRegistryRoomId,
  getHumansRegistryRoomId,
  SETTINGS_KEY_AGENTS_REGISTRY,
  SETTINGS_KEY_HUMANS_REGISTRY,
} from "./registry-rooms.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { databaseLogger } from "../utils/logger.js";
import { createRoom, joinRoom } from "../matrix/matrix-admin-client.js";
import { getMatrixAdminCreds } from "../matrix/matrix-admin-creds-store.js";
import { addAdminRoom, isAdminRoom } from "./admin-rooms-ignore-list.js";

const forceSaveSpy = DatabaseSaveTrigger.forceSave as ReturnType<typeof vi.fn>;
const createRoomSpy = createRoom as unknown as ReturnType<typeof vi.fn>;
const joinRoomSpy = joinRoom as unknown as ReturnType<typeof vi.fn>;
const getCredsSpy = getMatrixAdminCreds as unknown as ReturnType<typeof vi.fn>;
const addAdminRoomSpy = addAdminRoom as unknown as ReturnType<typeof vi.fn>;
const isAdminRoomSpy = isAdminRoom as unknown as ReturnType<typeof vi.fn>;
const loggerInfoSpy = databaseLogger.info as ReturnType<typeof vi.fn>;
const loggerWarnSpy = databaseLogger.warn as ReturnType<typeof vi.fn>;

const HAPPY_CREDS = {
  homeserverBase: "http://100.113.23.63:8008",
  userId: "@skynet-admin:thenasty.taild9b663.ts.net",
  accessToken: "syt_admin_token_abcdefg",
  password: "admin-plaintext-password",
};

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  sqliteInstance?.close();
  sqliteInstance = new Database(":memory:");
  sqliteInstance.exec(SETTINGS_DDL);

  forceSaveSpy.mockClear();
  forceSaveSpy.mockResolvedValue(undefined);
  createRoomSpy.mockReset();
  joinRoomSpy.mockReset();
  getCredsSpy.mockReset();
  addAdminRoomSpy.mockReset();
  addAdminRoomSpy.mockResolvedValue(undefined);
  isAdminRoomSpy.mockReset();
  isAdminRoomSpy.mockResolvedValue(true);
  loggerInfoSpy.mockClear();
  loggerWarnSpy.mockClear();

  // Default: happy creds present. Override per-test.
  getCredsSpy.mockResolvedValue(HAPPY_CREDS);
});

// ---------------------------------------------------------------------------
// SETTINGS_KEY constants — Plan 03 observation loop imports these; lock them.
// ---------------------------------------------------------------------------

describe("registry-rooms — exported settings keys", () => {
  it("SETTINGS_KEY_AGENTS_REGISTRY = 'agents_registry_room_id'", () => {
    expect(SETTINGS_KEY_AGENTS_REGISTRY).toBe("agents_registry_room_id");
  });
  it("SETTINGS_KEY_HUMANS_REGISTRY = 'humans_registry_room_id'", () => {
    expect(SETTINGS_KEY_HUMANS_REGISTRY).toBe("humans_registry_room_id");
  });
});

// ---------------------------------------------------------------------------
// ensureRegistryRoomsExist
// ---------------------------------------------------------------------------

describe("ensureRegistryRoomsExist", () => {
  it("Test 1: no admin creds → { ok:false, reason:'creds_missing' }, does NOT throw", async () => {
    getCredsSpy.mockResolvedValueOnce(null);
    await expect(ensureRegistryRoomsExist()).resolves.toEqual({
      ok: false,
      reason: "creds_missing",
    });
    expect(createRoomSpy).not.toHaveBeenCalled();
    expect(addAdminRoomSpy).not.toHaveBeenCalled();
  });

  it("Test 2: fresh install (neither settings row present) → calls createRoom TWICE, persists both to settings, calls addAdminRoom for each", async () => {
    createRoomSpy
      .mockResolvedValueOnce({
        ok: true,
        roomId: "!agents:server",
      })
      .mockResolvedValueOnce({
        ok: true,
        roomId: "!humans:server",
      });

    const result = await ensureRegistryRoomsExist();
    expect(result).toEqual({
      ok: true,
      agentsRoomId: "!agents:server",
      humansRoomId: "!humans:server",
    });
    expect(createRoomSpy).toHaveBeenCalledTimes(2);

    // Verify names / preset / visibility per D-10 planner-locked strings.
    const call0 = createRoomSpy.mock.calls[0][0];
    const call1 = createRoomSpy.mock.calls[1][0];
    const names = [call0.name, call1.name].sort();
    expect(names).toEqual([
      "Skynet agents directory (internal)",
      "Skynet humans directory (internal)",
    ]);
    // Both must be preset=private_chat, visibility=private per D-10.
    for (const call of [call0, call1]) {
      expect(call.preset).toBe("private_chat");
      expect(call.visibility).toBe("private");
    }

    // Both room_ids persisted to settings under the exported keys.
    const agentsRow = sqliteInstance
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(SETTINGS_KEY_AGENTS_REGISTRY) as { value: string } | undefined;
    const humansRow = sqliteInstance
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(SETTINGS_KEY_HUMANS_REGISTRY) as { value: string } | undefined;
    expect(agentsRow?.value).toBe("!agents:server");
    expect(humansRow?.value).toBe("!humans:server");

    // addAdminRoom called for each returned room_id (D-13).
    expect(addAdminRoomSpy).toHaveBeenCalledTimes(2);
    const roomsAdded = addAdminRoomSpy.mock.calls.map((c) => c[0]).sort();
    expect(roomsAdded).toEqual(["!agents:server", "!humans:server"]);

    // forceSave paired.
    expect(forceSaveSpy).toHaveBeenCalled();
    expect(forceSaveSpy.mock.calls[0][0]).toMatch(/^phase-89-registry-rooms-ensure/);
  });

  it("Test 3: both settings rows already exist → no-op returns cached IDs; createRoom NOT called again", async () => {
    sqliteInstance
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run(SETTINGS_KEY_AGENTS_REGISTRY, "!existing-agents:server");
    sqliteInstance
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run(SETTINGS_KEY_HUMANS_REGISTRY, "!existing-humans:server");

    const result = await ensureRegistryRoomsExist();
    expect(result).toEqual({
      ok: true,
      agentsRoomId: "!existing-agents:server",
      humansRoomId: "!existing-humans:server",
    });
    expect(createRoomSpy).not.toHaveBeenCalled();
    expect(addAdminRoomSpy).not.toHaveBeenCalled();
  });

  it("Test 3b: only one settings row present → creates the missing room only, does NOT re-create the existing one", async () => {
    sqliteInstance
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run(SETTINGS_KEY_AGENTS_REGISTRY, "!existing-agents:server");
    createRoomSpy.mockResolvedValueOnce({
      ok: true,
      roomId: "!fresh-humans:server",
    });

    const result = await ensureRegistryRoomsExist();
    expect(result).toEqual({
      ok: true,
      agentsRoomId: "!existing-agents:server",
      humansRoomId: "!fresh-humans:server",
    });
    expect(createRoomSpy).toHaveBeenCalledTimes(1);
    // The single createRoom call is for the humans room.
    expect(createRoomSpy.mock.calls[0][0].name).toBe(
      "Skynet humans directory (internal)",
    );
    // addAdminRoom fires only for the newly-created humans room.
    expect(addAdminRoomSpy).toHaveBeenCalledTimes(1);
    expect(addAdminRoomSpy.mock.calls[0][0]).toBe("!fresh-humans:server");
  });

  it("Test 8: logs structured entries at each interaction boundary (start, per-room create fire, per-room addAdminRoom fire)", async () => {
    createRoomSpy
      .mockResolvedValueOnce({ ok: true, roomId: "!agents:server" })
      .mockResolvedValueOnce({ ok: true, roomId: "!humans:server" });

    await ensureRegistryRoomsExist();

    // Should have logged at least a start op + one create-fire op per registry room.
    const infoOps = loggerInfoSpy.mock.calls
      .map((c) => (c[1] && typeof c[1] === "object" ? (c[1] as any).operation : undefined))
      .filter((op) => typeof op === "string");
    expect(infoOps).toContain("registry_rooms_ensure_start");
    // Two create-fire ops (one per role).
    const createFires = infoOps.filter(
      (op) => op === "registry_rooms_create_fire",
    );
    expect(createFires.length).toBe(2);
  });

  it("Test H-2 [fixup]: fast path self-heals missing admin_rooms row — both settings present, but one roomId absent from admin_rooms → addAdminRoom fires for that room", async () => {
    // Regression guard for finding H-2. The original createRegistryRoom
    // write order was: settings row FIRST + forceSave, then addAdminRoom
    // in a try/catch that just warned on failure. If addAdminRoom failed
    // on that first boot, subsequent boots fast-path (both settings rows
    // present) and NEVER retry addAdminRoom. Result: the registry room ID
    // stayed permanently absent from admin_rooms → classifier materialized
    // it for every user → registry room in every sidebar.
    //
    // Fix: on the fast path, after detecting both settings present,
    // verify each roomId is in admin_rooms via isAdminRoom(). If missing,
    // call addAdminRoom(missingRoomId) (idempotent).
    sqliteInstance
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run(SETTINGS_KEY_AGENTS_REGISTRY, "!agents-existing:server");
    sqliteInstance
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run(SETTINGS_KEY_HUMANS_REGISTRY, "!humans-existing:server");
    // Simulate: agents room IS in admin_rooms (previous boot succeeded on
    // addAdminRoom for agents), humans room is NOT (previous boot's
    // addAdminRoom for humans failed and was warn-swallowed).
    isAdminRoomSpy.mockImplementation(async (roomId: string) => {
      return roomId === "!agents-existing:server";
    });

    const result = await ensureRegistryRoomsExist();
    expect(result).toEqual({
      ok: true,
      agentsRoomId: "!agents-existing:server",
      humansRoomId: "!humans-existing:server",
    });
    // No createRoom (fast path).
    expect(createRoomSpy).not.toHaveBeenCalled();
    // Self-heal: addAdminRoom fired for the missing one ONLY.
    expect(addAdminRoomSpy).toHaveBeenCalledTimes(1);
    expect(addAdminRoomSpy).toHaveBeenCalledWith("!humans-existing:server");
  });

  it("Test H-2b [fixup]: fast path with both admin_rooms entries present is a true no-op (isAdminRoom returns true for both, no addAdminRoom fires)", async () => {
    sqliteInstance
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run(SETTINGS_KEY_AGENTS_REGISTRY, "!agents-existing:server");
    sqliteInstance
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run(SETTINGS_KEY_HUMANS_REGISTRY, "!humans-existing:server");
    isAdminRoomSpy.mockResolvedValue(true);

    await ensureRegistryRoomsExist();
    expect(createRoomSpy).not.toHaveBeenCalled();
    expect(addAdminRoomSpy).not.toHaveBeenCalled();
  });

  it("Test 8b (defensive): createRoom failure on one role does not persist that role's ID nor call addAdminRoom for it; returns failure reason", async () => {
    createRoomSpy
      .mockResolvedValueOnce({ ok: true, roomId: "!agents:server" })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        error: "admin_api_non_2xx",
      });

    const result = await ensureRegistryRoomsExist();
    expect(result.ok).toBe(false);

    // agents was persisted + ignore-listed (the successful one).
    const agentsRow = sqliteInstance
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(SETTINGS_KEY_AGENTS_REGISTRY) as { value: string } | undefined;
    expect(agentsRow?.value).toBe("!agents:server");
    // humans was NOT persisted.
    const humansRow = sqliteInstance
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(SETTINGS_KEY_HUMANS_REGISTRY);
    expect(humansRow).toBeUndefined();
    // addAdminRoom fired only for the successful room.
    expect(addAdminRoomSpy).toHaveBeenCalledTimes(1);
    expect(addAdminRoomSpy.mock.calls[0][0]).toBe("!agents:server");
  });
});

// ---------------------------------------------------------------------------
// getAgentsRegistryRoomId / getHumansRegistryRoomId
// ---------------------------------------------------------------------------

describe("getAgentsRegistryRoomId / getHumansRegistryRoomId", () => {
  it("Test 4: returns the stored room_id when settings row exists", async () => {
    sqliteInstance
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run(SETTINGS_KEY_AGENTS_REGISTRY, "!stored-agents:server");
    sqliteInstance
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run(SETTINGS_KEY_HUMANS_REGISTRY, "!stored-humans:server");

    expect(await getAgentsRegistryRoomId()).toBe("!stored-agents:server");
    expect(await getHumansRegistryRoomId()).toBe("!stored-humans:server");
  });

  it("Test 4b: returns null when the settings row is absent", async () => {
    expect(await getAgentsRegistryRoomId()).toBeNull();
    expect(await getHumansRegistryRoomId()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// joinAgentToAgentsRegistry
// ---------------------------------------------------------------------------

describe("joinAgentToAgentsRegistry", () => {
  it("Test 5: reads stored agents-registry room_id and calls joinRoom(roomId, mxid); returns result verbatim", async () => {
    sqliteInstance
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run(SETTINGS_KEY_AGENTS_REGISTRY, "!agents:server");
    joinRoomSpy.mockResolvedValueOnce({ ok: true, roomId: "!agents:server" });

    const result = await joinAgentToAgentsRegistry("@alice-agent:server");
    expect(result).toEqual({ ok: true, roomId: "!agents:server" });
    expect(joinRoomSpy).toHaveBeenCalledTimes(1);
    expect(joinRoomSpy).toHaveBeenCalledWith(
      "!agents:server",
      "@alice-agent:server",
    );
  });

  it("Test 5b: joinRoom failure is returned verbatim (no throw)", async () => {
    sqliteInstance
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run(SETTINGS_KEY_AGENTS_REGISTRY, "!agents:server");
    joinRoomSpy.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: "admin_api_non_2xx",
    });

    const result = await joinAgentToAgentsRegistry("@bob-agent:server");
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "admin_api_non_2xx",
    });
  });

  it("Test 6: settings row absent → { ok:false, status:500, error:'registry_room_not_configured' }, joinRoom NEVER called", async () => {
    const result = await joinAgentToAgentsRegistry("@some-agent:server");
    expect(result).toEqual({
      ok: false,
      status: 500,
      error: "registry_room_not_configured",
    });
    expect(joinRoomSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// joinHumanToHumansRegistry
// ---------------------------------------------------------------------------

describe("joinHumanToHumansRegistry", () => {
  it("Test 7: reads stored humans-registry room_id and calls joinRoom(roomId, mxid); returns result verbatim", async () => {
    sqliteInstance
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run(SETTINGS_KEY_HUMANS_REGISTRY, "!humans:server");
    joinRoomSpy.mockResolvedValueOnce({ ok: true, roomId: "!humans:server" });

    const result = await joinHumanToHumansRegistry("@ashley:server");
    expect(result).toEqual({ ok: true, roomId: "!humans:server" });
    expect(joinRoomSpy).toHaveBeenCalledWith("!humans:server", "@ashley:server");
  });

  it("Test 7b: settings row absent → { ok:false, status:500, error:'registry_room_not_configured' }, joinRoom NEVER called", async () => {
    const result = await joinHumanToHumansRegistry("@ashley:server");
    expect(result).toEqual({
      ok: false,
      status: 500,
      error: "registry_room_not_configured",
    });
    expect(joinRoomSpy).not.toHaveBeenCalled();
  });
});
