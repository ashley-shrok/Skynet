/**
 * spawn-requests/types.ts
 *
 * Wire types for the spawn-request protocol (D-04, D-09, D-10, D-19).
 * Internal-to-backend — not exported to frontend (Phase 99 Plan 01).
 *
 * No runtime imports — types-only file.
 */

/**
 * Request file body schema (D-04, D-12).
 * The request-id (uuid) lives in the filename, NOT the body.
 * Extra fields (coord_mxid, target-host, priority, ordinal, retry_count) are
 * rejected by parseRequestBody as malformed (D-05).
 */
export interface SpawnRequestBody {
  roles: string[];       // one or more role names (replaces single role: string — D-12)
  skills?: string[];     // optional list of skill slugs the newborn has ready (D-04)
  prompt: string;        // first user message to the newborn agent (D-05)
  task: string | null;   // kept for coord-drop backwards compat; wake fires set null (D-12)
  requested_at: string;  // ISO-Z timestamp for debug tracing
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
  roles: string[];     // one or more role names (replaces role: string — D-12)
  skills?: string[];   // optional list of skill slugs the newborn has ready (D-04)
  prompt: string;      // first user message to the newborn agent (D-05)
  task: string | null;
  requested_at: string;

  /**
   * Sweep-side decrypted SSH connection bag threaded down from `scanSpawnRequests`
   * (quick-260923-9x1). Consumed directly by `writeResponseFile`'s REMOTE branch
   * via `connectOneShot` — replaces the previous `resolveHostById(hostId, userId)`
   * lookup that silently failed when `userId` was `""` (as it always was on the
   * queue-emitted PendingBirth items produced by `parseSpawnRequestBatch`).
   *
   * OPTIONAL because the LOCAL branch (`isLocalHostId(hostIdNum) === true`) writes
   * to the container's bind-mounted `~/fleet/spawn-requests/` and bypasses SSH
   * entirely — no connection bag needed on that path.
   *
   * Sweep invariant: if a host reaches the queue over the REMOTE branch, its
   * credentials have already been proven decryptable through the defense-in-depth
   * CSKEK filter at `list-substrate-hosts.ts:130`, so `hostConnDetails` will be
   * populated on every REMOTE-emitted item. Absence on a REMOTE item is a hard
   * invariant violation (see writeResponseFile's error-log branch).
   *
   * Source: `list-substrate-hosts.ts:168-177` (CSKEK-decrypted `_connDetails` bag)
   * → threaded through `scanSpawnRequests(host, channel)` reading
   * `(host as SubstrateHostRecord)._connDetails` → `parseSpawnRequestBatch(stdout,
   * hostId, hostConnDetails)` → this field on every emitted PendingBirth.
   */
  hostConnDetails?: Record<string, unknown>;

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
 *
 * `birth_timeout` (added post-Phase-99): the worker's per-attempt wall-clock
 * timeout fired. Distinguished from `homeserver_unreachable` (which is an
 * early-step SSH-connect failure) — a timeout can strike AFTER the peer-side
 * birth has actually started or even completed, so the accompanying `message`
 * carries a "may have been born as X — verify before retrying" instruction to
 * avoid the operator creating a duplicate identity.
 */
export type FailureReason =
  | "malformed"
  | "role_unknown"
  | "birth_failed"
  | "homeserver_unreachable"
  | "pool_exhausted"
  | "matrix_creds_missing"
  | "birth_timeout";

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
