// observation-loop-classifier — pure decision tree for D-08 / D-09 / D-13.
//
// Given a room + its current member set + a pre-computed classification
// fact-set from the caller (observation loop), decide whether to materialize
// or exclude. First matching rule wins. Every rule returns a stable
// `reason` string so the observation loop's structured logs can name the
// exact D-* decision at each per-room boundary.
//
// D-08 (exclusion is EXACTLY the two-party user+one-agent case): harness
// sessions already cover (user + one local agent) DMs; materializing a peer
// relay-room entry there would produce a visible duplicate in the sidebar.
// Every other room shape materializes.
//
// D-09 (registry-room-membership authority — NOT naming, NOT disk): the
// caller pre-computes `agentsInRegistry` as a Set from the members of the
// agents-registry room. Non-agent-registry other members always materialize
// conservatively — they might be humans or foreign agents from another
// Skynet, either way the user wants them in their sidebar.
//
// D-13 (admin-rooms ignore-list): the caller pre-computes
// `isRoomInAdminList` from admin_rooms; registry rooms themselves have many
// members and would otherwise trip the group-room materialize rule. This is
// the D-08 corollary: admin rooms are Skynet's plumbing, not conversations.
//
// Pure module — no I/O imports, trivially unit-testable without mocks.

/** The classifier's two possible outcomes. */
export type ClassifyDecision = "materialize" | "exclude";

/** Input fact-set the caller (observation loop) supplies each per-room call. */
export interface ClassifyRoomInput {
  /** The user whose sidebar this classification is for. */
  userMxid: string;
  /** The room being classified. */
  roomId: string;
  /** Every mxid currently joined to the room (per getRoomJoinedMembers). */
  memberMxids: readonly string[];
  /** The room's reported joined-member count (Synapse's `total`). */
  memberCount: number;
  /** Whether the caller found this roomId in admin_rooms (D-13). */
  isRoomInAdminList: boolean;
  /** The set of mxids in the agents-registry room (D-09 authority). */
  agentsInRegistry: ReadonlySet<string>;
}

/** Decision + a stable reason string suitable for structured logging. */
export interface ClassifyResult {
  decision: ClassifyDecision;
  reason: string;
}

/**
 * Classify a single room for a single user.
 *
 * Decision tree (first matching rule wins):
 *   1. isRoomInAdminList          → exclude / "admin_room"      (D-13)
 *   2. user not in memberMxids    → exclude / "user_not_member" (defensive)
 *   3. memberCount <= 1           → exclude / "solo_room"       (edge case)
 *   4. memberCount === 2:
 *      - other mxid ∈ agentsInRegistry → exclude / "harness_dm"           (D-08)
 *      - otherwise                    → materialize / "two_party_non_agent" (D-09)
 *   5. memberCount >= 3           → materialize / "group_room"  (D-08 corollary)
 */
export function classifyRoom(input: ClassifyRoomInput): ClassifyResult {
  // Rule 1: admin rooms (D-13 ignore-list) — Skynet plumbing, never a
  // conversation-list entry regardless of how many members are in them.
  if (input.isRoomInAdminList) {
    return { decision: "exclude", reason: "admin_room" };
  }

  // Rule 2: defensive — if we somehow classified a room the user isn't in,
  // do not materialize it. The observation loop should not have called us
  // in that case (caller only iterates the user's joined_rooms), but this
  // guards against stale/racey data flowing through.
  if (!input.memberMxids.includes(input.userMxid)) {
    return { decision: "exclude", reason: "user_not_member" };
  }

  // Rule 3: solo room (just the user, no other members) — not a
  // conversation-list entry.
  if (input.memberCount <= 1) {
    return { decision: "exclude", reason: "solo_room" };
  }

  // Rule 4: the exact D-08 two-party case.
  if (input.memberCount === 2) {
    const otherMxid = input.memberMxids.find((m) => m !== input.userMxid);
    // `otherMxid` should exist since memberCount === 2 AND user is present
    // (Rule 2 passed). Defensive fallback: if somehow undefined, treat as
    // non-registry (materialize conservatively).
    if (otherMxid !== undefined && input.agentsInRegistry.has(otherMxid)) {
      return { decision: "exclude", reason: "harness_dm" };
    }
    return { decision: "materialize", reason: "two_party_non_agent" };
  }

  // Rule 5: fallthrough — 3+ members always materialize. D-08's exclusion
  // is EXACTLY two-party; nothing about 3+ member rooms is duplicated by
  // harness sessions.
  return { decision: "materialize", reason: "group_room" };
}
