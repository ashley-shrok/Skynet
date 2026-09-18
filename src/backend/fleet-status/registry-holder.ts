/**
 * registry-holder.ts
 *
 * Module-scope singleton holder for the fleet-status SubscriptionRegistry.
 *
 * The registry is constructed inside `startFleetStatusServer()` (called from
 * `starter.ts` at boot) — that closure owns the SubscriptionRegistry
 * reference. Historically, only the fleet-status WS server + orchestrator
 * needed it, so passing the reference through function args sufficed.
 *
 * Phase 119 code review HIGH-1 (fix pass 2026-09-18): the new
 * `GET /apps/:hostId/:slug` redirect route needs to look up an app's port
 * from the registry's `getAppSnapshot()` synchronously inside an Express
 * route handler — a context with no ergonomic path to the closure-scoped
 * reference. This holder is the smallest possible fix: a set-once slot
 * that boot code populates, and route code reads.
 *
 * Discipline:
 *   - `setRegistry` is called EXACTLY ONCE per process, from starter.ts,
 *     immediately after `startFleetStatusServer` returns. Re-setting
 *     throws (defense against accidental double-init).
 *   - `getRegistry` returns null when the registry hasn't been set yet
 *     (route code must handle this — e.g. respond 503 or 502). Tests can
 *     inject their own registry via `setRegistry`, but must call
 *     `_resetRegistryForTesting` in an afterEach to avoid double-init.
 *   - No other subsystem should read/write this — the WS server + poll
 *     orchestrator continue to receive the registry via constructor args.
 *     This holder is a read-only accessor for the HTTP surface only.
 */

import type { SubscriptionRegistry } from "./subscription-registry.js";

let registryRef: SubscriptionRegistry | null = null;

/**
 * Set the process-wide registry reference. Called EXACTLY ONCE from
 * starter.ts at boot. Throws if called twice with different references
 * (belt-and-suspenders — a caller that re-invokes with the SAME reference
 * is a no-op).
 */
export function setRegistry(registry: SubscriptionRegistry): void {
  if (registryRef !== null && registryRef !== registry) {
    throw new Error(
      "fleet-status registry-holder: setRegistry called twice with different references",
    );
  }
  registryRef = registry;
}

/**
 * Read the process-wide registry reference. Returns null when the holder
 * has not been populated yet — callers (route handlers) must handle this
 * (typically with a 502/503 response). At normal runtime the holder is
 * populated during boot before any HTTP traffic arrives.
 */
export function getRegistry(): SubscriptionRegistry | null {
  return registryRef;
}

/**
 * Test-only reset. Not exported for production use. Vitest suites that
 * inject a mock registry via setRegistry MUST call this in afterEach so
 * the next test starts clean.
 */
export function _resetRegistryForTesting(): void {
  registryRef = null;
}
