// Is an agent compacting, as every surface that shows it should see it: the
// fleet-status poll's condensing axis (a compaction asked for or under way on
// the agent's box), or a Compact request this tab has just made that the poll
// hasn't caught up with yet. One shared "just asked" flag per session key, so
// the memory pie, a relay room's badge and the conversation's working orb all
// turn on together the moment the user confirms.
//
// The flag clears once the poll reports the compaction (the poll takes over)
// — watched here, so it clears whether or not anything for that agent is on
// screen — or after OPTIMISTIC_MS if it never does.

import { useSyncExternalStore } from "react";

import {
  getSessionIsCondensing,
  subscribeSessionWorkingStore,
  useSessionIsCondensing,
} from "./session-working-store";

/** How long a request counts as compacting on its own before the poll confirms it. */
export const OPTIMISTIC_MS = 2 * 60 * 1000;

const requested = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function clearRequested(key: string): void {
  const t = requested.get(key);
  if (t === undefined) return;
  clearTimeout(t);
  requested.delete(key);
  notify();
}

// The poll has taken over for every flagged session it now reports compacting.
subscribeSessionWorkingStore(() => {
  for (const key of [...requested.keys()]) {
    if (getSessionIsCondensing(key)) clearRequested(key);
  }
});

/** A Compact request for this session key was accepted. Key: `${hostId}:${tmuxSession}`. */
export function markCompactRequested(key: string): void {
  const prior = requested.get(key);
  if (prior !== undefined) clearTimeout(prior);
  requested.set(
    key,
    setTimeout(() => {
      requested.delete(key);
      console.info(`[compact-request] optimistic flag expired without the poll confirming key=${key}`);
      notify();
    }, OPTIMISTIC_MS),
  );
  notify();
}

/** True while the session is compacting, or a request for it is on its way. */
export function useSessionCompacting(key: string | null): boolean {
  const condensing = useSessionIsCondensing(key);
  const asked = useSyncExternalStore(
    subscribe,
    () => key !== null && requested.has(key),
    () => key !== null && requested.has(key),
  );
  return condensing || asked;
}

/** Test-only: forget every request. */
export function __resetCompactRequestsForTests(): void {
  for (const t of requested.values()) clearTimeout(t);
  requested.clear();
  notify();
}
