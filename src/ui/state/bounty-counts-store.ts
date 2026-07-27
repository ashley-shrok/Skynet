// ─── Bounty-counts store (quick 260727-tb1) ──────────────────────────────────
//
// Module-scoped store powering the per-row pinned bounty badge in
// pretty-conversations. Uses useSyncExternalStore per Task 2 spec (matches
// the pattern in src/ui/state/session-working-store.ts and
// src/ui/state/conversation-store.ts — the fork rolls its own; no zustand /
// jotai / redux).
//
// Semantics:
//   - Internal state: Map<compositeKey, number> where
//     compositeKey = `${identityKey}:${hostId ?? "local"}`.
//   - useBountyCount(identityKey, hostId): returns `undefined` when no fetch
//     has completed for that composite key, or when identityKey is null
//     (short-circuit — non-identity rows never subscribe). Returns the
//     stored integer post-refresh.
//   - refreshBountyCounts(targets): sends one identity:count-bounties WS
//     request via countIdentityBounties, applies successful counts to the
//     map, then notifies subscribers. Per-target errors are logged and
//     SKIPPED — the last-known count is preserved rather than overwritten
//     with 0 (verification #9 in the plan: "SSH host dead → dead-host
//     badge holds last-known").
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

type State = { counts: Map<string, number> };

let state: State = { counts: new Map<string, number>() };
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
 * Subscribe to the pinned bounty count for a single (identityKey, hostId)
 * pair. Returns `undefined` when identityKey is null OR when no refresh has
 * yet landed for that composite key.
 */
export function useBountyCount(
  identityKey: string | null,
  hostId: number | null,
): number | undefined {
  const getSnapshot = (): number | undefined => {
    if (identityKey === null) return undefined;
    return state.counts.get(compositeKey(identityKey, hostId));
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Fire ONE identity:count-bounties WS request carrying all targets. Applies
 * successful counts to the internal map and notifies subscribers.
 *
 * Per-target errors (response entry with `error` field) are logged via
 * console.warn and SKIPPED — we deliberately do NOT overwrite the last-known
 * count with 0 (spec verification #9). If the WS transport itself fails
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
      continue; // preserve last-known
    }
    const key = compositeKey(c.identityKey, c.hostId);
    if (next.get(key) !== c.pinnedCount) {
      next.set(key, c.pinnedCount);
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
  state = { counts: new Map<string, number>() };
  notify();
}
