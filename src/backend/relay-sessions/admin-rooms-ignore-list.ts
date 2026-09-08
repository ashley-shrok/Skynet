/**
 * admin-rooms-ignore-list.ts — Skynet-instance-owned ignore-list of Matrix
 * room IDs the observation loop MUST skip when materializing relay-room
 * sessions (Phase 89 Plan 01, D-13 + D-16).
 *
 * ## Purpose
 *
 * Registry rooms (agents-registry + humans-registry per D-10) have many
 * members and would otherwise trip the D-08 multi-member materialize rule
 * for every user — every user would see the registry rooms in their
 * sidebar. This ignore-list is populated at the moment Skynet creates each
 * registry room (Skynet knows the room IDs at creation time), and the
 * observation loop consults it during materialization to skip these
 * admin-purposes-only rooms.
 *
 * ## Shape (D-16 planner-choice)
 *
 * A small dedicated `admin_rooms` table (room_id PRIMARY KEY) rather than
 * a JSON-in-settings row — easier to inspect via raw SQL for ops
 * debugging, negligible storage overhead for the ~2 rows expected, and
 * the primitive extends cleanly to any future admin-purposes-only room
 * (box-maintainer coord room, etc.) without a schema migration.
 *
 * ## Ownership
 *
 * Each Skynet instance owns its own ignore-list (t1000's list has t1000's
 * registry room IDs; T800's has T800's). Nothing hard-coded, nothing
 * cross-instance. Internal-only — no user-visible surface, no admin
 * console, no debug endpoint in this slice.
 *
 * ## Invariant: every write triggers a labeled forceSave (crown jewel)
 *
 * addAdminRoom is paired with DatabaseSaveTrigger.forceSave("phase-89-...")
 * wrapped in try/catch that logs a warn without propagating. Mirrors
 * host-autostart-routes.ts:173-181, identity-send-log-store.ts:167-181,
 * and relay-room-sessions-store.ts. A flush failure must not fail the
 * caller (RAM-only row is better than a 500 back to the registry-room
 * creation path). Read primitives (isAdminRoom, listAdminRooms) do NOT
 * trigger forceSave.
 */

import { db } from "../database/db/index.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { databaseLogger } from "../utils/logger.js";

/**
 * Check whether a given room ID is in the admin-rooms ignore-list. The
 * observation loop calls this during materialization to decide whether
 * to skip the room. Returns false on empty table or non-matching room.
 *
 * Read-only — no forceSave.
 */
export async function isAdminRoom(roomId: string): Promise<boolean> {
  const row = db.$client
    .prepare("SELECT 1 AS one FROM admin_rooms WHERE room_id = ? LIMIT 1")
    .get(roomId) as { one: number } | undefined;
  return row !== undefined;
}

/**
 * Add a room to the admin-rooms ignore-list. Called at the moment Skynet
 * creates each registry room (D-13). Idempotent via INSERT OR IGNORE on
 * the room_id PRIMARY KEY — safe to call repeatedly, second call is a
 * no-op.
 *
 * Paired with DatabaseSaveTrigger.forceSave("phase-89-admin-room-add")
 * wrapped in try/catch that logs and swallows — crown-jewel invariant.
 */
export async function addAdminRoom(roomId: string): Promise<void> {
  databaseLogger.info("admin_rooms add", {
    operation: "admin_rooms_add",
    roomId,
  });

  db.$client
    .prepare("INSERT OR IGNORE INTO admin_rooms (room_id) VALUES (?)")
    .run(roomId);

  try {
    await DatabaseSaveTrigger.forceSave("phase-89-admin-room-add");
  } catch (err) {
    databaseLogger.warn(
      "admin_rooms persistence flush failed — write persisted to RAM only",
      {
        operation: "admin_rooms_force_save_failed",
        reason: "phase-89-admin-room-add",
        roomId,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
  }
}

/**
 * List all admin room IDs. Used for internal auditing only (no user-visible
 * surface per D-16). Order is unspecified — callers must not rely on it.
 *
 * Read-only — no forceSave.
 */
export async function listAdminRooms(): Promise<string[]> {
  const rows = db.$client
    .prepare("SELECT room_id AS roomId FROM admin_rooms")
    .all() as { roomId: string }[];
  return rows.map((r) => r.roomId);
}
