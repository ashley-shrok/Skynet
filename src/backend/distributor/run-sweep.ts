/**
 * run-sweep.ts — Composer for the per-host fleet-substrate sweep.
 *
 * SHAPE SOURCE OF TRUTH:
 *   .planning/phases/72-feature-02-slice-2-reconcile-loop/72-CONTEXT.md
 *   § Shape (four conceptual parts). This file IS the composer of parts
 *   (1) per-host catalog walk + (4) log-tagged trail, with the pure decision
 *   layer (Plan 03 sweep-logic.ts) and the SSH-transport helpers (Plan 04
 *   Task 1 ssh-push.ts) INJECTED. Mirrors the pure-lib + injected-transport
 *   pattern in src/backend/fleet-status/liveness-check.ts.
 *
 * FIRE-AND-FORGET CONTRACT:
 *   runSweepForHost RESOLVES even if every item fails. It NEVER rejects.
 *   The ssh-poll-orchestrator.ts hook site (Plan 04 Task 3) depends on
 *   this contract: an unhandled promise rejection would leak past the
 *   poll's error containment and degrade the 2s poll cadence. Every
 *   per-item risky call is wrapped in try/catch; the outer loop wraps a
 *   catch-all that logs and continues. There is no `throw` in this file.
 *
 * INJECTED BUNDLED-READ:
 *   deps.readBundledBytes is normally implemented as `fs.readFile + fs.stat`
 *   against the container's local /app/fleet-substrate/ path (see Plan 04
 *   Task 3's bundledReaderFromDisk inside ssh-poll-orchestrator.ts). In
 *   tests it's a stub returning `{ bytes, mode }` or `null`. This keeps
 *   unit tests off the real filesystem.
 *
 * SEQUENTIAL PER-ITEM ITERATION:
 *   The composer is a straight for-of loop (no parallel primitive). Keeping
 *   the channel unloaded — one exec at a time per host — mirrors the poll's
 *   fire-once-not-parallel discipline and avoids stacking concurrent base64
 *   reads / writes on the same underlying SSH session.
 */
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
import type { CatalogEntry } from "./catalog.js";
import { decideItemAction, computeInstallMode } from "./sweep-logic.js";
import {
  readInstalledBytes,
  writeInstalledBytesWithMode,
  restartUserUnit,
} from "./ssh-push.js";
import { logSweepResult, logItemChanged, logItemFailed } from "./log-tags.js";

/**
 * Injected dependencies for the sweep composer. `readBundledBytes` reads the
 * bundled file's bytes + mode from the container's local filesystem (or a
 * test stub); returns null on any fs failure (the decision layer treats
 * null as skip("bundled-read-failed") defensively).
 */
export interface SweepDeps {
  readBundledBytes: (
    bundledPath: string,
  ) => Promise<{ bytes: Buffer; mode: number } | null>;
  /** Injectable clock for durationMs — defaults to Date.now */
  now?: () => number;
}

/**
 * Compose one sweep-per-host: iterate the catalog sequentially, byte-compare
 * each item via the pure decision layer, push on mismatch, fire restart hook
 * where applicable, emit a per-item log line for every non-current outcome,
 * and one always-on per-sweep summary at the end.
 *
 * NEVER REJECTS. Every per-item error is caught, logged, and the loop
 * continues. If the entire loop body throws unexpectedly, the outer catch
 * still emits the summary and resolves.
 */
export async function runSweepForHost(
  channel: SshChannel,
  host: { id: string; name: string },
  catalog: readonly CatalogEntry[],
  deps: SweepDeps,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const startMs = now();
  let itemsChecked = 0;
  let itemsChanged = 0;
  let itemsFailed = 0;

  for (const entry of catalog) {
    itemsChecked++;
    try {
      // Read bundled and installed bytes for this item. ssh-push's
      // readInstalledBytes and deps.readBundledBytes both have never-throw
      // contracts, but wrap in an inner try anyway — defense-in-depth
      // against a deps.readBundledBytes stub or future edit accidentally
      // relying on a thrown error path.
      let bundledResult: { bytes: Buffer; mode: number } | null;
      let installedResult: Awaited<ReturnType<typeof readInstalledBytes>>;
      try {
        bundledResult = await deps.readBundledBytes(entry.bundledPath);
        installedResult = await readInstalledBytes(channel, entry.installPath);
      } catch (readErr) {
        // Route through the outer catch-all for a single fail-log site.
        throw readErr;
      }

      // Feed both into the pure decision layer.
      const decision = decideItemAction({
        entry,
        bundledBytes: bundledResult?.bytes ?? null,
        installedRead: installedResult,
      });

      if (decision.action === "skip") {
        if (decision.reason === "bytes-match") {
          // Common case — no log, no counter bump.
          continue;
        }
        if (decision.reason === "installed-read-failed") {
          itemsFailed++;
          const reason =
            installedResult.readOk === false ? installedResult.reason : "unknown";
          logItemFailed({
            fleetHostId: host.id,
            hostName: host.name,
            entrySlug: entry.slug,
            installPath: entry.installPath,
            stage: "read-installed",
            errorMessage: `installed-read reason=${reason}`,
          });
          continue;
        }
        if (decision.reason === "bundled-read-failed") {
          itemsFailed++;
          logItemFailed({
            fleetHostId: host.id,
            hostName: host.name,
            entrySlug: entry.slug,
            installPath: entry.installPath,
            stage: "read-bundled",
            errorMessage: "bundled fs read returned null",
          });
          continue;
        }
        continue;
      }

      // decision.action === "push"
      // Safe non-null: the decision layer only returns push when bundledBytes
      // was non-null (otherwise it returns skip("bundled-read-failed")).
      const mode = computeInstallMode(bundledResult!.mode);
      const writeResult = await writeInstalledBytesWithMode(
        channel,
        entry.installPath,
        bundledResult!.bytes,
        mode,
      );

      if (writeResult.ok === false) {
        itemsFailed++;
        logItemFailed({
          fleetHostId: host.id,
          hostName: host.name,
          entrySlug: entry.slug,
          installPath: entry.installPath,
          stage: writeResult.stage,
          errorMessage: writeResult.errorMessage,
        });
        // Do NOT fire restart on failed write.
        continue;
      }

      itemsChanged++;
      const changeKind: "installed-new" | "bytes-updated" =
        installedResult.readOk && installedResult.bytes === null
          ? "installed-new"
          : "bytes-updated";

      let restartHookFired: string | null = null;
      if (decision.restartHookToFire !== null) {
        const restartResult = await restartUserUnit(
          channel,
          decision.restartHookToFire,
        );
        // Fire the log line's restartHookFired field regardless of restart
        // outcome — the bytes DID update, so the "changed" fact is real. The
        // restart failure is a separate per-item failure counter bump below.
        restartHookFired = decision.restartHookToFire;
        if (restartResult.ok === false) {
          itemsFailed++;
          logItemFailed({
            fleetHostId: host.id,
            hostName: host.name,
            entrySlug: entry.slug,
            installPath: entry.installPath,
            stage: "restart",
            errorMessage: restartResult.errorMessage,
          });
        }
      }

      logItemChanged({
        fleetHostId: host.id,
        hostName: host.name,
        entrySlug: entry.slug,
        installPath: entry.installPath,
        changeKind,
        restartHookFired,
      });
    } catch (err) {
      // Defense-in-depth catch-all — the inner logic already wraps every
      // risky call, but this is the seatbelt for anything that slips
      // through (e.g. a throw inside deps.readBundledBytes). Never re-throw.
      itemsFailed++;
      logItemFailed({
        fleetHostId: host.id,
        hostName: host.name,
        entrySlug: entry.slug,
        installPath: entry.installPath,
        stage: "read-installed",
        errorMessage: err instanceof Error ? err.message : "unknown throw",
      });
    }
  }

  logSweepResult({
    fleetHostId: host.id,
    hostName: host.name,
    itemsChecked,
    itemsChanged,
    itemsFailed,
    durationMs: now() - startMs,
  });
}
