import { useRef, useCallback } from "react";

/**
 * useInjectedTurnRelay — queue-and-replay hook for injected turns.
 *
 * Fixes the silent-null-drop in handleInjectedTurnReady where
 * pvSendInputRef.current === null during a WS mid-reconnect / mount-race at
 * the moment upload_ready_to_inject fires from the backend.
 *
 * Shape B (extracted hook, chosen for testability): accepts a getSendFn
 * accessor so the hook never holds a stale ref — it reads the live ref at
 * dispatch time. The pane's pvSendInputRef stays the single source of truth.
 *
 * Send shape matches a plain compose send: ONE event, `send(text + "\r",
 * mqid)`. The backend's split-send path then writes the body, presses Enter
 * via tmux, and arms the pv-send watchdog with the body so a swallowed Enter
 * is retried. (The former body-then-bare-"\r" pair left the backend with an
 * empty body, so the watchdog never armed for attachment sends.)
 *
 * StrictMode double-invoke: the drain microtask clears pendingRef.current
 * before executing the send, so the second invoke's microtask sees null and
 * skips. Exactly one drain fires.
 */

export interface UseInjectedTurnRelayOptions {
  getSendFn: () => ((text: string, mqid?: string) => boolean) | null;
}

export interface UseInjectedTurnRelayResult {
  onInjectedTurnReady: (text: string, messageQueueItemId: string) => void;
  onRegisterSendInput: (fn: (text: string, mqid?: string) => boolean) => void;
  onUnregisterSendInput: () => void;
}

function dispatchInjectedTurn(
  send: (text: string, mqid?: string) => boolean,
  text: string,
  messageQueueItemId: string,
): void {
  // The injected text ends with "\n"; the backend strips only the trailing
  // "\r", so the body keeps its final newline exactly as before.
  const ok = send(text + "\r", messageQueueItemId);
  if (!ok) {
    console.warn("[pv-inject] send returned false", {
      mqid: messageQueueItemId,
      textLen: text.length,
    });
  }
}

export function useInjectedTurnRelay(
  { getSendFn }: UseInjectedTurnRelayOptions,
): UseInjectedTurnRelayResult {
  // Single-slot pending: stashes the (text, messageQueueItemId) tuple when
  // getSendFn() returns null. A second onInjectedTurnReady call while a first
  // is still pending displaces the first (with a WARN) and only the second
  // replays on next register.
  const pendingRef = useRef<{ text: string; messageQueueItemId: string } | null>(null);

  const onInjectedTurnReady = useCallback(
    (text: string, messageQueueItemId: string) => {
      const hasPending = pendingRef.current !== null;
      const send = getSendFn();
      const refLive = send !== null;

      // [pv-inject] entry log: greppable trace at every call site.
      console.info("[pv-inject] entry", {
        mqid: messageQueueItemId,
        textLen: text.length,
        refLive,
        hasPending,
      });

      if (!refLive) {
        // Null ref path — stash for replay on next onRegisterSendInput.
        if (hasPending && pendingRef.current !== null) {
          // Displace the previous pending turn with a WARN.
          console.warn("[pv-inject] stale-displacement: displacing pending turn", {
            displacedMqid: pendingRef.current.messageQueueItemId,
            incomingMqid: messageQueueItemId,
          });
        }
        console.info("[pv-inject] queued-for-replay", {
          mqid: messageQueueItemId,
          textLen: text.length,
        });
        pendingRef.current = { text, messageQueueItemId };
        return;
      }

      // Live ref path — dispatch immediately.
      console.info("[pv-inject] dispatching-immediately", {
        mqid: messageQueueItemId,
        textLen: text.length,
      });
      dispatchInjectedTurn(send, text, messageQueueItemId);
    },
    [getSendFn],
  );

  const onRegisterSendInput = useCallback(
    (_fn: (text: string, mqid?: string) => boolean) => {
      // Only schedule a drain if there is a pending turn.
      const pending = pendingRef.current;
      if (!pending) return;

      // queueMicrotask defers the drain so that:
      // 1. The caller's pvSendInputRef.current = fn assignment lands first
      //    (getSendFn() returns the fresh fn when the microtask executes).
      // 2. StrictMode double-invoke: if a second onRegisterSendInput fires
      //    before the microtask runs, it also sees pending !== null and
      //    schedules a second microtask. The FIRST microtask clears
      //    pendingRef.current = null; the SECOND sees null and skips.
      queueMicrotask(() => {
        const drain = pendingRef.current;
        if (!drain) return; // StrictMode second-invoke guard: already drained.

        const send = getSendFn();
        if (!send) {
          console.warn("[pv-inject] ref went null before microtask drain", {
            mqid: drain.messageQueueItemId,
          });
          return;
        }

        // Clear before dispatch so a concurrent register can't double-drain.
        pendingRef.current = null;

        console.info("[pv-inject] draining-on-rebind", {
          mqid: drain.messageQueueItemId,
          textLen: drain.text.length,
        });

        dispatchInjectedTurn(send, drain.text, drain.messageQueueItemId);
      });
    },
    [getSendFn],
  );

  const onUnregisterSendInput = useCallback(() => {
    // The actual pvSendInputRef.current = null assignment is done in
    // IdentitySessionPane (the hook does not own the ref). This callback is
    // the notify seam: emit the [pv-inject] unregistered log for WS-close
    // trace visibility.
    console.info("[pv-inject] ref unregistered", {
      hasPending: pendingRef.current !== null,
    });
  }, []);

  return { onInjectedTurnReady, onRegisterSendInput, onUnregisterSendInput };
}
