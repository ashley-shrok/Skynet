/**
 * Phase 91 Plan 01 — shared type surface for the new-conversation modal
 * (sub-slice C: relay-mediated group conversations).
 *
 * Zero runtime code. Zero imports from src/backend/*. Every exported symbol
 * is a pure TypeScript type or interface consumed by:
 *   - useNewConversationForm hook (Wave 1)
 *   - NewConversationModal + sub-components (Wave 3–4)
 *   - relay-room-create-api frontend client (Wave 3)
 *   - POST /relay-room/create backend route (Wave 2)
 */

// ---------------------------------------------------------------------------
// PickedParticipant — the unified row-shape for the picker list, chips strip,
// hook state, and api request payload.
//
// D-decision: a single discriminated shape covers both humans and agents so
// chips-strip, hook picked set, and api client all consume one type.
// ---------------------------------------------------------------------------

/**
 * A participant that has been selected (or is available to select) in the
 * new-conversation modal. Covers both humans (role="human") and agents
 * (role="agent").
 *
 * mxid invariant: non-null by construction. The modal (Plan 05) filters out
 * BasicUser rows with mxid=null BEFORE shaping into PickedParticipant, so
 * every PickedParticipant guaranteed carries a real Matrix user ID.
 * Plan 05 is the enforcement site; this type trusts the caller to uphold
 * the invariant.
 */
export type PickedParticipant = {
  /**
   * Matrix user ID (`@localpart:server`). Required and non-null.
   * Null-mxid users are filtered out at the modal (Plan 05) before
   * constructing a PickedParticipant; this field is the canonical
   * identity key for toggles, removes, and invite payloads.
   */
  mxid: string;

  /** Display name shown in chips and list rows. */
  displayName: string;

  /**
   * Identity colour hue in [0, 360). null for participants whose
   * identity has no persisted hue (pre-Phase-88 users, or agents
   * without a colorHue). Chips and avatar circles fall back to
   * NEUTRAL_GREY when null.
   */
  colorHue: number | null;

  /**
   * Pre-resolved avatar URL (null if identity has no avatar).
   * Chips and list rows render an initial-letter placeholder when null.
   */
  avatarUrl: string | null;

  /**
   * Discriminator: 'human' for Skynet users, 'agent' for fleet agents.
   * The gate uses this to enforce the single-agent-disallowed constraint
   * (shape §Philosophy — UX coherence with the existing harness-session sidebar).
   */
  role: "human" | "agent";

  /**
   * Skynet user id (BasicUser.id from /users/list-basic). Present for
   * humans only; undefined for agents.
   */
  userId?: string;

  /**
   * Agent identity key (Identity.identityKey from identities-store).
   * Present for agents only; undefined for humans.
   */
  identityKey?: string;

  /**
   * Optional subtitle line rendered below the agent name in list rows
   * (shape §Shape "(for agents) a subtitle line"). Undefined for humans.
   */
  subtitle?: string;
};

// ---------------------------------------------------------------------------
// GateState — discriminated union driving the Create button's enabled/disabled
// state and the hint text below it.
//
// D-decision: gate evaluates in strict priority order:
//   1. submitting → debounce guard (shape §What would make it wrong: "Two
//      rapid clicks on Create produce two rooms").
//   2. no-room-name → mandatory name (shape §Shape "mandatory room name field").
//   3. no-participants → zero picks disallowed (shape §Scope "Zero-participant
//      rooms: disallowed").
//   4. single-agent-only → UX coherence guard (shape §Philosophy — a solo-agent
//      room already exists in the harness-session sidebar).
//   5. else → ok.
// ---------------------------------------------------------------------------

/**
 * Gate evaluation result for the Create button and hint text.
 *
 * Positive branch: `{ ok: true }` — all conditions satisfied, create is allowed.
 * Negative branches carry a `reason` string for hint text rendering.
 */
export type GateState =
  | { ok: true }
  | { ok: false; reason: "no-participants" }
  | { ok: false; reason: "single-agent-only" }
  | { ok: false; reason: "no-room-name" }
  | { ok: false; reason: "submitting" };

// ---------------------------------------------------------------------------
// Wire types — shared between the frontend api client (Wave 3) and the backend
// route (Wave 2). Matches PATTERNS.md § relay-room-create-api verbatim.
// ---------------------------------------------------------------------------

/**
 * Request body for `POST /relay-room/create`.
 * Sent by the frontend api client after gate passes and the Create button fires.
 */
export interface CreateRelayRoomRequest {
  /** Human-readable name for the new room (trimmed, non-empty). */
  roomName: string;

  /** Matrix user IDs of picked human participants. May be empty array only if
   *  agentMxids is non-empty, but backend enforces the combined-non-empty gate. */
  humanMxids: string[];

  /** Matrix user IDs of picked agent participants. */
  agentMxids: string[];
}

/**
 * Success response body from `POST /relay-room/create`.
 * The backend returns this after creating the Matrix room, inviting all
 * participants, and materialising the relay_room_sessions row.
 */
export interface CreateRelayRoomResponse {
  ok: true;

  /** Matrix room ID of the newly created room (`!roomId:server`). */
  roomId: string;

  /** relay_room_sessions.id for the row materialised at create time (D-14
   *  schema-as-coordinator pattern from Phase 89). */
  sessionId: string;

  /** Room title as stored (trimmed roomName). Used to open the pane tab. */
  roomTitle: string;
}
