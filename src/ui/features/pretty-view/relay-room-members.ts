import { useEffect, useState } from "react";
import { stampedFetch } from "@/lib/stamped-fetch";

/**
 * Who is in a relay room, as seen by GET /relay-room/:roomId/members.
 * `you` is the viewing user; `human` another Skynet user; `agent` an
 * identity (display name resolved client-side from the identities store).
 */
export interface RelayRoomMember {
  mxid: string;
  kind: "you" | "human" | "agent";
  displayName: string | null;
}

const MATRIX_ROOM_ID_RE = /^![a-zA-Z0-9._=-]+:[a-zA-Z0-9.-]+$/;

/** Room ids the backend could not resolve (shell vars, foreign homeservers)
 * reach the bubble as non-room-id strings; only real ids are looked up. */
export function isMatrixRoomId(room: string | null | undefined): room is string {
  return typeof room === "string" && MATRIX_ROOM_ID_RE.test(room);
}

// One lookup per (host, room) per page life — a pane can hold dozens of
// bubbles for the same room, and membership changes rarely enough that a
// reload is fine for picking up a new member.
const cache = new Map<string, Promise<RelayRoomMember[] | null>>();

function fetchMembers(hostId: number, roomId: string): Promise<RelayRoomMember[] | null> {
  const key = `${hostId}::${roomId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = stampedFetch(
    `/relay-room/${encodeURIComponent(roomId)}/members?hostId=${hostId}`,
    { credentials: "include" },
  )
    .then(async (res) => {
      if (!res.ok) {
        console.info(
          `[relay-members] lookup miss hostId=${hostId} roomId=${roomId} status=${res.status}`,
        );
        return null;
      }
      const json = (await res.json()) as { members?: RelayRoomMember[] };
      return Array.isArray(json.members) ? json.members : null;
    })
    .catch((err: unknown) => {
      console.warn(
        `[relay-members] lookup failed hostId=${hostId} roomId=${roomId} error=${err instanceof Error ? err.message : "unknown"}`,
      );
      return null;
    });
  cache.set(key, p);
  return p;
}

/** Test seam — clears the per-page member cache. */
export function __resetRelayRoomMembersCache(): void {
  cache.clear();
}

/**
 * Members of `room`, or null while loading / when the room can't be looked
 * up (unresolved room ref, other homeserver, lookup failure). Callers fall
 * back to a best guess on null.
 */
export function useRelayRoomMembers(
  room: string | null | undefined,
  hostId: number | null | undefined,
): RelayRoomMember[] | null {
  const valid = isMatrixRoomId(room) && typeof hostId === "number" && hostId > 0;
  const [members, setMembers] = useState<RelayRoomMember[] | null>(null);
  useEffect(() => {
    if (!valid) {
      setMembers(null);
      return;
    }
    let live = true;
    void fetchMembers(hostId, room).then((m) => {
      if (live) setMembers(m);
    });
    return () => {
      live = false;
    };
  }, [valid, hostId, room]);
  return valid ? members : null;
}
