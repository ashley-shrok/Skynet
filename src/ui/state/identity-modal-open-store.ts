/**
 * Mobile identity-modal visibility signal.
 *
 * Any mounted IdentityModal that is `open` pushes onto this counter; the
 * mobile back-button in AppShell reads it via `useAnyIdentityModalOpen` and
 * hides itself while the count is > 0. The modal now portals to
 * document.body with a full-viewport backdrop (2026-09-30 UAT), so the
 * button is naturally covered on mobile — this counter is defence in depth
 * (keeps the button out even if the overlay ever regresses to
 * pointer-events:none).
 *
 * Counter (not boolean) so multiple simultaneous modals (e.g. desktop
 * split-view with two panes each opening an identity modal) compose
 * correctly — button reappears only when every open modal has closed.
 */

import { useSyncExternalStore } from "react";

let count = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

/** Register an open identity modal. Call from a mount effect. */
export function pushIdentityModalOpen(): void {
  count += 1;
  notify();
}

/** Deregister an open identity modal. Call from the same effect's cleanup. */
export function popIdentityModalOpen(): void {
  count = Math.max(0, count - 1);
  notify();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): boolean {
  return count > 0;
}

/**
 * Reactive hook. Returns true while ≥1 identity modal is open anywhere in
 * the app. Used by AppShell's mobile back-button render gate.
 */
export function useAnyIdentityModalOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test-only reset. */
export function __resetIdentityModalOpenStoreForTests(): void {
  count = 0;
  notify();
}
