/**
 * turn-finish-store.ts — durable "when did this agent last finish a turn".
 *
 * Written by the fleet-status orchestrator each time it sees an identity's
 * Stop-file mtime advance; read when building every session frame (live and
 * dormant) so the browser always knows the last finished turn, even for an
 * agent that has since gone dormant.
 *
 * Hot path: the orchestrator calls this per session per tick, so reads go
 * through an in-memory map loaded once from SQLite; only an actual advance
 * touches the database. Writes are monotonic (an older stamp never
 * overwrites a newer one) and fail-open (a DB error is logged, never thrown
 * into the poll loop).
 */
import type Database from "better-sqlite3";
import { getSqlite } from "../database/db/index.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { databaseLogger } from "../utils/logger.js";

const SAVE_REASON = "attention-turn-finish";
const MAX_IDENTITY_NAME_LEN = 256;

export interface TurnFinishStore {
  /** Record a finished turn. Returns true iff the stored value advanced. */
  record(hostId: string, identityName: string, finishedAt: number): boolean;
  /** Last finished turn for (host, identity), or null when never seen. */
  get(hostId: string, identityName: string): number | null;
}

const key = (hostId: string, identityName: string) => `${hostId}::${identityName}`;

export function createTurnFinishStore(deps: {
  sqlite: () => Database.Database;
  save: (reason: string) => Promise<void> | void;
}): TurnFinishStore {
  let cache: Map<string, number> | null = null;

  const load = (): Map<string, number> => {
    if (cache) return cache;
    const next = new Map<string, number>();
    try {
      const rows = deps
        .sqlite()
        .prepare("SELECT host_id, identity_name, last_finish_at FROM identity_turn_log")
        .all() as Array<{ host_id: string; identity_name: string; last_finish_at: number }>;
      for (const r of rows) next.set(key(r.host_id, r.identity_name), r.last_finish_at);
      databaseLogger.info("Turn-finish log loaded", {
        operation: "attention_turn_log_load",
        rows: rows.length,
      });
    } catch (err) {
      // Not cached on failure, so the next call retries the load.
      databaseLogger.warn("Turn-finish log load failed", {
        operation: "attention_turn_log_load_failed",
        error: err instanceof Error ? err.message : "unknown",
      });
      return next;
    }
    cache = next;
    return cache;
  };

  return {
    record(hostId, identityName, finishedAt) {
      if (
        typeof hostId !== "string" || hostId.length === 0 ||
        typeof identityName !== "string" || identityName.length === 0 ||
        identityName.length > MAX_IDENTITY_NAME_LEN ||
        typeof finishedAt !== "number" || !Number.isFinite(finishedAt) || finishedAt <= 0
      ) {
        return false;
      }
      const map = load();
      const k = key(hostId, identityName);
      const prev = map.get(k);
      if (prev !== undefined && prev >= finishedAt) return false;
      try {
        deps
          .sqlite()
          .prepare(
            `INSERT INTO identity_turn_log (host_id, identity_name, last_finish_at)
             VALUES (?, ?, ?)
             ON CONFLICT (host_id, identity_name)
             DO UPDATE SET last_finish_at = excluded.last_finish_at
             WHERE excluded.last_finish_at > identity_turn_log.last_finish_at`,
          )
          .run(hostId, identityName, finishedAt);
      } catch (err) {
        databaseLogger.warn("Turn-finish stamp failed", {
          operation: "attention_turn_finish_stamp_failed",
          fleetHostId: hostId,
          identityName,
          finishedAt,
          error: err instanceof Error ? err.message : "unknown",
        });
        return false;
      }
      map.set(k, finishedAt);
      databaseLogger.info("Turn finish recorded", {
        operation: "attention_turn_finish_recorded",
        fleetHostId: hostId,
        identityName,
        finishedAt,
        previous: prev ?? null,
      });
      try {
        void Promise.resolve(deps.save(SAVE_REASON)).catch((err: unknown) => {
          databaseLogger.warn("Turn-finish save trigger failed", {
            operation: "attention_turn_finish_save_failed",
            error: err instanceof Error ? err.message : "unknown",
          });
        });
      } catch (err) {
        databaseLogger.warn("Turn-finish save trigger failed", {
          operation: "attention_turn_finish_save_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
      }
      return true;
    },
    get(hostId, identityName) {
      return load().get(key(hostId, identityName)) ?? null;
    },
  };
}

let singleton: TurnFinishStore | null = null;

/** Process-wide store over the app database. */
export function getTurnFinishStore(): TurnFinishStore {
  if (!singleton) {
    singleton = createTurnFinishStore({
      sqlite: getSqlite,
      save: (reason) => DatabaseSaveTrigger.triggerSave(reason),
    });
  }
  return singleton;
}

/** Test seam — swap or reset the process-wide store. */
export function _setTurnFinishStoreForTesting(store: TurnFinishStore | null): void {
  singleton = store;
}
