/**
 * spawn-requests/types.ts
 *
 * Wire types for the spawn-request protocol (D-04, D-09, D-10, D-19).
 * Internal-to-backend — not exported to frontend (Phase 99 Plan 01).
 *
 * No runtime imports — types-only file.
 */

/**
 * Request file body schema (D-04).
 * The request-id (uuid) lives in the filename, NOT the body.
 * Extra fields (coord_mxid, target-host, priority, ordinal, retry_count) are
 * rejected by parseRequestBody as malformed (D-05).
 */
export interface SpawnRequestBody {
  role: string;
  task: string | null;
  requested_at: string; // ISO-Z timestamp for debug tracing
}

/**
 * An in-flight pending birth item held in the in-memory queue (D-06, D-08).
 * Carries the parsed request contents plus sweep-provided metadata needed to
 * route the birth.
 */
export interface PendingBirth {
  hostId: string;      // HostRecord.id (string from PerHostState)
  hostIdNum: number;   // parseInt(hostId, 10) for BirthOptions.hostId (Pitfall 2)
  uuid: string;        // from filename (strip .json)
  role: string;
  task: string | null;
  requested_at: string;
  userId: string;      // owner-userId from host record (D-14)

  /**
   * Sweep-side validation failure (post-code-review M2/M3).
   *
   * When the sweep's parseSpawnRequestBatch runs full parseRequestBody
   * validation and finds the request body malformed (bad JSON / missing
   * fields / invalid role pattern / task too long / etc.), it still enqueues
   * a PendingBirth so the request-id gets a failure file back to coord (rather
   * than silently disappearing). The malformed reason travels here.
   *
   * When present: processBirth short-circuits, skips getHostOwnerUserId +
   * birthIdentity entirely, and drops a `{reason:"malformed", message}`
   * failure file at ~/fleet/spawn-requests/<uuid>.failure.json so coord can
   * potentially iterate on the request body.
   * When absent: normal birth path.
   */
  malformedReason?: string;
}

/**
 * Success response file body (D-09).
 * Written to ~/fleet/spawn-requests/<uuid>.success.json.
 *
 * The `mxid` field is intentionally omitted. The birth-orchestrator's `ended`
 * event does NOT carry the server-side-derived MXID localpart (which, for
 * pool-picked identities, is `<PoolName>-<Role>[-N]` PascalCase-hyphenated and
 * differs from `name`). Deriving it in the worker would require a redundant
 * `deriveMxidWithOrdinal` call against the Synapse admin API per birth. Since
 * `name` is what coord dispatches on (and directory-search resolves name → mxid
 * unambiguously when needed), the mxid field would be either wrong or wasteful
 * — dropped as YAGNI. If a future consumer genuinely needs the mxid up-front,
 * revisit by either extending the orchestrator's ended event (violates D-20
 * today) or adding a targeted redirection lookup.
 */
export interface SuccessResponse {
  name: string;       // pool-picked identity name (lowercase); use directory-search to resolve to mxid
  birthed_at: string; // ISO-Z audit timestamp
}

/**
 * Failure reason enum (D-10).
 * Exactly six values in this order per RESEARCH.md Failure reason Enum section.
 */
export type FailureReason =
  | "malformed"
  | "role_unknown"
  | "birth_failed"
  | "homeserver_unreachable"
  | "pool_exhausted"
  | "matrix_creds_missing";

/**
 * Failure response file body (D-10).
 * Written to ~/fleet/spawn-requests/<uuid>.failure.json.
 * message is PRESENT and descriptive when reason === "malformed" (coord can iterate);
 * ABSENT or terse for all other reasons (coord escalates opaquely).
 */
export interface FailureResponse {
  reason: FailureReason;
  message?: string;
}
