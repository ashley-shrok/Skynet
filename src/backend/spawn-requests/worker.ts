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
import { resolveHostById } from "../ssh/host-resolver.js";
import { birthIdentity, ROLE_NAME_PATTERN, SSH_CONNECT_TIMEOUT_MS, type BirthEvent, type BirthDeps, type BirthOptions } from "../database/routes/identity-birth-orchestrator.js";
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

  // Role folder not found on target host (Step 2.5 check in orchestrator)
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
    // Resolve host connection details via resolveHostById (requires userId for decrypt)
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
  // 1. Log worker start
  systemLogger.info("spawn-request worker: processing birth", {
    operation: "spawn_request_worker_start",
    uuid: item.uuid,
    hostId: item.hostIdNum,  // LogContext.hostId is number; PendingBirth carries both string+num forms
    role: item.role,
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

  // 3. Pool-pick: random selection from vetted pool
  const pickedName = pool[Math.floor(Math.random() * pool.length)];

  // 4. Assemble BirthOptions (RESEARCH Pattern 6)
  const opts: BirthOptions = {
    userId: currentUserId,
    hostId: item.hostIdNum, // numeric — Pitfall 2: HostRecord.id is string, BirthOptions.hostId is number
    name: pickedName.toLowerCase(),
    title: "",
    path: `~/${pickedName.toLowerCase()}/`,
    colorHue: null,
    voice: null,
    avatarCandidateId: "",
    role: item.role,
    task: item.task ?? undefined,
    poolPicked: true, // worker births are always pool-picked (Pattern 6)
  };

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
    buildRelayJsonBody: (bOpts) => buildRelayJsonBody(bOpts),
    matrixCountUsersMatching: (mxid) => matrixCountUsersMatching(mxid),
  };

  // 6. Invoke birthIdentity via injected dep (never throws in normal operation —
  //    all failures go through emit() as {type:"ended", ok:false}).
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
      name: pickedName.toLowerCase(),
      birthed_at: deps.now().toISOString(),
    };

    systemLogger.info("spawn-request worker: birth success, writing success file", {
      operation: "spawn_request_birth_success",
      uuid: item.uuid,
      name: pickedName.toLowerCase(),
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
