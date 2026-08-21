// ─── Session queue-pending-state store (quick-260802-w9e) ────────────────────
// Phase 53 Plan 03 (2026-08-21): the client-side recycling bridge store was
// retired and deleted. This queue-pending store remains as-is — queue-pending
// state genuinely doesn't survive the pretty-view's own X-minute cleanup; the
// client is the only source that knows whether the queue is still armed
// (per Phase 53 CONTEXT.md § Prior context).
//
// Module-scoped in-memory store for per-(host, tmuxSession) "does this
// ComposeBox currently have at least one queued message armed to auto-send
// on the next agent-idle window" state. Fed exclusively by ComposeBox.tsx's
// `queue` state (the Vehicle C v2 armed-for-idle FIFO at ComposeBox.tsx:358);
// consumed by PrettyConversationsPanel / PrettyConversationRow to suppress
// the patch #137 "ready-for-attention" dot when the row's session has a
// queued message waiting. Row-level dot gate becomes
// `inActiveSet === true && isWorking === false && !isRecycling && !hasQueuePending`.
//
// RATIONALE (verbatim from bounty `hide-idle-dot-when-queued-message-waiting-to-send`):
// if a queued message is armed to auto-send the moment the agent goes idle,
// the agent is effectively already spoken-for and NOT ready for Ashley's
// next instruction (which IS the meaning of the dot). Extends the patch #137
// dot predicate with a fourth gate to correct dot semantics from "not
// currently working" to the true "ready for next instruction."
//
// Semantics per this bounty:
//   - `true`  = ComposeBox for this key has at least one entry in its `queue`
//               (armed-for-idle) state.
//   - `false` = queue is empty OR key has never been published (see hook).
//
// Store type is `Map<string, boolean>` (NOT `Map<string, boolean | null>` like
// session-working-store). There is no "unknown"
// middle state here: ComposeBox is the SOLE publisher and always knows the
// state of its own queue. `false` is the safe default: "we don't know if
// there's a queue → let the dot render" is the correct behavior (the row's
// dot is opt-in-suppressed by the fourth gate; absence of a publisher means
// nothing suppresses).
//
// Key shape `${hostId}:${tmuxSession ?? ""}` is IDENTICAL to sessionWorkingKey()
// at src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:95-98
// so consumers can look up either store with the same string. Same shape as
// session-working-store — the two stores
// deliberately share the key so a single row-level string subscribes to all
// signals.
//
// Storage layer: NONE. This is an in-memory Map<string, boolean> only.
// Deliberately NOT persisted to any browser storage layer — a page refresh
// resets the store to empty; the very next queue mutation from each mounted
// ComposeBox.tsx will re-populate. Cross-tab isolation is a side benefit.
//
// Publishing `false` OVERWRITES to `false` (does NOT delete the key). Same
// rationale as session-working-store: a re-mount
// observing `false` after a known transition is semantically correct; the
// row should treat "no queue pending" rather than fall back to a stale
// prior value.
//
// Store pattern mirrors src/ui/state/session-working-store.ts (patch #137)
// verbatim: module-scoped `state` object with a Map + Set<() => void>
// listener registry + snapshotVersion counter; notify() bumps + iterates;
// subscribe() returns disposer. No zustand / jotai / redux — the fork rolls
// its own.

import { useSyncExternalStore } from "react";

// ─── Module-scoped state ─────────────────────────────────────────────────────

type State = {
  map: Map<string, boolean>;
};

let state: State = {
  map: new Map<string, boolean>(),
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
 * Publish the current queue-pending state (any armed idle-send messages?) for
 * a (host, tmuxSession) key. Called by ComposeBox.tsx from a useEffect on
 * `[queue, sessionKey]` with `queue.length > 0` — matching the semantics
 * above.
 *
 * No-op notify guard: if the value is unchanged AND the key was already
 * present in the map, we skip the notify. Same shape as
 * publishSessionWorking's guard. Distinguishes "never published" (has=false)
 * from "explicitly false" (has=true, value=false) so a first-time false
 * publish still fires (React might be observing the key).
 */
export function publishSessionQueuePending(
  key: string,
  hasPending: boolean,
): void {
  const has = state.map.has(key);
  const prev = state.map.get(key);
  if (has && prev === hasPending) return; // no-op — do not notify
  const nextMap = new Map(state.map);
  nextMap.set(key, hasPending);
  state = { map: nextMap };
  notify();
}

/**
 * Hook: subscribe to the queue-pending state for a single key. Returns:
 *   - `false` when key is null (short-circuit — no useSyncExternalStore work).
 *   - `false` when the key has never been published.
 *   - the stored `boolean` otherwise.
 *
 * `false` is the safe default: "we don't know if there's a queue → let the
 * dot render" — the row-level fourth gate is `!hasQueuePending`, so a `false`
 * return correctly does NOT suppress the dot.
 */
export function useSessionQueuePending(key: string | null): boolean {
  // Compute closures unconditionally so the hook is always called at the same
  // top-level position in the caller — Rules-of-Hooks compliance. The
  // getSnapshot closure short-circuits internally when key is null.
  const getSnapshot = (): boolean => {
    if (key === null) return false;
    const v = state.map.get(key);
    return v === undefined ? false : v;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Test-only: return the raw internal Map as a ReadonlyMap view. NOT for
 * production callers. Kept exported (rather than gated on
 * `import.meta.env.MODE === "test"`) because Vite's tree-shaker will drop it
 * from the production bundle if no production code imports it.
 */
export function getSessionQueuePendingSnapshot(): ReadonlyMap<string, boolean> {
  return state.map;
}

// ─── Test-only helpers ───────────────────────────────────────────────────────

/**
 * Reset the store to an empty Map + bump version + notify. Used by
 * session-queue-pending-store.test.ts's `beforeEach` so each test starts from
 * a known-empty state. NOT a public API.
 */
export function __resetForTest(): void {
  state = { map: new Map<string, boolean>() };
  notify();
}
