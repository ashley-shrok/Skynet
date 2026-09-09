/**
 * relay-room-sessions-store.ts — single seam for reads + writes of the
 * `relay_room_sessions` SQLite table introduced by Phase 89 Plan 01.
 *
 * ## Phase 89 (D-01, D-02, D-03, D-14)
 *
 * This module owns ALL access to relay_room_sessions. Downstream consumers
 * in Phase 89 (Plan 02 registry-room backfill, Plan 03 observation loop,
 * Plan 04 /sessions/list merge) + slice C's create-room flow route through
 * these primitives so the schema-as-coordinator invariant (D-14) and the
 * row-preservation-on-external-kick invariant (D-03) live in exactly one
 * place.
 *
 * ### Invariant 1: uniqueness on (user_id, room_id) is the coordinator
 *
 * The DDL CREATE UNIQUE INDEX ... ON relay_room_sessions(user_id, room_id)
 * (added in db/index.ts by Task 1) is UNSCOPED — no WHERE state='active'
 * predicate. Every write goes through this module; observation loop and
 * slice C's create-room flow both call materializeRelayRoomSession, whose
 * INSERT uses ON-CONFLICT-DO-NOTHING (see the SQL literal below). The
 * second write is a no-op regardless of order — no cross-path coordination
 * logic needed. If the DDL ever regresses to a partial index, this
 * module's idempotency silently breaks; the schema tests
 * (index.phase89-schema.test.ts Test 2) are the trip-wire.
 *
 * ### Invariant 2: external-kick preserves the row (state transition, not DELETE)
 *
 * markRelayRoomSessionInactive flips state='active' → 'inactive' but
 * NEVER deletes the row (D-03). This preserves history navigation and
 * lets re-invite flip the same row back to active via
 * reactivateRelayRoomSession — no new insert, no new UUID, no history loss.
 * The unscoped uniqueness index (Invariant 1) enforces this: if we DELETEd
 * on kick and re-INSERTed on re-invite, nothing would enforce single-row
 * anchoring during the gap.
 *
 * ### Invariant 3: every write triggers a labeled forceSave (crown jewel)
 *
 * Skynet decrypts its SQLite DB into RAM at startup and only flushes back
 * to the on-disk encrypted copy when the save-trigger fires. Without an
 * explicit call, a write persists to RAM but is lost on non-graceful
 * shutdown (docker recreate, OOM, host reboot). Every mutating primitive
 * in this module is paired with DatabaseSaveTrigger.forceSave("phase-89-...")
 * wrapped in try/catch that logs a warning without propagating — mirrors
 * host-autostart-routes.ts:173-181 and identity-send-log-store.ts:167-181.
 * A downstream flush failure must not fail the caller (an in-memory row
 * is better than a 500 back to the observation-loop / create-room path).
 */

import { randomUUID } from "crypto";
import { db } from "../database/db/index.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { databaseLogger } from "../utils/logger.js";

/**
 * Materialize a relay-room session for (userId, roomId). Idempotent via
 * the SQL ON-CONFLICT-DO-NOTHING literal below — schema is the coordinator
 * (D-14). Called by BOTH the observation loop and slice C's create-room
 * flow; whichever runs first wins, the other is a no-op.
 *
 * State starts as 'active' with last_activity_at NULL — the observation
 * loop's next tick fills last_activity_at via refreshRelayRoomLastActivity.
 */
export async function materializeRelayRoomSession(
  userId: string,
  roomId: string,
  roomTitle: string | null,
): Promise<void> {
  // Fixup N-2 (2026-09-08). Entry log downgraded to .debug — this fires
  // per-tick per-room and spammed logs at info level. Failure paths
  // (.warn on forceSave rejection) retain their original severity.
  databaseLogger.debug("relay_room_session materialize", {
    operation: "relay_room_session_materialize",
    userId,
    roomId,
  });

  const id = randomUUID();
  db.$client
    .prepare(
      `INSERT INTO relay_room_sessions (id, user_id, room_id, room_title, state)
       VALUES (?, ?, ?, ?, 'active')
       ON CONFLICT(user_id, room_id) DO NOTHING`,
    )
    .run(id, userId, roomId, roomTitle);

  try {
    await DatabaseSaveTrigger.forceSave("phase-89-relay-session-materialize");
  } catch (err) {
    databaseLogger.warn(
      "relay_room_sessions persistence flush failed — write persisted to RAM only",
      {
        operation: "relay_room_session_force_save_failed",
        reason: "phase-89-relay-session-materialize",
        userId,
        roomId,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
  }
}

/**
 * Mark a relay-room session inactive (external kick from D-03). Flips
 * state='active' → 'inactive' via a conditional UPDATE and bumps updated_at.
 * The row is preserved so re-invite (reactivateRelayRoomSession) reuses it
 * rather than creating a new one.
 *
 * If the row is already inactive (or doesn't exist), the UPDATE affects
 * 0 rows — a no-op. Still triggers forceSave (harmless; the trigger is
 * debounce-safe).
 */
export async function markRelayRoomSessionInactive(
  userId: string,
  roomId: string,
): Promise<void> {
  // Fixup N-2: entry log downgraded to .debug (per-tick per-room spam).
  databaseLogger.debug("relay_room_session mark inactive", {
    operation: "relay_room_session_mark_inactive",
    userId,
    roomId,
  });

  db.$client
    .prepare(
      `UPDATE relay_room_sessions
         SET state = 'inactive',
             updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?
         AND room_id = ?
         AND state = 'active'`,
    )
    .run(userId, roomId);

  try {
    await DatabaseSaveTrigger.forceSave("phase-89-relay-session-inactive");
  } catch (err) {
    databaseLogger.warn(
      "relay_room_sessions persistence flush failed — write persisted to RAM only",
      {
        operation: "relay_room_session_force_save_failed",
        reason: "phase-89-relay-session-inactive",
        userId,
        roomId,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
  }
}

/**
 * Reactivate a previously-inactive relay-room session (re-invite path,
 * D-03). Flips state='inactive' → 'active' via a conditional UPDATE.
 * Preserves the row's id and created_at (same row flips, NOT a new
 * insert) so history navigation persists across kick + re-invite cycles.
 *
 * If the row is already active (or doesn't exist), affects 0 rows — the
 * observation loop's materializeRelayRoomSession is the fallback for the
 * "row missing entirely" case.
 */
export async function reactivateRelayRoomSession(
  userId: string,
  roomId: string,
): Promise<void> {
  // Fixup N-2: entry log downgraded to .debug (per-tick per-room spam).
  databaseLogger.debug("relay_room_session reactivate", {
    operation: "relay_room_session_reactivate",
    userId,
    roomId,
  });

  db.$client
    .prepare(
      `UPDATE relay_room_sessions
         SET state = 'active',
             updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?
         AND room_id = ?
         AND state = 'inactive'`,
    )
    .run(userId, roomId);

  try {
    await DatabaseSaveTrigger.forceSave("phase-89-relay-session-reactivate");
  } catch (err) {
    databaseLogger.warn(
      "relay_room_sessions persistence flush failed — write persisted to RAM only",
      {
        operation: "relay_room_session_force_save_failed",
        reason: "phase-89-relay-session-reactivate",
        userId,
        roomId,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
  }
}

/**
 * Shape of a listed active relay-room session — camelCase per fleet wire
 * convention. Consumed by Plan 04's /sessions/list merge step.
 */
export interface ActiveRelayRoomSession {
  id: string;
  roomId: string;
  roomTitle: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * List all active relay-room sessions for a user. Filters state='active'
 * so the /sessions/list merge sees exactly the rooms the user is currently
 * a member of (from the observation loop's last successful tick).
 * Ordered by updated_at DESC so most-recently-transitioned rooms surface
 * first — slice D can re-sort by last_activity_at if the frontend prefers.
 *
 * Read-only — no forceSave.
 */
export async function listActiveRelayRoomSessions(
  userId: string,
): Promise<ActiveRelayRoomSession[]> {
  // Fixup N-2: entry log downgraded to .debug (per-tick per-room spam).
  databaseLogger.debug("relay_room_session list active", {
    operation: "relay_room_session_list_active",
    userId,
  });

  const rows = db.$client
    .prepare(
      `SELECT id,
              room_id       AS roomId,
              room_title    AS roomTitle,
              last_activity_at AS lastActivityAt,
              created_at    AS createdAt,
              updated_at    AS updatedAt
         FROM relay_room_sessions
        WHERE user_id = ?
          AND state = 'active'
        ORDER BY updated_at DESC`,
    )
    .all(userId) as ActiveRelayRoomSession[];

  return rows;
}

/**
 * Refresh last_activity_at on a relay-room session (called by observation
 * loop tick per D-05 same-tick augmentation). Also bumps updated_at so
 * listActive's DESC sort tracks real recency, not just state transitions.
 *
 * Unconditional UPDATE (no state filter) — even inactive rows can carry
 * activity metadata; the observation loop tick will materialize any
 * missing membership and refresh timestamps for all currently-joined rooms.
 */
export async function refreshRelayRoomLastActivity(
  userId: string,
  roomId: string,
  isoTs: string,
): Promise<void> {
  // Fixup N-2: entry log downgraded to .debug (per-tick per-room spam).
  databaseLogger.debug("relay_room_session refresh last activity", {
    operation: "relay_room_session_refresh_last_activity",
    userId,
    roomId,
  });

  db.$client
    .prepare(
      `UPDATE relay_room_sessions
         SET last_activity_at = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?
         AND room_id = ?`,
    )
    .run(isoTs, userId, roomId);

  // triggerSave (debounced, dirty-bit) — NOT forceSave. This is called on
  // every observation tick per user per room (~7-8 rewrites/sec at fleet
  // scale, saturated disk at 128 MB/sec sustained), which crown-jewel
  // forceSave rewrites of the whole encrypted DB blob turned into a box-wide
  // slowdown at t1000 immediately after the arc-close deploy 2026-09-09
  // (diagnosis: tina, iostat + write-rate + mtime + callsite grep). last_activity_at
  // is ephemeral bookkeeping — the next observation tick regenerates it from
  // Matrix admin API within 10s, so losing it across container restart is fine.
  // The debounced triggerSave lets the dirty-bit poller flush it periodically.
  try {
    await DatabaseSaveTrigger.triggerSave("phase-89-relay-session-refresh-activity");
  } catch (err) {
    databaseLogger.warn(
      "relay_room_sessions persistence flush failed — write persisted to RAM only",
      {
        operation: "relay_room_session_trigger_save_failed",
        reason: "phase-89-relay-session-refresh-activity",
        userId,
        roomId,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
  }
}
