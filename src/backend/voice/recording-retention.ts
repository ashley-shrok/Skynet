// Age-based retention for the voice disk-bank (STT uploads at
// /app/stt-recordings and TTS chunks under its tts-bank/ subdirectory).
// Without it the bank grew without bound (5.5 GB / 7.6k files over two months
// on a typical box). Files older than STT_RECORDINGS_MAX_AGE_DAYS (default 14) are
// deleted; a sweep runs at most once per PRUNE_INTERVAL_MS per directory,
// triggered by the next bank write, so an idle box costs nothing.
import fs from "node:fs";
import path from "node:path";
import { databaseLogger } from "../utils/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export function recordingsMaxAgeMs(): number {
  const days = Number(process.env.STT_RECORDINGS_MAX_AGE_DAYS ?? 14);
  return Number.isFinite(days) && days > 0 ? days * DAY_MS : 14 * DAY_MS;
}

// Deletes regular files older than maxAgeMs in dir and its immediate
// subdirectories (tts-bank/). Returns the number of files removed.
export async function pruneOldRecordings(dir: string, maxAgeMs: number, now = Date.now()): Promise<number> {
  const cutoff = now - maxAgeMs;
  let removed = 0;
  const sweep = async (d: string, depth: number): Promise<void> => {
    const entries = await fs.promises.readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (depth === 0) await sweep(p, 1);
        continue;
      }
      if (!e.isFile()) continue;
      const st = await fs.promises.stat(p).catch(() => null);
      if (st && st.mtimeMs < cutoff) {
        await fs.promises.unlink(p).then(() => { removed++; }, () => {});
      }
    }
  };
  await sweep(dir, 0);
  return removed;
}

const lastPruneAt = new Map<string, number>();

// Fire-and-forget, throttled. Safe to call after every bank write.
export function maybePruneRecordings(dir: string, now = Date.now()): void {
  if (now - (lastPruneAt.get(dir) ?? 0) < PRUNE_INTERVAL_MS) return;
  lastPruneAt.set(dir, now);
  const maxAgeMs = recordingsMaxAgeMs();
  void pruneOldRecordings(dir, maxAgeMs, now).then(
    (removed) => {
      databaseLogger.info(`[voice-server] recordings-prune dir=${dir} removed=${removed} maxAgeDays=${maxAgeMs / DAY_MS}`, {
        operation: "voice_recordings_prune",
        dir,
        removed,
      });
    },
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      databaseLogger.warn(`[voice-server] recordings-prune-failed dir=${dir} error=${message}`, {
        operation: "voice_recordings_prune_failed",
        dir,
        error: message,
      });
    },
  );
}

export function resetRecordingsPruneThrottleForTests(): void {
  lastPruneAt.clear();
}
