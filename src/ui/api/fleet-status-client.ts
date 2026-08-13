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

      const delayMs = BACKOFF_SCHEDULE_MS[
        Math.min(reconnectAttempts, BACKOFF_SCHEDULE_MS.length - 1)
      ];
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
