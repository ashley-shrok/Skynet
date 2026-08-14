// ─── Session tmux-name store (Phase 41 Plan 01) ──────────────────────────────
// Module-scoped in-memory store for per-(hostId, tmuxSession) tmux session
// name lookup. Sourced exclusively from the fleet-status WebSocket channel
// (AppShell's onSnapshot / onUpdate / onGone callbacks). Mirrors
// session-working-store.ts pattern VERBATIM in structure.
//
// Purpose: allows AppShell's document.title effect (and future callers) to
// resolve the tmux session name for a given (hostId, tmuxSession) key without
// requiring Terminal to be mounted. The `SessionState.tmuxSession` field is
// ALREADY on the fleet-status wire — no backend changes are needed.
//
// Internal state shape: Map<string, { tmuxSession: string }>
// Key format: `${hostId}:${tmuxSession}` — same convention as
//   session-working-store.ts. The null-tmuxSession bucket (`${hostId}:`) is
//   never populated (publishFleetStatusTmuxSession no-ops when tmuxSession is
//   null — an empty bucket carries no useful name).
//
// Per-key no-op notify guard: if the new tmuxSession value === existing value
// AND the key already exists, skip notify. First-time publish always notifies.
//
// publishFleetStatusTmuxSessionGone: deletes the key if present (mirrors
// publishFleetStatusSessionGone no-op-on-absent behavior).
//
// Storage layer: NONE. In-memory Map only. A page refresh resets the store;
// the fleet-status WS snapshot on re-connect repopulates all keys.
//
// Threat model: T-41-01 (Tampering — tmuxSession field already zod-validated
// at fleet-status backend egress), T-41-02 (Info Disclosure — in-memory only,
// page refresh clears), T-41-03 (DoS — per-key no-op notify guard prevents
// churn), T-41-04 (Repudiation — structured console.info on every transition).

import { useSyncExternalStore } from "react";

// ─── Module-scoped state ─────────────────────────────────────────────────────

type TmuxRecord = {
  tmuxSession: string;
};

type State = {
  map: Map<string, TmuxRecord>;
};

let state: State = {
  map: new Map<string, TmuxRecord>(),
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
 * Publish the tmux session name for a (hostId, tmuxSession) pair.
 * Called by AppShell's fleet-status client inside onSnapshot and onUpdate.
 *
 * Key = `${hostId}:${tmuxSession}`.
 *
 * When tmuxSession is null this is a NO-OP — the null-tmux bucket carries no
 * useful name; only real named sessions get an entry (mirrors the established
 * convention in session-working-store where null tmuxSession maps to the empty
 * key suffix `${hostId}:` — here we simply skip entirely).
 *
 * Per-key no-op notify guard: if the stored tmuxSession name is identical to
 * the incoming value, skip notify. Prevents notify storm from re-emitted
 * identical frames (T-41-03 mitigation).
 *
 * Structured logging per fleet directive 2026-08-11 (T-41-04 mitigation).
 */
export function publishFleetStatusTmuxSession(
  hostId: string,
  tmuxSession: string | null,
): void {
  if (tmuxSession === null) {
    // No-op: null tmux session name is not a useful key.
    return;
  }

  const key = `${hostId}:${tmuxSession}`;
  const existing = state.map.get(key);

  if (existing !== undefined && existing.tmuxSession === tmuxSession) {
    // No-op: identical value already stored — skip notify.
    return;
  }

  console.info({
    operation: "fleet_status_tmux_publish",
    hostId,
    tmuxSession,
    key,
    previous: existing?.tmuxSession ?? null,
  });

  const nextMap = new Map(state.map);
  nextMap.set(key, { tmuxSession });
  state = { map: nextMap };
  notify();
}

/**
 * Remove the tmux session entry for a (hostId, tmuxSession) pair.
 * Called by AppShell's fleet-status client inside onGone.
 *
 * No-op if:
 *   - tmuxSession is null (no null-key entries to delete).
 *   - The key does not exist in the map (prevents double-delete churn).
 *
 * Structured logging per fleet directive 2026-08-11 (T-41-04 mitigation).
 */
export function publishFleetStatusTmuxSessionGone(
  hostId: string,
  tmuxSession: string | null,
): void {
  if (tmuxSession === null) return;

  const key = `${hostId}:${tmuxSession}`;
  if (!state.map.has(key)) return; // no-op: already absent

  console.info({
    operation: "fleet_status_tmux_gone",
    hostId,
    tmuxSession,
    key,
  });

  const nextMap = new Map(state.map);
  nextMap.delete(key);
  state = { map: nextMap };
  notify();
}

/**
 * Hook: return the tmux session name for the given key, or null if absent.
 *
 *   - Null key     → null (short-circuit; no useSyncExternalStore work).
 *   - Unknown key  → null (key never published or already gone).
 *   - Known key    → the stored tmuxSession string.
 *
 * Uses useSyncExternalStore with server snapshot === client snapshot (same
 * pattern as session-working-store — SSR-safe, no hydration mismatch).
 */
export function useSessionTmuxName(key: string | null): string | null {
  const getSnapshot = (): string | null => {
    if (key === null) return null;
    const record = state.map.get(key);
    if (record === undefined) return null;
    return record.tmuxSession;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Return the raw internal Map as a ReadonlyMap view.
 * NOT for production callers. Kept exported (not gated on import.meta.env)
 * because Vite's tree-shaker drops it from the production bundle when no
 * production code imports it. Mirrors getSessionWorkingSnapshot.
 */
export function getSessionTmuxSnapshot(): ReadonlyMap<
  string,
  { tmuxSession: string }
> {
  return state.map;
}

// Unused variable reference to suppress TypeScript "declared but never read"
// for snapshotVersion if nothing else uses it.
void snapshotVersion;

// ─── Test-only helpers ───────────────────────────────────────────────────────

/**
 * Reset the store to an empty Map + bump version + notify. Used by
 * session-tmux-store.test.ts's `beforeEach` so each test starts from a
 * known-empty state. NOT a public API.
 */
export function __resetForTest(): void {
  state = { map: new Map<string, TmuxRecord>() };
  notify();
}
