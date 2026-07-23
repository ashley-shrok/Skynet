// ─── Session working-state store (patch #137) ────────────────────────────────
// Module-scoped in-memory store for per-(host, tmuxSession) "is the agent
// working, idle, or unknown" state. Fed exclusively by Terminal.tsx's isIdle
// state observer; consumed by PrettyConversationsPanel / PrettyConversationRow
// to drive the patch #137 "ready-for-attention" dot (renders iff
// `inActiveSet === true && isWorking === false`).
//
// Semantics per §1 of the plan:
//   - `null`  = we've never observed working state for this key, OR the backend
//               has not yet published an initial idle frame. UI treats null as
//               "unknown → suppress the ready-dot".
//   - `true`  = agent is currently working (isIdle === false).
//   - `false` = agent is idle waiting on input (isIdle === true).
//
// Storage layer: NONE. This is an in-memory Map<string, boolean|null> only.
// Deliberately NOT persisted to any browser storage layer — a page refresh
// resets the store to empty; the very next isIdle emit from each mounted
// Terminal.tsx will re-populate. Cross-tab isolation is a side benefit.
//
// Publishing null OVERWRITES to null (does NOT delete the key). Rationale:
// a re-mount observing null after a known transition is semantically correct;
// the row should suppress its dot rather than fall back to a stale prior value.
//
// Store pattern mirrors src/ui/state/conversation-store.ts verbatim: module-
// scoped `state` object with a Map + Set<() => void> listener registry +
// snapshotVersion counter; notify() bumps + iterates; subscribe() returns
// disposer. No zustand / jotai / redux — the fork rolls its own.

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
 * Publish the current working state for a (host, tmuxSession) key. Called by
 * Terminal.tsx from a useEffect on `[isIdle, hostConfig.id, tmuxSessionName]`
 * with `isIdle === null ? null : isIdle === false` — matching the semantics
 * above.
 *
 * No-op notify guard: if the value is unchanged AND the key was already
 * present in the map, we skip the notify. Distinguishes "never published"
 * (has=false) from "explicitly null" (has=true, value=null) so a first-time
 * null publish still fires (React might be observing the key).
 */
export function publishSessionWorking(
  key: string,
  isWorking: boolean | null,
): void {
  const has = state.map.has(key);
  const prev = state.map.get(key) ?? null;
  if (has && prev === isWorking) return; // no-op — do not notify
  const nextMap = new Map(state.map);
  nextMap.set(key, isWorking);
  state = { map: nextMap };
  notify();
}

/**
 * Hook: subscribe to the working state for a single key. Returns:
 *   - `null` when key is null (short-circuit — no useSyncExternalStore work).
 *   - `null` when the key has never been published.
 *   - the stored `boolean | null` otherwise.
 */
export function useSessionWorking(key: string | null): boolean | null {
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
export function getSessionWorkingSnapshot(): ReadonlyMap<
  string,
  boolean | null
> {
  return state.map;
}

// ─── Test-only helpers ───────────────────────────────────────────────────────

/**
 * Reset the store to an empty Map + bump version + notify. Used by
 * session-working-store.test.ts's `beforeEach` so each test starts from a
 * known-empty state. NOT a public API.
 */
export function __resetForTest(): void {
  state = { map: new Map<string, boolean | null>() };
  notify();
}
