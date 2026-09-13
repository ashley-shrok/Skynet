/**
 * Mobile identity-modal visibility signal.
 *
 * Any mounted IdentityModal that is `open` pushes onto this counter; the
 * mobile back-button in AppShell reads it via `useAnyIdentityModalOpen` and
 * hides itself while the count is > 0. Fixes: on mobile the IdentityModal
 * portals into `chatRegionEl` inside PrettyView, which sits inside a
 * per-tab wrapper that AppShell sets to `position: absolute; z-index: 2`
 * (a stacking context). That caps the modal's inner z-[120] at the tab
 * wrapper's z:2 — the fixed z:30 back button paints on top of the whole
 * PrettyView subtree regardless. Rather than restructure the tab-wrapper
 * z-index (broad blast radius) or portal the modal to document.body (loses
 * patch #108 desktop composer-uncovered behavior), the fix hides the button
 * for the duration the modal is visible.
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
