/**
 * sessions-merge-helper.ts — pure merge primitive for Phase 89 Plan 04 D-15.
 *
 * The /sessions/list handler (`sessions.ts`) derives harness-backed sessions
 * from SSH + tmux + JSONL as it always has (D-01 scope anchor — that path is
 * byte-identical to pre-Phase-89), then appends active relay-room rows from
 * `listActiveRelayRoomSessions` to the flat response. Every item in the
 * merged output carries a `kind` discriminator so slice D's frontend can
 * branch on how to render it.
 *
 * ## Contract
 *
 * - Harness rows are sorted by `created` DESC (preserving Phase 47's
 *   comparator behavior for the harness partition).
 * - Relay rows are APPENDED after the harness partition in the order the
 *   store returned them (`updated_at DESC` per Plan 01's
 *   listActiveRelayRoomSessions). Cross-kind re-sorting by `lastActivityAt`
 *   is explicitly deferred to slice D per D-15 — this file returns the
 *   partitions concatenated but not intermixed.
 * - The `kind` field name is planner-locked to `kind` (not `type`) per
 *   Plan 04 M-1: (a) AppShell.tsx already uses `kind:` for split-tree
 *   discriminators so downstream consistency is highest, and (b) `kind`
 *   distinguishes cleanly from `type:` in fleet-status wire-protocol.ts's
 *   frame discriminated unions on a different domain.
 *
 * ## Why a helper file (not inline in sessions.ts)
 *
 * The merge is trivially testable in isolation — no supertest harness, no
 * mocked SSH, no fake DB. Keeps the sessions.ts diff surgical (only the
 * import + a single call site + the kind marker on the interface change).
 */

/**
 * Harness-derived session row shape. Mirrors the TmuxSessionRow interface in
 * `sessions.ts` (must stay in sync — the handler passes rows constructed
 * there directly to this helper). Every construction site in the handler
 * sets `kind: "harness" as const` so this literal is a compile-time
 * invariant on the merged response.
 */
export interface HarnessSessionRow {
  kind: "harness";
  hostId: number;
  hostName: string;
  sessionName: string;
  created: number;
  role: string | null;
  lastMessageAt: number | null;
  aiTitle: string | null;
}

/**
 * Relay-room session row shape as it appears in the /sessions/list response.
 * Mirrors the ActiveRelayRoomSession shape from
 * `relay-room-sessions-store.ts` with the addition of the `kind`
 * discriminator. The handler maps each store row to this shape before
 * concatenating.
 */
export interface RelayRoomSessionRow {
  kind: "relay-room";
  id: string;
  roomId: string;
  roomTitle: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Merged /sessions/list response element. Slice D's frontend switches on
 * `item.kind` to render each partition with the appropriate UI.
 */
export type SessionListItem = HarnessSessionRow | RelayRoomSessionRow;

/**
 * Merge the derived harness rows with the appended relay-room rows into the
 * flat /sessions/list response array.
 *
 * Behavior:
 * - Harness rows are sorted by `created` DESC (preserves Phase 47 behavior).
 * - Relay rows are APPENDED after the harness partition in their input
 *   order (the store returns them by `updated_at DESC`).
 * - No cross-kind intermixing; slice D can re-sort by `lastActivityAt` if
 *   desired per D-15 explicit deferral.
 *
 * The harness input array is sorted in place — callers that share the array
 * reference should clone first. In practice the sole caller is
 * `sessions.ts`'s handler which discards its intermediate arrays after the
 * response is written, so in-place sort is safe.
 */
export function mergeRelayRoomsIntoFlat(
  harnessRows: HarnessSessionRow[],
  relayRows: RelayRoomSessionRow[],
): SessionListItem[] {
  const harnessSorted = harnessRows.sort((a, b) => b.created - a.created);
  return [...harnessSorted, ...relayRows];
}
