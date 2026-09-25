/**
 * orchestrator-holder.ts
 *
 * Per-user holder for the fleet-status SshPollOrchestrator instances. Each
 * Skynet user gets their own orchestrator (their own SSH pool, their own
 * host set, their own subscription lifecycle — see
 * `createUserFleetStatusWatcher` in starter.ts). This module exposes those
 * instances to HTTP route handlers and WS gate closures by userId so
 * per-user code paths can consult the sweep-populated per-identity
 * cosmetics cache without doing their own SSH read.
 *
 * Purpose: routes like /sessions/list and the WS identity-gate closure sit
 * outside the closure that owns each user's orchestrator reference. Passing
 * userId + calling `getOrchestrator(userId)` lets them reach the right
 * user's cache without threading references through Express router
 * construction or WS filter injection.
 *
 * Discipline:
 *   - `setOrchestrator(userId, orch)` — publish. Called by
 *     createUserFleetStatusWatcher when a user's watcher spins up (first
 *     subscriber). Overwrites any previous entry for the same userId
 *     (a watcher may restart across subscriber-count transitions and land
 *     a fresh orchestrator instance).
 *   - `setOrchestrator(userId, null)` — clear. Called on watcher stop
 *     (last-unsubscriber) so subsequent lookups return null and callers
 *     fall through to their pre-cache path.
 *   - `getOrchestrator(userId)` — read. Returns null when no watcher is
 *     running for this user; caller MUST handle this by falling back to
 *     the SSH-read path.
 *   - Test-only reset for hermetic test scoping.
 *
 * Explicitly NOT a single-slot singleton — an earlier iteration was and
 * it broke on the second concurrent user because a per-user watcher
 * factory tried to re-set with a different reference. The multi-tenant
 * design lands here.
 */

import type { SshPollOrchestrator } from "./ssh-poll-orchestrator.js";

const orchestratorsByUserId = new Map<string, SshPollOrchestrator>();

/**
 * Publish (or clear) a user's orchestrator reference. Passing `null` for
 * `orchestrator` removes the entry — used by watcher.stop() so cache
 * lookups after teardown return null and callers fall back correctly.
 */
export function setOrchestrator(
  userId: string,
  orchestrator: SshPollOrchestrator | null,
): void {
  if (orchestrator === null) {
    orchestratorsByUserId.delete(userId);
    return;
  }
  orchestratorsByUserId.set(userId, orchestrator);
}

/**
 * Look up a user's orchestrator. Returns null when the user has no
 * running watcher (no active WS subscriber, or the watcher has been
 * torn down). Callers MUST handle null by falling back to their pre-
 * cache SSH-read path.
 */
export function getOrchestrator(
  userId: string,
): SshPollOrchestrator | null {
  return orchestratorsByUserId.get(userId) ?? null;
}

/**
 * Test-only reset. Vitest suites that inject mock orchestrators via
 * setOrchestrator MUST call this in afterEach so the next test starts
 * with an empty map.
 */
export function _resetOrchestratorForTesting(): void {
  orchestratorsByUserId.clear();
}
