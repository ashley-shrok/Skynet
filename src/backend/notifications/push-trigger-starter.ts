/**
 * Phase 128 Plan 06 Task 2 — push-trigger-loop boot-time bootstrap.
 *
 * Mirrors `observation-loop-starter.ts` byte-for-byte in shape (docblock,
 * best-effort discipline, user-enumeration query, module-level scheduler
 * reference, discriminated-union return type) with three deliberate
 * adaptations:
 *
 *   1. VAPID-config gate replaces the ensureRegistryRoomsExist gate. VAPID
 *      missing → warn + return {ok:false, reason:"vapid_missing"} CLEANLY,
 *      not fail-fast. The fail-fast surface for VAPID is
 *      `assertVapidConfigAtBoot` (called EARLIER in starter.ts per Plan 08);
 *      this starter degrades to a no-op if that assertion was somehow
 *      bypassed. Fail-safe mirroring observation-loop-starter's degraded-
 *      mode-avoidance for missing admin creds.
 *
 *   2. No idempotent room-creation prerequisite step — push-trigger has no
 *      Skynet-owned rooms to bootstrap.
 *
 *   3. Loop dep wiring includes push-specific concrete deps: fetchLive
 *      (wraps fetchRoomHistory with dir=f), sendPushToUser (from push-sender),
 *      derivePreviewText + resolveAgentDisplayName (from Wave 1). Each dep
 *      slot on PushTriggerLoopDeps gets wired to its production
 *      implementation here — this is the ONE PLACE the loop touches the rest
 *      of the codebase's I/O primitives.
 *
 * ## Sequence at boot
 *
 *   1. Enumerate users with a populated `mxid` from the users table. Zero
 *      users → info log + {ok:false, reason:"no_users"} (no scheduler
 *      spun up).
 *
 *   2. VAPID sanity check via getVapidDetails() — if it throws (missing
 *      env vars, malformed subject), warn + return {ok:false, reason:
 *      "vapid_missing"}. Do NOT start the loop — push-sender.ts would
 *      have failed at module-load too, but belt-and-suspenders.
 *
 *   3. Wire PushTriggerLoopDeps with concrete implementations from Wave 1
 *      + existing classifier + matrix-admin-client primitives. Invoke
 *      createPushTriggerLoop(...).start(users). Store the returned
 *      scheduler in a module-level ref for future hot-reload / stop.
 *
 * ## Best-effort per PATTERNS.md § S3
 *
 * Every step is wrapped so a downstream failure logs + continues rather
 * than throwing back to the caller. starter.ts (Plan 08) fires this
 * fire-and-forget with a two-layer catch (module-load + runtime), mirroring
 * the observation-loop-starter dispatch idiom exactly. Server startup MUST
 * NOT abort because the push-trigger bootstrap failed.
 *
 * ## Loop reference (deferred hot-reload)
 *
 * The scheduler returned by createPushTriggerLoop is stored in a
 * module-level variable so a future hot-reload / stop() surface can reach
 * it. v1 does NOT expose stop; the reference exists purely for future use
 * — same pattern as observation-loop-starter.ts:82-85.
 */

import { db } from "../database/db/index.js";
import { databaseLogger } from "../utils/logger.js";
import {
  createPushTriggerLoop,
  PUSH_TRIGGER_BATCH_SIZE,
  type PushTriggerLoopDeps,
  type PushTriggerLoopScheduler,
  type MatrixMessageEvent,
  type FetchLiveResult,
} from "./push-trigger-loop.js";
import { getVapidDetails } from "./vapid-config.js";
import { classifyRoom } from "../relay-sessions/observation-loop-classifier.js";
import { listAdminRooms } from "../relay-sessions/admin-rooms-ignore-list.js";
import { getAgentsRegistryRoomId } from "../relay-sessions/registry-rooms.js";
import {
  getUserJoinedRooms,
  getRoomJoinedMembers,
} from "../matrix/matrix-admin-client.js";
import { fetchRoomHistory } from "../relay-room-stream/matrix-message-fetch.js";
import { sendPushToUser } from "./push-sender.js";
import { derivePreviewText } from "./preview-text.js";
import { resolveAgentDisplayName } from "./resolve-agent-display-name.js";

/** Discriminated-union result of startPushTriggerLoopOnBoot. */
export type StartPushTriggerLoopResult =
  | { ok: true; users: number }
  | { ok: false; reason: string };

/**
 * Module-level reference to the scheduler so a future hot-reload can reach
 * it. v1 has no stop surface — the reference exists purely for future use.
 * Package-private (not exported).
 */
let _activePushTriggerLoop: PushTriggerLoopScheduler | null = null;

/**
 * Test-only escape hatch — read the module-level loop reference. Kept
 * package-private (not part of the public API) but exported so smoke tests
 * can confirm the reference was populated on happy path.
 */
export function __getActivePushTriggerLoopForTests(): PushTriggerLoopScheduler | null {
  return _activePushTriggerLoop;
}

/**
 * Boot-time bootstrap. See module docblock for the full sequence.
 * Best-effort per PATTERNS.md § S3 — returns a discriminated-union result
 * but never throws.
 */
export async function startPushTriggerLoopOnBoot(): Promise<StartPushTriggerLoopResult> {
  databaseLogger.info("[phase-128] push-trigger bootstrap start", {
    operation: "push_trigger_bootstrap_start",
  });

  // ── Step 1: enumerate users with a populated mxid ─────────────────────
  // Byte-mirror of observation-loop-starter.ts:123-129.
  let users: Array<{ userId: string; userMxid: string }> = [];
  try {
    users = db.$client
      .prepare(
        "SELECT id AS userId, mxid AS userMxid FROM users WHERE mxid IS NOT NULL AND mxid != ''",
      )
      .all() as Array<{ userId: string; userMxid: string }>;
  } catch (err) {
    databaseLogger.warn(
      "[phase-128] push-trigger bootstrap — user enumeration failed, aborting",
      {
        operation: "push_trigger_bootstrap_enumerate_failed",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return { ok: false, reason: "exception" };
  }

  if (users.length === 0) {
    databaseLogger.info(
      "[phase-128] push-trigger bootstrap — zero users with mxid; push-trigger loop not started (no-op until users are added)",
      {
        operation: "push_trigger_bootstrap_zero_users",
      },
    );
    return { ok: false, reason: "no_users" };
  }

  // ── Step 2: VAPID sanity gate ─────────────────────────────────────────
  // Fail-SAFE (warn + return {ok:false}) not fail-FAST. The fail-fast
  // gate is assertVapidConfigAtBoot in starter.ts (Plan 08); this is a
  // belt-and-suspenders check. If VAPID isn't loaded, push-sender would
  // fail at module-load anyway — refusing to start the loop is the
  // graceful degradation.
  try {
    getVapidDetails();
  } catch (err) {
    databaseLogger.warn(
      "[phase-128] push-trigger bootstrap — VAPID config missing/malformed; push-trigger loop not started",
      {
        operation: "push_trigger_bootstrap_vapid_missing",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return { ok: false, reason: "vapid_missing" };
  }

  // ── Step 3: wire deps + start the loop ────────────────────────────────
  // Fix pass M-7: the earlier `mxidToUserId` reverse map + `resolveUserId`
  // dep is deleted. The loop's dispatch site already has `userId` in scope
  // (bound to state.userMxid at start()); it never called resolveUserId.
  // Removing the dead surface prevents a future maintainer from adding a
  // wrong call site.

  try {
    const deps: PushTriggerLoopDeps = {
      // Matrix live-event fetch — byte-mirror of the fetchLive closure in
      // relay-room-stream-server.ts:1142-1154. dir=f from the sinceToken
      // returns NEW events; nextSinceToken = response.end (dir=f advances
      // forward). Null when Matrix omits `end`.
      fetchLive: async (
        roomId: string,
        sinceToken: string,
        count: number,
      ): Promise<FetchLiveResult> => {
        const result = await fetchRoomHistory(roomId, {
          dir: "f",
          beforeEventId: sinceToken || undefined,
          count,
        });
        if (result.ok === false) return result;
        // fetchRoomHistory filters to m.room.message events already; cast
        // the loose MatrixEvent shape to the loop's narrow interface.
        return {
          ok: true,
          events: result.events as unknown as readonly MatrixMessageEvent[],
          nextSinceToken:
            typeof result.end === "string" ? result.end : null,
        };
      },
      getUserJoinedRooms,
      getRoomJoinedMembers,
      classifyRoom,
      listAdminRooms,
      getAgentsRegistryRoomId,
      // Per-tick registry-members fetch — the loop calls this once per
      // tick and reuses the Set across all rooms. We deliberately do NOT
      // cache across ticks here (unlike observation-loop's
      // AGENTS_REGISTRY_MEMBERS_CACHE_TTL_MS) — registry membership at
      // 2s tick cadence is cheap enough per user + fewer moving parts.
      getRegistryMembers: async (agentsRegistryRoomId: string) => {
        const result = await getRoomJoinedMembers(agentsRegistryRoomId);
        if (!result.ok) {
          // Return an empty set — classifier will decline every room
          // (no agents match) so no false-positive pushes fire while
          // the registry is unreachable.
          return new Set();
        }
        return new Set(result.memberMxids);
      },
      sendPushToUser,
      derivePreviewText,
      resolveAgentDisplayName,
      now: () => Date.now(),
    };

    // Unused local reminder: PUSH_TRIGGER_BATCH_SIZE is imported so the
    // deps object stays visibly tied to the batch constant if a future
    // adapter needs to reference it. Reference exists purely to document
    // the coupling — no runtime effect.
    void PUSH_TRIGGER_BATCH_SIZE;

    const loop = createPushTriggerLoop(deps);
    loop.start(users);
    _activePushTriggerLoop = loop;

    databaseLogger.info(
      "[phase-128] push-trigger bootstrap complete — loop started",
      {
        operation: "push_trigger_bootstrap_complete",
        users: users.length,
      },
    );
    return { ok: true, users: users.length };
  } catch (err) {
    databaseLogger.warn(
      "[phase-128] push-trigger bootstrap — loop wiring/start failed",
      {
        operation: "push_trigger_bootstrap_wire_failed",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return { ok: false, reason: "exception" };
  }
}
