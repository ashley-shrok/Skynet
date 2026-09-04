// ─── Modal scope store (Phase 72 Plan 03 Task 1) ─────────────────────────────
//
// Per-identity scope memory for the IdentityModal's top segmented Role/Identity
// switch. Owns a module-scoped Map<identityKey, "role" | "identity"> and
// exposes a useSyncExternalStore-backed hook so the modal re-renders when
// scope flips.
//
// Lifecycle: BROWSER-SESSION ONLY. In-memory Map — no browser-storage APIs
// touched (see file's zero-persistence audit grep in the acceptance criteria).
// No cross-tab sync. A page reload wipes the memory entirely. This matches
// the CONTEXT.md D-lock ("scope switch position is remembered across opens
// of the SAME identity within a browser session") and closes the "no
// surprising memory across identity swaps / sessions" failure mode.
//
// Coord-vs-actor default is NOT computed here. When useModalScope returns
// undefined, the caller (IdentityModal) derives the default from
// `identity.coordinator` (coordinator → "role", actor → "identity"). Keeping
// the default computation at the call site preserves this store's single
// responsibility (remember what the user last chose) and lets the same store
// serve future callers that might want a different default.
//
// Mirrors the shape of src/ui/state/bounty-counts-store.ts (module-scoped
// state, listeners Set, notify helper, __reset*ForTest export). Simpler
// value model — one scalar per key rather than a struct — but same
// subscription semantics.
//
// NO module-load side effects.

import { useSyncExternalStore } from "react";

// ─── Public types ────────────────────────────────────────────────────────────

export type ModalScope = "role" | "identity";

// ─── Module-scoped state ─────────────────────────────────────────────────────

type State = { scopes: Map<string, ModalScope> };

let state: State = { scopes: new Map<string, ModalScope>() };
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

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Subscribe to the stored scope for a single identityKey.
 *
 * Returns `undefined` when identityKey is null OR when no setModalScope has
 * been called for that key. The caller uses `undefined` as the signal to
 * compute the coord-vs-actor default (identity.coordinator ? "role" : "identity").
 * Returns the stored scope ("role" | "identity") after any setModalScope call.
 */
export function useModalScope(identityKey: string | null): ModalScope | undefined {
  const getSnapshot = (): ModalScope | undefined => {
    if (identityKey === null) return undefined;
    return state.scopes.get(identityKey);
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Synchronous non-hook read of the stored scope for a single identityKey.
 * Returns `undefined` when no entry exists. Does NOT subscribe — safe to call
 * outside a React render.
 */
export function getModalScope(identityKey: string): ModalScope | undefined {
  return state.scopes.get(identityKey);
}

/**
 * Write the scope for an identityKey and notify all subscribers.
 *
 * Called by the IdentityModal's segmented-control onClick handlers. Always
 * notifies (even when the value is unchanged) because the intent of a scope
 * tap is user-initiated — spurious no-op re-renders are cheap and preferable
 * to silently swallowing a tap when store internals happen to already match.
 */
export function setModalScope(identityKey: string, scope: ModalScope): void {
  const next = new Map(state.scopes);
  next.set(identityKey, scope);
  state = { scopes: next };
  notify();
}

// ─── Test-only helpers ───────────────────────────────────────────────────────

/**
 * Reset the store to an empty Map + notify. Called in the modal-scope-store
 * test's beforeEach so each test starts from a known-empty state, and in the
 * IdentityModal test files' beforeEach so per-identity scope memory does not
 * leak across tests. NOT a public API.
 */
export function __resetModalScopeForTest(): void {
  state = { scopes: new Map<string, ModalScope>() };
  notify();
}
