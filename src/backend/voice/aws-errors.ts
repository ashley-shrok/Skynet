/**
 * Phase 98 plan 04 — shared AWS-error classification helper (pure kernel).
 *
 * Single-purpose type guard `isAwsAccessDenied(err)` that identifies
 * "policy-detached" failures from Polly or Transcribe so upstream handlers
 * can route them to info-level logs + 503 responses (per 98-CONTEXT.md
 * § Provider access: "off-switch is policy-absence"; per 98-RESEARCH.md
 * § Pitfall 2 + § V7).
 *
 * Consumers (all Phase 98):
 *
 *   - `src/backend/voice/polly-adapter.ts` — wraps SynthesizeSpeech errors.
 *   - `src/backend/voice/transcribe-adapter.ts` — wraps StartStreamTranscription errors.
 *   - `src/backend/database/routes/voice.ts` (Plan 06) — catchall in
 *     handleTranscribe / handleSpeak / handleSpeakStream; when the guard
 *     matches, log at info level and return `{ error: "voice … unavailable",
 *     status: 503 }` instead of the normal 500 error branch.
 *
 * This module is DELIBERATELY DUCK-TYPED — no imports from `@aws-sdk/*`.
 * Rationale:
 *
 *   1. Both adapters (polly + transcribe) already own the AWS SDK
 *      dependency; a shared helper that ALSO imports the SDK would create
 *      redundant coupling and force every consumer to depend on the SDK
 *      even in test / mock contexts where the SDK is stubbed.
 *   2. The AccessDenied wire shape is stable across AWS services — the
 *      `AccessDeniedException` name is a canonical AWS API convention, and
 *      the `$metadata.httpStatusCode === 403` field is the canonical HTTP
 *      response shape surfaced by every SDK v3 client. Duck-typing here is
 *      SAFE because we key on stable AWS invariants, not SDK-internal
 *      representation.
 *   3. Keeping this module pure lets it be consumed by voice.ts route
 *      handlers without pulling the SDK into their imports (Plan 06 will
 *      import this helper directly to classify errors from the adapters
 *      before choosing which response branch to run).
 *
 * This module has zero imports, zero I/O, and is safe to call on every
 * request-error path.
 */

/**
 * Returns `true` when `err` is an AWS SDK error indicating the caller's
 * IAM policy does not grant the required action.
 *
 * Match criteria (either or both must be true):
 *
 *   1. `err.name === "AccessDeniedException"` — the canonical AWS API
 *      exception name for policy denials, surfaced by every AWS SDK v3
 *      client when the underlying HTTP 403 carries the
 *      `X-Amzn-ErrorType: AccessDeniedException` header.
 *
 *   2. `err.$metadata.httpStatusCode === 403` — the raw HTTP status field
 *      the AWS SDK v3 attaches to every error via the `$metadata` object.
 *      Present regardless of whether the SDK could parse a structured
 *      error type from the response body.
 *
 * Non-matches (all return `false`):
 *
 *   - Non-Error values (null, undefined, numbers, strings, plain objects) —
 *     the caller's catch block should already have narrowed to Error, but
 *     the guard is defensive and returns false without throwing.
 *   - Sibling AWS exceptions like ThrottlingException (name mismatch,
 *     status 429), ValidationException (400), etc.
 *   - Generic Errors with unrelated status codes (500 server error, 502
 *     bad gateway, network timeouts).
 *
 * @param err - Any caught value. Typically the second arg of `.catch(err => ...)`.
 * @returns `true` if `err` is a canonical AWS AccessDenied shape.
 */
export function isAwsAccessDenied(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const nameMatches =
    "name" in err && (err as { name: string }).name === "AccessDeniedException";
  const statusMatches =
    "$metadata" in err &&
    (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 403;
  return nameMatches || statusMatches;
}
