/**
 * orchestrator-holder.ts
 *
 * Module-scope singleton holder for the fleet-status SshPollOrchestrator
 * instance. Mirrors registry-holder.ts's pattern verbatim (set-once slot
 * populated at boot, read-only accessor for the HTTP surface).
 *
 * Purpose: expose `getCachedIdentityCosmetics` to HTTP route handlers so
 * they can consult the sweep-populated per-identity cosmetics cache without
 * doing their own SSH read per row. The route surface (sessions.ts,
 * identities.ts, conversation-search.ts) sits in a context with no
 * ergonomic path to the closure-scoped orchestrator reference inside
 * starter.ts's boot lambda.
 *
 * Discipline (matches registry-holder.ts):
 *   - `setOrchestrator` is called by the boot code immediately after
 *     `createSshPollOrchestrator` returns. Re-setting with a DIFFERENT
 *     reference throws (belt-and-suspenders against accidental double-init).
 *     Re-setting with the SAME reference is a no-op — starter.ts's
 *     start/stop lambda may re-invoke createSshPollOrchestrator across
 *     subscriber-count transitions, and each new instance rebinds through
 *     `setOrchestrator` cleanly.
 *   - `getOrchestrator` returns null when the holder is empty (orchestrator
 *     hasn't been started, or was stopped). Route callers treat null as
 *     "cache miss" — fall through to whatever their pre-cache path was.
 *   - Test-only reset for hermetic test scoping.
 */

import type { SshPollOrchestrator } from "./ssh-poll-orchestrator.js";

let orchestratorRef: SshPollOrchestrator | null = null;

/**
 * Publish the process-wide orchestrator reference. Called by starter.ts
 * after `createSshPollOrchestrator` returns; may also be called by tests
 * that inject a mock. Passing the same reference twice is a no-op;
 * passing a different reference while one is set throws.
 *
 * Passing `null` explicitly clears the reference (used by starter.ts on
 * orchestrator.stop() so route handlers fall back to their pre-cache
 * behavior when no orchestrator is running).
 */
export function setOrchestrator(
  orchestrator: SshPollOrchestrator | null,
): void {
  if (orchestrator === null) {
    orchestratorRef = null;
    return;
  }
  if (orchestratorRef !== null && orchestratorRef !== orchestrator) {
    throw new Error(
      "fleet-status orchestrator-holder: setOrchestrator called twice with different references",
    );
  }
  orchestratorRef = orchestrator;
}

/**
 * Read the process-wide orchestrator reference. Returns null when the
 * orchestrator has not been started, or has been stopped. Route handlers
 * that use this to consult the cosmetics cache MUST handle null by falling
 * through to their pre-cache SSH-read path.
 */
export function getOrchestrator(): SshPollOrchestrator | null {
  return orchestratorRef;
}

/**
 * Test-only reset. Vitest suites that inject a mock orchestrator via
 * setOrchestrator MUST call this in afterEach so the next test starts
 * with a clean holder.
 */
export function _resetOrchestratorForTesting(): void {
  orchestratorRef = null;
}
