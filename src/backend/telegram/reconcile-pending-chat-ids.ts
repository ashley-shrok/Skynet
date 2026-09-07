/**
 * Phase 83 Plan 03 Task 2 — reconcile-pending-chat-ids.
 *
 * Periodic sweep that detects pending chat_ids (via `<agentName>.pending-chat-id`
 * sentinel files the bridge writes when tg_poller sees an unknown chat_id)
 * and persists them to telegram_bot_tokens.telegramChatId.
 *
 * Mirrors reconcile-dead-tokens.ts shape exactly — same scan → guard →
 * resolve → mutate → unlink flow, same .unref()'d interval, same
 * fail-open semantics (no rejection escapes to the container).
 *
 * Reliability contract (from PLAN.md § threat_model + CONTEXT § 2):
 *   T-83-03-01: assertSafeHumanName runs on every sentinel filename BEFORE
 *               any fs op. A malformed name (traversal, uppercase, chars
 *               outside the guard regex) skips with a warn — never crashes.
 *   T-83-03-02: chat_id contents validated by /^[0-9]+$/ after .trim().
 *               Negative integers (group chats) rejected per CONTEXT § 2
 *               v1 DM-only scope. Non-integer content skips with a warn.
 *   T-83-03-03: DB write is wrapped in DatabaseSaveTrigger.forceSave per
 *               the in-memory DB invariant (host-autostart-routes pattern).
 *               forceSave failure is non-fatal (data is in RAM).
 *   T-83-03-04: rewriteRegistryFromCurrentState failure leaves the sentinel
 *               in place. Next tick will re-attempt DB update (idempotent
 *               same-value UPDATE) + rewrite (CONTEXT open-questions v1).
 *
 * Called from:
 *   - starter.ts (fire-and-forget) — startReconcilePendingChatIdsLoop(30_000)
 *     alongside startReconcileLoop from Plan 79-08.
 */
import { promises as fsp } from "node:fs";
import { eq } from "drizzle-orm";
import {
  TG_BRIDGE_STATE_DIR,
  assertSafeHumanName,
  pendingChatIdPath,
} from "./shared-volume.js";
import { db } from "../database/db/index.js";
import { telegramBotTokens } from "../database/db/schema.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { rewriteRegistryFromCurrentState } from "./bridge-config-writer.js";
import { databaseLogger } from "../utils/logger.js";

export interface ReconcilePendingChatIdsResult {
  scanned: number;
  updated: number;
  failed: number;
}

/** Positive-integer regex — DM chat_ids are positive per Telegram API.
 *  Group chats have negative chat_ids; those are deferred (CONTEXT § 2). */
const POSITIVE_INT_RE = /^[0-9]+$/;

/**
 * Single-pass scan. Reads TG_BRIDGE_STATE_DIR, filters *.pending-chat-id
 * files, validates each filename via assertSafeHumanName, reads the raw
 * chat_id string, updates telegram_bot_tokens for the matching identityKey,
 * triggers DatabaseSaveTrigger.forceSave (in-memory DB invariant), calls
 * rewriteRegistryFromCurrentState, and (on success) unlinks the sentinel.
 * Never throws — a bad state at any level logs a warn and continues.
 */
export async function scanAndReconcilePendingChatIds(): Promise<ReconcilePendingChatIdsResult> {
  const entries = await fsp
    .readdir(TG_BRIDGE_STATE_DIR)
    .catch(() => [] as string[]); // ENOENT before bridge starts = zero sentinels
  const sentinelFiles = entries.filter((e) => e.endsWith(".pending-chat-id"));

  const result: ReconcilePendingChatIdsResult = {
    scanned: 0,
    updated: 0,
    failed: 0,
  };
  if (sentinelFiles.length === 0) return result;

  for (const filename of sentinelFiles) {
    result.scanned += 1;
    const agentName = filename.slice(0, -".pending-chat-id".length);

    // T-83-03-01: reject malformed names BEFORE any fs / DB op.
    try {
      assertSafeHumanName(agentName);
    } catch (guardErr) {
      databaseLogger.warn(
        "reconcile: skipping malformed pending-chat-id filename",
        {
          operation: "reconcile_pending_chat_id_bad_name",
          filename,
          error: guardErr instanceof Error ? guardErr.message : "unknown",
        },
      );
      continue;
    }

    // Read sentinel contents.
    let raw: string;
    try {
      raw = await fsp.readFile(pendingChatIdPath(agentName), "utf8");
    } catch (readErr) {
      databaseLogger.warn("reconcile: pending-chat-id read failed", {
        operation: "reconcile_pending_chat_id_read_failed",
        agentName,
        error: readErr instanceof Error ? readErr.message : "unknown",
      });
      result.failed += 1;
      continue;
    }

    const chatId = raw.trim();

    // T-83-03-02: validate chat_id shape. Positive integers only in v1
    // (Telegram DM chat_ids are positive; group chats are negative and
    // deferred per CONTEXT § 2 "only DMs so positive integers only").
    if (!POSITIVE_INT_RE.test(chatId)) {
      databaseLogger.warn(
        "reconcile: pending-chat-id bad contents — skipping",
        {
          operation: "reconcile_pending_chat_id_bad_contents",
          agentName,
          length: chatId.length,
        },
      );
      result.failed += 1;
      continue;
    }

    // Lookup existing row.
    let rows: Array<{ identityKey: string }> = [];
    try {
      rows = (await db
        .select({ identityKey: telegramBotTokens.identityKey })
        .from(telegramBotTokens)
        .where(eq(telegramBotTokens.identityKey, agentName))
        .limit(1)) as Array<{ identityKey: string }>;
    } catch (dbErr) {
      databaseLogger.warn("reconcile: pending-chat-id db lookup failed", {
        operation: "reconcile_pending_chat_id_db_failed",
        agentName,
        error: dbErr instanceof Error ? dbErr.message : "unknown",
      });
      result.failed += 1;
      continue;
    }

    if (rows.length === 0) {
      databaseLogger.warn(
        "reconcile: no telegram_bot_tokens row for pending chat_id — leaving sentinel",
        {
          operation: "reconcile_pending_chat_id_no_row",
          agentName,
        },
      );
      // NOT counted as failed — CONTEXT § 2 semantics: user may have just
      // pasted; row not yet visible; retry next tick.
      continue;
    }

    // Apply update.
    try {
      await db
        .update(telegramBotTokens)
        .set({
          telegramChatId: chatId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(telegramBotTokens.identityKey, agentName));
    } catch (updErr) {
      databaseLogger.warn(
        "reconcile: telegramChatId update failed — leaving sentinel",
        {
          operation: "reconcile_pending_chat_id_update_failed",
          agentName,
          error: updErr instanceof Error ? updErr.message : "unknown",
        },
      );
      result.failed += 1;
      continue;
    }

    // T-83-03-03: honor in-memory DB invariant. forceSave failure is non-fatal
    // (data is in RAM; CONTEXT § 2 says continue to registry rewrite + unlink).
    try {
      await DatabaseSaveTrigger.forceSave("reconcile-pending-chat-id");
    } catch (saveErr) {
      databaseLogger.warn(
        "reconcile: forceSave failed (non-fatal — data in RAM)",
        {
          operation: "reconcile_pending_chat_id_save_failed",
          agentName,
          error: saveErr instanceof Error ? saveErr.message : "unknown",
        },
      );
      // continue — CONTEXT § 2 says continue past forceSave failure.
    }

    // T-83-03-04: registry rewrite. Failure leaves sentinel for next tick;
    // next-tick UPDATE with same value is a semantic no-op, so retry is safe.
    const rewriteResult = await rewriteRegistryFromCurrentState();
    // `=== false` narrowing — strict tsc doesn't narrow discriminated unions
    // on the `x.ok`-truthy branch; see reconcile-dead-tokens.ts:131.
    if (rewriteResult.ok === false) {
      databaseLogger.warn(
        "reconcile: registry rewrite failed — leaving sentinel",
        {
          operation: "reconcile_pending_chat_id_rewrite_failed",
          agentName,
          error: rewriteResult.error,
        },
      );
      result.failed += 1;
      continue;
    }

    // Success: unlink sentinel.
    try {
      await fsp.unlink(pendingChatIdPath(agentName));
    } catch (unlinkErr) {
      databaseLogger.warn(
        "reconcile: sentinel unlink failed (will retry next tick)",
        {
          operation: "reconcile_pending_chat_id_unlink_failed",
          agentName,
          error: unlinkErr instanceof Error ? unlinkErr.message : "unknown",
        },
      );
    }

    result.updated += 1;
    databaseLogger.info(
      "reconcile: pending chat_id updated + sentinel cleared",
      {
        operation: "reconcile_pending_chat_id_updated",
        agentName,
        chatId,
      },
    );
  }

  databaseLogger.info("reconcile: pending chat_id sweep complete", {
    operation: "reconcile_pending_chat_id_sweep",
    scanned: result.scanned,
    updated: result.updated,
    failed: result.failed,
  });
  return result;
}

/**
 * Start the reactive-to-/start reconcile loop. Fire-and-forget from starter.ts.
 *
 * The returned NodeJS.Timeout is .unref()'d so it does not keep a Node
 * process alive in test contexts (RP-10 covers this). Callers usually
 * ignore the return value — the loop runs for the container lifetime.
 *
 * Any exception that escapes scanAndReconcilePendingChatIds is logged and
 * swallowed. The interval NEVER crashes the container (mirrors T-79-08-06).
 */
export function startReconcilePendingChatIdsLoop(
  intervalMs: number,
): NodeJS.Timeout {
  const handle = setInterval(() => {
    scanAndReconcilePendingChatIds().catch((err) => {
      databaseLogger.warn("scanAndReconcilePendingChatIds escaped", {
        operation: "reconcile_pending_chat_id_escaped",
        error: err instanceof Error ? err.message : "unknown",
      });
    });
  }, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}
