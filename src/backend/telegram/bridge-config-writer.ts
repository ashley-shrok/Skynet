// Phase 79 Plan 04 — bridge-config-writer
/**
 * Phase 79 Plan 04 Task 2 — bridge-config-writer.
 *
 * Orchestrates the substrate-side writes that make the tg-bridge Docker
 * service functional:
 *   1. `/state/config.env` — MATRIX_ROOT + STT_URL (bash-source-safe),
 *      read by the bridge at startup so nothing is hardcoded.
 *   2. `/state/<identityKey>.bottoken` — one per row, plaintext bot token,
 *      0600. Nina's live convention, preserved verbatim in Phase B per
 *      blocker B-1.
 *   3. `/state/<humanName>.token` — one per registered human (minted via
 *      matrix-admin loginAsUser). Kills the old `<human>.cred` pattern.
 *   4. `/state/registry.json` — Nina-shape (no bot_token, no cred).
 *
 * THREE exports:
 *   - writeBridgeConfigEnv() — atomic write of config.env only.
 *   - rewriteRegistryFromCurrentState() — steps 2-4. RE-CALLABLE from
 *     HTTP handlers (Plan 03's /telegram/activate and /disconnect wire
 *     through this — blocker B-2 fix). NEVER throws — always returns
 *     shape-clean result so callers can act on it without try/catch.
 *   - ensureBridgeConfigWritten() — startup one-shot. Fire-and-forget from
 *     starter.ts. Non-fatal on failure; bridge tolerates a 5-min cold-start
 *     delay per RESEARCH § A9 and Plan 08's reconcile is the safety net.
 *
 * Do NOT re-throw anywhere in the public entry points. starter.ts fires
 * ensureBridgeConfigWritten without awaiting; Plan 03's HTTP handlers
 * check the returned shape and log-warn on failure. Neither wants an
 * exception.
 */
import fs from "node:fs";
import {
  STT_URL,
  getMatrixHomeserverBase,
} from "../config/media-endpoints.js";
import { configEnvPath } from "./shared-volume.js";
import { listTelegramBotTokens } from "./tokens-store.js";
import { syncAllBotTokenFiles } from "./bot-token-file-writer.js";
import { mintAndWriteHumanToken } from "./human-token-writer.js";
import {
  buildRegistryFromRows,
  writeRegistry,
} from "./registry-writer.js";
import { db } from "../database/db/index.js";
import { users } from "../database/db/schema.js";
import { databaseLogger } from "../utils/logger.js";

export async function writeBridgeConfigEnv(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const homeserverBase = await getMatrixHomeserverBase();
  if (homeserverBase === null) {
    databaseLogger.warn(
      "bridge config not written — no admin creds ingested yet",
      { operation: "bridge_config_write_skipped" },
    );
    return { ok: false, reason: "no matrix admin creds ingested" };
  }

  // Bash-source safety: refuse anything that could break the shell parse
  // or embed a comment marker. STT_URL is a compile-time constant so this
  // check is defensive only; homeserverBase comes from user-ingested
  // creds and is the realistic attack surface.
  if (
    homeserverBase.includes("#") ||
    homeserverBase.includes("\n") ||
    STT_URL.includes("#") ||
    STT_URL.includes("\n")
  ) {
    databaseLogger.error(
      "bridge config refused — URL contains unsafe chars",
      undefined,
      {
        operation: "bridge_config_write_unsafe",
      },
    );
    return { ok: false, reason: "unsafe chars in URL" };
  }

  const body =
    `# Written by Skynet at boot — Phase 79 Plan 04. Do not edit by hand.\n` +
    `MATRIX_ROOT=${homeserverBase}\n` +
    `STT_URL=${STT_URL}\n`;

  const target = configEnvPath();
  const tmp = `${target}.tmp`;
  try {
    await fs.promises.writeFile(tmp, body, { mode: 0o644 });
    await fs.promises.rename(tmp, target);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {
      /* swallow cleanup */
    });
    databaseLogger.warn("bridge config write failed", {
      operation: "bridge_config_write_failed",
      error: err instanceof Error ? err.message : "unknown",
    });
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "fs write failed",
    };
  }

  databaseLogger.info("bridge config written", {
    operation: "bridge_config_write",
    target,
  });
  return { ok: true };
}

/**
 * Re-callable helper Plan 03's activate + disconnect routes wire through
 * (blocker B-2). Wraps the whole pipeline in try/catch and NEVER throws —
 * always returns `{ok:true, agentCount, humanCount}` or `{ok:false, error}`.
 */
export async function rewriteRegistryFromCurrentState(): Promise<
  | { ok: true; agentCount: number; humanCount: number }
  | { ok: false; error: string }
> {
  try {
    // Step 1: pull all telegram_bot_tokens rows (decrypts eagerly).
    const rows = await listTelegramBotTokens();

    // Step 2: resolve the homeserver hostname for building agent mxids.
    const homeserverBase = await getMatrixHomeserverBase();
    let homeserverHostname: string | null = null;
    if (homeserverBase !== null) {
      try {
        homeserverHostname = new URL(homeserverBase).hostname;
      } catch (err) {
        databaseLogger.warn(
          "rewriteRegistryFromCurrentState: could not parse homeserverBase URL",
          {
            operation: "bridge_registry_url_parse_failed",
            homeserverBase,
            error: err instanceof Error ? err.message : "unknown",
          },
        );
      }
    }

    // Step 3: build the humans map from the users table. Per revision
    // blocker B-4: users.username is already lowercase for prod (ashley,
    // zoey). A defensive .toLowerCase() would be harmless but is not
    // required.
    const userRows = (await db
      .select({
        id: users.id,
        username: users.username,
        mxid: users.mxid,
      })
      .from(users)) as Array<{
      id: string;
      username: string;
      mxid: string | null;
    }>;

    const humansByUserId = new Map<
      string,
      { name: string; mxid: string }
    >();
    for (const row of userRows) {
      if (row.mxid && typeof row.mxid === "string") {
        humansByUserId.set(row.id, {
          name: row.username,
          mxid: row.mxid,
        });
      }
    }

    // Step 4: build the agents map from row identityKeys.
    const agentsByIdentityKey = new Map<
      string,
      { name: string; mxid: string }
    >();
    for (const row of rows) {
      if (agentsByIdentityKey.has(row.identityKey)) continue;
      if (!homeserverHostname) {
        // Without a hostname we can't safely build an mxid — skip this
        // agent from the registry rather than emit a malformed value.
        continue;
      }
      agentsByIdentityKey.set(row.identityKey, {
        name: row.identityKey,
        mxid: `@${row.identityKey}:${homeserverHostname}`,
      });
    }

    // Step 5: sync per-agent .bottoken files (blocker B-1). Never throws
    // per its own contract.
    const syncResult = await syncAllBotTokenFiles();
    databaseLogger.info(
      "rewriteRegistryFromCurrentState: bot-token files synced",
      {
        operation: "bridge_bottoken_sync",
        written: syncResult.written,
        failed: syncResult.failed,
      },
    );

    // Step 6: mint fresh Matrix tokens for every human referenced by a row.
    // Best-effort — individual failures logged; loop continues.
    const humansSeen = new Set<string>();
    for (const row of rows) {
      const human = humansByUserId.get(row.humanUserId);
      if (!human) continue;
      if (humansSeen.has(human.mxid)) continue; // dedupe when multiple agents share a human
      humansSeen.add(human.mxid);
      try {
        const mintResult = await mintAndWriteHumanToken(
          human.mxid,
          human.name,
        );
        if (!mintResult.ok) {
          databaseLogger.warn(
            "rewriteRegistryFromCurrentState: mint failed for human",
            {
              operation: "bridge_mint_human_token_failed",
              humanName: human.name,
              mxid: human.mxid,
              error: mintResult.error,
            },
          );
        }
      } catch (err) {
        // Defensive — mintAndWriteHumanToken shouldn't throw except on
        // guard-rejected humanName, but paranoia is cheap here.
        databaseLogger.warn(
          "rewriteRegistryFromCurrentState: mint threw",
          {
            operation: "bridge_mint_human_token_threw",
            humanName: human.name,
            error: err instanceof Error ? err.message : "unknown",
          },
        );
      }
    }

    // Step 7: build + write registry.json.
    const registry = buildRegistryFromRows(
      rows,
      humansByUserId,
      agentsByIdentityKey,
    );
    await writeRegistry(registry);

    databaseLogger.info(
      "rewriteRegistryFromCurrentState: registry written",
      {
        operation: "bridge_registry_write",
        agentCount: agentsByIdentityKey.size,
        humanCount: humansByUserId.size,
      },
    );

    return {
      ok: true,
      agentCount: agentsByIdentityKey.size,
      humanCount: humansByUserId.size,
    };
  } catch (err) {
    // Absolute barrier — this function MUST NOT throw.
    const message = err instanceof Error ? err.message : "unknown error";
    databaseLogger.warn(
      "rewriteRegistryFromCurrentState: pipeline failed",
      {
        operation: "bridge_registry_rewrite_failed",
        error: message,
      },
    );
    return { ok: false, error: message };
  }
}

/**
 * Startup one-shot. Called fire-and-forget from starter.ts after DB init.
 * Wraps everything in try/catch; NEVER re-throws.
 */
export async function ensureBridgeConfigWritten(): Promise<void> {
  try {
    const configResult = await writeBridgeConfigEnv();
    if (!configResult.ok) {
      databaseLogger.warn(
        "ensureBridgeConfigWritten: config write failed — skipping registry rewrite (bridge will retry for 5 min per RESEARCH A9)",
        {
          operation: "bridge_config_write_skipped",
          reason: configResult.reason,
        },
      );
      return;
    }

    const rewriteResult = await rewriteRegistryFromCurrentState();
    if (!rewriteResult.ok) {
      databaseLogger.warn(
        "ensureBridgeConfigWritten: registry rewrite failed at startup",
        {
          operation: "bridge_registry_rewrite_startup_failed",
          error: rewriteResult.error,
        },
      );
    } else {
      databaseLogger.info(
        "ensureBridgeConfigWritten: startup complete",
        {
          operation: "bridge_config_startup_ok",
          agentCount: rewriteResult.agentCount,
          humanCount: rewriteResult.humanCount,
        },
      );
    }
  } catch (err) {
    databaseLogger.warn(
      "ensureBridgeConfigWritten: unhandled error at startup",
      {
        operation: "bridge_config_startup_error",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
  }
}
