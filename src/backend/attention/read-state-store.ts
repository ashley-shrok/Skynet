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

export interface UserReadState {
  baselineAt: number;
  seen: SeenEntry[];
}

export interface ReadStateStore {
  /** The user's baseline + every seen mark; creates the baseline if absent. */
  getForUser(userId: string): UserReadState;
  /** Advance a seen mark. Returns true iff the stored value advanced. */
  markSeen(userId: string, hostId: string, identityName: string, seenFinishAt: number): boolean;
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
      return {
        baselineAt,
        seen: rows.map((r) => ({
          hostId: r.host_id,
          identityName: r.identity_name,
          seenFinishAt: r.seen_finish_at,
        })),
      };
    },

    markSeen(userId, hostId, identityName, seenFinishAt) {
      if (
        typeof userId !== "string" || userId.length === 0 ||
        typeof hostId !== "string" || hostId.length === 0 ||
        !isValidIdentityName(identityName) ||
        typeof seenFinishAt !== "number" || !Number.isFinite(seenFinishAt) || seenFinishAt <= 0
      ) {
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
  };
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
