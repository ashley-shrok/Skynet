/**
 * fleet-status-client.ts — browser-side WebSocket client for /fleet-status/ws
 *
 * Phase 34 Plan 06: boot-time singleton owned by AppShell. Parses
 * snapshot/update/gone frames from the fleet-status backend and dispatches
 * them to session-working-store + session-waiting-store via callbacks.
 *
 * Reconnect pattern: mirrors the patch #148 backoff from PrettyView.tsx
 * (proven in production). Backoff schedule: 2s, 4s, 6s, 8s, 8s (≈28s total).
 * After MAX_RECONNECT_ATTEMPTS closes without a successful open, gives up and
 * logs `operation: 'fleet_status_client_gave_up'`.
 *
 * Structured logging: console.info / console.warn with the same structured-fields
 * shape as the backend's systemLogger, grep-discoverable by `operation:` key.
 * NEVER serialize DOM Event objects via JSON.stringify — always extract fields explicitly.
 * Per T-34-20 (Repudiation mitigation) and the structured logging directive.
 *
 * Security (T-34-18 — Tampering):
 *   JSON.parse wrapped in try/catch. Malformed frames log + drop; connection
 *   stays open. The backend validates outbound frames via zod; the browser
 *   trusts contents but never lets a parse error crash the client.
 */

import { useSyncExternalStore } from "react";
import type {
  FrontendOutboundFrame,
  SessionState,
} from "./fleet-status-types.js";
import { FRAME_SCHEMA_VERSION } from "./fleet-status-types.js";

// ---------------------------------------------------------------------------
// Constants — mirror patch #148 backoff schedule verbatim
// ---------------------------------------------------------------------------

const MAX_RECONNECT_ATTEMPTS = 5;
const BACKOFF_SCHEDULE_MS = [2000, 4000, 6000, 8000, 8000] as const;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface FleetStatusClientOptions {
  url: string;
  onSnapshot: (states: SessionState[]) => void;
  onUpdate: (state: SessionState) => void;
  onGone: (hostId: string, tmuxSession: string | null, sessionId: string) => void;
}

export interface FleetStatusClient {
  dispose: () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fleet-status WebSocket client. Opens immediately and reconnects on
 * drop. Call `dispose()` on AppShell unmount to cancel timers and close the
 * socket cleanly.
 */
export function createFleetStatusClient(
  opts: FleetStatusClientOptions,
): FleetStatusClient {
  const { url, onSnapshot, onUpdate, onGone } = opts;

  let reconnectAttempts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let ws: WebSocket | null = null;
  let disposed = false;

  function connect(): void {
    if (disposed) return;

    console.info({
      operation: "fleet_status_client_connecting",
      url,
      attempt: reconnectAttempts,
    });

    ws = new WebSocket(url);

    ws.onopen = () => {
      if (disposed) {
        ws?.close();
        return;
      }
      console.info({
        operation: "fleet_status_client_open",
        url,
      });
      // Reset attempt counter on successful open — fresh budget for next drop.
      reconnectAttempts = 0;
      // Send subscribe frame per wire protocol
      try {
        ws!.send(
          JSON.stringify({
            schemaVersion: FRAME_SCHEMA_VERSION,
            type: "subscribe",
          }),
        );
      } catch (err) {
        console.warn({
          operation: "fleet_status_client_send_error",
          url,
          errMessage: err instanceof Error ? err.message : String(err),
        });
      }
    };

    ws.onmessage = (evt: MessageEvent) => {
      if (disposed) return;

      let parsed: FrontendOutboundFrame;
      try {
        parsed = JSON.parse(evt.data) as FrontendOutboundFrame;
      } catch (err) {
        console.warn({
          operation: "fleet_status_client_parse_error",
          url,
          errMessage: err instanceof Error ? err.message : String(err),
        });
        return; // drop malformed frame; connection stays open (T-34-18)
      }

      // Discriminated-union dispatch on frame type
      switch (parsed.type) {
        case "snapshot":
          console.info({
            operation: "fleet_status_client_snapshot",
            url,
            stateCount: parsed.states.length,
          });
          // Phase 90 Plan 00 Wave 0 (D-10 delivery mechanism, Ashley
          // 2026-09-08 D-03 waiver): publish per-session contextPct into
          // the co-located store so useSessionContextPct consumers
          // (PrettyView post-swap, future relay-pane badge appendage)
          // re-render on the very next snapshot with fresh values. The
          // user's onSnapshot callback fires AFTER — matches the existing
          // ordering discipline in AppShell where session-working-store,
          // session-waiting-store, session-tmux-store all publish first.
          for (const s of parsed.states) {
            publishSessionContextPct(s.hostId, s.tmuxSession, s.contextPct ?? null);
          }
          onSnapshot(parsed.states);
          break;
        case "update":
          console.info({
            operation: "fleet_status_client_update",
            url,
            hostId: parsed.state.hostId,
            tmuxSession: parsed.state.tmuxSession,
            sessionId: parsed.state.sessionId,
            status: parsed.state.status,
          });
          publishSessionContextPct(
            parsed.state.hostId,
            parsed.state.tmuxSession,
            parsed.state.contextPct ?? null,
          );
          onUpdate(parsed.state);
          break;
        case "gone":
          console.info({
            operation: "fleet_status_client_gone",
            url,
            hostId: parsed.hostId,
            tmuxSession: parsed.tmuxSession,
            sessionId: parsed.sessionId,
          });
          // Clean up the contextPct entry so a session-not-in-fleet returns
          // null on the hook (D-10 correctness — no stale reading).
          publishSessionContextPctGone(parsed.hostId, parsed.tmuxSession);
          onGone(parsed.hostId, parsed.tmuxSession, parsed.sessionId);
          break;
        case "pong":
          // No-op — keepalive reply
          break;
        default:
          // Unknown frame type — drop silently (forward-compatible)
          break;
      }
    };

    ws.onerror = () => {
      if (disposed) return;
      // The WS `error` event carries no useful cross-browser details.
      // The subsequent onclose event handles retry scheduling.
      console.warn({
        operation: "fleet_status_client_error",
        url,
        // Never log the event object — extract fields only (T-34-20)
        note: "error event received; onclose will handle retry",
      });
    };

    ws.onclose = (evt: CloseEvent) => {
      if (disposed) return;
      ws = null;

      console.info({
        operation: "fleet_status_client_close",
        url,
        code: evt.code,
        reason: evt.reason,
        attempt: reconnectAttempts,
      });

      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn({
          operation: "fleet_status_client_gave_up",
          url,
          totalAttempts: reconnectAttempts,
        });
        return;
      }

      // R-54-07: full-jitter — uniform random draw in [0, capMs) prevents 10-tab restore from re-clumping the herd on the reconnect ladder.
      const capMs = BACKOFF_SCHEDULE_MS[
        Math.min(reconnectAttempts, BACKOFF_SCHEDULE_MS.length - 1)
      ];
      const delayMs = Math.floor(Math.random() * capMs);
      reconnectAttempts += 1;

      console.info({
        operation: "fleet_status_client_retry_scheduled",
        url,
        delayMs,
        attempt: reconnectAttempts,
      });

      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delayMs);
    };
  }

  // Open immediately
  connect();

  return {
    dispose(): void {
      disposed = true;

      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }

      if (ws !== null) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        ws = null;
      }

      console.info({
        operation: "fleet_status_client_disposed",
        url,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Phase 90 Plan 00 Wave 0 (D-10 delivery mechanism, Ashley 2026-09-08 D-03
// waiver) — per-session contextPct store + useSessionContextPct hook.
//
// Co-located here rather than in a peer state module because contextPct only
// flows in one direction (fleet-status → hook consumers), the publish side is
// wired implicitly by createFleetStatusClient (no AppShell change needed for
// this axis alone), and the store has a single axis (unlike session-working-
// store's multi-axis composite). Same useSyncExternalStore + module-scoped
// Map + Set<() => void> listener registry pattern as
// src/ui/state/session-working-store.ts.
//
// KEY FORMAT: `${hostId}:${tmuxSession ?? ""}` — matches the backend
// contextpct-store.ts and the frontend session-working-store convention.
// This is the D-10 correctness invariant — both PrettyView (post D-03
// mechanical swap) and the future Plan 06 relay-pane badge appendage MUST
// build the key with the SAME shape.
//
// CONSUMED BY:
//   - PrettyView.tsx (post D-03 mechanical waiver): replaces the local
//     `useState<number | null>(null)` at L570 with
//     `useSessionContextPct(hostId, tmuxSession ?? "")`. The WS
//     `context_pct` handler at L2269 becomes a no-op (backend still emits
//     for backwards compat; the frontend no longer reads it there).
//   - AgentBadgeWithMeter (src/ui/features/pretty-view/AgentBadgeWithMeter.tsx per Phase 93): reads the SAME hook so the
//     same agent viewed on either surface shows identical values.
// ---------------------------------------------------------------------------

const contextPctStore = new Map<string, number | null>();
const contextPctListeners = new Set<() => void>();

function contextPctKey(hostId: string, tmuxSession: string | null): string {
  return `${hostId}:${tmuxSession ?? ""}`;
}

function notifyContextPctListeners(): void {
  for (const cb of contextPctListeners) cb();
}

/**
 * Publish a contextPct value for a (hostId, tmuxSession) pair. Called
 * internally by createFleetStatusClient on every snapshot + update frame.
 * Skips notify when the value is unchanged for the key (no-op guard prevents
 * spurious re-renders on repeated identical frames). Explicit null is a
 * valid value (dormant sentinel / no reading yet).
 */
function publishSessionContextPct(
  hostId: string,
  tmuxSession: string | null,
  pct: number | null,
): void {
  const key = contextPctKey(hostId, tmuxSession);
  const existing = contextPctStore.get(key);
  // No-op guard: only notify on actual change. Object.is handles null
  // identity correctly and treats 0 as not-equal to -0 (harmless here).
  if (contextPctStore.has(key) && Object.is(existing, pct)) return;
  contextPctStore.set(key, pct);
  notifyContextPctListeners();
}

/**
 * Remove the contextPct entry for a (hostId, tmuxSession) pair. Called
 * internally by createFleetStatusClient on every `gone` frame so a session
 * that leaves the fleet no longer serves stale readings.
 */
function publishSessionContextPctGone(
  hostId: string,
  tmuxSession: string | null,
): void {
  const key = contextPctKey(hostId, tmuxSession);
  if (!contextPctStore.has(key)) return;
  contextPctStore.delete(key);
  notifyContextPctListeners();
}

function subscribeContextPct(cb: () => void): () => void {
  contextPctListeners.add(cb);
  return () => {
    contextPctListeners.delete(cb);
  };
}

/**
 * React hook — subscribe to a single session's contextPct value from the
 * fleet-status stream. Returns null when:
 *   - The (hostId, tmuxSession) key has never been published (session not in
 *     fleet, or fleet-status client not yet connected).
 *   - The most recent published value was null (fresh session pre-scrape,
 *     dormant sentinel, or SSH-hiccup normalised-null on the backend).
 *
 * hostId is number-or-string on the caller side (PrettyView has number, the
 * relay-pane badge appendage will also have a numeric fleet-derived hostId).
 * Coerced to string here to match the backend contextpct-store's key format.
 *
 * useSyncExternalStore semantics: any publishSessionContextPct that changes
 * the value for this key re-renders consumers. Unchanged frames are skipped
 * at the publish boundary.
 */
export function useSessionContextPct(
  hostId: string | number,
  tmuxSession: string,
): number | null {
  const key = contextPctKey(String(hostId), tmuxSession);
  const getSnapshot = (): number | null => {
    const val = contextPctStore.get(key);
    if (val === undefined) return null;
    return val;
  };
  return useSyncExternalStore(subscribeContextPct, getSnapshot, getSnapshot);
}

/**
 * TEST ONLY — reset the module-scoped contextPct store so each test starts
 * from a clean slate. NOT a public API.
 */
export function __resetSessionContextPctForTests(): void {
  contextPctStore.clear();
  notifyContextPctListeners();
}

/**
 * TEST ONLY — allow tests to directly publish a value without going through
 * the WS lifecycle. Useful for isolation tests of the hook itself.
 */
export function __setSessionContextPctForTests(
  hostId: string,
  tmuxSession: string | null,
  pct: number | null,
): void {
  publishSessionContextPct(hostId, tmuxSession, pct);
}
