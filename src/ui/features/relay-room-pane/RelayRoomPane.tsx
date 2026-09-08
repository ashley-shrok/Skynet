// Phase 90 Plan 05 Task 3 — RelayRoomPane (top-level pane component).
//
// Composes the relay-room pane's three regions:
//   - IdentityBadgeRow (top) — humans + agents from the Plan 04 REST
//     participants endpoint (fetched on mount + refetched by Plan 06 on
//     WS `participants` frames).
//   - RelayMessageList (middle) — empty in this plan; Plan 06 wires the WS
//     history subscription that populates it.
//   - <div data-slot="compose-box" /> placeholder (bottom) — Plan 06 fills
//     with the ComposeBoxShell invocation.
//
// W#8 resolution: viewingUserMxid is sourced via useViewingUserMxid() —
// NOT threaded as a prop. The Plan 07 wrapper (RelayRoomSessionPane) does
// not need to know or pass the mxid; the pane fetches it itself. Rationale:
// the mxid is a per-viewing-user detail with a single canonical source
// (getUserInfo() → users.mxid), and threading it through every pane-open
// path would grow the prop surface without benefit.
//
// D-18 error state: participant fetch 403/404 → RelayRoomErrorState replaces
// the pane content ("This conversation is no longer available."). 401 →
// session-expired variant with different title copy. Other errors → same
// friendly error state (no retry button; the sidebar's observation loop
// filters inactive rows on the next tick anyway).
//
// D-17 empty room: fresh room with no messages renders row + empty middle
// + compose slot with NO special empty-state chrome. The compose bar
// (Plan 06) is what answers "what does the user do".
//
// This plan is intentionally scoped to render + participant fetch + error
// gate + viewing-user hook consumption. Plan 06 adds:
//   - WS subscription (history + live events)
//   - Compose box (via ComposeBoxShell)
//   - Optimistic-send state machine
//   - Per-agent badge appendage (meter + reset) via AgentBadgeWithAppendage
//
// NO modification to src/ui/features/pretty-view/ (D-01/D-03).

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { authApi } from "@/main-axios";
import { useViewingUserMxid } from "@/state/viewing-user-store";
import { IdentityBadgeRow } from "./IdentityBadgeRow";
import { RelayMessageList } from "./RelayMessageList";
import { RelayRoomErrorState } from "./error-state";
import type { RelayRoomParticipantsResponse } from "./relay-room-api";

/** Non-fatal error surface for the D-18 friendly-error and adjacent paths. */
type ErrorKind = "room-not-found" | "auth-expired" | null;

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
   * `isVisible` prop. Plan 06 uses this to gate WS connect/disconnect —
   * this plan reads it only for the structured mount log.
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

  const [participants, setParticipants] =
    useState<RelayRoomParticipantsResponse | null>(null);
  const [errorState, setErrorState] = useState<ErrorKind>(null);

  // Structured mount log — explicit fields, no raw response body
  // (PATTERNS.md § 2 discipline).
  useEffect(() => {
    console.info({
      operation: "relay_room_pane_mount",
      roomId,
      initialIsVisible: isVisible,
    });
    // Deliberately once-per-mount — no dep array on isVisible; Plan 06 will
    // add per-visibility WS lifecycle logging when it wires the socket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch participants on mount + when roomId changes.
  useEffect(() => {
    let cancelled = false;
    // Reset state when the roomId flips so a stale prior room's participants
    // don't briefly render before the new fetch resolves.
    setParticipants(null);
    setErrorState(null);
    // Path arg URL-encoded — defense-in-depth vs. Matrix roomId chars like
    // `!` and `:`. Backend also encodeURIComponents, but this keeps the
    // client-side URL well-formed.
    const url = `/relay-room/${encodeURIComponent(roomId)}/participants`;
    void authApi
      .get(url)
      .then((res: { data: RelayRoomParticipantsResponse }) => {
        if (cancelled) return;
        setParticipants(res.data);
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
          // map to the same state — nothing else to render here, and the
          // sidebar will filter this row on the next observation tick if
          // the room really is inactive.
          setErrorState("room-not-found");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  return (
    <div
      data-testid="relay-room-pane"
      className={cn("h-full w-full flex flex-col", className)}
    >
      {errorState === "room-not-found" && (
        <RelayRoomErrorState
          // Defaults to "This conversation is no longer available." per D-18.
          subline="You may have been removed from this room."
        />
      )}
      {errorState === "auth-expired" && (
        <RelayRoomErrorState
          title="Session expired"
          subline="Please refresh to sign back in."
        />
      )}
      {errorState === null && viewingUserMxid !== null && (
        <>
          <IdentityBadgeRow
            humans={participants?.humans ?? []}
            agents={participants?.agents ?? []}
            viewingUserMxid={viewingUserMxid}
          />
          <RelayMessageList
            // Plan 06 replaces these placeholder values with real WS-derived
            // state.
            history={[]}
            viewingUserMxid={viewingUserMxid}
            pendingSends={[]}
            hasOlder={false}
            loadOlderStatus="idle"
            loadOlderError={null}
            onLoadOlder={() => {
              // No-op in this plan — Plan 06 wires the WS `fetch_older_range`
              // call and populates history.
            }}
            roomTitle={roomTitle}
          />
          {/* Plan 06 fills this cell with the ComposeBoxShell invocation
              (D-04: no upper area; D-05: no attach button). Kept as a
              stable slot marker so Plan 06's landing does not reflow the
              layout. */}
          <div
            data-slot="compose-box"
            className="shrink-0"
            aria-hidden="true"
          />
        </>
      )}
      {errorState === null && viewingUserMxid === null && (
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
