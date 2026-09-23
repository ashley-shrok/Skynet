// ─── Skew-lock store (Phase 111 Plan 02) ────────────────────────────────────
//
// Shell-level version-drift lock state. When any client-side lane (axios
// response interceptor, WS handshake close-code observer, WS-message tag
// checker) detects that the running browser bundle no longer matches the
// server it is talking to, it calls `lockSkewedSession(...)` and the shell
// transitions to a locked state that is never recovered from within the
// tab's lifetime — the only path forward is a hard reload via the
// SkewLockModal.
//
// Consumers (across Wave 1):
//   - src/ui/main-axios.ts response interceptor  (Plan 04)
//   - src/ui/api/claude-session-api.ts           (Plan 06)
//   - src/ui/api/fleet-status-client.ts          (Plan 06)
//   - src/ui/features/pretty-view/…/relay*       (Plan 06)
//   - src/ui/features/terminal/Terminal.tsx      (Plan 06)
//
// Store follows Skynet's roll-your-own convention documented at
// src/ui/state/session-queue-pending-store.ts:58:
//   "subscribe() returns disposer. No zustand / jotai / redux — the fork
//    rolls its own."
//
// Semantics (per Phase 111 CONTEXT.md D-11 through D-14):
//   - Idempotent: first drift signal wins. Subsequent `lockSkewedSession`
//     calls are no-ops (no state mutation, no listener notify) so a burst
//     of concurrent drift signals (interceptor + WS-message + WS-close all
//     tripping at the same instant) doesn't produce a notify storm or
//     overwrite the diagnostic `reason`/`clientBuild`/`serverBuild` fields
//     with a later-arriving lane's values.
//   - Snapshot reference stability: `getSkewLockedSnapshot()` returns the
//     same object reference across calls until a mutation happens.
//     `useSyncExternalStore` compares snapshot references by identity, so
//     returning a fresh object every call would trigger infinite re-renders.
//   - Structured logging on transition: single console.warn with explicit
//     fields — no serialization of DOM Event objects per role-file directive.

// ─── Types ───────────────────────────────────────────────────────────────────

export type LockReason =
  | "response_tag_mismatch"
  | "server_refused_stale_client"
  | "ws_handshake_mismatch"
  | "ws_message_tag_mismatch";

export interface LockState {
  locked: boolean;
  reason: LockReason | null;
  clientBuild: string | null;
  serverBuild: string | null;
  lockedAt: number | null;
}

// ─── Module-scoped state ─────────────────────────────────────────────────────

const initialState: LockState = {
  locked: false,
  reason: null,
  clientBuild: null,
  serverBuild: null,
  lockedAt: null,
};

let state: LockState = initialState;

const listeners = new Set<() => void>();

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the current lock snapshot. Reference-stable across calls until a
 * mutation — required by useSyncExternalStore's snapshot identity contract.
 */
export function getSkewLockedSnapshot(): LockState {
  return state;
}

/**
 * Subscribe to lock-transition notifications. The returned disposer detaches
 * the listener when called. Listeners are notified EXACTLY ONCE (on the very
 * first transition to `locked = true`) — subsequent idempotent calls to
 * `lockSkewedSession` do NOT fire the notify.
 */
export function subscribeSkewLock(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Transition the shell into locked state. Idempotent: the first call wins
 * (diagnostic `reason`/`clientBuild`/`serverBuild` fields reflect the first
 * lane that detected drift; subsequent calls are no-ops).
 *
 * On the first call:
 *   - `state` mutates to a fresh immutable object (snapshot identity changes)
 *   - `lockedAt` = Date.now()
 *   - one structured console.warn is emitted with explicit-field extraction
 *     per the role-file structured-logging directive
 *   - every registered listener is invoked exactly once
 *
 * On subsequent calls: return immediately without touching state or
 * listeners.
 */
export function lockSkewedSession(args: {
  reason: LockReason;
  clientBuild: string;
  serverBuild: string;
}): void {
  if (state.locked) return; // idempotent — first-drift-wins

  const lockedAt = Date.now();
  state = {
    locked: true,
    reason: args.reason,
    clientBuild: args.clientBuild,
    serverBuild: args.serverBuild,
    lockedAt,
  };

  // Structured log per role-file directive: explicit-field extraction.
  // Lifecycle boundary — no DOM Event objects touch the log payload.
  console.warn("[skew-lock] activated", {
    operation: "skew_lock_activated",
    reason: args.reason,
    clientBuild: args.clientBuild,
    serverBuild: args.serverBuild,
    lockedAt,
  });

  for (const fn of listeners) fn();
}

// ─── Test-only helpers ───────────────────────────────────────────────────────

/**
 * Reset store to initial state and clear the listener set. Guarded on
 * NODE_ENV === "test" so a bundled production build can't accidentally
 * reset the lock via a rogue call. Vitest sets NODE_ENV="test" by default.
 */
export function __resetForTest(): void {
  if (process.env.NODE_ENV !== "test") return;
  state = initialState;
  listeners.clear();
}
