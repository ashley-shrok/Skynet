// Phase 90 Plan 05 Task 3 / Plan 06 Task 3 — RelayRoomPane.
//
// Composes the relay-room pane's three regions:
//   - IdentityBadgeRow (top) — humans + agents. WS `participants` frame
//     (from useRelayRoomStream, if delivered) takes precedence over the REST
//     initial-fetch fallback. The REST fetch remains as bootstrap for the
//     transient window before the WS's participants frame arrives.
//   - RelayMessageList (middle) — driven by useRelayRoomStream: history,
//     pendingSends, hasOlder, loadOlderStatus, loadOlderError, fetchOlder.
//   - ComposeBoxShell (bottom) — Plan 02 shared primitive with upperArea +
//     attachButton BOTH undefined (D-04 no upper area; D-05 attach hidden).
//     handleSend generates an mqid with the W#7 `relay-optim-` prefix and
//     calls stream.sendMessage(body, mqid).
//
// W#8 resolution: viewingUserMxid is sourced via useViewingUserMxid() —
// NOT threaded as a prop. See the file's Plan 05 header block for rationale.
//
// D-18 error state (unified with hook error): pane renders
// RelayRoomErrorState when the participants fetch returns 403/404 OR when
// stream.error === 'room-not-found' (the hook sets that on WS `inactive`
// frames per Plan 04 backend). 401 → session-expired variant. All other
// non-401 REST errors also render the friendly state — backend
// canonicalizes to the same no-existence-oracle status per Security V8.
//
// D-17 empty room: fresh room with no messages renders row + empty middle
// + compose bar with NO special empty-state chrome.
//
// Reset dispatch is INTERNAL to AgentBadgeWithAppendage (Plan 06 Task 2) —
// no parent callback threading needed at this seam. The IdentityBadgeRow
// swap of AgentBadgeCellPlaceholder → AgentBadgeWithAppendage is fully
// internal to IdentityBadgeRow.tsx.
//
// NO modification to src/ui/features/pretty-view/ (D-01/D-03).

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { authApi } from "@/main-axios";
import { useViewingUserMxid } from "@/state/viewing-user-store";
import { ComposeBoxShell } from "@/components/ComposeBoxShell";
import { IdentityBadgeRow } from "./IdentityBadgeRow";
import { RelayMessageList } from "./RelayMessageList";
import { RelayRoomErrorState } from "./error-state";
import { useRelayRoomStream } from "./use-relay-room-stream";
import type { RelayRoomParticipantsResponse } from "./relay-room-api";

/** Non-fatal error surface for the D-18 friendly-error and adjacent paths. */
type ErrorKind = "room-not-found" | "auth-expired" | null;

/**
 * Generate an optimistic-send message-queue id. The `relay-optim-` prefix is
 * the W#7 committed prefix — distinct from PrettyView's own send-path prefix
 * to avoid cross-pane debugging confusion since D-03 forbids modifying
 * ComposeBox's shared mqid utility. The prefix flows all the way through
 * to Matrix `unsigned.transaction_id` echo-back (Pitfall 4 correlation)
 * and structured logs, keeping the two panes' send paths unambiguous.
 */
function generateRelayMqid(): string {
  return `relay-optim-${crypto.randomUUID()}`;
}

export interface RelayRoomPaneProps {
  /**
   * The Matrix room id (e.g. `!abcdef:matrix.example.com`). Plan 07 wires
   * this from `tab.relayRoomId` on the sessionKind-branched tab dispatcher.
   */
  roomId: string;
  /**
   * The room title (from Matrix `m.room.name` state event, if set). May
   * be null for rooms without a name.
   */
  roomTitle: string | null;
  /**
   * Per-tab visibility flag from the shell. Mirrors PrettyView's
   * `isVisible` prop. Gates the WS lifecycle in useRelayRoomStream
   * (Plan 06 Task 1) and is logged at mount for structured-diag.
   */
  isVisible: boolean;
  /** Optional wrapper class override. */
  className?: string;
}

/**
 * Extract the HTTP status code from an axios error. Returns null for
 * non-HTTP errors (network drops, timeouts). Kept as a small standalone
 * helper so the effect body stays readable.
 */
function extractStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const withResponse = err as { response?: { status?: unknown } };
  const status = withResponse.response?.status;
  return typeof status === "number" ? status : null;
}

export function RelayRoomPane({
  roomId,
  roomTitle,
  isVisible,
  className,
}: RelayRoomPaneProps) {
  // W#8: viewingUserMxid comes from the hook, NOT a prop.
  const viewingUserMxid = useViewingUserMxid();

  // Plan 06 Task 1: WS-derived state. The hook fully owns the lifecycle;
  // this pane consumes the return value. Fallback empty string on
  // viewingUserMxid is temporary while the W#8 fetch resolves — the hook's
  // Pitfall 4 correlation `sender === viewingUserMxid` simply won't match
  // for an empty string, which is safe (worst case: outbound bubbles show
  // as inbound momentarily; on next re-render the discrimination corrects).
  const stream = useRelayRoomStream({
    userId: 0, // TODO: thread real userId once viewing-user-store carries it.
    roomId,
    viewingUserMxid: viewingUserMxid ?? "",
    isVisible,
  });

  // REST-fetched participants — bootstrap fallback for the transient window
  // between mount and the WS's first `participants` frame arriving. Once
  // the WS delivers, stream.participants takes precedence in the render
  // dispatch below.
  const [restParticipants, setRestParticipants] =
    useState<RelayRoomParticipantsResponse | null>(null);
  const [errorState, setErrorState] = useState<ErrorKind>(null);

  // Local state for compose textarea (owned here so optimistic-send success/
  // failure paths can drive clear semantics from outside per Plan 02).
  const [composeText, setComposeText] = useState<string>("");

  // Structured mount log — explicit fields, no raw response body
  // (PATTERNS.md § 2 discipline).
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.info({
      operation: "relay_room_pane_mount",
      roomId,
      initialIsVisible: isVisible,
    });
    // Deliberately once-per-mount — no dep array on isVisible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch participants on mount + when roomId changes. Used as the
  // bootstrap fallback until the WS `participants` frame lands.
  useEffect(() => {
    let cancelled = false;
    // Reset state when the roomId flips so a stale prior room's participants
    // don't briefly render before the new fetch resolves.
    setRestParticipants(null);
    setErrorState(null);
    // Path arg URL-encoded — defense-in-depth vs. Matrix roomId chars like
    // `!` and `:`. Backend also encodeURIComponents, but this keeps the
    // client-side URL well-formed.
    const url = `/relay-room/${encodeURIComponent(roomId)}/participants`;
    void authApi
      .get(url)
      .then((res: { data: RelayRoomParticipantsResponse }) => {
        if (cancelled) return;
        setRestParticipants(res.data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = extractStatus(err);
        // Structured warn — no raw body (may carry Matrix response fields
        // per PATTERNS.md § 3 backend-proxied scrub discipline).
        // eslint-disable-next-line no-console
        console.warn({
          operation: "relay_room_pane_participants_fetch_failed",
          roomId,
          status: status ?? "unknown",
        });
        if (status === 401) {
          setErrorState("auth-expired");
        } else {
          // 403 + 404 both map to the D-18 friendly error state (backend
          // returns the same canonical code for both to avoid an existence
          // oracle per Security V8). Other errors (5xx, network drops) also
          // map to the same state.
          setErrorState("room-not-found");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // handleSend closure — generates the W#7 mqid and hands off to the hook.
  const handleSend = useCallback(
    (body: string) => {
      const mqid = generateRelayMqid();
      stream.sendMessage(body, mqid);
      // Clear the textarea immediately per COMPOSE-02 discipline (Enter
      // clears; the optimistic pending bubble in RelayMessageList is what
      // the user sees during the round-trip).
      setComposeText("");
      // Structured send log — NEVER log the body (privacy) or mxid credentials.
      // eslint-disable-next-line no-console
      console.info({
        operation: "relay_room_send",
        mqid,
        roomId,
      });
    },
    [stream, roomId],
  );

  // Unified error state — REST fetch error OR WS `inactive` frame both flip
  // the pane to the D-18 friendly state. Prefer the more specific
  // auth-expired variant when it applies.
  const displayError: ErrorKind =
    errorState !== null
      ? errorState
      : stream.error === "room-not-found"
        ? "room-not-found"
        : null;

  // Participants source: WS frame wins once delivered; REST fallback
  // otherwise. Matches the "one consistent visible-row-set regardless of
  // source" invariant IdentityBadgeRow's D-07 self-exclusion filter relies
  // on.
  const displayParticipants: RelayRoomParticipantsResponse =
    stream.participants ?? restParticipants ?? { humans: [], agents: [] };

  return (
    <div
      data-testid="relay-room-pane"
      className={cn("h-full w-full flex flex-col", className)}
    >
      {displayError === "room-not-found" && (
        <RelayRoomErrorState
          // Defaults to "This conversation is no longer available." per D-18.
          subline="You may have been removed from this room."
        />
      )}
      {displayError === "auth-expired" && (
        <RelayRoomErrorState
          title="Session expired"
          subline="Please refresh to sign back in."
        />
      )}
      {displayError === null && viewingUserMxid !== null && (
        <>
          <IdentityBadgeRow
            humans={displayParticipants.humans}
            agents={displayParticipants.agents}
            viewingUserMxid={viewingUserMxid}
          />
          <RelayMessageList
            history={stream.history}
            viewingUserMxid={viewingUserMxid}
            pendingSends={stream.pendingSends.map((p) => ({
              mqid: p.mqid,
              content: p.content,
              state: p.state,
            }))}
            hasOlder={stream.hasOlder}
            loadOlderStatus={stream.loadOlderStatus}
            loadOlderError={stream.loadOlderError}
            onLoadOlder={() => {
              // Pass the oldest currently-loaded event's id as the cursor.
              // M1 fixup 2026-09-09: bail out before calling fetchOlder when
              // history is empty — an empty-string cursor would generate a
              // malformed WS frame that fails backend validation
              // (`parseClientFrame` requires `beforeEventId.length > 0`).
              // Belt-and-suspenders: the LoadMoreOlderButton already gates
              // rendering on hasOlder=true, which implies history has at
              // least one event, but a race between hook state updates
              // could briefly expose this seam.
              const oldest = stream.history[0]?.event_id;
              if (oldest === undefined || oldest.length === 0) return;
              stream.fetchOlder(oldest);
            }}
            roomTitle={roomTitle}
          />
          <ComposeBoxShell
            // D-04: no upper area (no reset/meter/queue/stop/thumbs-up/recap).
            upperArea={undefined}
            // D-05: attach HIDDEN entirely for v1.
            attachButton={undefined}
            value={composeText}
            onChange={setComposeText}
            onSend={handleSend}
            placeholder="Message the room…"
            // canSend gates on the hook's error state — a `room-not-found`
            // error already flips displayError above and renders the error
            // state instead. `protocol` errors keep the connection open so
            // sends are allowed to retry.
            canSend={stream.error !== "room-not-found"}
            className="shrink-0"
          />
        </>
      )}
      {displayError === null && viewingUserMxid === null && (
        // W#8 hook still in flight. Small loading state so the pane doesn't
        // briefly render the badge row without the D-07 self-exclusion
        // filter (which would show the viewing user as a badge for the
        // ~50ms until getUserInfo() resolves).
        <div
          data-testid="relay-room-loading"
          className="flex items-center justify-center h-full text-sm text-[rgba(232,228,216,0.5)]"
        >
          Loading…
        </div>
      )}
    </div>
  );
}
