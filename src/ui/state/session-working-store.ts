// ─── Session working-state store (patch #137, extended patch #260806-ixl) ─────
// Module-scoped in-memory store for per-(host, tmuxSession) "is the session
// working?" composite state. Fed by Terminal.tsx (PTY idle signal → ttyBusy)
// and PrettyView.tsx (backgrounded_agents / backgrounded_shells WS frames →
// hasBgWork). Consumed by PrettyConversationsPanel (row ready-dot) and
// PrettyView (WipBubble mount) via the shared `useSessionIsWorking` hook.
//
// Composite shape: Map<string, { ttyBusy: boolean | null; hasBgWork: boolean }>
//
//   - `ttyBusy: null`  = PTY state unknown; no idle frame observed yet. Hook
//                        treats null as not-working ("unknown → suppress dot").
//   - `ttyBusy: true`  = PTY is busy (isIdle === false) — agent working.
//   - `ttyBusy: false` = PTY is idle (isIdle === true) — agent idle.
//   - `hasBgWork: true` = at least one backgrounded agent OR shell is live.
//   - `hasBgWork: false` = no backgrounded work (default).
//
// Derivation: `isWorking = ttyBusy === true || hasBgWork`.
// A session with an idle PTY BUT backgrounded work → isWorking = true.
// A session with a busy PTY AND no backgrounded work → isWorking = true.
// A session with null ttyBusy AND no backgrounded work → isWorking = false
// (suppress dot, same as original "suppress until first frame" behavior).
//
// Storage layer: NONE. In-memory Map only. Deliberately NOT persisted —
// a page refresh resets the store; the very next isIdle emit from each
// mounted Terminal.tsx re-populates ttyBusy, and the next WS frame re-
// populates hasBgWork. Cross-tab isolation is a side benefit.
//
// Publishing null ttyBusy OVERWRITES to null (does NOT delete the key). The
// same "overwrite, not delete" rationale applies to hasBgWork: publishing
// false after a true does NOT remove the key — the composite record persists.
//
// Per-field no-op notify guard: if the target FIELD is unchanged AND the key
// already existed in the map, we skip the notify. This is truly per-field —
// an intervening publish to the OTHER field does NOT reset the guard for the
// unchanged field. First-time publish of any value (key not yet in map) always
// notifies (React may be observing the key).
//
// Store pattern mirrors src/ui/state/conversation-store.ts verbatim: module-
// scoped `state` object with a Map + Set<() => void> listener registry +
// snapshotVersion counter; notify() bumps + iterates; subscribe() returns
// disposer. No zustand / jotai / redux — the fork rolls its own.

import { useSyncExternalStore } from "react";

// ─── Module-scoped state ─────────────────────────────────────────────────────

type WorkingRecord = {
  ttyBusy: boolean | null;
  hasBgWork: boolean;
};

type State = {
  map: Map<string, WorkingRecord>;
};

let state: State = {
  map: new Map<string, WorkingRecord>(),
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
 * Publish the PTY-side busy state for a (host, tmuxSession) key. Called by
 * Terminal.tsx from a useEffect on `[isIdle, hostConfig.id, tmuxSessionName]`
 * with `isIdle === null ? null : isIdle === false`.
 *
 * Per-field no-op notify guard: if ttyBusy is unchanged AND the key already
 * existed in the map, skip notify. An intervening hasBgWork publish to the
 * SAME key does NOT reset this guard — the field check is truly independent.
 * First-time publish (key not yet present) always notifies.
 */
export function publishSessionTtyBusy(
  key: string,
  ttyBusy: boolean | null,
): void {
  const existing = state.map.get(key);
  if (existing !== undefined && existing.ttyBusy === ttyBusy) return; // no-op
  const nextRecord: WorkingRecord = existing
    ? { ...existing, ttyBusy }
    : { ttyBusy, hasBgWork: false };
  const nextMap = new Map(state.map);
  nextMap.set(key, nextRecord);
  state = { map: nextMap };
  notify();
}

/**
 * Publish whether this session has any backgrounded work (agents or shells).
 * Called by PrettyView.tsx on every `backgrounded_agents` / `backgrounded_shells`
 * WS frame and on both reset paths (fresh-pane mount, session_changed).
 *
 * Per-field no-op notify guard: if hasBgWork is unchanged AND the key already
 * existed in the map, skip notify. An intervening ttyBusy publish does NOT
 * reset this guard.
 */
export function publishSessionHasBackgroundedWork(
  key: string,
  hasBgWork: boolean,
): void {
  const existing = state.map.get(key);
  if (existing !== undefined && existing.hasBgWork === hasBgWork) return; // no-op
  const nextRecord: WorkingRecord = existing
    ? { ...existing, hasBgWork }
    : { ttyBusy: null, hasBgWork };
  const nextMap = new Map(state.map);
  nextMap.set(key, nextRecord);
  state = { map: nextMap };
  notify();
}

/**
 * Hook: derive "is this session working?" for a single key. Returns a plain
 * boolean — true if ttyBusy === true OR hasBgWork is true, false otherwise.
 *
 *   - Null key → false (short-circuit; no useSyncExternalStore work).
 *   - Unknown key → false (key never published — same "suppress dot" default).
 *   - ttyBusy === null + hasBgWork === false → false ("unknown PTY, no bg
 *     work" — preserve the original "suppress ready-dot until first idle
 *     frame" behavior; the backend hasn't spoken yet).
 *   - ttyBusy === null + hasBgWork === true → true (backgrounded work alone
 *     dominates the unknown PTY state — WipBubble mounts, dot suppressed).
 */
export function useSessionIsWorking(key: string | null): boolean {
  const getSnapshot = (): boolean => {
    if (key === null) return false;
    const record = state.map.get(key);
    if (record === undefined) return false;
    return record.ttyBusy === true || record.hasBgWork;
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
  { ttyBusy: boolean | null; hasBgWork: boolean }
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
  state = { map: new Map<string, WorkingRecord>() };
  notify();
}
