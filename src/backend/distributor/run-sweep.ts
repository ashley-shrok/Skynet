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
 *   against the container's local /app/fleet-substrate/ path (see Phase 75-01's
 *   bundledReaderFromDisk in distributor/bundled-reader.ts). In tests it's a
 *   stub returning `{ bytes, mode }` or `null`. This keeps unit tests off the
 *   real filesystem.
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
  removeInstalledFile,
} from "./ssh-push.js";
import { logSweepResult, logItemChanged, logItemFailed } from "./log-tags.js";
import { runBootstrapForHost } from "./run-bootstrap.js";
import { sshLogger } from "../utils/logger.js";

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
  /**
   * Phase 114 Plan 05 (D-15 + Pitfall 6): pre-resolved runtime bytes for
   * `sourceKind: "runtime"` catalog entries. The orchestrator resolves this
   * map ONCE per sweep tick (both startup pass and the 30s retry tick), then
   * fans the same map to every runSweepForHost invocation in that tick — so
   * `readInstancePolicyBytes()` fires once per tick regardless of host count.
   *
   * The composer looks up bytes via `deps.resolvedRuntimeBytes?.get(entry.resolverKey)`:
   *   - Buffer value → use bytes as the bundled source (mode 0o644 per D-18)
   *   - null value   → row applicable but source is null → trigger removal push
   *                    (D-16) via removeInstalledFile on root-SSH hosts
   *   - undefined map / absent key → treated as null (removal path)
   *
   * Optional: tests that don't exercise runtime rows can omit this. Under the
   * default undefined, every runtime row's lookup returns null, which routes
   * to the removal branch — safe on user-home-only test catalogs.
   */
  resolvedRuntimeBytes?: Map<string, Buffer | null>;
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
// Bounded retry for SSH-transport-only failures (channel died mid-exec, not
// a real remote-side error). Retries up to `maxTries` with `backoffMs` between
// attempts. Non-transient results (structural failures, success) return
// immediately without further attempts. See § substrate-sweep-no-retry bounty.
async function retryOnTransport<T>(
  fn: () => Promise<T>,
  isTransient: (result: T) => boolean,
  maxTries: number = 3,
  backoffMs: number = 200,
): Promise<T> {
  let last: T = await fn();
  for (let i = 1; i < maxTries; i++) {
    if (!isTransient(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    last = await fn();
  }
  return last;
}

export async function runSweepForHost(
  channel: SshChannel,
  host: { id: string; name: string; username: string },
  catalog: readonly CatalogEntry[],
  deps: SweepDeps,
): Promise<{ itemsChecked: number; itemsChanged: number; itemsFailed: number }> {
  const now = deps.now ?? Date.now;
  const startMs = now();
  let itemsChecked = 0;
  let itemsChanged = 0;
  let itemsFailed = 0;

  // Pre-sweep bootstrap: idempotent systemd enable + daemon-reload +
  // settings.json patch. Runs BEFORE the catalog loop so that:
  //   (a) On a fresh host, the .service unit is enabled before the catalog
  //       loop's restart hook fires agent-supervisor.service.
  //   (b) daemon-reload runs before any restart hook in the catalog loop,
  //       so systemd sees updated unit-file bytes pushed earlier this sweep.
  // runBootstrapForHost is fire-and-forget per its never-throw contract;
  // any failure is logged there — we do not propagate errors upward.
  await runBootstrapForHost(channel, host);

  for (const entry of catalog) {
    itemsChecked++;

    // Phase 115 (D-13 retired): NO pre-emptive gate on host.username. The
    // DB's username string is a display label, not a capability boundary —
    // every SSH-key holder on our fleet has NOPASSWD sudo, so `ubuntu` is
    // effectively root. The push command chain uses `sudo -n` for
    // installMode:"system-root" rows (ssh-push.ts), which is transparent when
    // the SSH user is already root, elevates on NOPASSWD, and fails-loud on
    // password-only sudo or no-sudo — real errors surface via logItemFailed,
    // no strings hardcoded here.
    const installMode = entry.installMode ?? "user-home";

    try {
      // Read bundled and installed bytes for this item. ssh-push's
      // readInstalledBytes and deps.readBundledBytes both have never-throw
      // contracts, but wrap in an inner try anyway — defense-in-depth
      // against a deps.readBundledBytes stub or future edit accidentally
      // relying on a thrown error path.
      let bundledResult: { bytes: Buffer; mode: number } | null;
      let installedResult: Awaited<ReturnType<typeof readInstalledBytes>>;
      try {
        // Phase 114 Plan 05 (D-12 + D-15): source resolution branch on
        // sourceKind. Runtime rows pull bytes from the pre-resolved
        // per-tick map (populated ONCE per sweep by the orchestrator,
        // Pitfall 6); bundled rows continue the existing fs-adapter path.
        if (entry.sourceKind === "runtime") {
          const runtimeBytes =
            deps.resolvedRuntimeBytes?.get(entry.resolverKey) ?? null;
          // D-18: twinkie file lands mode 0644. Runtime rows do not carry
          // an on-disk mode source (the source is in-memory bytes), so we
          // stamp the well-known managed-host invariant here.
          bundledResult =
            runtimeBytes === null ? null : { bytes: runtimeBytes, mode: 0o644 };
        } else {
          bundledResult = await deps.readBundledBytes(entry.bundledPath);
        }

        // Phase 114 Plan 05 (D-16 + D-27): removal branch. Runtime row
        // whose resolver returned null → the row is applicable-but-source-
        // absent (admin cleared the field, file missing, or over the byte
        // cap). Issue an idempotent rm -f on the target path so the managed
        // host reaches a clean-unset state. The D-13 gate above already
        // ensured host.username === "root" for system-root rows, so the
        // rm is safe here.
        if (entry.sourceKind === "runtime" && bundledResult === null) {
          const rmResult = await removeInstalledFile(channel, entry.installPath);
          if (rmResult.ok === false) {
            itemsFailed++;
            logItemFailed({
              fleetHostId: host.id,
              hostName: host.name,
              entrySlug: entry.slug,
              installPath: entry.installPath,
              // Map ssh-push's stage discriminant ("remove" | "verify") to
              // log-tags' union: "remove" transport → "write" bucket (this
              // was a mutating operation that failed); "verify" (rm returned
              // non-zero or non-regular-file) also maps to "write".
              stage: "write",
              errorMessage: rmResult.errorMessage,
            });
          } else if (rmResult.action === "removed") {
            itemsChanged++;
            logItemChanged({
              fleetHostId: host.id,
              hostName: host.name,
              entrySlug: entry.slug,
              installPath: entry.installPath,
              // Use existing changeKind enum — "bytes-updated" is the closest
              // semantic fit (a byte-state change from present→absent).
              // Extending log-tags with a "removed" changeKind is deferred
              // as a future cosmetic refinement (see PLAN.md acceptance
              // criteria — PREFER staying within the existing enum).
              changeKind: "bytes-updated",
              restartHookFired: null,
            });
          }
          // rmResult.action === "already-absent" — file was never installed
          // on this host; the resolver-null state is already reflected on
          // disk. Silent skip mirrors the bytes-match skip semantics
          // (no counter bump, no log). Common case for hosts that never
          // received the twinkie yet.
          continue;
        }
        // For runtime rows with non-null bytes, fall through into the
        // existing readInstalledBytes / decideItemAction flow with
        // bundledResult already assigned. For bundled rows, likewise.
        installedResult = await retryOnTransport(
          () => readInstalledBytes(channel, entry.installPath),
          (r) => r.readOk === false && r.reason === "transport",
        );
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
      const writeResult = await retryOnTransport(
        () =>
          writeInstalledBytesWithMode(
            channel,
            entry.installPath,
            bundledResult!.bytes,
            mode,
            // Phase 114 Plan 05 (D-13 + Plan 03 opts): pass installMode so
            // ssh-push branches to the system-root command shape when the
            // row is system-root (chown root:root, mkdir parent, symlink
            // guard). For user-home rows (the existing 24), passing the
            // default is a no-op per Plan 03's byte-identical guarantee.
            { installMode },
          ),
        (r) => r.ok === false && r.errorMessage === "channel returned null",
      );

      if (writeResult.ok === false) {
        itemsFailed++;
        // Phase 114 Plan 03 extended writeInstalledBytesWithMode's stage
        // discriminant with "verify" (symlink-guard trip). log-tags'
        // stage union does not include "verify" — map it to "write" so
        // the failure lands in an existing bucket (the errorMessage
        // still carries the T-114-SYMLINK reason for greppability).
        const mappedStage: "write" | "chmod" =
          writeResult.stage === "verify" ? "write" : writeResult.stage;
        logItemFailed({
          fleetHostId: host.id,
          hostName: host.name,
          entrySlug: entry.slug,
          installPath: entry.installPath,
          stage: mappedStage,
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

  return { itemsChecked, itemsChanged, itemsFailed };
}
