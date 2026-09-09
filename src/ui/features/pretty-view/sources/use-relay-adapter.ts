/**
 * Phase 93 Slice 3 — useRelayAdapter.
 *
 * Ported byte-for-behavior from Slice D's standalone relay-source stream
 * hook per D-10 (retirement moved this out of the standalone relay-source
 * tree; Phase 93 Slice 4 retired the source). This hook now owns the WS
 * lifecycle for the relay case of the shared chat surface — PrettyView with
 * source.kind === "relay" reads adapter.messages via useChatSurfaceAdapter.
 *
 * Key differences vs. the source hook:
 *   1. Export renamed `useRelayRoomStream` → `useRelayAdapter`.
 *   2. Two-arg signature (Warning 4): `(source, isVisible)`. `source` is
 *      nullable — when null, the hook is a no-op (no WS opened, empty return,
 *      no timers). This satisfies Slice 1's stubbed-peer contract, which
 *      `useChatSurfaceAdapter` uses to keep hook-call order stable across
 *      kind-flips (Pitfall 2 resolution). `isVisible` threads verbatim from
 *      `useChatSurfaceAdapter`'s Slice 1 signature.
 *   3. Return shape matches Slice 1's `ChatSurfaceAdapterState`:
 *        - `messages: ChatSurfaceMessage[]` — internal state stays named
 *          `history` for minimal diff; returned key is `messages` for D-09
 *          consistency. Values are `MatrixEvent`s mapped to `RelayInboundEvent`
 *          / `RelayOutboundEvent` shapes via `matrixEventToStreamEvent` below
 *          (Assumption A2).
 *        - `participants: { humans, agents }` — initial state
 *          `{ humans: [], agents: [] }` (NEVER null when the hook is active;
 *          Warning 2). Updated on `participants` frames.
 *        - `sendMessage: (body, mqid) => Promise<boolean>` — Promise-returning
 *          wrapper (harness/relay unified adapter contract) around the source
 *          hook's void-returning sendMessage.
 *        - `error: string | null` — null initially; populated on
 *          inactive/error frames.
 *        - `isReady: boolean` — false initially; flips true on the FIRST
 *          `session` frame (chosen because `session` fires immediately on WS
 *          connect after auth/access gate pass — it's the earliest reliable
 *          "backend is authoritative" signal; `history_batch` follows shortly
 *          after but may be absent if the room has zero history).
 *        - Optional pagination fields (`hasOlder`, `loadOlderStatus`,
 *          `loadOlderError`, `fetchOlder`) populated per source-hook behavior.
 *   4. `viewingUserMxid` resolved internally via `useViewingUserMxid()` from
 *      `@/state/viewing-user-store` (Slice D W#8 pattern).
 *   5. Preserved byte-for-behavior: constants
 *      (PENDING_SEND_TIMEOUT_MS_NORMAL = 20_000, MAX_RECONNECT_ATTEMPTS = 5,
 *      LOAD_OLDER_COUNT = 20), backoff (linear-with-cap 2s/4s/6s/8s/8s with
 *      full-jitter per R-54-07), isVisible gate, all 8 frame handlers, all
 *      pending-send lifecycle (insert with timer, remove on live_event echo,
 *      flip to failed on timeout/error, cancel timer on unmount), all
 *      `console.info({ operation: "relay_room_..." })` structured logs.
 *   6. Preserved: Assumption A4 (Matrix `unsigned.transaction_id` echo-back).
 *      mqid → WS payload.txnId → backend matrix-message-send.ts (untouched)
 *      → Matrix txnId → live_event.unsigned.transaction_id → correlation
 *      lookup removes pending + appends real event. Any change to this chain
 *      breaks Pitfall 4.
 *
 * ## Frame dispatch (identical to source)
 *   - session:        flips isReady=true; no other side effect (roomTitle is
 *                     already carried on `source.roomTitle`).
 *   - history_batch:  replace history; set hasOlder from hasMore.
 *   - live_event:     append (with pending-correlation via Pitfall 4).
 *   - send_ack:       remove pending.
 *   - send_error:     flipToFailed.
 *   - participants:   updates participants state.
 *   - inactive:       error → 'room-not-found'.
 *   - error:          error → 'protocol'; connection stays open.
 *
 * ## Structured logging (PATTERNS.md § 2 discipline)
 *   All boundary events log via console.info with explicit fields; NEVER raw
 *   JSON.stringify of a WS frame. Log operations preserved verbatim:
 *     relay_room_ws_open, relay_room_ws_close, relay_room_ws_reconnect,
 *     relay_room_send_message, relay_room_send_ack, relay_room_send_error,
 *     relay_room_fetch_older, relay_room_participants_update.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  openRelayRoomSocket,
  type MatrixEvent,
  type RelayRoomServerEvent,
  type ConnectToRoomPayload,
  type SendMessagePayload,
  type FetchOlderRangePayload,
} from "./relay-room-api";
import type {
  ChatSurfaceSource,
  ChatSurfaceAdapterState,
  ChatSurfaceMessage,
  ChatSurfaceParticipants,
} from "./chat-surface-source";
import { useViewingUserMxid, useViewingUserId } from "@/state/viewing-user-store";

// ─── Constants (mirror source hook + PrettyView pending-send + reconnect) ────

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

interface PendingSend {
  mqid: string;
  content: string;
  sentAt: number;
  state: "sending" | "failed";
  timer: ReturnType<typeof setTimeout> | null;
}

// ─── Empty-state singleton (Warning 2: participants never null when active) ──

const EMPTY_PARTICIPANTS: ChatSurfaceParticipants = { humans: [], agents: [] };

const IDLE_STATE: ChatSurfaceAdapterState = {
  messages: [],
  participants: EMPTY_PARTICIPANTS,
  sendMessage: async () => false,
  error: null,
  isReady: false,
  hasOlder: false,
  loadOlderStatus: "idle",
  loadOlderError: null,
  fetchOlder: async () => {},
};

// ─── MatrixEvent → ChatSurfaceMessage mapper (Assumption A2) ─────────────────

/**
 * Map a MatrixEvent into the union `ChatSurfaceMessage`. Non-self messages
 * become `RelayInboundEvent` shape (rendered via RelayInboundBubble D-16);
 * self messages become `RelayOutboundEvent` shape (rendered via
 * OutboundBubble / RelayOutboundBubble — case-agnostic per D-15).
 *
 * Non-text events (state changes, redactions, etc.) return null and are
 * filtered from the returned `messages` array.
 */
function matrixEventToStreamEvent(
  event: MatrixEvent,
  viewingUserMxid: string,
  roomId: string,
): ChatSurfaceMessage | null {
  // Only render text-body events. Other Matrix types (m.room.member,
  // m.room.redaction, etc.) are silently skipped from the message list —
  // participants frames + inactive frames carry the semantics we care about.
  const msgtype = event.content["msgtype"];
  const body = event.content["body"];
  if (typeof body !== "string") return null;
  if (msgtype !== "m.text" && msgtype !== undefined) return null;

  const isSelf = event.sender === viewingUserMxid;
  if (isSelf) {
    return {
      type: "relay_outbound",
      room: roomId,
      rawCommand: "",
      body,
      eventId: event.event_id,
      ts: event.origin_server_ts,
    };
  }
  return {
    type: "relay_inbound",
    room: roomId,
    sender: event.sender,
    matrixEventId: event.event_id,
    body,
    raw: body,
    eventId: event.event_id,
    ts: event.origin_server_ts,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useRelayAdapter(
  source: Extract<ChatSurfaceSource, { kind: "relay" }> | null,
  isVisible: boolean,
): ChatSurfaceAdapterState {
  // Hooks that MUST be called unconditionally regardless of `source` (Pitfall
  // 2). Passing null source keeps the hook alive but inert; every hook still
  // runs in stable order.
  const viewingUserMxid = useViewingUserMxid();
  const viewingUserId = useViewingUserId();

  const roomId = source?.roomId ?? "";

  const [history, setHistory] = useState<MatrixEvent[]>([]);
  const [participants, setParticipants] =
    useState<ChatSurfaceParticipants>(EMPTY_PARTICIPANTS);
  const [error, setError] = useState<RelayRoomError>(null);
  const [pendingSends, setPendingSends] = useState<PendingSend[]>([]);
  const [hasOlder, setHasOlder] = useState<boolean>(false);
  const [loadOlderStatus, setLoadOlderStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [loadOlderError, setLoadOlderError] = useState<string | null>(null);
  // Warning 2 — isReady flips true on the FIRST `session` frame (earliest
  // reliable "backend is authoritative" signal; see header JSDoc).
  const [isReady, setIsReady] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const pendingSendsRef = useRef<PendingSend[]>([]);
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const viewingUserMxidRef = useRef<string>(viewingUserMxid ?? "");
  const roomIdRef = useRef<string>(roomId);
  // history ref-mirror so fetchOlder (useCallback with [] deps) can read the
  // latest history without re-creating on every history change.
  const historyRef = useRef<MatrixEvent[]>([]);
  // Retry key that triggers the WS-setup effect to re-run on reconnect.
  const [retryKey, setRetryKey] = useState<number>(0);

  useEffect(() => {
    pendingSendsRef.current = pendingSends;
  }, [pendingSends]);

  useEffect(() => {
    viewingUserMxidRef.current = viewingUserMxid ?? "";
  }, [viewingUserMxid]);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  // ── flipToFailed helper (mirrors source hook + PrettyView L1179-1197) ────
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

  // ── clearAllPendingSends (mirrors PrettyView L1331-1340) ─────────────────
  const clearAllPendingSends = useCallback(() => {
    for (const p of pendingSendsRef.current) {
      if (p.timer !== null) clearTimeout(p.timer);
    }
    setPendingSends([]);
  }, []);

  // ── sendMessage — Promise-returning wrapper (adapter contract) ───────────
  // Wraps the source hook's void-returning sendMessage so the return shape
  // matches ChatSurfaceAdapterState. Resolves `true` when the WS is open and
  // the payload was sent; `false` when the WS was not open (seeded as failed).
  const sendMessage = useCallback(
    async (body: string, mqid: string): Promise<boolean> => {
      const ws = wsRef.current;
      if (ws === null || ws.readyState !== WebSocket.OPEN) {
        // Fail-immediately per D-14: seed the pending as failed so the UI
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
          userId: viewingUserId,
          ok: false,
          reason: "ws_not_open",
        });
        return false;
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
        return false;
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
        userId: viewingUserId,
        ok: true,
      });
      return true;
    },
    [flipToFailed, viewingUserId],
  );

  // ── fetchOlder — Promise-returning wrapper (adapter contract) ────────────
  // The adapter contract signature is `() => Promise<void>` (no argument).
  // The source hook took a beforeEventId argument; we compute it internally
  // from the oldest event in history (via historyRef) so callers don't need
  // to thread it.
  const fetchOlder = useCallback(async (): Promise<void> => {
    const ws = wsRef.current;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    const hist = historyRef.current;
    if (hist.length === 0) return;
    const beforeEventId = hist[0].event_id;
    const payload: FetchOlderRangePayload = {
      type: "fetch_older_range",
      beforeEventId,
      count: LOAD_OLDER_COUNT,
    };
    try {
      ws.send(JSON.stringify(payload));
      setLoadOlderStatus("loading");
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
  }, []);

  // Keep historyRef in sync with the history state (used by fetchOlder above).
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  // ── WS setup effect ──────────────────────────────────────────────────────
  useEffect(() => {
    // No-op branch: hook inert when source is null OR isVisible is false.
    // Passing null source is how `useChatSurfaceAdapter` calls this hook when
    // the active source is harness — hook still runs (Pitfall 2 stability)
    // but doesn't open a WS.
    if (source === null) return;
    if (!isVisible) return;

    let cancelled = false;
    const ws = openRelayRoomSocket();
    wsRef.current = ws;

    ws.onopen = () => {
      if (cancelled) return;
      // Reset error on successful open (patch #148 discipline — clear stale
      // banner from a prior attempt).
      setError(null);
      // Reset the reconnect-attempt counter on a successful open — without this,
      // once the 5-attempt cap fires the ladder is permanently exhausted and a
      // healthy WS that later drops hours in never reconnects. Bug was inherited
      // byte-for-behavior from the retired standalone hook via Slice 3 D-10 port.
      reconnectAttemptsRef.current = 0;
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
        userId: viewingUserId,
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
          // Warning 2: session is the earliest reliable "backend is
          // authoritative" signal. isReady flips true here so MultiBadgeAnchor
          // (Slice 2) can discriminate loading (isReady=false) from empty
          // (isReady=true, zero participants).
          setIsReady(true);
          break;
        case "history_batch":
          setHistory(parsed.events);
          setHasOlder(parsed.hasMore);
          setLoadOlderStatus("idle");
          setLoadOlderError(null);
          // Belt-and-suspenders: history_batch also flips isReady=true (in
          // case a session frame is somehow missed — defensive).
          setIsReady(true);
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
  }, [source?.roomId ?? null, isVisible, retryKey]);

  // ── Return the ChatSurfaceAdapterState-compatible shape ──────────────────

  // Map MatrixEvent[] → ChatSurfaceMessage[] (D-16 render compatibility). The
  // mapper filters out non-text events (state changes, redactions, etc.).
  // Memoized on `history` so downstream consumers (PrettyView `effectiveMessages`,
  // ComposeBox subtree via `handleComposeSend` useCallback deps) see a stable
  // reference when the underlying history has not changed. Without this, the
  // hook returned a fresh array + fresh object every render, defeating memoization
  // across the compose subtree and re-firing every downstream effect.
  //
  // Pitfall 2 discipline: this useMemo is called UNCONDITIONALLY (before the
  // source === null early-return below). Placing it after the early-return
  // would violate rules-of-hooks on kind-flip — first render with source=null
  // returns before the hook, next render with source=non-null calls it,
  // React throws "Rendered more hooks than during previous render."
  const messages = useMemo<ChatSurfaceMessage[]>(() => {
    const out: ChatSurfaceMessage[] = [];
    for (const evt of history) {
      const mapped = matrixEventToStreamEvent(
        evt,
        viewingUserMxidRef.current,
        roomIdRef.current,
      );
      if (mapped !== null) out.push(mapped);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  // Memoize the returned object so consumers checking reference equality
  // (React.memo, useCallback deps that include the adapter object) don't see
  // a fresh reference every render. Same Pitfall 2 discipline as `messages`
  // above: called unconditionally before the source === null early-return.
  const memoizedActiveState = useMemo(() => ({
    messages,
    participants,
    sendMessage,
    error,
    isReady,
    hasOlder,
    loadOlderStatus,
    loadOlderError,
    fetchOlder,
  }), [
    messages,
    participants,
    sendMessage,
    error,
    isReady,
    hasOlder,
    loadOlderStatus,
    loadOlderError,
    fetchOlder,
  ]);

  // No-op return when source is null (harness case caller via
  // useChatSurfaceAdapter): return the idle singleton so the harness case sees
  // participants={humans:[],agents:[]}, isReady=false, empty messages. This
  // early-return sits BELOW the two useMemos above (Pitfall 2 discipline).
  if (source === null) {
    return IDLE_STATE;
  }

  // Suppress lint: pendingSends is observed by the hook internally (timers
  // fire against setPendingSends via flipToFailed) even though the returned
  // shape doesn't expose it. Optimistic-bubble rendering could be added in a
  // later slice if needed; for now the pending-send FIFO exists purely for
  // the Pitfall 4 correlation + timeout lifecycle.
  void pendingSends;

  return memoizedActiveState;
}
