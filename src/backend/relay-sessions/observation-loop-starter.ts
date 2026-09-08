/**
 * observation-loop-starter.ts — Phase 89-03 Task 4.
 *
 * D-04 boot-time observation-loop bootstrap. Sequence at boot:
 *
 *   1. ensureRegistryRoomsExist — idempotent creation of the two registry
 *      rooms (agents + humans) if not already present. If admin creds are
 *      missing (fresh install before ingest), bail early WITHOUT starting
 *      the loop; the caller (starter.ts) fires this best-effort and next
 *      boot retries. Idempotent room-creation is fine to auto-run because
 *      it only writes DDL-shaped facts about Skynet's OWN administrative
 *      state — it does NOT reach into pre-existing user/agent accounts.
 *
 *   2. Enumerate users with a populated `mxid` from the users table. Fresh
 *      installs may have zero — logged at info, scheduler starts empty (a
 *      no-op until users are added; hot-reload is a future slice).
 *
 *   3. Wire ObservationTickDeps with the concrete implementations from
 *      Plan 01 (relay-room-sessions-store + admin-rooms-ignore-list),
 *      Plan 02 (registry-rooms), and Task 1 (matrix-admin-client
 *      primitives). Kick off the per-user scheduler via createObservationLoop.
 *
 * ## D-12 backfill is MANUAL per instance-deployer — NOT auto-invoked here
 *
 * Ashley 2026-09-08 (post-verifier clarification): "there's not supposed to
 * be automatic backfill anyways. Like I said, that would be a manual step
 * for whoever deploys this stuff over here on this instance and for Stacy
 * on her instance." Matches the Phase 88 D-02 precedent (existing users
 * hand-migrated by the maintainer of each Skynet instance).
 *
 * Consequence: this starter DOES NOT call `runRegistryRoomsBackfill`. The
 * function is still exported from `registry-rooms-backfill.ts` as a
 * manual-invocation utility — the instance-deployer runs it once after
 * deploy (see the phase's SUMMARY.md § Manual backfill runbook for how).
 * Between deploy and manual-backfill-run, pre-existing agents/humans are
 * NOT in the registry rooms and the classifier's D-09 fallthrough
 * conservatively materializes their two-party DMs — same trust model as
 * Phase 88's "existing users get hand-migrated" pattern. The D-11 mint
 * hooks (Phase 89-02) cover ALL new accounts from now on automatically.
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
 */

import { db } from "../database/db/index.js";
import { databaseLogger } from "../utils/logger.js";
import {
  ensureRegistryRoomsExist,
  getAgentsRegistryRoomId,
} from "./registry-rooms.js";
// D-12 backfill is MANUAL per instance-deployer (Ashley 2026-09-08 post-verifier
// clarification, matching Phase 88 D-02 precedent). The runRegistryRoomsBackfill
// function is kept as a manual-invocation utility exported from
// ./registry-rooms-backfill.js — the deployer runs it once after deploy per the
// phase's SUMMARY.md § Manual backfill runbook. It is intentionally NOT imported
// here to prevent accidental auto-invocation.
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

  // (Auto-backfill DELIBERATELY OMITTED — D-12 backfill is manual per
  // instance-deployer; see module docblock.)

  // Step 2: enumerate users with a populated mxid. Phase 88 D-06 guarantees
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

  // Step 3: wire the ObservationTickDeps with concrete implementations from
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
