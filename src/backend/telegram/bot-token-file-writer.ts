/**
 * Phase 79 Plan 04 Task 1 — bot-token-file-writer (blocker B-1).
 *
 * Writes per-agent `<identityKey>.bottoken` files (0600, plaintext bot
 * token) to the shared Docker volume at `/state/`. The tg-bridge (Plan 05)
 * reads these files to authenticate to Telegram as each bot — this is
 * Nina's live convention preserved verbatim in Phase B so the bridge
 * source stays bash-minimal AND `registry.json` can stay untouched by
 * encrypted secrets (see PATTERNS.md § Pitfall 7 + blocker B-1).
 *
 * Consumers:
 *   - ensureBridgeConfigWritten() (Task 2) — via syncAllBotTokenFiles on startup.
 *   - /telegram/activate handler (Plan 03) — via writeBotTokenFile per activate.
 *   - /telegram/disconnect handler (Plan 03) — via deleteBotTokenFile per disconnect.
 *
 * Security invariants (per PLAN.md <threat_model>):
 *   T-79-04-01: atomic .tmp + rename (POSIX-atomic on same FS).
 *   T-79-04-06: identityKey traversal blocked by assertSafeHumanName inside
 *               botTokenFilePath.
 *   T-79-04-07: mode 0600 at create + defensive chmod post-rename.
 *   T-79-04-03: NEVER log the plaintext botToken value.
 */
import fs from "node:fs";
import { botTokenFilePath } from "./shared-volume.js";
import { listTelegramBotTokens } from "./tokens-store.js";
import { databaseLogger } from "../utils/logger.js";

export async function writeBotTokenFile(
  identityKey: string,
  botToken: string,
): Promise<void> {
  // botTokenFilePath calls assertSafeHumanName — throws BEFORE any fs op
  // on malformed identityKey.
  const filePath = botTokenFilePath(identityKey);
  const tmp = `${filePath}.tmp`;

  try {
    await fs.promises.writeFile(tmp, botToken, { mode: 0o600 });
    await fs.promises.rename(tmp, filePath);
    await fs.promises.chmod(filePath, 0o600);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {
      /* swallow — cleanup is best-effort */
    });
    throw err;
  }

  databaseLogger.info("writeBotTokenFile: file written", {
    operation: "bot_token_file_write",
    identityKey,
  });
}

export async function deleteBotTokenFile(
  identityKey: string,
): Promise<void> {
  const filePath = botTokenFilePath(identityKey);

  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    // ENOENT is the intended silent no-op path per PLAN.md § Task 1 behavior.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      databaseLogger.info(
        "deleteBotTokenFile: file was already absent (idempotent)",
        {
          operation: "bot_token_file_delete_absent",
          identityKey,
        },
      );
      return;
    }
    throw err;
  }

  databaseLogger.info("deleteBotTokenFile: file unlinked", {
    operation: "bot_token_file_delete",
    identityKey,
  });
}

/**
 * Walk every row in tokens-store and write one .bottoken file per row.
 * Called by ensureBridgeConfigWritten (Task 2) at Skynet startup so
 * every bot the DB knows about has an on-disk file for the bridge's
 * tg_poller to read.
 *
 * Idempotent (overwrites every file every call — cheap). Tolerates
 * per-row failure without throwing so one bad slug can't block startup.
 */
export async function syncAllBotTokenFiles(): Promise<{
  written: number;
  failed: number;
}> {
  const rows = await listTelegramBotTokens();
  let written = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await writeBotTokenFile(row.identityKey, row.botToken);
      written += 1;
    } catch (err) {
      failed += 1;
      databaseLogger.warn("syncAllBotTokenFiles: single-row write failed", {
        operation: "bot_token_file_write_failed",
        identityKey: row.identityKey,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return { written, failed };
}
