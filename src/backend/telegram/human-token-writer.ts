/**
 * Phase 79 Plan 04 Task 1 — human-token-writer.
 *
 * Skynet-side helper that mints a fresh Matrix access token via the
 * Phase 77 admin `loginAsUser` primitive and writes it to the shared
 * Docker volume at `/state/<humanName>.token` (mode 0600) using the
 * atomic .tmp + rename pattern so the tg-bridge (Plan 05/06) never sees
 * a partial-file read.
 *
 * Called from:
 *   - Plan 04's `bridge-config-writer.rewriteRegistryFromCurrentState`
 *     during Skynet startup + on every /telegram/activate (via Plan 03).
 *   - Plan 08's reconcile-dead-tokens loop, when it observes a
 *     `<humanName>.token-dead` sentinel and needs to mint a replacement.
 *
 * Security invariants (per PLAN.md <threat_model>):
 *   T-79-04-01: atomic write via .tmp + fs.rename (POSIX-atomic on same FS).
 *   T-79-04-02: mode 0600 at create time AND defensive chmod post-rename.
 *   T-79-04-03: never logs the accessToken value — only {operation, humanName, mxid}.
 *   T-79-04-06: humanName traversal blocked by assertSafeHumanName inside
 *               humanTokenPath (throws before any fs call).
 */
import fs from "node:fs";
import { loginAsUser } from "../matrix/matrix-admin-client.js";
import { humanTokenPath } from "./shared-volume.js";
import { databaseLogger } from "../utils/logger.js";

export async function mintAndWriteHumanToken(
  mxid: string,
  humanName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // humanTokenPath calls assertSafeHumanName internally; a bad name throws
  // BEFORE we hit the Matrix admin — we prefer that (network call skipped
  // when we know we can't safely write the result).
  const tokenPath = humanTokenPath(humanName);
  const tmp = `${tokenPath}.tmp`;

  const result = await loginAsUser(mxid);
  if (!result.ok) {
    databaseLogger.warn("mintAndWriteHumanToken: loginAsUser rejected", {
      operation: "mint_and_write_human_token_failed",
      humanName,
      mxid,
      error: result.error,
    });
    return { ok: false, error: result.error };
  }

  try {
    // writeFile with mode 0o600 at create time. Some filesystems ignore
    // the mode arg (tmpfs on some kernels) — we defensively chmod after
    // rename below.
    await fs.promises.writeFile(tmp, result.accessToken, { mode: 0o600 });
    await fs.promises.rename(tmp, tokenPath);
    await fs.promises.chmod(tokenPath, 0o600);
  } catch (err) {
    // Best-effort cleanup of a stranded .tmp; ignore ENOENT.
    await fs.promises.unlink(tmp).catch(() => {
      /* swallow — cleanup is best-effort */
    });
    databaseLogger.warn("mintAndWriteHumanToken: fs write failed", {
      operation: "mint_and_write_human_token_fs_failed",
      humanName,
      mxid,
      error: err instanceof Error ? err.message : "unknown",
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "fs_write_failed",
    };
  }

  databaseLogger.info("mintAndWriteHumanToken: token written", {
    operation: "mint_and_write_human_token",
    humanName,
    mxid,
  });
  return { ok: true };
}
