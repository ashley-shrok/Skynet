/**
 * observation-loop-starter.ts — Phase 89-03 Task 4.
 *
 * D-04 boot-time observation-loop bootstrap. Sequence at boot:
 *
 *   1. ensureRegistryRoomsExist — idempotent creation of the two registry
 *      rooms (agents + humans) if not already present. If admin creds are
 *      missing (fresh install before ingest), bail early WITHOUT starting
 *      the loop; the caller (starter.ts) fires this best-effort and next
 *      boot retries.
 *
 *   2. runRegistryRoomsBackfill — D-12 one-shot join of pre-existing
 *      accounts into the newly-created registry rooms. Gated by a settings
 *      row so it's a fast no-op on subsequent boots. Failure here is
 *      logged as a warning but does NOT block the observation loop from
 *      starting — degraded classification is better than no observation at
 *      all (the classifier just materializes conservatively for two-party
 *      rooms with unrecognized other members).
 *
 *   3. Enumerate users with a populated `mxid` from the users table. Fresh
 *      installs may have zero — logged at info, scheduler starts empty (a
 *      no-op until users are added; hot-reload is a future slice).
 *
 *   4. Wire ObservationTickDeps with the concrete implementations from
 *      Plan 01 (relay-room-sessions-store + admin-rooms-ignore-list),
 *      Plan 02 (registry-rooms), and Task 1 (matrix-admin-client
 *      primitives). Kick off the per-user scheduler via createObservationLoop.
 *
 * ## Best-effort per D-07
 *
 * Every step is wrapped so a downstream failure logs + continues rather than
 * throwing back to the caller. The starter.ts call site fires this
 * fire-and-forget with a two-layer catch (module-load + runtime), matching
 * the Phase 79/83 reconcile-loop idiom exactly. Server startup MUST NOT
 * abort because the observation-loop bootstrap failed.
 *
 * ## Loop reference (deferred hot-reload)
 *
 * The scheduler returned by createObservationLoop is stored in a module-level
 * variable so a future hot-reload / stop() surface can reach it. v1 does NOT
 * expose stop; the reference exists purely for future use.
 *
 * ## Agents backfill dep — deferred
 *
 * runRegistryRoomsBackfill accepts an optional `enumerateAgentMxids` dep
 * (Plan 02 opt-in) that would SSH into each fleet host and read on-disk
 * `~/.claude/identities/<name>/relay.json` to collect pre-existing agent
 * mxids. This starter DOES NOT wire that dep — it is deferred to a
 * follow-up bounty. Rationale:
 *   - The D-11 mint hook (Phase 89-02) covers ALL new agents from now on.
 *   - Pre-existing agents that predate the registry rooms will simply
 *     be missing from the agents registry; the observation loop will
 *     conservatively materialize their two-party DMs (D-09 fallthrough)
 *     rather than excluding them. Slightly noisier sidebars for existing
 *     users but no correctness violation.
 *   - Implementing the SSH-based enumerator here would require coupling
 *     to fleet-status roster + per-host SSH exec + on-disk parsing —
 *     nontrivial surface that deserves its own plan.
 * See SUMMARY.md for the deferral note.
 */

import { db } from "../database/db/index.js";
import { databaseLogger } from "../utils/logger.js";
import {
  ensureRegistryRoomsExist,
  getAgentsRegistryRoomId,
} from "./registry-rooms.js";
import { runRegistryRoomsBackfill } from "./registry-rooms-backfill.js";
import {
  createObservationLoop,
  type ObservationLoopScheduler,
} from "./observation-loop.js";
import {
  materializeRelayRoomSession,
  markRelayRoomSessionInactive,
  reactivateRelayRoomSession,
  refreshRelayRoomLastActivity,
  listActiveRelayRoomSessions,
} from "./relay-room-sessions-store.js";
import { listAdminRooms } from "./admin-rooms-ignore-list.js";
import {
  getUserJoinedRooms,
  getRoomLatestEventTs,
  getRoomJoinedMembers,
} from "../matrix/matrix-admin-client.js";

/** Discriminated-union result of startObservationLoopOnBoot. */
export type StartObservationLoopResult =
  | { ok: true; usersScheduled: number }
  | { ok: false; reason: string };

/**
 * Module-level reference to the scheduler so a future hot-reload can reach
 * it. v1 has no stop surface — the reference exists purely for future use.
 * Package-private (not exported).
 */
let loopScheduler: ObservationLoopScheduler | null = null;

/**
 * Run the D-04 boot-time observation-loop bootstrap. See module docblock
 * for the full sequence. Best-effort per D-07 at every step; returns a
 * result but never throws.
 */
export async function startObservationLoopOnBoot(): Promise<StartObservationLoopResult> {
  databaseLogger.info("[phase-89] observation-loop bootstrap start", {
    operation: "relay_observation_bootstrap_start",
  });

  // Step 1: ensure the two registry rooms exist. This is a hard prerequisite
  // for the classifier's D-09 authority signal — without registry rooms,
  // agentsInRegistry would always be empty and we'd materialize every
  // two-party room including harness-covered DMs. Rather than run in a
  // degraded state, bail cleanly if creds aren't ingested yet; next boot
  // (or manual re-invoke after creds are ingested) will retry.
  const ensured = await ensureRegistryRoomsExist();
  if (!ensured.ok) {
    databaseLogger.warn(
      "[phase-89] observation-loop bootstrap aborted — ensureRegistryRoomsExist failed",
      {
        operation: "relay_observation_bootstrap_ensure_failed",
        reason: ensured.reason,
      },
    );
    return { ok: false, reason: ensured.reason };
  }

  // Step 2: D-12 idempotent backfill of pre-existing accounts. Log + proceed
  // on failure — degraded classification is better than no observation. The
  // gate makes this a fast no-op on subsequent boots.
  const backfill = await runRegistryRoomsBackfill({
    // enumerateAgentMxids intentionally omitted — deferred to a follow-up
    // bounty (see module docblock rationale).
  });
  if (!backfill.ok) {
    databaseLogger.warn(
      "[phase-89] observation-loop bootstrap — backfill failed but proceeding",
      {
        operation: "relay_observation_bootstrap_backfill_failed",
        reason: backfill.reason,
      },
    );
  }

  // Step 3: enumerate users with a populated mxid. Phase 88 D-06 guarantees
  // every user has mxid populated at create time, but defensively filter
  // NULL + empty-string (pre-Phase-88 rows may not have been migrated).
  let users: Array<{ userId: string; userMxid: string }> = [];
  try {
    users = db.$client
      .prepare(
        "SELECT id AS userId, mxid AS userMxid FROM users WHERE mxid IS NOT NULL AND mxid != ''",
      )
      .all() as Array<{ userId: string; userMxid: string }>;
  } catch (err) {
    databaseLogger.warn(
      "[phase-89] observation-loop bootstrap — user enumeration failed, starting empty",
      {
        operation: "relay_observation_bootstrap_enumerate_failed",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    users = [];
  }
  if (users.length === 0) {
    databaseLogger.info(
      "[phase-89] observation-loop bootstrap — zero users with mxid; starting empty scheduler (no-op until users are added)",
      {
        operation: "relay_observation_bootstrap_zero_users",
      },
    );
  }

  // Step 4: wire the ObservationTickDeps with concrete implementations from
  // Plans 01 + 02 + Task 1. All imports at module top so the wiring is a
  // straightforward object literal.
  const loop = createObservationLoop({
    getUserJoinedRooms,
    getRoomLatestEventTs,
    getRoomJoinedMembers,
    materializeRelayRoomSession,
    markRelayRoomSessionInactive,
    reactivateRelayRoomSession,
    refreshRelayRoomLastActivity,
    listActiveRelayRoomSessions,
    listAdminRooms,
    getAgentsRegistryRoomId,
  });
  loop.start(users);
  loopScheduler = loop;

  databaseLogger.info("[phase-89] observation-loop bootstrap complete", {
    operation: "relay_observation_bootstrap_complete",
    usersScheduled: users.length,
  });

  return { ok: true, usersScheduled: users.length };
}
