/**
 * bundled-reader.ts — Pure fs adapter for SweepDeps.readBundledBytes.
 *
 * Never throws — returns null on any fs failure.
 *
 * Extracted from ssh-poll-orchestrator.ts in Phase 75-01 so both the legacy
 * sweep hook (removed in 75-07) and the new server-substrate-orchestrator
 * (75-02) can share one reader implementation.
 */
import { readFile, stat } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Phase 72 Plan 04 — pure adapter for bundled-file reads (fs → SweepDeps).
//
// Reads the bundled file from the container's /app/fleet-substrate/
// filesystem. Injected into runSweepForHost via SweepDeps.readBundledBytes
// so the sweep composer stays testable without touching disk. Never
// throws — returns null on any fs failure; sweep-logic.ts's decideItemAction
// treats null as skip("bundled-read-failed").
// ---------------------------------------------------------------------------
export const bundledReaderFromDisk = async (
  bundledPath: string,
): Promise<{ bytes: Buffer; mode: number } | null> => {
  try {
    const [bytes, statResult] = await Promise.all([
      readFile(bundledPath),
      stat(bundledPath),
    ]);
    return { bytes, mode: statResult.mode };
  } catch {
    return null;
  }
};
