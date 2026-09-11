/**
 * Phase 79 Plan 08 Task 1 — reconcile-dead-tokens.
 *
 * Periodic sweep that detects dead Matrix tokens (via `<humanName>.token-dead`
 * sentinel files the bridge writes on 401) and re-mints them via the Phase 77
 * admin `loginAsUser` primitive.
 *
 * Why sentinels not polling: per CONTEXT § 4B and RESEARCH § Q6, admin-minted
 * Synapse tokens don't TTL-expire — the only failure mode is Synapse revoking
 * a token or a bridge-side 401 for another reason. Bridge writes the sentinel
 * on 401 (Plan 05/06); Skynet reacts. No wasted /whoami polling on live
 * tokens.
 *
 * Reliability contract (from PLAN.md § threat_model + <behavior>):
 *   T-79-08-01: assertSafeHumanName runs on every sentinel filename BEFORE
 *               any fs op. A malformed name (traversal, uppercase, chars
 *               outside the guard regex) skips with a warn — never crashes.
 *   T-79-08-06: startReconcileLoop wraps every tick's promise in a .catch
 *               that logs and continues. The interval handle is .unref()'d
 *               so it never keeps a Node process alive in tests.
 *   Failure semantics: if mintAndWriteHumanToken rejects, the sentinel is
 *               LEFT IN PLACE so the next 30s tick retries. If mint succeeds,
 *               the sentinel is unlinked in the same sweep pass.
 *
 * Called from:
 *   - starter.ts (fire-and-forget) — startReconcileLoop(30_000) after the
 *     Plan 04 bridge-config-writer block, per blocker W-1 ordering.
 */
import { promises as fsp } from "node:fs";
import {
  TG_BRIDGE_STATE_DIR,
  assertSafeHumanName,
  humanTokenDeadPath,
} from "./shared-volume.js";
import { mintAndWriteHumanToken } from "./human-token-writer.js";
import { db } from "../database/db/index.js";
import { users } from "../database/db/schema.js";
import { databaseLogger } from "../utils/logger.js";

export interface ReconcileResult {
  scanned: number;
  minted: number;
  failed: number;
}

/**
 * Single-pass scan. Reads TG_BRIDGE_STATE_DIR, filters *.token-dead files,
 * validates each filename via assertSafeHumanName, resolves the human's mxid
 * from the users table, calls mintAndWriteHumanToken, and (on success)
 * unlinks the sentinel. Never throws — a bad state at any level logs a warn
 * and continues to the next entry.
 */
export async function scanAndReconcileDeadTokens(): Promise<ReconcileResult> {
  const entries = await fsp
    .readdir(TG_BRIDGE_STATE_DIR)
    .catch(() => [] as string[]); // ENOENT before bridge starts = zero sentinels

  const sentinelFiles = entries.filter((e) => e.endsWith(".token-dead"));

  const result: ReconcileResult = { scanned: 0, minted: 0, failed: 0 };
  if (sentinelFiles.length === 0) return result;

  // Build humanName → mxid map from the users table. Per blocker B-4:
  // users.username is already lowercase for Alice/Zoey — no normalization.
  let userRows: Array<{ name: string | null; mxid: string | null }> = [];
  try {
    userRows = (await db
      .select({ name: users.username, mxid: users.mxid })
      .from(users)) as Array<{ name: string | null; mxid: string | null }>;
  } catch (err) {
    databaseLogger.warn(
      "reconcile: users-table lookup failed — aborting sweep",
      {
        operation: "reconcile_dead_tokens_db_failed",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return result;
  }

  const mxidByHuman = new Map<string, string>();
  for (const row of userRows) {
    if (row.name && row.mxid) {
      mxidByHuman.set(String(row.name).toLowerCase(), row.mxid);
    }
  }

  for (const filename of sentinelFiles) {
    result.scanned += 1;
    const humanName = filename.slice(0, -".token-dead".length);

    // T-79-08-01 guard: reject malformed names BEFORE any fs / network call.
    try {
      assertSafeHumanName(humanName);
    } catch (guardErr) {
      databaseLogger.warn("reconcile: skipping malformed sentinel filename", {
        operation: "reconcile_dead_tokens_bad_name",
        filename,
        error: guardErr instanceof Error ? guardErr.message : "unknown",
      });
      continue;
    }

    const mxid = mxidByHuman.get(humanName);
    if (!mxid) {
      databaseLogger.warn("reconcile: no mxid for human", {
        operation: "reconcile_dead_tokens_no_mxid",
        humanName,
      });
      continue;
    }

    let mintResult: { ok: true } | { ok: false; error: string };
    try {
      mintResult = await mintAndWriteHumanToken(mxid, humanName);
    } catch (mintThrew) {
      // Defensive — mintAndWriteHumanToken should return a shape, not throw
      // (except on guard rejection, which we've already run). Log + count
      // as failure; leave the sentinel for the next tick.
      databaseLogger.warn("reconcile: mintAndWriteHumanToken threw", {
        operation: "reconcile_dead_tokens_mint_threw",
        humanName,
        error: mintThrew instanceof Error ? mintThrew.message : "unknown",
      });
      result.failed += 1;
      continue;
    }

    // `=== false` narrowing — strict tsc doesn't narrow discriminated unions
    // on `x.ok`-truthy branch; see commit 967ab598.
    if (mintResult.ok === false) {
      databaseLogger.warn(
        "reconcile: mint failed — leaving sentinel for next-tick retry",
        {
          operation: "reconcile_dead_tokens_mint_failed",
          humanName,
          error: mintResult.error,
        },
      );
      result.failed += 1;
    } else {
      try {
        await fsp.unlink(humanTokenDeadPath(humanName));
        result.minted += 1;
        databaseLogger.info("reconcile: minted + sentinel cleared", {
          operation: "reconcile_dead_tokens_minted",
          humanName,
        });
      } catch (unlinkErr) {
        // Mint succeeded, unlink failed — count as minted (the fresh token
        // is on disk) but log the leftover sentinel so it's visible.
        result.minted += 1;
        databaseLogger.warn(
          "reconcile: minted but sentinel unlink failed (will retry next tick)",
          {
            operation: "reconcile_dead_tokens_unlink_failed",
            humanName,
            error:
              unlinkErr instanceof Error ? unlinkErr.message : "unknown",
          },
        );
      }
    }
  }

  databaseLogger.info("reconcile: sweep complete", {
    operation: "reconcile_dead_tokens_sweep",
    scanned: result.scanned,
    minted: result.minted,
    failed: result.failed,
  });

  return result;
}

/**
 * Start the reactive-to-401 reconcile loop. Fire-and-forget from starter.ts.
 *
 * The returned NodeJS.Timeout is .unref()'d so it does not keep a Node
 * process alive in test contexts (Test 6 covers this). Callers usually
 * ignore the return value — the loop runs for the container lifetime.
 *
 * Any exception that escapes scanAndReconcileDeadTokens is logged and
 * swallowed (T-79-08-06). The interval NEVER crashes the container.
 */
export function startReconcileLoop(intervalMs: number): NodeJS.Timeout {
  const handle = setInterval(() => {
    scanAndReconcileDeadTokens().catch((err) => {
      databaseLogger.warn("scanAndReconcileDeadTokens escaped", {
        operation: "reconcile_dead_tokens_escaped",
        error: err instanceof Error ? err.message : "unknown",
      });
    });
  }, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}
