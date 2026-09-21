/**
 * spawn-requests/worker.ts
 *
 * Async birth-worker for the spawn-request queue (D-07, D-14, D-15).
 *
 * Provides:
 *   - parseRequestBody: validates request file JSON body against SpawnRequestBody
 *   - mapEndedEventToReason: maps BirthEvent ended{ok:false} to FailureReason enum
 *   - getHostOwnerUserId: direct Drizzle host-owner lookup (Pitfall 3)
 *   - processBirth: full birth flow — pre-flight checks, birthIdentity invocation,
 *     success/failure response file drop via writeMarkdownFileAtomic
 *   - buildProductionDeps: wires all real imports into a WorkerDeps object
 *   - WorkerDeps: dependency-injection interface so tests can override every dep
 *
 * CRITICAL: Use writeMarkdownFileAtomic for response files — the whitelist-guarded
 * identity-file writer blocks *.success.json / *.failure.json (Pitfall 1).
 * CRITICAL: Do NOT modify identity-birth-orchestrator.ts (D-20).
 */

import { systemLogger } from "../utils/logger.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { execCommand } from "../ssh/tmux-helper.js";
import { isLocalHostId, writeMarkdownFileAtomic } from "../claude-session/identity-artifact-reader.js";
import { discoverIdentitySessionFile } from "../claude-session/discover-identity-session-file.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import { birthIdentity, ROLE_NAME_PATTERN, SSH_CONNECT_TIMEOUT_MS, type BirthEvent, type BirthDeps, type BirthOptions } from "../database/routes/identity-birth-orchestrator.js";
import { acquireBirthSlot } from "../identity-birth/global-throttle.js";
import {
  createOrUpdateUser as matrixCreateOrUpdateUser,
  loginAsUser as matrixLoginAsUser,
  buildRelayJsonBody,
  countUsersMatching as matrixCountUsersMatching,
} from "../matrix/matrix-admin-client.js";
import { getMatrixAdminCreds } from "../matrix/matrix-admin-creds-store.js";
import { getVettedPool } from "../pool/pool-loader.js";
import { getDb } from "../database/db/index.js";
import { hosts } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import { promises as fsp } from "node:fs";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { PendingBirth, SpawnRequestBody, SuccessResponse, FailureResponse, FailureReason } from "./types.js";

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

const execLocal = promisify(execCb);

// ---------------------------------------------------------------------------
// parseRequestBody + TASK_MAX_LENGTH — re-exported from parse-request-body.ts
// ---------------------------------------------------------------------------

// parseRequestBody + TASK_MAX_LENGTH were moved to parse-request-body.ts to
// keep the fleet-status ssh-poll-orchestrator (which needs the pure parser
// for its per-tick spawn-request scan) from pulling worker.ts's heavy
// transitive graph (birthIdentity → Skynet DB init, matrix admin, pool-loader)
// into the fleet-status test module surface. Existing importers keep working
// via this re-export; the function bodies live in parse-request-body.ts.
export { parseRequestBody, TASK_MAX_LENGTH } from "./parse-request-body.js";

// ---------------------------------------------------------------------------
// mapEndedEventToReason
// ---------------------------------------------------------------------------

/**
 * Map a birth ended{ok:false} event to a FailureReason enum value.
 *
 * The birth-orchestrator's `ended` event type carries no reason field — reasons
 * live on `step` events (`{type:"step", phase:"failed", reason?}`). Callers
 * pass the most-recent step:failed reason as the second arg; if none was
 * captured, the classification collapses to "birth_failed".
 * (Code-review fixup post-Phase-99: M1.)
 *
 * `role_unknown`, `pool_exhausted`, and `matrix_creds_missing` are ALSO
 * triggered by the worker's own pre-flight (before birthIdentity is invoked)
 * and are set directly by callers of writeFailureFile — not derived from ended
 * events.
 */
export function mapEndedEventToReason(
  ended: BirthEvent & { type: "ended" },
  stepFailReason?: string,
): FailureReason {
  if (ended.ok === true) {
    throw new Error("mapEndedEventToReason called on success event");
  }

  const reason = stepFailReason ?? "";

  // SSH / network connectivity failures
  if (/timeout|unreachable|refused|econnrefused|connection/i.test(reason)) {
    return "homeserver_unreachable";
  }

  // Role folder not found on target host (Step 1 check in orchestrator — Phase 108)
  if (/role.*not found|role.*does not exist|unknown role|invalid role/i.test(reason)) {
    return "role_unknown";
  }

  // Default: generic birth failure
  return "birth_failed";
}

// ---------------------------------------------------------------------------
// getHostOwnerUserId (exported for test injection into WorkerDeps)
// ---------------------------------------------------------------------------

/**
 * Look up the owner userId of a host via a direct Drizzle query.
 * Does NOT use resolveHostById — that requires a pre-known userId for field
 * decryption; hosts.userId is a plaintext foreign key (Pitfall 3).
 */
export const getHostOwnerUserId = async (hostIdNum: number): Promise<string | null> => {
  const rows = await getDb()
    .select({ userId: hosts.userId })
    .from(hosts)
    .where(eq(hosts.id, hostIdNum))
    .limit(1);

  systemLogger.info("spawn-request worker: host-owner lookup", {
    operation: "spawn_request_host_owner_lookup",
    hostIdNum,
    found: rows.length > 0,
  });

  return rows[0]?.userId ?? null;
};

// ---------------------------------------------------------------------------
// WorkerDeps — dependency-injection interface
// ---------------------------------------------------------------------------

/**
 * All external side-effecting dependencies for processBirth.
 * Tests override every field via buildTestDeps(); production wires via buildProductionDeps().
 */
export interface WorkerDeps {
  connectOneShot: typeof connectOneShot;
  writeMarkdownFileAtomic: typeof writeMarkdownFileAtomic;
  getVettedPool: () => string[];
  getMatrixAdminCreds: typeof getMatrixAdminCreds;
  getHostOwnerUserId: (hostIdNum: number) => Promise<string | null>;
  birthIdentity: typeof birthIdentity;
  resolveHostById: typeof resolveHostById;
  now: () => Date; // injectable for test determinism
}

// ---------------------------------------------------------------------------
// buildProductionDeps
// ---------------------------------------------------------------------------

/**
 * Wire all real imports into a WorkerDeps object.
 * Called once at startup by starter.ts (Plan 99-02).
 */
export function buildProductionDeps(): WorkerDeps {
  return {
    connectOneShot,
    writeMarkdownFileAtomic,
    getVettedPool,
    getMatrixAdminCreds,
    getHostOwnerUserId,
    birthIdentity,
    resolveHostById,
    now: () => new Date(),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers: response-file writes
// ---------------------------------------------------------------------------

/**
 * Write a response file (success or failure) to the requesting host via SFTP.
 *
 * Opens a FRESH connectOneShot connection for the write — birthIdentity manages
 * its own connection internally and closes it before returning (Pattern 7).
 *
 * If the host resolution returns null, logs warn and gives up: coord's safety
 * timeout will catch the missing response (D-13 principle).
 *
 * Wraps the entire operation in try/catch — per D-15 no-retry, a failed
 * response-file write does NOT re-throw (coord timeout handles it).
 */
async function writeResponseFile(
  item: PendingBirth,
  deps: WorkerDeps,
  kind: "success" | "failure",
  body: string,
): Promise<void> {
  try {
    // LOCAL branch — hostId is in IDENTITIES_LOCAL_HOST_IDS. Skip
    // resolveHostById + connectOneShot entirely (resolveHostById fails on
    // co-located hosts anyway per the spawn_request_response_host_not_found
    // log) and write straight to the bind-mounted /fleet dir. The $HOME
    // convention here matches the REMOTE branch's SFTP $HOME resolution —
    // writeMarkdownFileAtomic's LOCAL branch substitutes os.homedir().
    if (isLocalHostId(item.hostIdNum)) {
      const targetPath = `$HOME/fleet/spawn-requests/${item.uuid}.${kind}.json`;
      await deps.writeMarkdownFileAtomic(null, targetPath, body);
      systemLogger.info("spawn-request worker: response file dropped (local)", {
        operation: "spawn_request_response_dropped",
        uuid: item.uuid,
        kind,
        branch: "local",
      });
      return;
    }

    // REMOTE branch — resolve host connection details via resolveHostById
    // (requires userId for decrypt).
    const hostDetails = await deps.resolveHostById(item.hostIdNum, item.userId);
    if (!hostDetails) {
      systemLogger.warn("spawn-request worker: host details not found for response write", {
        operation: "spawn_request_response_host_not_found",
        uuid: item.uuid,
        hostIdNum: item.hostIdNum,
      });
      return;
    }

    // Open a fresh one-shot SSH connection for the SFTP write (Pitfall 8: correct
    // response path is fleet/spawn-requests/ per D-11).
    const conn = await deps.connectOneShot(hostDetails as Parameters<typeof connectOneShot>[0], SSH_CONNECT_TIMEOUT_MS);
    try {
      // Build response path: $HOME/fleet/spawn-requests/<uuid>.{success,failure}.json
      // Literal $HOME — SFTP resolves it (same convention as other SFTP writes in this codebase).
      // Response path per D-11: same folder as request (spawn-requests/).
      const targetPath = `$HOME/fleet/spawn-requests/${item.uuid}.${kind}.json`;
      await deps.writeMarkdownFileAtomic(conn, targetPath, body);
      systemLogger.info("spawn-request worker: response file dropped", {
        operation: "spawn_request_response_dropped",
        uuid: item.uuid,
        kind,
      });
    } finally {
      conn.end();
    }
  } catch (err) {
    // Log but do NOT throw — per D-15 no-retry; coord's timeout catches loss.
    systemLogger.warn("spawn-request worker: response file write failed", {
      operation: "spawn_request_response_write_failed",
      uuid: item.uuid,
      kind,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function writeFailureFile(
  item: PendingBirth,
  deps: WorkerDeps,
  payload: FailureResponse,
): Promise<void> {
  systemLogger.warn("spawn-request worker: writing failure", {
    operation: "spawn_request_writing_failure",
    uuid: item.uuid,
    reason: payload.reason,
  });
  await writeResponseFile(item, deps, "failure", JSON.stringify(payload, null, 2));
}

// ---------------------------------------------------------------------------
// processBirth — the main birth-worker function
// ---------------------------------------------------------------------------

/**
 * Process a single PendingBirth item from the queue.
 *
 * Flow:
 *   1. Log worker start
 *   2. Pre-flight checks (pool, creds, host-owner re-verify)
 *   3. Pick pool name, assemble BirthOptions + BirthDeps
 *   4. Invoke birthIdentity via injected dep (never throws in normal operation)
 *   5. Drop success or failure response file via writeMarkdownFileAtomic
 *
 * Does NOT retry on failure (D-15). All outcomes produce a response file.
 */
export const processBirth = async (item: PendingBirth, deps: WorkerDeps): Promise<void> => {
  // Phase 110: acquire a global-birth-throttle slot. Spawn-request-origin
  // callers set bypassQueueDepth:true — disk-drop items are already
  // durable, so silently dropping them on queue overflow is worse UX than
  // piling up in memory. The throttle is orthogonal to spawn-requests/queue.ts
  // (which stays as the FIFO consumer of disk-drop files); the throttle is
  // the broader construct both entry points share.
  const release = await acquireBirthSlot({
    source: "spawn-request",
    bypassQueueDepth: true,
    requestId: item.uuid,
  });
  try {
    await doBirth(item, deps);
  } finally {
    release();
  }
};

/**
 * Inner implementation of the birth flow — all pre-flight checks,
 * birthIdentity invocation, and response-file drops. Separated from
 * processBirth so the acquire/release try/finally wrapper above can remain
 * small and readable, and to avoid a massive indentation shift across the
 * existing 250-line body.
 *
 * Called exclusively by processBirth.
 */
const doBirth = async (item: PendingBirth, deps: WorkerDeps): Promise<void> => {
  // 1. Log worker start
  systemLogger.info("spawn-request worker: processing birth", {
    operation: "spawn_request_worker_start",
    uuid: item.uuid,
    hostId: item.hostIdNum,  // LogContext.hostId is number; PendingBirth carries both string+num forms
    role: item.roles?.[0] ?? "(none)",  // D-13 bridge: log roles[0] for operator searchability
    roles_count: item.roles?.length ?? 0,
    malformed: item.malformedReason !== undefined,
  });

  // 2. Sweep-side malformed short-circuit (post-code-review M2/M3).
  //    parseSpawnRequestBatch attaches malformedReason when the request body
  //    fails validation at scan time. Skip pre-flight + birthIdentity entirely
  //    and drop a proper malformed failure file so coord sees {reason:"malformed",
  //    message:<descriptive>} instead of the request silently disappearing.
  if (item.malformedReason !== undefined) {
    await writeFailureFile(item, deps, {
      reason: "malformed",
      message: item.malformedReason,
    });
    return;
  }

  // 3. Pre-flight checks — short-circuit before touching birthIdentity
  //
  //    (a) Pool check
  const pool = deps.getVettedPool();
  if (pool.length === 0) {
    await writeFailureFile(item, deps, { reason: "pool_exhausted" });
    return;
  }

  //    (b) Matrix creds check
  const creds = await deps.getMatrixAdminCreds();
  if (!creds) {
    await writeFailureFile(item, deps, { reason: "matrix_creds_missing" });
    return;
  }

  //    (c) Re-verify host-owner userId (may be stale if host was deleted between
  //    sweep tick and queue drain). Use currentUserId, not item.userId, for the
  //    subsequent birthIdentity call.
  const currentUserId = await deps.getHostOwnerUserId(item.hostIdNum);
  if (!currentUserId) {
    await writeFailureFile(item, deps, { reason: "birth_failed" });
    return;
  }

  // 5. Assemble BirthDeps (mirror of identity-birth.ts:325-363 — identical shape)
  //
  //    getCandidateForBirth: () => null  — no avatar for worker births
  //    writeAvatarSiblingFile: no-op     — no avatar for worker births
  //    Use the worker's injectable deps for connectOneShot + writeMarkdownFileAtomic
  //    (testability) while wiring static helpers from the outer scope.
  const execLocalFn = async (command: string): Promise<string> => {
    const { stdout } = await execLocal(command);
    return typeof stdout === "string" ? stdout.trim() : String(stdout).trim();
  };

  const birthDeps: BirthDeps = {
    connectOneShot: deps.connectOneShot as typeof connectOneShot,
    execCommand,
    isLocalHostId,
    execLocal: execLocalFn,
    getCandidateForBirth: () => null,
    resolveHostById: async (hId, uid) => deps.resolveHostById(hId, uid),
    fsp: {
      readFile: (p: string, enc: "utf8") => fsp.readFile(p, enc),
      writeFile: (p: string, content: string) => fsp.writeFile(p, content),
    },
    writeMarkdownFileAtomic: async (conn, targetPath, contents) =>
      deps.writeMarkdownFileAtomic(conn, targetPath, contents),
    writeAvatarSiblingFile: async () => {},
    matrixCreateOrUpdateUser: (mxid, password, displayname) =>
      matrixCreateOrUpdateUser(mxid, password, displayname),
    matrixLoginAsUser: (mxid, validUntilMs) =>
      matrixLoginAsUser(mxid, validUntilMs),
    matrixHomeserver: creds.homeserverBase,
    matrixServerName: creds.serverName,
    // 2026-09-11: Host-reachable relay.json base — falls back to
    // homeserverBase when hostSideBase column is null (single-URL fleets).
    // Mirrors the identity-birth.ts primary deps wiring.
    relayJsonHomeserverBase: creds.hostSideBase ?? creds.homeserverBase,
    buildRelayJsonBody: (bOpts) => buildRelayJsonBody(bOpts),
    matrixCountUsersMatching: (mxid) => matrixCountUsersMatching(mxid),
    // Phase 106 (D-05/D-06): wait-for-supervisor sensor. birthIdentity polls
    // this after Step 8's relay.json write to confirm agent-supervisor.sh has
    // brought the identity alive on the target host before closing the SSE
    // stream (or the spawn-request response file, in the worker path).
    discoverIdentitySessionFile: (conn, identityName) =>
      discoverIdentitySessionFile(conn, identityName),
  };

  // 6. Pool-pick + invoke birthIdentity via injected dep, with bounded retry
  //    on the pool-name collision failure mode ("identity already exists on this
  //    host"). The vetted pool has ~222 names; a target host with ~20 identities
  //    already installed gives ~9% per-attempt collision probability. Prior
  //    behavior hard-failed on first collision, forcing the coordinator (or the
  //    dropper) to retry manually. Fix: local exclusion set of just-attempted
  //    collided names + bounded retry with a fresh random pick each iteration.
  //    Any non-collision failure surfaces as birth_failed on the FIRST attempt
  //    (no retry on unrelated errors); genuine exhaustion after 5 collided
  //    attempts surfaces as pool_exhausted.
  //
  //    Never throws in normal operation — all failures go through emit() as
  //    {type:"ended", ok:false}.
  //
  //    2026-09-18 (quick 260918-52n): folder uniqueness now comes from mxid
  //    uniqueness — deriveMxidWithOrdinal iterates ordinals against Synapse
  //    inside birthIdentity Step 1, and the identity folder path is derived
  //    from the mxid localpart. So the COLLISION_REASON "identity already
  //    exists on this host" branch below is expected to be RARE post-quick.
  //    It now only fires when an orphaned folder from a prior failed birth
  //    still occupies the derived path (e.g. Step 8 crashed after Step 2's
  //    mkdir but before the supervisor picked the folder up, and the
  //    ordinal search happened to converge on the same suffix). The retry
  //    loop is still worth keeping for that edge case — no functional
  //    change to the loop itself.
  let endedEvent: (BirthEvent & { type: "ended" }) | null = null;
  // Capture the most recent step:failed reason. Orchestrator surfaces failure
  // classifications on step events (not on ended — the ended type has no reason
  // field), so without this the {type:"ended", ok:false} we save above carries
  // no diagnostic string, and mapEndedEventToReason would collapse every
  // failure to "birth_failed" regardless of the actual cause.
  // (Code-review fixup post-Phase-99: M1 dead-code path.)
  let lastStepFailReason: string | undefined;

  const emit = (e: BirthEvent): void => {
    if (e.type === "step" && e.phase === "failed") {
      lastStepFailReason = e.reason;
    }
    if (e.type === "ended") {
      endedEvent = e;
    }
    systemLogger.info("spawn-request worker: birth event", {
      operation: "spawn_request_birth_event",
      uuid: item.uuid,
      event: e,
    });
  };

  const COLLISION_REASON = "identity already exists on this host";
  const MAX_POOL_PICK_ATTEMPTS = 5;
  const excluded = new Set<string>();
  let poolExhaustedLocally = false;
  // Hoisted so the post-loop success-file writer can reference the name of the
  // attempt that succeeded (or the name of the last attempt if we're writing
  // a failure — for logging).
  let lastPickedName: string | undefined;

  for (let attempt = 0; attempt < MAX_POOL_PICK_ATTEMPTS; attempt++) {
    const candidates = pool.filter((n) => !excluded.has(n.toLowerCase()));
    if (candidates.length === 0) {
      // Every name we've tried collided AND the pool has no other names —
      // real pool exhaustion. Different from "pool.length === 0" earlier
      // (that's a fresh pool with zero names; this is a locally-drained
      // effective pool after N collided picks).
      poolExhaustedLocally = true;
      break;
    }
    const pickedName = candidates[Math.floor(Math.random() * candidates.length)];
    lastPickedName = pickedName;
    const opts: BirthOptions = {
      userId: currentUserId,
      hostId: item.hostIdNum, // numeric — Pitfall 2: HostRecord.id is string, BirthOptions.hostId is number
      name: (lastPickedName ?? "").toLowerCase(),
      title: "",
      path: `~/${pickedName.toLowerCase()}/`,
      colorHue: null,
      voice: null,
      avatarCandidateId: "",
      role: item.roles[0], // TODO: multi-role — pass full roles[] once BirthOptions accepts it (D-13, RESEARCH Assumption A2)
      task: item.task ?? undefined,
      poolPicked: true, // worker births are always pool-picked (Pattern 6)
    };

    // Reset per-attempt capture state so the previous attempt's residue doesn't
    // leak into this attempt's classification.
    endedEvent = null;
    lastStepFailReason = undefined;

    try {
      await deps.birthIdentity(opts, emit, birthDeps);
    } catch (err) {
      // Truly unexpected — orchestrator's own catch should have emitted ended{ok:false}
      systemLogger.error("spawn-request worker: birthIdentity threw unexpectedly", {
        operation: "spawn_request_birth_unexpected_throw",
        uuid: item.uuid,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (endedEvent !== null && (endedEvent as { ok: boolean }).ok === true) {
      break; // success — exit the retry loop, drop success file below
    }
    if (lastStepFailReason === COLLISION_REASON) {
      // Collision — exclude this name locally, log the retry decision, and
      // re-pick. Bounded by MAX_POOL_PICK_ATTEMPTS.
      excluded.add(pickedName.toLowerCase());
      systemLogger.info("spawn-request worker: pool-name collision — retrying with a fresh pick", {
        operation: "spawn_request_pool_collision_retry",
        uuid: item.uuid,
        attempt: attempt + 1,
        maxAttempts: MAX_POOL_PICK_ATTEMPTS,
        excludedCount: excluded.size,
      });
      continue;
    }
    // Any other failure (or no ended event) — surface as birth_failed on this
    // attempt; do NOT retry non-collision errors.
    break;
  }

  if (poolExhaustedLocally) {
    await writeFailureFile(item, deps, { reason: "pool_exhausted" });
    return;
  }

  // 7. Post-birth response file drop
  if (endedEvent === null) {
    // Orchestrator did not emit ended — should never happen, but be defensive.
    systemLogger.warn("spawn-request worker: no ended event received from birthIdentity", {
      operation: "spawn_request_no_ended_event",
      uuid: item.uuid,
    });
    await writeFailureFile(item, deps, { reason: "birth_failed" });
    return;
  }

  if (endedEvent.ok === true) {
    // Success response carries `name` only. The mxid field was originally
    // planned as a coord-side directory-search shortcut, but the orchestrator's
    // ended event does not surface the server-derived MXID localpart (which for
    // pool-picked identities is PascalCase-hyphenated like "Willow-Coordinator-2"
    // and differs from `name`). Rebuilding it here would either be wrong (using
    // the lowercase pool key) or require a redundant deriveMxidWithOrdinal call
    // against Synapse. Dropped per code-review fixup post-Phase-99 (H1 + H2 —
    // see types.ts SuccessResponse doc for rationale). Coord uses `name` for
    // dispatch; directory-search resolves name → mxid when actually needed.
    const successPayload: SuccessResponse = {
      name: (lastPickedName ?? "").toLowerCase(),
      birthed_at: deps.now().toISOString(),
    };

    systemLogger.info("spawn-request worker: birth success, writing success file", {
      operation: "spawn_request_birth_success",
      uuid: item.uuid,
      name: (lastPickedName ?? "").toLowerCase(),
    });

    await writeResponseFile(
      item,
      deps,
      "success",
      JSON.stringify(successPayload, null, 2),
    );
  } else {
    // endedEvent.ok === false
    const reason = mapEndedEventToReason(endedEvent, lastStepFailReason);
    await writeFailureFile(item, deps, { reason });
  }
}
