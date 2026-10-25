/**
 * read-state-store.ts — per-user "seen up to" marks for agent conversations.
 *
 * A conversation is unread for a user when its last finished turn (see
 * turn-finish-store.ts) is newer than the turn that user last saw. The seen
 * value stored here IS a turn-log value the browser echoed back, so the
 * comparison never mixes clocks.
 *
 * Each user also gets a baseline, created the first time their read state is
 * fetched. At that moment every turn already in the turn log is recorded as
 * seen for them — launch day starts all-read without comparing clocks. A
 * conversation with no read row (its agent first finished later) is unread
 * once a turn finishes after the baseline time.
 *
 * DM marks sit beside the read state: when an agent DMs a user, the DM's
 * Matrix server time is recorded per (user, host, identity), and the user
 * seeing that conversation echoes it back as their seen DM. A conversation is
 * DM'd while its last DM is newer than its seen DM.
 *
 * Writes are monotonic and synchronous (better-sqlite3); persistence goes
 * through the save trigger (debounced for seen marks, immediate for the
 * one-off baseline so a crash cannot re-light a user's whole list).
 */
import type Database from "better-sqlite3";
import { getSqlite } from "../database/db/index.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { databaseLogger } from "../utils/logger.js";
import { isValidIdentityName } from "./attention-schema.js";

export { isValidIdentityName };

export interface SeenEntry {
  hostId: string;
  identityName: string;
  seenFinishAt: number;
}

export interface DmEntry {
  hostId: string;
  identityName: string;
  lastDmAt: number;
  seenDmAt: number;
}

export interface UserReadState {
  baselineAt: number;
  seen: SeenEntry[];
  dms: DmEntry[];
}

export interface ReadStateStore {
  /** The user's baseline + every seen mark; creates the baseline if absent. */
  getForUser(userId: string): UserReadState;
  /** Advance a seen mark. Returns true iff the stored value advanced. */
  markSeen(userId: string, hostId: string, identityName: string, seenFinishAt: number): boolean;
  /**
   * Advance the seen mark of every user with read tracking (the user replied
   * to the agent). Returns the users whose mark advanced.
   */
  markSeenForAllUsers(hostId: string, identityName: string, seenFinishAt: number): string[];
  /** Record an agent's DM to a user (max-wins). Returns the row iff it advanced. */
  recordDm(userId: string, hostId: string, identityName: string, dmAt: number): DmEntry | null;
  /** Advance the user's seen DM. Returns the row iff it advanced. */
  markDmSeen(userId: string, hostId: string, identityName: string, seenDmAt: number): DmEntry | null;
}

function isValidKey(userId: unknown, hostId: unknown, identityName: unknown): boolean {
  return (
    typeof userId === "string" && userId.length > 0 &&
    typeof hostId === "string" && hostId.length > 0 &&
    isValidIdentityName(identityName)
  );
}

function isValidTime(t: unknown): t is number {
  return typeof t === "number" && Number.isFinite(t) && t > 0;
}

export function createReadStateStore(deps: {
  sqlite: () => Database.Database;
  now: () => number;
  save: (reason: string) => Promise<void> | void;
  forceSave: (reason: string) => Promise<void> | void;
}): ReadStateStore {
  const fireSave = (fn: (r: string) => Promise<void> | void, reason: string) => {
    try {
      void Promise.resolve(fn(reason)).catch((err: unknown) => {
        databaseLogger.warn("Read-state save trigger failed", {
          operation: "attention_read_state_save_failed",
          reason,
          error: err instanceof Error ? err.message : "unknown",
        });
      });
    } catch (err) {
      databaseLogger.warn("Read-state save trigger failed", {
        operation: "attention_read_state_save_failed",
        reason,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  };

  return {
    getForUser(userId) {
      const db = deps.sqlite();
      const existing = db
        .prepare("SELECT baseline_at FROM user_read_baseline WHERE user_id = ?")
        .get(userId) as { baseline_at: number } | undefined;
      let baselineAt: number;
      if (existing) {
        baselineAt = existing.baseline_at;
      } else {
        baselineAt = deps.now();
        const seeded = db.transaction(() => {
          db.prepare(
            "INSERT OR IGNORE INTO user_read_baseline (user_id, baseline_at) VALUES (?, ?)",
          ).run(userId, baselineAt);
          return db
            .prepare(
              `INSERT OR IGNORE INTO conversation_read_state (user_id, host_id, identity_name, seen_finish_at)
               SELECT ?, host_id, identity_name, last_finish_at FROM identity_turn_log`,
            )
            .run(userId).changes;
        })();
        databaseLogger.info("Read-state baseline created", {
          operation: "attention_read_baseline_created",
          userId,
          baselineAt,
          seededFromTurnLog: seeded,
        });
        fireSave(deps.forceSave, "attention-read-baseline");
      }
      const rows = db
        .prepare(
          "SELECT host_id, identity_name, seen_finish_at FROM conversation_read_state WHERE user_id = ?",
        )
        .all(userId) as Array<{ host_id: string; identity_name: string; seen_finish_at: number }>;
      const dmRows = db
        .prepare(
          "SELECT host_id, identity_name, last_dm_at, seen_dm_at FROM conversation_dm_state WHERE user_id = ?",
        )
        .all(userId) as DmRow[];
      return {
        baselineAt,
        seen: rows.map((r) => ({
          hostId: r.host_id,
          identityName: r.identity_name,
          seenFinishAt: r.seen_finish_at,
        })),
        dms: dmRows.map(toDmEntry),
      };
    },

    markSeen(userId, hostId, identityName, seenFinishAt) {
      if (!isValidKey(userId, hostId, identityName) || !isValidTime(seenFinishAt)) {
        return false;
      }
      const result = deps
        .sqlite()
        .prepare(
          `INSERT INTO conversation_read_state (user_id, host_id, identity_name, seen_finish_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, host_id, identity_name)
           DO UPDATE SET seen_finish_at = excluded.seen_finish_at
           WHERE excluded.seen_finish_at > conversation_read_state.seen_finish_at`,
        )
        .run(userId, hostId, identityName, seenFinishAt);
      const advanced = result.changes > 0;
      if (advanced) fireSave(deps.save, "attention-mark-seen");
      return advanced;
    },

    markSeenForAllUsers(hostId, identityName, seenFinishAt) {
      if (typeof hostId !== "string" || hostId.length === 0) return [];
      if (!isValidIdentityName(identityName) || !isValidTime(seenFinishAt)) return [];
      // WHERE true: SQLite needs it to tell the upsert's ON from a join's.
      const rows = deps
        .sqlite()
        .prepare(
          `INSERT INTO conversation_read_state (user_id, host_id, identity_name, seen_finish_at)
           SELECT user_id, ?, ?, ? FROM user_read_baseline WHERE true
           ON CONFLICT (user_id, host_id, identity_name)
           DO UPDATE SET seen_finish_at = excluded.seen_finish_at
           WHERE excluded.seen_finish_at > conversation_read_state.seen_finish_at
           RETURNING user_id`,
        )
        .all(hostId, identityName, seenFinishAt) as Array<{ user_id: string }>;
      if (rows.length > 0) fireSave(deps.save, "attention-mark-seen-on-reply");
      return rows.map((r) => r.user_id);
    },

    recordDm(userId, hostId, identityName, dmAt) {
      if (!isValidKey(userId, hostId, identityName) || !isValidTime(dmAt)) return null;
      const db = deps.sqlite();
      const result = db
        .prepare(
          `INSERT INTO conversation_dm_state (user_id, host_id, identity_name, last_dm_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, host_id, identity_name)
           DO UPDATE SET last_dm_at = excluded.last_dm_at
           WHERE excluded.last_dm_at > conversation_dm_state.last_dm_at`,
        )
        .run(userId, hostId, identityName, dmAt);
      if (result.changes === 0) return null;
      // A DM is rare and is the whole point of the mark: persist at once.
      fireSave(deps.forceSave, "attention-record-dm");
      return readDm(db, userId, hostId, identityName);
    },

    markDmSeen(userId, hostId, identityName, seenDmAt) {
      if (!isValidKey(userId, hostId, identityName) || !isValidTime(seenDmAt)) return null;
      const db = deps.sqlite();
      // Only a DM that was actually recorded can be seen, and never past it.
      const result = db
        .prepare(
          `UPDATE conversation_dm_state SET seen_dm_at = ?
           WHERE user_id = ? AND host_id = ? AND identity_name = ?
             AND ? > seen_dm_at AND ? <= last_dm_at`,
        )
        .run(seenDmAt, userId, hostId, identityName, seenDmAt, seenDmAt);
      if (result.changes === 0) return null;
      fireSave(deps.save, "attention-mark-dm-seen");
      return readDm(db, userId, hostId, identityName);
    },
  };
}

type DmRow = { host_id: string; identity_name: string; last_dm_at: number; seen_dm_at: number };

function toDmEntry(r: DmRow): DmEntry {
  return {
    hostId: r.host_id,
    identityName: r.identity_name,
    lastDmAt: r.last_dm_at,
    seenDmAt: r.seen_dm_at,
  };
}

function readDm(
  db: Database.Database,
  userId: string,
  hostId: string,
  identityName: string,
): DmEntry | null {
  const row = db
    .prepare(
      `SELECT host_id, identity_name, last_dm_at, seen_dm_at FROM conversation_dm_state
       WHERE user_id = ? AND host_id = ? AND identity_name = ?`,
    )
    .get(userId, hostId, identityName) as DmRow | undefined;
  return row ? toDmEntry(row) : null;
}

let singleton: ReadStateStore | null = null;

export function getReadStateStore(): ReadStateStore {
  if (!singleton) {
    singleton = createReadStateStore({
      sqlite: getSqlite,
      now: () => Date.now(),
      save: (reason) => DatabaseSaveTrigger.triggerSave(reason),
      forceSave: (reason) => DatabaseSaveTrigger.forceSave(reason),
    });
  }
  return singleton;
}

export function _setReadStateStoreForTesting(store: ReadStateStore | null): void {
  singleton = store;
}
