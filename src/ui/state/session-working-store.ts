// ─── Session working-state store (Phase 34 Plan 06 — fleet-status cutover) ───
// Module-scoped in-memory store for per-(host, tmuxSession) "is the session
// working?" composite state. Sourced exclusively from the fleet-status
// WebSocket channel (the backend-authoritative signal). Two old feeders
// (PTY-idle from Terminal.tsx + backgrounded-work from PrettyView.tsx)
// were REMOVED in Plan 06 — see 34-06-SUMMARY.md for the retired symbols.
//
// Composite formula:
//   main      = status === "busy"
//   waiting   = status === "waiting"   // separate axis — NOT working, bubble-only
//   bg        = backgroundTasks.length > 0
//   isWorking = main || bg
//
// The ambient filter runs at the WATCHER (Plan 04), not here. By the time
// SessionState arrives at the browser, backgroundTasks[] is already
// ambient-filtered — every entry is non-ambient work.
//
// Deviates from Phase 34 D-CTX which had `main = busy || shell`. Empirically
// the harness reports `status: "shell"` whenever ANY local tool execution is
// active, which includes persistent Monitors (the fleet's ambient recv /
// wakeup / ctxwatch). That kept every session permanently `shell` → WIP
// always on + dot never showing. Filtering-out-ambient at the bg axis is not
// enough; shell has to leave `main` entirely. Genuine backgrounded work is
// still captured via `bg` (post-filter). See bounty
// phase-39-uat-regression-wip-always-on-idle-dot-missing for evidence.
//
// Internal state shape: Map<string, { isWorking: boolean }>
// Key format: `${hostId}:${tmuxSession ?? ""}` — unchanged convention.
//
// Per-key no-op notify guard: if the new isWorking === existing isWorking AND
// the key already exists, skip notify. First-time publish always notifies.
//
// publishFleetStatusSessionGone: deletes the key from the map and notifies.
// Unlike publishFleetStatusSessionState, gone always notifies (deletion is
// always a change).
//
// Storage layer: NONE. In-memory Map only. A page refresh resets the store;
// the fleet-status WS snapshot on re-connect repopulates all keys.
//
// Store pattern mirrors src/ui/state/conversation-store.ts: module-scoped
// `state` object + Map + Set<() => void> listener registry + snapshotVersion
// counter; notify() bumps + iterates; subscribe() returns disposer.

import { useSyncExternalStore } from "react";
import type { SessionState } from "../api/fleet-status-types.js";

// ─── Module-scoped state ─────────────────────────────────────────────────────

type WorkingRecord = {
  isWorking: boolean;
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
 * Publish a new or updated SessionState from the fleet-status channel.
 * Computes isWorking from the D-CTX composite formula and updates the map.
 *
 * Per-key no-op notify guard: if isWorking is unchanged AND the key already
 * exists in the map, skip notify. This prevents spurious re-renders when the
 * backend sends repeated frames with identical effective states.
 *
 * Structured logging: logs every state transition at the hostId + tmuxSession
 * level so dot regressions can be traced through the browser console.
 * Per T-34-20 (Repudiation mitigation).
 */
export function publishFleetStatusSessionState(
  hostId: string,
  state_arg: SessionState,
): void {
  const key = `${hostId}:${state_arg.tmuxSession ?? ""}`;

  const main = state_arg.status === "busy";
  const bg = state_arg.backgroundTasks.length > 0;
  const isWorking = main || bg;

  const existing = state.map.get(key);
  if (existing !== undefined && existing.isWorking === isWorking) {
    // No-op: effective working state unchanged — skip notify to prevent
    // spurious re-renders. Log at trace level only.
    return;
  }

  console.info({
    operation: "fleet_status_working_state_change",
    hostId,
    tmuxSession: state_arg.tmuxSession,
    sessionId: state_arg.sessionId,
    status: state_arg.status,
    backgroundTaskCount: state_arg.backgroundTasks.length,
    isWorking,
    previous: existing?.isWorking ?? null,
  });

  const nextMap = new Map(state.map);
  nextMap.set(key, { isWorking });
  state = { map: nextMap };
  notify();
}

/**
 * Mark a session as gone (session ended or watcher lost track of it).
 * Deletes the key from the map and notifies subscribers so the dot
 * clears immediately. If the key does not exist, this is a no-op
 * (prevents double-delete churn from watcher restart cycles — mirrors
 * the server-side SubscriptionRegistry.publishSessionGone behavior).
 */
export function publishFleetStatusSessionGone(
  hostId: string,
  tmuxSession: string | null,
  sessionId: string,
): void {
  const key = `${hostId}:${tmuxSession ?? ""}`;
  if (!state.map.has(key)) return; // no-op

  console.info({
    operation: "fleet_status_session_gone",
    hostId,
    tmuxSession,
    sessionId,
    key,
  });

  const nextMap = new Map(state.map);
  nextMap.delete(key);
  state = { map: nextMap };
  notify();
}

/**
 * Hook: derive "is this session working?" for a single key.
 * Returns a plain boolean.
 *
 *   - Null key → false (short-circuit; no useSyncExternalStore work).
 *   - Unknown key → false (key never published — suppress dot until first frame).
 *   - isWorking === false (idle, no bg work, or waiting) → false.
 *   - isWorking === true (busy, shell, or bg work present) → true.
 *
 * NOTE: waiting status returns FALSE — waiting is a SEPARATE axis from
 * working. The WaitingBubble (session-waiting-store) handles the waiting
 * axis. Per D-CTX § Composite state (LOCKED).
 */
export function useSessionIsWorking(key: string | null): boolean {
  const getSnapshot = (): boolean => {
    if (key === null) return false;
    const record = state.map.get(key);
    if (record === undefined) return false;
    return record.isWorking;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Return the raw internal Map as a ReadonlyMap view.
 * NOT for production callers. Kept exported (rather than gated on
 * import.meta.env.MODE === "test") because Vite's tree-shaker drops it from
 * the production bundle if no production code imports it.
 */
export function getSessionWorkingSnapshot(): ReadonlyMap<
  string,
  { isWorking: boolean }
> {
  return state.map;
}

// Unused variable reference to suppress TypeScript "declared but never read"
// for snapshotVersion if nothing else uses it. The notify() caller bumps it.
void snapshotVersion;

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
