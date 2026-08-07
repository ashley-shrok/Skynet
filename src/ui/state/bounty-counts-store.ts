// ─── Bounty-counts store (quick 260727-tb1) ──────────────────────────────────
//
// Module-scoped store powering the per-row pinned bounty badge in
// pretty-conversations. Uses useSyncExternalStore per Task 2 spec (matches
// the pattern in src/ui/state/session-working-store.ts and
// src/ui/state/conversation-store.ts — the fork rolls its own; no zustand /
// jotai / redux).
//
// Semantics:
//   - Internal state: Map<compositeKey, {pinnedCount: number; needsDeskCount: number}>
//     where compositeKey = `${identityKey}:${hostId ?? "local"}`.
//   - useBountyCounts(identityKey, hostId): returns `undefined` when no fetch
//     has completed for that composite key, or when identityKey is null
//     (short-circuit — non-identity rows never subscribe). Returns the
//     stored {pinnedCount, needsDeskCount} pair post-refresh.
//   - refreshBountyCounts(targets): sends one identity:count-bounties WS
//     request via countIdentityBounties, applies successful {pinnedCount,
//     needsDeskCount} pairs to the map, then notifies subscribers. Per-target
//     errors are logged and SKIPPED — the last-known pair is preserved rather
//     than overwritten (verification #9 in the plan: "SSH host dead → dead-host
//     badge holds last-known"). Both halves of the pair are preserved on error.
//   - startBountyCountPoller(getTargets, intervalMs=60_000): fires an initial
//     fetch, sets a setInterval, adds a window.focus listener that fires an
//     extra refresh. Returns a stop-fn that clears the interval AND removes
//     the focus listener.
//   - invalidateIdentity(identityKey, hostId): fires a targeted refresh for
//     just that composite key so the badge updates immediately after a
//     related mutation (piggyback path for identity:bounty-priority-updated).
//
// NO global side effects at module load — the poller is started explicitly
// by PrettyConversationsPanel in Task 3, not on import.

import { useSyncExternalStore } from "react";

import {
  countIdentityBounties,
  type BountyCountTarget,
} from "@/api/claude-session-api";

// ─── Module-scoped state ─────────────────────────────────────────────────────

type CountsPair = { pinnedCount: number; needsDeskCount: number };

type State = { counts: Map<string, CountsPair> };

let state: State = { counts: new Map<string, CountsPair>() };
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function compositeKey(identityKey: string, hostId: number | null): string {
  return `${identityKey}:${hostId ?? "local"}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Subscribe to the bounty counts pair for a single (identityKey, hostId)
 * pair. Returns `undefined` when identityKey is null OR when no refresh has
 * yet landed for that composite key. Returns {pinnedCount, needsDeskCount}
 * post-refresh.
 */
export function useBountyCounts(
  identityKey: string | null,
  hostId: number | null,
): { pinnedCount: number; needsDeskCount: number } | undefined {
  const getSnapshot = ():
    | { pinnedCount: number; needsDeskCount: number }
    | undefined => {
    if (identityKey === null) return undefined;
    return state.counts.get(compositeKey(identityKey, hostId));
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribe to the FULL counts map. Used by PrettyConversationsPanel to filter
 * the whole conversation list to just rows whose identity has at least one
 * pinned bounty (patch #167). Keeps the row-level useBountyCounts subscription
 * intact for the per-row badge; this is a separate subscription that pulls the
 * whole snapshot for the panel-level filter helper. Each map value is the
 * {pinnedCount, needsDeskCount} pair. Composite key format matches
 * compositeKey() above: `${identityKey}:${hostId ?? "local"}`.
 */
export function useAllBountyCounts(): ReadonlyMap<
  string,
  { pinnedCount: number; needsDeskCount: number }
> {
  const getSnapshot = (): ReadonlyMap<
    string,
    { pinnedCount: number; needsDeskCount: number }
  > => state.counts;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Format the (identityKey, hostId) composite key exactly as the store stores
 * it. Exported so panel-level filter helpers can look up the counts pair without
 * re-implementing the key format (and drifting out of sync with the store).
 */
export function bountyCountsCompositeKey(
  identityKey: string,
  hostId: number | null,
): string {
  return compositeKey(identityKey, hostId);
}

/**
 * Fire ONE identity:count-bounties WS request carrying all targets. Applies
 * successful {pinnedCount, needsDeskCount} pairs to the internal map and
 * notifies subscribers.
 *
 * Per-target errors (response entry with `error` field) are logged via
 * console.warn and SKIPPED — we deliberately do NOT overwrite the last-known
 * counts pair with zeros (spec verification #9). Both halves of the pair are
 * preserved when a per-target error occurs. If the WS transport itself fails
 * (countIdentityBounties rejects), the promise-catch logs and returns —
 * the poller will retry on the next tick.
 */
export async function refreshBountyCounts(
  targets: BountyCountTarget[],
): Promise<void> {
  if (targets.length === 0) return;
  let response;
  try {
    response = await countIdentityBounties(targets);
  } catch (err) {
    // Transport-level failure — poller retries on next tick.
    // eslint-disable-next-line no-console
    console.warn("bounty-counts-store: refresh failed", err);
    return;
  }
  const next = new Map(state.counts);
  let mutated = false;
  for (const c of response.counts) {
    if (c.error) {
      // eslint-disable-next-line no-console
      console.warn(
        `bounty-counts-store: per-target error for ${c.identityKey}@${c.hostId ?? "local"}: ${c.error}`,
      );
      continue; // preserve last-known {pinnedCount, needsDeskCount} pair
    }
    const key = compositeKey(c.identityKey, c.hostId);
    const prev = next.get(key);
    const changed =
      !prev ||
      prev.pinnedCount !== c.pinnedCount ||
      prev.needsDeskCount !== c.needsDeskCount;
    if (changed) {
      next.set(key, {
        pinnedCount: c.pinnedCount,
        needsDeskCount: c.needsDeskCount,
      });
      mutated = true;
    }
  }
  if (mutated) {
    state = { counts: next };
    notify();
  }
}

/**
 * Start the polling loop. Fires an initial fetch, then setInterval at
 * intervalMs, plus a window.focus listener that fires an extra refresh.
 * Returns a stop-fn that clears the interval AND removes the focus listener.
 *
 * Non-identity rows should be filtered out by `getTargets` — this function
 * does NOT know which rows carry identities.
 */
export function startBountyCountPoller(
  getTargets: () => BountyCountTarget[],
  intervalMs: number = 60_000,
): () => void {
  const tick = () => {
    const targets = getTargets();
    if (targets.length === 0) return;
    void refreshBountyCounts(targets);
  };
  // Initial fetch — inline so the first render can populate quickly.
  tick();
  const intervalId = setInterval(tick, intervalMs);
  const focusHandler = () => tick();
  if (typeof window !== "undefined") {
    window.addEventListener("focus", focusHandler);
  }
  return () => {
    clearInterval(intervalId);
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", focusHandler);
    }
  };
}

/**
 * Force an immediate refresh for a single (identityKey, hostId) pair. Used by
 * the identity:bounty-priority-updated piggyback (Task 3) so the badge
 * reflects Ashley's priority change without waiting for the next 60s poll.
 */
export function invalidateIdentity(
  identityKey: string,
  hostId: number | null,
): Promise<void> {
  return refreshBountyCounts([{ identityKey, hostId }]);
}

// ─── Test-only helpers ───────────────────────────────────────────────────────

/**
 * Reset the store to an empty Map + notify. Used by bounty-counts-store.test.ts's
 * beforeEach so each test starts from a known-empty state. NOT a public API.
 */
export function __resetBountyCountsForTest(): void {
  state = { counts: new Map<string, CountsPair>() };
  notify();
}
