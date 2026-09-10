// ─── Trapped-work store (Phase 104 Plan 02) ─────────────────────────────────
//
// Module-scoped store powering the per-identity trapped-work indicator on
// the two identity surfaces (D-05): conversation-list row's avatar-corner
// and pretty-view header IdentityBadge's avatar-corner. useSyncExternalStore
// module pattern (roll-your-own; no zustand/jotai/redux). Composite-key
// format and 60s+focus poller shape are inherited from Phase 26's prior
// wire (Phase 104 Plan 03 retired that wire; the trapped-work store keeps
// the pattern).
//
// Semantics:
//   - Internal state: Map<compositeKey, {hasTrappedWork: boolean}> where
//     compositeKey = `${identityKey}:${hostId ?? "local"}`.
//   - useTrappedWork(identityKey, hostId): returns `undefined` when no
//     fetch has completed for that composite key, or when identityKey is
//     null (short-circuit — non-identity rows never subscribe). Returns
//     the stored {hasTrappedWork} object post-refresh (D-06: start-absent
//     until probe returns; components gate on strict `=== true`).
//   - refreshTrappedWork(targets): sends one identity:probe-trapped-work
//     WS request via probeIdentityTrappedWork, applies successful
//     {hasTrappedWork} values to the map, then notifies subscribers.
//     Per-target errors are logged and SKIPPED — the last-known snapshot
//     is preserved rather than overwritten to false (mirrors the bounty-
//     counts per-target error behavior).
//   - startTrappedWorkPoller(getTargets, intervalMs=60_000): fires an
//     initial fetch, sets a setInterval, adds a window.focus listener
//     that fires an extra refresh (D-08 cadence). Returns a stop-fn that
//     clears the interval AND removes the focus listener.
//
// Note: intentionally NO targeted-refresh-per-identity equivalent — the
// trapped-work store has no post-mutation refresh trigger analog (git state
// mutates on the peer box outside Skynet's control; the 60s poll + focus
// refresh cover the recovery window). This is a deliberate omission per
// D-06 semantics.
//
// NO global side effects at module load — the poller is started explicitly
// by PrettyConversationsPanel, not on import.

import { useSyncExternalStore } from "react";

import {
  probeIdentityTrappedWork,
  type TrappedWorkTarget,
} from "@/api/claude-session-api";

// ─── Module-scoped state ─────────────────────────────────────────────────────

type TrappedWorkValue = { hasTrappedWork: boolean };

type State = { counts: Map<string, TrappedWorkValue> };

let state: State = { counts: new Map<string, TrappedWorkValue>() };
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
 * Subscribe to the trapped-work snapshot for a single (identityKey, hostId)
 * pair. Returns `undefined` when identityKey is null OR when no refresh has
 * yet landed for that composite key (D-06 start-absent). Returns
 * {hasTrappedWork} post-refresh.
 */
export function useTrappedWork(
  identityKey: string | null,
  hostId: number | null,
): { hasTrappedWork: boolean } | undefined {
  const getSnapshot = (): { hasTrappedWork: boolean } | undefined => {
    if (identityKey === null) return undefined;
    return state.counts.get(compositeKey(identityKey, hostId));
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribe to the FULL trapped-work map. Composite key format matches
 * compositeKey() above: `${identityKey}:${hostId ?? "local"}`. No direct
 * consumer this phase (kept for future panel-level filter helpers).
 */
export function useAllTrappedWork(): ReadonlyMap<
  string,
  { hasTrappedWork: boolean }
> {
  const getSnapshot = (): ReadonlyMap<
    string,
    { hasTrappedWork: boolean }
  > => state.counts;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Format the (identityKey, hostId) composite key exactly as the store stores
 * it. Exported so panel-level helpers can look up entries without
 * re-implementing the key format (and drifting out of sync with the store).
 */
export function trappedWorkCompositeKey(
  identityKey: string,
  hostId: number | null,
): string {
  return compositeKey(identityKey, hostId);
}

/**
 * Fire ONE identity:probe-trapped-work WS request carrying all targets.
 * Applies successful {hasTrappedWork} values to the internal map and
 * notifies subscribers.
 *
 * Per-target errors (response entry with `error` field) are logged via
 * console.warn and SKIPPED — we deliberately do NOT overwrite the last-known
 * snapshot with false. If the WS transport itself fails
 * (probeIdentityTrappedWork rejects), the promise-catch logs and returns —
 * the poller will retry on the next tick.
 */
export async function refreshTrappedWork(
  targets: TrappedWorkTarget[],
): Promise<void> {
  if (targets.length === 0) return;
  let response;
  try {
    response = await probeIdentityTrappedWork(targets);
  } catch (err) {
    // Transport-level failure — poller retries on next tick.
    // eslint-disable-next-line no-console
    console.warn("trapped-work-store: refresh failed", err);
    return;
  }
  const next = new Map(state.counts);
  let mutated = false;
  for (const r of response.results) {
    if (r.error) {
      // eslint-disable-next-line no-console
      console.warn(
        `trapped-work-store: per-target error for ${r.identityKey}@${r.hostId ?? "local"}: ${r.error}`,
      );
      continue; // preserve last-known {hasTrappedWork}
    }
    const key = compositeKey(r.identityKey, r.hostId);
    const prev = next.get(key);
    const changed = !prev || prev.hasTrappedWork !== r.hasTrappedWork;
    if (changed) {
      next.set(key, { hasTrappedWork: r.hasTrappedWork });
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
 * intervalMs (D-08: 60_000 ms), plus a window.focus listener that fires an
 * extra refresh. Returns a stop-fn that clears the interval AND removes the
 * focus listener.
 *
 * Non-identity rows should be filtered out by `getTargets` — this function
 * does NOT know which rows carry identities. Per Pitfall #5 in RESEARCH.md,
 * the poller MUST cover dormant identities too (the whole point of the
 * rescue-oriented indicator).
 */
export function startTrappedWorkPoller(
  getTargets: () => TrappedWorkTarget[],
  intervalMs: number = 60_000,
): () => void {
  const tick = () => {
    const targets = getTargets();
    if (targets.length === 0) return;
    void refreshTrappedWork(targets);
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

// ─── Test-only helpers ───────────────────────────────────────────────────────

/**
 * Reset the store to an empty Map + notify. Used by trapped-work-store.test.ts's
 * beforeEach so each test starts from a known-empty state. NOT a public API.
 */
export function __resetTrappedWorkForTest(): void {
  state = { counts: new Map<string, TrappedWorkValue>() };
  notify();
}
