/**
 * log-tags.ts — Thin wrappers over systemLogger for the four fleet-substrate
 * log tags Plan 04's hook code emits.
 *
 * SHAPE SOURCE OF TRUTH:
 *   .planning/phases/72-feature-02-slice-2-reconcile-loop/72-CONTEXT.md
 *   § Code context (Console-forward log surface). The four operation strings
 *   below are grep-anchors — a box-maintainer diagnosing "why didn't the
 *   supervisor pick up my new bytes on wilma?" reaches for
 *   `grep fleet_substrate console-forward.log`, and the primary reader of
 *   these lines is that operator. The shape doc calls out that the operator
 *   is the primary reader; log-tag naming discipline is what makes that
 *   diagnostic path readable without loading the codebase into their head.
 *
 * OPERATION-FIELD DISCIPLINE:
 *   Exact string values matter — Plan 04 composes these helpers, and any
 *   downstream grep or dashboard that pattern-matches on `operation:` needs
 *   them stable. The four canonical tags are:
 *     - fleet_substrate_sweep_result      (always emitted, once per sweep-per-host)
 *     - fleet_substrate_item_changed      (per-item, only when non-current)
 *     - fleet_substrate_item_failed       (per-item failure, warn level)
 *     - fleet_substrate_sweep_hook_error  (per-sweep, orchestrator-scoped
 *                                          .catch defense-in-depth, warn level)
 *   The naming mirrors the fleet_status_* convention already established in
 *   src/backend/fleet-status/ssh-poll-orchestrator.ts (see fleet_status_poll_start
 *   at ~line 810 and fleet_status_host_evicted at ~line 1929).
 *
 * PEER-MODULE DISCIPLINE:
 *   This file has ONE import — systemLogger. It does NOT import ./catalog
 *   (no CatalogEntry coupling), ./sweep-logic (no ItemDecision coupling),
 *   or any transport module. Callers pass plain payload objects. Composition
 *   with the decision layer happens in Plan 04's hook code, not here — these
 *   two modules are peers.
 */
import { systemLogger } from "../utils/logger.js";

/**
 * Emit the always-on per-sweep summary tag. Called exactly ONCE per sweep
 * invocation per host, regardless of outcome (all-clean, some-changed,
 * some-failed, all-failed). Info level — this is the load-bearing "sweep
 * completed" heartbeat a diagnosing operator uses to confirm the sweep even
 * ran on a given host across a Skynet restart cycle.
 */
export function logSweepResult(payload: {
  hostId: string;
  hostName: string;
  itemsChecked: number;
  itemsChanged: number;
  itemsFailed: number;
  durationMs: number;
}): void {
  systemLogger.info("Fleet-substrate sweep completed for host", {
    operation: "fleet_substrate_sweep_result",
    ...payload,
  });
}

/**
 * Emit a per-item change detail line. Only fired for items whose sweep
 * outcome was non-current (bytes updated, or first-time install). Skipped
 * items — the common case — do NOT emit this tag; that keeps the log volume
 * bounded per the shape doc's "detail lines only when non-current" tier.
 *
 * changeKind:
 *   - "installed-new"  → installed side was absent (ENOENT), first install
 *   - "bytes-updated"  → installed side existed but bytes differed
 * restartHookFired:
 *   - non-null string  → the systemd unit that was successfully restarted
 *   - null             → no restart hook applied for this item
 */
export function logItemChanged(payload: {
  hostId: string;
  hostName: string;
  entrySlug: string;
  installPath: string;
  changeKind: "installed-new" | "bytes-updated";
  restartHookFired: string | null;
}): void {
  systemLogger.info("Fleet-substrate item changed on host", {
    operation: "fleet_substrate_item_changed",
    ...payload,
  });
}

/**
 * Emit a per-item failure. Warn level so it shows up in operator alerts
 * without being treated as a fatal error (the sweep as a whole is
 * fire-and-forget from the poll's perspective and MUST NOT throw upward —
 * per-item failures are contained here).
 *
 * stage names correspond to the phase of the per-item work where the
 * failure occurred: read the installed side, read the bundled side, write
 * new bytes, chmod them, or fire the restart hook.
 */
export function logItemFailed(payload: {
  hostId: string;
  hostName: string;
  entrySlug: string;
  installPath: string;
  stage: "read-installed" | "read-bundled" | "write" | "chmod" | "restart";
  errorMessage: string;
}): void {
  systemLogger.warn("Fleet-substrate item failed on host", {
    operation: "fleet_substrate_item_failed",
    ...payload,
  });
}

/**
 * Emit a per-sweep-invocation hook-error tag. Fired ONLY by the
 * orchestrator-scoped .catch that wraps the runSweepForHost promise in
 * Plan 04's hook site — defense-in-depth against a promise rejection that
 * runSweepForHost's own fire-and-forget contract says can never happen.
 *
 * DISTINCT from logItemFailed:
 *   - logItemFailed is per-ITEM inside the sweep composer.
 *   - logSweepHookError is per-SWEEP-INVOCATION from OUTSIDE the composer.
 * If both fire for a single sweep, that's expected: an item failed AND
 * something broke in the sweep-runner's error containment.
 */
export function logSweepHookError(payload: {
  hostId: string;
  hostName: string;
  errorMessage: string;
}): void {
  systemLogger.warn("Fleet-substrate sweep hook rejected (unexpected)", {
    operation: "fleet_substrate_sweep_hook_error",
    ...payload,
  });
}
