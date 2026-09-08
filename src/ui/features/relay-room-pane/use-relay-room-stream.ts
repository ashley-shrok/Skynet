/**
 * Phase 90 Plan 06 Task 1 — useRelayRoomStream hook.
 *
 * Owns the relay-room pane's WebSocket lifecycle + frame dispatch + pending-
 * send FIFO state machine. Consumed by RelayRoomPane (Plan 06 Task 3) to
 * drive history / participants / send-round-trip / older-page-fetch state.
 *
 * ## WS lifecycle (mirrors PrettyView.tsx L1750-1830 patch #148 discipline)
 *   - Opens via openRelayRoomSocket() on mount when `isVisible === true`.
 *   - Fires `connectToRoom { roomId }` on `onopen`.
 *   - Dispatches server frames via a `switch (parsed.type)` on onmessage.
 *   - On onclose, schedules a reconnect with linear-with-cap backoff
 *     (2s / 4s / 6s / 8s / 8s; MAX_RECONNECT_ATTEMPTS=5).
 *   - On `isVisible === false` OR unmount: closes the WS, clears every
 *     pending-send timer.
 *
 * ## Pending-send FIFO (D-16 mirror of PrettyView.tsx L1112-1304 shape)
 *   - `sendMessage(body, mqid)`: ws.send({type:'send_message', body,
 *     txnId: mqid}); insert pending {mqid, content:body, sentAt, state:
 *     'sending', timer: setTimeout(flipToFailed, 20_000)}.
 *   - `live_event` with sender===viewingUserMxid AND
 *     event.unsigned.transaction_id === pending.mqid → clearTimeout, remove
 *     pending, append real event (Pitfall 4 / T-90-FE-01 regression gate).
 *   - `send_ack { txnId, eventId }` → remove the matching pending (redundant
 *     with the live_event echo path but a safe belt-and-suspenders).
 *   - `send_error { txnId, reason }` → flipToFailed.
 *   - 20s no-echo timer → flipToFailed(mqid, 'timeout') per D-16.
 *
 * ## Frame dispatch
 *   - session:        stored internally (roomTitle mirror; no state change
 *                     beyond consuming the frame — RelayRoomPane's prop
 *                     already carries roomTitle from the sidebar).
 *   - history_batch:  replace history; set hasOlder from hasMore.
 *   - live_event:     append (with pending-correlation as above).
 *   - send_ack:       remove pending.
 *   - send_error:     flipToFailed.
 *   - participants:   updates participants state (W#9 initial + live updates).
 *   - inactive:       error → 'room-not-found'.
 *   - error:          error → 'protocol'; connection stays open.
 *
 * ## Structured logging (PATTERNS.md § 2 discipline)
 *   Every boundary event logs via console.info with explicit fields; never
 *   raw serialization of the incoming frame or React SyntheticEvent (see
 *   PATTERNS.md for the exhaustive forbidden-token list). Log operations:
 *     relay_room_ws_open, relay_room_ws_close, relay_room_ws_reconnect,
 *     relay_room_send_message, relay_room_send_ack, relay_room_send_error,
 *     relay_room_fetch_older, relay_room_participants_update.
 *   NEVER logs raw event bodies or Matrix response payloads.
 *
 * ## Assumption A4 (RESEARCH.md L720): Matrix `unsigned.transaction_id`
 * echo-back. This hook trusts that Matrix echoes the client-supplied txnId
 * back on the same event received via `/sync`. Plan 04's backend
 * (matrix-message-send.ts) passes the frontend mqid verbatim as the Matrix
 * txnId. Backend integration testing during Plan 06 execution greenlit this
 * assumption; if a future backend change breaks the echo, Test 5 in the test
 * file fails immediately.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  openRelayRoomSocket,
  type MatrixEvent,
  type RelayRoomServerEvent,
  type RelayRoomParticipantsResponse,
  type ConnectToRoomPayload,
  type SendMessagePayload,
  type FetchOlderRangePayload,
} from "./relay-room-api";

// ─── Constants (mirror PrettyView pending-send + reconnect discipline) ───────

/** PrettyView L145: matches D-16 timeout. */
const PENDING_SEND_TIMEOUT_MS_NORMAL = 20_000;

/** PrettyView L90: matches patch #148 reconnect cap. */
const MAX_RECONNECT_ATTEMPTS = 5;

/** D-14 match-pretty-view page size. */
const LOAD_OLDER_COUNT = 20;

// ─── Types ───────────────────────────────────────────────────────────────────

export type RelayRoomError =
  | "room-not-found"
  | "auth-expired"
  | "protocol"
  | null;

export interface PendingSend {
  mqid: string;
  content: string;
  sentAt: number;
  state: "sending" | "failed";
  timer: ReturnType<typeof setTimeout> | null;
}

export interface UseRelayRoomStreamOpts {
  userId: number;
  roomId: string;
  viewingUserMxid: string;
  isVisible: boolean;
}

export interface UseRelayRoomStreamReturn {
  history: MatrixEvent[];
  participants: RelayRoomParticipantsResponse | null;
  error: RelayRoomError;
  pendingSends: PendingSend[];
  hasOlder: boolean;
  loadOlderStatus: "idle" | "in-flight" | "error";
  loadOlderError: string | null;
  sendMessage: (body: string, mqid: string) => void;
  fetchOlder: (beforeEventId: string) => void;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useRelayRoomStream(
  opts: UseRelayRoomStreamOpts,
): UseRelayRoomStreamReturn {
  const { userId, roomId, viewingUserMxid, isVisible } = opts;

  const [history, setHistory] = useState<MatrixEvent[]>([]);
  const [participants, setParticipants] =
    useState<RelayRoomParticipantsResponse | null>(null);
  const [error, setError] = useState<RelayRoomError>(null);
  const [pendingSends, setPendingSends] = useState<PendingSend[]>([]);
  const [hasOlder, setHasOlder] = useState<boolean>(false);
  const [loadOlderStatus, setLoadOlderStatus] = useState<
    "idle" | "in-flight" | "error"
  >("idle");
  const [loadOlderError, setLoadOlderError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pendingSendsRef = useRef<PendingSend[]>([]);
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const viewingUserMxidRef = useRef<string>(viewingUserMxid);
  const roomIdRef = useRef<string>(roomId);
  // Retry key that triggers the WS-setup effect to re-run on reconnect.
  const [retryKey, setRetryKey] = useState<number>(0);

  useEffect(() => {
    pendingSendsRef.current = pendingSends;
  }, [pendingSends]);

  useEffect(() => {
    viewingUserMxidRef.current = viewingUserMxid;
  }, [viewingUserMxid]);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  // ── flipToFailed helper (mirrors PrettyView L1179-1197) ────────────────────
  const flipToFailed = useCallback((mqid: string, reason: string) => {
    setPendingSends((prev) => {
      const found = prev.find((p) => p.mqid === mqid && p.state === "sending");
      if (!found) return prev;
      if (found.timer !== null) clearTimeout(found.timer);
      // Structured warn — reason + mqid only, never body.
      // eslint-disable-next-line no-console
      console.info({
        operation: "relay_room_send_error",
        mqid,
        reason,
      });
      return prev.map((p) =>
        p.mqid === mqid ? { ...p, state: "failed", timer: null } : p,
      );
    });
  }, []);

  // ── clearAllPendingSends (mirrors PrettyView L1331-1340) ───────────────────
  const clearAllPendingSends = useCallback(() => {
    for (const p of pendingSendsRef.current) {
      if (p.timer !== null) clearTimeout(p.timer);
    }
    setPendingSends([]);
  }, []);

  // ── sendMessage — outward API ──────────────────────────────────────────────
  const sendMessage = useCallback(
    (body: string, mqid: string) => {
      const ws = wsRef.current;
      if (ws === null || ws.readyState !== WebSocket.OPEN) {
        // Fail-immediately per JSDoc: seed the pending as failed so the UI
        // shows a red bubble. Simpler than pretty view's queued-send path.
        setPendingSends((prev) => [
          ...prev,
          {
            mqid,
            content: body,
            sentAt: Date.now(),
            state: "failed",
            timer: null,
          },
        ]);
        // eslint-disable-next-line no-console
        console.info({
          operation: "relay_room_send_message",
          mqid,
          roomId: roomIdRef.current,
          userId,
          ok: false,
          reason: "ws_not_open",
        });
        return;
      }
      const payload: SendMessagePayload = {
        type: "send_message",
        body,
        txnId: mqid,
      };
      try {
        ws.send(JSON.stringify(payload));
      } catch {
        // ws.send may throw if ws is mid-close between the readyState check
        // and the send call. Seed as failed to match the fail-immediately
        // branch above.
        setPendingSends((prev) => [
          ...prev,
          {
            mqid,
            content: body,
            sentAt: Date.now(),
            state: "failed",
            timer: null,
          },
        ]);
        return;
      }
      const timerHandle = setTimeout(
        () => flipToFailed(mqid, "timeout"),
        PENDING_SEND_TIMEOUT_MS_NORMAL,
      );
      setPendingSends((prev) => [
        ...prev,
        {
          mqid,
          content: body,
          sentAt: Date.now(),
          state: "sending",
          timer: timerHandle,
        },
      ]);
      // eslint-disable-next-line no-console
      console.info({
        operation: "relay_room_send_message",
        mqid,
        roomId: roomIdRef.current,
        userId,
        ok: true,
      });
    },
    [flipToFailed, userId],
  );

  // ── fetchOlder — outward API ───────────────────────────────────────────────
  const fetchOlder = useCallback(
    (beforeEventId: string) => {
      const ws = wsRef.current;
      if (ws === null || ws.readyState !== WebSocket.OPEN) return;
      const payload: FetchOlderRangePayload = {
        type: "fetch_older_range",
        beforeEventId,
        count: LOAD_OLDER_COUNT,
      };
      try {
        ws.send(JSON.stringify(payload));
        setLoadOlderStatus("in-flight");
        setLoadOlderError(null);
      } catch {
        setLoadOlderStatus("error");
        setLoadOlderError("send_failed");
        return;
      }
      // eslint-disable-next-line no-console
      console.info({
        operation: "relay_room_fetch_older",
        beforeEventId,
        count: LOAD_OLDER_COUNT,
        roomId: roomIdRef.current,
      });
    },
    [],
  );

  // ── WS setup effect ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isVisible) return;

    let cancelled = false;
    const ws = openRelayRoomSocket();
    wsRef.current = ws;

    ws.onopen = () => {
      if (cancelled) return;
      // Reset error on successful open (patch #148 discipline — clear stale
      // banner from a prior attempt).
      setError(null);
      const payload: ConnectToRoomPayload = {
        type: "connectToRoom",
        roomId: roomIdRef.current,
      };
      try {
        ws.send(JSON.stringify(payload));
      } catch {
        // ws may be mid-close
      }
      // eslint-disable-next-line no-console
      console.info({
        operation: "relay_room_ws_open",
        roomId: roomIdRef.current,
        userId,
      });
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      if (cancelled) return;
      let parsed: RelayRoomServerEvent;
      try {
        parsed = JSON.parse(event.data) as RelayRoomServerEvent;
      } catch {
        return;
      }
      switch (parsed.type) {
        case "session":
          // Stored implicitly by consuming the frame; no external effect.
          // roomTitle already carried via the pane's prop.
          break;
        case "history_batch":
          setHistory(parsed.events);
          setHasOlder(parsed.hasMore);
          setLoadOlderStatus("idle");
          setLoadOlderError(null);
          break;
        case "live_event": {
          const evt = parsed.event;
          const isSelfSender = evt.sender === viewingUserMxidRef.current;
          const echoedTxnId =
            evt.unsigned !== undefined
              ? evt.unsigned.transaction_id
              : undefined;
          if (isSelfSender && typeof echoedTxnId === "string") {
            // Pitfall 4 correlation — try to match a pending entry by mqid.
            const pending = pendingSendsRef.current.find(
              (p) => p.mqid === echoedTxnId,
            );
            if (pending) {
              // Cancel the timer + remove the pending.
              if (pending.timer !== null) clearTimeout(pending.timer);
              setPendingSends((prev) =>
                prev.filter((p) => p.mqid !== echoedTxnId),
              );
              setHistory((prev) => [...prev, evt]);
              break;
            }
          }
          // Non-correlated live event — append.
          setHistory((prev) => [...prev, evt]);
          break;
        }
        case "send_ack": {
          const { txnId } = parsed;
          const pending = pendingSendsRef.current.find(
            (p) => p.mqid === txnId,
          );
          if (pending) {
            if (pending.timer !== null) clearTimeout(pending.timer);
            setPendingSends((prev) => prev.filter((p) => p.mqid !== txnId));
          }
          // eslint-disable-next-line no-console
          console.info({
            operation: "relay_room_send_ack",
            mqid: txnId,
            eventId: parsed.eventId,
          });
          break;
        }
        case "send_error":
          flipToFailed(parsed.txnId, parsed.reason);
          break;
        case "participants":
          setParticipants({
            humans: parsed.humans,
            agents: parsed.agents,
          });
          // eslint-disable-next-line no-console
          console.info({
            operation: "relay_room_participants_update",
            humansCount: parsed.humans.length,
            agentsCount: parsed.agents.length,
            roomId: roomIdRef.current,
          });
          break;
        case "inactive":
          setError("room-not-found");
          break;
        case "error":
          setError("protocol");
          break;
      }
    };

    ws.onerror = () => {
      if (cancelled) return;
      // Error details are unreliable cross-browser; the subsequent close
      // event carries the authoritative status.
    };

    ws.onclose = () => {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.info({
        operation: "relay_room_ws_close",
        roomId: roomIdRef.current,
      });
      // Clear pending timers on close.
      clearAllPendingSends();
      // Reconnect with linear-with-cap backoff (patch #148: 2s/4s/6s/8s/8s).
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        const capMs = Math.min(
          2000 * (reconnectAttemptsRef.current + 1),
          8000,
        );
        // Full-jitter (R-54-07) — random draw in [0, capMs) to prevent tab-
        // restore herds from re-clumping on the reconnect ladder.
        const delay = Math.floor(Math.random() * capMs);
        reconnectAttemptsRef.current += 1;
        // eslint-disable-next-line no-console
        console.info({
          operation: "relay_room_ws_reconnect",
          attempt: reconnectAttemptsRef.current,
          delayMs: delay,
          roomId: roomIdRef.current,
        });
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (cancelled) return;
          setRetryKey((k) => k + 1);
        }, delay);
      }
    };

    return () => {
      cancelled = true;
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      try {
        ws.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
      clearAllPendingSends();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, retryKey]);

  return {
    history,
    participants,
    error,
    pendingSends,
    hasOlder,
    loadOlderStatus,
    loadOlderError,
    sendMessage,
    fetchOlder,
  };
}
