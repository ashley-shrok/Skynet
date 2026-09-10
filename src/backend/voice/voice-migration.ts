/**
 * Phase 98 Plan 05 — voice-value migration (startup one-shot, idempotent).
 *
 * Purpose
 * -------
 * Locks D-Per-identity-voice-binding's hard-reset from 98-CONTEXT.md:
 *   "Every existing identity's voice frontmatter value clears at ship time.
 *    Identities re-pick from the Polly catalog next time an owner opens
 *    them."
 *
 * Runs as a startup one-shot per D-Claude's-discretion (locked
 * 2026-09-10): "Migration trigger: startup one-shot idempotent." The
 * ensureVoiceValuesMigrated function is fired from starter.ts fire-and-
 * forget, sibling to the existing ensureBridgeConfigWritten block. On
 * every subsequent boot the migration finds nothing to change (idempotent
 * guard against POLLY_VOICE_IDS) and returns in <50ms.
 *
 * What we walk
 * ------------
 * BOTH `~/.claude/identities/<key>/<key>.md` AND `~/.claude/roles/<name>/
 * <name>.md`. Phase 86 moved cosmetics (voice, title, hue, avatar) to
 * role frontmatter with per-identity override — the hard reset MUST wipe
 * both stores or half the fleet's voice bindings survive the migration
 * and Plan 07's tightened whitelist validator then rejects them at first
 * edit. Roots come from `getLocalIdentitiesRoot()` and
 * `getLocalRolesRoot()` in `identity-artifact-reader.ts` — those helpers
 * honor the env-var overrides (IDENTITIES_HOST_DIR / ROLES_HOST_DIR) that
 * make the docker bind-mount work.
 *
 * What we clear
 * -------------
 * Only frontmatter `voice:` values matching the old Chatterbox regex
 * `/^[A-Z][A-Za-z]+\.wav$/`. Values that are already a valid Polly voice
 * ID (contained in POLLY_VOICE_IDS from `polly-voice-catalog.ts`) are
 * left untouched — this is the idempotency guard. Values that are
 * neither old-regex nor Polly IDs are also left untouched — we do not
 * clobber unrelated arbitrary content that happens to live in a voice:
 * field for some reason.
 *
 * Quote-strip (LOAD-BEARING)
 * --------------------------
 * The line `.replace(/^["']|["']$/g, "")` MUST appear verbatim in the
 * value-extraction step. A file with `voice: "Elena.wav"` (YAML-quoted
 * string) will not match OLD_VOICE_RE if quotes remain in the compared
 * value — the migration would silently no-op on that file, then Plan
 * 07's tightened validator would reject it on next edit. Per plan-review
 * lock: the quote-strip is NOT optional and is NOT to be pulled out into
 * a helper — inline in the function body so grep can verify it.
 *
 * Contract
 * --------
 * NEVER throws. The entry point wraps everything in try/catch and logs
 * warn on any unhandled error. Mirrors `ensureBridgeConfigWritten`
 * (bridge-config-writer.ts:354) — starter.ts fires this fire-and-forget
 * and a thrown exception would crash the process bootstrap.
 *
 * Atomicity
 * ---------
 * Each per-file write uses tmp+rename (`.tmp` suffix, write, rename).
 * Mirror of `writeIdentityFile` LOCAL branch in
 * identity-artifact-reader.ts:2609-2616. Partial-write crash mid-file
 * leaves the original untouched (rename is atomic on POSIX).
 */

import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";

import { POLLY_VOICE_IDS } from "./polly-voice-catalog.js";
import {
  getLocalIdentitiesRoot,
  getLocalRolesRoot,
} from "../claude-session/identity-artifact-reader.js";
import { databaseLogger } from "../utils/logger.js";

/**
 * Old Chatterbox voice-file naming regex. Matches `Elena.wav`, `Danielle.wav`,
 * `Alice.wav`, etc. Only values matching this exact shape are wiped.
 */
const OLD_VOICE_RE = /^[A-Z][A-Za-z]+\.wav$/;

/**
 * Per-file migration. Reads frontmatter, extracts voice: value (with the
 * LOAD-BEARING quote-strip), decides whether to skip or wipe.
 *
 * Returns `{changed: true}` if the file was rewritten; `{changed: false}`
 * if the file was left as-is (already conforms, no voice line, or value
 * is arbitrary and out-of-scope for the hard reset).
 *
 * Internal helper — may throw on fs errors. The public
 * ensureVoiceValuesMigrated wrapper catches everything.
 */
async function migrateFrontmatterFile(
  filePath: string,
): Promise<{ changed: boolean }> {
  const content = await fs.readFile(filePath, "utf8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { changed: false };
  const fmText = fmMatch[1];
  const voiceMatch = fmText.match(/^voice:\s*(.+)$/m);
  if (!voiceMatch) return { changed: false };

  // LOAD-BEARING quote-strip. YAML frontmatter allows either bare
  // (`voice: Elena.wav`) or quoted (`voice: "Elena.wav"` /
  // `voice: 'Elena.wav'`) values. Without this line, quoted values are
  // silently mis-classified and skipped — then Plan 07's tightened
  // whitelist validator rejects them on the first identity edit.
  const currentVoice = voiceMatch[1].trim().replace(/^["']|["']$/g, "");

  // Idempotency guard — already conforms to the new whitelist.
  if (POLLY_VOICE_IDS.has(currentVoice)) return { changed: false };
  // Out-of-scope value — do not clobber unrelated content.
  if (!OLD_VOICE_RE.test(currentVoice)) return { changed: false };

  // Wipe the entire `voice:` line from the frontmatter, then splice the
  // rewritten frontmatter block back into the file. Atomic tmp+rename
  // write mirrors identity-artifact-reader.ts::writeIdentityFile LOCAL
  // branch.
  const newFm = fmText.replace(/^voice:\s*.+\n?/m, "");
  const newContent = content.replace(fmMatch[0], `---\n${newFm}\n---`);
  const tmpPath = filePath + ".tmp";
  await fs.writeFile(tmpPath, newContent, "utf8");
  await fs.rename(tmpPath, filePath);
  return { changed: true };
}

/**
 * Walks one root (identities or roles), invoking migrateFrontmatterFile
 * on each `<subdir>/<subdir>.md` file found. Returns aggregate counts.
 *
 * If `root` does not exist (fresh install, no bind-mount, etc.) returns
 * `{scanned: 0, changed: 0}` — never throws for missing-root.
 *
 * Per-file errors are caught and logged as a debug-info; the walk
 * continues to the next file so one bad file does not abort the whole
 * migration.
 */
async function walkAndMigrate(
  root: string,
): Promise<{ scanned: number; changed: number }> {
  let scanned = 0;
  let changed = 0;
  const entries: Dirent[] = await fs
    .readdir(root, { withFileTypes: true })
    .catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subdir = path.join(root, entry.name);
    const mdPath = path.join(subdir, `${entry.name}.md`);
    const st = await fs.stat(mdPath).catch(() => null);
    if (!st) continue;
    scanned++;
    try {
      const { changed: didChange } = await migrateFrontmatterFile(mdPath);
      if (didChange) changed++;
    } catch (err) {
      // Log-and-continue — a single-file failure does not fail the walk.
      databaseLogger.warn("voice_migration: per-file write failed", {
        operation: "voice_migration_file_error",
        file: mdPath,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  return { scanned, changed };
}

/**
 * Startup one-shot. Called fire-and-forget from starter.ts after DB init.
 * Walks both roots, logs a single summary line, and NEVER re-throws.
 *
 * Public entry point — the try/catch here is the load-bearing barrier
 * that keeps starter.ts's fire-and-forget import from crashing on any
 * unhandled fs / logger / import error.
 */
export async function ensureVoiceValuesMigrated(): Promise<void> {
  try {
    const identitiesRoot = getLocalIdentitiesRoot();
    const rolesRoot = getLocalRolesRoot();
    const identitiesResult = await walkAndMigrate(identitiesRoot);
    const rolesResult = await walkAndMigrate(rolesRoot);
    databaseLogger.info("ensureVoiceValuesMigrated: complete", {
      operation: "voice_migration_complete",
      identitiesScanned: identitiesResult.scanned,
      identitiesChanged: identitiesResult.changed,
      rolesScanned: rolesResult.scanned,
      rolesChanged: rolesResult.changed,
    });
  } catch (err) {
    databaseLogger.warn(
      "ensureVoiceValuesMigrated: unhandled error at startup",
      {
        operation: "voice_migration_startup_error",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
  }
}
