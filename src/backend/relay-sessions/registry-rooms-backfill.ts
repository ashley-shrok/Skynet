/**
 * registry-rooms-backfill.ts — Phase 89 Plan 02 Task 4.
 *
 * D-12 one-time backfill: existing agent + human Matrix accounts predate the
 * registry rooms (Plan 02 Task 2). Skynet is the account-creator for both
 * types since Phase 75 (agents) + Phase 88 (humans), so from-now-on the join
 * hook at each mint site (D-11) keeps things in sync. This module handles
 * the pre-existing gap on first-boot of the Phase 89 code:
 *
 *   1. Enumerate all existing humans from `SELECT mxid FROM users WHERE
 *      mxid IS NOT NULL AND mxid != ''` and call joinHumanToHumansRegistry
 *      for each. joinRoom is idempotent on the Synapse admin API — a mxid
 *      already in the room returns ok, so we don't need to check membership
 *      first (D-12 idempotent contract).
 *
 *   2. Enumerate all existing agents via an injected dep
 *      `enumerateAgentMxids: () => Promise<string[]>` and call
 *      joinAgentToAgentsRegistry for each. The enumerator is optional so
 *      this module stays unit-testable without SSH coupling — Plan 03's
 *      observation-loop bootstrap wires the real enumerator (which walks
 *      the fleet-status roster or reads on-disk `relay.json` per host at
 *      backfill-time only, per the D-09 rationale scope).
 *
 *   3. Flip the settings gate `has_backfilled_registry_rooms='true'` +
 *      fire a labeled forceSave. On the next boot, the gate short-circuits
 *      this whole flow to a no-op returning { ok:true, skipped:true }.
 *
 * ## Idempotency contract (D-12)
 *
 * Safe to re-run — the settings gate makes the second and subsequent calls
 * a fast-path no-op. Per-account join failures are best-effort: they log a
 * warning and continue, so a transient Synapse blip doesn't derail the
 * whole backfill. If backfill fails partway (e.g. creds go missing
 * mid-flight), the gate stays false and next boot retries.
 *
 * ## Operational escape hatch
 *
 * Clearing the settings row `has_backfilled_registry_rooms` from the SQL
 * console re-arms the backfill on next boot. No admin UI in this slice
 * per D-16.
 *
 * ## Boot-time invocation
 *
 * NOT in this module — Plan 03 owns the observation-loop bootstrap that
 * fires runRegistryRoomsBackfill before the first observation tick. This
 * module exports a pure importable function so the bootstrap can call it
 * in sequence.
 */

import { db } from "../database/db/index.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { databaseLogger } from "../utils/logger.js";
import {
  ensureRegistryRoomsExist,
  joinAgentToAgentsRegistry,
  joinHumanToHumansRegistry,
} from "./registry-rooms.js";

/** Settings-table key holding the D-12 idempotency gate flag. */
export const SETTINGS_KEY_HAS_BACKFILLED = "has_backfilled_registry_rooms";

/** Discriminated-union result of runRegistryRoomsBackfill. */
export type BackfillResult =
  | { ok: true; skipped: true }
  | {
      ok: true;
      skipped?: false;
      agentsAttempted: number;
      humansAttempted: number;
      agentsFailed: number;
      humansFailed: number;
    }
  | { ok: false; reason: string };

/**
 * Injectable dep for enumerating agent mxids at backfill time. Plan 03's
 * boot bootstrap will wire a concrete implementation (SSH-based on-disk
 * relay.json read per host — acceptable one-shot cost per D-09 rationale
 * scope). If omitted (e.g. in tests, or if Plan 03 hasn't wired it yet),
 * agents backfill is a no-op — the D-11 mint hook will cover future
 * agents, and the enumerator can be added later without a schema change.
 */
export interface BackfillDeps {
  enumerateAgentMxids?: () => Promise<string[]>;
}

/**
 * Run the one-time registry-rooms backfill (D-12).
 *
 * Concrete flow — see the module docblock for the design rationale.
 */
export async function runRegistryRoomsBackfill(
  deps: BackfillDeps = {},
): Promise<BackfillResult> {
  // Fast path: gate already flipped → no-op.
  const gate = db.$client
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(SETTINGS_KEY_HAS_BACKFILLED) as { value: string } | undefined;
  if (gate?.value === "true") {
    return { ok: true, skipped: true };
  }

  databaseLogger.info("registry backfill start", {
    operation: "registry_backfill_start",
  });

  // Defense-in-depth: ensure rooms exist. If creds are missing, bail early
  // without flipping the gate — next boot retries. This does NOT
  // re-createthe rooms if they already exist (ensureRegistryRoomsExist is
  // idempotent).
  const ensured = await ensureRegistryRoomsExist();
  if (!ensured.ok) {
    databaseLogger.warn(
      "registry backfill aborted — ensureRegistryRoomsExist failed",
      {
        operation: "registry_backfill_ensure_failed",
        reason: ensured.reason,
      },
    );
    return { ok: false, reason: ensured.reason };
  }

  // ---- Humans enumeration ----
  const humanRows = db.$client
    .prepare(
      "SELECT mxid FROM users WHERE mxid IS NOT NULL AND mxid != ''",
    )
    .all() as { mxid: string }[];
  const humanMxids = humanRows.map((r) => r.mxid);

  databaseLogger.info("registry backfill enumerated humans", {
    operation: "registry_backfill_enumerated",
    role: "humans",
    count: humanMxids.length,
  });

  let humansAttempted = 0;
  let humansFailed = 0;
  for (const mxid of humanMxids) {
    humansAttempted++;
    try {
      const r = await joinHumanToHumansRegistry(mxid);
      if (!r.ok) {
        humansFailed++;
        databaseLogger.warn(
          "registry backfill: humans join failed (best-effort per D-12)",
          {
            operation: "registry_backfill_join_failed",
            role: "humans",
            mxid,
            status: r.status,
            error: r.error,
          },
        );
      }
    } catch (err) {
      humansFailed++;
      databaseLogger.warn(
        "registry backfill: humans join threw (best-effort per D-12)",
        {
          operation: "registry_backfill_join_failed",
          role: "humans",
          mxid,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  // ---- Agents enumeration (optional dep) ----
  let agentsAttempted = 0;
  let agentsFailed = 0;
  if (deps.enumerateAgentMxids !== undefined) {
    let agentMxids: string[] = [];
    try {
      agentMxids = await deps.enumerateAgentMxids();
    } catch (err) {
      databaseLogger.warn(
        "registry backfill: agents enumeration threw — skipping agents backfill",
        {
          operation: "registry_backfill_enumerate_failed",
          role: "agents",
          error: err instanceof Error ? err.message : String(err),
        },
      );
      agentMxids = [];
    }

    databaseLogger.info("registry backfill enumerated agents", {
      operation: "registry_backfill_enumerated",
      role: "agents",
      count: agentMxids.length,
    });

    for (const mxid of agentMxids) {
      agentsAttempted++;
      try {
        const r = await joinAgentToAgentsRegistry(mxid);
        if (!r.ok) {
          agentsFailed++;
          databaseLogger.warn(
            "registry backfill: agents join failed (best-effort per D-12)",
            {
              operation: "registry_backfill_join_failed",
              role: "agents",
              mxid,
              status: r.status,
              error: r.error,
            },
          );
        }
      } catch (err) {
        agentsFailed++;
        databaseLogger.warn(
          "registry backfill: agents join threw (best-effort per D-12)",
          {
            operation: "registry_backfill_join_failed",
            role: "agents",
            mxid,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }
  } else {
    databaseLogger.info(
      "registry backfill: no agents enumerator dep provided — skipping agents backfill",
      {
        operation: "registry_backfill_enumerated",
        role: "agents",
        count: 0,
      },
    );
  }

  // ---- Flip the gate + forceSave ----
  db.$client
    .prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    )
    .run(SETTINGS_KEY_HAS_BACKFILLED, "true");

  try {
    await DatabaseSaveTrigger.forceSave("phase-89-backfill-complete");
  } catch (err) {
    databaseLogger.warn(
      "registry backfill: gate-flip persistence flush failed — write persisted to RAM only",
      {
        operation: "registry_backfill_force_save_failed",
        reason: "phase-89-backfill-complete",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
  }

  databaseLogger.info("registry backfill complete", {
    operation: "registry_backfill_complete",
    agentsAttempted,
    humansAttempted,
    agentsFailed,
    humansFailed,
  });

  return {
    ok: true,
    agentsAttempted,
    humansAttempted,
    agentsFailed,
    humansFailed,
  };
}
