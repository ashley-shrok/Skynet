/**
 * phone-call-requests/worker.ts
 *
 * Async worker for the phone-call queue. Consumes a PendingPhoneCall,
 * performs the main flow, and drops a single response file
 * (`<uuid>.response.json`) back at the origin host.
 *
 * Order of operations inside processPhoneCall:
 *   1. Log start.
 *   2. If item.malformedReason !== undefined → drop response with
 *      {outcome: "malformed", message}. NO DB lookup, NO adapter call.
 *   3. TTL check at dequeue (Pitfall 5 mirror). If now > requested_at +
 *      TTL, drop response with {outcome: "timeout", ...} — the caller's
 *      helper has already given up. NO adapter call.
 *   4. Resolve the target Skynet user by username. If not found → drop
 *      response with {outcome: "unknown_user", message: <username>}.
 *   5. If user has no phoneE164 → drop {outcome: "no_phone_on_file"}.
 *   6. Build Bland task prompt + first-sentence with caller_name
 *      interpolation.
 *   7. Call adapter (never throws in normal operation). Returns
 *      AdapterResult discriminated union.
 *   8. Drop response file with adapter result verbatim.
 *
 * Never re-throws from top-level processPhoneCall — the queue's drain-error
 * containment catches any straggler, but the worker itself owns the
 * response-write try/catch so a failed SSH write is logged (not re-thrown).
 */

import { systemLogger } from "../utils/logger.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { execCommand } from "../ssh/tmux-helper.js";
import {
  isLocalHostId,
  writeMarkdownFileAtomic,
} from "../claude-session/identity-artifact-reader.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import { SSH_CONNECT_TIMEOUT_MS } from "../database/routes/identity-birth-orchestrator.js";
import { getDb } from "../database/db/index.js";
import { hosts, users } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import { placeCallAndAwait } from "./adapter.js";
import { buildBlandTaskPrompt, buildBlandFirstSentence } from "./prompt-template.js";
import type {
  PendingPhoneCall,
  PhoneCallResponse,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * TTL from requested_at at which the worker drops a `timeout` response
 * without calling Bland. Set to 14 minutes = the agent-side helper's own
 * poll deadline plus a small margin — no point ringing the phone if the
 * agent has already given up watching for the response file.
 */
export const PHONE_CALL_TTL_MS = 14 * 60 * 1000;

/** Response-file directory (same folder as the request drop). */
const PHONE_CALL_DIR = "$HOME/fleet/phone-call-requests";

// ---------------------------------------------------------------------------
// DB lookup helpers (exported for test injection into WorkerDeps)
// ---------------------------------------------------------------------------

/**
 * Look up the owner userId of a host — mirrors image-gen worker's
 * getHostOwnerUserId. The scan-orchestrator populates item.userId = ""
 * (mirroring image-gen's Pitfall 3), so the worker re-resolves at process
 * time before calling resolveHostById.
 */
export const getHostOwnerUserId = async (hostIdNum: number): Promise<string | null> => {
  const rows = await getDb()
    .select({ userId: hosts.userId })
    .from(hosts)
    .where(eq(hosts.id, hostIdNum))
    .limit(1);
  return rows[0]?.userId ?? null;
};

/**
 * Look up a Skynet user by username. Returns null if no user with that
 * username exists, or the row's { id, phoneE164 } otherwise.
 */
export const getUserByUsername = async (
  username: string,
): Promise<{ id: string; phoneE164: string | null } | null> => {
  const rows = await getDb()
    .select({ id: users.id, phoneE164: users.phoneE164 })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, phoneE164: row.phoneE164 ?? null };
};

// ---------------------------------------------------------------------------
// WorkerDeps — dependency-injection interface
// ---------------------------------------------------------------------------

export interface WorkerDeps {
  connectOneShot: typeof connectOneShot;
  execCommand: typeof execCommand;
  writeMarkdownFileAtomic: typeof writeMarkdownFileAtomic;
  isLocalHostId: typeof isLocalHostId;
  resolveHostById: typeof resolveHostById;
  getHostOwnerUserId: (hostIdNum: number) => Promise<string | null>;
  getUserByUsername: (
    username: string,
  ) => Promise<{ id: string; phoneE164: string | null } | null>;
  placeCallAndAwait: typeof placeCallAndAwait;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/**
 * Wire real imports into WorkerDeps for production. Tests build their own.
 */
export function buildProductionDeps(): WorkerDeps {
  return {
    connectOneShot,
    execCommand,
    writeMarkdownFileAtomic,
    isLocalHostId,
    resolveHostById,
    getHostOwnerUserId,
    getUserByUsername,
    placeCallAndAwait,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

// ---------------------------------------------------------------------------
// Response-file drop
// ---------------------------------------------------------------------------

/**
 * Drop the single response file — same primitive on both success and
 * failure outcomes. Never throws (logged, not re-thrown, per no-retry
 * philosophy: the caller helper's own poll deadline catches loss).
 */
async function writeResponseFile(
  item: PendingPhoneCall,
  deps: WorkerDeps,
  payload: PhoneCallResponse,
): Promise<void> {
  const targetPath = `${PHONE_CALL_DIR}/${item.uuid}.response.json`;
  const body = JSON.stringify(payload, null, 2);
  systemLogger.info("phone worker: writing response", {
    operation: "phone_writing_response",
    uuid: item.uuid,
    outcome: payload.outcome,
    hasTranscript: payload.transcript !== undefined,
  });

  try {
    if (deps.isLocalHostId(item.hostIdNum)) {
      await deps.writeMarkdownFileAtomic(null, targetPath, body);
      systemLogger.info("phone worker: response file dropped (local)", {
        operation: "phone_response_dropped",
        uuid: item.uuid,
        outcome: payload.outcome,
        branch: "local",
      });
      return;
    }

    const ownerUserId = await deps.getHostOwnerUserId(item.hostIdNum);
    if (!ownerUserId) {
      systemLogger.warn("phone worker: host-owner userId not found for response write", {
        operation: "phone_response_host_owner_not_found",
        uuid: item.uuid,
        hostIdNum: item.hostIdNum,
      });
      return;
    }
    const hostDetails = await deps.resolveHostById(item.hostIdNum, ownerUserId);
    if (!hostDetails) {
      systemLogger.warn("phone worker: host details not found for response write", {
        operation: "phone_response_host_not_found",
        uuid: item.uuid,
        hostIdNum: item.hostIdNum,
      });
      return;
    }
    const conn = await deps.connectOneShot(
      hostDetails as Parameters<typeof deps.connectOneShot>[0],
      SSH_CONNECT_TIMEOUT_MS,
    );
    try {
      await deps.writeMarkdownFileAtomic(conn, targetPath, body);
      systemLogger.info("phone worker: response file dropped", {
        operation: "phone_response_dropped",
        uuid: item.uuid,
        outcome: payload.outcome,
      });
    } finally {
      conn.end();
    }
  } catch (err) {
    systemLogger.warn("phone worker: response file write failed", {
      operation: "phone_response_write_failed",
      uuid: item.uuid,
      outcome: payload.outcome,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Public façade so queue.ts can drop a failure response for items rejected
 * at the enqueue boundary (queue full, injection missing) without depending
 * on the worker's private writeResponseFile.
 */
export async function writePhoneCallResponseFile(
  item: PendingPhoneCall,
  deps: WorkerDeps,
  payload: PhoneCallResponse,
): Promise<void> {
  await writeResponseFile(item, deps, payload);
}

// ---------------------------------------------------------------------------
// processPhoneCall — main worker function
// ---------------------------------------------------------------------------

export async function processPhoneCall(
  item: PendingPhoneCall,
  deps: WorkerDeps,
): Promise<void> {
  systemLogger.info("phone worker: processing", {
    operation: "phone_worker_start",
    uuid: item.uuid,
    hostId: item.hostIdNum,
    toUser: item.body.to_user,
    callerName: item.body.caller_name,
    malformed: item.malformedReason !== undefined,
  });

  // Step 2 — malformed short-circuit.
  if (item.malformedReason !== undefined) {
    await writeResponseFile(item, deps, {
      outcome: "malformed",
      message: item.malformedReason,
    });
    return;
  }

  // Step 3 — TTL check at dequeue.
  const requestedAtMs = Date.parse(item.body.requested_at);
  const expiresAtMs = requestedAtMs + PHONE_CALL_TTL_MS;
  if (deps.now() > expiresAtMs) {
    systemLogger.info("phone worker: TTL expired at dequeue", {
      operation: "phone_ttl_expired",
      uuid: item.uuid,
      requestedAt: item.body.requested_at,
      ageMs: deps.now() - requestedAtMs,
    });
    await writeResponseFile(item, deps, {
      outcome: "timeout",
      message: "request expired before dequeue (helper already gave up)",
    });
    return;
  }

  // Step 4 — resolve target user.
  const target = await deps.getUserByUsername(item.body.to_user);
  if (!target) {
    systemLogger.info("phone worker: unknown target user", {
      operation: "phone_unknown_user",
      uuid: item.uuid,
      toUser: item.body.to_user,
    });
    await writeResponseFile(item, deps, {
      outcome: "unknown_user",
      message: `no Skynet user named "${item.body.to_user}"`,
    });
    return;
  }

  // Step 5 — check phone-on-file.
  if (target.phoneE164 === null || target.phoneE164.length === 0) {
    systemLogger.info("phone worker: no phone number on file", {
      operation: "phone_no_phone_on_file",
      uuid: item.uuid,
      toUser: item.body.to_user,
    });
    await writeResponseFile(item, deps, {
      outcome: "no_phone_on_file",
      message: `user "${item.body.to_user}" has no phone number set`,
    });
    return;
  }

  // Step 6 — build Bland prompt with caller_name interpolation.
  const taskPrompt = buildBlandTaskPrompt(item.body.caller_name, item.body.message);
  const firstSentence = buildBlandFirstSentence(item.body.caller_name, item.body.message);

  // Step 7 — call adapter. Never throws in normal operation.
  systemLogger.info("phone worker: placement + poll start", {
    operation: "phone_place_start",
    uuid: item.uuid,
    toUser: item.body.to_user,
  });
  const result = await deps.placeCallAndAwait(
    target.phoneE164,
    taskPrompt,
    firstSentence,
    item.body.message,
    {
      now: deps.now,
      sleep: deps.sleep,
    },
  );
  systemLogger.info("phone worker: placement + poll done", {
    operation: "phone_place_done",
    uuid: item.uuid,
    outcome: result.outcome,
    hasTranscript: result.transcript !== undefined,
    callLengthSeconds: result.call_length_seconds,
  });

  // Step 8 — drop response file with adapter result verbatim.
  const response: PhoneCallResponse = { outcome: result.outcome };
  if (result.transcript !== undefined) response.transcript = result.transcript;
  if (result.message !== undefined) response.message = result.message;
  if (result.call_length_seconds !== undefined)
    response.call_length_seconds = result.call_length_seconds;
  await writeResponseFile(item, deps, response);
}
