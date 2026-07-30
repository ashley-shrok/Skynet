// ─── Session recycling-state store (quick-260730-qbl) ────────────────────────
// Module-scoped in-memory store for per-(host, tmuxSession) "is the
// SessionHoldingOverlay currently visible on this session's pretty-view pane"
// state. Fed exclusively by PrettyView.tsx's `showOverlay` state (the delay-
// armed patch #74 gate at PrettyView.tsx:869-880); consumed by
// PrettyConversationsPanel / PrettyConversationRow to suppress the patch #137
// "ready-for-attention" dot when the overlay is up on the session's pretty
// view. Row-level gate becomes
// `inActiveSet === true && isWorking === false && !isRecycling`.
//
// SEMANTIC NOTE — "recycling" here means "SessionHoldingOverlay is currently
// visible on this key's pretty-view pane" (i.e. the delay-armed showOverlay
// state, patch #74). It is NOT "isHolding" directly (isHolding can be true
// for <350ms without ever surfacing an overlay, per patch #74's delay-arm),
// and it is NOT "recycling" in any other sense (e.g. connection retries).
// The store is deliberately keyed on the observable UI state — showOverlay —
// so a row's ready-dot suppression exactly matches the overlay-visible window
// that the user perceives.
//
// Semantics per this bounty:
//   - `null`  = overlay never observed for this key (pane never mounted OR
//               PrettyView never mounted for this session yet). UI treats
//               null as "not recycling → do NOT suppress the ready-dot"
//               (the `!isRecycling` gate reads null as falsy).
//   - `true`  = overlay currently visible on this key's pretty-view pane.
//   - `false` = overlay not currently visible.
//
// Storage layer: NONE. This is an in-memory Map<string, boolean|null> only.
// Deliberately NOT persisted to any browser storage layer — a page refresh
// resets the store to empty; the very next showOverlay flip from each mounted
// PrettyView.tsx will re-populate. Cross-tab isolation is a side benefit.
//
// Publishing null OVERWRITES to null (does NOT delete the key). Rationale:
// a re-mount observing null after a known transition is semantically correct;
// the row should treat "not recycling" rather than fall back to a stale prior
// value.
//
// Store pattern mirrors src/ui/state/session-working-store.ts (patch #137)
// verbatim: module-scoped `state` object with a Map + Set<() => void>
// listener registry + snapshotVersion counter; notify() bumps + iterates;
// subscribe() returns disposer. No zustand / jotai / redux — the fork rolls
// its own.

import { useSyncExternalStore } from "react";

// ─── Module-scoped state ─────────────────────────────────────────────────────

type State = {
  map: Map<string, boolean | null>;
};

let state: State = {
  map: new Map<string, boolean | null>(),
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
 * Publish the current recycling state (overlay visible?) for a (host,
 * tmuxSession) key. Called by PrettyView.tsx from a useEffect on
 * `[showOverlay, hostId, tmuxSession]` with the raw `showOverlay` boolean —
 * matching the semantics above.
 *
 * No-op notify guard: if the value is unchanged AND the key was already
 * present in the map, we skip the notify. Distinguishes "never published"
 * (has=false) from "explicitly null" (has=true, value=null) so a first-time
 * null publish still fires (React might be observing the key).
 */
export function publishSessionRecycling(
  key: string,
  isRecycling: boolean | null,
): void {
  const has = state.map.has(key);
  const prev = state.map.get(key) ?? null;
  if (has && prev === isRecycling) return; // no-op — do not notify
  const nextMap = new Map(state.map);
  nextMap.set(key, isRecycling);
  state = { map: nextMap };
  notify();
}

/**
 * Hook: subscribe to the recycling state for a single key. Returns:
 *   - `null` when key is null (short-circuit — no useSyncExternalStore work).
 *   - `null` when the key has never been published.
 *   - the stored `boolean | null` otherwise.
 */
export function useSessionRecycling(key: string | null): boolean | null {
  // Compute closures unconditionally so the hook is always called at the same
  // top-level position in the caller — Rules-of-Hooks compliance. The
  // getSnapshot closure short-circuits internally when key is null.
  const getSnapshot = (): boolean | null => {
    if (key === null) return null;
    const v = state.map.get(key);
    return v === undefined ? null : v;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Test-only: return the raw internal Map as a ReadonlyMap view. NOT for
 * production callers. Kept exported (rather than gated on
 * `import.meta.env.MODE === "test"`) because Vite's tree-shaker will drop it
 * from the production bundle if no production code imports it.
 */
export function getSessionRecyclingSnapshot(): ReadonlyMap<
  string,
  boolean | null
> {
  return state.map;
}

// ─── Test-only helpers ───────────────────────────────────────────────────────

/**
 * Reset the store to an empty Map + bump version + notify. Used by
 * session-recycling-store.test.ts's `beforeEach` so each test starts from a
 * known-empty state. NOT a public API.
 */
export function __resetForTest(): void {
  state = { map: new Map<string, boolean | null>() };
  notify();
}
