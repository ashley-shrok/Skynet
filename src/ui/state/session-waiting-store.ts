// ─── Session waiting-state store (Phase 34 Plan 06) ─────────────────────────
// Companion store to session-working-store — same shape (Map + listener
// registry + useSyncExternalStore hook) but tracks `waitingFor` per
// (hostId, tmuxSession) key.
//
// Published when the fleet-status channel reports status === 'waiting' for a
// session, conveying the `waitingFor` reason string from the SessionState.
// Cleared (set to null) when the session transitions away from waiting, or
// when the session is gone.
//
// This store is INDEPENDENT of session-working-store. Publishes to one do
// NOT trigger notifies on the other. They share only the key convention:
//   `${hostId}:${tmuxSession ?? ""}` — same as session-working-store.ts.
//
// Internal state: Map<string, string> where value = current waitingFor.
// A null publish DELETES the key (not overwrites with null).
// useSessionWaitingFor returns string | null (null = not waiting / unknown key).
//
// Store pattern mirrors session-working-store.ts verbatim.

import { useSyncExternalStore } from "react";

// ─── Module-scoped state ─────────────────────────────────────────────────────

type State = {
  map: Map<string, string>;
};

let state: State = {
  map: new Map<string, string>(),
};

let snapshotVersion = 0;

const listeners = new Set<() => void>();

function notify(): void {
  snapshotVersion += 1;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Publish the waiting-for state for a (hostId, tmuxSession) key.
 * Called by the fleet-status client on onSnapshot and onUpdate when
 * SessionState.status === 'waiting'.
 *
 * - Non-null `waitingFor` → sets or updates the key in the map.
 * - Null `waitingFor` → DELETES the key (session no longer waiting).
 *
 * No-op if value is unchanged (same string value and key exists, or
 * null and key does not exist).
 */
export function publishFleetStatusWaitingFor(
  hostId: string,
  tmuxSession: string | null,
  waitingFor: string | null,
): void {
  const key = `${hostId}:${tmuxSession ?? ""}`;

  if (waitingFor === null) {
    if (!state.map.has(key)) return; // no-op: already absent

    console.info({
      operation: "fleet_status_waiting_cleared",
      hostId,
      tmuxSession,
      key,
    });

    const nextMap = new Map(state.map);
    nextMap.delete(key);
    state = { map: nextMap };
    notify();
    return;
  }

  const existing = state.map.get(key);
  if (existing === waitingFor) return; // no-op: same value

  console.info({
    operation: "fleet_status_waiting_set",
    hostId,
    tmuxSession,
    waitingFor,
    key,
  });

  const nextMap = new Map(state.map);
  nextMap.set(key, waitingFor);
  state = { map: nextMap };
  notify();
}

/**
 * Hook: returns the current waitingFor string for the given key, or null
 * if the session is not in waiting state / key unknown.
 *
 *   - Null key → null (short-circuit; avoids subscribe work for host-less rows).
 *   - Unknown key → null (session not waiting or no data yet).
 *   - Known key → the waitingFor string as reported by the fleet-status channel.
 */
export function useSessionWaitingFor(key: string | null): string | null {
  const getSnapshot = (): string | null => {
    if (key === null) return null;
    return state.map.get(key) ?? null;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Unused variable reference to suppress TypeScript "declared but never read"
// for snapshotVersion if nothing else uses it.
void snapshotVersion;

// ─── Test-only helpers ───────────────────────────────────────────────────────

/**
 * Reset the store to an empty Map + bump version + notify. Used by
 * session-waiting-store.test.ts's `beforeEach`. NOT a public API.
 */
export function __resetForTestWaiting(): void {
  state = { map: new Map<string, string>() };
  notify();
}
