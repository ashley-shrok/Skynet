// convo-scoped apps: which conversation apps the user has asked to move to the
// sidebar during this page load. The request goes to the agent, which takes a
// moment to act, so the "Move to sidebar" menu items (app bar + Apps tab) read
// this to show "Move to sidebar requested" and stay disabled instead of
// inviting a second click. In-memory only: once the agent moves the app it
// stops being a conversation app and the item disappears anyway.

import { useSyncExternalStore } from "react";

const requested = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const key = (hostId: number | string, slug: string) => `${hostId}\u0000${slug}`;

export function markPromoteRequested(hostId: number | string, slug: string): void {
  requested.add(key(hostId, slug));
  version++;
  listeners.forEach((l) => l());
}

export function clearPromoteRequested(hostId: number | string, slug: string): void {
  if (requested.delete(key(hostId, slug))) {
    version++;
    listeners.forEach((l) => l());
  }
}

export function isPromoteRequested(hostId: number | string, slug: string): boolean {
  return requested.has(key(hostId, slug));
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Re-renders the caller whenever any request is marked or cleared. */
export function usePromoteRequestsVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

export function _resetPromoteRequestsForTesting(): void {
  requested.clear();
  version++;
}
