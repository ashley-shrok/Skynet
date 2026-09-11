/**
 * identity-send-log-store.ts — single seam for reads + writes of the
 * `identity_send_log` SQLite table introduced by Phase 85-01.
 *
 * ## Phase 85 (D-01, D-02, D-05)
 *
 * This module owns ALL access to the identity_send_log table. Downstream
 * consumers in Phase 85 (Plan 03 HTTP route, Plan 04 orchestrator swap,
 * Plan 05 sessions.ts swap) route through these two exports so the
 * save-flush + monotonic-write invariants live in exactly one place.
 *
 * ### Invariant 1: every successful write triggers a persistence flush
 *
 * Skynet decrypts its SQLite database into RAM at startup and only flushes
 * back to the on-disk encrypted copy when the save-trigger fires. Without
 * that call, a write persists to RAM but is lost on non-graceful shutdown
 * (docker recreate, kernel OOM, host reboot). Pattern mirrors
 * host-autostart-routes.ts:173-181 (trigger call site) and the tail of
 * migrateSchema() in db/index.ts (schema-migration flush shape).
 *
 * The flush call is wrapped in try/catch and logs on failure without
 * propagating (per D-05 "attempts count" spirit — a downstream flush
 * failure should not fail the caller's send funnel).
 *
 * ### Invariant 2: writes are monotonic (older ts never overwrites newer)
 *
 * If `stampIdentityLastSend(name, ts)` is called with a `ts` that is <=
 * the row's current `lastSendAt`, the write is a no-op. Mirrors the
 * client-side `advanceSessionLastMessageAt` (session-working-store.ts:758)
 * max-wins reconciliation and closes the class of bug where a late-arriving
 * older stamp regresses the recency signal. No flush on the skip path —
 * nothing was written, nothing needs flushing.
 *
 * ### D-05 attempts-count semantics
 *
 * The store operation succeeds regardless of downstream WS delivery. Even
 * if the send later fails at the transport layer, Alice's INTENT to talk
 * to the identity IS the recency signal. This module has no delivery
 * awareness — it only records the stamp.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../database/db/index.js";
import { identitySendLog } from "../database/db/schema.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { databaseLogger } from "../utils/logger.js";

const FORCE_SAVE_REASON = "phase-85-stamp-identity-send";

// T-85-02-02 mitigation: reject unreasonably long identity names.
// Legitimate tmux session names / identity names are short (typically < 32
// chars). 256 is a generous ceiling that still bounds the primary-key
// column size against a malicious caller.
const MAX_IDENTITY_NAME_LEN = 256;

/**
 * Record that Alice just sent a message from the compose surface to the
 * given identity. Monotonic (never regresses); triggers a DB force-save
 * after every successful write.
 *
 * Fail-open on invalid input (log warn, return without throwing) — the
 * caller is the compose-send funnel and must never break because of a
 * store-side validation nit. Same posture for a persistence-flush failure.
 */
export async function stampIdentityLastSend(
  identityName: string,
  ts: number,
): Promise<void> {
  // ---- Input validation (T-85-02-02 mitigation) ---------------------------
  if (typeof identityName !== "string" || identityName.length === 0) {
    databaseLogger.warn(
      "identity_send_log stamp skipped — invalid identity name",
      {
        operation: "identity_send_log_stamp_invalid_name",
        identityName,
        ts,
      },
    );
    return;
  }

  if (identityName.length > MAX_IDENTITY_NAME_LEN) {
    databaseLogger.warn(
      "identity_send_log stamp skipped — identity name exceeds length ceiling",
      {
        operation: "identity_send_log_stamp_name_too_long",
        identityNameLength: identityName.length,
        max: MAX_IDENTITY_NAME_LEN,
      },
    );
    return;
  }

  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) {
    databaseLogger.warn(
      "identity_send_log stamp skipped — invalid timestamp",
      {
        operation: "identity_send_log_stamp_invalid_ts",
        identityName,
        ts,
      },
    );
    return;
  }

  // ---- Monotonic guard ---------------------------------------------------
  let previousTs: number | null = null;
  try {
    const rows = await db
      .select({ lastSendAt: identitySendLog.lastSendAt })
      .from(identitySendLog)
      .where(eq(identitySendLog.identityName, identityName))
      .limit(1);

    if (rows.length > 0) {
      previousTs = rows[0].lastSendAt;
      if (previousTs >= ts) {
        databaseLogger.info(
          "identity_send_log stamp skipped — monotonic (incoming <= current)",
          {
            operation: "identity_send_log_stamp_skip_monotonic",
            identityName,
            ts,
            currentTs: previousTs,
          },
        );
        return;
      }
    }
  } catch (err) {
    // If the read fails we still attempt the write — the upsert will
    // either succeed (new row wins) or the ON CONFLICT branch fires. This
    // fail-open posture matches D-05.
    databaseLogger.warn(
      "identity_send_log monotonic-read failed; proceeding with upsert",
      {
        operation: "identity_send_log_stamp_read_error",
        identityName,
        ts,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
  }

  // ---- Upsert (drizzle onConflictDoUpdate) --------------------------------
  await db
    .insert(identitySendLog)
    .values({
      identityName,
      lastSendAt: ts,
    })
    .onConflictDoUpdate({
      target: identitySendLog.identityName,
      set: {
        lastSendAt: ts,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    });

  databaseLogger.info("identity_send_log stamp written", {
    operation: "identity_send_log_stamp",
    identityName,
    ts,
    previousTs,
  });

  // ---- Persistence flush (Skynet in-memory DB invariant) -----------------
  try {
    await DatabaseSaveTrigger.forceSave(FORCE_SAVE_REASON);
  } catch (err) {
    databaseLogger.warn(
      "identity_send_log persistence flush failed — write persisted to RAM only",
      {
        operation: "identity_send_log_stamp_force_save_failed",
        identityName,
        ts,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
  }
}

/**
 * Read the recorded unix-millis timestamp of Alice's last send to the
 * given identity. Returns `null` if no row exists (identity has never
 * received a stamp) — matches D-09's first-ship "no backfill, natural
 * fill" contract: consumers see `null` and fall through to their own
 * fallback ordering.
 *
 * Fail-open on drizzle throw: a query error looks identical to a missing
 * row from the middle-zone comparator's perspective. Log warn, return
 * null, never throw.
 */
export async function getIdentityLastSend(
  identityName: string,
): Promise<number | null> {
  if (typeof identityName !== "string" || identityName.length === 0) {
    return null;
  }

  try {
    const rows = await db
      .select({ lastSendAt: identitySendLog.lastSendAt })
      .from(identitySendLog)
      .where(eq(identitySendLog.identityName, identityName))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const ts = rows[0].lastSendAt;
    databaseLogger.debug("identity_send_log read hit", {
      operation: "identity_send_log_get_hit",
      identityName,
      ts,
    });
    return ts;
  } catch (err) {
    databaseLogger.warn(
      "identity_send_log read failed — treating as miss",
      {
        operation: "identity_send_log_get_error",
        identityName,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return null;
  }
}
