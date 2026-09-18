/**
 * image-gen-requests/worker.ts
 *
 * Async worker for the image-gen queue. Consumes a PendingImageGen, performs
 * the 7-step main flow (Phase 116 D-20, D-21, D-22, D-08, D-09), and drops
 * response files (SFTP-atomic JSON + PNGs) back at the origin host.
 *
 * Order of operations inside processImageGen (per Plan 116-03 Task 2):
 *   1. Log start.
 *   2. If item.malformedReason !== undefined → drop failure.json
 *      {reason:"malformed", message: item.malformedReason} and return. NO
 *      adapter call, NO token acquire.
 *   3. If deps.now() > Date.parse(item.body.requested_at) + 5*60*1000 → drop
 *      failure.json {reason:"expired"} and return. NO adapter call, NO
 *      token acquire (Pitfall 5).
 *   4. await deps.tokenBucket.acquire() (D-21).
 *   5. const result = await deps.callOpenAiImageGen(item.body, item.refImage)
 *      — adapter never throws in normal operation.
 *   6. On result.ok=true: write PNGs FIRST (deps.writeBinaryFileAtomic per
 *      buffer), then success.json LAST (deps.writeMarkdownFileAtomic). The
 *      commit-order-equals-observe-order invariant matches Pitfall 3 for the
 *      response side — caller polls for .success.json as the completion
 *      signal, so a partial-PNG state must never be visible with the JSON
 *      already present.
 *   7. On result.ok=false: drop failure.json {reason, message?}.
 *
 * Never re-throws from top-level processImageGen — the queue's drain-error
 * containment catches any straggler, but the worker itself owns the response-
 * write try/catch so a failed SFTP write is logged (not re-thrown) per
 * D-23/D-24 no-retry.
 */

import { systemLogger } from "../utils/logger.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";
import { execCommand } from "../ssh/tmux-helper.js";
import {
  isLocalHostId,
  writeMarkdownFileAtomic,
  writeBinaryFileAtomic,
} from "../claude-session/identity-artifact-reader.js";
import { resolveHostById } from "../ssh/host-resolver.js";
import { SSH_CONNECT_TIMEOUT_MS } from "../database/routes/identity-birth-orchestrator.js";
import { getDb } from "../database/db/index.js";
import { hosts } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import type { Client as SSHClientType } from "ssh2";
import { callOpenAiImageGen } from "./adapter.js";
import type { TokenBucket } from "./token-bucket.js";
import type {
  PendingImageGen,
  SuccessResponse,
  FailureResponse,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** D-22 TTL — 5 minutes from requested_at. */
export const IMAGE_GEN_TTL_MS = 5 * 60 * 1000;

/** D-26 model — locked, appears in the success JSON's `model` field. */
export const IMAGE_GEN_MODEL = "gpt-image-1";

/** Default success size echoed back when body.size unspecified (matches
 *  OpenAI's own default and identity-avatar-batch's request shape). */
const DEFAULT_SUCCESS_SIZE = "1024x1024";

/** Response-file directory (D-04 — same folder as the request). */
const IMAGE_GEN_DIR = "$HOME/fleet/image-gen-requests";

// ---------------------------------------------------------------------------
// getHostOwnerUserId (exported for test injection into WorkerDeps)
// ---------------------------------------------------------------------------

/**
 * Look up the owner userId of a host via a direct Drizzle query.
 * Does NOT use resolveHostById — that requires a pre-known userId for field
 * decryption; hosts.userId is a plaintext foreign key (Pitfall 3).
 *
 * Mirrors the canonical shape from spawn-requests/worker.ts:113-127 — the
 * scan-orchestrator populates `item.userId = ""` (see parse-request-body.ts),
 * so the worker MUST re-resolve the owner at process-time before calling
 * resolveHostById (which needs a real userId for field decryption). Without
 * this, resolveHostById returns null and the response file is silently dropped
 * (bug surfaced during Phase 116 E2E verification).
 */
export const getHostOwnerUserId = async (hostIdNum: number): Promise<string | null> => {
  const rows = await getDb()
    .select({ userId: hosts.userId })
    .from(hosts)
    .where(eq(hosts.id, hostIdNum))
    .limit(1);

  systemLogger.info("image-gen worker: host-owner lookup", {
    operation: "image_gen_host_owner_lookup",
    hostIdNum,
    found: rows.length > 0,
  });

  return rows[0]?.userId ?? null;
};

// ---------------------------------------------------------------------------
// WorkerDeps — dependency-injection interface (stable from Task 1)
// ---------------------------------------------------------------------------

/**
 * All external side-effecting dependencies for processImageGen.
 * Tests override every field via a buildTestDeps() factory; production wires
 * via buildProductionDeps() below.
 *
 * Fields:
 *   - connectOneShot / execCommand — SSH primitives for the REMOTE
 *     response-file drop path.
 *   - writeMarkdownFileAtomic — atomic tmp+rename for the success/failure JSON.
 *   - writeBinaryFileAtomic — atomic tmp+rename for the success PNGs (exported
 *     by identity-artifact-reader.ts as part of Task 1).
 *   - isLocalHostId — LOCAL-vs-REMOTE routing per item.hostIdNum.
 *   - resolveHostById — REMOTE branch host-details lookup.
 *   - getHostOwnerUserId — REMOTE branch host-owner userId lookup at
 *     process-time. Required because scan-orchestrator populates
 *     item.userId = "" (Pitfall 3, mirrors spawn-requests's pattern).
 *   - callOpenAiImageGen — the adapter from Plan 01. Never throws in
 *     normal operation (returns AdapterResult discriminated union).
 *   - tokenBucket — the boot-time-singleton token bucket (D-21). The worker
 *     awaits acquire() before every adapter call.
 *   - now — injectable clock (ms since epoch) for test determinism of the
 *     D-22 TTL check.
 */
export interface WorkerDeps {
  connectOneShot: typeof connectOneShot;
  execCommand: typeof execCommand;
  writeMarkdownFileAtomic: typeof writeMarkdownFileAtomic;
  writeBinaryFileAtomic: typeof writeBinaryFileAtomic;
  isLocalHostId: typeof isLocalHostId;
  resolveHostById: typeof resolveHostById;
  getHostOwnerUserId: (hostIdNum: number) => Promise<string | null>;
  callOpenAiImageGen: typeof callOpenAiImageGen;
  tokenBucket: TokenBucket;
  now: () => number;
}

// ---------------------------------------------------------------------------
// buildProductionDeps — wire real imports into WorkerDeps
// ---------------------------------------------------------------------------

/**
 * Wire all real imports into a WorkerDeps object. The `tokenBucket` argument
 * is the boot-time SINGLETON created in starter.ts — every worker loop
 * shares this single bucket so the RPM cap applies fleet-wide (not per-loop).
 */
export function buildProductionDeps(tokenBucket: TokenBucket): WorkerDeps {
  return {
    connectOneShot,
    execCommand,
    writeMarkdownFileAtomic,
    writeBinaryFileAtomic,
    isLocalHostId,
    resolveHostById,
    getHostOwnerUserId,
    callOpenAiImageGen,
    tokenBucket,
    now: () => Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Response-file drop helpers
// ---------------------------------------------------------------------------

/**
 * Failure-file drop. Wraps writeMarkdownFileAtomic with LOCAL/REMOTE branch
 * routing + top-level try/catch (a failed write is logged, NOT thrown —
 * caller timeout absorbs the loss per D-16 + D-23/D-24 no-retry).
 */
async function writeFailureFile(
  item: PendingImageGen,
  deps: WorkerDeps,
  payload: FailureResponse,
): Promise<void> {
  systemLogger.warn("image-gen worker: writing failure", {
    operation: "image_gen_writing_failure",
    uuid: item.uuid,
    reason: payload.reason,
  });
  const targetPath = `${IMAGE_GEN_DIR}/${item.uuid}.failure.json`;
  const body = JSON.stringify(payload, null, 2);
  try {
    if (deps.isLocalHostId(item.hostIdNum)) {
      await deps.writeMarkdownFileAtomic(null, targetPath, body);
      systemLogger.info("image-gen worker: response file dropped (local)", {
        operation: "image_gen_response_dropped",
        uuid: item.uuid,
        kind: "failure",
        branch: "local",
        reason: payload.reason,
      });
      return;
    }

    // Re-resolve host-owner userId at process-time. item.userId is "" for
    // scan-orch items (see parse-request-body.ts) — resolveHostById needs a
    // real userId for field decryption, so we look it up via a direct
    // plaintext-FK query on hosts.userId (Pitfall 3, mirrors spawn-requests).
    const ownerUserId = await deps.getHostOwnerUserId(item.hostIdNum);
    if (!ownerUserId) {
      systemLogger.warn("image-gen worker: host-owner userId not found for failure write", {
        operation: "image_gen_response_host_owner_not_found",
        uuid: item.uuid,
        hostIdNum: item.hostIdNum,
      });
      return;
    }
    const hostDetails = await deps.resolveHostById(item.hostIdNum, ownerUserId);
    if (!hostDetails) {
      systemLogger.warn("image-gen worker: host details not found for failure write", {
        operation: "image_gen_response_host_not_found",
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
      systemLogger.info("image-gen worker: response file dropped", {
        operation: "image_gen_response_dropped",
        uuid: item.uuid,
        kind: "failure",
        reason: payload.reason,
      });
    } finally {
      conn.end();
    }
  } catch (err) {
    // Log but do NOT throw — per D-23/D-24 no-retry; caller timeout catches loss.
    systemLogger.warn("image-gen worker: response file write failed", {
      operation: "image_gen_response_write_failed",
      uuid: item.uuid,
      kind: "failure",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Success-file drop — writes N PNGs (binary, atomic) FIRST, then the
 * success.json LAST. Single SSH connection on the REMOTE branch (opened
 * once, reused for all writes, closed in finally) so we don't pay N+1
 * connection RTTs.
 *
 * The success JSON's `images` array carries the exact filenames written —
 * if writing partway through fails, the JSON drop is skipped by the outer
 * catch (which will surface the drop as a warn-log) so the caller sees a
 * timeout rather than a half-written success. The atomic invariant of the
 * .success.json write is the source of truth for the caller's success poll.
 */
async function writeSuccessResponse(
  item: PendingImageGen,
  deps: WorkerDeps,
  images: Buffer[],
  generation_time_ms: number,
): Promise<void> {
  const filenames: string[] = [];
  const successPayload: SuccessResponse = {
    // Populated after we know which PNGs actually landed.
    images: filenames,
    size: item.body.size ?? DEFAULT_SUCCESS_SIZE,
    model: IMAGE_GEN_MODEL,
    n: images.length,
    generation_time_ms,
  };

  try {
    if (deps.isLocalHostId(item.hostIdNum)) {
      // LOCAL branch — no SSH conn needed, conn=null routes to fs on the
      // fleet bind-mount. Write each PNG, then the JSON.
      for (let i = 0; i < images.length; i++) {
        const pngName = `${item.uuid}.success.${i}.png`;
        const pngPath = `${IMAGE_GEN_DIR}/${pngName}`;
        await deps.writeBinaryFileAtomic(null, pngPath, images[i]);
        filenames.push(pngName);
      }
      const jsonPath = `${IMAGE_GEN_DIR}/${item.uuid}.success.json`;
      await deps.writeMarkdownFileAtomic(null, jsonPath, JSON.stringify(successPayload, null, 2));
      systemLogger.info("image-gen worker: response file dropped (local)", {
        operation: "image_gen_response_dropped",
        uuid: item.uuid,
        kind: "success",
        branch: "local",
        n: images.length,
      });
      return;
    }

    // REMOTE branch — single SSH connection covers all N PNGs + 1 JSON.
    // Re-resolve host-owner userId at process-time. item.userId is "" for
    // scan-orch items (see parse-request-body.ts) — resolveHostById needs a
    // real userId for field decryption, so we look it up via a direct
    // plaintext-FK query on hosts.userId (Pitfall 3, mirrors spawn-requests).
    const ownerUserId = await deps.getHostOwnerUserId(item.hostIdNum);
    if (!ownerUserId) {
      systemLogger.warn("image-gen worker: host-owner userId not found for success write", {
        operation: "image_gen_response_host_owner_not_found",
        uuid: item.uuid,
        hostIdNum: item.hostIdNum,
      });
      return;
    }
    const hostDetails = await deps.resolveHostById(item.hostIdNum, ownerUserId);
    if (!hostDetails) {
      systemLogger.warn("image-gen worker: host details not found for success write", {
        operation: "image_gen_response_host_not_found",
        uuid: item.uuid,
        hostIdNum: item.hostIdNum,
      });
      return;
    }
    const conn: SSHClientType = await deps.connectOneShot(
      hostDetails as Parameters<typeof deps.connectOneShot>[0],
      SSH_CONNECT_TIMEOUT_MS,
    );
    try {
      for (let i = 0; i < images.length; i++) {
        const pngName = `${item.uuid}.success.${i}.png`;
        const pngPath = `${IMAGE_GEN_DIR}/${pngName}`;
        await deps.writeBinaryFileAtomic(conn, pngPath, images[i]);
        filenames.push(pngName);
      }
      const jsonPath = `${IMAGE_GEN_DIR}/${item.uuid}.success.json`;
      await deps.writeMarkdownFileAtomic(conn, jsonPath, JSON.stringify(successPayload, null, 2));
      systemLogger.info("image-gen worker: response file dropped", {
        operation: "image_gen_response_dropped",
        uuid: item.uuid,
        kind: "success",
        n: images.length,
      });
    } finally {
      conn.end();
    }
  } catch (err) {
    // Log but do NOT throw — per D-23/D-24 no-retry; caller timeout catches loss.
    systemLogger.warn("image-gen worker: response file write failed", {
      operation: "image_gen_response_write_failed",
      uuid: item.uuid,
      kind: "success",
      writtenPngs: filenames.length,
      totalPngs: images.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// processImageGen — the main worker function
// ---------------------------------------------------------------------------

/**
 * Process a single PendingImageGen item from the queue. Never throws in
 * normal operation — every branch resolves via a response-file drop
 * (success.json + PNGs or failure.json).
 */
export async function processImageGen(
  item: PendingImageGen,
  deps: WorkerDeps,
): Promise<void> {
  systemLogger.info("image-gen worker: processing", {
    operation: "image_gen_worker_start",
    uuid: item.uuid,
    hostId: item.hostIdNum,
    hasRef: item.refImage !== undefined,
    malformed: item.malformedReason !== undefined,
  });

  // Step 2 — malformed short-circuit (sweep marked item as malformed at scan
  // time; skip adapter + token entirely and drop a proper failure file so
  // the caller sees a descriptive `malformed` reason instead of a silent
  // timeout).
  if (item.malformedReason !== undefined) {
    await writeFailureFile(item, deps, {
      reason: "malformed",
      message: item.malformedReason,
    });
    return;
  }

  // Step 3 — TTL check at dequeue (Pitfall 5). Compare deps.now() vs the
  // caller's requested_at + 5 min. If expired, drop failure file, do NOT
  // acquire a token, do NOT call OpenAI. Prevents billing for requests the
  // caller has already timed out on (D-22 matches D-16 helper timeout).
  const requestedAtMs = Date.parse(item.body.requested_at);
  const expiresAtMs = requestedAtMs + IMAGE_GEN_TTL_MS;
  if (deps.now() > expiresAtMs) {
    systemLogger.info("image-gen worker: TTL expired at dequeue", {
      operation: "image_gen_ttl_expired",
      uuid: item.uuid,
      requestedAt: item.body.requested_at,
      ageMs: deps.now() - requestedAtMs,
    });
    await writeFailureFile(item, deps, { reason: "expired" });
    return;
  }

  // Step 4 — acquire a token from the bucket (D-21). Blocks if the bucket
  // is empty. Sits BEFORE the adapter call so the throttle applies to
  // outbound requests, not to arrivals.
  await deps.tokenBucket.acquire();

  // Step 5 — call the adapter. Never throws in normal operation; returns
  // AdapterResult discriminated union.
  systemLogger.info("image-gen worker: openai call start", {
    operation: "image_gen_openai_call_start_worker",
    uuid: item.uuid,
  });
  const result = await deps.callOpenAiImageGen(item.body, item.refImage);
  systemLogger.info("image-gen worker: openai call done", {
    operation: "image_gen_openai_call_done_worker",
    uuid: item.uuid,
    ok: result.ok,
  });

  // Step 6/7 — drop response file. Explicit `=== true` narrowing per the
  // same tsc 6.0.3 discriminated-union quirk observed in Plan 01
  // (identity-birth-orchestrator.ts mintResult/loginResult pattern) — the
  // union's `ok:false` branch is not narrowed by `!result.ok` under strict
  // tsc build settings, but IS narrowed by an explicit `=== true` guard.
  if (result.ok === true) {
    await writeSuccessResponse(item, deps, result.images, result.generation_time_ms);
  } else {
    await writeFailureFile(item, deps, {
      reason: result.reason,
      ...(result.message !== undefined ? { message: result.message } : {}),
    });
  }
}

/**
 * Public façade over the internal writeFailureFile. Exposed so callers
 * outside the worker's own processImageGen path (e.g. queue.ts's
 * overflow-drop protection) can drop a proper failure file for a rejected
 * item — otherwise the caller would see a silent timeout instead of a
 * descriptive `{reason:"unknown", message:"queue full — try again later"}`
 * failure. Never throws (inner writeFailureFile owns the try/catch).
 */
export async function writeImageGenFailureFile(
  item: PendingImageGen,
  deps: WorkerDeps,
  payload: FailureResponse,
): Promise<void> {
  await writeFailureFile(item, deps, payload);
}
